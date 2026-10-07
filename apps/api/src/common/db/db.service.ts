import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, createPool, withTenant, type Database, type RequestScope, type Tx } from '@hms/db';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../../config';
import { currentContext } from '../context/request-context';

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;
  /**
   * Unscoped handle. Row-level security hides all tenant rows here, so it is only useful for
   * platform tables (tenant lookup at login). Module code uses tx().
   */
  readonly db: Database;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = createPool(config.DATABASE_URL);
    this.db = createDb(this.pool);
  }

  /**
   * Run `fn` in one transaction scoped to the caller's hospital, user and facility.
   * Every query a module makes should go through here.
   */
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const ctx = currentContext();
    if (!ctx?.tenantId) throw new Error('DbService.tx() called without a tenant in the request context');
    return withTenant(this.db, { tenantId: ctx.tenantId, userId: ctx.userId, facilityId: ctx.facilityId }, fn);
  }

  /** Explicit scope, for login/refresh before a context exists and for background jobs. */
  asTenant<T>(scope: RequestScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return withTenant(this.db, scope, fn);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
