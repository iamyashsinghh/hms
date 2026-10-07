import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformAdminRole } from './contracts';
import type { FastifyRequest } from 'fastify';
import { AppError, forbidden } from '../../common/errors/errors';
import { AdminAuthService } from './admin-auth.service';

export const PLATFORM_ROLES = 'hms:platformRoles';
export const PLATFORM_PUBLIC = 'hms:platformPublic';

/** Super-admin route restricted to these platform roles (default: any active platform admin). */
export const PlatformRoles = (...roles: PlatformAdminRole[]) => SetMetadata(PLATFORM_ROLES, roles);
/** Skip the platform-admin guard (admin login). */
export const PlatformPublic = () => SetMetadata(PLATFORM_PUBLIC, true);

export interface PlatformPrincipal {
  id: string;
  name: string;
  email: string;
  role: PlatformAdminRole;
  sessionId: string;
}

type AdminRequest = FastifyRequest & { platformAdmin?: PlatformPrincipal };

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): PlatformPrincipal => {
  const admin = ctx.switchToHttp().getRequest<AdminRequest>().platformAdmin;
  if (!admin) throw new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Please sign in again');
  return admin;
});

/**
 * Guards the super-admin console. Controllers using it are @Public() for the staff AuthGuard
 * and accept only `typ: 'platform'` access tokens with a live admin session.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Missing access token');
    const admin = await this.auth.verify(header.slice(7));
    const roles = this.reflector.getAllAndOverride<PlatformAdminRole[]>(PLATFORM_ROLES, targets);
    if (roles?.length && !roles.includes(admin.role)) throw forbidden('This needs a super admin');
    req.platformAdmin = admin;
    return true;
  }
}
