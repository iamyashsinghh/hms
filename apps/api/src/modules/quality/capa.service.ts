import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  formatSeries,
  iso,
  nextCounter,
  qualityAudits,
  qualityCapas,
  qualityComplaints,
  qualityHaiCases,
  qualityIncidents,
  sql,
  type Tx,
} from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { QualityRepository, type CapaRow } from './quality.repository';
import { assertTransition, capaSummary, isoOrNull, istDate, requireNote } from './quality.util';

/** Corrective and preventive actions, raised from incidents, complaints, audits, HAI cases or indicators. */
@Injectable()
export class CapaService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
  ) {}

  create(input: z.output<typeof Q.createCapaSchema>): Promise<Q.Capa> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const source = input.sourceId ? await this.source(tx, input.sourceType, input.sourceId) : null;
      if (input.sourceId && !source) throw notFound('Source record');
      if (source?.closed) throw conflict('source_closed', `${source.label} is already closed`);
      if (input.ownerId && !(await this.repo.userExists(tx, input.ownerId))) throw notFound('Owner');
      const capaNo = formatSeries('CAPA', await nextCounter(tx, 'quality.capa'), 5);
      const [row] = await tx
        .insert(qualityCapas)
        .values({
          tenantId: ctx.tenantId!,
          capaNo,
          facilityId: ctx.facilityId ?? null,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          title: input.title,
          problem: input.problem,
          rootCause: input.rootCause || null,
          correctiveAction: input.correctiveAction || null,
          preventiveAction: input.preventiveAction || null,
          ownerId: input.ownerId ?? null,
          dueDate: input.dueDate,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await this.repo.addActivity(tx, 'capa', row!.id, 'created', { to: 'open' });
      if (source) {
        await this.repo.addActivity(tx, input.sourceType as 'incident', input.sourceId!, 'capa_added', { note: `${capaNo}: ${input.title}` });
      }
      return this.detail(tx, row!);
    });
  }

  list(q: z.output<typeof Q.capaQuerySchema>): Promise<Paginated<Q.CapaSummary>> {
    const ctx = currentContext()!;
    const t = qualityCapas;
    const where = and(
      ctx.facilityId ? sql`(${t.facilityId} = ${ctx.facilityId} or ${t.facilityId} is null)` : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.sourceType ? eq(t.sourceType, q.sourceType) : undefined,
      q.sourceId ? eq(t.sourceId, q.sourceId) : undefined,
      q.mine === 'true' ? eq(t.ownerId, ctx.userId!) : undefined,
      q.overdue === 'true' ? sql`${t.status} in ('open', 'in_progress') and ${t.dueDate} < ${istDate()}` : undefined,
    );
    return this.db.tx(async (tx) => {
      const [rows, [{ total }]] = await Promise.all([
        tx
          .select()
          .from(t)
          .where(where)
          .orderBy(sql`${t.status} in ('verified', 'cancelled')`, asc(t.dueDate), asc(t.id))
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(t).where(where),
      ]);
      const people = await this.repo.people(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => capaSummary(r, people)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<Q.Capa> {
    return this.db.tx(async (tx) => this.detail(tx, await this.find(tx, id)));
  }

  update(id: string, input: z.output<typeof Q.updateCapaSchema>): Promise<Q.Capa> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status === 'verified' || row.status === 'cancelled') throw conflict('capa_closed', `${row.capaNo} is ${row.status}`);
      const to = input.status ?? (row.status as Q.CapaStatus);
      assertTransition('CAPA', Q.CAPA_TRANSITIONS, row.status as Q.CapaStatus, to);
      if (input.ownerId && !(await this.repo.userExists(tx, input.ownerId))) throw notFound('Owner');

      const patch: Partial<typeof qualityCapas.$inferInsert> = { updatedBy: ctx.userId };
      if (input.title) patch.title = input.title;
      if (input.rootCause !== undefined) patch.rootCause = input.rootCause || null;
      if (input.correctiveAction !== undefined) patch.correctiveAction = input.correctiveAction || null;
      if (input.preventiveAction !== undefined) patch.preventiveAction = input.preventiveAction || null;
      if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
      if (input.dueDate) patch.dueDate = input.dueDate;

      if (to !== row.status) {
        patch.status = to;
        if (to === 'completed') {
          if (!(input.correctiveAction ?? row.correctiveAction)) {
            throw badRequest('action_required', 'Describe the corrective action taken before completing');
          }
          requireNote(input.note, 'Write what was done');
          patch.completionNote = input.note!;
          patch.completedAt = new Date().toISOString();
          patch.completedBy = ctx.userId ?? null;
        }
        if (to === 'verified') {
          requireNote(input.note, 'Record how effectiveness was checked');
          patch.effectivenessNote = input.note!;
          patch.verifiedAt = new Date().toISOString();
          patch.verifiedBy = ctx.userId ?? null;
        }
        if (to === 'in_progress' && row.status === 'completed') {
          requireNote(input.note, 'Say why the action was not effective');
          patch.completedAt = null;
          patch.completedBy = null;
        }
        if (to === 'cancelled') requireNote(input.note, 'Say why the action is cancelled');
      }
      const [updated] = await tx.update(qualityCapas).set(patch).where(eq(qualityCapas.id, id)).returning();
      if (to !== row.status) await this.repo.addActivity(tx, 'capa', id, 'status', { from: row.status, to, note: input.note });
      else if (input.note) await this.repo.addActivity(tx, 'capa', id, 'note', { note: input.note });
      return this.detail(tx, updated!);
    });
  }

  private async find(tx: Tx, id: string, lock = false): Promise<CapaRow> {
    const qb = tx.select().from(qualityCapas).where(eq(qualityCapas.id, id)).limit(1);
    const [row] = lock ? await qb.for('update') : await qb;
    if (!row) throw notFound('CAPA');
    return row;
  }

  /** The record a CAPA belongs to, with a label and whether it is already closed. */
  private async source(tx: Tx, type: Q.CapaSource, id: string): Promise<{ label: string; closed: boolean } | null> {
    switch (type) {
      case 'incident': {
        const [r] = await tx.select({ no: qualityIncidents.incidentNo, status: qualityIncidents.status }).from(qualityIncidents).where(eq(qualityIncidents.id, id));
        return r ? { label: `Incident ${r.no}`, closed: r.status === 'closed' || r.status === 'rejected' } : null;
      }
      case 'complaint': {
        const [r] = await tx.select({ no: qualityComplaints.complaintNo, status: qualityComplaints.status }).from(qualityComplaints).where(eq(qualityComplaints.id, id));
        return r ? { label: `Complaint ${r.no}`, closed: r.status === 'closed' } : null;
      }
      case 'audit': {
        const [r] = await tx.select({ no: qualityAudits.auditNo, name: qualityAudits.checklistName }).from(qualityAudits).where(eq(qualityAudits.id, id));
        return r ? { label: `Audit ${r.no} (${r.name})`, closed: false } : null;
      }
      case 'hai': {
        const [r] = await tx.select({ no: qualityHaiCases.caseNo }).from(qualityHaiCases).where(eq(qualityHaiCases.id, id));
        return r ? { label: `Infection case ${r.no}`, closed: false } : null;
      }
      default:
        return null;
    }
  }

  private async detail(tx: Tx, row: CapaRow): Promise<Q.Capa> {
    const people = await this.repo.people(tx, [row.ownerId, row.verifiedBy]);
    const src = row.sourceId ? await this.source(tx, row.sourceType as Q.CapaSource, row.sourceId) : null;
    return {
      ...capaSummary(row, people),
      problem: row.problem,
      rootCause: row.rootCause,
      correctiveAction: row.correctiveAction,
      preventiveAction: row.preventiveAction,
      completionNote: row.completionNote,
      completedAt: isoOrNull(row.completedAt),
      effectivenessNote: row.effectivenessNote,
      verifiedAt: isoOrNull(row.verifiedAt),
      verifiedBy: row.verifiedBy ? (people.get(row.verifiedBy) ?? null) : null,
      sourceLabel: src?.label ?? null,
      activity: await this.repo.activities(tx, 'capa', row.id),
      createdAt: iso(row.createdAt),
    };
  }
}
