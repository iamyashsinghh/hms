import { z } from 'zod';
import { defineModule } from '../manifest';
import {
  blankToUndefined,
  indianMobile,
  isoDate,
  isoDateTime,
  money as moneyField,
  notFutureDateTime,
  pastOrTodayDate,
  personName,
  positiveMoney as positiveMoneyField,
  requiredText,
  todayIso,
} from '../validation';
import { GST_RATES } from './billing';
import { patchSchema } from '../patch';
import type { ImportColumn } from '../imports';

/**
 * IPD & Nursing: permissions and API contracts (Zod schemas + types).
 * Owned by the "ipd" workstream. Money travels as numbers in rupees with 2 decimals.
 */
export const ipdModule = defineModule({
  key: 'ipd',
  name: 'IPD & Nursing',
  permissions: [
    { key: 'ipd.ward.read', description: 'View wards, beds and the bed board' },
    { key: 'ipd.ward.manage', description: 'Create and edit wards and beds, change bed status' },
    { key: 'ipd.admission.read', description: 'View admissions, nursing charts, rounds and discharge summaries' },
    { key: 'ipd.admission.create', description: 'Admit patients' },
    { key: 'ipd.admission.transfer', description: 'Transfer admitted patients to another bed' },
    { key: 'ipd.admission.discharge', description: 'Discharge patients' },
    { key: 'ipd.admission.cancel', description: 'Cancel an admission made by mistake' },
    { key: 'ipd.nursing.write', description: 'Record vitals, nursing notes, intake/output and medication given' },
    { key: 'ipd.medication.order', description: 'Order and stop inpatient medications' },
    { key: 'ipd.round.write', description: 'Write doctor round notes' },
    { key: 'ipd.charge.read', description: 'View the running IPD bill' },
    { key: 'ipd.charge.write', description: 'Post and cancel charges on the running IPD bill' },
    { key: 'ipd.advance.collect', description: 'Take advance payments for an admission' },
    { key: 'ipd.bill.finalize', description: 'Finalize the IPD bill (creates the invoice)' },
    { key: 'ipd.summary.write', description: 'Write the discharge summary' },
    { key: 'ipd.summary.finalize', description: 'Sign off the discharge summary' },
  ],
  grants: {
    hospital_admin: [
      'ipd.ward.read', 'ipd.ward.manage', 'ipd.admission.read', 'ipd.admission.create', 'ipd.admission.transfer',
      'ipd.admission.discharge', 'ipd.admission.cancel', 'ipd.nursing.write', 'ipd.medication.order', 'ipd.round.write',
      'ipd.charge.read', 'ipd.charge.write', 'ipd.advance.collect', 'ipd.bill.finalize', 'ipd.summary.write', 'ipd.summary.finalize',
    ],
    owner: ['ipd.ward.read', 'ipd.admission.read', 'ipd.charge.read'],
    doctor: [
      'ipd.ward.read', 'ipd.admission.read', 'ipd.admission.create', 'ipd.admission.transfer', 'ipd.nursing.write',
      'ipd.medication.order', 'ipd.round.write', 'ipd.charge.read', 'ipd.summary.write', 'ipd.summary.finalize',
    ],
    nurse: [
      'ipd.ward.read', 'ipd.admission.read', 'ipd.admission.transfer', 'ipd.admission.discharge', 'ipd.nursing.write',
      'ipd.charge.read', 'ipd.charge.write', 'ipd.summary.write',
    ],
    receptionist: [
      'ipd.ward.read', 'ipd.admission.read', 'ipd.admission.create', 'ipd.admission.discharge', 'ipd.charge.read', 'ipd.advance.collect',
    ],
    billing_clerk: [
      'ipd.ward.read', 'ipd.admission.read', 'ipd.admission.discharge', 'ipd.charge.read', 'ipd.charge.write',
      'ipd.advance.collect', 'ipd.bill.finalize',
    ],
    accountant: ['ipd.ward.read', 'ipd.admission.read', 'ipd.charge.read'],
  },
});

// ---------- shared bits ----------

const money = moneyField();
const positiveMoney = positiveMoneyField();
const optionalText = (max: number) => z.string().trim().max(max, `Enter at most ${max} characters`).optional();
const mobile = indianMobile;
/** India calendar date (YYYY-MM-DD) of an ISO time. */
const istDay = (at: string) => todayIso(0, new Date(at));
/** GST on a charge: the slabs Billing accepts on the invoice. */
const gstRate = z.coerce
  .number({ error: 'Enter the GST rate' })
  .refine((v) => (GST_RATES as readonly number[]).includes(v), `Use a GST slab: ${GST_RATES.join(', ')}`);
const pageFields = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

export const WARD_TYPES = ['general', 'semi_private', 'private', 'deluxe', 'icu', 'nicu', 'picu', 'hdu', 'emergency', 'daycare', 'labour', 'other'] as const;
export const BED_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance', 'reserved'] as const;
/** Statuses staff can set by hand (occupied is set by admit/transfer/discharge). */
export const MANUAL_BED_STATUSES = ['available', 'cleaning', 'maintenance', 'reserved'] as const;
export const ADMISSION_TYPES = ['planned', 'emergency', 'daycare', 'maternity', 'transfer_in'] as const;
export const ADMISSION_STATUSES = ['admitted', 'discharged', 'cancelled'] as const;
export const DISCHARGE_TYPES = ['normal', 'lama', 'dama', 'referred', 'death', 'absconded'] as const;
export const NURSING_SHIFTS = ['morning', 'evening', 'night'] as const;
export const IO_CATEGORIES = { intake: ['oral', 'iv', 'ryles', 'other'], output: ['urine', 'drain', 'vomit', 'stool', 'other'] } as const;
export const MED_ROUTES = ['oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual', 'rectal', 'nasal', 'other'] as const;
export const ADMINISTRATION_STATUSES = ['given', 'held', 'refused', 'missed'] as const;
/** Payment modes accepted for an IPD advance (same as billing deposits). */
export const ADVANCE_MODES = ['cash', 'upi', 'card', 'bank', 'cheque'] as const;

export type WardType = (typeof WARD_TYPES)[number];
export type BedStatus = (typeof BED_STATUSES)[number];
export type ManualBedStatus = (typeof MANUAL_BED_STATUSES)[number];
export type AdmissionType = (typeof ADMISSION_TYPES)[number];
export type AdmissionStatus = (typeof ADMISSION_STATUSES)[number];
export type DischargeType = (typeof DISCHARGE_TYPES)[number];
export type NursingShift = (typeof NURSING_SHIFTS)[number];
export type MedRoute = (typeof MED_ROUTES)[number];
export type AdministrationStatus = (typeof ADMINISTRATION_STATUSES)[number];
export type AdvanceMode = (typeof ADVANCE_MODES)[number];

// ---------- wards and beds ----------

export const wardInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{0,19}$/, 'Letters, digits, - or _ (max 20)'),
  name: requiredText('the ward name', 100),
  wardType: z.enum(WARD_TYPES).default('general'),
  floor: optionalText(40),
  defaultDailyRate: money.default(0),
  /** Defaults to the facility in the request (X-Facility-Id). */
  facilityId: z.uuid().optional(),
  isActive: z.boolean().default(true),
});
export type WardInput = z.input<typeof wardInputSchema>;
export const updateWardSchema = patchSchema(wardInputSchema.omit({ code: true, facilityId: true }));
export type UpdateWard = z.input<typeof updateWardSchema>;

export interface Ward {
  id: string;
  facilityId: string;
  code: string;
  name: string;
  wardType: WardType;
  floor: string | null;
  defaultDailyRate: number;
  isActive: boolean;
  bedCount: number;
  occupiedCount: number;
}

const bedCode = requiredText('the bed code', 20).regex(/^[A-Za-z0-9][A-Za-z0-9 /_-]*$/, 'Bed code can have letters, digits, space, / - or _');
export const bedInputSchema = z.object({
  wardId: z.uuid(),
  code: bedCode,
  roomNo: optionalText(20),
  /** Defaults to the ward's daily rate. */
  dailyRate: money.optional(),
  chargeServiceCode: z.string().trim().toUpperCase().max(40).optional(),
});
export type BedInput = z.input<typeof bedInputSchema>;

/** Columns of the bed import sheet. `Ward` is the ward code (or name) in the current facility. */
export const BED_IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'ward', header: 'Ward', type: 'text', required: true, example: 'GW', help: 'Ward code or name' },
  { key: 'code', header: 'Bed', type: 'text', required: true, example: 'GW-1' },
  { key: 'roomNo', header: 'Room no', type: 'text', example: '101' },
  { key: 'dailyRate', header: 'Daily rate', type: 'number', example: 1500, help: "Defaults to the ward's rate" },
  { key: 'chargeServiceCode', header: 'Charge service code', type: 'text', example: '' },
];
export const bedImportRowSchema = bedInputSchema.omit({ wardId: true }).extend({ ward: z.string().trim().min(1).max(100) });
export type BedImportRow = z.output<typeof bedImportRowSchema>;

/** Add several beds at once: prefix + numbers, e.g. "GW-" 1..10 → GW-1 … GW-10. */
export const bulkBedsSchema = z
  .object({
    wardId: z.uuid(),
    prefix: z
      .string()
      .trim()
      .max(10, 'Prefix can be at most 10 characters')
      .regex(/^[A-Za-z0-9 /_-]*$/, 'Prefix can have letters, digits, space, / - or _')
      .default(''),
    from: z.coerce.number({ error: 'Enter the first bed number' }).int('Use whole numbers').min(0, 'Bed numbers start at 0').max(9999, 'Bed numbers go up to 9999'),
    to: z.coerce.number({ error: 'Enter the last bed number' }).int('Use whole numbers').min(0, 'Bed numbers start at 0').max(9999, 'Bed numbers go up to 9999'),
    roomNo: optionalText(20),
    dailyRate: money.optional(),
    chargeServiceCode: z.string().trim().toUpperCase().max(40).optional(),
  })
  .refine((b) => b.to >= b.from && b.to - b.from < 100, { message: 'Add between 1 and 100 beds at a time', path: ['to'] });
export type BulkBeds = z.input<typeof bulkBedsSchema>;

export const updateBedSchema = z.object({
  code: bedCode.optional(),
  roomNo: z.string().trim().max(20).nullable().optional(),
  dailyRate: money.optional(),
  chargeServiceCode: z.string().trim().toUpperCase().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateBed = z.input<typeof updateBedSchema>;

export const bedStatusSchema = z.object({ status: z.enum(MANUAL_BED_STATUSES) });
export type BedStatusInput = z.input<typeof bedStatusSchema>;

export interface BedOccupant {
  admissionId: string;
  ipdNo: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  patientGender: string | null;
  doctorName: string;
  admittedAt: string;
  isMlc: boolean;
}

export interface Bed {
  id: string;
  wardId: string;
  facilityId: string;
  code: string;
  roomNo: string | null;
  dailyRate: number;
  chargeServiceCode: string | null;
  status: BedStatus;
  isActive: boolean;
  occupant: BedOccupant | null;
}

export const bedQuerySchema = z.object({
  wardId: z.uuid().optional(),
  status: z.enum(BED_STATUSES).optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
export type BedQuery = { wardId?: string; status?: BedStatus; includeInactive?: 'true' | 'false' };

export interface BedBoardWard extends Ward {
  beds: Bed[];
}

export interface BedBoard {
  totals: Record<BedStatus, number> & { total: number };
  wards: BedBoardWard[];
}

// ---------- admissions ----------

const admitFields = z.object({
  patientId: z.uuid({ error: 'Pick the patient to admit' }),
  bedId: z.uuid({ error: 'Pick a bed' }),
  /** Admitting / treating doctor (staff user id). */
  doctorId: z.uuid({ error: 'Pick the treating doctor' }),
  admissionType: z.enum(ADMISSION_TYPES).default('planned'),
  reason: requiredText('the reason for admission', 1000, 2),
  provisionalDiagnosis: optionalText(1000),
  isMlc: z.boolean().default(false),
  mlcNo: optionalText(50),
  attendantName: blankToUndefined(personName('the attendant name').optional()),
  attendantRelation: optionalText(50),
  attendantMobile: blankToUndefined(mobile.optional()),
  expectedDischargeDate: blankToUndefined(isoDate.optional()),
  /** Defaults to now; allows entering an admission a little after the fact. */
  admittedAt: blankToUndefined(notFutureDateTime('Admission time').optional()),
  /** Advance taken at the desk while admitting. */
  advance: z.object({ mode: z.enum(ADVANCE_MODES), amount: positiveMoney, reference: optionalText(100) }).optional(),
});

export const admitSchema = admitFields.superRefine((a, ctx) => {
  if (!a.expectedDischargeDate) return;
  if (a.expectedDischargeDate < todayIso()) {
    ctx.addIssue({ code: 'custom', path: ['expectedDischargeDate'], message: 'Expected discharge date cannot be in the past' });
  } else if (a.admittedAt && a.expectedDischargeDate < istDay(a.admittedAt)) {
    ctx.addIssue({ code: 'custom', path: ['expectedDischargeDate'], message: 'Expected discharge date is before the admission date' });
  }
});
export type AdmitInput = z.input<typeof admitSchema>;

/** Blank ('' or null) clears an optional field on update. */
const clearable = <T extends z.ZodType>(s: T) => z.union([s, z.literal('')]).nullable().optional();

/**
 * Edit an admission while the patient is still admitted. Same rules as admit; optional
 * fields can be cleared with '' or null. Turning MLC off clears the MLC number.
 * No defaults here, so a partial edit never resets other fields. The expected discharge
 * date is checked against the admission date by the API.
 */
export const updateAdmissionSchema = z.object({
  doctorId: z.uuid({ error: 'Pick the treating doctor' }).optional(),
  reason: requiredText('the reason for admission', 1000, 2).optional(),
  provisionalDiagnosis: clearable(z.string().trim().max(1000, 'Enter at most 1000 characters')),
  isMlc: z.boolean().optional(),
  mlcNo: clearable(z.string().trim().max(50, 'Enter at most 50 characters')),
  attendantName: clearable(personName('the attendant name')),
  attendantRelation: clearable(z.string().trim().max(50, 'Enter at most 50 characters')),
  attendantMobile: clearable(mobile),
  expectedDischargeDate: clearable(isoDate),
});
export type UpdateAdmission = z.input<typeof updateAdmissionSchema>;

export const transferSchema = z.object({
  bedId: z.uuid({ error: 'Pick the new bed' }),
  reason: requiredText('the reason for transfer', 500, 2),
  /** Bed left behind goes to cleaning by default. */
  vacatedBedStatus: z.enum(['cleaning', 'available']).default('cleaning'),
});
export type TransferInput = z.input<typeof transferSchema>;

export const cancelAdmissionSchema = z.object({ reason: requiredText('the reason for cancelling', 500, 3) });
export type CancelAdmission = z.input<typeof cancelAdmissionSchema>;

export const dischargeSchema = z.object({
  dischargeType: z.enum(DISCHARGE_TYPES).default('normal'),
  notes: optionalText(1000),
  /** Discharge with money still due on the IPD invoice (needs a note). */
  allowDue: z.boolean().default(false),
});
export type DischargeInput = z.input<typeof dischargeSchema>;

export const admissionQuerySchema = z.object({
  status: z.enum(ADMISSION_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  wardId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  ...pageFields,
});
export type AdmissionQuery = {
  status?: AdmissionStatus;
  q?: string;
  wardId?: string;
  doctorId?: string;
  patientId?: string;
  page?: number;
  pageSize?: number;
};

export interface BedStay {
  id: string;
  bedId: string;
  wardId: string;
  bedLabel: string;
  dailyRate: number;
  fromAt: string;
  toAt: string | null;
  reason: string | null;
}

export interface AdmissionSummary {
  id: string;
  ipdNo: string;
  facilityId: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  patientGender: string | null;
  doctorId: string;
  doctorName: string;
  admissionType: AdmissionType;
  status: AdmissionStatus;
  bedId: string | null;
  bedLabel: string | null;
  wardName: string | null;
  admittedAt: string;
  dischargedAt: string | null;
  isMlc: boolean;
  /** Calendar days so far (IST), at least 1. */
  lengthOfStay: number;
}

export interface Admission extends AdmissionSummary {
  patientDob: string | null;
  patientMobile: string | null;
  reason: string;
  provisionalDiagnosis: string | null;
  mlcNo: string | null;
  attendantName: string | null;
  attendantRelation: string | null;
  attendantMobile: string | null;
  expectedDischargeDate: string | null;
  invoiceId: string | null;
  billedAt: string | null;
  dischargeType: DischargeType | null;
  dischargeNotes: string | null;
  cancelReason: string | null;
  stays: BedStay[];
  summaryStatus: 'none' | 'draft' | 'final';
}

// ---------- nursing ----------

/** An optional whole-number reading in a range, with a message naming the reading. */
const int = (label: string, min: number, max: number) =>
  blankToUndefined(
    z.coerce
      .number({ error: `Enter ${label} as a number` })
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be between ${min} and ${max}`)
      .max(max, `${label} must be between ${min} and ${max}`)
      .optional(),
  );
const reading = (label: string, min: number, max: number) =>
  blankToUndefined(
    z.coerce
      .number({ error: `Enter ${label} as a number` })
      .min(min, `${label} must be between ${min} and ${max}`)
      .max(max, `${label} must be between ${min} and ${max}`)
      .optional(),
  );
/** When a chart entry happened: not in the future (the API also checks it is not before the admission). */
const chartTime = (label: string) => blankToUndefined(notFutureDateTime(label).optional());
const recordedAt = chartTime('Time recorded');

export const vitalsInputSchema = z
  .object({
    recordedAt,
    temperatureC: reading('Temperature (°C)', 25, 45),
    pulse: int('Pulse', 0, 300),
    respRate: int('Respiratory rate', 0, 100),
    bpSystolic: int('Systolic BP', 0, 300),
    bpDiastolic: int('Diastolic BP', 0, 200),
    spo2: int('SpO2', 0, 100),
    painScore: int('Pain score', 0, 10),
    bloodSugar: reading('Blood sugar', 0, 1000),
    notes: optionalText(500),
  })
  .refine(
    (v) => [v.temperatureC, v.pulse, v.respRate, v.bpSystolic, v.bpDiastolic, v.spo2, v.painScore, v.bloodSugar].some((x) => x !== undefined),
    { message: 'Enter at least one reading' },
  )
  .refine((v) => (v.bpSystolic === undefined) === (v.bpDiastolic === undefined), {
    message: 'Enter both systolic and diastolic BP',
    path: ['bpDiastolic'],
  })
  .refine((v) => v.bpSystolic === undefined || v.bpDiastolic === undefined || v.bpDiastolic < v.bpSystolic, {
    message: 'Diastolic BP must be lower than systolic',
    path: ['bpDiastolic'],
  });
export type VitalsInput = z.input<typeof vitalsInputSchema>;

export interface Vitals {
  id: string;
  recordedAt: string;
  temperatureC: number | null;
  pulse: number | null;
  respRate: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  spo2: number | null;
  painScore: number | null;
  bloodSugar: number | null;
  notes: string | null;
  recordedBy: string | null;
}

export const nursingNoteInputSchema = z.object({
  shift: z.enum(NURSING_SHIFTS).optional(),
  note: requiredText('the note', 4000, 2),
});
export type NursingNoteInput = z.input<typeof nursingNoteInputSchema>;

export interface NursingNote {
  id: string;
  shift: NursingShift | null;
  note: string;
  recordedBy: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export const intakeOutputInputSchema = z
  .object({
    direction: z.enum(['intake', 'output']),
    category: z.enum(['oral', 'iv', 'ryles', 'urine', 'drain', 'vomit', 'stool', 'other']),
    volumeMl: z.coerce
      .number({ error: 'Enter the volume in ml' })
      .int('Volume must be whole ml')
      .min(0, 'Volume cannot be negative')
      .max(20000, 'Volume cannot be more than 20,000 ml'),
    recordedAt,
    notes: optionalText(300),
  })
  .refine((v) => (IO_CATEGORIES[v.direction] as readonly string[]).includes(v.category), { message: 'Category does not match intake/output', path: ['category'] });
export type IntakeOutputInput = z.input<typeof intakeOutputInputSchema>;

export interface IntakeOutput {
  id: string;
  direction: 'intake' | 'output';
  category: string;
  volumeMl: number;
  recordedAt: string;
  notes: string | null;
}

export interface IntakeOutputChart {
  entries: IntakeOutput[];
  /** Totals per IST day, newest first. */
  days: { date: string; intakeMl: number; outputMl: number; balanceMl: number }[];
}

export const medicationOrderInputSchema = z.object({
  drugName: requiredText('the medicine', 200),
  dose: requiredText('the dose', 100),
  route: z.enum(MED_ROUTES).default('oral'),
  frequency: requiredText('the frequency', 50),
  instructions: optionalText(500),
  isPrn: z.boolean().default(false),
  /** May be in the future (scheduled start); the API checks it is not before the admission. */
  startAt: blankToUndefined(isoDateTime.optional()),
});
export type MedicationOrderInput = z.input<typeof medicationOrderInputSchema>;

export const stopMedicationSchema = z.object({ reason: requiredText('the reason for stopping', 300, 2) });
export type StopMedication = z.input<typeof stopMedicationSchema>;

export const administerSchema = z.object({
  status: z.enum(ADMINISTRATION_STATUSES).default('given'),
  givenAt: chartTime('Time given'),
  notes: optionalText(300),
});
export type AdministerInput = z.input<typeof administerSchema>;

export interface MedicationAdministration {
  id: string;
  orderId: string;
  status: AdministrationStatus;
  givenAt: string;
  notes: string | null;
  givenByName: string | null;
}

export interface MedicationOrder {
  id: string;
  drugName: string;
  dose: string;
  route: MedRoute;
  frequency: string;
  instructions: string | null;
  isPrn: boolean;
  startAt: string;
  status: 'active' | 'stopped';
  stoppedAt: string | null;
  stopReason: string | null;
  orderedByName: string | null;
  lastGivenAt: string | null;
  administrations: MedicationAdministration[];
}

// ---------- lines and devices (for HAI device-days) ----------

export const DEVICE_TYPES = ['urinary_catheter', 'central_line', 'ventilator', 'peripheral_iv', 'other'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const deviceInputSchema = z.object({
  deviceType: z.enum(DEVICE_TYPES),
  site: optionalText(100),
  notes: optionalText(300),
  insertedAt: chartTime('Insertion time'),
});
export type DeviceInput = z.input<typeof deviceInputSchema>;

export const removeDeviceSchema = z.object({
  reason: optionalText(300),
  removedAt: chartTime('Removal time'),
});
export type RemoveDevice = z.input<typeof removeDeviceSchema>;

export interface Device {
  id: string;
  deviceType: DeviceType;
  site: string | null;
  notes: string | null;
  insertedAt: string;
  removedAt: string | null;
  removalReason: string | null;
  /** Calendar days in place so far (IST), at least 1. */
  days: number;
}

// ---------- rounds ----------

export const roundInputSchema = z.object({
  subjective: optionalText(2000),
  findings: optionalText(4000),
  plan: requiredText('the plan', 4000, 2),
  roundAt: chartTime('Round time'),
});
export type RoundInput = z.input<typeof roundInputSchema>;

export interface Round {
  id: string;
  doctorId: string | null;
  doctorName: string;
  roundAt: string;
  subjective: string | null;
  findings: string | null;
  plan: string;
}

// ---------- running bill ----------

export const chargeInputSchema = z
  .object({
    /** Priced from the billing service master when unitPrice is omitted. */
    serviceCode: blankToUndefined(z.string().trim().toUpperCase().max(40, 'Service code can be at most 40 characters').optional()),
    description: blankToUndefined(z.string().trim().max(300, 'Description can be at most 300 characters').optional()),
    qty: z.coerce
      .number({ error: 'Enter the quantity' })
      .positive('Quantity must be more than 0')
      .max(10000, 'Quantity cannot be more than 10,000')
      .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'Quantity can have at most 2 decimal places')
      .default(1),
    unitPrice: blankToUndefined(money.optional()),
    taxRate: blankToUndefined(gstRate.optional()),
    discount: blankToUndefined(money.optional()),
    /** Not in the future; the API checks it is within the stay. */
    chargeDate: blankToUndefined(pastOrTodayDate('Charge date').optional()),
  })
  .refine((c) => c.serviceCode || (c.description && c.unitPrice !== undefined), {
    message: 'Give a service code, or a description and a price',
  });
export type ChargeInput = z.input<typeof chargeInputSchema>;

export const cancelChargeSchema = z.object({ reason: requiredText('the reason for cancelling', 300, 3) });
export type CancelCharge = z.input<typeof cancelChargeSchema>;

/**
 * A charge on the admission, read from the patient account (billing.charges). Posted here ("Post a charge")
 * or by other departments: pharmacy (medicines on the IPD bill), inventory (consumables), lab, radiology...
 */
export interface Charge {
  id: string;
  chargeDate: string;
  /** Department that posted it: 'ipd', 'pharmacy', 'inventory', 'lab', 'billing'... */
  sourceModule: string;
  serviceCode: string | null;
  itemId: string | null;
  description: string;
  qty: number;
  unitPrice: number;
  /** MRP-style price with GST inside (medicines, consumables). */
  priceIncludesTax: boolean;
  taxRate: number;
  discount: number;
  /** qty × price − discount, plus GST unless the price already includes it. */
  amount: number;
  /** pending = on the running bill; billed = on an invoice (the IPD bill, or a bill made at the desk). */
  status: 'pending' | 'billed' | 'cancelled';
  invoiceId: string | null;
  invoiceNumber: string | null;
  cancelReason: string | null;
  createdAt: string;
}

/** Bed rent for one stay, one line per bed. Computed from the bed stays until the bill is final. */
export interface BedChargeLine {
  stayId: string;
  bedLabel: string;
  serviceCode: string | null;
  days: number;
  /** One label date per charged day (India time), per the hospital's room-rent day rule. */
  dates: string[];
  dailyRate: number;
  amount: number;
}

/** Approved insurance pre-auth against the running bill ("estimate vs actual"). */
export interface PreauthEstimate {
  preauthId: string;
  number: string;
  payerName: string;
  approvedAmount: number;
  /** Running total (bed + charges) minus the approved amount; positive = bill has passed the approval. */
  overBy: number;
  /** Share of the approved amount used so far, in %. */
  usedPct: number;
}

export const advanceInputSchema = z.object({
  mode: z.enum(ADVANCE_MODES),
  amount: positiveMoney,
  reference: optionalText(100),
});
export type AdvanceInput = z.input<typeof advanceInputSchema>;

export interface Advance {
  id: string;
  paymentId: string;
  receiptNo: string;
  mode: AdvanceMode;
  amount: number;
  receivedAt: string;
}

export interface RunningBill {
  admissionId: string;
  status: 'running' | 'final';
  invoiceId: string | null;
  bedCharges: BedChargeLine[];
  charges: Charge[];
  bedTotal: number;
  chargesTotal: number;
  /** Estimate before round-off; the invoice is the final word. */
  grossTotal: number;
  advances: Advance[];
  advanceTotal: number;
  /** Patient's unused advance with billing right now (all admissions and OPD). */
  depositBalance: number;
  /** grossTotal − advances taken for this admission (negative = refund due). */
  estimatedDue: number;
  /** How bed days are counted (the hospital's billing rule). */
  roomRentDay: 'midnight' | 'admission_time' | 'checkout_time';
  checkoutTime: string;
  /** Charges of this stay billed on a separate bill at the desk (not part of the totals above). */
  billedElsewhereTotal: number;
  /** The patient's approved pre-auth for this stay, if any. */
  preauth: PreauthEstimate | null;
}

/** IpdService.currentAdmission / admissionInTx (cross-module): where a patient's charges go. */
export interface CurrentAdmission {
  id: string;
  ipdNo: string;
  patientId: string;
  patientName: string;
  patientUhid: string;
  facilityId: string;
  status: AdmissionStatus;
  /** The IPD bill is already final: later charges go on a separate bill. */
  billFinal: boolean;
}

export const finalizeBillSchema = z.object({
  /** Adjust the patient's advance against the invoice (default true). */
  adjustAdvance: z.boolean().default(true),
  /** Bill discount in rupees, spread over the lines; above the hospital's limit needs billing.discount.override. */
  discount: money.optional(),
  notes: optionalText(500),
});
export type FinalizeBill = z.input<typeof finalizeBillSchema>;

export interface FinalizedBill {
  invoiceId: string;
  number: string | null;
  total: number;
  advanceAdjusted: number;
  balanceDue: number;
}

// ---------- discharge summary ----------

export const dischargeMedicationSchema = z.object({
  drugName: requiredText('the medicine', 200),
  dose: optionalText(100),
  frequency: optionalText(50),
  days: blankToUndefined(z.coerce.number().int('Days must be a whole number').min(0, 'Days cannot be negative').max(365, 'Days cannot be more than 365').optional()),
  instructions: optionalText(300),
});
export type DischargeMedication = z.infer<typeof dischargeMedicationSchema>;

export const dischargeSummaryInputSchema = z.object({
  finalDiagnosis: requiredText('the final diagnosis', 2000, 2),
  presentingComplaints: optionalText(4000),
  history: optionalText(4000),
  examination: optionalText(4000),
  investigations: optionalText(8000),
  procedures: optionalText(4000),
  hospitalCourse: optionalText(8000),
  conditionAtDischarge: optionalText(1000),
  medications: z.array(dischargeMedicationSchema).max(50).default([]),
  advice: optionalText(4000),
  /** The API checks it is not before the discharge (or today, while admitted). */
  followUpDate: isoDate.optional(),
  followUpNotes: optionalText(500),
});
export type DischargeSummaryInput = z.input<typeof dischargeSummaryInputSchema>;

export interface DischargeSummary {
  id: string;
  admissionId: string;
  finalDiagnosis: string;
  presentingComplaints: string | null;
  history: string | null;
  examination: string | null;
  investigations: string | null;
  procedures: string | null;
  hospitalCourse: string | null;
  conditionAtDischarge: string | null;
  medications: DischargeMedication[];
  advice: string | null;
  followUpDate: string | null;
  followUpNotes: string | null;
  status: 'draft' | 'final';
  finalizedByName: string | null;
  finalizedAt: string | null;
  updatedAt: string;
}

// ---------- daily census ----------

export const censusQuerySchema = z.object({ date: isoDate });

/** Midnight census for one ward and one India calendar date. */
export interface WardCensus {
  facilityId: string;
  date: string;
  wardId: string;
  wardName: string;
  wardType: WardType;
  /** Inpatients in the ward at the end of the day (23:59 IST). */
  patientDays: number;
  catheterDays: number;
  centralLineDays: number;
  ventilatorDays: number;
  admissions: number;
  discharges: number;
  /** Not tracked until the OT module exists. */
  surgeries: number | null;
}

// ---------- events ----------

/**
 * `ipd.census.daily`: published once per facility per India date (shortly after midnight) with one row
 * per active ward. Consumed by quality (HAI and fall rates per 1000 patient/device days) and reports.
 */
export interface CensusDailyEvent {
  facilityId: string;
  date: string;
  wards: WardCensus[];
}

export interface PatientAdmittedEvent {
  admissionId: string;
  ipdNo: string;
  patientId: string;
  facilityId: string;
  doctorId: string;
  bedId: string;
  wardId: string;
  admittedAt: string;
}

export interface PatientTransferredEvent {
  admissionId: string;
  patientId: string;
  facilityId: string;
  fromBedId: string;
  toBedId: string;
  toWardId: string;
}

export interface PatientDischargedEvent {
  admissionId: string;
  ipdNo: string;
  patientId: string;
  facilityId: string;
  doctorId: string;
  dischargeType: DischargeType;
  dischargedAt: string;
  invoiceId: string | null;
}

export interface DischargeSummaryFinalizedEvent {
  admissionId: string;
  summaryId: string;
  patientId: string;
  finalizedAt: string;
}
