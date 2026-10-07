/**
 * Facility Services tables. Owned by the "ops" workstream (Postgres schema: ops).
 * Kept in sync with migrations/*_ops_*.sql (pnpm test checks it).
 */
import { type AnyPgColumn, boolean, date, foreignKey, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, ops as pg, tenantIdColumn, timestamps } from './_common';
import { facilities, patients } from './core';

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });
const facilityFk = (t: { tenantId: AnyPgColumn; facilityId: AnyPgColumn }) =>
  foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] });

export const opsAssets = pg.table(
  'assets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull().default('general'),
    criticality: text('criticality').notNull().default('medium'),
    status: text('status').notNull().default('in_service'),
    make: text('make'),
    model: text('model'),
    serialNo: text('serial_no'),
    location: text('location'),
    departmentId: uuid('department_id'),
    purchaseDate: date('purchase_date', { mode: 'string' }),
    purchaseCost: money('purchase_cost'),
    vendor: text('vendor'),
    warrantyUntil: date('warranty_until', { mode: 'string' }),
    amcVendor: text('amc_vendor'),
    amcUntil: date('amc_until', { mode: 'string' }),
    pmIntervalDays: integer('pm_interval_days'),
    nextPmDue: date('next_pm_due', { mode: 'string' }),
    calibrationDue: date('calibration_due', { mode: 'string' }),
    notes: text('notes'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    facilityFk(t),
    uniqueIndex('ops_assets_code_uq').on(t.tenantId, t.code),
    index('ops_assets_facility_idx').on(t.tenantId, t.facilityId, t.status),
  ],
);

export const opsWorkOrders = pg.table(
  'work_orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    assetId: uuid('asset_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    type: text('type').notNull().default('breakdown'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    problem: text('problem').notNull(),
    assignedTo: text('assigned_to'),
    resolution: text('resolution'),
    cost: money('cost'),
    reportedBy: uuid('reported_by'),
    reportedAt: ts('reported_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.assetId], foreignColumns: [opsAssets.tenantId, opsAssets.id] }),
    facilityFk(t),
    uniqueIndex('ops_work_orders_number_uq').on(t.tenantId, t.number),
    index('ops_work_orders_asset_idx').on(t.tenantId, t.assetId, t.reportedAt),
  ],
);

export const opsCssdSets = pg.table(
  'cssd_sets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    department: text('department'),
    contents: jsonb('contents').$type<string[]>().notNull().default([]),
    shelfLifeDays: integer('shelf_life_days').notNull().default(30),
    status: text('status').notNull().default('dirty'),
    sterileUntil: ts('sterile_until'),
    lastCycleId: uuid('last_cycle_id'),
    issuedTo: text('issued_to'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), facilityFk(t), uniqueIndex('ops_cssd_sets_code_uq').on(t.tenantId, t.code)],
);

export const opsCssdCycles = pg.table(
  'cssd_cycles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    sterilizer: text('sterilizer').notNull(),
    method: text('method').notNull().default('steam'),
    status: text('status').notNull().default('running'),
    temperatureC: numeric('temperature_c', { precision: 5, scale: 1 }),
    pressure: text('pressure'),
    chemicalIndicatorPassed: boolean('chemical_indicator_passed'),
    biologicalIndicatorPassed: boolean('biological_indicator_passed'),
    notes: text('notes'),
    startedBy: uuid('started_by'),
    completedBy: uuid('completed_by'),
    startedAt: ts('started_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), facilityFk(t), uniqueIndex('ops_cssd_cycles_number_uq').on(t.tenantId, t.number)],
);

export const opsCssdCycleSets = pg.table(
  'cssd_cycle_sets',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    cycleId: uuid('cycle_id').notNull(),
    setId: uuid('set_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.cycleId], foreignColumns: [opsCssdCycles.tenantId, opsCssdCycles.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.setId], foreignColumns: [opsCssdSets.tenantId, opsCssdSets.id] }),
    uniqueIndex('ops_cssd_cycle_sets_uq').on(t.tenantId, t.cycleId, t.setId),
  ],
);

export const opsCssdIssues = pg.table(
  'cssd_issues',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    setId: uuid('set_id').notNull(),
    cycleId: uuid('cycle_id'),
    issuedTo: text('issued_to').notNull(),
    patientId: uuid('patient_id'),
    issuedBy: uuid('issued_by'),
    issuedAt: ts('issued_at').notNull().defaultNow(),
    returnedAt: ts('returned_at'),
    receivedBy: uuid('received_by'),
    notes: text('notes'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.setId], foreignColumns: [opsCssdSets.tenantId, opsCssdSets.id] }),
    foreignKey({ columns: [t.tenantId, t.cycleId], foreignColumns: [opsCssdCycles.tenantId, opsCssdCycles.id] }),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
  ],
);

export const opsLinenItems = pg.table(
  'linen_items',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    parLevel: integer('par_level').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const opsLinenTxns = pg.table(
  'linen_txns',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    itemId: uuid('item_id').notNull(),
    kind: text('kind').notNull(),
    qty: integer('qty').notNull(),
    location: text('location'),
    fromPool: text('from_pool'),
    reference: text('reference'),
    notes: text('notes'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    facilityFk(t),
    foreignKey({ columns: [t.tenantId, t.itemId], foreignColumns: [opsLinenItems.tenantId, opsLinenItems.id] }),
  ],
);

export const opsVehicles = pg.table(
  'vehicles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    registrationNo: text('registration_no').notNull(),
    type: text('type').notNull().default('bls'),
    status: text('status').notNull().default('available'),
    driverName: text('driver_name'),
    driverMobile: text('driver_mobile'),
    ratePerKm: money('rate_per_km').notNull().default('0'),
    baseCharge: money('base_charge').notNull().default('0'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), facilityFk(t), uniqueIndex('ops_vehicles_reg_uq').on(t.tenantId, t.registrationNo)],
);

export const opsTrips = pg.table(
  'trips',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    kind: text('kind').notNull().default('emergency_pickup'),
    status: text('status').notNull().default('requested'),
    patientId: uuid('patient_id'),
    contactName: text('contact_name').notNull(),
    contactMobile: text('contact_mobile').notNull(),
    pickupAddress: text('pickup_address').notNull(),
    dropAddress: text('drop_address'),
    notes: text('notes'),
    vehicleId: uuid('vehicle_id'),
    odometerStart: integer('odometer_start'),
    odometerEnd: integer('odometer_end'),
    distanceKm: numeric('distance_km', { precision: 8, scale: 1 }),
    charge: money('charge'),
    invoiceId: uuid('invoice_id'),
    cancelReason: text('cancel_reason'),
    requestedBy: uuid('requested_by'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    dispatchedAt: ts('dispatched_at'),
    onboardAt: ts('onboard_at'),
    completedAt: ts('completed_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    facilityFk(t),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
    foreignKey({ columns: [t.tenantId, t.vehicleId], foreignColumns: [opsVehicles.tenantId, opsVehicles.id] }),
    uniqueIndex('ops_trips_number_uq').on(t.tenantId, t.number),
  ],
);

export const opsDietOrders = pg.table(
  'diet_orders',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    facilityId: uuid('facility_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    location: text('location').notNull(),
    dietType: text('diet_type').notNull(),
    vegetarian: boolean('vegetarian').notNull().default(true),
    instructions: text('instructions'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    status: text('status').notNull().default('active'),
    orderedBy: uuid('ordered_by'),
    stoppedBy: uuid('stopped_by'),
    stoppedAt: ts('stopped_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    facilityFk(t),
    foreignKey({ columns: [t.tenantId, t.patientId], foreignColumns: [patients.tenantId, patients.id] }),
  ],
);

export const opsDietMeals = pg.table(
  'diet_meals',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    orderId: uuid('order_id').notNull(),
    mealDate: date('meal_date', { mode: 'string' }).notNull(),
    meal: text('meal').notNull(),
    status: text('status').notNull(),
    notes: text('notes'),
    updatedBy: uuid('updated_by'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.orderId], foreignColumns: [opsDietOrders.tenantId, opsDietOrders.id] }),
    uniqueIndex('ops_diet_meals_uq').on(t.tenantId, t.orderId, t.mealDate, t.meal),
  ],
);

export const opsHkTasks = pg.table(
  'hk_tasks',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    number: text('number').notNull(),
    facilityId: uuid('facility_id').notNull(),
    location: text('location').notNull(),
    kind: text('kind').notNull().default('routine'),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('pending'),
    description: text('description'),
    assignedTo: text('assigned_to'),
    remarks: text('remarks'),
    requestedBy: uuid('requested_by'),
    dueAt: ts('due_at'),
    startedAt: ts('started_at'),
    doneAt: ts('done_at'),
    verifiedAt: ts('verified_at'),
    verifiedBy: uuid('verified_by'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), facilityFk(t), uniqueIndex('ops_hk_tasks_number_uq').on(t.tenantId, t.number)],
);
