/**
 * OPD / EMR tables. Owned by the "emr" workstream (Postgres schema: clinical).
 * Prefix every exported table with the module name to avoid clashes, e.g. emrThings.
 * Example:
 *   import { clinical as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const emrThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
