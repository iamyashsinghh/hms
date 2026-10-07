import { Injectable } from '@nestjs/common';
import type { Entitlements, LimitKey, Plan, Subscription, TenantStatus } from './contracts';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionsService } from './subscriptions.service';

/**
 * What other modules use (PARALLEL_PLAN.md section 4). PlatformModule is global, so no import is needed:
 *   constructor(private readonly platform: PlatformService) {}
 *   await this.platform.assertWithinLimit('users');          // before creating a staff user
 *   await this.platform.assertWithinLimit('beds', { current: beds, adding: 1 });
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /** The hospital's plan, current subscription and status. */
  getPlan(tenantId: string): Promise<{ plan: Plan; subscription: Subscription | null; tenantStatus: TenantStatus }> {
    return this.subscriptions.getPlan(tenantId);
  }

  /** Modules and limits after super-admin overrides (cached ~15 s). */
  getEntitlements(tenantId: string): Promise<Entitlements> {
    return this.entitlements.forTenant(tenantId);
  }

  async hasModule(tenantId: string, moduleKey: string): Promise<boolean> {
    return (await this.entitlements.forTenant(tenantId)).modules.includes(moduleKey);
  }

  /** Throws 403 `plan_limit_reached` when the plan's limit would be exceeded. */
  assertWithinLimit(key: LimitKey, opts?: { tenantId?: string; adding?: number; current?: number }): Promise<void> {
    return this.entitlements.assertWithinLimit(key, opts);
  }
}
