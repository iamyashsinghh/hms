// Runs once per deploy, before the API starts (the "migrate" service in docker-compose.prod.yml):
// 1. creates/updates the database roles with the passwords from .env.prod,
// 2. applies pending migrations,
// 3. seeds the demo hospitals on an empty database, otherwise only syncs permissions and system roles.
const { Client } = require('pg');
const { migrate, seed, syncPermissionCatalog, syncSystemRoles } = require('../../packages/db/dist');

const env = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const host = process.env.POSTGRES_HOST || 'postgres';
const dbName = process.env.POSTGRES_DB || 'hms';
const url = (user, password) => `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/${dbName}`;

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function ensureRoles() {
  const roles = [
    ['hms_migrator', env('HMS_MIGRATOR_PASSWORD'), ''],
    ['hms_app', env('HMS_APP_PASSWORD'), ' NOBYPASSRLS'],
    ['hms_platform', env('HMS_PLATFORM_PASSWORD'), ' NOBYPASSRLS'],
  ];
  await withClient(url(process.env.POSTGRES_USER || 'postgres', env('POSTGRES_PASSWORD')), async (c) => {
    for (const [name, password, extra] of roles) {
      const exists = await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
      const verb = exists.rowCount ? 'ALTER' : 'CREATE';
      await c.query(`${verb} ROLE ${name} LOGIN PASSWORD ${c.escapeLiteral(password)}${extra}`);
    }
    await c.query(`GRANT ALL ON DATABASE ${dbName} TO hms_migrator`);
    await c.query(`ALTER DATABASE ${dbName} OWNER TO hms_migrator`);
  });
  console.log('roles: ok');
}

async function syncRoles(migratorUrl) {
  await withClient(migratorUrl, async (c) => {
    await c.query('BEGIN');
    const n = await syncPermissionCatalog(c);
    const tenants = await c.query('SELECT id FROM platform.tenants');
    for (const t of tenants.rows) {
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.id]);
      await syncSystemRoles(c, t.id);
    }
    await c.query('COMMIT');
    console.log(`permissions: ${n}, hospitals synced: ${tenants.rowCount}`);
  });
}

async function main() {
  await ensureRoles();
  const migratorUrl = url('hms_migrator', env('HMS_MIGRATOR_PASSWORD'));
  const r = await migrate(migratorUrl);
  console.log(`migrations: ${r.applied.length} applied, ${r.skipped} already applied`);

  const mode = (process.env.SEED_DEMO || 'auto').toLowerCase();
  const tenants = await withClient(migratorUrl, (c) => c.query('SELECT count(*)::int AS n FROM platform.tenants'));
  const empty = tenants.rows[0].n === 0;
  if (mode === 'always' || (mode === 'auto' && empty)) {
    await seed(migratorUrl);
    console.log('demo seed: done');
  } else {
    await syncRoles(migratorUrl);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
