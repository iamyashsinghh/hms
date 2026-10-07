/**
 * Laboratory tables. Owned by the "lab" workstream (Postgres schema: lab).
 * SQL: migrations/*_lab_*.sql. Verified results are locked by a trigger (hint `lab_result_locked`).
 */
import { sql } from 'drizzle-orm';
import { boolean, date, foreignKey, index, integer, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, lab as pg, tenantIdColumn, timestamps } from './_common';
import { patients } from './core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

export const labTests = pg.table(
  'tests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    section: text('section').notNull().default('other'),
    sampleType: text('sample_type').notNull().default('blood'),
    container: text('container'),
    unit: text('unit'),
    method: text('method'),
    resultType: text('result_type').notNull().default('numeric'),
    options: textArray('options'),
    decimals: integer('decimals').notNull().default(1),
    price: numeric('price', { precision: 14, scale: 2 }).notNull().default('0'),
    serviceCode: text('service_code'),
    tatHours: integer('tat_hours').notNull().default(24),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('lab_tests_code_uq').on(t.tenantId, t.code)],
);

export const labTestRanges = pg.table(
  'test_ranges',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    testId: uuid('test_id').notNull(),
    sort: integer('sort').notNull().default(0),
    gender: text('gender').notNull().default('any'),
    ageMinYears: numeric('age_min_years', { precision: 6, scale: 2 }).notNull().default('0'),
    ageMaxYears: numeric('age_max_years', { precision: 6, scale: 2 }).notNull().default('150'),
    low: numeric('low'),
    high: numeric('high'),
    criticalLow: numeric('critical_low'),
    criticalHigh: numeric('critical_high'),
    text: text('text'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.testId], foreignColumns: [labTests.tenantId, labTests.id] }).onDelete('cascade'),
    index('lab_test_ranges_test_idx').on(t.tenantId, t.testId),
  ],
);

export const labPanels = pg.table(
  'panels',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    price: numeric('price', { precision: 14, scale: 2 }).notNull().default('0'),
    serviceCode: text('service_code'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('lab_panels_code_uq').on(t.tenantId, t.code)],
);

export const labPanelTests = pg.table(
  'panel_tests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    panelId: uuid('panel_id').notNull(),
    testId: uuid('test_id').notNull(),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.panelId], foreignColumns: [labPanels.tenantId, labPanels.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.testId], foreignColumns: [labTests.tenantId, labTests.id] }),
    uniqueIndex('lab_panel_tests_uq').on(t.tenantId, t.panelId, t.testId),
  ],
);

export const labOrders = pg.table(
  'orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderNo: text('order_no').notNull(),
    facilityId: uuid('facility_id').notNull(),
    orderDate: date('order_date', { mode: 'string' }).notNull().default(sql`(now() AT TIME ZONE 'Asia/Kolkata')::date`),
    source: text('source').notNull().default('walkin'),
    priority: text('priority').notNull().default('routine'),
    status: text('status').notNull().default('ordered'),
    patientId: uuid('patient_id').notNull(),
    patientUhid: text('patient_uhid').notNull(),
    patientName: text('patient_name').notNull(),
    patientGender: text('patient_gender').notNull(),
    patientDob: date('patient_dob', { mode: 'string' }),
    patientMobile: text('patient_mobile'),
    doctorId: uuid('doctor_id'),
    doctorName: text('doctor_name'),
    referredBy: text('referred_by'),
    encounterId: uuid('encounter_id'),
    clinicalNotes: text('clinical_notes'),
    invoiceId: uuid('invoice_id'),
    invoiceNo: text('invoice_no'),
    hasCritical: boolean('has_critical').notNull().default(false),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    cancelledAt: ts('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    uniqueIndex('lab_orders_no_uq').on(t.tenantId, t.orderNo),
    index('lab_orders_day_idx').on(t.tenantId, t.orderDate, t.status),
    index('lab_orders_patient_idx').on(t.tenantId, t.patientId, t.orderDate),
  ],
);

export const labOrderItems = pg.table(
  'order_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    sort: integer('sort').notNull().default(0),
    kind: text('kind').notNull(),
    testId: uuid('test_id'),
    panelId: uuid('panel_id'),
    code: text('code'),
    name: text('name').notNull(),
    price: numeric('price', { precision: 14, scale: 2 }).notNull().default('0'),
    serviceCode: text('service_code'),
    emrOrderId: uuid('emr_order_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [labOrders.tenantId, labOrders.id] }),
    foreignKey({ columns: [t.tenantId, t.testId], foreignColumns: [labTests.tenantId, labTests.id] }),
    foreignKey({ columns: [t.tenantId, t.panelId], foreignColumns: [labPanels.tenantId, labPanels.id] }),
    index('lab_order_items_order_idx').on(t.tenantId, t.orderId),
  ],
);

export const labSamples = pg.table(
  'samples',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    barcode: text('barcode').notNull(),
    sampleType: text('sample_type').notNull(),
    container: text('container'),
    status: text('status').notNull().default('pending'),
    collectedAt: ts('collected_at'),
    collectedBy: uuid('collected_by'),
    receivedAt: ts('received_at'),
    receivedBy: uuid('received_by'),
    rejectedReason: text('rejected_reason'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [labOrders.tenantId, labOrders.id] }),
    uniqueIndex('lab_samples_barcode_uq').on(t.tenantId, t.barcode),
    index('lab_samples_order_idx').on(t.tenantId, t.orderId),
    index('lab_samples_status_idx').on(t.tenantId, t.status),
  ],
);

export const labResults = pg.table(
  'results',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    itemId: uuid('item_id').notNull(),
    testId: uuid('test_id').notNull(),
    sampleId: uuid('sample_id'),
    sort: integer('sort').notNull().default(0),
    code: text('code').notNull(),
    name: text('name').notNull(),
    section: text('section').notNull(),
    unit: text('unit'),
    method: text('method'),
    resultType: text('result_type').notNull(),
    options: textArray('options'),
    decimals: integer('decimals').notNull().default(1),
    panelName: text('panel_name'),
    refLow: numeric('ref_low'),
    refHigh: numeric('ref_high'),
    criticalLow: numeric('critical_low'),
    criticalHigh: numeric('critical_high'),
    refText: text('ref_text'),
    value: text('value'),
    valueNum: numeric('value_num'),
    flag: text('flag'),
    remarks: text('remarks'),
    status: text('status').notNull().default('pending'),
    enteredAt: ts('entered_at'),
    enteredBy: uuid('entered_by'),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    amendCount: integer('amend_count').notNull().default(0),
    lastAmendReason: text('last_amend_reason'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [labOrders.tenantId, labOrders.id] }),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [labOrderItems.tenantId, labOrderItems.id] }),
    foreignKey({ columns: [t.tenantId, t.testId], foreignColumns: [labTests.tenantId, labTests.id] }),
    foreignKey({ columns: [t.tenantId, t.sampleId], foreignColumns: [labSamples.tenantId, labSamples.id] }),
    index('lab_results_order_idx').on(t.tenantId, t.orderId),
  ],
);
