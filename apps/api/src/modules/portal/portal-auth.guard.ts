import { CanActivate, createParamDecorator, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { sql } from '@hms/db';
import type { portal } from '@hms/shared';
import type { FastifyRequest } from 'fastify';
import { DbService } from '../../common/db/db.service';
import { emptyContext, type RequestContext } from '../../common/context/request-context';
import { AppError } from '../../common/errors/errors';

/** The signed-in patient account. Available on patient routes via @Patient(). */
export interface PatientPrincipal {
  tenantId: string;
  accountId: string;
  sessionId: string;
}

type PortalRequest = FastifyRequest & { ctx: RequestContext; patient?: PatientPrincipal };

const unauthorized = (msg = 'Please sign in again') => new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', msg);

/**
 * Guard for patient routes. Use together with @Public() so the staff guard lets the request through:
 *   @Public() @UseGuards(PatientAuthGuard)
 * Accepts only `typ: 'patient'` tokens, checks the session and account are live, and puts the
 * tenant in the request context so DbService.tx() applies RLS for that hospital.
 */
@Injectable()
export class PatientAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PortalRequest>();
    req.ctx ??= emptyContext(String(req.id));
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized('Missing access token');
    let claims: portal.PatientTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<portal.PatientTokenClaims>(header.slice(7));
    } catch {
      throw unauthorized('Access token is invalid or expired');
    }
    if (claims.typ !== 'patient') throw unauthorized();

    const live = await this.db.asTenant({ tenantId: claims.tid }, async (tx) => {
      const res = await tx.execute<{ ok: boolean }>(sql`
        select true as ok
          from portal.sessions s
          join portal.accounts a on a.tenant_id = s.tenant_id and a.id = s.account_id
          join platform.tenants t on t.id = s.tenant_id
         where s.id = ${claims.sid} and s.account_id = ${claims.sub}
           and s.revoked_at is null and s.expires_at > now()
           and a.status = 'active' and t.status in ('trial', 'active', 'grace')`);
      return res.rows.length > 0;
    });
    if (!live) throw unauthorized('Your session has ended');

    req.ctx.tenantId = claims.tid;
    req.patient = { tenantId: claims.tid, accountId: claims.sub, sessionId: claims.sid };
    return true;
  }
}

/** The signed-in patient (set by PatientAuthGuard). */
export const Patient = createParamDecorator((_: unknown, ctx: ExecutionContext): PatientPrincipal => {
  const p = ctx.switchToHttp().getRequest<PortalRequest>().patient;
  if (!p) throw unauthorized();
  return p;
});
