/**
 * Radiology tables. Owned by the "radiology" workstream (Postgres schema: radiology).
 * Prefix every exported table with the module name to avoid clashes, e.g. radiologyThings.
 * Example:
 *   import { radiology as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const radiologyThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
