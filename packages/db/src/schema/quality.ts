/**
 * Quality & NABH tables. Owned by the "quality" workstream (Postgres schema: quality).
 * Prefix every exported table with the module name to avoid clashes, e.g. qualityThings.
 * Example:
 *   import { quality as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const qualityThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
