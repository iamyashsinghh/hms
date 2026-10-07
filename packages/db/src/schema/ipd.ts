/**
 * IPD & Nursing tables. Owned by the "ipd" workstream (Postgres schema: inpatient).
 * Kept in sync with migrations/*_ipd_*.sql (pnpm test checks it). Money is numeric(14,2) (string in Drizzle).
 */
import { boolean, date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, inpatient as pg, tenantIdColumn, timestamps } from './_common';
import { facilities, patients } from './core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const ipdWards = pg.table(
  'wards',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    wardType: text('ward_type').notNull().default('general'),
    floor: text('floor'),
    defaultDailyRate: money('default_daily_rate').notNull().default('0'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    uniqueIndex('ipd_wards_code_uq').on(t.tenantId, t.facilityId, t.code),
  ],
);

export const ipdBeds = pg.table(
  'beds',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    wardId: uuid('ward_id').notNull(),
    code: text('code').notNull(),
    roomNo: text('room_no'),
    dailyRate: money('daily_rate').notNull().default('0'),
    chargeServiceCode: text('charge_service_code'),
    status: text('status').notNull().default('available'),
    currentAdmissionId: uuid('current_admission_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.wardId], foreignColumns: [ipdWards.tenantId, ipdWards.id] }),
    uniqueIndex('ipd_beds_code_uq').on(t.tenantId, t.wardId, t.code),
    index('ipd_beds_facility_idx').on(t.tenantId, t.facilityId, t.status),
  ],
);

export const ipdAdmissions = pg.table(
  'admissions',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    ipdNo: text('ipd_no').notNull(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    patientGender: text('patient_gender'),
    patientDob: date('patient_dob', { mode: 'string' }),
    patientMobile: text('patient_mobile'),
    doctorId: uuid('doctor_id').notNull(),
    doctorName: text('doctor_name').notNull(),
    admissionType: text('admission_type').notNull().default('planned'),
    reason: text('reason').notNull(),
    provisionalDiagnosis: text('provisional_diagnosis'),
    isMlc: boolean('is_mlc').notNull().default(false),
    mlcNo: text('mlc_no'),
    attendantName: text('attendant_name'),
    attendantRelation: text('attendant_relation'),
    attendantMobile: text('attendant_mobile'),
    expectedDischargeDate: date('expected_discharge_date', { mode: 'string' }),
    status: text('status').notNull().default('admitted'),
    currentBedId: uuid('current_bed_id'),
    admittedAt: ts('admitted_at').notNull().defaultNow(),
    invoiceId: uuid('invoice_id'),
    billedAt: ts('billed_at'),
    dischargedAt: ts('discharged_at'),
    dischargeType: text('discharge_type'),
    dischargeNotes: text('discharge_notes'),
    cancelReason: text('cancel_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    uniqueIndex('ipd_admissions_no_uq').on(t.tenantId, t.ipdNo),
    index('ipd_admissions_status_idx').on(t.tenantId, t.facilityId, t.status, t.admittedAt),
  ],
);

export const ipdBedStays = pg.table(
  'bed_stays',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    bedId: uuid('bed_id').notNull(),
    wardId: uuid('ward_id').notNull(),
    dailyRate: money('daily_rate').notNull(),
    chargeServiceCode: text('charge_service_code'),
    bedLabel: text('bed_label').notNull(),
    fromAt: ts('from_at').notNull(),
    toAt: ts('to_at'),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
    foreignKey({ columns: [t.tenantId, t.bedId], foreignColumns: [ipdBeds.tenantId, ipdBeds.id] }),
    index('ipd_bed_stays_admission_idx').on(t.tenantId, t.admissionId, t.fromAt),
  ],
);

export const ipdVitals = pg.table(
  'vitals',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),
    pulse: integer('pulse'),
    respRate: integer('resp_rate'),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    spo2: integer('spo2'),
    painScore: integer('pain_score'),
    bloodSugar: numeric('blood_sugar', { precision: 5, scale: 1 }),
    notes: text('notes'),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
    index('ipd_vitals_admission_idx').on(t.tenantId, t.admissionId, t.recordedAt),
  ],
);

export const ipdNursingNotes = pg.table(
  'nursing_notes',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    shift: text('shift'),
    note: text('note').notNull(),
    recordedBy: uuid('recorded_by'),
    recordedByName: text('recorded_by_name'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdIntakeOutput = pg.table(
  'intake_output',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    direction: text('direction').notNull(),
    category: text('category').notNull(),
    volumeMl: integer('volume_ml').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
    notes: text('notes'),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdMedicationOrders = pg.table(
  'medication_orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    drugName: text('drug_name').notNull(),
    dose: text('dose').notNull(),
    route: text('route').notNull(),
    frequency: text('frequency').notNull(),
    instructions: text('instructions'),
    isPrn: boolean('is_prn').notNull().default(false),
    startAt: ts('start_at').notNull().defaultNow(),
    status: text('status').notNull().default('active'),
    stoppedAt: ts('stopped_at'),
    stopReason: text('stop_reason'),
    orderedBy: uuid('ordered_by'),
    orderedByName: text('ordered_by_name'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdMedicationAdministrations = pg.table(
  'medication_administrations',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    admissionId: uuid('admission_id').notNull(),
    status: text('status').notNull(),
    givenAt: ts('given_at').notNull().defaultNow(),
    notes: text('notes'),
    givenBy: uuid('given_by'),
    givenByName: text('given_by_name'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [ipdMedicationOrders.tenantId, ipdMedicationOrders.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdRounds = pg.table(
  'rounds',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    doctorId: uuid('doctor_id'),
    doctorName: text('doctor_name').notNull(),
    roundAt: ts('round_at').notNull().defaultNow(),
    subjective: text('subjective'),
    findings: text('findings'),
    plan: text('plan').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdCharges = pg.table(
  'charges',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    chargeDate: date('charge_date', { mode: 'string' }).notNull(),
    serviceCode: text('service_code'),
    description: text('description').notNull(),
    qty: numeric('qty', { precision: 12, scale: 3 }).notNull(),
    unitPrice: money('unit_price').notNull(),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    discount: money('discount').notNull().default('0'),
    status: text('status').notNull().default('active'),
    cancelReason: text('cancel_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdAdvances = pg.table(
  'advances',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    paymentId: uuid('payment_id').notNull(),
    receiptNo: text('receipt_no').notNull(),
    mode: text('mode').notNull(),
    amount: money('amount').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    receivedBy: uuid('received_by'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
  ],
);

export const ipdDischargeSummaries = pg.table(
  'discharge_summaries',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    admissionId: uuid('admission_id').notNull(),
    finalDiagnosis: text('final_diagnosis').notNull(),
    presentingComplaints: text('presenting_complaints'),
    history: text('history'),
    examination: text('examination'),
    investigations: text('investigations'),
    procedures: text('procedures'),
    hospitalCourse: text('hospital_course'),
    conditionAtDischarge: text('condition_at_discharge'),
    medications: jsonb('medications').$type<{ drugName: string; dose?: string; frequency?: string; days?: number; instructions?: string }[]>().notNull().default([]),
    advice: text('advice'),
    followUpDate: date('follow_up_date', { mode: 'string' }),
    followUpNotes: text('follow_up_notes'),
    status: text('status').notNull().default('draft'),
    finalizedBy: uuid('finalized_by'),
    finalizedByName: text('finalized_by_name'),
    finalizedAt: ts('finalized_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.admissionId], foreignColumns: [ipdAdmissions.tenantId, ipdAdmissions.id] }),
    uniqueIndex('ipd_discharge_summaries_admission_uq').on(t.tenantId, t.admissionId),
  ],
);
