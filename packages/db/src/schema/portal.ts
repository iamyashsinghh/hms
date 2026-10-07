/**
 * Patient Portal tables. Owned by the "portal" workstream (Postgres schema: portal).
 * Accounts, OTP challenges and sessions are per hospital (RLS by tenant_id like everything else).
 * prescriptions / invoices / reports / desk appointments are read models filled from other modules' events.
 */
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, numeric, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, portal as pg, tenantIdColumn, timestamps } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const portalAccounts = pg.table(
  'accounts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    mobile: text('mobile').notNull(),
    name: text('name'),
    status: text('status').notNull().default('active'),
    lastLoginAt: ts('last_login_at'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('portal_accounts_mobile_uq').on(t.tenantId, t.mobile)],
);

export const portalOtpChallenges = pg.table(
  'otp_challenges',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    mobile: text('mobile').notNull(),
    codeHash: text('code_hash').notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    createdIp: text('created_ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('portal_otp_mobile_idx').on(t.tenantId, t.mobile, t.createdAt)],
);

export const portalSessions = pg.table(
  'sessions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    accountId: uuid('account_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    previousTokenHash: text('previous_token_hash'),
    rotatedAt: ts('rotated_at'),
    client: text('client').notNull(),
    deviceName: text('device_name'),
    createdIp: text('created_ip'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('portal_sessions_account_idx').on(t.tenantId, t.accountId)],
);

export const portalAccountPatients = pg.table(
  'account_patients',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    accountId: uuid('account_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    relation: text('relation').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('portal_account_patients_uq').on(t.tenantId, t.accountId, t.patientId),
  ],
);

export const portalAppointments = pg.table(
  'appointments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    accountId: uuid('account_id'),
    doctorId: uuid('doctor_id').notNull(),
    doctorName: text('doctor_name'),
    facilityId: uuid('facility_id'),
    slotStart: ts('slot_start').notNull(),
    status: text('status').notNull(),
    source: text('source').notNull(),
    appointmentId: uuid('appointment_id'),
    reason: text('reason'),
    staffNote: text('staff_note'),
    decidedBy: uuid('decided_by'),
    decidedAt: ts('decided_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('portal_appointments_appt_uq').on(t.tenantId, t.appointmentId),
    index('portal_appointments_patient_idx').on(t.tenantId, t.patientId, t.slotStart),
    index('portal_appointments_doctor_idx').on(t.tenantId, t.doctorId, t.slotStart),
  ],
);

export const portalPrescriptions = pg.table(
  'prescriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    prescriptionId: uuid('prescription_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id'),
    doctorName: text('doctor_name'),
    lines: jsonb('lines').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    issuedAt: ts('issued_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('portal_prescriptions_src_uq').on(t.tenantId, t.prescriptionId),
    index('portal_prescriptions_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const portalInvoices = pg.table(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    number: text('number'),
    patientId: uuid('patient_id').notNull(),
    total: numeric('total', { precision: 14, scale: 2 }).notNull(),
    paid: numeric('paid', { precision: 14, scale: 2 }).notNull().default('0'),
    status: text('status').notNull(),
    issuedAt: ts('issued_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('portal_invoices_src_uq').on(t.tenantId, t.invoiceId),
    index('portal_invoices_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const portalReports = pg.table(
  'reports',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    reportId: uuid('report_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    issuedAt: ts('issued_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('portal_reports_src_uq').on(t.tenantId, t.reportId),
    index('portal_reports_patient_idx').on(t.tenantId, t.patientId),
  ],
);

export const portalPaymentIntents = pg.table(
  'payment_intents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    accountId: uuid('account_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerPaymentId: text('provider_payment_id'),
    status: text('status').notNull(),
    paidAt: ts('paid_at'),
    settledAt: ts('settled_at'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('portal_payment_intents_invoice_idx').on(t.tenantId, t.invoiceId)],
);

export const portalFeedback = pg.table(
  'feedback',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    accountId: uuid('account_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    rating: smallint('rating').notNull(),
    comment: text('comment'),
    appointmentRequestId: uuid('appointment_request_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('portal_feedback_created_idx').on(t.tenantId, t.createdAt)],
);

/** Event ids already applied to the read models (handlers run at least once). */
export const portalProcessedEvents = pg.table(
  'processed_events',
  {
    tenantId: tenantIdColumn(),
    eventId: uuid('event_id').notNull(),
    topic: text('topic').notNull(),
    processedAt: ts('processed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.eventId] })],
);
