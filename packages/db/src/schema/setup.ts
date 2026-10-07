/**
 * Hospital Setup tables. Owned by the "setup" workstream (Postgres schema: setup).
 * Prefix every exported table with the module name to avoid clashes, e.g. setupThings.
 * Example:
 *   import { setup as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const setupThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
