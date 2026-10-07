/**
 * SaaS Platform tables. Owned by the "platform" workstream (Postgres schema: platform).
 * Prefix every exported table with the module name to avoid clashes, e.g. platformThings.
 * Example:
 *   import { platform as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const platformThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
