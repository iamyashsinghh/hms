import { z } from 'zod';
import { defineModule } from '../manifest';

/**
 * OPD / EMR: permissions and API contracts (Zod schemas + types).
 * Owned by the "emr" workstream.
 */
export const emrModule = defineModule({
  key: 'emr',
  name: 'OPD / EMR',
  permissions: [
    { key: 'emr.encounter.read', description: "View consultations, the doctor's queue and patient clinical timelines" },
    { key: 'emr.encounter.write', description: 'Start consultations and write notes, diagnoses, orders and follow-up' },
    { key: 'emr.encounter.sign', description: 'Sign and lock a consultation' },
    { key: 'emr.vitals.write', description: 'Record vitals for a consultation' },
    { key: 'emr.prescription.read', description: 'View prescriptions' },
    { key: 'emr.prescription.write', description: 'Write prescriptions' },
    { key: 'emr.certificate.read', description: 'View medical certificates' },
    { key: 'emr.certificate.write', description: 'Issue medical certificates' },
  ],
  grants: {
    doctor: [
      'emr.encounter.read', 'emr.encounter.write', 'emr.encounter.sign', 'emr.vitals.write',
      'emr.prescription.read', 'emr.prescription.write', 'emr.certificate.read', 'emr.certificate.write',
    ],
    nurse: ['emr.encounter.read', 'emr.vitals.write', 'emr.prescription.read'],
    hospital_admin: ['emr.encounter.read', 'emr.prescription.read', 'emr.certificate.read'],
    pharmacist: ['emr.prescription.read'],
    receptionist: ['emr.certificate.read'],
  },
});

// ---------- enums ----------

export const ENCOUNTER_STATUSES = ['waiting', 'in_progress', 'completed', 'cancelled'] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export const DIAGNOSIS_KINDS = ['provisional', 'final'] as const;
export const ORDER_KINDS = ['lab', 'radiology', 'procedure'] as const;
export const ORDER_PRIORITIES = ['routine', 'urgent'] as const;
export const CERTIFICATE_KINDS = ['sick_leave', 'fitness', 'medical'] as const;
export const DRUG_ROUTES = ['oral', 'topical', 'iv', 'im', 'sc', 'inhalation', 'nasal', 'eye', 'ear', 'rectal', 'sublingual', 'other'] as const;
export const DRUG_TIMINGS = ['before_food', 'after_food', 'with_food', 'empty_stomach', 'bedtime', 'any'] as const;

/** Common Indian OPD frequency shorthand → doses per day. Used to auto-calculate quantity. */
export const FREQUENCIES: Record<string, { label: string; perDay: number }> = {
  OD: { label: 'Once a day (1-0-0)', perDay: 1 },
  HS: { label: 'At bedtime (0-0-1)', perDay: 1 },
  BD: { label: 'Twice a day (1-0-1)', perDay: 2 },
  TDS: { label: 'Three times a day (1-1-1)', perDay: 3 },
  QID: { label: 'Four times a day', perDay: 4 },
  SOS: { label: 'When required', perDay: 0 },
  STAT: { label: 'Immediately, once', perDay: 0 },
  WEEKLY: { label: 'Once a week', perDay: 1 / 7 },
};

/** Suggested quantity for a line: units per dose × doses per day × days (rounded up). */
export function suggestQty(frequency: string, days: number | null | undefined, unitsPerDose = 1): number | null {
  if (!days) return null;
  const f = frequency.trim().toUpperCase();
  // Dose pattern like 1-0-1 or 1-1-1-1 (morning-noon-night).
  const pattern = /^\d+(\.\d+)?(-\d+(\.\d+)?){1,3}$/.test(f) ? f.split('-').reduce((a, b) => a + Number(b), 0) : null;
  const perDay = pattern ?? FREQUENCIES[f]?.perDay;
  if (!perDay) return null;
  return Math.ceil(unitsPerDose * perDay * days);
}

// ---------- notes ----------

/** Clinical notes are stored as one JSONB document with these sections. */
export const encounterNotesSchema = z.object({
  chiefComplaints: z.string().max(4000).optional(),
  historyOfPresentIllness: z.string().max(8000).optional(),
  pastHistory: z.string().max(4000).optional(),
  familyHistory: z.string().max(2000).optional(),
  examination: z.string().max(8000).optional(),
  advice: z.string().max(4000).optional(),
  privateNotes: z.string().max(4000).optional(),
});
export type EncounterNotes = z.infer<typeof encounterNotesSchema>;

// ---------- vitals ----------

export const vitalsInputSchema = z.object({
  temperatureC: z.number().min(25).max(45).optional(),
  pulse: z.number().int().min(20).max(250).optional(),
  respRate: z.number().int().min(4).max(80).optional(),
  bpSystolic: z.number().int().min(40).max(300).optional(),
  bpDiastolic: z.number().int().min(20).max(200).optional(),
  spo2: z.number().int().min(40).max(100).optional(),
  weightKg: z.number().min(0.3).max(400).optional(),
  heightCm: z.number().min(20).max(250).optional(),
  bloodSugar: z.number().int().min(10).max(1000).optional(),
  painScore: z.number().int().min(0).max(10).optional(),
  notes: z.string().max(500).optional(),
});
export type VitalsInput = z.infer<typeof vitalsInputSchema>;

export const vitalsSchema = vitalsInputSchema.extend({
  id: z.uuid(),
  encounterId: z.uuid(),
  bmi: z.number().nullable(),
  recordedAt: z.string(),
  recordedBy: z.uuid().nullable(),
});
export type Vitals = z.infer<typeof vitalsSchema>;

// ---------- diagnoses ----------

export const diagnosisInputSchema = z.object({
  icd10Code: z.string().trim().regex(/^[A-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$/, 'Enter an ICD-10 code like J06.9').optional(),
  description: z.string().trim().min(1).max(300),
  kind: z.enum(DIAGNOSIS_KINDS).default('provisional'),
  isPrimary: z.boolean().default(false),
});
export type DiagnosisInput = z.input<typeof diagnosisInputSchema>;
export const diagnosesInputSchema = z.object({ diagnoses: z.array(diagnosisInputSchema).max(30) });
export type DiagnosesInput = z.input<typeof diagnosesInputSchema>;

export interface Diagnosis {
  id: string;
  icd10Code: string | null;
  description: string;
  kind: (typeof DIAGNOSIS_KINDS)[number];
  isPrimary: boolean;
}

export interface Icd10Code {
  code: string;
  description: string;
}

// ---------- prescriptions ----------

export const prescriptionLineInputSchema = z.object({
  drugName: z.string().trim().min(1).max(200),
  /** Pharmacy item code, when picked from the pharmacy item master. */
  itemCode: z.string().trim().max(50).optional(),
  genericName: z.string().trim().max(200).optional(),
  form: z.string().trim().max(50).optional(),
  strength: z.string().trim().max(50).optional(),
  dose: z.string().trim().min(1).max(50),
  route: z.enum(DRUG_ROUTES).default('oral'),
  frequency: z.string().trim().min(1).max(30),
  timing: z.enum(DRUG_TIMINGS).optional(),
  days: z.number().int().min(0).max(365).optional(),
  qty: z.number().min(0).max(10000).optional(),
  instructions: z.string().trim().max(500).optional(),
  /** Set when the doctor prescribes despite a recorded allergy. */
  allergyOverrideReason: z.string().trim().min(3).max(300).optional(),
});
export type PrescriptionLineInput = z.input<typeof prescriptionLineInputSchema>;

export const prescriptionInputSchema = z.object({
  lines: z.array(prescriptionLineInputSchema).max(40),
  notes: z.string().max(2000).optional(),
});
export type PrescriptionInput = z.input<typeof prescriptionInputSchema>;

export interface PrescriptionLine {
  id: string;
  drugName: string;
  itemCode: string | null;
  genericName: string | null;
  form: string | null;
  strength: string | null;
  dose: string;
  route: string;
  frequency: string;
  timing: string | null;
  days: number | null;
  qty: number | null;
  instructions: string | null;
  allergyOverrideReason: string | null;
}

export interface Prescription {
  id: string;
  rxNo: string;
  encounterId: string;
  patientId: string;
  doctorId: string;
  notes: string | null;
  lines: PrescriptionLine[];
  createdAt: string;
}

/** Returned with 409 `allergy_conflict` when a drug matches a recorded allergy and has no override reason. */
export interface AllergyConflict {
  line: number;
  drugName: string;
  allergy: string;
}

// ---------- favourites ----------

export const favouriteInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  lines: z.array(prescriptionLineInputSchema.omit({ allergyOverrideReason: true })).min(1).max(40),
});
export type FavouriteInput = z.input<typeof favouriteInputSchema>;

export interface Favourite {
  id: string;
  name: string;
  lines: Omit<PrescriptionLineInput, 'allergyOverrideReason'>[];
  createdAt: string;
}

// ---------- orders (stored only; lab/radiology modules pick them up later) ----------

export const orderInputSchema = z.object({
  kind: z.enum(ORDER_KINDS),
  code: z.string().trim().max(50).optional(),
  name: z.string().trim().min(1).max(200),
  priority: z.enum(ORDER_PRIORITIES).default('routine'),
  notes: z.string().trim().max(500).optional(),
});
export type OrderInput = z.input<typeof orderInputSchema>;
export const ordersInputSchema = z.object({ orders: z.array(orderInputSchema).max(50) });
export type OrdersInput = z.input<typeof ordersInputSchema>;

export interface Order {
  id: string;
  kind: (typeof ORDER_KINDS)[number];
  code: string | null;
  name: string;
  priority: (typeof ORDER_PRIORITIES)[number];
  notes: string | null;
  status: string;
}

// ---------- encounters ----------

export const createEncounterSchema = z.object({
  patientId: z.uuid(),
  /** Defaults to the calling doctor. */
  doctorId: z.uuid().optional(),
  visitId: z.uuid().optional(),
  appointmentId: z.uuid().optional(),
  tokenNo: z.number().int().min(0).optional(),
});
export type CreateEncounter = z.infer<typeof createEncounterSchema>;

export const updateEncounterSchema = z.object({
  notes: encounterNotesSchema.optional(),
  followUpDate: z.iso.date().nullable().optional(),
  followUpNotes: z.string().max(1000).nullable().optional(),
});
export type UpdateEncounter = z.infer<typeof updateEncounterSchema>;

export const addendumInputSchema = z.object({ text: z.string().trim().min(1).max(4000) });
export type AddendumInput = z.infer<typeof addendumInputSchema>;

export interface Addendum {
  id: string;
  text: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** Patient details as they were when the consultation started (printed on the Rx). */
export interface EncounterPatient {
  id: string;
  uhid: string;
  name: string;
  gender: string;
  dateOfBirth: string | null;
  mobile: string | null;
  allergies: string[];
}

export interface EncounterSummary {
  id: string;
  encounterNo: string;
  encounterDate: string;
  status: EncounterStatus;
  tokenNo: number | null;
  patient: EncounterPatient;
  doctorId: string;
  doctorName: string | null;
  facilityId: string;
  visitId: string | null;
  startedAt: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface Encounter extends EncounterSummary {
  appointmentId: string | null;
  notes: EncounterNotes;
  followUpDate: string | null;
  followUpNotes: string | null;
  signedBy: string | null;
  vitals: Vitals[];
  diagnoses: Diagnosis[];
  prescription: Prescription | null;
  orders: Order[];
  addenda: Addendum[];
  updatedAt: string;
}

export const queueQuerySchema = z.object({
  date: z.iso.date().optional(),
  doctorId: z.uuid().optional(),
});
export type QueueQuery = z.infer<typeof queueQuerySchema>;

/** One row in a doctor's day queue. */
export interface QueueItem {
  encounterId: string;
  encounterNo: string;
  visitId: string | null;
  patientId: string;
  uhid: string;
  patientName: string;
  gender: string;
  dateOfBirth: string | null;
  tokenNo: number | null;
  status: EncounterStatus;
  /** When the patient was checked in (or the consultation was opened). */
  checkedInAt: string;
  startedAt: string | null;
  signedAt: string | null;
}

/** Quick prescription (mobile doctor app): opens a walk-in consultation when encounterId is absent. */
export const quickPrescriptionSchema = z.object({
  patientId: z.uuid(),
  encounterId: z.uuid().optional(),
  lines: z.array(prescriptionLineInputSchema).min(1).max(40),
  notes: z.string().max(2000).optional(),
  advice: z.string().max(4000).optional(),
  followUpDate: z.iso.date().optional(),
  sign: z.boolean().default(false),
});
export type QuickPrescription = z.input<typeof quickPrescriptionSchema>;
export interface QuickPrescriptionResult {
  prescriptionId: string;
  encounterId: string;
  rxNo: string;
}

export const timelineQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TimelineQuery = { page?: number; pageSize?: number };

/** One past consultation in a patient's timeline. */
export interface TimelineEntry {
  encounterId: string;
  encounterNo: string;
  encounterDate: string;
  status: EncounterStatus;
  doctorId: string;
  doctorName: string | null;
  chiefComplaints: string | null;
  diagnoses: Pick<Diagnosis, 'icd10Code' | 'description' | 'kind' | 'isPrimary'>[];
  medicines: Pick<PrescriptionLine, 'drugName' | 'dose' | 'frequency' | 'days'>[];
  orders: Pick<Order, 'kind' | 'name'>[];
  vitals: Vitals | null;
  followUpDate: string | null;
  signedAt: string | null;
}

// ---------- certificates ----------

export const createCertificateSchema = z
  .object({
    patientId: z.uuid(),
    encounterId: z.uuid().optional(),
    kind: z.enum(CERTIFICATE_KINDS),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    diagnosis: z.string().trim().max(300).optional(),
    remarks: z.string().trim().max(2000).optional(),
  })
  .refine((c) => !c.fromDate || !c.toDate || c.fromDate <= c.toDate, { message: 'From date must be before to date', path: ['toDate'] })
  .refine((c) => c.kind !== 'sick_leave' || (c.fromDate && c.toDate), { message: 'Sick leave needs from and to dates', path: ['fromDate'] });
export type CreateCertificate = z.infer<typeof createCertificateSchema>;

export interface Certificate {
  id: string;
  certificateNo: string;
  kind: (typeof CERTIFICATE_KINDS)[number];
  patient: EncounterPatient;
  encounterId: string | null;
  doctorId: string;
  doctorName: string | null;
  fromDate: string | null;
  toDate: string | null;
  diagnosis: string | null;
  remarks: string | null;
  issuedAt: string;
}

// ---------- events (published by emr) ----------

export interface EncounterSignedEvent {
  encounterId: string;
  patientId: string;
  doctorId: string;
}

export interface PrescriptionCreatedEvent {
  prescriptionId: string;
  patientId: string;
  lines: { drugName: string; itemCode?: string; dose: string; frequency: string; days: number | null; qty: number | null }[];
}
