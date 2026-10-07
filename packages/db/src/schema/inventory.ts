/**
 * Inventory & Procurement tables. Owned by the "inventory" workstream (Postgres schema: inventory).
 * Prefix every exported table with the module name to avoid clashes, e.g. inventoryThings.
 * Example:
 *   import { inventory as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const inventoryThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
