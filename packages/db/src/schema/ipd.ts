/**
 * IPD & Nursing tables. Owned by the "ipd" workstream (Postgres schema: inpatient).
 * Prefix every exported table with the module name to avoid clashes, e.g. ipdThings.
 * Example:
 *   import { inpatient as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const ipdThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
