import { Injectable } from '@nestjs/common';
import type { Tx } from '@hms/db';
import { reports as R, type reports } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { currentContext } from '../../common/context/request-context';
import { forbidden } from '../../common/errors/errors';
import { toCsv } from './csv';
import { inOrder, ReportsRepository, type FacilityScope, type Range, type UnbilledChargeRow } from './reports.repository';

const TOP_N = 5;

/** The report permission a CSV export needs on top of reports.export.create. */
const EXPORT_PERMISSION: Record<reports.ExportReport, string> = {
  collections: 'reports.collection.read',
  'opd-visits': 'reports.opd.read',
  'revenue-by-doctor': 'reports.revenue.read',
  'revenue-by-service': 'reports.revenue.read',
  'new-patients': 'reports.patient.read',
  'daily-summary': 'reports.dashboard.read',
  // The day-end unbilled list is a billing-desk report, like the daily collection.
  'unbilled-charges': 'reports.collection.read',
};

/** Read-only reports. Facility filters are limited to the facilities the caller has access to. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: ReportsRepository,
  ) {}

  ownerSummary(date?: string, facilityId?: string): Promise<reports.OwnerSummary> {
    const scope = callerScope(facilityId);
    return this.db.tx((tx) => this.buildOwnerSummary(tx, date, scope, facilityId ?? null));
  }

  /**
   * Owner summary for background jobs (e.g. the 7 AM WhatsApp summary), whole hospital.
   * Callers outside a request use this instead of ownerSummary().
   */
  ownerSummaryForTenant(tenantId: string, date?: string): Promise<reports.OwnerSummary> {
    return this.db.asTenant({ tenantId }, (tx) => this.buildOwnerSummary(tx, date, null, null));
  }

  dashboard(q: reports.ReportRangeParams): Promise<reports.DashboardReport> {
    const scope = callerScope(q.facilityId);
    return this.db.tx(async (tx) => {
      const r = await this.range(tx, q.from, q.to);
      const [daily, collectionsByMode, topDoctors, topServices, pending] = await inOrder(
        () => this.repo.dailySeries(tx, r, scope),
        () => this.repo.collectionsByMode(tx, r, scope),
        () => this.repo.doctorStats(tx, r, scope, TOP_N),
        () => this.repo.serviceStats(tx, r, scope, TOP_N),
        () => this.repo.pending(tx, r, scope),
      );
      const sum = (k: 'opdVisits' | 'newPatients' | 'billed' | 'collections') => round(daily.reduce((s, d) => s + d[k], 0));
      return {
        from: r.from,
        to: r.to,
        timezone: r.tz,
        totals: {
          opdVisits: sum('opdVisits'),
          newPatients: sum('newPatients'),
          billed: sum('billed'),
          collections: sum('collections'),
          pendingAmount: pending.amount,
        },
        daily,
        collectionsByMode,
        topDoctors,
        topServices,
      };
    });
  }

  dailyCollection(date?: string, facilityId?: string): Promise<reports.DailyCollectionReport> {
    const scope = callerScope(facilityId);
    return this.db.tx(async (tx) => {
      const tz = await this.repo.timezone(tx);
      const day = date ?? (await this.repo.today(tx, tz));
      const r = { from: day, to: day, tz };
      const [byMode, rows] = await inOrder(
        () => this.repo.collectionsByMode(tx, r, scope),
        () => this.repo.collectionRows(tx, r, scope),
      );
      return { date: day, timezone: tz, total: round(byMode.reduce((s, m) => s + m.amount, 0)), byMode, rows };
    });
  }

  /** Day-end check: charges still on patients' accounts, by department, by age and by patient. */
  unbilled(date?: string, facilityId?: string): Promise<reports.UnbilledChargesReport> {
    const scope = callerScope(facilityId);
    return this.db.tx(async (tx) => {
      const tz = await this.repo.timezone(tx);
      const day = date ?? (await this.repo.today(tx, tz));
      return summarizeUnbilled(day, tz, await this.repo.unbilledCharges(tx, { from: day, to: day, tz }, scope));
    });
  }

  opd(q: reports.ReportRangeParams): Promise<reports.OpdReport> {
    const scope = callerScope(q.facilityId);
    return this.db.tx(async (tx) => {
      const r = await this.range(tx, q.from, q.to);
      const b = await this.repo.opdBreakdown(tx, r, scope, q.doctorId);
      return { from: r.from, to: r.to, timezone: r.tz, total: b.newVisits + b.followUpVisits, ...b };
    });
  }

  revenue(q: reports.ReportRangeParams): Promise<reports.RevenueReport> {
    const scope = callerScope(q.facilityId);
    return this.db.tx(async (tx) => {
      const r = await this.range(tx, q.from, q.to);
      const [daily, byDoctor, byService, byMode, pending] = await inOrder(
        () => this.repo.dailySeries(tx, r, scope),
        () => this.repo.doctorStats(tx, r, scope),
        () => this.repo.serviceStats(tx, r, scope),
        () => this.repo.collectionsByMode(tx, r, scope),
        () => this.repo.pending(tx, r, scope),
      );
      return {
        from: r.from,
        to: r.to,
        timezone: r.tz,
        billed: round(daily.reduce((s, d) => s + d.billed, 0)),
        collected: round(daily.reduce((s, d) => s + d.collections, 0)),
        outstanding: pending.amount,
        byDay: daily.map((d) => ({ date: d.date, billed: d.billed, collected: d.collections })),
        byDoctor,
        byService,
        byMode,
      };
    });
  }

  patients(q: reports.ReportRangeParams): Promise<reports.PatientsReport> {
    const scope = callerScope(q.facilityId);
    return this.db.tx(async (tx) => {
      const r = await this.range(tx, q.from, q.to);
      const b = await this.repo.patientBreakdown(tx, r, scope);
      return { from: r.from, to: r.to, timezone: r.tz, newPatients: b.byDay.reduce((s, d) => s + d.count, 0), ...b };
    });
  }

  /** CSV text and a file name for GET /reports/export. */
  export(q: reports.ExportParams): Promise<{ filename: string; csv: string }> {
    const needed = EXPORT_PERMISSION[q.report];
    if (!currentContext()!.permissions.has(needed)) throw forbidden(`Exporting ${q.report} needs ${needed}`);
    const scope = callerScope(q.facilityId);
    return this.db.tx(async (tx) => {
      const r = await this.range(tx, q.from, q.to);
      const filename = `${q.report}_${r.from}_to_${r.to}.csv`;
      switch (q.report) {
        case 'collections': {
          const rows = await this.repo.collectionRows(tx, r, scope, 50000);
          return {
            filename,
            csv: toCsv(
              rows.map((x) => ({
                received_at: x.receivedAt,
                invoice_no: x.invoiceNumber,
                uhid: x.uhid,
                patient: x.patientName,
                mode: x.mode,
                amount: x.amount.toFixed(2),
              })),
              ['received_at', 'invoice_no', 'uhid', 'patient', 'mode', 'amount'],
            ),
          };
        }
        case 'opd-visits':
          return {
            filename,
            csv: toCsv(await this.repo.opdVisitRows(tx, r, scope, q.doctorId), ['checked_in', 'token', 'uhid', 'patient', 'doctor', 'facility']),
          };
        case 'revenue-by-doctor':
          return {
            filename,
            csv: toCsv(
              (await this.repo.doctorStats(tx, r, scope)).map((d) => ({ doctor: d.name, visits: d.visits, revenue: d.revenue.toFixed(2) })),
              ['doctor', 'visits', 'revenue'],
            ),
          };
        case 'revenue-by-service':
          return {
            filename,
            csv: toCsv(
              (await this.repo.serviceStats(tx, r, scope)).map((s) => ({
                code: s.code,
                service: s.description,
                qty: s.qty,
                amount: s.amount.toFixed(2),
              })),
              ['code', 'service', 'qty', 'amount'],
            ),
          };
        case 'new-patients':
          return {
            filename,
            csv: toCsv(await this.repo.newPatientRows(tx, r, scope), ['registered', 'uhid', 'name', 'gender', 'age_years', 'mobile', 'facility']),
          };
        case 'unbilled-charges': {
          const day = { ...r, from: r.to };
          return {
            filename: `unbilled-charges_${r.to}.csv`,
            csv: toCsv(
              (await this.repo.unbilledCharges(tx, day, scope)).map((x) => ({
                charge_date: x.chargeDate,
                age_days: x.ageDays,
                department: R.chargeSourceLabel(x.module),
                uhid: x.uhid,
                patient: x.patientName,
                mobile: x.mobile,
                account: x.account.toUpperCase(),
                description: x.description,
                qty: x.qty,
                amount: x.amount.toFixed(2),
              })),
              ['charge_date', 'age_days', 'department', 'uhid', 'patient', 'mobile', 'account', 'description', 'qty', 'amount'],
            ),
          };
        }
        case 'daily-summary':
          return {
            filename,
            csv: toCsv(
              (await this.repo.dailySeries(tx, r, scope)).map((d) => ({
                date: d.date,
                opd_visits: d.opdVisits,
                new_patients: d.newPatients,
                billed: d.billed.toFixed(2),
                collections: d.collections.toFixed(2),
              })),
              ['date', 'opd_visits', 'new_patients', 'billed', 'collections'],
            ),
          };
      }
    });
  }

  private async range(tx: Tx, from: string, to: string): Promise<Range> {
    return { from, to, tz: await this.repo.timezone(tx) };
  }

  private async buildOwnerSummary(tx: Tx, date: string | undefined, scope: FacilityScope, facilityId: string | null): Promise<reports.OwnerSummary> {
    const tz = await this.repo.timezone(tx);
    const day = date ?? (await this.repo.today(tx, tz));
    const prev = addDays(day, -1);
    const r = { from: day, to: day, tz };
    const p = { from: prev, to: prev, tz };
    const [
      opdVisits,
      newPatients,
      appts,
      consultationsSigned,
      pharmacyDispenses,
      billed,
      collections,
      collectionsByMode,
      pendingBills,
      topDoctors,
      topServices,
      prevVisits,
      prevPatients,
      prevBilled,
      prevCollections,
      unbilled,
    ] = await inOrder(
      () => this.repo.opdVisitCount(tx, r, scope),
      () => this.repo.newPatientCount(tx, r, scope),
      () => this.repo.appointmentCounts(tx, r, scope),
      () => this.repo.encountersSigned(tx, r, scope),
      () => this.repo.pharmacyDispenses(tx, r, scope),
      () => this.repo.billed(tx, r, scope),
      () => this.repo.collections(tx, r, scope),
      () => this.repo.collectionsByMode(tx, r, scope),
      () => this.repo.pending(tx, r, scope),
      () => this.repo.doctorStats(tx, r, scope, TOP_N),
      () => this.repo.serviceStats(tx, r, scope, TOP_N),
      () => this.repo.opdVisitCount(tx, p, scope),
      () => this.repo.newPatientCount(tx, p, scope),
      () => this.repo.billed(tx, p, scope),
      () => this.repo.collections(tx, p, scope),
      () => this.repo.unbilledCharges(tx, r, scope),
    );
    return {
      date: day,
      timezone: tz,
      facilityId,
      opdVisits,
      newPatients,
      appointmentsBooked: appts.booked,
      appointmentsCancelled: appts.cancelled,
      consultationsSigned,
      pharmacyDispenses,
      billed,
      collections,
      collectionsByMode,
      pendingBills,
      topDoctors,
      topServices,
      unbilledCharges: { ...summarizeUnbilled(day, tz, unbilled).total },
      previous: { date: prev, opdVisits: prevVisits, newPatients: prevPatients, billed: prevBilled, collections: prevCollections },
    };
  }
}

/** Facilities the current caller may report on, narrowed to `facilityId` when given. */
function callerScope(facilityId?: string): FacilityScope {
  const ctx = currentContext()!;
  if (ctx.facilityIds === 'all') return facilityId ? [facilityId] : null;
  if (facilityId) {
    if (!ctx.facilityIds.includes(facilityId)) throw forbidden('You do not have access to this facility');
    return [facilityId];
  }
  return ctx.facilityIds;
}

/** Groups unbilled charge rows for the report (money summed in paise). */
function summarizeUnbilled(date: string, timezone: string, rows: UnbilledChargeRow[]): reports.UnbilledChargesReport {
  const paise = (n: number) => Math.round(n * 100);
  const modules = new Map<string, { count: number; amount: number; patients: Set<string>; oldestDate: string }>();
  const ages = R.UNBILLED_AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0, amount: 0 }));
  const patients = new Map<string, reports.UnbilledChargesReport['byPatient'][number]>();
  let total = 0;
  for (const c of rows) {
    const amt = paise(c.amount);
    total += amt;
    const m = modules.get(c.module) ?? { count: 0, amount: 0, patients: new Set<string>(), oldestDate: c.chargeDate };
    m.count++;
    m.amount += amt;
    m.patients.add(c.patientId);
    if (c.chargeDate < m.oldestDate) m.oldestDate = c.chargeDate;
    modules.set(c.module, m);
    const bucket = R.UNBILLED_AGE_BUCKETS.findIndex((b) => c.ageDays >= b.min && c.ageDays <= b.max);
    const a = ages[bucket === -1 ? 0 : bucket]!;
    a.count++;
    a.amount += amt;
    let p = patients.get(c.patientId);
    if (!p) {
      p = { patientId: c.patientId, uhid: c.uhid, patientName: c.patientName, mobile: c.mobile, count: 0, amount: 0, oldestDate: c.chargeDate, ageDays: c.ageDays, modules: [], accounts: [] };
      patients.set(c.patientId, p);
    }
    p.count++;
    p.amount += amt;
    if (c.chargeDate < p.oldestDate) p.oldestDate = c.chargeDate;
    p.ageDays = Math.max(p.ageDays, c.ageDays);
    if (!p.modules.includes(c.module)) p.modules.push(c.module);
    if (!p.accounts.includes(c.account)) p.accounts.push(c.account);
  }
  return {
    date,
    timezone,
    total: { count: rows.length, patients: patients.size, amount: total / 100 },
    byModule: [...modules.entries()]
      .map(([module, m]) => ({ module, label: R.chargeSourceLabel(module), count: m.count, amount: m.amount / 100, patients: m.patients.size, oldestDate: m.oldestDate }))
      .sort((x, y) => y.amount - x.amount || x.label.localeCompare(y.label)),
    byAge: ages.map((a) => ({ ...a, amount: a.amount / 100 })),
    byPatient: [...patients.values()]
      .map((p) => ({ ...p, amount: p.amount / 100 }))
      .sort((x, y) => x.oldestDate.localeCompare(y.oldestDate) || y.amount - x.amount),
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const round = (n: number) => Math.round(n * 100) / 100;
