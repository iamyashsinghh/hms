/**
 * Radiology tables. Owned by the "radiology" workstream (Postgres schema: radiology).
 * SQL: migrations/20261007080000_radiology_init.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, radiology as pg, tenantIdColumn, timestamps } from './_common';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const radiologyModalities = pg.table(
  'modalities',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    facilityId: uuid('facility_id'),
    room: text('room'),
    aeTitle: text('ae_title'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('modalities_code_uq').on(t.tenantId, t.code)],
);

export const radiologyTemplates = pg.table(
  'templates',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    modalityId: uuid('modality_id'),
    technique: text('technique'),
    findings: text('findings'),
    impression: text('impression'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const radiologyTests = pg.table(
  'tests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    modalityId: uuid('modality_id').notNull(),
    bodyPart: text('body_part'),
    serviceCode: text('service_code'),
    price: numeric('price', { precision: 14, scale: 2 }),
    taxRate: numeric('tax_rate', { precision: 5, scale: 2 }).notNull().default('0'),
    durationMinutes: integer('duration_minutes').notNull().default(15),
    contrast: boolean('contrast').notNull().default(false),
    preparation: text('preparation'),
    defaultTemplateId: uuid('default_template_id'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('tests_code_uq').on(t.tenantId, t.code)],
);

export const radiologyOrders = pg.table(
  'orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderNo: text('order_no').notNull(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    patientName: text('patient_name').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    patientGender: text('patient_gender').notNull(),
    patientDob: date('patient_dob', { mode: 'string' }),
    patientMobile: text('patient_mobile'),
    testId: uuid('test_id'),
    testCode: text('test_code'),
    studyName: text('study_name').notNull(),
    modalityId: uuid('modality_id'),
    priority: text('priority').notNull().default('routine'),
    status: text('status').notNull().default('ordered'),
    source: text('source').notNull().default('desk'),
    encounterId: uuid('encounter_id'),
    emrOrderId: uuid('emr_order_id'),
    referringDoctorId: uuid('referring_doctor_id'),
    referringDoctorName: text('referring_doctor_name'),
    clinicalNotes: text('clinical_notes'),
    scheduledAt: tz('scheduled_at'),
    scheduledEnd: tz('scheduled_end'),
    startedAt: tz('started_at'),
    acquiredAt: tz('acquired_at'),
    performedBy: uuid('performed_by'),
    studyUid: text('study_uid'),
    imagesUrl: text('images_url'),
    techNotes: text('tech_notes'),
    invoiceId: uuid('invoice_id'),
    invoiceNo: text('invoice_no'),
    cancelReason: text('cancel_reason'),
    cancelledAt: tz('cancelled_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('orders_no_uq').on(t.tenantId, t.orderNo),
    uniqueIndex('orders_emr_order_uq').on(t.tenantId, t.emrOrderId).where(sql`emr_order_id IS NOT NULL`),
    index('orders_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('orders_patient_idx').on(t.tenantId, t.patientId, t.createdAt),
    index('orders_schedule_idx').on(t.tenantId, t.modalityId, t.scheduledAt),
  ],
);

export const radiologyReports = pg.table(
  'reports',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull().default('draft'),
    templateId: uuid('template_id'),
    technique: text('technique'),
    findings: text('findings').notNull(),
    impression: text('impression').notNull(),
    isCritical: boolean('is_critical').notNull().default(false),
    amendmentReason: text('amendment_reason'),
    authorId: uuid('author_id'),
    finalizedAt: tz('finalized_at'),
    finalizedBy: uuid('finalized_by'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('reports_version_uq').on(t.tenantId, t.orderId, t.version)],
);
