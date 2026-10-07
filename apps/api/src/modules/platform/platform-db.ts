import { Injectable } from '@nestjs/common';
import { sql, type Tx } from '@hms/db';
import type { PoolClient } from 'pg';
import { DbService } from '../../common/db/db.service';

/**
 * Database scopes the platform module needs beyond DbService.tx():
 * - tenant(): one hospital's rows, for super-admin actions on a single hospital and background jobs.
 * - crossTenant(): every hospital's platform rows (the `platform_admin` RLS policy). Super-admin lists only.
 * - client(): a raw pg client in a transaction, for provisionTenant() during signup.
 */
@Injectable()
export class PlatformDb {
  constructor(private readonly db: DbService) {}

  tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.asTenant({ tenantId }, fn);
  }

  crossTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.platform_admin', 'on', true)`);
      return fn(tx);
    });
  }

  /** Unscoped handle for global tables (plans, admins, announcements, help). */
  get global() {
    return this.db.db;
  }

  async client<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

/** Point an open cross-tenant transaction at one hospital (for outbox events and RLS-checked inserts). */
export async function scopeToTenant(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
}
