import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, formatSeries, iso, nextCounter, qualityAudits, qualityChecklists, sql, type Tx } from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { QualityRepository } from './quality.repository';
import { capaSummary, isoOrNull } from './quality.util';

type AuditRow = typeof qualityAudits.$inferSelect;
type ChecklistRow = typeof qualityChecklists.$inferSelect;

/**
 * Audits against checklists. Each item is answered yes / no / not applicable; the score is
 * yes ÷ (yes + no) × 100. "No" answers are the non-compliances a CAPA can be raised for.
 */
@Injectable()
export class AuditsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
  ) {}

  // ---------- checklists ----------

  listChecklists(includeInactive: boolean): Promise<Q.Checklist[]> {
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(qualityChecklists)
        .where(includeInactive ? undefined : eq(qualityChecklists.isActive, true))
        .orderBy(asc(qualityChecklists.name));
      return rows.map(checklistDto);
    });
  }

  getChecklist(id: string): Promise<Q.Checklist> {
    return this.db.tx(async (tx) => checklistDto(await this.findChecklist(tx, id)));
  }

  saveChecklist(id: string | null, input: z.output<typeof Q.checklistInputSchema>): Promise<Q.Checklist> {
    const ctx = currentContext()!;
    if (new Set(input.items).size !== input.items.length) throw badRequest('duplicate_item', 'Each checklist item must be different');
    return this.db.tx(async (tx) => {
      const dup = await tx
        .select({ id: qualityChecklists.id })
        .from(qualityChecklists)
        .where(sql`lower(${qualityChecklists.name}) = lower(${input.name})`)
        .limit(1);
      if (dup[0] && dup[0].id !== id) throw conflict('duplicate_name', `A checklist named "${input.name}" already exists`);
      // Keep item ids stable when the text is unchanged so past answers still line up.
      let previous: Q.ChecklistItem[] = [];
      if (id) previous = (await this.findChecklist(tx, id)).items;
      let next = Math.max(0, ...previous.map((i) => Number(i.id) || 0)) + 1;
      const items = input.items.map((text) => previous.find((p) => p.text === text) ?? { id: String(next++), text });
      const values = { name: input.name, category: input.category, items, isActive: input.isActive, updatedBy: ctx.userId };
      const [row] = id
        ? await tx.update(qualityChecklists).set(values).where(eq(qualityChecklists.id, id)).returning()
        : await tx.insert(qualityChecklists).values({ ...values, tenantId: ctx.tenantId!, createdBy: ctx.userId }).returning();
      return checklistDto(row!);
    });
  }

  // ---------- audits ----------

  schedule(input: z.output<typeof Q.scheduleAuditSchema>): Promise<Q.Audit> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const cl = await this.findChecklist(tx, input.checklistId);
      if (!cl.isActive) throw conflict('checklist_inactive', `${cl.name} is no longer in use`);
      if (input.auditorId && !(await this.repo.userExists(tx, input.auditorId))) throw notFound('Auditor');
      const auditNo = formatSeries('AU', await nextCounter(tx, 'quality.audit'));
      const [row] = await tx
        .insert(qualityAudits)
        .values({
          tenantId: ctx.tenantId!,
          auditNo,
          facilityId: ctx.facilityId ?? null,
          checklistId: cl.id,
          checklistName: cl.name,
          category: cl.category,
          items: cl.items,
          department: input.department || null,
          scheduledOn: input.scheduledOn,
          auditorId: input.auditorId ?? ctx.userId ?? null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      return this.detail(tx, row!);
    });
  }

  list(q: z.output<typeof Q.auditQuerySchema>): Promise<Paginated<Q.AuditSummary>> {
    const ctx = currentContext()!;
    const t = qualityAudits;
    const where = and(
      ctx.facilityId ? sql`(${t.facilityId} = ${ctx.facilityId} or ${t.facilityId} is null)` : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.category ? eq(t.category, q.category) : undefined,
      q.from ? sql`${t.scheduledOn} >= ${q.from}` : undefined,
      q.to ? sql`${t.scheduledOn} <= ${q.to}` : undefined,
    );
    return this.db.tx(async (tx) => {
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(t).where(where).orderBy(desc(t.scheduledOn), desc(t.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(t).where(where),
      ]);
      const people = await this.repo.people(tx, rows.map((r) => r.auditorId));
      return { items: rows.map((r) => summary(r, people)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<Q.Audit> {
    return this.db.tx(async (tx) => this.detail(tx, await this.find(tx, id)));
  }

  submit(id: string, input: z.output<typeof Q.submitAuditSchema>): Promise<Q.Audit> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status !== 'scheduled') throw conflict('audit_closed', `${row.auditNo} is already ${row.status}`);
      const known = new Set(row.items.map((i) => i.id));
      const byItem = new Map(input.responses.map((r) => [r.itemId, r]));
      const unknown = [...byItem.keys()].filter((k) => !known.has(k));
      if (unknown.length) throw badRequest('unknown_item', `Unknown checklist item(s): ${unknown.join(', ')}`);
      const missing = row.items.filter((i) => !byItem.has(i.id));
      if (missing.length) throw badRequest('incomplete_audit', `Answer every item (${missing.length} left)`);
      const yes = input.responses.filter((r) => r.result === 'yes').length;
      const no = input.responses.filter((r) => r.result === 'no').length;
      const score = yes + no ? Math.round((yes / (yes + no)) * 10000) / 100 : 100;
      const [updated] = await tx
        .update(qualityAudits)
        .set({
          responses: row.items.map((i) => {
            const r = byItem.get(i.id)!;
            return { itemId: i.id, result: r.result, ...(r.remark ? { remark: r.remark } : {}) };
          }),
          score: score.toFixed(2),
          summary: input.summary || null,
          status: 'completed',
          conductedAt: new Date().toISOString(),
          auditorId: row.auditorId ?? ctx.userId ?? null,
          updatedBy: ctx.userId,
        })
        .where(eq(qualityAudits.id, id))
        .returning();
      await this.repo.addActivity(tx, 'audit', id, 'completed', { from: 'scheduled', to: 'completed', note: `Score ${score}%` });
      return this.detail(tx, updated!);
    });
  }

  cancel(id: string): Promise<Q.Audit> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status !== 'scheduled') throw conflict('audit_closed', `${row.auditNo} is already ${row.status}`);
      const [updated] = await tx
        .update(qualityAudits)
        .set({ status: 'cancelled', updatedBy: ctx.userId })
        .where(eq(qualityAudits.id, id))
        .returning();
      return this.detail(tx, updated!);
    });
  }

  private async findChecklist(tx: Tx, id: string): Promise<ChecklistRow> {
    const [row] = await tx.select().from(qualityChecklists).where(eq(qualityChecklists.id, id)).limit(1);
    if (!row) throw notFound('Checklist');
    return row;
  }

  private async find(tx: Tx, id: string, lock = false): Promise<AuditRow> {
    const qb = tx.select().from(qualityAudits).where(eq(qualityAudits.id, id)).limit(1);
    const [row] = lock ? await qb.for('update') : await qb;
    if (!row) throw notFound('Audit');
    return row;
  }

  private async detail(tx: Tx, row: AuditRow): Promise<Q.Audit> {
    const capas = await this.repo.capasFor(tx, 'audit', [row.id]);
    const people = await this.repo.people(tx, [row.auditorId, ...capas.map((c) => c.ownerId)]);
    const answers = new Map(row.responses.map((r) => [r.itemId, r]));
    return {
      ...summary(row, people),
      items: row.items.map((i) => ({ ...i, result: answers.get(i.id)?.result ?? null, remark: answers.get(i.id)?.remark ?? null })),
      summary: row.summary,
      nonCompliant: row.responses.filter((r) => r.result === 'no').length,
      capas: capas.map((c) => capaSummary(c, people)),
    };
  }
}

const checklistDto = (r: ChecklistRow): Q.Checklist => ({
  id: r.id,
  name: r.name,
  category: r.category as Q.ChecklistCategory,
  items: r.items,
  isActive: r.isActive,
  updatedAt: iso(r.updatedAt),
});

function summary(r: AuditRow, people: Map<string, Q.Person>): Q.AuditSummary {
  return {
    id: r.id,
    auditNo: r.auditNo,
    checklistId: r.checklistId,
    checklistName: r.checklistName,
    category: r.category as Q.ChecklistCategory,
    department: r.department,
    scheduledOn: r.scheduledOn,
    status: r.status as Q.AuditStatus,
    score: r.score == null ? null : Number(r.score),
    auditor: r.auditorId ? (people.get(r.auditorId) ?? null) : null,
    conductedAt: isoOrNull(r.conductedAt),
  };
}
