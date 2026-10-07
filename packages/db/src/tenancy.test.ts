/**
 * Guards that keep tenant isolation and the Drizzle schema honest. Needs a migrated database
 * (DATABASE_MIGRATOR_URL). Every module's new tables are checked automatically.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const url = process.env.DATABASE_MIGRATOR_URL!;
let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: url });
  await client.connect();
});
afterAll(() => client.end());

describe('tenant isolation', () => {
  it('every table with tenant_id has RLS enabled and a tenant_isolation policy', async () => {
    const res = await client.query<{ tbl: string; rls: boolean; has_policy: boolean }>(`
      select c.oid::regclass::text as tbl, c.relrowsecurity as rls,
             exists (select 1 from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname
                     and p.policyname = 'tenant_isolation') as has_policy
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
       where c.relkind in ('r', 'p') and n.nspname not in ('platform', 'public', 'pg_catalog')`);
    const bad = res.rows.filter((r) => !r.rls || !r.has_policy).map((r) => r.tbl);
    expect(bad, `Run SELECT app.enable_tenant_rls('<table>') for: ${bad.join(', ')}`).toEqual([]);
    expect(res.rows.length).toBeGreaterThan(5);
  });

  it('hms_app cannot bypass RLS and owns no tables', async () => {
    const role = await client.query(`select rolbypassrls, rolsuper from pg_roles where rolname = 'hms_app'`);
    expect(role.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const owned = await client.query(
      `select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'hms_app'`,
    );
    expect(owned.rows[0].n).toBe(0);
  });
});

describe('schema drift', () => {
  it('every Drizzle table and column exists in the migrated database with the same nullability', async () => {
    const tables = Object.values(schema).filter((v): v is PgTable => v instanceof PgTable);
    const problems: string[] = [];
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const res = await client.query<{ column_name: string; is_nullable: string }>(
        `select column_name, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2`,
        [cfg.schema ?? 'public', cfg.name],
      );
      const dbCols = new Map(res.rows.map((r) => [r.column_name, r.is_nullable === 'YES']));
      if (!dbCols.size) {
        problems.push(`${cfg.schema}.${cfg.name}: table missing (write a migration)`);
        continue;
      }
      for (const col of cfg.columns) {
        const nullable = dbCols.get(col.name);
        if (nullable === undefined) problems.push(`${cfg.schema}.${cfg.name}.${col.name}: column missing`);
        else if (nullable === col.notNull && !col.primary) problems.push(`${cfg.schema}.${cfg.name}.${col.name}: nullability differs`);
      }
    }
    expect(problems).toEqual([]);
  });
});
