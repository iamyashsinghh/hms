/**
 * Notifications tables. Owned by the "notifications" workstream (Postgres schema: comms).
 * Prefix every exported table with the module name to avoid clashes, e.g. notificationsThings.
 * Example:
 *   import { comms as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const notificationsThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
