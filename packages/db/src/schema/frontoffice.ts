/**
 * Front Office tables. Owned by the "frontoffice" workstream (Postgres schema: clinical).
 * Prefix every exported table with the module name to avoid clashes, e.g. frontofficeThings.
 * Example:
 *   import { clinical as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const frontofficeThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
