/**
 * Building blocks shared by every schema file. Owned by the foundation.
 *
 * Rules for tenant tables (see PARALLEL_PLAN.md):
 * - columns `tenant_id` + `id`, primary key (tenant_id, id)
 * - foreign keys to other tenant tables include tenant_id
 * - in the SQL migration: SELECT app.enable_tenant_rls('<schema>.<table>');
 */
import { sql } from 'drizzle-orm';
import { pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';

export const platform = pgSchema('platform');
export const iam = pgSchema('iam');
export const setup = pgSchema('setup');
export const clinical = pgSchema('clinical');
export const billing = pgSchema('billing');
export const inventory = pgSchema('inventory');
export const lab = pgSchema('lab');
export const radiology = pgSchema('radiology');
export const inpatient = pgSchema('inpatient');
export const insurance = pgSchema('insurance');
export const comms = pgSchema('comms');
export const portal = pgSchema('portal');
export const reporting = pgSchema('reporting');
export const crm = pgSchema('crm');
export const hr = pgSchema('hr');
export const quality = pgSchema('quality');
export const ops = pgSchema('ops');
export const integrations = pgSchema('integrations');
export const audit = pgSchema('audit');

/** UUIDv7 primary key generated in the database (time-ordered). */
export const idColumn = () => uuid('id').notNull().default(sql`app.uuid_v7()`);
export const tenantIdColumn = () => uuid('tenant_id').notNull();

export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
});

/** created_by / updated_by: the staff user id from app.user_id. */
export const actorColumns = () => ({
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
});
