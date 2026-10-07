/** Foundation tables: tenants, identity, facilities, counters, patients and audit. */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  actorColumns,
  audit,
  clinical,
  iam,
  idColumn,
  platform,
  setup,
  tenantIdColumn,
  timestamps,
} from './_common';

// ---------- platform (no RLS) ----------

export const tenants = platform.table(
  'tenants',
  {
    id: uuid('id').primaryKey().default(sql`app.uuid_v7()`),
    /** Hospital code and subdomain, lowercase. */
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    plan: text('plan').notNull().default('starter'),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps(),
  },
  (t) => [uniqueIndex('tenants_code_uq').on(t.code)],
);

// ---------- iam ----------

export const permissions = iam.table('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description').notNull(),
});

export const users = iam.table(
  'users',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    email: text('email'),
    mobile: text('mobile'),
    passwordHash: text('password_hash'),
    status: text('status').notNull().default('active'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'string' }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'string' }),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('users_email_uq').on(t.tenantId, sql`lower(${t.email})`),
    uniqueIndex('users_mobile_uq').on(t.tenantId, t.mobile),
  ],
);

export const roles = iam.table(
  'roles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('roles_key_uq').on(t.tenantId, t.key)],
);

export const rolePermissions = iam.table(
  'role_permissions',
  {
    tenantId: tenantIdColumn(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.roleId, t.permissionKey] }),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id] }).onDelete('cascade'),
  ],
);

export const userRoles = iam.table(
  'user_roles',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
    /** NULL = role applies in every facility of the hospital. */
    facilityId: uuid('facility_id'),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    foreignKey({ columns: [t.tenantId, t.roleId], foreignColumns: [roles.tenantId, roles.id] }).onDelete('cascade'),
    index('user_roles_user_idx').on(t.tenantId, t.userId),
  ],
);

export const refreshTokens = iam.table(
  'refresh_tokens',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id').notNull(),
    /** All rotations of one login share a session id; reuse of an old token revokes the session. */
    sessionId: uuid('session_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    client: text('client').notNull(),
    deviceName: text('device_name'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    replacedBy: uuid('replaced_by'),
    createdIp: text('created_ip'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    foreignKey({ columns: [t.tenantId, t.userId], foreignColumns: [users.tenantId, users.id] }).onDelete('cascade'),
    index('refresh_tokens_session_idx').on(t.tenantId, t.sessionId),
  ],
);

// ---------- setup ----------

export const facilities = setup.table(
  'facilities',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull().default('hospital'),
    phone: text('phone'),
    gstin: text('gstin'),
    address: jsonb('address').$type<Record<string, string>>(),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('facilities_code_uq').on(t.tenantId, t.code)],
);

/** Number series (UHID, invoice no, receipt no...). Use nextNumber() from @hms/db. */
export const counters = setup.table(
  'counters',
  {
    tenantId: tenantIdColumn(),
    key: text('key').notNull(),
    nextValue: bigint('next_value', { mode: 'number' }).notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] })],
);

// ---------- clinical: patient master ----------

export const patients = clinical.table(
  'patients',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    uhid: text('uhid').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    gender: text('gender').notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    mobile: text('mobile'),
    email: text('email'),
    bloodGroup: text('blood_group'),
    abhaNumber: text('abha_number'),
    address: jsonb('address').$type<{ line1?: string; city?: string; state?: string; pincode?: string }>(),
    allergies: text('allergies').array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    mergedIntoId: uuid('merged_into_id'),
    registeredFacilityId: uuid('registered_facility_id'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('patients_uhid_uq').on(t.tenantId, t.uhid),
    index('patients_mobile_idx').on(t.tenantId, t.mobile),
    index('patients_abha_idx').on(t.tenantId, t.abhaNumber),
  ],
);

// ---------- audit ----------

export const auditLog = audit.table(
  'audit_log',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    tableName: text('table_name').notNull(),
    recordId: uuid('record_id'),
    action: text('action').notNull(),
    oldRow: jsonb('old_row'),
    newRow: jsonb('new_row'),
    actorId: uuid('actor_id'),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('audit_log_record_idx').on(t.tenantId, t.tableName, t.recordId)],
);

export const recordViews = audit.table(
  'record_views',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entity: text('entity').notNull(),
    recordId: uuid('record_id').notNull(),
    actorId: uuid('actor_id').notNull(),
    reason: text('reason'),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('record_views_record_idx').on(t.tenantId, t.entity, t.recordId)],
);

/** Transactional outbox: write events in the same transaction as the change. */
export const outbox = audit.table(
  'outbox',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'string' }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
