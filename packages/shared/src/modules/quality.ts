import { z } from 'zod';
import { defineModule } from '../manifest';

/**
 * Quality & NABH: permissions and API contracts (Zod schemas + types).
 * Owned by the "quality" workstream.
 *
 * Covers incident / near-miss reporting (anonymous allowed), patient complaints with TAT,
 * hospital-acquired infection (HAI) surveillance with daily census denominators, audits against
 * checklists, CAPA tracking, the NABH document library and NABH quality indicators.
 * Indicators are computed from this module's own records and from other modules' events
 * (never their tables); the rest are entered monthly.
 */
export const qualityModule = defineModule({
  key: 'quality',
  name: 'Quality & NABH',
  permissions: [
    { key: 'quality.incident.report', description: 'Report incidents and near misses; see own reports' },
    { key: 'quality.incident.read', description: 'View all incident reports' },
    { key: 'quality.incident.manage', description: 'Review, investigate and close incidents' },
    { key: 'quality.complaint.create', description: 'Register patient complaints' },
    { key: 'quality.complaint.read', description: 'View patient complaints' },
    { key: 'quality.complaint.manage', description: 'Assign, resolve and close complaints' },
    { key: 'quality.hai.read', description: 'View hospital-acquired infection cases' },
    { key: 'quality.hai.manage', description: 'Record and update hospital-acquired infection cases' },
    { key: 'quality.census.manage', description: 'Enter daily census and device days' },
    { key: 'quality.audit.read', description: 'View audits and checklists' },
    { key: 'quality.audit.conduct', description: 'Schedule and conduct audits' },
    { key: 'quality.checklist.manage', description: 'Create and edit audit checklists' },
    { key: 'quality.capa.read', description: 'View corrective and preventive actions' },
    { key: 'quality.capa.manage', description: 'Create, update and verify corrective and preventive actions' },
    { key: 'quality.document.read', description: 'Read approved NABH documents (policies, SOPs, forms)' },
    { key: 'quality.document.manage', description: 'Draft, approve and archive NABH documents' },
    { key: 'quality.indicator.read', description: 'View NABH quality indicators' },
    { key: 'quality.indicator.manage', description: 'Enter monthly values for manual indicators' },
  ],
  grants: {
    hospital_admin: [
      'quality.incident.report', 'quality.incident.read', 'quality.incident.manage', 'quality.complaint.create',
      'quality.complaint.read', 'quality.complaint.manage', 'quality.hai.read', 'quality.hai.manage', 'quality.census.manage',
      'quality.audit.read', 'quality.audit.conduct', 'quality.checklist.manage', 'quality.capa.read', 'quality.capa.manage',
      'quality.document.read', 'quality.document.manage', 'quality.indicator.read', 'quality.indicator.manage',
    ],
    quality_manager: [
      'quality.incident.report', 'quality.incident.read', 'quality.incident.manage', 'quality.complaint.create',
      'quality.complaint.read', 'quality.complaint.manage', 'quality.hai.read', 'quality.hai.manage', 'quality.census.manage',
      'quality.audit.read', 'quality.audit.conduct', 'quality.checklist.manage', 'quality.capa.read', 'quality.capa.manage',
      'quality.document.read', 'quality.document.manage', 'quality.indicator.read', 'quality.indicator.manage',
    ],
    owner: [
      'quality.incident.report', 'quality.incident.read', 'quality.complaint.read', 'quality.hai.read', 'quality.audit.read',
      'quality.capa.read', 'quality.document.read', 'quality.indicator.read',
    ],
    doctor: ['quality.incident.report', 'quality.hai.read', 'quality.document.read', 'quality.indicator.read'],
    nurse: [
      'quality.incident.report', 'quality.complaint.create', 'quality.hai.read', 'quality.hai.manage', 'quality.census.manage',
      'quality.audit.read', 'quality.audit.conduct', 'quality.document.read',
    ],
    receptionist: ['quality.incident.report', 'quality.complaint.create', 'quality.document.read'],
    pharmacist: ['quality.incident.report', 'quality.document.read'],
    lab_technician: ['quality.incident.report', 'quality.document.read'],
    radiologist: ['quality.incident.report', 'quality.document.read'],
    billing_clerk: ['quality.incident.report', 'quality.complaint.create', 'quality.document.read'],
    accountant: ['quality.incident.report', 'quality.document.read'],
    store_keeper: ['quality.incident.report', 'quality.document.read'],
    hr_manager: ['quality.incident.report', 'quality.document.read'],
  },
});

// ---------- shared bits ----------

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
const isoDate = z.iso.date();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export interface Person {
  id: string;
  name: string;
}
export interface PatientRef {
  id: string;
  uhid: string;
  name: string;
}
export interface Activity {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  note: string | null;
  actor: Person | null;
  createdAt: string;
}

// ---------- incidents ----------

export const INCIDENT_KINDS = ['near_miss', 'incident', 'adverse_event', 'sentinel_event'] as const;
export const INCIDENT_CATEGORIES = [
  'medication_error', 'adverse_drug_reaction', 'patient_fall', 'needle_stick_injury', 'wrong_patient',
  'wrong_site_surgery', 'transfusion_reaction', 'pressure_ulcer', 'equipment_failure', 'fire_safety',
  'violence', 'documentation', 'infection_control', 'other',
] as const;
export const INCIDENT_SEVERITIES = ['no_harm', 'mild', 'moderate', 'severe', 'death'] as const;
export const INCIDENT_STATUSES = ['reported', 'under_review', 'action_planned', 'closed', 'rejected'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export type IncidentCategory = (typeof INCIDENT_CATEGORIES)[number];
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

/** reported → under_review → action_planned → closed; reported/under_review → rejected (not an incident). */
export const INCIDENT_TRANSITIONS: Record<IncidentStatus, readonly IncidentStatus[]> = {
  reported: ['under_review', 'rejected'],
  under_review: ['action_planned', 'closed', 'rejected'],
  action_planned: ['closed'],
  closed: [],
  rejected: [],
};

export const reportIncidentSchema = z.object({
  kind: z.enum(INCIDENT_KINDS),
  category: z.enum(INCIDENT_CATEGORIES),
  severity: z.enum(INCIDENT_SEVERITIES),
  occurredAt: z.iso.datetime({ offset: true }).refine((v) => new Date(v).getTime() <= Date.now() + 5 * 60_000, 'Cannot be in the future'),
  location: optionalText(200),
  department: optionalText(120),
  patientId: z.uuid().optional(),
  description: text(5000),
  immediateAction: optionalText(2000),
  anonymous: z.boolean().default(false),
});
export type ReportIncident = z.input<typeof reportIncidentSchema>;

export const reviewIncidentSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  assignedTo: z.uuid().nullable().optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  kind: z.enum(INCIDENT_KINDS).optional(),
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  rootCause: optionalText(5000),
  contributingFactors: z.array(text(120)).max(20).optional(),
  /** Required when closing or rejecting. */
  note: optionalText(2000),
});
export type ReviewIncident = z.input<typeof reviewIncidentSchema>;

export const incidentQuerySchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  kind: z.enum(INCIDENT_KINDS).optional(),
  category: z.enum(INCIDENT_CATEGORIES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  ...pageFields,
});
export type IncidentQuery = Partial<z.input<typeof incidentQuerySchema>>;

export interface IncidentSummary {
  id: string;
  incidentNo: string;
  kind: IncidentKind;
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: string;
  reportedAt: string;
  location: string | null;
  department: string | null;
  patient: PatientRef | null;
  isAnonymous: boolean;
  reportedBy: Person | null;
  assignedTo: Person | null;
  openCapas: number;
}
export interface Incident extends IncidentSummary {
  facilityId: string | null;
  description: string;
  immediateAction: string | null;
  rootCause: string | null;
  contributingFactors: string[];
  closureNote: string | null;
  closedAt: string | null;
  capas: CapaSummary[];
  activity: Activity[];
}

/** Event payloads published by quality. */
export interface IncidentReportedEvent {
  incidentId: string;
  incidentNo: string;
  facilityId: string | null;
  kind: IncidentKind;
  category: IncidentCategory;
  severity: IncidentSeverity;
  patientId: string | null;
}
export interface IncidentClosedEvent {
  incidentId: string;
  incidentNo: string;
  status: 'closed' | 'rejected';
}

// ---------- complaints ----------

export const COMPLAINT_SOURCES = ['walk_in', 'phone', 'email', 'feedback_form', 'portal', 'social_media', 'other'] as const;
export const COMPLAINT_CATEGORIES = ['clinical_care', 'staff_behaviour', 'waiting_time', 'billing', 'cleanliness', 'food', 'facilities', 'other'] as const;
export const COMPLAINT_PRIORITIES = ['low', 'medium', 'high'] as const;
export const COMPLAINT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];
export type ComplaintCategory = (typeof COMPLAINT_CATEGORIES)[number];
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

/** Turnaround time to resolve, by priority. */
export const COMPLAINT_TAT_HOURS: Record<ComplaintPriority, number> = { high: 24, medium: 72, low: 168 };

/** open → in_progress → resolved → closed; resolved → in_progress (reopen). */
export const COMPLAINT_TRANSITIONS: Record<ComplaintStatus, readonly ComplaintStatus[]> = {
  open: ['in_progress', 'resolved'],
  in_progress: ['resolved'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

export const createComplaintSchema = z.object({
  source: z.enum(COMPLAINT_SOURCES),
  category: z.enum(COMPLAINT_CATEGORIES),
  priority: z.enum(COMPLAINT_PRIORITIES).default('medium'),
  patientId: z.uuid().optional(),
  complainantName: text(120),
  complainantMobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number').optional(),
  department: optionalText(120),
  description: text(5000),
});
export type CreateComplaint = z.input<typeof createComplaintSchema>;

export const updateComplaintSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(),
  assignedTo: z.uuid().nullable().optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
  /** Required when resolving. */
  resolution: optionalText(5000),
  note: optionalText(2000),
});
export type UpdateComplaint = z.input<typeof updateComplaintSchema>;

export const complaintQuerySchema = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(),
  category: z.enum(COMPLAINT_CATEGORIES).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  ...pageFields,
});
export type ComplaintQuery = Partial<z.input<typeof complaintQuerySchema>>;

export interface ComplaintSummary {
  id: string;
  complaintNo: string;
  source: ComplaintSource;
  category: ComplaintCategory;
  priority: ComplaintPriority;
  status: ComplaintStatus;
  complainantName: string;
  patient: PatientRef | null;
  department: string | null;
  dueAt: string;
  overdue: boolean;
  assignedTo: Person | null;
  createdAt: string;
  resolvedAt: string | null;
}
export interface Complaint extends ComplaintSummary {
  complainantMobile: string | null;
  description: string;
  resolution: string | null;
  closedAt: string | null;
  withinTat: boolean | null;
  capas: CapaSummary[];
  activity: Activity[];
}
export interface ComplaintRegisteredEvent {
  complaintId: string;
  complaintNo: string;
  patientId: string | null;
  priority: ComplaintPriority;
  category: ComplaintCategory;
}
export interface ComplaintResolvedEvent {
  complaintId: string;
  complaintNo: string;
  patientId: string | null;
  complainantMobile: string | null;
}

// ---------- hospital-acquired infections ----------

export const HAI_TYPES = ['cauti', 'clabsi', 'vap', 'ssi', 'other'] as const;
export const HAI_STATUSES = ['suspected', 'confirmed', 'ruled_out'] as const;
export type HaiType = (typeof HAI_TYPES)[number];
export type HaiStatus = (typeof HAI_STATUSES)[number];

export const createHaiSchema = z.object({
  patientId: z.uuid(),
  infectionType: z.enum(HAI_TYPES),
  ward: optionalText(80),
  onsetDate: isoDate,
  deviceInsertedOn: isoDate.optional(),
  procedureName: optionalText(200),
  organism: optionalText(200),
  cultureRef: optionalText(80),
  status: z.enum(HAI_STATUSES).default('suspected'),
  notes: optionalText(2000),
});
export type CreateHai = z.input<typeof createHaiSchema>;
export const updateHaiSchema = createHaiSchema.omit({ patientId: true }).partial();
export type UpdateHai = z.input<typeof updateHaiSchema>;

export const haiQuerySchema = z.object({
  infectionType: z.enum(HAI_TYPES).optional(),
  status: z.enum(HAI_STATUSES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pageFields,
});
export type HaiQuery = Partial<z.input<typeof haiQuerySchema>>;

export interface HaiCase {
  id: string;
  caseNo: string;
  patient: PatientRef;
  infectionType: HaiType;
  ward: string | null;
  onsetDate: string;
  deviceInsertedOn: string | null;
  procedureName: string | null;
  organism: string | null;
  cultureRef: string | null;
  status: HaiStatus;
  notes: string | null;
  createdAt: string;
}

export const censusInputSchema = z.object({
  day: isoDate,
  ward: z.string().trim().min(1).max(80).default('All'),
  patientDays: z.coerce.number().int().min(0).max(100000),
  catheterDays: z.coerce.number().int().min(0).max(100000).default(0),
  centralLineDays: z.coerce.number().int().min(0).max(100000).default(0),
  ventilatorDays: z.coerce.number().int().min(0).max(100000).default(0),
  surgeries: z.coerce.number().int().min(0).max(100000).default(0),
});
export type CensusInput = z.input<typeof censusInputSchema>;
export interface CensusDay {
  id: string;
  day: string;
  ward: string;
  patientDays: number;
  catheterDays: number;
  centralLineDays: number;
  ventilatorDays: number;
  surgeries: number;
}

// ---------- checklists and audits ----------

export const CHECKLIST_CATEGORIES = [
  'hand_hygiene', 'infection_control', 'medication_safety', 'documentation', 'patient_safety', 'facility_safety', 'clinical', 'other',
] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];
export const AUDIT_RESULTS = ['yes', 'no', 'na'] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];
export const AUDIT_STATUSES = ['scheduled', 'completed', 'cancelled'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export interface ChecklistItem {
  id: string;
  text: string;
}
export const checklistInputSchema = z.object({
  name: text(160),
  category: z.enum(CHECKLIST_CATEGORIES),
  items: z.array(text(500)).min(1).max(200),
  isActive: z.boolean().default(true),
});
export type ChecklistInput = z.input<typeof checklistInputSchema>;
export interface Checklist {
  id: string;
  name: string;
  category: ChecklistCategory;
  items: ChecklistItem[];
  isActive: boolean;
  updatedAt: string;
}

export const scheduleAuditSchema = z.object({
  checklistId: z.uuid(),
  scheduledOn: isoDate,
  department: optionalText(120),
  auditorId: z.uuid().optional(),
});
export type ScheduleAudit = z.input<typeof scheduleAuditSchema>;

export const submitAuditSchema = z.object({
  responses: z
    .array(z.object({ itemId: z.string().min(1).max(20), result: z.enum(AUDIT_RESULTS), remark: optionalText(500) }))
    .min(1),
  summary: optionalText(2000),
});
export type SubmitAudit = z.input<typeof submitAuditSchema>;

export const auditQuerySchema = z.object({
  status: z.enum(AUDIT_STATUSES).optional(),
  category: z.enum(CHECKLIST_CATEGORIES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  ...pageFields,
});
export type AuditQuery = Partial<z.input<typeof auditQuerySchema>>;

export interface AuditSummary {
  id: string;
  auditNo: string;
  checklistId: string;
  checklistName: string;
  category: ChecklistCategory;
  department: string | null;
  scheduledOn: string;
  status: AuditStatus;
  score: number | null;
  auditor: Person | null;
  conductedAt: string | null;
}
export interface Audit extends AuditSummary {
  items: (ChecklistItem & { result: AuditResult | null; remark: string | null })[];
  summary: string | null;
  nonCompliant: number;
  capas: CapaSummary[];
}

// ---------- CAPA ----------

export const CAPA_SOURCES = ['incident', 'complaint', 'audit', 'hai', 'indicator', 'other'] as const;
export const CAPA_STATUSES = ['open', 'in_progress', 'completed', 'verified', 'cancelled'] as const;
export type CapaSource = (typeof CAPA_SOURCES)[number];
export type CapaStatus = (typeof CAPA_STATUSES)[number];

/** open → in_progress → completed → verified; completed → in_progress (not effective); open/in_progress → cancelled. */
export const CAPA_TRANSITIONS: Record<CapaStatus, readonly CapaStatus[]> = {
  open: ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: ['verified', 'in_progress'],
  verified: [],
  cancelled: [],
};

export const createCapaSchema = z
  .object({
    sourceType: z.enum(CAPA_SOURCES),
    sourceId: z.uuid().optional(),
    title: text(200),
    problem: text(5000),
    rootCause: optionalText(5000),
    correctiveAction: optionalText(5000),
    preventiveAction: optionalText(5000),
    ownerId: z.uuid().optional(),
    dueDate: isoDate,
  })
  .refine((v) => v.sourceType === 'other' || v.sourceType === 'indicator' || v.sourceId, {
    message: 'Pick the record this action is for',
    path: ['sourceId'],
  });
export type CreateCapa = z.input<typeof createCapaSchema>;

export const updateCapaSchema = z.object({
  status: z.enum(CAPA_STATUSES).optional(),
  title: text(200).optional(),
  rootCause: optionalText(5000),
  correctiveAction: optionalText(5000),
  preventiveAction: optionalText(5000),
  ownerId: z.uuid().nullable().optional(),
  dueDate: isoDate.optional(),
  /** Completion note (completed) or effectiveness check (verified, back to in_progress). */
  note: optionalText(2000),
});
export type UpdateCapa = z.input<typeof updateCapaSchema>;

export const capaQuerySchema = z.object({
  status: z.enum(CAPA_STATUSES).optional(),
  sourceType: z.enum(CAPA_SOURCES).optional(),
  sourceId: z.uuid().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  mine: z.enum(['true', 'false']).optional(),
  ...pageFields,
});
export type CapaQuery = Partial<z.input<typeof capaQuerySchema>>;

export interface CapaSummary {
  id: string;
  capaNo: string;
  sourceType: CapaSource;
  sourceId: string | null;
  title: string;
  owner: Person | null;
  dueDate: string;
  status: CapaStatus;
  overdue: boolean;
}
export interface Capa extends CapaSummary {
  problem: string;
  rootCause: string | null;
  correctiveAction: string | null;
  preventiveAction: string | null;
  completionNote: string | null;
  completedAt: string | null;
  effectivenessNote: string | null;
  verifiedAt: string | null;
  verifiedBy: Person | null;
  sourceLabel: string | null;
  activity: Activity[];
  createdAt: string;
}

// ---------- NABH documents ----------

/** NABH 5th edition chapters. */
export const NABH_CHAPTERS = {
  AAC: 'Access, Assessment and Continuity of Care',
  COP: 'Care of Patients',
  MOM: 'Management of Medication',
  PRE: 'Patient Rights and Education',
  HIC: 'Hospital Infection Control',
  PSQ: 'Patient Safety and Quality Improvement',
  ROM: 'Responsibilities of Management',
  FMS: 'Facility Management and Safety',
  HRM: 'Human Resource Management',
  IMS: 'Information Management System',
} as const;
export type NabhChapter = keyof typeof NABH_CHAPTERS;
const chapterEnum = z.enum(Object.keys(NABH_CHAPTERS) as [NabhChapter, ...NabhChapter[]]);
export const DOCUMENT_TYPES = ['policy', 'sop', 'manual', 'plan', 'form', 'register', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_STATUSES = ['draft', 'approved', 'archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const createDocumentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_./-]{0,39}$/, 'Letters, digits and _ . / - only (e.g. HIC-POL-01)'),
  title: text(200),
  chapter: chapterEnum,
  docType: z.enum(DOCUMENT_TYPES),
  department: optionalText(120),
  content: z.string().max(200_000).optional(),
  fileUrl: z.url().max(1000).optional(),
  effectiveFrom: isoDate.optional(),
  reviewDue: isoDate.optional(),
});
export type CreateDocument = z.input<typeof createDocumentSchema>;
export const updateDocumentSchema = createDocumentSchema.omit({ code: true }).partial();
export type UpdateDocument = z.input<typeof updateDocumentSchema>;

export const documentQuerySchema = z.object({
  chapter: chapterEnum.optional(),
  docType: z.enum(DOCUMENT_TYPES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  reviewDue: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
  ...pageFields,
});
export type DocumentQuery = Partial<z.input<typeof documentQuerySchema>>;

export interface DocumentSummary {
  id: string;
  code: string;
  version: number;
  title: string;
  chapter: NabhChapter;
  docType: DocumentType;
  department: string | null;
  status: DocumentStatus;
  effectiveFrom: string | null;
  reviewDue: string | null;
  reviewOverdue: boolean;
  approvedBy: Person | null;
  approvedAt: string | null;
  updatedAt: string;
}
export interface QualityDocument extends DocumentSummary {
  content: string | null;
  fileUrl: string | null;
  versions: { id: string; version: number; status: DocumentStatus; approvedAt: string | null }[];
}

// ---------- indicators ----------

export const INDICATOR_UNITS = ['percent', 'per_1000', 'count', 'minutes'] as const;
export type IndicatorUnit = (typeof INDICATOR_UNITS)[number];

export interface IndicatorDef {
  code: string;
  name: string;
  chapter: NabhChapter;
  unit: IndicatorUnit;
  numerator: string;
  denominator: string | null;
  /** Value = numerator / denominator × multiplier (count indicators have no denominator). */
  multiplier: number;
  lowerIsBetter: boolean;
  target: number | null;
  /** computed = from quality records and other modules' events; manual = entered monthly. */
  source: 'computed' | 'manual';
}

/** NABH indicators the module tracks. Targets are common defaults; hospitals review them with their quality committee. */
export const INDICATORS: readonly IndicatorDef[] = [
  { code: 'PSQ-ME', name: 'Medication errors per 1000 prescriptions', chapter: 'MOM', unit: 'per_1000', numerator: 'Medication error reports', denominator: 'Prescriptions written', multiplier: 1000, lowerIsBetter: true, target: 1, source: 'computed' },
  { code: 'PSQ-ADR', name: 'Adverse drug reactions per 1000 prescriptions', chapter: 'MOM', unit: 'per_1000', numerator: 'Adverse drug reaction reports', denominator: 'Prescriptions written', multiplier: 1000, lowerIsBetter: true, target: 1, source: 'computed' },
  { code: 'PSQ-FALL', name: 'Patient falls per 1000 patient days', chapter: 'COP', unit: 'per_1000', numerator: 'Patient falls', denominator: 'Patient days', multiplier: 1000, lowerIsBetter: true, target: 1, source: 'computed' },
  { code: 'PSQ-NSI', name: 'Needle stick injuries', chapter: 'HIC', unit: 'count', numerator: 'Needle stick injuries', denominator: null, multiplier: 1, lowerIsBetter: true, target: 0, source: 'computed' },
  { code: 'PSQ-SENT', name: 'Sentinel events', chapter: 'PSQ', unit: 'count', numerator: 'Sentinel events', denominator: null, multiplier: 1, lowerIsBetter: true, target: 0, source: 'computed' },
  { code: 'PSQ-NM', name: 'Near misses reported', chapter: 'PSQ', unit: 'count', numerator: 'Near misses', denominator: null, multiplier: 1, lowerIsBetter: false, target: null, source: 'computed' },
  { code: 'PSQ-IR24', name: 'Incidents reported within 24 hours', chapter: 'PSQ', unit: 'percent', numerator: 'Reported within 24 h', denominator: 'Incidents reported', multiplier: 100, lowerIsBetter: false, target: 90, source: 'computed' },
  { code: 'HIC-CAUTI', name: 'CAUTI per 1000 urinary catheter days', chapter: 'HIC', unit: 'per_1000', numerator: 'Confirmed CAUTI', denominator: 'Urinary catheter days', multiplier: 1000, lowerIsBetter: true, target: 2, source: 'computed' },
  { code: 'HIC-CLABSI', name: 'CLABSI per 1000 central line days', chapter: 'HIC', unit: 'per_1000', numerator: 'Confirmed CLABSI', denominator: 'Central line days', multiplier: 1000, lowerIsBetter: true, target: 2, source: 'computed' },
  { code: 'HIC-VAP', name: 'VAP per 1000 ventilator days', chapter: 'HIC', unit: 'per_1000', numerator: 'Confirmed VAP', denominator: 'Ventilator days', multiplier: 1000, lowerIsBetter: true, target: 5, source: 'computed' },
  { code: 'HIC-SSI', name: 'Surgical site infection rate', chapter: 'HIC', unit: 'percent', numerator: 'Confirmed SSI', denominator: 'Surgeries performed', multiplier: 100, lowerIsBetter: true, target: 2, source: 'computed' },
  { code: 'HIC-HH', name: 'Hand hygiene compliance', chapter: 'HIC', unit: 'percent', numerator: 'Sum of hand hygiene audit scores', denominator: 'Hand hygiene audits', multiplier: 1, lowerIsBetter: false, target: 80, source: 'computed' },
  { code: 'PSQ-AUD', name: 'Average audit compliance', chapter: 'PSQ', unit: 'percent', numerator: 'Sum of audit scores', denominator: 'Audits completed', multiplier: 1, lowerIsBetter: false, target: 85, source: 'computed' },
  { code: 'PSQ-CAPA', name: 'CAPAs completed on time', chapter: 'PSQ', unit: 'percent', numerator: 'Completed by due date', denominator: 'CAPAs due', multiplier: 100, lowerIsBetter: false, target: 90, source: 'computed' },
  { code: 'PRE-CMP', name: 'Complaints per 1000 OPD visits', chapter: 'PRE', unit: 'per_1000', numerator: 'Complaints received', denominator: 'OPD visits (check-ins)', multiplier: 1000, lowerIsBetter: true, target: 5, source: 'computed' },
  { code: 'PRE-TAT', name: 'Complaints resolved within TAT', chapter: 'PRE', unit: 'percent', numerator: 'Resolved within TAT', denominator: 'Complaints due', multiplier: 100, lowerIsBetter: false, target: 90, source: 'computed' },
  { code: 'AAC-WAIT', name: 'OPD waiting time (average minutes)', chapter: 'AAC', unit: 'minutes', numerator: 'Total waiting minutes', denominator: 'Patients sampled', multiplier: 1, lowerIsBetter: true, target: 30, source: 'manual' },
  { code: 'AAC-LABTAT', name: 'Lab reports within turnaround time', chapter: 'AAC', unit: 'percent', numerator: 'Reports within TAT', denominator: 'Reports issued', multiplier: 100, lowerIsBetter: false, target: 95, source: 'manual' },
  { code: 'COP-RET72', name: 'Return to emergency within 72 hours', chapter: 'COP', unit: 'percent', numerator: 'Returns within 72 h', denominator: 'Emergency visits', multiplier: 100, lowerIsBetter: true, target: 2, source: 'manual' },
  { code: 'COP-MORT', name: 'Mortality rate', chapter: 'COP', unit: 'percent', numerator: 'Deaths', denominator: 'Discharges + deaths', multiplier: 100, lowerIsBetter: true, target: null, source: 'manual' },
  { code: 'PRE-SAT', name: 'Patient satisfaction', chapter: 'PRE', unit: 'percent', numerator: 'Satisfied responses', denominator: 'Feedback responses', multiplier: 100, lowerIsBetter: false, target: 85, source: 'manual' },
  { code: 'HRM-ATTR', name: 'Staff attrition rate', chapter: 'HRM', unit: 'percent', numerator: 'Staff who left', denominator: 'Average staff strength', multiplier: 100, lowerIsBetter: true, target: null, source: 'manual' },
];

export const indicatorQuerySchema = z.object({ period: period.optional() });
export const indicatorTrendQuerySchema = z.object({ months: z.coerce.number().int().min(1).max(24).default(6), to: period.optional() });
export const indicatorValueInputSchema = z.object({
  period,
  numerator: z.coerce.number().min(0).max(1e12),
  denominator: z.coerce.number().positive().max(1e12).optional(),
  note: optionalText(500),
});
export type IndicatorValueInput = z.input<typeof indicatorValueInputSchema>;

export interface IndicatorResult {
  code: string;
  name: string;
  chapter: NabhChapter;
  unit: IndicatorUnit;
  source: 'computed' | 'manual';
  period: string;
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  target: number | null;
  /** met / missed against target; no_data when nothing to compute from. */
  status: 'met' | 'missed' | 'no_target' | 'no_data';
  numeratorLabel: string;
  denominatorLabel: string | null;
  note: string | null;
}

export interface QualityDashboard {
  period: string;
  openIncidents: number;
  incidentsThisMonth: number;
  sentinelThisMonth: number;
  openComplaints: number;
  overdueComplaints: number;
  openCapas: number;
  overdueCapas: number;
  auditsDue: number;
  documentsDueForReview: number;
  incidentsByCategory: { category: IncidentCategory; count: number }[];
  indicators: IndicatorResult[];
}
