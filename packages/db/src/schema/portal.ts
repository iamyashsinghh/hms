/**
 * Patient Portal tables. Owned by the "portal" workstream (Postgres schema: portal).
 * Prefix every exported table with the module name to avoid clashes, e.g. portalThings.
 * Example:
 *   import { portal as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const portalThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
