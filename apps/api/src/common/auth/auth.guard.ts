import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FACILITY_HEADER, type AccessTokenClaims } from '@hms/shared';
import type { FastifyRequest } from 'fastify';
import { emptyContext, type RequestContext } from '../context/request-context';
import { AppError, forbidden } from '../errors/errors';
import { IS_PUBLIC, PERMISSIONS } from './decorators';
import { PrincipalService } from './principal.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const unauthorized = (msg = 'Please sign in again') => new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', msg);

/**
 * Global guard: verifies the access token, loads roles/permissions/facilities, checks the
 * X-Facility-Id header and the route's @RequirePermissions. Routes marked @Public() skip it.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly principals: PrincipalService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { ctx: RequestContext }>();
    req.ctx = emptyContext(String(req.id));
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing access token');
    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(header.slice(7));
    } catch {
      throw unauthorized('Access token is invalid or expired');
    }
    if (claims.typ !== 'staff') throw unauthorized();

    const principal = await this.principals.load(claims.tid, claims.sub, claims.sid);
    if (!principal?.active) throw unauthorized('Your session has ended');

    const ctx = req.ctx;
    ctx.tenantId = claims.tid;
    ctx.userId = claims.sub;
    ctx.sessionId = claims.sid;
    ctx.roles = principal.roles;
    ctx.permissions = new Set(principal.permissions);
    ctx.facilityIds = principal.facilityIds;

    const facility = req.headers[FACILITY_HEADER];
    if (typeof facility === 'string' && facility) {
      if (!UUID_RE.test(facility)) throw forbidden('Invalid facility');
      if (principal.facilityIds !== 'all' && !principal.facilityIds.includes(facility)) {
        throw forbidden('You do not have access to this facility');
      }
      ctx.facilityId = facility;
    } else if (principal.facilityIds !== 'all' && principal.facilityIds.length === 1) {
      ctx.facilityId = principal.facilityIds[0];
    }

    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS, targets) ?? [];
    const missing = required.filter((p) => !ctx.permissions.has(p));
    if (missing.length) {
      throw new AppError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have permission to do this', { missing });
    }
    return true;
  }
}
