/**
 * Reports & MIS tables. Owned by the "reports" workstream (Postgres schema: reporting).
 * These are fact tables the worker fills from the agreed events (PARALLEL_PLAN.md section 4),
 * so reports never depends on another module's table layout. Rows are derived data.
 */
import { index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, reporting as pg, tenantIdColumn } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Every event the reports module consumed, keyed by outbox id (idempotency + replay). */
export const reportsIngestedEvents = pg.table(
  'ingested_events',
  {
    tenantId: tenantIdColumn(),
    id: uuid('id').notNull(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: ts('occurred_at').notNull(),
    ingestedAt: ts('ingested_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('ingested_events_topic_idx').on(t.tenantId, t.topic, t.occurredAt)],
);

export const reportsOpdVisits = pg.table(
  'opd_visits',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    visitId: uuid('visit_id').notNull(),
    appointmentId: uuid('appointment_id'),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id'),
    facilityId: uuid('facility_id'),
    tokenNo: integer('token_no'),
    checkedInAt: ts('checked_in_at').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('opd_visits_visit_uq').on(t.tenantId, t.visitId),
    index('opd_visits_time_idx').on(t.tenantId, t.checkedInAt),
    index('opd_visits_appt_idx').on(t.tenantId, t.appointmentId),
  ],
);

export const REPORT_APPOINTMENT_STATUSES = ['booked', 'cancelled'] as const;

export const reportsAppointments = pg.table(
  'appointments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    appointmentId: uuid('appointment_id').notNull(),
    patientId: uuid('patient_id'),
    doctorId: uuid('doctor_id'),
    facilityId: uuid('facility_id'),
    startAt: ts('start_at'),
    status: text('status').notNull().default('booked'),
    bookedAt: ts('booked_at'),
    cancelledAt: ts('cancelled_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('appointments_appt_uq').on(t.tenantId, t.appointmentId),
    index('appointments_start_idx').on(t.tenantId, t.startAt),
  ],
);

export const reportsEncounters = pg.table(
  'encounters',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id'),
    doctorId: uuid('doctor_id'),
    signedAt: ts('signed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('encounters_encounter_uq').on(t.tenantId, t.encounterId),
    index('encounters_time_idx').on(t.tenantId, t.signedAt),
  ],
);

export const reportsInvoices = pg.table(
  'invoices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    number: text('number'),
    patientId: uuid('patient_id'),
    facilityId: uuid('facility_id'),
    doctorId: uuid('doctor_id'),
    sourceModule: text('source_module'),
    sourceRefId: uuid('source_ref_id'),
    total: numeric('total', { precision: 14, scale: 2 }).notNull().default('0'),
    finalizedAt: ts('finalized_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('invoices_invoice_uq').on(t.tenantId, t.invoiceId),
    index('invoices_time_idx').on(t.tenantId, t.finalizedAt),
  ],
);

export const reportsInvoiceLines = pg.table(
  'invoice_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    lineNo: integer('line_no').notNull(),
    serviceCode: text('service_code'),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull().default('1'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull().default('0'),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('invoice_lines_uq').on(t.tenantId, t.invoiceId, t.lineNo)],
);

export const reportsPayments = pg.table(
  'payments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    eventId: uuid('event_id').notNull(),
    invoiceId: uuid('invoice_id'),
    patientId: uuid('patient_id'),
    facilityId: uuid('facility_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    mode: text('mode').notNull(),
    receivedAt: ts('received_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('payments_event_uq').on(t.tenantId, t.eventId),
    index('payments_time_idx').on(t.tenantId, t.receivedAt),
    index('payments_invoice_idx').on(t.tenantId, t.invoiceId),
  ],
);

export const reportsPharmacyDispenses = pg.table(
  'pharmacy_dispenses',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    eventId: uuid('event_id').notNull(),
    prescriptionId: uuid('prescription_id'),
    invoiceId: uuid('invoice_id'),
    dispensedAt: ts('dispensed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('pharmacy_dispenses_event_uq').on(t.tenantId, t.eventId),
    index('pharmacy_dispenses_time_idx').on(t.tenantId, t.dispensedAt),
  ],
);
