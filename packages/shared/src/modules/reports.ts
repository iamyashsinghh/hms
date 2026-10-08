import { z } from 'zod';
import { defineModule } from '../manifest';
import { isoDate } from '../validation';

/**
 * Reports & MIS: permissions and API contracts (Zod schemas + types).
 * Owned by the "reports" workstream.
 */
export const reportsModule = defineModule({
  key: 'reports',
  name: 'Reports & MIS',
  permissions: [
    { key: 'reports.dashboard.read', description: 'View the management dashboard and owner daily summary' },
    { key: 'reports.collection.read', description: 'View the daily collection report' },
    { key: 'reports.revenue.read', description: 'View revenue reports (by doctor, service, day)' },
    { key: 'reports.opd.read', description: 'View OPD visit reports' },
    { key: 'reports.patient.read', description: 'View patient registration reports' },
    { key: 'reports.export.create', description: 'Download reports as CSV' },
  ],
  grants: {
    hospital_admin: [
      'reports.dashboard.read', 'reports.collection.read', 'reports.revenue.read',
      'reports.opd.read', 'reports.patient.read', 'reports.export.create',
    ],
    owner: [
      'reports.dashboard.read', 'reports.collection.read', 'reports.revenue.read',
      'reports.opd.read', 'reports.patient.read', 'reports.export.create',
    ],
    accountant: ['reports.dashboard.read', 'reports.collection.read', 'reports.revenue.read', 'reports.export.create'],
    billing_clerk: ['reports.collection.read'],
    receptionist: ['reports.opd.read', 'reports.patient.read'],
  },
});

// ---------- Queries ----------

/** Longest range a report may cover. */
export const MAX_REPORT_DAYS = 366;

const daysBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;

export const ownerSummaryQuerySchema = z.object({
  /** Hospital-local date (YYYY-MM-DD). Defaults to today in the hospital's time zone. */
  date: isoDate.optional(),
  /** Limit to one facility; omitted = every facility the caller can see. */
  facilityId: z.uuid().optional(),
});
export type OwnerSummaryQuery = z.input<typeof ownerSummaryQuerySchema>;

export const dailyCollectionQuerySchema = ownerSummaryQuerySchema;
export type DailyCollectionQuery = OwnerSummaryQuery;

/** GET /reports/unbilled: charges still unbilled at the end of `date` (default today). */
export const unbilledQuerySchema = ownerSummaryQuerySchema;
export type UnbilledQuery = OwnerSummaryQuery;

export const reportRangeQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,
    facilityId: z.uuid().optional(),
    doctorId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) < MAX_REPORT_DAYS, {
    message: `A report can cover at most ${MAX_REPORT_DAYS} days`,
    path: ['to'],
  });
export type ReportRangeQuery = z.input<typeof reportRangeQuerySchema>;
export type ReportRangeParams = z.output<typeof reportRangeQuerySchema>;

export const EXPORT_REPORTS = [
  'collections',
  'opd-visits',
  'revenue-by-doctor',
  'revenue-by-service',
  'new-patients',
  'daily-summary',
  /** One row per charge still unbilled at the end of `to` (`from` is ignored). */
  'unbilled-charges',
] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

export const exportQuerySchema = z
  .object({
    report: z.enum(EXPORT_REPORTS),
    from: isoDate,
    to: isoDate,
    facilityId: z.uuid().optional(),
    doctorId: z.uuid().optional(),
  })
  .refine((q) => q.from <= q.to, { message: '"from" must be on or before "to"', path: ['from'] })
  .refine((q) => daysBetween(q.from, q.to) < MAX_REPORT_DAYS, {
    message: `A report can cover at most ${MAX_REPORT_DAYS} days`,
    path: ['to'],
  });
export type ExportQuery = z.input<typeof exportQuerySchema>;
export type ExportParams = z.output<typeof exportQuerySchema>;

// ---------- Responses (money is in rupees, rounded to paise) ----------

export interface ModeTotal {
  mode: string;
  count: number;
  amount: number;
}

export interface DoctorStat {
  doctorId: string;
  name: string;
  visits: number;
  revenue: number;
}

export interface ServiceStat {
  code: string | null;
  description: string;
  qty: number;
  amount: number;
}

/** GET /reports/owner-summary — owner app home screen and the 7 AM WhatsApp summary. */
export interface OwnerSummary {
  date: string;
  timezone: string;
  facilityId: string | null;
  opdVisits: number;
  newPatients: number;
  appointmentsBooked: number;
  appointmentsCancelled: number;
  consultationsSigned: number;
  pharmacyDispenses: number;
  /** Value of invoices finalized that day. */
  billed: number;
  /** Money received that day (any invoice). */
  collections: number;
  collectionsByMode: ModeTotal[];
  /** All finalized invoices with a balance, as of the end of that day. */
  pendingBills: { count: number; amount: number };
  topDoctors: DoctorStat[];
  topServices: ServiceStat[];
  /** Charges on patients' accounts not yet billed at the end of that day ("billed vs unbilled"). */
  unbilledCharges: { count: number; patients: number; amount: number };
  /** Same figures for the day before, for "vs yesterday". */
  previous: { date: string; opdVisits: number; newPatients: number; billed: number; collections: number };
}

export interface DailyPoint {
  date: string;
  opdVisits: number;
  newPatients: number;
  billed: number;
  collections: number;
}

/** GET /reports/dashboard */
export interface DashboardReport {
  from: string;
  to: string;
  timezone: string;
  totals: { opdVisits: number; newPatients: number; billed: number; collections: number; pendingAmount: number };
  daily: DailyPoint[];
  collectionsByMode: ModeTotal[];
  topDoctors: DoctorStat[];
  topServices: ServiceStat[];
}

export interface CollectionRow {
  receivedAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  patientId: string | null;
  uhid: string | null;
  patientName: string | null;
  mode: string;
  amount: number;
}

/** GET /reports/daily-collection */
export interface DailyCollectionReport {
  date: string;
  timezone: string;
  total: number;
  byMode: ModeTotal[];
  rows: CollectionRow[];
}

/** GET /reports/opd */
export interface OpdReport {
  from: string;
  to: string;
  timezone: string;
  total: number;
  newVisits: number;
  followUpVisits: number;
  byDoctor: { doctorId: string | null; name: string; visits: number }[];
  byDay: { date: string; visits: number }[];
  byHour: { hour: number; visits: number }[];
}

/** GET /reports/revenue */
export interface RevenueReport {
  from: string;
  to: string;
  timezone: string;
  billed: number;
  collected: number;
  outstanding: number;
  byDay: { date: string; billed: number; collected: number }[];
  byDoctor: DoctorStat[];
  byService: ServiceStat[];
  byMode: ModeTotal[];
}

/** GET /reports/patients */
export interface PatientsReport {
  from: string;
  to: string;
  timezone: string;
  newPatients: number;
  byDay: { date: string; count: number }[];
  byGender: { gender: string; count: number }[];
  byAgeBand: { band: string; count: number }[];
}

/** Department that posted a charge (its source module), as shown on the unbilled report. */
export const CHARGE_SOURCE_LABELS: Record<string, string> = {
  frontoffice: 'OPD / front office',
  emr: "Doctor's orders",
  lab: 'Laboratory',
  radiology: 'Radiology',
  pharmacy: 'Pharmacy',
  ipd: 'IPD',
  inventory: 'Consumables',
  ops: 'Ambulance',
  billing: 'Billing desk',
};
export const chargeSourceLabel = (module: string) => CHARGE_SOURCE_LABELS[module] ?? module.charAt(0).toUpperCase() + module.slice(1);

/** Age of an unbilled charge, by its charge date. */
export const UNBILLED_AGE_BUCKETS = [
  { key: 'today', label: 'Today', min: 0, max: 0 },
  { key: '1-2', label: '1–2 days', min: 1, max: 2 },
  { key: '3-7', label: '3–7 days', min: 3, max: 7 },
  { key: '8+', label: 'Over a week', min: 8, max: Infinity },
] as const;

export interface UnbilledGroup {
  count: number;
  amount: number;
}

/** GET /reports/unbilled: day-end list of charges still on patients' accounts. */
export interface UnbilledChargesReport {
  date: string;
  timezone: string;
  total: UnbilledGroup & { patients: number };
  /** By department (charge source module), largest amount first. */
  byModule: (UnbilledGroup & { module: string; label: string; patients: number; oldestDate: string })[];
  byAge: (UnbilledGroup & { key: string; label: string })[];
  /** By patient, oldest charge first. */
  byPatient: (UnbilledGroup & {
    patientId: string;
    uhid: string | null;
    patientName: string | null;
    mobile: string | null;
    oldestDate: string;
    /** Days since the oldest charge, as of `date`. */
    ageDays: number;
    modules: string[];
    accounts: string[];
  })[];
}

// ---------- Events reports consumes ----------
// Topics and payloads come from the owners' contracts in PARALLEL_PLAN.md section 4.
// Fields marked optional are read when present (they make reports richer) and ignored otherwise.

export const REPORTS_CONSUMED_TOPICS = [
  'frontoffice.visit.checked_in',
  'frontoffice.appointment.booked',
  'frontoffice.appointment.cancelled',
  'emr.encounter.signed',
  'billing.invoice.finalized',
  'billing.payment.received',
  'pharmacy.dispense.completed',
] as const;
export type ReportsConsumedTopic = (typeof REPORTS_CONSUMED_TOPICS)[number];

/** What reports reads from `billing.invoice.finalized` (agreed fields: invoiceId; the rest optional). */
export interface InvoiceFinalizedForReports {
  invoiceId: string;
  number?: string;
  patientId?: string;
  facilityId?: string;
  doctorId?: string;
  total?: number | string;
  source?: { module: string; refId?: string };
  lines?: { serviceCode?: string | null; description: string; qty?: number | string; amount?: number | string; unitPrice?: number | string }[];
}
