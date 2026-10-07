import { HttpStatus, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  platformEntitlementOverrides,
  platformLimitOverrides,
  platformPlans,
  platformSubscriptions,
  sql,
  tenants,
  type Tx,
} from '@hms/db';
import { ALWAYS_ENTITLED, LIMIT_KEYS, type Entitlements, type LimitKey, type Limits, type Plan, type Subscription, type TenantStatus, type Usage } from './contracts';
import { currentContext } from '../../common/context/request-context';
import { AppError, notFound } from '../../common/errors/errors';
import { PlatformDb } from './platform-db';
import { toPlan, toSubscription } from './mappers';

const CACHE_MS = 15_000;

/**
 * What a hospital may use: plan modules ± super-admin overrides, and plan limits ± overrides.
 * Exported (via PlatformService) for the @RequireEntitlement guard and for modules that enforce limits.
 */
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { at: number; value: Entitlements }>();

  constructor(private readonly db: PlatformDb) {}

  async forTenant(tenantId: string): Promise<Entitlements> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await this.db.tenant(tenantId, (tx) => this.load(tx, tenantId));
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  invalidate(tenantId?: string) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }

  /** Inside any transaction that can see the hospital's platform rows. */
  async load(tx: Tx, tenantId: string): Promise<Entitlements> {
    const { tenant, plan } = await this.tenantAndPlan(tx, tenantId);
    const overrides = await tx
      .select()
      .from(platformEntitlementOverrides)
      .where(and(eq(platformEntitlementOverrides.tenantId, tenantId), sql`(${platformEntitlementOverrides.expiresAt} is null or ${platformEntitlementOverrides.expiresAt} > now())`));
    const limitRows = await tx.select().from(platformLimitOverrides).where(eq(platformLimitOverrides.tenantId, tenantId));

    const modules = new Set<string>([...ALWAYS_ENTITLED, ...plan.modules]);
    for (const o of overrides) {
      if (o.enabled) modules.add(o.moduleKey);
      else if (!(ALWAYS_ENTITLED as readonly string[]).includes(o.moduleKey)) modules.delete(o.moduleKey);
    }
    const limits: Limits = { ...plan.limits };
    for (const l of limitRows) limits[l.limitKey as LimitKey] = l.value;

    return {
      tenantId,
      planCode: plan.code,
      planName: plan.name,
      tenantStatus: tenant.status as TenantStatus,
      modules: [...modules].sort(),
      limits,
    };
  }

  async tenantAndPlan(tx: Tx, tenantId: string): Promise<{ tenant: typeof tenants.$inferSelect; plan: Plan }> {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw notFound('Hospital');
    const [planRow] = await tx.select().from(platformPlans).where(eq(platformPlans.code, tenant.plan)).limit(1);
    // A tenant created before its plan existed falls back to Starter limits and modules.
    const [fallback] = planRow ? [planRow] : await tx.select().from(platformPlans).where(eq(platformPlans.code, 'starter')).limit(1);
    if (!fallback) throw new Error('No plans are configured');
    return { tenant, plan: toPlan(fallback) };
  }

  async currentSubscription(tx: Tx, tenantId: string, lock = false): Promise<Subscription | null> {
    const q = tx
      .select()
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.tenantId, tenantId), sql`${platformSubscriptions.endedAt} is null`))
      .limit(1);
    const [row] = lock ? await q.for('update') : await q;
    return row ? toSubscription(row) : null;
  }

  /** Active users and facilities, read from the core tables. Call inside the hospital's transaction. */
  async usage(tx: Tx): Promise<Usage> {
    const res = await tx.execute<{ users: number; facilities: number }>(sql`
      select (select count(*)::int from iam.users where status <> 'disabled') as users,
             (select count(*)::int from setup.facilities where is_active) as facilities`);
    return res.rows[0] ?? { users: 0, facilities: 0 };
  }

  /**
   * Throws 403 `plan_limit_reached` if adding `adding` more of `key` would exceed the plan.
   * For users and facilities the current count is read here; for beds pass `current`.
   * Uses the hospital in the request context unless `tenantId` is given.
   */
  async assertWithinLimit(key: LimitKey, opts: { tenantId?: string; adding?: number; current?: number } = {}): Promise<void> {
    if (!LIMIT_KEYS.includes(key)) throw new Error(`Unknown limit ${key}`);
    const tenantId = opts.tenantId ?? currentContext()?.tenantId;
    if (!tenantId) throw new Error('assertWithinLimit needs a hospital');
    const ent = await this.forTenant(tenantId);
    const max = ent.limits[key];
    if (max === null || max === undefined) return;
    let current = opts.current;
    if (current === undefined) {
      if (key === 'beds') throw new Error('Pass the current bed count');
      const usage = await this.db.tenant(tenantId, (tx) => this.usage(tx));
      current = usage[key];
    }
    if (current + (opts.adding ?? 1) > max) {
      throw new AppError(HttpStatus.FORBIDDEN, 'plan_limit_reached', `Your ${ent.planName} plan allows ${max} ${key}. Upgrade to add more.`, {
        limit: key,
        max,
        current,
        plan: ent.planCode,
      });
    }
  }
}
