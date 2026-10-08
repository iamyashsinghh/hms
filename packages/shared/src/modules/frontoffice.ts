import { z } from 'zod';
import { defineModule } from '../manifest';
import type { Doctor as SetupDoctor } from './setup';
import { abhaNumber as abhaNumberField, blankToUndefined, datesInOrder, END_BEFORE_START } from '../validation';

/**
 * Front Office: permissions and API contracts (Zod schemas + types).
 * Owned by the "frontoffice" workstream: appointments, walk-ins, OPD token queue, check-in,
 * TV queue display, duplicate-patient search, patient merge and ABHA capture.
 */
export const frontofficeModule = defineModule({
  key: 'frontoffice',
  name: 'Front Office',
  permissions: [
    { key: 'frontoffice.appointment.read', description: 'View appointments' },
    { key: 'frontoffice.appointment.create', description: 'Book appointments' },
    { key: 'frontoffice.appointment.update', description: 'Reschedule, cancel or mark appointments as no-show' },
    { key: 'frontoffice.queue.read', description: 'View the OPD token queue' },
    { key: 'frontoffice.queue.manage', description: 'Check in patients, add walk-ins and move tokens through the queue' },
    { key: 'frontoffice.queue.display', description: 'Open the TV queue display' },
    { key: 'frontoffice.patient.dedupe', description: 'Search for duplicate patients and capture ABHA numbers' },
    { key: 'frontoffice.patient.merge', description: 'Merge duplicate patient records' },
  ],
  grants: {
    hospital_admin: [
      'frontoffice.appointment.read', 'frontoffice.appointment.create', 'frontoffice.appointment.update',
      'frontoffice.queue.read', 'frontoffice.queue.manage', 'frontoffice.queue.display',
      'frontoffice.patient.dedupe', 'frontoffice.patient.merge',
    ],
    receptionist: [
      'frontoffice.appointment.read', 'frontoffice.appointment.create', 'frontoffice.appointment.update',
      'frontoffice.queue.read', 'frontoffice.queue.manage', 'frontoffice.queue.display', 'frontoffice.patient.dedupe',
    ],
    doctor: ['frontoffice.appointment.read', 'frontoffice.queue.read', 'frontoffice.queue.manage'],
    nurse: ['frontoffice.appointment.read', 'frontoffice.queue.read', 'frontoffice.queue.manage', 'frontoffice.queue.display'],
    owner: ['frontoffice.appointment.read', 'frontoffice.queue.read', 'frontoffice.queue.display'],
    billing_clerk: ['frontoffice.appointment.read', 'frontoffice.queue.read'],
  },
});

// ---------- shared bits ----------

const isoDate = z.iso.date();
/** '' counts as not given. Typed as the inner schema so the request types stay `string | undefined`. */
const blank = <T extends z.ZodType>(schema: T): T => blankToUndefined(schema) as unknown as T;
const dateTime = z.iso.datetime({ offset: true });

export const APPOINTMENT_TYPES = ['new', 'follow_up', 'review', 'procedure'] as const;
export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_SOURCES = ['desk', 'phone', 'portal', 'mobile'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/**
 * Appointment status machine:
 *   booked → checked_in → in_consultation → completed
 *   booked → cancelled | no_show
 *   checked_in → cancelled (patient left before being seen)
 * Rescheduling keeps the appointment `booked` and records a history row.
 */
export const APPOINTMENT_STATUSES = ['booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  booked: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['in_consultation', 'cancelled', 'completed'],
  in_consultation: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/**
 * OPD queue (visit) status machine:
 *   waiting → called → in_consultation → completed
 *   waiting | called → skipped → waiting (requeue)
 *   waiting | called | skipped → cancelled
 */
export const VISIT_STATUSES = ['waiting', 'called', 'in_consultation', 'completed', 'skipped', 'cancelled'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_ACTIONS = ['call', 'start', 'complete', 'skip', 'requeue', 'cancel'] as const;
export type VisitAction = (typeof VISIT_ACTIONS)[number];

export const VISIT_TRANSITIONS: Record<VisitAction, { from: readonly VisitStatus[]; to: VisitStatus }> = {
  call: { from: ['waiting', 'called', 'skipped'], to: 'called' },
  start: { from: ['waiting', 'called'], to: 'in_consultation' },
  complete: { from: ['in_consultation', 'called'], to: 'completed' },
  skip: { from: ['waiting', 'called'], to: 'skipped' },
  requeue: { from: ['skipped'], to: 'waiting' },
  cancel: { from: ['waiting', 'called', 'skipped'], to: 'cancelled' },
};

export const VISIT_PRIORITIES = ['normal', 'senior', 'urgent'] as const;
export type VisitPriority = (typeof VISIT_PRIORITIES)[number];

export const VISIT_KINDS = ['appointment', 'walk_in'] as const;
export type VisitKind = (typeof VISIT_KINDS)[number];

/** Slot length for doctors with no schedule set up in the setup module (free-form booking). */
export const DEFAULT_SLOT_MINUTES = 15;

// ---------- doctors ----------

/** Doctors come from the setup module (SetupService.listDoctors). */
export type Doctor = SetupDoctor;

/** A setup schedule slot with front office occupancy. */
export interface AvailableSlot {
  start: string;
  end: string;
  facilityId: string;
  capacity: number;
  booked: number;
  available: boolean;
}

export const availableSlotsQuerySchema = z.object({ date: isoDate, facilityId: z.uuid().optional() });
export type AvailableSlotsQuery = { date: string; facilityId?: string };

// ---------- appointments ----------

export const bookAppointmentSchema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid(),
  /** Defaults to the X-Facility-Id facility (or the hospital's only facility). */
  facilityId: z.uuid().optional(),
  slotStart: dateTime,
  /** Minutes; only used for doctors without a schedule (otherwise the slot decides). Defaults to DEFAULT_SLOT_MINUTES. */
  durationMinutes: z.number().int().min(5).max(240).optional(),
  type: z.enum(APPOINTMENT_TYPES).default('new'),
  source: z.enum(APPOINTMENT_SOURCES).default('desk'),
  reason: z.string().trim().max(500).optional(),
});
export type BookAppointment = z.input<typeof bookAppointmentSchema>;

export const rescheduleAppointmentSchema = z.object({
  slotStart: dateTime,
  durationMinutes: z.number().int().min(5).max(240).optional(),
  doctorId: z.uuid().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type RescheduleAppointment = z.input<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string({ error: 'Give a reason for cancelling' }).trim().min(1, 'Give a reason for cancelling').max(500, 'Reason can be at most 500 characters'),
});
export type CancelAppointment = z.input<typeof cancelAppointmentSchema>;

export const checkInSchema = z.object({
  priority: z.enum(VISIT_PRIORITIES, { error: 'Pick a priority: normal, senior or urgent' }).default('normal'),
  notes: z.string().trim().max(500, 'Notes can be at most 500 characters').optional(),
});
export type CheckIn = z.input<typeof checkInSchema>;

export const appointmentListQuerySchema = z
  .object({
    date: isoDate.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    doctorId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .refine((q) => datesInOrder(q.from, q.to), { message: END_BEFORE_START, path: ['to'] });
export type AppointmentListQuery = {
  date?: string;
  from?: string;
  to?: string;
  doctorId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  page?: number;
  pageSize?: number;
};

export const patientBriefSchema = z.object({
  id: z.uuid(),
  uhid: z.string(),
  name: z.string(),
  gender: z.string(),
  dateOfBirth: z.string().nullable(),
  mobile: z.string().nullable(),
});
export type PatientBrief = z.infer<typeof patientBriefSchema>;

export const appointmentSchema = z.object({
  id: z.uuid(),
  appointmentNo: z.string(),
  facilityId: z.uuid(),
  patientId: z.uuid(),
  patient: patientBriefSchema.optional(),
  doctorId: z.uuid(),
  doctorName: z.string().nullable(),
  slotStart: z.string(),
  slotEnd: z.string(),
  type: z.enum(APPOINTMENT_TYPES),
  source: z.enum(APPOINTMENT_SOURCES),
  status: z.enum(APPOINTMENT_STATUSES),
  reason: z.string().nullable(),
  cancelReason: z.string().nullable(),
  rescheduleCount: z.number().int(),
  visitId: z.uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

export const appointmentHistorySchema = z.object({
  id: z.uuid(),
  fromStatus: z.enum(APPOINTMENT_STATUSES).nullable(),
  toStatus: z.enum(APPOINTMENT_STATUSES),
  event: z.string(),
  note: z.string().nullable(),
  data: z.record(z.string(), z.unknown()).nullable(),
  actorId: z.uuid().nullable(),
  at: z.string(),
});
export type AppointmentHistory = z.infer<typeof appointmentHistorySchema>;

export type AppointmentDetail = Appointment & { history: AppointmentHistory[] };

// ---------- visits / queue ----------

export const walkInSchema = z.object({
  patientId: z.uuid({ error: 'Pick a patient' }),
  doctorId: z.uuid({ error: 'Pick a doctor' }),
  facilityId: z.uuid({ error: 'Pick a valid facility' }).optional(),
  priority: z.enum(VISIT_PRIORITIES, { error: 'Pick a priority: normal, senior or urgent' }).default('normal'),
  notes: z.string().trim().max(500, 'Notes can be at most 500 characters').optional(),
});
export type WalkIn = z.input<typeof walkInSchema>;

export const visitTransitionSchema = z.object({
  action: z.enum(VISIT_ACTIONS, { error: 'Unknown token action' }),
  /** Consultation room / cabin shown on the TV display when calling. */
  room: blank(z.string().trim().max(40, 'Room can be at most 40 characters').optional()),
});
export type VisitTransition = z.input<typeof visitTransitionSchema>;

export const queueQuerySchema = z.object({
  doctorId: z.uuid().optional(),
  date: isoDate.optional(),
  facilityId: z.uuid().optional(),
  status: z.enum(VISIT_STATUSES).optional(),
});
export type QueueQuery = { doctorId?: string; date?: string; facilityId?: string; status?: VisitStatus };

export const visitSchema = z.object({
  id: z.uuid(),
  visitNo: z.string(),
  facilityId: z.uuid(),
  patientId: z.uuid(),
  patient: patientBriefSchema.optional(),
  doctorId: z.uuid(),
  doctorName: z.string().nullable(),
  appointmentId: z.uuid().nullable(),
  visitDate: z.string(),
  tokenNo: z.number().int(),
  kind: z.enum(VISIT_KINDS),
  priority: z.enum(VISIT_PRIORITIES),
  status: z.enum(VISIT_STATUSES),
  room: z.string().nullable(),
  notes: z.string().nullable(),
  checkedInAt: z.string(),
  calledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type Visit = z.infer<typeof visitSchema>;

export interface QueueSummary {
  waiting: number;
  called: number;
  inConsultation: number;
  completed: number;
  skipped: number;
  cancelled: number;
}

export interface QueueResponse {
  date: string;
  items: Visit[];
  summary: QueueSummary;
}

export const displayQuerySchema = z.object({
  facilityId: z.uuid().optional(),
  doctorId: z.uuid().optional(),
});
export type DisplayQuery = { facilityId?: string; doctorId?: string };

/** TV display: names are masked (first name + last initial). */
export interface DisplayBoard {
  date: string;
  generatedAt: string;
  doctors: Array<{
    doctorId: string;
    doctorName: string;
    nowServing: { tokenNo: number; patientName: string; room: string | null; status: VisitStatus } | null;
    next: Array<{ tokenNo: number; patientName: string }>;
    waitingCount: number;
  }>;
}

// ---------- duplicates, merge, ABHA ----------

export const duplicateSearchSchema = z
  .object({
    firstName: z.string().trim().max(100).optional(),
    lastName: z.string().trim().max(100).optional(),
    mobile: z.string().trim().max(15).optional(),
    dateOfBirth: isoDate.optional(),
    abhaNumber: z.string().trim().max(20).optional(),
    excludeId: z.uuid().optional(),
  })
  .refine((v) => v.firstName || v.mobile || v.abhaNumber, { message: 'Give a name, mobile or ABHA number' });
export type DuplicateSearch = {
  firstName?: string;
  lastName?: string;
  mobile?: string;
  dateOfBirth?: string;
  abhaNumber?: string;
  excludeId?: string;
};

export interface DuplicateCandidate {
  patient: PatientBrief & { abhaNumber: string | null };
  /** 0–100; 80+ is very likely the same person. */
  score: number;
  reasons: string[];
}

export const mergePatientsSchema = z
  .object({
    /** The duplicate; it is deactivated and pointed at the target. */
    sourcePatientId: z.uuid(),
    /** The record that is kept. */
    targetPatientId: z.uuid(),
    reason: z
      .string({ error: 'Give a reason for the merge' })
      .trim()
      .min(1, 'Give a reason for the merge')
      .min(3, 'Reason needs at least 3 characters')
      .max(500, 'Reason can be at most 500 characters'),
  })
  .refine((v) => v.sourcePatientId !== v.targetPatientId, { message: 'Pick two different patients', path: ['targetPatientId'] });
export type MergePatients = z.input<typeof mergePatientsSchema>;

export interface PatientMerge {
  id: string;
  sourcePatientId: string;
  targetPatientId: string;
  reason: string;
  movedAppointments: number;
  movedVisits: number;
  mergedBy: string | null;
  mergedAt: string;
}

export const abhaCaptureSchema = z.object({
  abhaNumber: abhaNumberField,
  /** ABHA address like name@abdm; kept in clinical.patient_abha until the integrations module verifies it. */
  abhaAddress: blank(
    z
      .string()
      .trim()
      .toLowerCase()
      .max(100, 'ABHA address can be at most 100 characters')
      .regex(/^[a-z0-9][a-z0-9._-]{2,63}@[a-z]{2,20}$/, 'Enter an ABHA address like name@abdm')
      .optional(),
  ),
});
export type AbhaCapture = z.input<typeof abhaCaptureSchema>;

// ---------- events (payload types) ----------

export interface AppointmentBookedEvent {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  facilityId: string;
  doctorName: string | null;
  start: string;
  appointmentNo: string;
}
export type AppointmentCancelledEvent = AppointmentBookedEvent & { reason: string };
export type AppointmentRescheduledEvent = AppointmentBookedEvent & { previousStart: string };
export interface VisitCheckedInEvent {
  visitId: string;
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  facilityId: string;
  tokenNo: number;
  visitNo: string;
  kind: VisitKind;
}
export interface VisitStatusChangedEvent {
  visitId: string;
  patientId: string;
  doctorId: string;
  facilityId: string;
  tokenNo: number;
  status: VisitStatus;
  room: string | null;
}
/** Other modules re-point their rows from source to target when they receive this. */
export interface PatientMergedEvent {
  mergeId: string;
  sourcePatientId: string;
  targetPatientId: string;
}

export const FRONTOFFICE_EVENTS = {
  appointmentBooked: 'frontoffice.appointment.booked',
  appointmentRescheduled: 'frontoffice.appointment.rescheduled',
  appointmentCancelled: 'frontoffice.appointment.cancelled',
  visitCheckedIn: 'frontoffice.visit.checked_in',
  visitStatusChanged: 'frontoffice.visit.status_changed',
  patientMerged: 'frontoffice.patient.merged',
} as const;
