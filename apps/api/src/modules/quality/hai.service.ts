import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, formatSeries, iso, nextCounter, qualityCensus, qualityHaiCases, sql, type Tx } from '@hms/db';
import { quality as Q, type Paginated } from '@hms/shared';
import type { z } from 'zod';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { badRequest, notFound } from '../../common/errors/errors';
import type { EventEnvelope } from '../../common/events/event-bus';
import { QualityRepository } from './quality.repository';
import { istDate } from './quality.util';

type Row = typeof qualityHaiCases.$inferSelect;

export const IPD_CENSUS_TOPIC = 'ipd.census.daily';

/**
 * Payload of `ipd.census.daily` (one event per facility per India date). Mirrors ipd.CensusDailyEvent
 * in @hms/shared; kept structural here so quality does not depend on the IPD module being merged.
 */
export interface IpdCensusDaily {
  facilityId: string;
  date: string;
  wards: {
    wardId: string;
    wardName: string;
    wardType?: string;
    patientDays: number;
    catheterDays: number;
    centralLineDays: number;
    ventilatorDays: number;
    admissions?: number;
    discharges?: number;
    surgeries: number | null;
  }[];
}

/** Hospital-acquired infection surveillance and the daily census that gives the denominators. */
@Injectable()
export class HaiService {
  constructor(
    private readonly db: DbService,
    private readonly repo: QualityRepository,
  ) {}

  create(input: z.output<typeof Q.createHaiSchema>): Promise<Q.HaiCase> {
    const ctx = currentContext()!;
    checkDates(input);
    return this.db.tx(async (tx) => {
      if (!(await this.repo.patientExists(tx, input.patientId))) throw notFound('Patient');
      const caseNo = formatSeries('HAI', await nextCounter(tx, 'quality.hai'), 5);
      const [row] = await tx
        .insert(qualityHaiCases)
        .values({
          tenantId: ctx.tenantId!,
          caseNo,
          facilityId: ctx.facilityId ?? null,
          patientId: input.patientId,
          infectionType: input.infectionType,
          ward: input.ward || null,
          onsetDate: input.onsetDate,
          deviceInsertedOn: input.deviceInsertedOn ?? null,
          procedureName: input.procedureName || null,
          organism: input.organism || null,
          cultureRef: input.cultureRef || null,
          status: input.status,
          notes: input.notes || null,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .returning();
      await this.repo.addActivity(tx, 'hai', row!.id, 'recorded', { to: input.status });
      return this.dto(tx, row!);
    });
  }

  update(id: string, input: z.output<typeof Q.updateHaiSchema>): Promise<Q.HaiCase> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.find(tx, id);
      const deviceInsertedOn = input.deviceInsertedOn === undefined ? row.deviceInsertedOn : input.deviceInsertedOn || null;
      checkDates({ onsetDate: input.onsetDate ?? row.onsetDate, deviceInsertedOn });
      const patch: Partial<typeof qualityHaiCases.$inferInsert> = { updatedBy: ctx.userId };
      for (const k of ['infectionType', 'onsetDate', 'status'] as const) if (input[k] !== undefined) patch[k] = input[k];
      for (const k of ['ward', 'deviceInsertedOn', 'procedureName', 'organism', 'cultureRef', 'notes'] as const) {
        if (input[k] !== undefined) patch[k] = input[k] || null;
      }
      const [updated] = await tx.update(qualityHaiCases).set(patch).where(eq(qualityHaiCases.id, id)).returning();
      if (input.status && input.status !== row.status) {
        await this.repo.addActivity(tx, 'hai', id, 'status', { from: row.status, to: input.status });
      }
      return this.dto(tx, updated!);
    });
  }

  get(id: string): Promise<Q.HaiCase> {
    return this.db.tx(async (tx) => this.dto(tx, await this.find(tx, id)));
  }

  list(q: z.output<typeof Q.haiQuerySchema>): Promise<Paginated<Q.HaiCase>> {
    const ctx = currentContext()!;
    const t = qualityHaiCases;
    const where = and(
      ctx.facilityId ? sql`(${t.facilityId} = ${ctx.facilityId} or ${t.facilityId} is null)` : undefined,
      q.infectionType ? eq(t.infectionType, q.infectionType) : undefined,
      q.status ? eq(t.status, q.status) : undefined,
      q.from ? sql`${t.onsetDate} >= ${q.from}` : undefined,
      q.to ? sql`${t.onsetDate} <= ${q.to}` : undefined,
    );
    return this.db.tx(async (tx) => {
      const [rows, [{ total }]] = await Promise.all([
        tx.select().from(t).where(where).orderBy(desc(t.onsetDate), desc(t.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ total: count() }).from(t).where(where),
      ]);
      const pts = await this.repo.patientRefs(tx, rows.map((r) => r.patientId));
      return { items: rows.map((r) => toDto(r, pts)), page: q.page, pageSize: q.pageSize, total };
    });
  }

  // ---------- census ----------

  /** Upsert one ward-day of census and device days for the current facility. */
  saveCensus(input: z.output<typeof Q.censusInputSchema>): Promise<Q.CensusDay> {
    const ctx = currentContext()!;
    if (!ctx.facilityId) throw badRequest('facility_required', 'Pick a facility first');
    if (input.day > istDate()) throw badRequest('future_date', 'Census cannot be entered for a future date');
    // A ward-day IPD already reported keeps IPD's patient and device days; only surgeries can be added by hand.
    const keepIpd = (col: unknown, value: number) => sql`case when ${qualityCensus.source} = 'ipd' then ${col} else ${value} end`;
    return this.db.tx(async (tx) => {
      const [row] = await tx
        .insert(qualityCensus)
        .values({
          tenantId: ctx.tenantId!,
          facilityId: ctx.facilityId!,
          day: input.day,
          ward: input.ward,
          patientDays: input.patientDays,
          catheterDays: input.catheterDays,
          centralLineDays: input.centralLineDays,
          ventilatorDays: input.ventilatorDays,
          surgeries: input.surgeries,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        })
        .onConflictDoUpdate({
          target: [qualityCensus.tenantId, qualityCensus.facilityId, qualityCensus.day, qualityCensus.ward],
          set: {
            patientDays: keepIpd(qualityCensus.patientDays, input.patientDays),
            catheterDays: keepIpd(qualityCensus.catheterDays, input.catheterDays),
            centralLineDays: keepIpd(qualityCensus.centralLineDays, input.centralLineDays),
            ventilatorDays: keepIpd(qualityCensus.ventilatorDays, input.ventilatorDays),
            surgeries: input.surgeries,
            updatedBy: ctx.userId,
          },
        })
        .returning();
      return censusDto(row!);
    });
  }

  /**
   * Writes IPD's daily census into quality.census, one row per ward (source 'ipd'). Upserting by
   * facility, day and ward makes redelivery a no-op. Surgeries arrive as null until an OT module
   * exists; then a value entered by hand for that ward-day is kept.
   */
  async recordIpdCensus(e: EventEnvelope<IpdCensusDaily>): Promise<void> {
    const { facilityId, date, wards } = e.payload;
    if (!facilityId || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Array.isArray(wards)) return;
    await this.db.asTenant({ tenantId: e.tenantId, facilityId }, async (tx) => {
      for (const w of wards) {
        const values = {
          wardId: w.wardId,
          source: 'ipd',
          patientDays: int(w.patientDays),
          catheterDays: int(w.catheterDays),
          centralLineDays: int(w.centralLineDays),
          ventilatorDays: int(w.ventilatorDays),
        };
        await tx
          .insert(qualityCensus)
          .values({ tenantId: e.tenantId, facilityId, day: date, ward: w.wardName, ...values, surgeries: w.surgeries == null ? 0 : int(w.surgeries) })
          .onConflictDoUpdate({
            target: [qualityCensus.tenantId, qualityCensus.facilityId, qualityCensus.day, qualityCensus.ward],
            set: w.surgeries == null ? values : { ...values, surgeries: int(w.surgeries) },
          });
      }
    });
  }

  listCensus(from: string, to: string): Promise<Q.CensusDay[]> {
    const ctx = currentContext()!;
    const t = qualityCensus;
    return this.db.tx(async (tx) => {
      const rows = await tx
        .select()
        .from(t)
        .where(and(ctx.facilityId ? eq(t.facilityId, ctx.facilityId) : undefined, sql`${t.day} between ${from} and ${to}`))
        .orderBy(desc(t.day), asc(t.ward));
      return rows.map(censusDto);
    });
  }

  private async find(tx: Tx, id: string): Promise<Row> {
    const [row] = await tx.select().from(qualityHaiCases).where(eq(qualityHaiCases.id, id)).limit(1);
    if (!row) throw notFound('Infection case');
    return row;
  }

  private async dto(tx: Tx, row: Row): Promise<Q.HaiCase> {
    return toDto(row, await this.repo.patientRefs(tx, [row.patientId]));
  }
}

function checkDates(v: { onsetDate: string; deviceInsertedOn?: string | null }) {
  if (v.onsetDate > istDate()) throw badRequest('future_date', 'Onset date cannot be in the future');
  if (v.deviceInsertedOn && v.deviceInsertedOn > v.onsetDate) {
    throw badRequest('invalid_dates', 'Device insertion date must be on or before the onset date');
  }
}

function toDto(r: Row, pts: Map<string, Q.PatientRef>): Q.HaiCase {
  return {
    id: r.id,
    caseNo: r.caseNo,
    patient: pts.get(r.patientId) ?? { id: r.patientId, uhid: '', name: '' },
    infectionType: r.infectionType as Q.HaiType,
    ward: r.ward,
    onsetDate: r.onsetDate,
    deviceInsertedOn: r.deviceInsertedOn,
    procedureName: r.procedureName,
    organism: r.organism,
    cultureRef: r.cultureRef,
    status: r.status as Q.HaiStatus,
    notes: r.notes,
    createdAt: iso(r.createdAt),
  };
}

const int = (v: unknown) => Math.max(0, Math.trunc(Number(v) || 0));

const censusDto = (r: typeof qualityCensus.$inferSelect): Q.CensusDay => ({
  id: r.id,
  day: r.day,
  ward: r.ward,
  source: r.source as Q.CensusDay['source'],
  patientDays: r.patientDays,
  catheterDays: r.catheterDays,
  centralLineDays: r.centralLineDays,
  ventilatorDays: r.ventilatorDays,
  surgeries: r.surgeries,
});
