/**
 * HR & Roster tables. Owned by the "hr" workstream (Postgres schema: hr).
 * Prefix every exported table with the module name to avoid clashes, e.g. hrThings.
 * Example:
 *   import { hr as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const hrThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
