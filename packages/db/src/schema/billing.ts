/**
 * Billing tables. Owned by the "billing" workstream (Postgres schema: billing).
 * Prefix every exported table with the module name to avoid clashes, e.g. billingThings.
 * Example:
 *   import { billing as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const billingThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
