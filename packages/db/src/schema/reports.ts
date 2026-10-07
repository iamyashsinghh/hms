/**
 * Reports & MIS tables. Owned by the "reports" workstream (Postgres schema: reporting).
 * Prefix every exported table with the module name to avoid clashes, e.g. reportsThings.
 * Example:
 *   import { reporting as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const reportsThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
