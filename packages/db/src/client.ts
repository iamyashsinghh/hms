import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
/** A transaction handle; module repositories take this so they always run inside the tenant transaction. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createPool(connectionString: string, config: PoolConfig = {}): Pool {
  return new Pool({ connectionString, max: 10, ...config });
}

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}

export interface RequestScope {
  tenantId: string;
  userId?: string | null;
  facilityId?: string | null;
}

/**
 * Run `fn` in one transaction with the tenant context set (SET LOCAL semantics), so
 * row-level security only shows this tenant's rows. Safe with PgBouncer transaction pooling.
 */
export async function withTenant<T>(db: Database, scope: RequestScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${scope.tenantId}, true),
      set_config('app.user_id', ${scope.userId ?? ''}, true),
      set_config('app.facility_id', ${scope.facilityId ?? ''}, true)`);
    return fn(tx);
  });
}
