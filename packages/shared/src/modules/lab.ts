import { z } from 'zod';
import { defineModule } from '../manifest';

/**
 * Laboratory (LIS): permissions and API contracts (Zod schemas + types).
 * Owned by the "lab" workstream.
 */
export const labModule = defineModule({
  key: 'lab',
  name: 'Laboratory',
  permissions: [
    { key: 'lab.test.read', description: 'View the lab test and panel catalogue' },
    { key: 'lab.test.manage', description: 'Add and edit lab tests, panels, reference ranges and prices' },
    { key: 'lab.order.read', description: 'View lab orders, results and printed reports' },
    { key: 'lab.order.create', description: 'Book lab orders (walk-in, doctor referral) and bill them' },
    { key: 'lab.order.cancel', description: 'Cancel lab orders' },
    { key: 'lab.sample.collect', description: 'Collect, receive and reject samples' },
    { key: 'lab.result.enter', description: 'Enter test results' },
    { key: 'lab.result.verify', description: 'Verify results and release reports' },
  ],
  grants: {
    hospital_admin: [
      'lab.test.read', 'lab.test.manage', 'lab.order.read', 'lab.order.create', 'lab.order.cancel',
      'lab.sample.collect', 'lab.result.enter', 'lab.result.verify',
    ],
    lab_technician: [
      'lab.test.read', 'lab.order.read', 'lab.order.create', 'lab.order.cancel',
      'lab.sample.collect', 'lab.result.enter', 'lab.result.verify',
    ],
    doctor: ['lab.test.read', 'lab.order.read', 'lab.order.create'],
    nurse: ['lab.test.read', 'lab.order.read', 'lab.sample.collect'],
    receptionist: ['lab.test.read', 'lab.order.read', 'lab.order.create'],
    billing_clerk: ['lab.test.read', 'lab.order.read', 'lab.order.create'],
    owner: ['lab.test.read', 'lab.order.read'],
  },
});

// ---------- enums ----------

export const LAB_SECTIONS = ['haematology', 'biochemistry', 'clinical_pathology', 'serology', 'microbiology', 'hormones', 'histopathology', 'other'] as const;
export type LabSection = (typeof LAB_SECTIONS)[number];
export const SECTION_LABELS: Record<LabSection, string> = {
  haematology: 'Haematology',
  biochemistry: 'Biochemistry',
  clinical_pathology: 'Clinical pathology',
  serology: 'Serology / Immunology',
  microbiology: 'Microbiology',
  hormones: 'Hormones',
  histopathology: 'Histopathology',
  other: 'Other',
};

export const SAMPLE_TYPES = ['blood', 'serum', 'plasma', 'urine', 'stool', 'sputum', 'swab', 'csf', 'fluid', 'tissue', 'other'] as const;
export type SampleType = (typeof SAMPLE_TYPES)[number];

export const RESULT_TYPES = ['numeric', 'text', 'option'] as const;
export type ResultType = (typeof RESULT_TYPES)[number];

export const RANGE_GENDERS = ['any', 'male', 'female'] as const;
export const ORDER_SOURCES = ['walkin', 'emr', 'b2b'] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];
export const ORDER_PRIORITIES = ['routine', 'urgent', 'stat'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

/** ordered → collected (all samples in) → in_progress (results being entered) → completed (all verified). */
export const ORDER_STATUSES = ['ordered', 'collected', 'in_progress', 'completed', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const SAMPLE_STATUSES = ['pending', 'collected', 'received', 'rejected'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];
export const RESULT_STATUSES = ['pending', 'entered', 'verified'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];
export const RESULT_FLAGS = ['normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal'] as const;
export type ResultFlag = (typeof RESULT_FLAGS)[number];

const code = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_.-]{0,29}$/, 'Use letters, digits, - _ or . (max 30)');
const money = z.coerce.number().min(0).max(10_000_000);
const optText = (max: number) => z.string().trim().max(max).optional();

// ---------- tests and ranges ----------

export const rangeInputSchema = z
  .object({
    gender: z.enum(RANGE_GENDERS).default('any'),
    /** Age band in years, inclusive of min and exclusive of max. */
    ageMinYears: z.number().min(0).max(150).default(0),
    ageMaxYears: z.number().min(0).max(150).default(150),
    low: z.number().optional(),
    high: z.number().optional(),
    criticalLow: z.number().optional(),
    criticalHigh: z.number().optional(),
    /** Shown on the report instead of low–high, e.g. "Negative" or "< 200 desirable". */
    text: optText(200),
  })
  .refine((r) => r.ageMaxYears > r.ageMinYears, { message: 'Age to must be more than age from' })
  .refine((r) => r.low === undefined || r.high === undefined || r.high >= r.low, { message: 'High must be at least low' });
export type RangeInput = z.input<typeof rangeInputSchema>;

export interface Range {
  gender: (typeof RANGE_GENDERS)[number];
  ageMinYears: number;
  ageMaxYears: number;
  low: number | null;
  high: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  text: string | null;
}

export const testInputSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  section: z.enum(LAB_SECTIONS).default('other'),
  sampleType: z.enum(SAMPLE_TYPES).default('blood'),
  container: optText(60),
  unit: optText(40),
  method: optText(100),
  resultType: z.enum(RESULT_TYPES).default('numeric'),
  /** Allowed answers for `option` tests, e.g. ["Positive", "Negative"]. The first is the normal one. */
  options: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  decimals: z.number().int().min(0).max(4).default(1),
  price: money.default(0),
  /** Billing service code; when set, billing prices the line from its service master. */
  serviceCode: z.string().trim().toUpperCase().max(40).optional(),
  tatHours: z.number().int().min(0).max(24 * 60).default(24),
  isActive: z.boolean().default(true),
  ranges: z.array(rangeInputSchema).max(20).default([]),
});
export type TestInput = z.input<typeof testInputSchema>;
export const updateTestSchema = testInputSchema.omit({ code: true }).partial();
export type UpdateTest = z.input<typeof updateTestSchema>;

export interface LabTest {
  id: string;
  code: string;
  name: string;
  section: LabSection;
  sampleType: SampleType;
  container: string | null;
  unit: string | null;
  method: string | null;
  resultType: ResultType;
  options: string[];
  decimals: number;
  price: number;
  serviceCode: string | null;
  tatHours: number;
  isActive: boolean;
  ranges: Range[];
}

export const panelInputSchema = z.object({
  code,
  name: z.string().trim().min(1).max(200),
  price: money.default(0),
  serviceCode: z.string().trim().toUpperCase().max(40).optional(),
  isActive: z.boolean().default(true),
  testIds: z.array(z.uuid()).min(1).max(60),
});
export type PanelInput = z.input<typeof panelInputSchema>;
export const updatePanelSchema = panelInputSchema.omit({ code: true }).partial();
export type UpdatePanel = z.input<typeof updatePanelSchema>;

export interface LabPanel {
  id: string;
  code: string;
  name: string;
  price: number;
  serviceCode: string | null;
  isActive: boolean;
  tests: Pick<LabTest, 'id' | 'code' | 'name' | 'unit'>[];
}

export const catalogueQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  active: z.enum(['true', 'false', 'all']).default('true'),
});
export type CatalogueQuery = z.input<typeof catalogueQuerySchema>;

/** One orderable thing (test or panel) for pickers. */
export interface Orderable {
  kind: 'test' | 'panel';
  id: string;
  code: string;
  name: string;
  price: number;
  sampleType: SampleType | null;
}

// ---------- orders ----------

export const orderItemInputSchema = z
  .object({ testId: z.uuid().optional(), panelId: z.uuid().optional() })
  .refine((i) => !!i.testId !== !!i.panelId, { message: 'Pick a test or a panel' });

export const createOrderSchema = z.object({
  patientId: z.uuid(),
  source: z.enum(['walkin', 'b2b']).default('walkin'),
  priority: z.enum(ORDER_PRIORITIES).default('routine'),
  /** Referring doctor on staff. */
  doctorId: z.uuid().optional(),
  /** Outside referrer or B2B client name. */
  referredBy: optText(200),
  clinicalNotes: optText(1000),
  items: z.array(orderItemInputSchema).min(1).max(60),
  /** Raise the bill now (through billing). */
  bill: z.boolean().default(true),
  payNow: z.object({ mode: z.enum(['cash', 'upi', 'card']), amount: z.number().positive(), ref: optText(100) }).optional(),
});
export type CreateOrder = z.input<typeof createOrderSchema>;

export const cancelOrderSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type CancelOrder = z.input<typeof cancelOrderSchema>;

export const orderQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum([...ORDER_STATUSES, 'open']).optional(),
  patientId: z.uuid().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});
export type OrderQuery = z.input<typeof orderQuerySchema>;

export interface OrderPatient {
  id: string;
  uhid: string;
  name: string;
  gender: string;
  dateOfBirth: string | null;
  mobile: string | null;
}

export interface OrderSummary {
  id: string;
  orderNo: string;
  orderDate: string;
  status: OrderStatus;
  source: OrderSource;
  priority: OrderPriority;
  patient: OrderPatient;
  doctorName: string | null;
  referredBy: string | null;
  itemNames: string[];
  invoiceNo: string | null;
  hasCritical: boolean;
  createdAt: string;
}

export interface OrderItem {
  id: string;
  kind: 'test' | 'panel' | 'unmatched';
  testId: string | null;
  panelId: string | null;
  code: string | null;
  name: string;
  price: number;
}

export interface Sample {
  id: string;
  barcode: string;
  sampleType: SampleType;
  container: string | null;
  status: SampleStatus;
  collectedAt: string | null;
  receivedAt: string | null;
  rejectedReason: string | null;
  testNames: string[];
}

export interface Result {
  id: string;
  itemId: string;
  testId: string;
  sampleId: string | null;
  code: string;
  name: string;
  section: LabSection;
  unit: string | null;
  method: string | null;
  resultType: ResultType;
  options: string[];
  decimals: number;
  /** Panel name when the test came in a panel. */
  panelName: string | null;
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  refText: string | null;
  value: string | null;
  flag: ResultFlag | null;
  remarks: string | null;
  status: ResultStatus;
  enteredAt: string | null;
  verifiedAt: string | null;
}

export interface Order extends OrderSummary {
  facilityId: string;
  doctorId: string | null;
  encounterId: string | null;
  clinicalNotes: string | null;
  invoiceId: string | null;
  cancelledReason: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
  items: OrderItem[];
  samples: Sample[];
  results: Result[];
}

// ---------- samples ----------

export const rejectSampleSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type RejectSample = z.input<typeof rejectSampleSchema>;

export const sampleWorklistQuerySchema = z.object({
  status: z.enum(SAMPLE_STATUSES).default('pending'),
});

export interface WorklistSample extends Sample {
  orderId: string;
  orderNo: string;
  priority: OrderPriority;
  patient: OrderPatient;
}

// ---------- results ----------

export const resultEntrySchema = z.object({
  resultId: z.uuid(),
  value: z.string().trim().max(500),
  remarks: optText(500),
});
export const enterResultsSchema = z.object({ results: z.array(resultEntrySchema).min(1).max(200) });
export type EnterResults = z.input<typeof enterResultsSchema>;

export const verifySchema = z.object({
  /** Verify only these results; all entered results when omitted. */
  resultIds: z.array(z.uuid()).max(200).optional(),
});
export type Verify = z.input<typeof verifySchema>;

export const amendSchema = z.object({ resultId: z.uuid(), reason: z.string().trim().min(3).max(300) });
export type Amend = z.input<typeof amendSchema>;

/** Work out the flag for a value against its range. Shared so the web can flag as the user types. */
export function flagFor(
  r: Pick<Result, 'resultType' | 'options' | 'refLow' | 'refHigh' | 'criticalLow' | 'criticalHigh'>,
  value: string,
): ResultFlag | null {
  const v = value.trim();
  if (!v) return null;
  if (r.resultType === 'option') return r.options.length && v !== r.options[0] ? 'abnormal' : 'normal';
  if (r.resultType !== 'numeric') return null;
  const n = Number(v.replace(/^[<>]=?\s*/, ''));
  if (!Number.isFinite(n)) return null;
  if (r.criticalLow !== null && n <= r.criticalLow) return 'critical_low';
  if (r.criticalHigh !== null && n >= r.criticalHigh) return 'critical_high';
  if (r.refLow !== null && n < r.refLow) return 'low';
  if (r.refHigh !== null && n > r.refHigh) return 'high';
  return 'normal';
}

// ---------- report ----------

export interface Report {
  order: Order;
  hospital: {
    name: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    registrationNo: string | null;
    accreditation: string | null;
    logoUrl: string | null;
    footerNote: string | null;
  };
}

// ---------- events ----------

/** `lab.report.verified`: every result of the order is verified. The patient portal lists it. */
export interface ReportVerifiedEvent {
  reportId: string;
  orderId: string;
  orderNo: string;
  patientId: string;
  doctorId: string | null;
  title: string;
  /** Web path of the printable report. */
  url: string;
  issuedAt: string;
}

/** `lab.result.critical`: a critical value was entered; notify the doctor. */
export interface ResultCriticalEvent {
  orderId: string;
  orderNo: string;
  resultId: string;
  patientId: string;
  doctorId: string | null;
  testName: string;
  value: string;
  unit: string | null;
  flag: 'critical_low' | 'critical_high';
}

/**
 * `lab.order.status_changed`: one event per EMR order line (emrOrderId = clinical.encounter_orders.id)
 * when a lab order made from a consultation moves on. EMR shows it on the consultation.
 */
export interface OrderStatusChangedEvent {
  orderId: string;
  emrOrderId: string;
  encounterId: string | null;
  patientId: string;
  status: 'collected' | 'processing' | 'completed' | 'cancelled';
}

/** `lab.order.created`. */
export interface OrderCreatedEvent {
  orderId: string;
  orderNo: string;
  patientId: string;
  source: OrderSource;
  encounterId: string | null;
  invoiceId: string | null;
}
