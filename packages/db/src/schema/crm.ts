/**
 * Referral & CRM tables. Owned by the "crm" workstream (Postgres schema: crm).
 * Prefix every exported table with the module name to avoid clashes, e.g. crmThings.
 * Example:
 *   import { crm as pg, idColumn, tenantIdColumn, timestamps } from './_common';
 *   export const crmThings = pg.table('things', { tenantId: tenantIdColumn(), id: idColumn(), ...timestamps() },
 *     (t) => [primaryKey({ columns: [t.tenantId, t.id] })]);
 */
export {};
