/**
 * Hospital Setup tables. Owned by the "setup" workstream (Postgres schema: setup).
 * setup.facilities and setup.counters are foundation tables (core.ts); setup owns later changes to them.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { actorColumns, idColumn, setup as pg, tenantIdColumn, timestamps } from './_common';
import { facilities, users } from './core';

/** One row per hospital: legal details, GSTIN and letterhead. */
export const setupHospitalProfiles = pg.table(
  'hospital_profiles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    legalName: text('legal_name').notNull(),
    displayName: text('display_name').notNull(),
    gstin: text('gstin'),
    pan: text('pan'),
    registrationNo: text('registration_no'),
    accreditation: text('accreditation'),
    phone: text('phone'),
    email: text('email'),
    website: text('website'),
    address: jsonb('address').$type<Record<string, string>>(),
    logoUrl: text('logo_url'),
    letterhead: jsonb('letterhead').$type<Record<string, string>>(),
    timezone: text('timezone').notNull().default('Asia/Kolkata'),
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true, mode: 'string' }),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('hospital_profiles_tenant_uq').on(t.tenantId)],
);

export const setupDepartments = pg.table(
  'departments',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('clinical'),
    facilityId: uuid('facility_id'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('departments_code_uq').on(t.tenantId, t.code),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
  ],
);

export const setupSpecializations = pg.table(
  'specializations',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('specializations_code_uq').on(t.tenantId, t.code)],
);

/** HR-ish details for a staff user (iam.users). Doctors keep their fees and council registration here. */
export const setupStaffProfiles = pg.table(
  'staff_profiles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    staffType: text('staff_type').notNull(),
    employeeCode: text('employee_code'),
    designation: text('designation'),
    departmentId: uuid('department_id'),
    specializationId: uuid('specialization_id'),
    qualification: text('qualification'),
    registrationNo: text('registration_no'),
    registrationCouncil: text('registration_council'),
    gender: text('gender'),
    dateOfJoining: date('date_of_joining', { mode: 'string' }),
    consultationFee: numeric('consultation_fee', { precision: 14, scale: 2 }),
    followUpFee: numeric('follow_up_fee', { precision: 14, scale: 2 }),
    followUpDays: integer('follow_up_days'),
    signatureUrl: text('signature_url'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('staff_profiles_user_uq').on(t.tenantId, t.userId),
    uniqueIndex('staff_profiles_employee_code_uq').on(t.tenantId, t.employeeCode),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.departmentId], foreignColumns: [setupDepartments.tenantId, setupDepartments.id] }),
    foreignKey({ columns: [t.tenantId, t.specializationId], foreignColumns: [setupSpecializations.tenantId, setupSpecializations.id] }),
  ],
);

/** Weekly OPD timings: one row per doctor, facility, weekday and time block. */
export const setupDoctorSchedules = pg.table(
  'doctor_schedules',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    facilityId: uuid('facility_id').notNull(),
    weekday: smallint('weekday').notNull(),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    slotMinutes: integer('slot_minutes').notNull().default(15),
    maxPatients: integer('max_patients'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('doctor_schedules_user_idx').on(t.tenantId, t.userId, t.weekday),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
  ],
);

export const setupDoctorLeaves = pg.table(
  'doctor_leaves',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    fromDate: date('from_date', { mode: 'string' }).notNull(),
    toDate: date('to_date', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    index('doctor_leaves_user_idx').on(t.tenantId, t.userId, t.fromDate),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
  ],
);

/** Display settings for a counter in setup.counters (prefix and padding). */
export const setupNumberSeries = pg.table(
  'number_series',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    key: text('key').notNull(),
    prefix: text('prefix').notNull().default(''),
    width: integer('width').notNull().default(6),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('number_series_key_uq').on(t.tenantId, t.key)],
);

export const setupPrintTemplates = pg.table(
  'print_templates',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    key: text('key').notNull(),
    facilityId: uuid('facility_id'),
    paperSize: text('paper_size').notNull().default('A4'),
    showLogo: boolean('show_logo').notNull().default(true),
    showLetterhead: boolean('show_letterhead').notNull().default(true),
    headerText: text('header_text'),
    footerText: text('footer_text'),
    marginTopMm: integer('margin_top_mm').notNull().default(10),
    marginBottomMm: integer('margin_bottom_mm').notNull().default(10),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('print_templates_key_uq').on(t.tenantId, t.key, sql`coalesce(${t.facilityId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    foreignKey({ columns: [t.tenantId, t.facilityId], foreignColumns: [facilities.tenantId, facilities.id] }),
  ],
);
