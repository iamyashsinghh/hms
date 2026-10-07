/**
 * Facility Services tables. Owned by the "ops" workstream (Postgres schema: ops).
 * Prefix every exported table with the module name to avoid clashes, e.g. opsThings.
 * Example:
 *   import { ops as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const opsThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
