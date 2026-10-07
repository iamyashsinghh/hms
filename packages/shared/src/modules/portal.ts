import { z } from 'zod';
import { defineModule } from '../manifest';
import { BLOOD_GROUPS, GENDERS } from './core';

/**
 * Patient Portal: permissions and API contracts (Zod schemas + types).
 * Owned by the "portal" workstream.
 *
 * Patients sign in with their mobile number + OTP at one hospital (hospital code). Their access
 * token has `typ: 'patient'`, so the staff guard rejects it and portal routes accept only it.
 * Staff permissions below cover the hospital side: online booking requests and feedback.
 */
export const portalModule = defineModule({
  key: 'portal',
  name: 'Patient Portal',
  permissions: [
    { key: 'portal.booking.read', description: 'View online appointment requests from the patient portal' },
    { key: 'portal.booking.manage', description: 'Confirm or reject online appointment requests' },
    { key: 'portal.feedback.read', description: 'View patient feedback' },
    { key: 'portal.account.read', description: 'View patient portal accounts' },
  ],
  grants: {
    hospital_admin: ['portal.booking.read', 'portal.booking.manage', 'portal.feedback.read', 'portal.account.read'],
    owner: ['portal.booking.read', 'portal.feedback.read', 'portal.account.read'],
    receptionist: ['portal.booking.read', 'portal.booking.manage', 'portal.feedback.read'],
    doctor: ['portal.booking.read'],
    quality_manager: ['portal.feedback.read'],
  },
});

const mobile = z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const tenantCode = z.string().trim().toLowerCase().min(2).max(63);
const client = z.enum(['web', 'mobile']).default('web');

// ---------- Auth (patient OTP) ----------

export const otpRequestSchema = z.object({ tenantCode, mobile });
export type OtpRequest = z.input<typeof otpRequestSchema>;

export interface OtpRequestResponse {
  challengeId: string;
  /** Seconds until the code expires. */
  expiresIn: number;
  /** Only outside production, with the mock SMS provider, so dev and tests can sign in. */
  devCode?: string;
}

/** Verifies the latest code sent to this mobile at this hospital. */
export const otpVerifySchema = z.object({
  tenantCode,
  mobile,
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  client,
  deviceName: z.string().max(100).optional(),
});
export type OtpVerify = z.input<typeof otpVerifySchema>;

export const patientRefreshSchema = z.object({ refreshToken: z.string().optional(), client });
export type PatientRefresh = z.input<typeof patientRefreshSchema>;

/** Claims inside a patient access token. */
export interface PatientTokenClaims {
  /** Portal account id. */
  sub: string;
  tid: string;
  /** Portal session id. */
  sid: string;
  typ: 'patient';
}

export interface PatientTokens {
  accessToken: string;
  expiresIn: number;
  /** Only returned to mobile clients; web gets an httpOnly cookie. */
  refreshToken?: string;
}

export const RELATIONS = ['self', 'spouse', 'child', 'parent', 'sibling', 'other'] as const;
export type Relation = (typeof RELATIONS)[number];

export interface PortalPatient {
  id: string;
  uhid: string;
  firstName: string;
  lastName: string | null;
  gender: string;
  dateOfBirth: string | null;
  bloodGroup: string | null;
  relation: Relation;
}

export interface PortalMe {
  accountId: string;
  mobile: string;
  name: string | null;
  tenantCode: string;
  hospitalName: string;
  patients: PortalPatient[];
}

export interface PatientLoginResponse extends PatientTokens {
  me: PortalMe;
}

export interface PortalHospital {
  code: string;
  name: string;
  facilities: { id: string; code: string; name: string }[];
}

// ---------- Profile & family ----------

export const updateAccountSchema = z.object({ name: z.string().trim().min(1).max(100) });
export type UpdateAccount = z.infer<typeof updateAccountSchema>;

export const addFamilyMemberSchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().max(100).optional(),
    gender: z.enum(GENDERS),
    dateOfBirth: z.iso.date().optional(),
    ageYears: z.number().int().min(0).max(150).optional(),
    bloodGroup: z.enum(BLOOD_GROUPS).optional(),
    relation: z.enum(RELATIONS),
  })
  .refine((v) => v.dateOfBirth || v.ageYears !== undefined, { message: 'Enter date of birth or age', path: ['dateOfBirth'] });
export type AddFamilyMember = z.infer<typeof addFamilyMemberSchema>;

// ---------- Doctors & booking ----------

export interface PortalDoctor {
  userId: string;
  name: string;
  departmentId?: string | null;
  specialization?: string | null;
  consultationFee?: number | null;
}

export const doctorQuerySchema = z.object({ facilityId: z.uuid().optional(), departmentId: z.uuid().optional() });
export type DoctorQuery = { facilityId?: string; departmentId?: string };

export const slotQuerySchema = z.object({ date: z.iso.date(), facilityId: z.uuid().optional() });

export interface PortalSlot {
  start: string;
  end: string;
  /** Branch where the doctor sits for this slot. */
  facilityId?: string;
  available: boolean;
}

export const APPOINTMENT_STATUSES = ['requested', 'booked', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const bookAppointmentSchema = z.object({
  patientId: z.uuid(),
  doctorId: z.uuid(),
  facilityId: z.uuid().optional(),
  slotStart: z.iso.datetime({ offset: true }),
  reason: z.string().trim().max(500).optional(),
});
export type BookAppointment = z.infer<typeof bookAppointmentSchema>;

export interface PortalAppointment {
  id: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string | null;
  facilityId: string | null;
  slotStart: string;
  status: AppointmentStatus;
  /** 'portal' = booked online; 'desk' = booked at the hospital. */
  source: 'portal' | 'desk';
  /** Front office appointment id once the booking reached the hospital's schedule. */
  appointmentId: string | null;
  reason: string | null;
  staffNote: string | null;
  createdAt: string;
}

export const appointmentListQuerySchema = z.object({
  patientId: z.uuid().optional(),
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
});
export type AppointmentListQuery = { patientId?: string; scope?: 'upcoming' | 'past' | 'all' };

// ---------- Records (projections of other modules' events) ----------

export interface PortalPrescriptionLine {
  drugName: string;
  dose?: string;
  frequency?: string;
  days?: number;
  qty?: number;
  instructions?: string;
}

export interface PortalPrescription {
  id: string;
  prescriptionId: string;
  patientId: string;
  patientName: string;
  doctorId: string | null;
  doctorName: string | null;
  lines: PortalPrescriptionLine[];
  issuedAt: string;
}

export const INVOICE_STATUSES = ['unpaid', 'partially_paid', 'paid', 'cancelled'] as const;
export type PortalInvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface PortalInvoice {
  id: string;
  invoiceId: string;
  number: string | null;
  patientId: string;
  patientName: string;
  total: string;
  paid: string;
  due: string;
  status: PortalInvoiceStatus;
  issuedAt: string;
}

export interface PortalReport {
  id: string;
  reportId: string;
  patientId: string;
  patientName: string;
  kind: 'lab' | 'radiology' | 'other';
  title: string;
  url: string | null;
  issuedAt: string;
}

export const recordQuerySchema = z.object({ patientId: z.uuid().optional() });
export type RecordQuery = { patientId?: string };

// ---------- Online payment (Razorpay stub) ----------

export const createPaymentIntentSchema = z.object({ invoiceId: z.uuid() });
export type CreatePaymentIntent = z.infer<typeof createPaymentIntentSchema>;

export const PAYMENT_INTENT_STATUSES = ['created', 'paid', 'failed'] as const;

export interface PortalPaymentIntent {
  id: string;
  invoiceId: string;
  amount: string;
  currency: 'INR';
  provider: 'razorpay_stub';
  providerOrderId: string;
  status: (typeof PAYMENT_INTENT_STATUSES)[number];
  createdAt: string;
}

export const confirmPaymentSchema = z.object({
  /** Gateway payment id returned by checkout (any value with the stub provider). */
  providerPaymentId: z.string().trim().min(1).max(100),
  /** Checkout signature; the stub provider accepts 'stub' only, so real signatures can't be faked here. */
  signature: z.string().trim().min(1).max(200),
});
export type ConfirmPayment = z.infer<typeof confirmPaymentSchema>;

// ---------- Feedback ----------

export const createFeedbackSchema = z.object({
  patientId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).optional(),
  appointmentRequestId: z.uuid().optional(),
});
export type CreateFeedback = z.infer<typeof createFeedbackSchema>;

export interface PortalFeedback {
  id: string;
  patientId: string;
  patientName: string;
  rating: number;
  comment: string | null;
  appointmentRequestId: string | null;
  createdAt: string;
}

// ---------- Staff side ----------

export const staffBookingQuerySchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  date: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type StaffBookingQuery = { status?: AppointmentStatus; date?: string; page?: number; pageSize?: number };

export const decideBookingSchema = z.object({
  decision: z.enum(['confirm', 'reject']),
  note: z.string().trim().max(500).optional(),
});
export type DecideBooking = z.infer<typeof decideBookingSchema>;

export const staffFeedbackQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export interface FeedbackSummary {
  count: number;
  average: number | null;
}

// ---------- Events published by portal ----------

/** `portal.appointment.requested`: a patient booked online and front office has not booked it yet. */
export interface AppointmentRequestedEvent {
  requestId: string;
  patientId: string;
  doctorId: string;
  facilityId: string | null;
  slotStart: string;
}

/**
 * Shared payload of `portal.appointment.confirmed` (an online booking landed in the doctor's diary, or staff
 * confirmed a request), `portal.appointment.rejected` (staff turned a request down) and
 * `portal.appointment.cancelled` (the patient cancelled from the portal). Notifications uses it for push/SMS.
 */
export interface PortalAppointmentEvent {
  /** Portal booking id (portal.appointments.id). */
  requestId: string;
  /** Front office appointment id; null when the request never reached the diary. */
  appointmentId: string | null;
  patientId: string;
  doctorId: string;
  doctorName: string;
  facilityId: string | null;
  slotStart: string;
  /** Staff note on a rejection, or the cancel reason. */
  note: string | null;
}
export type AppointmentConfirmedEvent = PortalAppointmentEvent;
export type AppointmentRejectedEvent = PortalAppointmentEvent;
export type AppointmentCancelledEvent = PortalAppointmentEvent;

/** `portal.payment.captured`: billing records the payment against the invoice. */
export interface PaymentCapturedEvent {
  intentId: string;
  invoiceId: string;
  patientId: string;
  amount: string;
  mode: 'online';
  provider: 'razorpay_stub';
  providerPaymentId: string;
}

/** `portal.feedback.submitted` (quality, CRM and notifications may subscribe). */
export interface FeedbackSubmittedEvent {
  feedbackId: string;
  patientId: string;
  rating: number;
}
