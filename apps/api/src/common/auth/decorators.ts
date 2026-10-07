import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { RequestContext } from '../context/request-context';

export const IS_PUBLIC = 'hms:isPublic';
export const PERMISSIONS = 'hms:permissions';

/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller must hold ALL of these permission keys (module.resource.action). */
export const RequirePermissions = (...keys: string[]) => SetMetadata(PERMISSIONS, keys);

/** The caller's context: tenantId, userId, roles, permissions, facility. */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestContext => {
  return ctx.switchToHttp().getRequest<{ ctx: RequestContext }>().ctx;
});
