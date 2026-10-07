import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, formatSeries, iso, nextCounter, qualityComplaints, sql, type Tx } from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { QualityRepository } from './quality.repository';
import { assertTransition, capaSummary, isoOrNull, requireNote } from './quality.util';

type Row = typeof qualityComplaints.$inferSelect;

@Injectable()
export class ComplaintsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
    private readonly outbox: OutboxService,
  ) {}

  create(input: z.output<typeof Q.createComplaintSchema>): Promise<Q.Complaint> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      if (input.patientId && !(await this.repo.patientExists(tx, input.patientId))) throw notFound('Patient');
      const complaintNo = formatSeries('CM', await nextCounter(tx, 'quality.complaint'));
      const dueAt = new Date(Date.now() + Q.COMPLAINT_TAT_HOURS[input.priority] * 3_600_000).toISOString();
      const [row] = await tx
        .insert(qualityComplaints)
        .values({
          tenantId: ctx.tenantId!,
          complaintNo,
          facilityId: ctx.facilityId ?? null,
          source: input.source,
          category: input.category,
          priority: input.priority,
          patientId: input.patientId ?? null,
          complainantName: input.complainantName,
          complainantMobile: input.complainantMobile ?? null,
          department: input.department || null,
          description: input.description,
          dueAt,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await this.repo.addActivity(tx, 'complaint', row!.id, 'registered', { to: 'open' });
      const event: Q.ComplaintRegisteredEvent = {
        complaintId: row!.id,
        complaintNo,
        patientId: row!.patientId,
        priority: input.priority,
        category: input.category,
      };
      await this.outbox.publish(tx, 'quality.complaint.registered', { ...event });
      return this.detail(tx, row!);
    });
  }

  list(q: z.output<typeof Q.complaintQuerySchema>): Promise<Paginated<Q.ComplaintSummary>> {
    const ctx = currentContext()!;
    const t = qualityComplaints;
    const where = and(
      ctx.facilityId ? sql`(${t.facilityId} = ${ctx.facilityId} or ${t.facilityId} is null)` : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.category ? eq(t.category, q.category) : undefined,
      q.overdue === 'true' ? sql`${t.status} in ('open', 'in_progress') and ${t.dueAt} < now()` : undefined,
      q.q
        ? sql`(${t.complaintNo} = upper(${q.q}) or ${t.complainantName} ilike ${'%' + q.q + '%'} or ${t.complainantMobile} = ${q.q})`
        : undefined,
    );
    return this.db.tx(async (tx) => {
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(t).where(where).orderBy(desc(t.createdAt), desc(t.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(t).where(where),
      ]);
      const people = await this.repo.people(tx, rows.map((r) => r.assignedTo));
      const pts = await this.repo.patientRefs(tx, rows.map((r) => r.patientId));
      return { items: rows.map((r) => summary(r, people, pts)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<Q.Complaint> {
    return this.db.tx(async (tx) => this.detail(tx, await this.find(tx, id)));
  }

  update(id: string, input: z.output<typeof Q.updateComplaintSchema>): Promise<Q.Complaint> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status === 'closed') throw conflict('complaint_closed', `${row.complaintNo} is closed`);
      const to = input.status ?? (row.status as Q.ComplaintStatus);
      assertTransition('Complaint', Q.COMPLAINT_TRANSITIONS, row.status as Q.ComplaintStatus, to);
      if (input.assignedTo && !(await this.repo.userExists(tx, input.assignedTo))) throw notFound('Staff member');

      const patch: Partial<typeof qualityComplaints.$inferInsert> = { updatedBy: ctx.userId };
      if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;
      if (input.priority && input.priority !== row.priority) {
        patch.priority = input.priority;
        patch.dueAt = new Date(new Date(row.createdAt).getTime() + Q.COMPLAINT_TAT_HOURS[input.priority] * 3_600_000).toISOString();
      }
      if (to !== row.status) {
        patch.status = to;
        if (to === 'resolved') {
          requireNote(input.resolution, 'Write how the complaint was resolved');
          patch.resolution = input.resolution!;
          patch.resolvedAt = new Date().toISOString();
          patch.resolvedBy = ctx.userId ?? null;
        }
        if (to === 'in_progress' && row.status === 'resolved') {
          requireNote(input.note, 'Say why the complaint is being reopened');
          patch.resolvedAt = null;
          patch.resolvedBy = null;
        }
        if (to === 'closed') patch.closedAt = new Date().toISOString();
      }
      const [updated] = await tx.update(qualityComplaints).set(patch).where(eq(qualityComplaints.id, id)).returning();
      if (to !== row.status) {
        await this.repo.addActivity(tx, 'complaint', id, 'status', { from: row.status, to, note: input.resolution ?? input.note });
        if (to === 'resolved') {
          const event: Q.ComplaintResolvedEvent = {
            complaintId: id,
            complaintNo: row.complaintNo,
            patientId: row.patientId,
            complainantMobile: row.complainantMobile,
          };
          await this.outbox.publish(tx, 'quality.complaint.resolved', { ...event });
        }
      } else if (input.note) {
        await this.repo.addActivity(tx, 'complaint', id, 'note', { note: input.note });
      } else if (input.assignedTo !== undefined && input.assignedTo !== row.assignedTo) {
        await this.repo.addActivity(tx, 'complaint', id, 'assigned');
      }
      return this.detail(tx, updated!);
    });
  }

  private async find(tx: Tx, id: string, lock = false): Promise<Row> {
    const qb = tx.select().from(qualityComplaints).where(eq(qualityComplaints.id, id)).limit(1);
    const [row] = lock ? await qb.for('update') : await qb;
    if (!row) throw notFound('Complaint');
    return row;
  }

  private async detail(tx: Tx, row: Row): Promise<Q.Complaint> {
    const capas = await this.repo.capasFor(tx, 'complaint', [row.id]);
    const people = await this.repo.people(tx, [row.assignedTo, ...capas.map((c) => c.ownerId)]);
    const pts = await this.repo.patientRefs(tx, [row.patientId]);
    return {
      ...summary(row, people, pts),
      complainantMobile: row.complainantMobile,
      description: row.description,
      resolution: row.resolution,
      closedAt: isoOrNull(row.closedAt),
      withinTat: row.resolvedAt ? new Date(row.resolvedAt) <= new Date(row.dueAt) : null,
      capas: capas.map((c) => capaSummary(c, people)),
      activity: await this.repo.activities(tx, 'complaint', row.id),
    };
  }
}

function summary(r: Row, people: Map<string, Q.Person>, pts: Map<string, Q.PatientRef>): Q.ComplaintSummary {
  return {
    id: r.id,
    complaintNo: r.complaintNo,
    source: r.source as Q.ComplaintSource,
    category: r.category as Q.ComplaintCategory,
    priority: r.priority as Q.ComplaintPriority,
    status: r.status as Q.ComplaintStatus,
    complainantName: r.complainantName,
    patient: r.patientId ? (pts.get(r.patientId) ?? null) : null,
    department: r.department,
    dueAt: iso(r.dueAt),
    overdue: (r.status === 'open' || r.status === 'in_progress') && new Date(r.dueAt).getTime() < Date.now(),
    assignedTo: r.assignedTo ? (people.get(r.assignedTo) ?? null) : null,
    createdAt: iso(r.createdAt),
    resolvedAt: isoOrNull(r.resolvedAt),
  };
}
