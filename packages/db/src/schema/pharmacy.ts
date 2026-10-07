/**
 * Pharmacy tables. Owned by the "pharmacy" workstream (Postgres schema: inventory).
 * Prefix every exported table with the module name to avoid clashes, e.g. pharmacyThings.
 * Example:
 *   import { inventory as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const pharmacyThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
