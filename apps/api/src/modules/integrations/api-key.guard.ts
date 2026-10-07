import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { integrations } from '@hms/shared';
import type { FastifyRequest } from 'fastify';
import type { RequestContext } from '../../common/context/request-context';
import { forbidden } from '../../common/errors/errors';
import { DeveloperService, type ApiKeyPrincipal } from './developer.service';
import { bindTenant } from './tenant-scope';

const API_SCOPES = 'hms:integrations:apiScopes';

/** The API key must carry ALL of these scopes. */
export const RequireApiScopes = (...scopes: integrations.ApiScope[]) => SetMetadata(API_SCOPES, scopes);

/**
 * For third-party routes (marked @Public so the staff guard skips them): accepts `x-api-key: hmsk.…`
 * or `Authorization: Bearer hmsk.…`, checks scopes and binds the key's hospital to the request.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly developer: DeveloperService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest & { ctx: RequestContext; apiKey?: ApiKeyPrincipal }>();
    const header = req.headers['x-api-key'];
    const auth = req.headers.authorization;
    const presented = typeof header === 'string' ? header : auth?.startsWith('Bearer ') ? auth.slice(7) : '';
    const principal = await this.developer.authenticate(presented);
    const required = this.reflector.getAllAndOverride<string[]>(API_SCOPES, [context.getHandler(), context.getClass()]) ?? [];
    const missing = required.filter((s) => !principal.scopes.includes(s as integrations.ApiScope));
    if (missing.length) throw forbidden(`This API key lacks the scope: ${missing.join(', ')}`);
    bindTenant(req.ctx, principal.tenantId);
    req.apiKey = principal;
    return true;
  }
}
