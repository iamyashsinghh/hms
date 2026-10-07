import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, iso, platformTicketMessages, platformTickets, sql, users, type Tx } from '@hms/db';
import type { CreateTicket, Paginated, Ticket, TicketDetail, TicketStatus } from './contracts';
import { currentContext } from '../../common/context/request-context';
import { badRequest, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { PlatformDb } from './platform-db';
import { toTicket } from './mappers';
import type { PlatformPrincipal } from './platform-admin.guard';

const OPEN_STATUSES: TicketStatus[] = ['open', 'in_progress', 'waiting_on_customer'];

/** Support tickets between hospital staff and the platform team. */
@Injectable()
export class TicketsService {
  constructor(
    private readonly db: PlatformDb,
    private readonly outbox: OutboxService,
  ) {}

  // ---------- hospital side ----------

  async create(input: CreateTicket & { category: Ticket['category']; priority: Ticket['priority'] }): Promise<TicketDetail> {
    const ctx = currentContext()!;
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const name = await this.staffName(tx, ctx.userId!);
      const seq = await tx.execute<{ n: string }>(sql`select nextval('platform.ticket_number_seq')::text as n`);
      const [t] = await tx
        .insert(platformTickets)
        .values({
          tenantId: ctx.tenantId!,
          number: `TKT-${seq.rows[0]!.n.padStart(6, '0')}`,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          raisedByUserId: ctx.userId!,
          raisedByName: name,
        })
        .returning();
      await tx.insert(platformTicketMessages).values({
        tenantId: ctx.tenantId!,
        ticketId: t!.id,
        authorType: 'staff',
        authorId: ctx.userId!,
        authorName: name,
        body: input.body,
      });
      await this.outbox.publish(tx, 'platform.ticket.created', { ticketId: t!.id, number: t!.number, priority: t!.priority });
      return this.detail(tx, t!.id, false);
    });
  }

  /** Staff with platform.ticket.read see every ticket of the hospital; others only their own. */
  list(status: TicketStatus | undefined, page: number, pageSize: number): Promise<Paginated<Ticket>> {
    const ctx = currentContext()!;
    const own = !ctx.permissions.has('platform.ticket.read');
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const where = and(
        eq(platformTickets.tenantId, ctx.tenantId!),
        status ? eq(platformTickets.status, status) : undefined,
        own ? eq(platformTickets.raisedByUserId, ctx.userId!) : undefined,
      );
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(platformTickets).where(where).orderBy(desc(platformTickets.lastActivityAt)).limit(pageSize).offset((page - 1) * pageSize),
        tx.select({ total: count() }).from(platformTickets).where(where),
      ]);
      return { items: rows.map((r) => toTicket(r)), page, pageSize, total };
    });
  }

  get(id: string): Promise<TicketDetail> {
    const ctx = currentContext()!;
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const t = await this.detail(tx, id, false);
      if (!ctx.permissions.has('platform.ticket.read') && t.raisedByUserId !== ctx.userId) throw notFound('Ticket');
      return t;
    });
  }

  reply(id: string, body: string): Promise<TicketDetail> {
    const ctx = currentContext()!;
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const t = await this.detail(tx, id, false);
      if (!ctx.permissions.has('platform.ticket.read') && t.raisedByUserId !== ctx.userId) throw notFound('Ticket');
      if (t.status === 'closed') throw badRequest('ticket_closed', 'This ticket is closed. Please raise a new one.');
      await tx.insert(platformTicketMessages).values({
        tenantId: ctx.tenantId!,
        ticketId: id,
        authorType: 'staff',
        authorId: ctx.userId!,
        authorName: await this.staffName(tx, ctx.userId!),
        body,
      });
      await this.touch(tx, ctx.tenantId!, id, t.status === 'in_progress' ? 'in_progress' : 'open');
      return this.detail(tx, id, false);
    });
  }

  resolve(id: string): Promise<TicketDetail> {
    const ctx = currentContext()!;
    return this.db.tenant(ctx.tenantId!, async (tx) => {
      const t = await this.detail(tx, id, false);
      if (!ctx.permissions.has('platform.ticket.read') && t.raisedByUserId !== ctx.userId) throw notFound('Ticket');
      await this.touch(tx, ctx.tenantId!, id, 'resolved');
      return this.detail(tx, id, false);
    });
  }

  // ---------- platform team ----------

  adminList(q: { status?: TicketStatus; tenantId?: string; page: number; pageSize: number }): Promise<Paginated<Ticket>> {
    return this.db.crossTenant(async (tx) => {
      const where = sql`true
        ${q.status ? sql`and t.status = ${q.status}` : sql``}
        ${q.tenantId ? sql`and t.tenant_id = ${q.tenantId}::uuid` : sql``}`;
      const rows = await tx.execute<Record<string, unknown>>(sql`
        select t.*, tn.name as tenant_name, a.name as admin_name
          from platform.tickets t
          join platform.tenants tn on tn.id = t.tenant_id
          left join platform.admins a on a.id = t.assigned_admin_id
         where ${where}
         order by case t.status when 'open' then 0 when 'in_progress' then 1 when 'waiting_on_customer' then 2 else 3 end,
                  case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
                  t.last_activity_at desc
         limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`);
      const total = await tx.execute<{ n: number }>(sql`select count(*)::int as n from platform.tickets t where ${where}`);
      return { items: rows.rows.map(rawTicket), page: q.page, pageSize: q.pageSize, total: total.rows[0]!.n };
    });
  }

  async adminGet(id: string): Promise<TicketDetail> {
    const tenantId = await this.tenantOf(id);
    return this.db.tenant(tenantId, (tx) => this.detail(tx, id, true));
  }

  async adminReply(id: string, admin: PlatformPrincipal, body: string, isInternal: boolean): Promise<TicketDetail> {
    const tenantId = await this.tenantOf(id);
    return this.db.tenant(tenantId, async (tx) => {
      const t = await this.detail(tx, id, true);
      await tx.insert(platformTicketMessages).values({
        tenantId,
        ticketId: id,
        authorType: 'platform',
        authorId: admin.id,
        authorName: `${admin.name} (HMS Support)`,
        body,
        isInternal,
      });
      if (!isInternal) {
        await this.touch(tx, tenantId, id, t.status === 'closed' ? 'closed' : 'waiting_on_customer');
        await this.outbox.publish(
          tx,
          'platform.ticket.replied',
          { ticketId: id, number: t.number, raisedByUserId: t.raisedByUserId, subject: t.subject },
          tenantId,
        );
      }
      if (!t.assignedAdminId) {
        await tx.update(platformTickets).set({ assignedAdminId: admin.id }).where(and(eq(platformTickets.tenantId, tenantId), eq(platformTickets.id, id)));
      }
      return this.detail(tx, id, true);
    });
  }

  async adminUpdate(id: string, patch: { status?: TicketStatus; priority?: Ticket['priority']; assignedAdminId?: string | null }): Promise<TicketDetail> {
    const tenantId = await this.tenantOf(id);
    return this.db.tenant(tenantId, async (tx) => {
      await tx
        .update(platformTickets)
        .set({
          ...(patch.priority ? { priority: patch.priority } : {}),
          ...(patch.assignedAdminId !== undefined ? { assignedAdminId: patch.assignedAdminId } : {}),
        })
        .where(and(eq(platformTickets.tenantId, tenantId), eq(platformTickets.id, id)));
      if (patch.status) await this.touch(tx, tenantId, id, patch.status);
      return this.detail(tx, id, true);
    });
  }

  /** Open tickets for one hospital (console tenant page). */
  async recentForTenant(tx: Tx, tenantId: string): Promise<Ticket[]> {
    const rows = await tx.select().from(platformTickets).where(eq(platformTickets.tenantId, tenantId)).orderBy(desc(platformTickets.lastActivityAt)).limit(10);
    return rows.map((r) => toTicket(r));
  }

  async countOpen(): Promise<number> {
    return this.db.crossTenant(async (tx) => {
      const [{ n }] = await tx.select({ n: count() }).from(platformTickets).where(inArray(platformTickets.status, OPEN_STATUSES));
      return n;
    });
  }

  // ---------- helpers ----------

  private async tenantOf(id: string): Promise<string> {
    const tenantId = await this.db.crossTenant(async (tx) => {
      const [row] = await tx.select({ tenantId: platformTickets.tenantId }).from(platformTickets).where(eq(platformTickets.id, id)).limit(1);
      return row?.tenantId;
    });
    if (!tenantId) throw notFound('Ticket');
    return tenantId;
  }

  private async touch(tx: Tx, tenantId: string, id: string, status: TicketStatus) {
    await tx
      .update(platformTickets)
      .set({
        status,
        lastActivityAt: sql`now()`,
        resolvedAt: status === 'resolved' || status === 'closed' ? sql`coalesce(${platformTickets.resolvedAt}, now())` : null,
      })
      .where(and(eq(platformTickets.tenantId, tenantId), eq(platformTickets.id, id)));
  }

  private async staffName(tx: Tx, userId: string): Promise<string> {
    const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return u?.name ?? 'Staff';
  }

  private async detail(tx: Tx, id: string, includeInternal: boolean): Promise<TicketDetail> {
    const [t] = await tx.select().from(platformTickets).where(eq(platformTickets.id, id)).limit(1);
    if (!t) throw notFound('Ticket');
    const msgs = await tx
      .select()
      .from(platformTicketMessages)
      .where(
        and(
          eq(platformTicketMessages.tenantId, t.tenantId),
          eq(platformTicketMessages.ticketId, id),
          includeInternal ? undefined : eq(platformTicketMessages.isInternal, false),
        ),
      )
      .orderBy(platformTicketMessages.createdAt);
    return {
      ...toTicket(t),
      messages: msgs.map((m) => ({
        id: m.id,
        authorType: m.authorType as 'staff' | 'platform',
        authorName: m.authorName,
        body: m.body,
        isInternal: m.isInternal,
        createdAt: iso(m.createdAt),
      })),
    };
  }
}

function rawTicket(r: Record<string, unknown>): Ticket {
  const d = (v: unknown) => new Date(v as string).toISOString();
  return {
    id: r.id as string,
    tenantId: r.tenant_id as string,
    tenantName: r.tenant_name as string,
    number: r.number as string,
    subject: r.subject as string,
    category: r.category as Ticket['category'],
    priority: r.priority as Ticket['priority'],
    status: r.status as Ticket['status'],
    raisedByName: r.raised_by_name as string,
    raisedByUserId: r.raised_by_user_id as string,
    assignedAdminId: (r.assigned_admin_id as string | null) ?? null,
    assignedAdminName: (r.admin_name as string | null) ?? null,
    lastActivityAt: d(r.last_activity_at),
    createdAt: d(r.created_at),
  };
}
