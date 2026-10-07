import { z } from 'zod';
import { defineModule } from '../manifest';
import { payNowSchema } from './billing';

/**
 * Radiology (RIS): permissions and API contracts (Zod schemas + types).
 * Owned by the "radiology" workstream.
 */
export const radiologyModule = defineModule({
  key: 'radiology',
  name: 'Radiology',
  permissions: [
    { key: 'radiology.master.read', description: 'View modalities, radiology tests and report templates' },
    { key: 'radiology.master.manage', description: 'Create and edit modalities, radiology tests and report templates' },
    { key: 'radiology.order.read', description: 'View radiology orders, the worklist and the schedule' },
    { key: 'radiology.order.create', description: 'Create radiology orders and change them before the scan' },
    { key: 'radiology.order.schedule', description: 'Schedule studies and mark them started or done on the machine' },
    { key: 'radiology.order.cancel', description: 'Cancel radiology orders' },
    { key: 'radiology.order.bill', description: 'Raise the bill for a radiology order' },
    { key: 'radiology.report.read', description: 'View and print radiology reports' },
    { key: 'radiology.report.write', description: 'Write and edit draft radiology reports' },
    { key: 'radiology.report.finalize', description: 'Finalize (sign) and amend radiology reports' },
  ],
  grants: {
    hospital_admin: [
      'radiology.master.read', 'radiology.master.manage', 'radiology.order.read', 'radiology.order.create',
      'radiology.order.schedule', 'radiology.order.cancel', 'radiology.order.bill', 'radiology.report.read',
    ],
    radiologist: [
      'radiology.master.read', 'radiology.master.manage', 'radiology.order.read', 'radiology.order.create',
      'radiology.order.schedule', 'radiology.order.cancel', 'radiology.report.read', 'radiology.report.write',
      'radiology.report.finalize',
    ],
    doctor: ['radiology.master.read', 'radiology.order.read', 'radiology.order.create', 'radiology.report.read'],
    receptionist: [
      'radiology.master.read', 'radiology.order.read', 'radiology.order.create', 'radiology.order.schedule',
      'radiology.order.cancel', 'radiology.order.bill',
    ],
    billing_clerk: ['radiology.master.read', 'radiology.order.read', 'radiology.order.bill'],
    nurse: ['radiology.order.read', 'radiology.report.read'],
    owner: ['radiology.master.read', 'radiology.order.read', 'radiology.report.read'],
  },
});

// ---------- enums ----------

export const MODALITY_KINDS = ['XR', 'CT', 'MR', 'US', 'MG', 'DX', 'RF', 'NM', 'ECHO', 'OTHER'] as const;
export const MODALITY_KIND_LABELS: Record<(typeof MODALITY_KINDS)[number], string> = {
  XR: 'X-ray',
  CT: 'CT scan',
  MR: 'MRI',
  US: 'Ultrasound',
  MG: 'Mammography',
  DX: 'DEXA / bone density',
  RF: 'Fluoroscopy',
  NM: 'Nuclear medicine',
  ECHO: 'Echo',
  OTHER: 'Other',
};

export const ORDER_PRIORITIES = ['routine', 'urgent', 'stat'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

/**
 * ordered → scheduled → in_progress (on the machine) → acquired (scan done, awaiting report)
 * → reported (draft saved) → finalized. Any state before finalized can be cancelled.
 */
export const ORDER_STATUSES = ['ordered', 'scheduled', 'in_progress', 'acquired', 'reported', 'finalized', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const ORDER_SOURCES = ['emr', 'desk'] as const;

export const REPORT_STATUSES = ['draft', 'final', 'superseded'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => text(max).optional().or(z.literal('').transform(() => undefined));
const money = z.coerce.number().min(0).max(10_000_000).multipleOf(0.01);

// ---------- modalities ----------

export const modalityInputSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20).regex(/^[A-Z0-9_-]+$/, 'Use letters, digits, - or _'),
  name: text(100).min(1),
  kind: z.enum(MODALITY_KINDS),
  facilityId: z.uuid().optional().nullable(),
  room: optionalText(60),
  /** DICOM AE title of the machine, for the PACS / modality worklist link. */
  aeTitle: optionalText(16),
  isActive: z.boolean().default(true),
});
export type ModalityInput = z.input<typeof modalityInputSchema>;
export const updateModalitySchema = modalityInputSchema.partial();
export type UpdateModality = z.input<typeof updateModalitySchema>;

export interface Modality {
  id: string;
  code: string;
  name: string;
  kind: (typeof MODALITY_KINDS)[number];
  facilityId: string | null;
  room: string | null;
  aeTitle: string | null;
  isActive: boolean;
}

// ---------- tests (study master) ----------

export const testInputSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(30).regex(/^[A-Z0-9_.-]+$/, 'Use letters, digits, ., - or _'),
  name: text(200).min(1),
  modalityId: z.uuid(),
  bodyPart: optionalText(60),
  /** Billing service code. When set, the price comes from billing's service master and price lists. */
  serviceCode: z.string().trim().toUpperCase().max(40).optional().or(z.literal('').transform(() => undefined)),
  /** Used when no service code is set. */
  price: money.optional(),
  taxRate: z.coerce.number().min(0).max(28).default(0),
  durationMinutes: z.coerce.number().int().min(5).max(480).default(15),
  contrast: z.boolean().default(false),
  /** Patient preparation, printed on the appointment slip (e.g. "6 hours fasting"). */
  preparation: optionalText(500),
  defaultTemplateId: z.uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});
export type TestInput = z.input<typeof testInputSchema>;
export const updateTestSchema = testInputSchema.partial();
export type UpdateTest = z.input<typeof updateTestSchema>;

export interface RadiologyTest {
  id: string;
  code: string;
  name: string;
  modalityId: string;
  modalityCode: string;
  modalityName: string;
  bodyPart: string | null;
  serviceCode: string | null;
  price: number | null;
  taxRate: number;
  durationMinutes: number;
  contrast: boolean;
  preparation: string | null;
  defaultTemplateId: string | null;
  isActive: boolean;
}

export const masterQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  modalityId: z.uuid().optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export type MasterQuery = z.input<typeof masterQuerySchema>;

// ---------- report templates ----------

export const templateInputSchema = z.object({
  name: text(120).min(1),
  modalityId: z.uuid().optional().nullable(),
  technique: optionalText(4000),
  findings: optionalText(20000),
  impression: optionalText(4000),
  isActive: z.boolean().default(true),
});
export type TemplateInput = z.input<typeof templateInputSchema>;
export const updateTemplateSchema = templateInputSchema.partial();
export type UpdateTemplate = z.input<typeof updateTemplateSchema>;

export interface ReportTemplate {
  id: string;
  name: string;
  modalityId: string | null;
  technique: string | null;
  findings: string | null;
  impression: string | null;
  isActive: boolean;
}

// ---------- orders ----------

export const createOrderSchema = z.object({
  patientId: z.uuid(),
  testId: z.uuid(),
  /** Defaults to the facility in the request (X-Facility-Id). */
  facilityId: z.uuid().optional(),
  priority: z.enum(ORDER_PRIORITIES).default('routine'),
  referringDoctorId: z.uuid().optional(),
  /** Outside doctor, when the patient walks in with a referral slip. */
  referringDoctorName: optionalText(120),
  clinicalNotes: optionalText(1000),
});
export type CreateOrder = z.input<typeof createOrderSchema>;

export const updateOrderSchema = createOrderSchema.pick({ testId: true, priority: true, referringDoctorName: true, clinicalNotes: true }).partial();
export type UpdateOrder = z.input<typeof updateOrderSchema>;

export const scheduleOrderSchema = z.object({
  scheduledAt: z.iso.datetime({ offset: true }),
  /** Defaults to the test's modality. Pick another machine of the same kind if needed. */
  modalityId: z.uuid().optional(),
});
export type ScheduleOrder = z.input<typeof scheduleOrderSchema>;

export const completeScanSchema = z.object({
  /** DICOM Study Instance UID from the machine / PACS. */
  studyUid: optionalText(128),
  /** Viewer link (PACS / OHIF). */
  imagesUrl: z.url().max(1000).optional().or(z.literal('').transform(() => undefined)),
  techNotes: optionalText(1000),
});
export type CompleteScan = z.input<typeof completeScanSchema>;

export const cancelOrderSchema = z.object({ reason: text(500).min(3) });
export type CancelOrder = z.input<typeof cancelOrderSchema>;

export const billOrderSchema = z.object({ payNow: payNowSchema.optional() });
export type BillOrder = z.input<typeof billOrderSchema>;

export const orderQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  /** Comma-separated statuses, e.g. `acquired,reported` for the reporting worklist. */
  statuses: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(ORDER_STATUSES)).optional()),
  modalityId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  /** Orders created or scheduled on this day (Asia/Kolkata). */
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type OrderQuery = z.input<typeof orderQuerySchema>;

export interface OrderPatient {
  id: string;
  uhid: string;
  name: string;
  gender: string;
  ageYears: number | null;
  mobile: string | null;
}

export interface RadiologyOrder {
  id: string;
  orderNo: string;
  facilityId: string;
  patient: OrderPatient;
  testId: string | null;
  testCode: string | null;
  studyName: string;
  modalityId: string | null;
  modalityName: string | null;
  priority: OrderPriority;
  status: OrderStatus;
  source: (typeof ORDER_SOURCES)[number];
  encounterId: string | null;
  emrOrderId: string | null;
  referringDoctorId: string | null;
  referringDoctorName: string | null;
  clinicalNotes: string | null;
  scheduledAt: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  acquiredAt: string | null;
  studyUid: string | null;
  imagesUrl: string | null;
  techNotes: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  cancelReason: string | null;
  finalReportId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const scheduleQuerySchema = z.object({
  date: z.iso.date(),
  modalityId: z.uuid().optional(),
});
export type ScheduleQuery = z.input<typeof scheduleQuerySchema>;

export interface ScheduleEntry {
  orderId: string;
  orderNo: string;
  modalityId: string;
  patientName: string;
  uhid: string;
  studyName: string;
  status: OrderStatus;
  priority: OrderPriority;
  scheduledAt: string;
  scheduledEnd: string;
}

// ---------- reports ----------

export const saveReportSchema = z.object({
  templateId: z.uuid().optional(),
  technique: optionalText(4000),
  findings: text(20000).min(1, 'Write the findings'),
  impression: text(4000).min(1, 'Write the impression'),
  isCritical: z.boolean().default(false),
});
export type SaveReport = z.input<typeof saveReportSchema>;

export const amendReportSchema = z.object({ reason: text(500).min(3) });
export type AmendReport = z.input<typeof amendReportSchema>;

export interface RadiologyReport {
  id: string;
  orderId: string;
  version: number;
  status: ReportStatus;
  templateId: string | null;
  technique: string | null;
  findings: string;
  impression: string;
  isCritical: boolean;
  amendmentReason: string | null;
  authorId: string | null;
  authorName: string | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  finalizedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Everything a printed report needs. */
export interface ReportDocument {
  report: RadiologyReport;
  order: RadiologyOrder;
  /** Earlier versions, newest first (amended reports keep their history). */
  history: Pick<RadiologyReport, 'id' | 'version' | 'status' | 'finalizedAt' | 'finalizedByName' | 'amendmentReason'>[];
}

export interface OrderWithReports {
  order: RadiologyOrder;
  /** All versions, newest first. */
  reports: RadiologyReport[];
}

// ---------- events (published by radiology) ----------

/** `radiology.report.finalized`: a report was signed (also for each amended version). Portal listens. */
export interface ReportFinalizedEvent {
  reportId: string;
  patientId: string;
  title: string;
  url?: string;
  issuedAt: string;
  orderId: string;
  version: number;
  isCritical: boolean;
  referringDoctorId: string | null;
  facilityId: string;
}

/** `radiology.order.status_changed`: lets EMR mirror the status on its order line. */
export interface OrderStatusChangedEvent {
  orderId: string;
  emrOrderId: string | null;
  encounterId: string | null;
  patientId: string;
  status: OrderStatus;
}

/** `radiology.report.critical`: finalized with a critical finding; tell the referring doctor. */
export interface CriticalFindingEvent {
  reportId: string;
  orderId: string;
  patientId: string;
  referringDoctorId: string | null;
  studyName: string;
  impression: string;
}

// ---------- starter masters ----------

export interface StarterTest {
  code: string;
  name: string;
  modality: string;
  bodyPart?: string;
  price: number;
  durationMinutes: number;
  contrast?: boolean;
  preparation?: string;
}

/** Common Indian diagnostic-centre list loaded by POST /radiology/masters/starter. Prices are editable. */
export const STARTER_MODALITIES: { code: string; name: string; kind: (typeof MODALITY_KINDS)[number] }[] = [
  { code: 'XR1', name: 'X-ray room 1', kind: 'XR' },
  { code: 'USG1', name: 'Ultrasound 1', kind: 'US' },
  { code: 'CT1', name: 'CT scanner', kind: 'CT' },
  { code: 'MRI1', name: 'MRI 1.5T', kind: 'MR' },
];

export const STARTER_TESTS: StarterTest[] = [
  { code: 'XR-CHEST-PA', name: 'X-ray chest PA view', modality: 'XR1', bodyPart: 'Chest', price: 400, durationMinutes: 10 },
  { code: 'XR-CHEST-AP-LAT', name: 'X-ray chest AP and lateral', modality: 'XR1', bodyPart: 'Chest', price: 600, durationMinutes: 10 },
  { code: 'XR-LS-SPINE', name: 'X-ray lumbosacral spine AP/LAT', modality: 'XR1', bodyPart: 'Spine', price: 700, durationMinutes: 15 },
  { code: 'XR-KNEE', name: 'X-ray knee AP/LAT', modality: 'XR1', bodyPart: 'Knee', price: 500, durationMinutes: 10 },
  { code: 'XR-PNS', name: 'X-ray PNS (Waters view)', modality: 'XR1', bodyPart: 'Sinuses', price: 450, durationMinutes: 10 },
  { code: 'XR-ABD', name: 'X-ray abdomen erect', modality: 'XR1', bodyPart: 'Abdomen', price: 500, durationMinutes: 10 },
  { code: 'USG-ABD', name: 'USG whole abdomen', modality: 'USG1', bodyPart: 'Abdomen', price: 1200, durationMinutes: 20, preparation: '6 hours fasting, full bladder' },
  { code: 'USG-PELVIS', name: 'USG pelvis', modality: 'USG1', bodyPart: 'Pelvis', price: 900, durationMinutes: 15, preparation: 'Full bladder' },
  { code: 'USG-OBS', name: 'USG obstetric', modality: 'USG1', bodyPart: 'Pelvis', price: 1200, durationMinutes: 20 },
  { code: 'USG-THYROID', name: 'USG neck / thyroid', modality: 'USG1', bodyPart: 'Neck', price: 1000, durationMinutes: 15 },
  { code: 'CT-BRAIN', name: 'CT brain plain', modality: 'CT1', bodyPart: 'Head', price: 2500, durationMinutes: 15 },
  { code: 'CT-BRAIN-C', name: 'CT brain plain + contrast', modality: 'CT1', bodyPart: 'Head', price: 4000, durationMinutes: 30, contrast: true, preparation: '4 hours fasting; bring serum creatinine report' },
  { code: 'CT-CHEST-HR', name: 'HRCT chest', modality: 'CT1', bodyPart: 'Chest', price: 4500, durationMinutes: 20 },
  { code: 'CT-KUB', name: 'CT KUB plain', modality: 'CT1', bodyPart: 'Abdomen', price: 4000, durationMinutes: 20 },
  { code: 'MRI-BRAIN', name: 'MRI brain plain', modality: 'MRI1', bodyPart: 'Head', price: 6500, durationMinutes: 45, preparation: 'Remove all metal; tell staff about implants or pacemaker' },
  { code: 'MRI-LS-SPINE', name: 'MRI lumbosacral spine', modality: 'MRI1', bodyPart: 'Spine', price: 6500, durationMinutes: 45, preparation: 'Remove all metal; tell staff about implants or pacemaker' },
  { code: 'MRI-KNEE', name: 'MRI knee', modality: 'MRI1', bodyPart: 'Knee', price: 6000, durationMinutes: 40, preparation: 'Remove all metal; tell staff about implants or pacemaker' },
];

export const STARTER_TEMPLATES: { name: string; modality: string | null; technique: string; findings: string; impression: string }[] = [
  {
    name: 'Chest X-ray normal',
    modality: 'XR1',
    technique: 'PA view of the chest.',
    findings:
      'Both lung fields are clear.\nBoth hila are normal.\nCardiac size and configuration are normal.\nBoth costophrenic angles are clear.\nBoth domes of the diaphragm are normal.\nBony thoracic cage and soft tissues are normal.',
    impression: 'No significant abnormality detected.',
  },
  {
    name: 'USG abdomen normal',
    modality: 'USG1',
    technique: 'Real-time B-mode ultrasound of the whole abdomen.',
    findings:
      'Liver: normal in size and echotexture. No focal lesion. IHBR not dilated.\nGall bladder: well distended, no calculus, wall normal.\nCBD: normal calibre.\nPancreas: normal.\nSpleen: normal in size and echotexture.\nKidneys: both normal in size and echotexture; corticomedullary differentiation maintained; no calculus or hydronephrosis.\nUrinary bladder: well distended, wall normal, no calculus.\nNo free fluid in the peritoneal cavity.',
    impression: 'No significant abnormality detected.',
  },
  {
    name: 'CT brain normal',
    modality: 'CT1',
    technique: 'Axial non-contrast sections of the brain from skull base to vertex.',
    findings:
      'Brain parenchyma shows normal attenuation. Grey-white differentiation is maintained.\nVentricles and sulci are normal for age.\nNo intracranial haemorrhage, mass effect or midline shift.\nPosterior fossa structures are normal.\nCalvarium is intact.',
    impression: 'No acute intracranial abnormality.',
  },
];
