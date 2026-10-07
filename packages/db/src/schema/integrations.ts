/**
 * Integrations (ABDM) tables. Owned by the "integrations" workstream (Postgres schema: integrations).
 * Prefix every exported table with the module name to avoid clashes, e.g. integrationsThings.
 * Example:
 *   import { integrations as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const integrationsThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
