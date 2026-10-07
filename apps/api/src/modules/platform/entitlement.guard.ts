import { applyDecorators, CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/errors';
import { EntitlementsService } from './entitlements.service';

export const ENTITLEMENT = 'hms:entitlement';

/**
 * Route (or controller) needs the hospital's plan to include this module, e.g.
 *   @RequireEntitlement('lab')
 * Runs after the global AuthGuard, so the hospital is known. Fails with 403 `plan_upgrade_required`.
 */
export const RequireEntitlement = (moduleKey: string) =>
  applyDecorators(SetMetadata(ENTITLEMENT, moduleKey), UseGuards(EntitlementGuard));

@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(ENTITLEMENT, [context.getHandler(), context.getClass()]);
    if (!key) return true;
    const req = context.switchToHttp().getRequest<{ ctx?: RequestContext }>();
    const tenantId = req.ctx?.tenantId;
    if (!tenantId) return true; // public routes have no hospital to check
    const ent = await this.entitlements.forTenant(tenantId);
    if (!ent.modules.includes(key)) {
      throw new AppError(HttpStatus.FORBIDDEN, 'plan_upgrade_required', `Your ${ent.planName} plan does not include this feature`, {
        module: key,
        plan: ent.planCode,
      });
    }
    return true;
  }
}
