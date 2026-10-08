import { z } from 'zod';
import { defineModule } from '../manifest';
import { END_BEFORE_START, datesInOrder, isoDate, requiredText, todayIso, todayOrFutureDate } from '../validation';
import { patchSchema } from '../patch';

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

/** A vital sign reading with a plain "X must be between a and b" message. */
const reading = (label: string, min: number, max: number, unit = '', whole = true) => {
  const range = `${label} must be between ${min} and ${max}${unit}`;
  const n = z.number({ error: `${label}: enter a number` }).min(min, range).max(max, range);
  return (whole ? n.int(`${label} must be a whole number`) : n).optional();
};

/** Readable limits, shared with the form (min/max on the inputs). */
export const VITAL_LIMITS = {
  temperatureC: [25, 45],
  pulse: [20, 250],
  respRate: [4, 80],
  bpSystolic: [40, 300],
  bpDiastolic: [20, 200],
  spo2: [40, 100],
  weightKg: [0.3, 400],
  heightCm: [20, 250],
  bloodSugar: [10, 1000],
  painScore: [0, 10],
} as const satisfies Record<string, readonly [number, number]>;
const L = VITAL_LIMITS;

const vitalsFields = z.object({
  temperatureC: reading('Temperature', L.temperatureC[0], L.temperatureC[1], ' °C', false),
  pulse: reading('Pulse', L.pulse[0], L.pulse[1], ' per minute'),
  respRate: reading('Respiratory rate', L.respRate[0], L.respRate[1], ' per minute'),
  bpSystolic: reading('Systolic BP', L.bpSystolic[0], L.bpSystolic[1], ' mmHg'),
  bpDiastolic: reading('Diastolic BP', L.bpDiastolic[0], L.bpDiastolic[1], ' mmHg'),
  spo2: reading('SpO2', L.spo2[0], L.spo2[1], '%'),
  weightKg: reading('Weight', L.weightKg[0], L.weightKg[1], ' kg', false),
  heightCm: reading('Height', L.heightCm[0], L.heightCm[1], ' cm', false),
  bloodSugar: reading('Blood sugar', L.bloodSugar[0], L.bloodSugar[1], ' mg/dL'),
  painScore: reading('Pain score', L.painScore[0], L.painScore[1]),
  notes: z.string().trim().max(500, 'Vitals note can be at most 500 characters').optional(),
});

export const vitalsInputSchema = vitalsFields.superRefine((v, ctx) => {
  if (!Object.entries(v).some(([k, x]) => k !== 'notes' && x !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Enter at least one reading', path: [] });
  }
  if ((v.bpSystolic === undefined) !== (v.bpDiastolic === undefined)) {
    const missing = v.bpSystolic === undefined ? 'bpSystolic' : 'bpDiastolic';
    ctx.addIssue({ code: 'custom', message: 'Enter both systolic and diastolic BP', path: [missing] });
  } else if (v.bpSystolic !== undefined && v.bpDiastolic !== undefined && v.bpDiastolic >= v.bpSystolic) {
    ctx.addIssue({ code: 'custom', message: 'Diastolic BP must be lower than systolic BP', path: ['bpDiastolic'] });
  }
});
export type VitalsInput = z.infer<typeof vitalsInputSchema>;

export const vitalsSchema = vitalsFields.extend({
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
  description: requiredText('the diagnosis', 300),
  kind: z.enum(DIAGNOSIS_KINDS).default('provisional'),
  isPrimary: z.boolean().default(false),
});
export type DiagnosisInput = z.input<typeof diagnosisInputSchema>;
export const diagnosesInputSchema = z.object({ diagnoses: z.array(diagnosisInputSchema).max(30, 'At most 30 diagnoses') });
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
  drugName: requiredText('the medicine name', 200),
  /** Pharmacy item code, when picked from the pharmacy item master. */
  itemCode: z.string().trim().max(50).optional(),
  genericName: z.string().trim().max(200).optional(),
  form: z.string().trim().max(50).optional(),
  strength: z.string().trim().max(50).optional(),
  dose: requiredText('the dose', 50),
  route: z.enum(DRUG_ROUTES).default('oral'),
  frequency: requiredText('how often (frequency)', 30),
  timing: z.enum(DRUG_TIMINGS).optional(),
  days: z
    .number({ error: 'Days: enter a number' })
    .int('Days must be a whole number')
    .min(0, 'Days cannot be negative')
    .max(365, 'Days can be at most 365')
    .optional(),
  qty: z
    .number({ error: 'Quantity: enter a number' })
    .min(0, 'Quantity cannot be negative')
    .max(10000, 'Quantity can be at most 10,000')
    .optional(),
  instructions: z.string().trim().max(500, 'Instructions can be at most 500 characters').optional(),
  /** Set when the doctor prescribes despite a recorded allergy. */
  allergyOverrideReason: z
    .string()
    .trim()
    .min(3, 'Give a reason of at least 3 characters for prescribing despite the allergy')
    .max(300, 'Reason can be at most 300 characters')
    .optional(),
});
export type PrescriptionLineInput = z.input<typeof prescriptionLineInputSchema>;

export const prescriptionInputSchema = z.object({
  lines: z.array(prescriptionLineInputSchema).max(40, 'At most 40 medicines on one prescription'),
  notes: z.string().max(2000, 'Prescription notes can be at most 2000 characters').optional(),
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
  name: requiredText('a name for the favourite', 100),
  lines: z.array(prescriptionLineInputSchema.omit({ allergyOverrideReason: true })).min(1, 'Add at least one medicine').max(40, 'At most 40 medicines'),
});
export type FavouriteInput = z.input<typeof favouriteInputSchema>;
/** Rename a favourite and/or replace its medicines. */
export const updateFavouriteSchema = patchSchema(favouriteInputSchema);
export type UpdateFavourite = z.input<typeof updateFavouriteSchema>;

export interface Favourite {
  id: string;
  name: string;
  lines: Omit<PrescriptionLineInput, 'allergyOverrideReason'>[];
  createdAt: string;
}

// ---------- orders (lab/radiology modules pick them up on sign; procedures post charges) ----------

export const orderInputSchema = z.object({
  kind: z.enum(ORDER_KINDS),
  code: z.string().trim().max(50).optional(),
  name: requiredText('the test or procedure name', 200),
  /**
   * Procedures only: the billing service (category 'procedure') it was picked from. When the consultation
   * is signed it is posted as a charge on the patient's account. Free-text procedures have none.
   */
  serviceCode: z.string().trim().toUpperCase().max(40).optional(),
  priority: z.enum(ORDER_PRIORITIES).default('routine'),
  notes: z.string().trim().max(500).optional(),
});
export type OrderInput = z.input<typeof orderInputSchema>;
export const ordersInputSchema = z.object({ orders: z.array(orderInputSchema).max(50, 'At most 50 orders') });
export type OrdersInput = z.input<typeof ordersInputSchema>;

/** POST /emr/encounters/:id/orders/:orderId/cancel: a procedure of a signed consultation that will not be done. */
export const cancelOrderSchema = z.object({ reason: requiredText('a reason', 300, 3) });
export type CancelOrder = z.input<typeof cancelOrderSchema>;

export interface Order {
  id: string;
  kind: (typeof ORDER_KINDS)[number];
  code: string | null;
  name: string;
  /** Billing service of a procedure order (charged when the consultation is signed). */
  serviceCode: string | null;
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
  tokenNo: z.number().int('Token number must be a whole number').min(0, 'Token number cannot be negative').optional(),
});
export type CreateEncounter = z.infer<typeof createEncounterSchema>;

export const updateEncounterSchema = z.object({
  notes: encounterNotesSchema.optional(),
  /** Must be today or later when it is set or changed (the API checks against the stored date). */
  followUpDate: isoDate.nullable().optional(),
  followUpNotes: z.string().max(1000, 'Follow-up instructions can be at most 1000 characters').nullable().optional(),
});
export type UpdateEncounter = z.infer<typeof updateEncounterSchema>;

export const addendumInputSchema = z.object({ text: requiredText('the addendum', 4000) });
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
  date: isoDate.optional(),
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
  lines: z.array(prescriptionLineInputSchema).min(1, 'Add at least one medicine').max(40, 'At most 40 medicines on one prescription'),
  notes: z.string().max(2000).optional(),
  advice: z.string().max(4000).optional(),
  followUpDate: todayOrFutureDate('Follow-up date').optional(),
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
    fromDate: isoDate.optional(),
    toDate: isoDate.optional(),
    diagnosis: z.string().trim().max(300, 'Diagnosis can be at most 300 characters').optional(),
    remarks: z.string().trim().max(2000, 'Remarks can be at most 2000 characters').optional(),
  })
  .superRefine((c, ctx) => {
    if (c.kind === 'sick_leave') {
      if (!c.fromDate) ctx.addIssue({ code: 'custom', message: 'Sick leave needs a from date', path: ['fromDate'] });
      if (!c.toDate) ctx.addIssue({ code: 'custom', message: 'Sick leave needs a to date', path: ['toDate'] });
    }
    if (!datesInOrder(c.fromDate, c.toDate)) {
      ctx.addIssue({ code: 'custom', message: `${END_BEFORE_START}: the to date must be on or after the from date`, path: ['toDate'] });
    } else if (c.fromDate && c.toDate && daysBetween(c.fromDate, c.toDate) > CERTIFICATE_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', message: `A certificate can cover at most ${CERTIFICATE_MAX_DAYS} days`, path: ['toDate'] });
    }
    // Backdating is normal (the patient was ill before the visit) but not by years.
    if (c.fromDate && daysBetween(c.fromDate, todayIso()) > CERTIFICATE_MAX_BACKDATE_DAYS) {
      ctx.addIssue({ code: 'custom', message: `From date can be at most ${CERTIFICATE_MAX_BACKDATE_DAYS} days in the past`, path: ['fromDate'] });
    }
    if (c.toDate && daysBetween(todayIso(), c.toDate) > CERTIFICATE_MAX_DAYS) {
      ctx.addIssue({ code: 'custom', message: `To date can be at most ${CERTIFICATE_MAX_DAYS} days from today`, path: ['toDate'] });
    }
  });
export type CreateCertificate = z.infer<typeof createCertificateSchema>;

export const CERTIFICATE_MAX_DAYS = 365;
export const CERTIFICATE_MAX_BACKDATE_DAYS = 90;

/** Whole days from `a` to `b` (YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

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

// ---------- printing (letterhead and doctor credentials come from Setup) ----------

export interface PrintHeader {
  hospital: {
    displayName: string;
    legalName: string;
    address: { line1?: string; line2?: string; city?: string; district?: string; state?: string; pincode?: string } | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    gstin: string | null;
    registrationNo: string | null;
    logoUrl: string | null;
    letterhead: { tagline?: string; headerNote?: string; footerNote?: string; accentColor?: string } | null;
  };
  template: {
    paperSize: 'A4' | 'A5' | 'thermal_80mm';
    showLogo: boolean;
    showLetterhead: boolean;
    headerText: string | null;
    footerText: string | null;
    marginTopMm: number;
    marginBottomMm: number;
  };
  /** Null when the user is no longer set up as a doctor. */
  doctor: {
    userId: string;
    name: string;
    qualification: string | null;
    specialization: string | null;
    departmentName: string | null;
    registrationNo: string | null;
    registrationCouncil: string | null;
    signatureUrl: string | null;
  } | null;
}

export interface PrintEncounter extends PrintHeader {
  encounter: Encounter;
}

export interface PrintCertificate extends PrintHeader {
  certificate: Certificate;
}

// ---------- events (published by emr) ----------

export interface EncounterSignedEvent {
  encounterId: string;
  patientId: string;
  doctorId: string;
  /** YYYY-MM-DD, when the doctor asked the patient to come back. */
  followUpDate?: string | null;
  followUpNotes?: string | null;
}

export interface PrescriptionCreatedEvent {
  prescriptionId: string;
  patientId: string;
  doctorId: string;
  doctorName: string | null;
  /** When the prescription was first written (ISO 8601). */
  createdAt: string;
  lines: { drugName: string; itemCode?: string; dose: string; frequency: string; days: number | null; qty: number | null }[];
}
