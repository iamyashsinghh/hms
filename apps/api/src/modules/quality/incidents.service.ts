import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, formatSeries, iso, nextCounter, qualityCapas, qualityIncidents, sql, type Tx } from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { QualityRepository } from './quality.repository';
import { assertTransition, capaSummary, isoOrNull, requireNote } from './quality.util';

type Row = typeof qualityIncidents.$inferSelect;
type IncidentQuery = z.output<typeof Q.incidentQuerySchema>;

const OPEN_CAPA = sql<number>`(select count(*)::int from ${qualityCapas} c
  where c.tenant_id = ${qualityIncidents.tenantId} and c.source_type = 'incident' and c.source_id = ${qualityIncidents.id}
    and c.status in ('open', 'in_progress', 'completed'))`;

@Injectable()
export class IncidentsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Any staff member can report. An anonymous report is written without the reporter's identity
   * anywhere: not on the row, not in the activity trail and not in the audit log (the transaction
   * runs without app.user_id).
   */
  report(input: z.output<typeof Q.reportIncidentSchema>): Promise<Q.Incident> {
    const ctx = currentContext()!;
    const anonymous = input.anonymous;
    const scope = { tenantId: ctx.tenantId!, facilityId: ctx.facilityId ?? null, userId: anonymous ? undefined : ctx.userId };
    return this.db.asTenant(scope, async (tx) => {
      if (input.patientId && !(await this.repo.patientExists(tx, input.patientId))) throw notFound('Patient');
      const incidentNo = formatSeries('IR', await nextCounter(tx, 'quality.incident'));
      const [row] = await tx
        .insert(qualityIncidents)
        .values({
          tenantId: ctx.tenantId!,
          incidentNo,
          facilityId: ctx.facilityId ?? null,
          kind: input.kind,
          category: input.category,
          severity: input.severity,
          occurredAt: input.occurredAt,
          location: input.location || null,
          department: input.department || null,
          patientId: input.patientId ?? null,
          description: input.description,
          immediateAction: input.immediateAction || null,
          isAnonymous: anonymous,
          reportedBy: anonymous ? null : ctx.userId!,
          createdBy: anonymous ? null : ctx.userId!,
          updatedBy: anonymous ? null : ctx.userId!,
        })
        .returning();
      await this.repo.addActivity(tx, 'incident', row!.id, 'reported', { to: 'reported', anonymous });
      const event: Q.IncidentReportedEvent = {
        incidentId: row!.id,
        incidentNo,
        facilityId: row!.facilityId,
        kind: input.kind,
        category: input.category,
        severity: input.severity,
        patientId: row!.patientId,
      };
      await this.outbox.publish(tx, 'quality.incident.reported', { ...event }, ctx.tenantId);
      return this.detail(tx, row!, false);
    });
  }

  list(q: IncidentQuery): Promise<Paginated<Q.IncidentSummary>> {
    return this.db.tx((tx) => this.search(tx, q, undefined));
  }

  /** The caller's own (non-anonymous) reports, with status, so reporters see their reports being handled. */
  mine(q: IncidentQuery): Promise<Paginated<Q.IncidentSummary>> {
    return this.db.tx((tx) => this.search(tx, q, currentContext()!.userId!));
  }

  get(id: string): Promise<Q.Incident> {
    return this.db.tx(async (tx) => {
      const ctx = currentContext()!;
      const row = await this.find(tx, id);
      // Reporters without incident.read may open their own report (read-only view).
      if (!ctx.permissions.has('quality.incident.read') && row.reportedBy !== ctx.userId) throw notFound('Incident');
      return this.detail(tx, row, true);
    });
  }

  review(id: string, input: z.output<typeof Q.reviewIncidentSchema>): Promise<Q.Incident> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id, true);
      if (row.status === 'closed' || row.status === 'rejected') throw conflict('incident_closed', `${row.incidentNo} is ${row.status}`);
      const to = input.status ?? (row.status as Q.IncidentStatus);
      assertTransition('Incident', Q.INCIDENT_TRANSITIONS, row.status as Q.IncidentStatus, to);
      if (input.assignedTo && !(await this.repo.userExists(tx, input.assignedTo))) throw notFound('Staff member');

      const patch: Partial<typeof qualityIncidents.$inferInsert> = { updatedBy: ctx.userId };
      if (input.assignedTo !== undefined) patch.assignedTo = input.assignedTo;
      if (input.severity) patch.severity = input.severity;
      if (input.kind) patch.kind = input.kind;
      if (input.category) patch.category = input.category;
      if (input.rootCause !== undefined) patch.rootCause = input.rootCause || null;
      if (input.contributingFactors) patch.contributingFactors = input.contributingFactors;

      if (to !== row.status) {
        patch.status = to;
        if (to === 'action_planned') {
          const [{ n }] = (await tx
            .select({ n: count() })
            .from(qualityCapas)
            .where(and(eq(qualityCapas.sourceType, 'incident'), eq(qualityCapas.sourceId, id)))) as [{ n: number }];
          if (!n) throw conflict('capa_required', 'Add at least one corrective/preventive action first');
        }
        if (to === 'closed' || to === 'rejected') {
          requireNote(input.note, to === 'closed' ? 'Write a closure note' : 'Say why this is not an incident');
          if (to === 'closed') {
            if (!(input.rootCause ?? row.rootCause) && row.kind !== 'near_miss') {
              throw badRequest('root_cause_required', 'Record the root cause before closing');
            }
            const [{ n }] = (await tx
              .select({ n: count() })
              .from(qualityCapas)
              .where(
                and(
                  eq(qualityCapas.sourceType, 'incident'),
                  eq(qualityCapas.sourceId, id),
                  sql`${qualityCapas.status} in ('open', 'in_progress', 'completed')`,
                ),
              )) as [{ n: number }];
            if (n) throw conflict('open_capa', `${n} action(s) are still open or not yet verified`);
          }
          patch.closureNote = input.note!;
          patch.closedAt = new Date().toISOString();
          patch.closedBy = ctx.userId ?? null;
        }
      }
      const [updated] = await tx.update(qualityIncidents).set(patch).where(eq(qualityIncidents.id, id)).returning();
      if (to !== row.status) {
        await this.repo.addActivity(tx, 'incident', id, 'status', { from: row.status, to, note: input.note });
        if (to === 'closed' || to === 'rejected') {
          const event: Q.IncidentClosedEvent = { incidentId: id, incidentNo: row.incidentNo, status: to };
          await this.outbox.publish(tx, 'quality.incident.closed', { ...event });
        }
      } else if (input.note) {
        await this.repo.addActivity(tx, 'incident', id, 'note', { note: input.note });
      } else if (input.assignedTo !== undefined && input.assignedTo !== row.assignedTo) {
        await this.repo.addActivity(tx, 'incident', id, 'assigned');
      }
      return this.detail(tx, updated!, true);
    });
  }

  // ---------- internals ----------

  private async find(tx: Tx, id: string, lock = false): Promise<Row> {
    const qb = tx.select().from(qualityIncidents).where(eq(qualityIncidents.id, id)).limit(1);
    const [row] = lock ? await qb.for('update') : await qb;
    if (!row) throw notFound('Incident');
    return row;
  }

  private async search(tx: Tx, q: IncidentQuery, reporter: string | undefined): Promise<Paginated<Q.IncidentSummary>> {
    const ctx = currentContext()!;
    const t = qualityIncidents;
    const where = and(
      reporter ? eq(t.reportedBy, reporter) : undefined,
      ctx.facilityId && !reporter ? sql`(${t.facilityId} = ${ctx.facilityId} or ${t.facilityId} is null)` : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.kind ? eq(t.kind, q.kind) : undefined,
      q.category ? eq(t.category, q.category) : undefined,
      q.severity ? eq(t.severity, q.severity) : undefined,
      q.from ? sql`(${t.occurredAt} at time zone 'Asia/Kolkata')::date >= ${q.from}` : undefined,
      q.to ? sql`(${t.occurredAt} at time zone 'Asia/Kolkata')::date <= ${q.to}` : undefined,
      q.q
        ? sql`(${t.incidentNo} = upper(${q.q}) or ${t.description} ilike ${'%' + q.q + '%'} or ${t.location} ilike ${'%' + q.q + '%'})`
        : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select({ row: t, openCapas: OPEN_CAPA })
        .from(t)
        .where(where)
        .orderBy(desc(t.occurredAt), desc(t.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      tx.select({ total: count() }).from(t).where(where),
    ]);
    const people = await this.repo.people(tx, rows.flatMap((r) => [r.row.reportedBy, r.row.assignedTo]));
    const pts = await this.repo.patientRefs(tx, rows.map((r) => r.row.patientId));
    return { items: rows.map((r) => summary(r.row, Number(r.openCapas), people, pts)), page: q.page, pageSize: q.pageSize, total };
  }

  private async detail(tx: Tx, row: Row, withCapas: boolean): Promise<Q.Incident> {
    const capas = withCapas ? await this.repo.capasFor(tx, 'incident', [row.id]) : [];
    const people = await this.repo.people(tx, [row.reportedBy, row.assignedTo, ...capas.map((c) => c.ownerId)]);
    const pts = await this.repo.patientRefs(tx, [row.patientId]);
    const open = capas.filter((c) => ['open', 'in_progress', 'completed'].includes(c.status)).length;
    return {
      ...summary(row, open, people, pts),
      facilityId: row.facilityId,
      description: row.description,
      immediateAction: row.immediateAction,
      rootCause: row.rootCause,
      contributingFactors: row.contributingFactors,
      closureNote: row.closureNote,
      closedAt: isoOrNull(row.closedAt),
      capas: capas.map((c) => capaSummary(c, people)),
      activity: await this.repo.activities(tx, 'incident', row.id),
    };
  }
}

function summary(r: Row, openCapas: number, people: Map<string, Q.Person>, pts: Map<string, Q.PatientRef>): Q.IncidentSummary {
  return {
    id: r.id,
    incidentNo: r.incidentNo,
    kind: r.kind as Q.IncidentKind,
    category: r.category as Q.IncidentCategory,
    severity: r.severity as Q.IncidentSeverity,
    status: r.status as Q.IncidentStatus,
    occurredAt: iso(r.occurredAt),
    reportedAt: iso(r.reportedAt),
    location: r.location,
    department: r.department,
    patient: r.patientId ? (pts.get(r.patientId) ?? null) : null,
    isAnonymous: r.isAnonymous,
    reportedBy: r.reportedBy ? (people.get(r.reportedBy) ?? null) : null,
    assignedTo: r.assignedTo ? (people.get(r.assignedTo) ?? null) : null,
    openCapas,
  };
}
