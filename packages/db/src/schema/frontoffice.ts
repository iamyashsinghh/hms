/**
 * Front Office tables. Owned by the "frontoffice" workstream (Postgres schema: clinical).
 * SQL: migrations/20261007070000_frontoffice_init.sql.
 */
import { boolean, date, index, integer, jsonb, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, clinical, idColumn, tenantIdColumn, timestamps } from './_common';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const frontofficeAppointments = clinical.table(
  'appointments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    appointmentNo: text('appointment_no').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    slotStart: tz('slot_start').notNull(),
    slotEnd: tz('slot_end').notNull(),
    type: text('type').notNull().default('new'),
    source: text('source').notNull().default('desk'),
    status: text('status').notNull().default('booked'),
    reason: text('reason'),
    cancelReason: text('cancel_reason'),
    rescheduleCount: integer('reschedule_count').notNull().default(0),
    visitId: uuid('visit_id'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('appointments_no_uq').on(t.tenantId, t.appointmentNo),
    index('appointments_doctor_day_idx').on(t.tenantId, t.doctorId, t.slotStart),
    index('appointments_facility_day_idx').on(t.tenantId, t.facilityId, t.slotStart),
  ],
);

export const frontofficeAppointmentHistory = clinical.table(
  'appointment_status_history',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    appointmentId: uuid('appointment_id').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    event: text('event').notNull(),
    note: text('note'),
    data: jsonb('data').$type<Record<string, unknown>>(),
    actorId: uuid('actor_id'),
    at: tz('at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('appointment_status_history_appt_idx').on(t.tenantId, t.appointmentId, t.at)],
);

export const frontofficeVisits = clinical.table(
  'opd_visits',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    visitNo: text('visit_no').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    appointmentId: uuid('appointment_id'),
    visitDate: date('visit_date', { mode: 'string' }).notNull(),
    tokenNo: integer('token_no').notNull(),
    kind: text('kind').notNull(),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('waiting'),
    room: text('room'),
    notes: text('notes'),
    checkedInAt: tz('checked_in_at').notNull().defaultNow(),
    calledAt: tz('called_at'),
    startedAt: tz('started_at'),
    completedAt: tz('completed_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('opd_visits_no_uq').on(t.tenantId, t.visitNo),
    uniqueIndex('opd_visits_token_uq').on(t.tenantId, t.facilityId, t.doctorId, t.visitDate, t.tokenNo),
    index('opd_visits_queue_idx').on(t.tenantId, t.facilityId, t.visitDate, t.doctorId, t.status),
  ],
);

export const frontofficePatientMerges = clinical.table(
  'patient_merges',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    sourcePatientId: uuid('source_patient_id').notNull(),
    targetPatientId: uuid('target_patient_id').notNull(),
    reason: text('reason').notNull(),
    movedAppointments: integer('moved_appointments').notNull().default(0),
    movedVisits: integer('moved_visits').notNull().default(0),
    sourceSnapshot: jsonb('source_snapshot').$type<Record<string, unknown>>().notNull(),
    mergedBy: uuid('merged_by'),
    mergedAt: tz('merged_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('patient_merges_source_uq').on(t.tenantId, t.sourcePatientId)],
);

export const frontofficePatientAbha = clinical.table(
  'patient_abha',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    abhaNumber: text('abha_number').notNull(),
    abhaAddress: text('abha_address'),
    verified: boolean('verified').notNull().default(false),
    capturedBy: uuid('captured_by'),
    capturedAt: tz('captured_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('patient_abha_patient_idx').on(t.tenantId, t.patientId)],
);
