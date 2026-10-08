/**
 * OPD / EMR tables. Owned by the "emr" workstream (Postgres schema: clinical).
 * SQL: migrations/*_emr_*.sql. Signed encounters and their children are locked by triggers.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, clinical as pg, idColumn, tenantIdColumn, timestamps } from './_common';
import { patients } from './core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const emrEncounters = pg.table(
  'encounters',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterNo: text('encounter_no').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    visitId: uuid('visit_id'),
    appointmentId: uuid('appointment_id'),
    tokenNo: integer('token_no'),
    encounterDate: date('encounter_date', { mode: 'string' }).notNull().default(sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`),
    status: text('status').notNull().default('waiting'),
    patientUhid: text('patient_uhid').notNull(),
    patientName: text('patient_name').notNull(),
    patientGender: text('patient_gender').notNull(),
    patientDob: date('patient_dob', { mode: 'string' }),
    patientMobile: text('patient_mobile'),
    patientAllergies: text('patient_allergies').array().notNull().default(sql`'{}'::text[]`),
    notes: jsonb('notes').$type<Record<string, string | undefined>>().notNull().default({}),
    followUpDate: date('follow_up_date', { mode: 'string' }),
    followUpNotes: text('follow_up_notes'),
    startedAt: ts('started_at'),
    signedAt: ts('signed_at'),
    signedBy: uuid('signed_by'),
    cancelledAt: ts('cancelled_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    uniqueIndex('encounters_no_uq').on(t.tenantId, t.encounterNo),
    index('encounters_doctor_day_idx').on(t.tenantId, t.doctorId, t.encounterDate),
    index('encounters_patient_idx').on(t.tenantId, t.patientId, t.encounterDate),
  ],
);

export const emrVitals = pg.table(
  'encounter_vitals',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterId: uuid('encounter_id').notNull(),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
    pulse: integer('pulse'),
    respRate: integer('resp_rate'),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    spo2: integer('spo2'),
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    bmi: numeric('bmi', { precision: 4, scale: 1 }),
    bloodSugar: integer('blood_sugar'),
    painScore: integer('pain_score'),
    notes: text('notes'),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    recordedBy: uuid('recorded_by'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.encounterId], foreignColumns: [emrEncounters.tenantId, emrEncounters.id] }),
  ],
);

export const emrDiagnoses = pg.table(
  'encounter_diagnoses',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterId: uuid('encounter_id').notNull(),
    sort: integer('sort').notNull().default(0),
    icd10Code: text('icd10_code'),
    description: text('description').notNull(),
    kind: text('kind').notNull().default('provisional'),
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.encounterId], foreignColumns: [emrEncounters.tenantId, emrEncounters.id] }),
  ],
);

export const emrPrescriptions = pg.table(
  'prescriptions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    rxNo: text('rx_no').notNull(),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    doctorId: uuid('doctor_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.encounterId], foreignColumns: [emrEncounters.tenantId, emrEncounters.id] }),
    uniqueIndex('prescriptions_encounter_uq').on(t.tenantId, t.encounterId),
  ],
);

export const emrPrescriptionLines = pg.table(
  'prescription_lines',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    prescriptionId: uuid('prescription_id').notNull(),
    sort: integer('sort').notNull().default(0),
    drugName: text('drug_name').notNull(),
    itemCode: text('item_code'),
    genericName: text('generic_name'),
    form: text('form'),
    strength: text('strength'),
    dose: text('dose').notNull(),
    route: text('route').notNull().default('oral'),
    frequency: text('frequency').notNull(),
    timing: text('timing'),
    days: integer('days'),
    qty: numeric('qty', { precision: 10, scale: 2 }),
    instructions: text('instructions'),
    allergyOverrideReason: text('allergy_override_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.prescriptionId], foreignColumns: [emrPrescriptions.tenantId, emrPrescriptions.id] }).onDelete('cascade'),
  ],
);

export const emrOrders = pg.table(
  'encounter_orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterId: uuid('encounter_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    sort: integer('sort').notNull().default(0),
    kind: text('kind').notNull(),
    code: text('code'),
    name: text('name').notNull(),
    /** Procedures: billing service code, posted as a charge when the consultation is signed. */
    serviceCode: text('service_code'),
    priority: text('priority').notNull().default('routine'),
    notes: text('notes'),
    status: text('status').notNull().default('ordered'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.encounterId], foreignColumns: [emrEncounters.tenantId, emrEncounters.id] }),
  ],
);

export const emrAddenda = pg.table(
  'encounter_addenda',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    encounterId: uuid('encounter_id').notNull(),
    text: text('text').notNull(),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.encounterId], foreignColumns: [emrEncounters.tenantId, emrEncounters.id] }),
  ],
);

export const emrFavourites = pg.table(
  'rx_favourites',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    doctorId: uuid('doctor_id').notNull(),
    name: text('name').notNull(),
    lines: jsonb('lines').$type<Record<string, unknown>[]>().notNull(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const emrCertificates = pg.table(
  'medical_certificates',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    certificateNo: text('certificate_no').notNull(),
    kind: text('kind').notNull(),
    patientId: uuid('patient_id').notNull(),
    encounterId: uuid('encounter_id'),
    doctorId: uuid('doctor_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    patientName: text('patient_name').notNull(),
    patientGender: text('patient_gender').notNull(),
    patientDob: date('patient_dob', { mode: 'string' }),
    fromDate: date('from_date', { mode: 'string' }),
    toDate: date('to_date', { mode: 'string' }),
    diagnosis: text('diagnosis'),
    remarks: text('remarks'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
