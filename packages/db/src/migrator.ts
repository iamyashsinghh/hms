import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const NAME_RE = /^\d{14}_[a-z0-9]+_[a-z0-9_]+\.sql$/;
const NO_TX_MARKER = '-- hms:no-transaction';

export interface MigrationResult {
  applied: string[];
  skipped: number;
}

/**
 * Forward-only SQL migrations. Files are `YYYYMMDDHHMMSS_<module>_<what>.sql` and run in name
 * order. A file that was already applied must not change (checksum check). Files from parallel
 * branches with older timestamps are still applied if missing, so merge order does not matter.
 * A file starting with `-- hms:no-transaction` runs outside a transaction (CREATE INDEX CONCURRENTLY).
 */
export async function migrate(connectionString: string, log: (m: string) => void = console.log): Promise<MigrationResult> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(727274)`);
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), duration_ms integer NOT NULL)`);
    const done = new Map<string, string>(
      (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM public.schema_migrations')).rows.map(
        (r) => [r.name, r.checksum],
      ),
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    const result: MigrationResult = { applied: [], skipped: 0 };
    for (const file of files) {
      if (!NAME_RE.test(file)) throw new Error(`Bad migration file name: ${file} (expected YYYYMMDDHHMMSS_module_what.sql)`);
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = createHash('sha256').update(body).digest('hex');
      const prev = done.get(file);
      if (prev) {
        if (prev !== checksum) throw new Error(`Migration ${file} was changed after it was applied. Write a new migration instead.`);
        result.skipped++;
        continue;
      }
      const started = Date.now();
      const noTx = body.trimStart().startsWith(NO_TX_MARKER);
      log(`applying ${file}${noTx ? ' (no transaction)' : ''}`);
      try {
        if (!noTx) await client.query('BEGIN');
        await client.query(`SET lock_timeout = '5s'; SET statement_timeout = '5min'`);
        await client.query(body);
        await client.query('INSERT INTO public.schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)', [
          file,
          checksum,
          Date.now() - started,
        ]);
        if (!noTx) await client.query('COMMIT');
      } catch (err) {
        if (!noTx) await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      result.applied.push(file);
    }
    return result;
  } finally {
    await client.query(`SELECT pg_advisory_unlock(727274)`).catch(() => undefined);
    await client.end();
  }
}
