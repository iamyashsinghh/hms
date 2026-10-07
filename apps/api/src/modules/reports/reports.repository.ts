import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@hms/db';
import type { SQL } from 'drizzle-orm';
import type { reports } from '@hms/shared';

type DoctorStat = reports.DoctorStat & Record<string, unknown>;
type ModeTotal = reports.ModeTotal & Record<string, unknown>;
type ServiceStat = reports.ServiceStat & Record<string, unknown>;

/**
 * Which facilities a report covers.
 * - `null`: the whole hospital (facts with no facility are included)
 * - list: only those facilities (facts with no facility are excluded)
 */
export type FacilityScope = string[] | null;

/** A hospital-local date range [from, to], both inclusive, as YYYY-MM-DD. */
export interface Range {
  from: string;
  to: string;
  tz: string;
}

const DEFAULT_TZ = 'Asia/Kolkata';

/** Runs queries one after another: a transaction has one connection, so parallel queries only queue (and pg 9 rejects them). */
export async function inOrder<T extends readonly unknown[]>(...fns: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const out: unknown[] = [];
  for (const fn of fns) out.push(await fn());
  return out as unknown as T;
}

/** Read-only SQL over reporting.* facts plus the core patient/user tables. Always called inside DbService.tx(). */
@Injectable()
export class ReportsRepository {
  async timezone(tx: Tx): Promise<string> {
    const res = await tx.execute<{ tz: string | null }>(
      sql`select settings->>'timezone' as tz from platform.tenants where id = app.current_tenant_id()`,
    );
    const tz = res.rows[0]?.tz;
    if (tz) {
      const ok = await tx.execute(sql`select 1 from pg_timezone_names where name = ${tz}`);
      if (ok.rows.length) return tz;
    }
    return DEFAULT_TZ;
  }

  async today(tx: Tx, tz: string): Promise<string> {
    const res = await tx.execute<{ d: string }>(sql`select to_char((now() at time zone ${tz})::date, 'YYYY-MM-DD') as d`);
    return res.rows[0]!.d;
  }

  // ---------- headline numbers ----------

  async opdVisitCount(tx: Tx, r: Range, f: FacilityScope, doctorId?: string): Promise<number> {
    return this.scalar(
      tx,
      sql`select count(*)::int as n from reporting.opd_visits v
          where ${inRange(sql`v.checked_in_at`, r)} and ${facility(sql`v.facility_id`, f)}
            ${doctorId ? sql`and v.doctor_id = ${doctorId}` : sql``}`,
    );
  }

  async newPatientCount(tx: Tx, r: Range, f: FacilityScope): Promise<number> {
    return this.scalar(
      tx,
      sql`select count(*)::int as n from clinical.patients p
          where ${inRange(sql`p.created_at`, r)} and ${facility(sql`p.registered_facility_id`, f)}`,
    );
  }

  async billed(tx: Tx, r: Range, f: FacilityScope): Promise<number> {
    return this.scalar(
      tx,
      sql`select coalesce(round(sum(i.total), 2), 0)::float8 as n from reporting.invoices i
          where ${inRange(sql`i.finalized_at`, r)} and ${facility(sql`i.facility_id`, f)}`,
    );
  }

  async collections(tx: Tx, r: Range, f: FacilityScope): Promise<number> {
    return this.scalar(
      tx,
      sql`select coalesce(round(sum(p.amount), 2), 0)::float8 as n
          from reporting.payments p
          left join reporting.invoices i on i.tenant_id = p.tenant_id and i.invoice_id = p.invoice_id
          where ${inRange(sql`p.received_at`, r)} and ${facility(sql`coalesce(p.facility_id, i.facility_id)`, f)}`,
    );
  }

  async appointmentCounts(tx: Tx, r: Range, f: FacilityScope): Promise<{ booked: number; cancelled: number }> {
    const res = await tx.execute<{ booked: number; cancelled: number }>(
      sql`select count(*) filter (where a.status = 'booked')::int as booked,
                 count(*) filter (where a.status = 'cancelled')::int as cancelled
          from reporting.appointments a
          where ${inRange(sql`a.start_at`, r)} and ${facility(sql`a.facility_id`, f)}`,
    );
    return res.rows[0] ?? { booked: 0, cancelled: 0 };
  }

  /** Encounters carry no facility; with a facility filter they are matched through the doctor's visits that day. */
  async encountersSigned(tx: Tx, r: Range, f: FacilityScope): Promise<number> {
    return this.scalar(
      tx,
      f === null
        ? sql`select count(*)::int as n from reporting.encounters e where ${inRange(sql`e.signed_at`, r)}`
        : sql`select count(*)::int as n from reporting.encounters e
              where ${inRange(sql`e.signed_at`, r)}
                and exists (select 1 from reporting.opd_visits v
                            where v.tenant_id = e.tenant_id and v.patient_id = e.patient_id and v.doctor_id = e.doctor_id
                              and ${inRange(sql`v.checked_in_at`, r)} and ${facility(sql`v.facility_id`, f)})`,
    );
  }

  async pharmacyDispenses(tx: Tx, r: Range, f: FacilityScope): Promise<number> {
    return this.scalar(
      tx,
      sql`select count(*)::int as n from reporting.pharmacy_dispenses d
          left join reporting.invoices i on i.tenant_id = d.tenant_id and i.invoice_id = d.invoice_id
          where ${inRange(sql`d.dispensed_at`, r)} and ${facility(sql`i.facility_id`, f)}`,
    );
  }

  /** Finalized invoices with an unpaid balance as of the end of `r.to`. */
  async pending(tx: Tx, r: Range, f: FacilityScope): Promise<{ count: number; amount: number }> {
    const res = await tx.execute<{ count: number; amount: number }>(
      sql`with due as (
            select i.total - coalesce((select sum(p.amount) from reporting.payments p
                                        where p.tenant_id = i.tenant_id and p.invoice_id = i.invoice_id
                                          and p.received_at < ${endOf(r)}), 0) as balance
            from reporting.invoices i
            where i.finalized_at < ${endOf(r)} and ${facility(sql`i.facility_id`, f)})
          select count(*)::int as count, coalesce(round(sum(balance), 2), 0)::float8 as amount from due where balance > 0`,
    );
    return res.rows[0] ?? { count: 0, amount: 0 };
  }

  // ---------- breakdowns ----------

  async collectionsByMode(tx: Tx, r: Range, f: FacilityScope): Promise<ModeTotal[]> {
    const res = await tx.execute<ModeTotal>(
      sql`select p.mode, count(*)::int as count, round(sum(p.amount), 2)::float8 as amount
          from reporting.payments p
          left join reporting.invoices i on i.tenant_id = p.tenant_id and i.invoice_id = p.invoice_id
          where ${inRange(sql`p.received_at`, r)} and ${facility(sql`coalesce(p.facility_id, i.facility_id)`, f)}
          group by p.mode order by amount desc`,
    );
    return res.rows;
  }

  /** Visits and invoice revenue per doctor. An invoice's doctor comes from the event or from the visit it was raised for. */
  async doctorStats(tx: Tx, r: Range, f: FacilityScope, limit?: number): Promise<DoctorStat[]> {
    const res = await tx.execute<DoctorStat>(
      sql`with visits as (
            select v.doctor_id, count(*)::int as visits from reporting.opd_visits v
            where v.doctor_id is not null and ${inRange(sql`v.checked_in_at`, r)} and ${facility(sql`v.facility_id`, f)}
            group by v.doctor_id),
          revenue as (
            select coalesce(i.doctor_id, src.doctor_id) as doctor_id, sum(i.total) as revenue
            from reporting.invoices i
            left join lateral (
              select v.doctor_id from reporting.opd_visits v
              where v.tenant_id = i.tenant_id and (v.visit_id = i.source_ref_id or v.appointment_id = i.source_ref_id)
              limit 1) src on true
            where ${inRange(sql`i.finalized_at`, r)} and ${facility(sql`i.facility_id`, f)}
            group by 1)
          select d.doctor_id as "doctorId", coalesce(u.name, 'Unknown doctor') as name,
                 coalesce(vs.visits, 0)::int as visits, coalesce(round(rv.revenue, 2), 0)::float8 as revenue
          from (select doctor_id from visits union select doctor_id from revenue where doctor_id is not null) d
          left join visits vs on vs.doctor_id = d.doctor_id
          left join revenue rv on rv.doctor_id = d.doctor_id
          left join iam.users u on u.id = d.doctor_id
          order by revenue desc, visits desc, name
          ${limit ? sql`limit ${limit}` : sql``}`,
    );
    return res.rows;
  }

  async serviceStats(tx: Tx, r: Range, f: FacilityScope, limit?: number): Promise<ServiceStat[]> {
    const res = await tx.execute<ServiceStat>(
      sql`select l.service_code as code, min(l.description) as description,
                 round(sum(l.qty), 3)::float8 as qty, round(sum(l.amount), 2)::float8 as amount
          from reporting.invoice_lines l
          join reporting.invoices i on i.tenant_id = l.tenant_id and i.invoice_id = l.invoice_id
          where ${inRange(sql`i.finalized_at`, r)} and ${facility(sql`i.facility_id`, f)}
          group by l.service_code, case when l.service_code is null then l.description end
          order by amount desc, qty desc
          ${limit ? sql`limit ${limit}` : sql``}`,
    );
    return res.rows;
  }

  async dailySeries(tx: Tx, r: Range, f: FacilityScope) {
    const res = await tx.execute<{ date: string; opdVisits: number; newPatients: number; billed: number; collections: number }>(
      sql`with days as (select d::date as day from generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d),
          v as (select ${localDay(sql`checked_in_at`, r)} as day, count(*) as n from reporting.opd_visits
                where ${inRange(sql`checked_in_at`, r)} and ${facility(sql`facility_id`, f)} group by 1),
          np as (select ${localDay(sql`created_at`, r)} as day, count(*) as n from clinical.patients
                 where ${inRange(sql`created_at`, r)} and ${facility(sql`registered_facility_id`, f)} group by 1),
          b as (select ${localDay(sql`finalized_at`, r)} as day, sum(total) as n from reporting.invoices
                where ${inRange(sql`finalized_at`, r)} and ${facility(sql`facility_id`, f)} group by 1),
          c as (select ${localDay(sql`p.received_at`, r)} as day, sum(p.amount) as n
                from reporting.payments p
                left join reporting.invoices i on i.tenant_id = p.tenant_id and i.invoice_id = p.invoice_id
                where ${inRange(sql`p.received_at`, r)} and ${facility(sql`coalesce(p.facility_id, i.facility_id)`, f)} group by 1)
          select to_char(days.day, 'YYYY-MM-DD') as date,
                 coalesce(v.n, 0)::int as "opdVisits", coalesce(np.n, 0)::int as "newPatients",
                 coalesce(round(b.n, 2), 0)::float8 as billed, coalesce(round(c.n, 2), 0)::float8 as collections
          from days
          left join v on v.day = days.day left join np on np.day = days.day
          left join b on b.day = days.day left join c on c.day = days.day
          order by days.day`,
    );
    return res.rows;
  }

  async collectionRows(tx: Tx, r: Range, f: FacilityScope, limit = 5000) {
    const res = await tx.execute<{
      receivedAt: string;
      invoiceId: string | null;
      invoiceNumber: string | null;
      patientId: string | null;
      uhid: string | null;
      patientName: string | null;
      mode: string;
      amount: number;
    }>(
      sql`select to_char(p.received_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "receivedAt",
                 p.invoice_id as "invoiceId", i.number as "invoiceNumber",
                 coalesce(p.patient_id, i.patient_id) as "patientId", pt.uhid,
                 nullif(trim(pt.first_name || ' ' || coalesce(pt.last_name, '')), '') as "patientName",
                 p.mode, p.amount::float8 as amount
          from reporting.payments p
          left join reporting.invoices i on i.tenant_id = p.tenant_id and i.invoice_id = p.invoice_id
          left join clinical.patients pt on pt.tenant_id = p.tenant_id and pt.id = coalesce(p.patient_id, i.patient_id)
          where ${inRange(sql`p.received_at`, r)} and ${facility(sql`coalesce(p.facility_id, i.facility_id)`, f)}
          order by p.received_at
          limit ${limit}`,
    );
    return res.rows;
  }

  // ---------- OPD ----------

  async opdBreakdown(tx: Tx, r: Range, f: FacilityScope, doctorId?: string) {
    const where = sql`${inRange(sql`v.checked_in_at`, r)} and ${facility(sql`v.facility_id`, f)}
                      ${doctorId ? sql`and v.doctor_id = ${doctorId}` : sql``}`;
    const [split, byDoctor, byDay, byHour] = await inOrder(
      () => tx.execute<{ newVisits: number; followUpVisits: number }>(
        sql`select count(*) filter (where not prior)::int as "newVisits", count(*) filter (where prior)::int as "followUpVisits"
            from (select exists (select 1 from reporting.opd_visits o
                                 where o.tenant_id = v.tenant_id and o.patient_id = v.patient_id
                                   and o.checked_in_at < v.checked_in_at) as prior
                  from reporting.opd_visits v where ${where}) x`,
      ),
      () => tx.execute<{ doctorId: string | null; name: string; visits: number }>(
        sql`select v.doctor_id as "doctorId", coalesce(u.name, case when v.doctor_id is null then 'Unassigned' else 'Unknown doctor' end) as name,
                   count(*)::int as visits
            from reporting.opd_visits v left join iam.users u on u.id = v.doctor_id
            where ${where} group by v.doctor_id, u.name order by visits desc, name`,
      ),
      () => tx.execute<{ date: string; visits: number }>(
        sql`select to_char(d::date, 'YYYY-MM-DD') as date,
                   (select count(*) from reporting.opd_visits v where ${where} and ${localDay(sql`v.checked_in_at`, r)} = d::date)::int as visits
            from generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d order by d`,
      ),
      () => tx.execute<{ hour: number; visits: number }>(
        sql`select extract(hour from v.checked_in_at at time zone ${r.tz})::int as hour, count(*)::int as visits
            from reporting.opd_visits v where ${where} group by 1 order by 1`,
      ),
    );
    return { ...(split.rows[0] ?? { newVisits: 0, followUpVisits: 0 }), byDoctor: byDoctor.rows, byDay: byDay.rows, byHour: byHour.rows };
  }

  async opdVisitRows(tx: Tx, r: Range, f: FacilityScope, doctorId?: string, limit = 50000) {
    const res = await tx.execute<Record<string, unknown>>(
      sql`select to_char(v.checked_in_at at time zone ${r.tz}, 'YYYY-MM-DD HH24:MI') as checked_in,
                 v.token_no as token, pt.uhid, nullif(trim(pt.first_name || ' ' || coalesce(pt.last_name, '')), '') as patient,
                 coalesce(u.name, '') as doctor, coalesce(fc.name, '') as facility
          from reporting.opd_visits v
          left join clinical.patients pt on pt.tenant_id = v.tenant_id and pt.id = v.patient_id
          left join iam.users u on u.id = v.doctor_id
          left join setup.facilities fc on fc.id = v.facility_id
          where ${inRange(sql`v.checked_in_at`, r)} and ${facility(sql`v.facility_id`, f)}
            ${doctorId ? sql`and v.doctor_id = ${doctorId}` : sql``}
          order by v.checked_in_at limit ${limit}`,
    );
    return res.rows;
  }

  // ---------- patients ----------

  async patientBreakdown(tx: Tx, r: Range, f: FacilityScope) {
    const where = sql`${inRange(sql`p.created_at`, r)} and ${facility(sql`p.registered_facility_id`, f)}`;
    const [byDay, byGender, byAgeBand] = await inOrder(
      () => tx.execute<{ date: string; count: number }>(
        sql`select to_char(d::date, 'YYYY-MM-DD') as date,
                   (select count(*) from clinical.patients p where ${where} and ${localDay(sql`p.created_at`, r)} = d::date)::int as count
            from generate_series(${r.from}::date, ${r.to}::date, interval '1 day') d order by d`,
      ),
      () => tx.execute<{ gender: string; count: number }>(
        sql`select p.gender, count(*)::int as count from clinical.patients p where ${where} group by 1 order by 2 desc`,
      ),
      () => tx.execute<{ band: string; count: number }>(
        sql`select band, count(*)::int as count from (
              select case
                when p.date_of_birth is null then 'Unknown'
                when age < 13 then '0-12' when age < 18 then '13-17' when age < 31 then '18-30'
                when age < 46 then '31-45' when age < 61 then '46-60' else '60+' end as band,
                case when p.date_of_birth is null then 99 else least(age, 98) end as ord
              from clinical.patients p
              cross join lateral (select extract(year from age(p.created_at::date, p.date_of_birth))::int as age) a
              where ${where}) x
            group by band order by min(ord)`,
      ),
    );
    return { byDay: byDay.rows, byGender: byGender.rows, byAgeBand: byAgeBand.rows };
  }

  async newPatientRows(tx: Tx, r: Range, f: FacilityScope, limit = 50000) {
    const res = await tx.execute<Record<string, unknown>>(
      sql`select to_char(p.created_at at time zone ${r.tz}, 'YYYY-MM-DD HH24:MI') as registered, p.uhid,
                 trim(p.first_name || ' ' || coalesce(p.last_name, '')) as name, p.gender,
                 case when p.date_of_birth is null then null
                      else extract(year from age(p.created_at::date, p.date_of_birth))::int end as age_years,
                 p.mobile, coalesce(fc.name, '') as facility
          from clinical.patients p
          left join setup.facilities fc on fc.id = p.registered_facility_id
          where ${inRange(sql`p.created_at`, r)} and ${facility(sql`p.registered_facility_id`, f)}
          order by p.created_at limit ${limit}`,
    );
    return res.rows;
  }

  private async scalar(tx: Tx, query: SQL): Promise<number> {
    const res = await tx.execute<{ n: number }>(query);
    return Number(res.rows[0]?.n ?? 0);
  }
}

/** `col` falls on a hospital-local day between r.from and r.to (inclusive). */
function inRange(col: SQL, r: Range): SQL {
  return sql`${col} >= (${r.from}::date::timestamp at time zone ${r.tz}) and ${col} < ${endOf(r)}`;
}

function endOf(r: Range): SQL {
  return sql`((${r.to}::date + 1)::timestamp at time zone ${r.tz})`;
}

function localDay(col: SQL, r: Range): SQL {
  return sql`(${col} at time zone ${r.tz})::date`;
}

function facility(col: SQL, f: FacilityScope): SQL {
  if (f === null) return sql`true`;
  if (!f.length) return sql`false`;
  return sql`${col} = any(${`{${f.join(',')}}`}::uuid[])`;
}
