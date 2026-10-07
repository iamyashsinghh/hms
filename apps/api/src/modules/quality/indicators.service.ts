import { Injectable } from '@nestjs/common';
import {
  and,
  eq,
  qualityAudits,
  qualityCapas,
  qualityCensus,
  qualityComplaints,
  qualityDocuments,
  qualityEventFacts,
  qualityHaiCases,
  qualityIncidents,
  qualityIndicatorValues,
  sql,
  type Tx,
} from '@hms/db';
import { quality as Q } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, notFound } from '../../common/errors/errors';
import type { EventEnvelope } from '../../common/events/event-bus';
import { currentPeriod, istDate, periodRange, periodsBack } from './quality.util';

type Counts = Map<string, { num: number; den: number | null; note?: string | null }>;

/** Topics quality counts. Each consumed event becomes one row in quality.event_facts keyed by the event id. */
export const FACT_TOPICS = {
  opdVisit: 'frontoffice.visit.checked_in',
  prescription: 'emr.prescription.created',
} as const;

const n = (v: unknown) => Number(v ?? 0);

/**
 * NABH indicators for a month. Computed ones come from quality's own records plus event facts
 * (OPD check-ins, prescriptions); manual ones from monthly values entered by the quality team.
 * With a facility selected, figures are for that facility; facts without a facility
 * (prescriptions carry none) count for every facility.
 */
@Injectable()
export class IndicatorsService {
  constructor(private readonly db: DbService) {}

  list(q: z.output<typeof Q.indicatorQuerySchema>): Promise<Q.IndicatorResult[]> {
    const period = q.period ?? currentPeriod();
    return this.db.tx((tx) => this.compute(tx, period));
  }

  trend(code: string, months: number, to?: string): Promise<Q.IndicatorResult[]> {
    if (!Q.INDICATORS.some((d) => d.code === code)) throw notFound('Indicator');
    return this.db.tx(async (tx) => {
      const out: Q.IndicatorResult[] = [];
      for (const p of periodsBack(to ?? currentPeriod(), months)) out.push((await this.compute(tx, p, code)).find((r) => r.code === code)!);
      return out;
    });
  }

  saveValue(code: string, input: z.output<typeof Q.indicatorValueInputSchema>): Promise<Q.IndicatorResult> {
    const ctx = currentContext()!;
    const def = Q.INDICATORS.find((d) => d.code === code);
    if (!def) throw notFound('Indicator');
    if (def.source !== 'manual') throw badRequest('computed_indicator', `${def.name} is calculated automatically`);
    if (!ctx.facilityId) throw badRequest('facility_required', 'Pick a facility first');
    if (input.period > currentPeriod()) throw badRequest('future_period', 'Cannot enter values for a future month');
    if (def.denominator && input.denominator === undefined) throw badRequest('denominator_required', `Enter ${def.denominator.toLowerCase()}`);
    const values = {
      numerator: input.numerator.toFixed(2),
      denominator: input.denominator === undefined ? null : input.denominator.toFixed(2),
      note: input.note || null,
      updatedBy: ctx.userId,
    };
    return this.db.tx(async (tx) => {
      await tx
        .insert(qualityIndicatorValues)
        .values({ tenantId: ctx.tenantId!, facilityId: ctx.facilityId!, indicatorCode: code, period: input.period, ...values, createdBy: ctx.userId })
        .onConflictDoUpdate({
          target: [qualityIndicatorValues.tenantId, qualityIndicatorValues.facilityId, qualityIndicatorValues.indicatorCode, qualityIndicatorValues.period],
          set: values,
        });
      return (await this.compute(tx, input.period, code)).find((r) => r.code === code)!;
    });
  }

  dashboard(period?: string): Promise<Q.QualityDashboard> {
    const p = period ?? currentPeriod();
    const { start, end } = periodRange(p);
    const fac = facilityFilter();
    const today = istDate();
    return this.db.tx(async (tx) => {
      const i = qualityIncidents;
      const [inc] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where status in ('reported', 'under_review', 'action_planned')) as open,
          count(*) filter (where ${inPeriod(i.occurredAt, start, end)} and status <> 'rejected') as month,
          count(*) filter (where ${inPeriod(i.occurredAt, start, end)} and status <> 'rejected' and kind = 'sentinel_event') as sentinel
          from ${i} where ${fac(i.facilityId)}`)
      ).rows;
      const byCat = (
        await tx.execute<{ category: Q.IncidentCategory; count: string }>(sql`select category, count(*) as count from ${i}
          where ${fac(i.facilityId)} and status <> 'rejected' and ${inPeriod(i.occurredAt, start, end)}
          group by category order by count(*) desc, category`)
      ).rows;
      const c = qualityComplaints;
      const [cmp] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where status in ('open', 'in_progress')) as open,
          count(*) filter (where status in ('open', 'in_progress') and due_at < now()) as overdue
          from ${c} where ${fac(c.facilityId)}`)
      ).rows;
      const k = qualityCapas;
      const [capa] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where status in ('open', 'in_progress', 'completed')) as open,
          count(*) filter (where status in ('open', 'in_progress') and due_date < ${today}) as overdue
          from ${k} where ${fac(k.facilityId)}`)
      ).rows;
      const a = qualityAudits;
      const [aud] = (
        await tx.execute<Record<string, string>>(sql`select count(*) as due from ${a}
          where ${fac(a.facilityId)} and status = 'scheduled' and scheduled_on <= ${today}`)
      ).rows;
      const d = qualityDocuments;
      const [docs] = (
        await tx.execute<Record<string, string>>(sql`select count(*) as due from ${d}
          where status = 'approved' and review_due <= ${today}::date + 30`)
      ).rows;
      return {
        period: p,
        openIncidents: n(inc?.open),
        incidentsThisMonth: n(inc?.month),
        sentinelThisMonth: n(inc?.sentinel),
        openComplaints: n(cmp?.open),
        overdueComplaints: n(cmp?.overdue),
        openCapas: n(capa?.open),
        overdueCapas: n(capa?.overdue),
        auditsDue: n(aud?.due),
        documentsDueForReview: n(docs?.due),
        incidentsByCategory: byCat.map((r) => ({ category: r.category, count: n(r.count) })),
        indicators: await this.compute(tx, p),
      };
    });
  }

  // ---------- event facts (worker) ----------

  /** Records one consumed event. The event id is the primary key, so redelivery is a no-op. */
  async recordFact(e: EventEnvelope<{ facilityId?: string | null }>): Promise<void> {
    await this.db.asTenant({ tenantId: e.tenantId }, (tx) =>
      tx
        .insert(qualityEventFacts)
        .values({ tenantId: e.tenantId, id: e.id, topic: e.topic, facilityId: e.payload.facilityId ?? null, day: istDate(e.createdAt) })
        .onConflictDoNothing(),
    );
  }

  // ---------- computation ----------

  private async compute(tx: Tx, period: string, only?: string): Promise<Q.IndicatorResult[]> {
    const { start, end } = periodRange(period);
    const fac = facilityFilter();
    const counts: Counts = new Map();
    const set = (code: string, num: unknown, den: unknown) => counts.set(code, { num: n(num), den: den == null ? null : n(den) });
    const want = (...codes: string[]) => !only || codes.includes(only);

    const facts = async () => {
      const f = qualityEventFacts;
      const facilityId = currentContext()?.facilityId;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where topic = ${FACT_TOPICS.prescription}) as rx,
          count(*) filter (where topic = ${FACT_TOPICS.opdVisit}) as opd
          from ${f} where day >= ${start} and day < ${end}
          ${facilityId ? sql`and (facility_id = ${facilityId} or facility_id is null)` : sql``}`)
      ).rows;
      return { rx: n(r?.rx), opd: n(r?.opd) };
    };
    // Per facility-day: IPD rows (if any) give patient and device days, otherwise the manual rows do.
    // Surgeries always come from every row (IPD sends none until an OT module exists).
    const census = async () => {
      const c = qualityCensus;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`with rows as (
            select *, bool_or(source = 'ipd') over (partition by facility_id, day) as has_ipd
              from ${c} where ${fac(c.facilityId, false)} and day >= ${start} and day < ${end})
          select
            coalesce(sum(patient_days) filter (where source = 'ipd' or not has_ipd), 0) as pd,
            coalesce(sum(catheter_days) filter (where source = 'ipd' or not has_ipd), 0) as cd,
            coalesce(sum(central_line_days) filter (where source = 'ipd' or not has_ipd), 0) as cl,
            coalesce(sum(ventilator_days) filter (where source = 'ipd' or not has_ipd), 0) as vd,
            coalesce(sum(surgeries), 0) as su
          from rows`)
      ).rows;
      return { pd: n(r?.pd), cd: n(r?.cd), cl: n(r?.cl), vd: n(r?.vd), su: n(r?.su) };
    };

    if (want('PSQ-ME', 'PSQ-ADR', 'PSQ-FALL', 'PSQ-NSI', 'PSQ-SENT', 'PSQ-NM', 'PSQ-IR24', 'PRE-CMP')) {
      const i = qualityIncidents;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where category = 'medication_error') as me,
          count(*) filter (where category = 'adverse_drug_reaction') as adr,
          count(*) filter (where category = 'patient_fall') as fall,
          count(*) filter (where category = 'needle_stick_injury') as nsi,
          count(*) filter (where kind = 'sentinel_event') as sent,
          count(*) filter (where kind = 'near_miss') as nm,
          count(*) filter (where reported_at - occurred_at <= interval '24 hours') as r24,
          count(*) as total
          from ${i} where ${fac(i.facilityId)} and status <> 'rejected' and ${inPeriod(i.occurredAt, start, end)}`)
      ).rows;
      const { rx, opd } = await facts();
      const { pd } = await census();
      set('PSQ-ME', r?.me, rx);
      set('PSQ-ADR', r?.adr, rx);
      set('PSQ-FALL', r?.fall, pd);
      set('PSQ-NSI', r?.nsi, null);
      set('PSQ-SENT', r?.sent, null);
      set('PSQ-NM', r?.nm, null);
      set('PSQ-IR24', r?.r24, r?.total);
      if (want('PRE-CMP')) {
        const c = qualityComplaints;
        const [cm] = (await tx.execute<Record<string, string>>(sql`select count(*) as n from ${c} where ${fac(c.facilityId)} and ${inPeriod(c.createdAt, start, end)}`)).rows;
        set('PRE-CMP', cm?.n, opd);
      }
    }
    if (want('HIC-CAUTI', 'HIC-CLABSI', 'HIC-VAP', 'HIC-SSI')) {
      const h = qualityHaiCases;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select
          count(*) filter (where infection_type = 'cauti') as cauti,
          count(*) filter (where infection_type = 'clabsi') as clabsi,
          count(*) filter (where infection_type = 'vap') as vap,
          count(*) filter (where infection_type = 'ssi') as ssi
          from ${h} where ${fac(h.facilityId)} and status = 'confirmed' and onset_date >= ${start} and onset_date < ${end}`)
      ).rows;
      const c = await census();
      set('HIC-CAUTI', r?.cauti, c.cd);
      set('HIC-CLABSI', r?.clabsi, c.cl);
      set('HIC-VAP', r?.vap, c.vd);
      set('HIC-SSI', r?.ssi, c.su);
    }
    if (want('HIC-HH', 'PSQ-AUD')) {
      const a = qualityAudits;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select
          coalesce(sum(score) filter (where category = 'hand_hygiene'), 0) as hh_sum, count(*) filter (where category = 'hand_hygiene') as hh_n,
          coalesce(sum(score), 0) as all_sum, count(*) as all_n
          from ${a} where ${fac(a.facilityId)} and status = 'completed' and ${inPeriod(a.conductedAt, start, end)}`)
      ).rows;
      set('HIC-HH', r?.hh_sum, r?.hh_n);
      set('PSQ-AUD', r?.all_sum, r?.all_n);
    }
    if (want('PSQ-CAPA')) {
      const k = qualityCapas;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select count(*) as due,
          count(*) filter (where status in ('completed', 'verified') and (completed_at at time zone 'Asia/Kolkata')::date <= due_date) as on_time
          from ${k} where ${fac(k.facilityId)} and status <> 'cancelled' and due_date >= ${start} and due_date < ${end}`)
      ).rows;
      set('PSQ-CAPA', r?.on_time, r?.due);
    }
    if (want('PRE-TAT')) {
      const c = qualityComplaints;
      const [r] = (
        await tx.execute<Record<string, string>>(sql`select count(*) as due,
          count(*) filter (where resolved_at is not null and resolved_at <= due_at) as ok
          from ${c} where ${fac(c.facilityId)} and ${inPeriod(c.dueAt, start, end)} and (due_at <= now() or resolved_at is not null)`)
      ).rows;
      set('PRE-TAT', r?.ok, r?.due);
    }
    const manual = Q.INDICATORS.filter((d) => d.source === 'manual' && want(d.code)).map((d) => d.code);
    if (manual.length) {
      const v = qualityIndicatorValues;
      const facilityId = currentContext()?.facilityId;
      const rows = await tx
        .select({
          code: v.indicatorCode,
          num: sql<string>`sum(${v.numerator})`,
          den: sql<string | null>`sum(${v.denominator})`,
          note: sql<string | null>`string_agg(${v.note}, '; ')`,
        })
        .from(v)
        .where(and(eq(v.period, period), facilityId ? eq(v.facilityId, facilityId) : undefined))
        .groupBy(v.indicatorCode);
      for (const r of rows) counts.set(r.code, { num: n(r.num), den: r.den == null ? null : n(r.den), note: r.note });
    }

    return Q.INDICATORS.filter((d) => want(d.code)).map((d) => result(d, period, counts.get(d.code)));
  }
}

function result(d: Q.IndicatorDef, period: string, c: { num: number; den: number | null; note?: string | null } | undefined): Q.IndicatorResult {
  let value: number | null = null;
  if (c) {
    if (!d.denominator) value = c.num;
    else if (c.den) value = Math.round((c.num / c.den) * d.multiplier * 100) / 100;
  }
  const status: Q.IndicatorResult['status'] =
    value == null ? 'no_data' : d.target == null ? 'no_target' : (d.lowerIsBetter ? value <= d.target : value >= d.target) ? 'met' : 'missed';
  return {
    code: d.code,
    name: d.name,
    chapter: d.chapter,
    unit: d.unit,
    source: d.source,
    period,
    numerator: c ? c.num : null,
    denominator: c?.den ?? null,
    value,
    target: d.target,
    status,
    numeratorLabel: d.numerator,
    denominatorLabel: d.denominator,
    note: c?.note ?? null,
  };
}

const inPeriod = (col: unknown, start: string, end: string) =>
  sql`(${col} at time zone 'Asia/Kolkata') >= ${start}::date and (${col} at time zone 'Asia/Kolkata') < ${end}::date`;

/** Facility scope for the caller: rows of the selected facility (and, optionally, rows with none). */
function facilityFilter() {
  const facilityId = currentContext()?.facilityId;
  return (col: unknown, includeUnassigned = true) =>
    facilityId ? (includeUnassigned ? sql`(${col} = ${facilityId} or ${col} is null)` : sql`${col} = ${facilityId}`) : sql`true`;
}
