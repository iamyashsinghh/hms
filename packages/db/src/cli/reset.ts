// Local/CI only: drop every HMS schema, then migrate and seed from scratch. Refuses in production.
import { Client } from 'pg';
import { requireEnv } from './env';
import { migrate } from '../migrator';
import { seed } from '../seed';

const SCHEMAS = ['app', 'platform', 'iam', 'setup', 'clinical', 'billing', 'inventory', 'lab', 'radiology', 'inpatient',
  'insurance', 'comms', 'portal', 'reporting', 'crm', 'hr', 'quality', 'ops', 'integrations', 'audit'];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('db:reset is disabled in production');
  const url = requireEnv('DATABASE_MIGRATOR_URL');
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMAS.join(', ')} CASCADE`);
  await client.query('DROP TABLE IF EXISTS public.schema_migrations');
  await client.end();
  const r = await migrate(url);
  console.log(`migrations: ${r.applied.length} applied`);
  await seed(url);
  console.log('reset done');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
