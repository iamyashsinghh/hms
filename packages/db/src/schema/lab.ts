/**
 * Laboratory tables. Owned by the "lab" workstream (Postgres schema: lab).
 * Prefix every exported table with the module name to avoid clashes, e.g. labThings.
 * Example:
 *   import { lab as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const labThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
