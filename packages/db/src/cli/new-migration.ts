// Usage: pnpm db:new <module> <what>   e.g. pnpm db:new billing create_invoices
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MIGRATIONS_DIR } from '../migrator';

const [mod, ...rest] = process.argv.slice(2);
if (!mod || !rest.length) {
  console.error('Usage: pnpm db:new <module> <what>');
  process.exit(1);
}
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const what = rest.join('_').toLowerCase().replace(/[^a-z0-9_]/g, '_');
const file = join(MIGRATIONS_DIR, `${ts}_${mod}_${what}.sql`);
writeFileSync(
  file,
  `-- ${mod}: ${rest.join(' ')}
-- Tenant tables: (tenant_id, id) primary key, FKs include tenant_id, then:
--   SELECT app.enable_tenant_rls('schema.table');
--   SELECT app.enable_updated_at('schema.table');   -- if it has updated_at
--   SELECT app.enable_audit('schema.table');        -- for clinical/financial records

`,
);
console.log(file);
