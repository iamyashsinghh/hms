/**
 * Insurance & Schemes tables. Owned by the "insurance" workstream (Postgres schema: insurance).
 * Prefix every exported table with the module name to avoid clashes, e.g. insuranceThings.
 * Example:
 *   import { insurance as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const insuranceThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
