import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  and,
  eq,
  facilities,
  inArray,
  refreshTokens,
  sql,
  tenants,
  users,
  verifyPassword,
  type Tx,
} from '@hms/db';
import type { AccessTokenClaims, AuthTokens, Me } from '@hms/shared';
import { loginRequestSchema } from '@hms/shared';
import type { z } from 'zod';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DbService } from '../../common/db/db.service';
import { AppError } from '../../common/errors/errors';
import { PrincipalService } from '../../common/auth/principal.service';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** A just-rotated refresh token is still accepted this long (two tabs refreshing at once). */
const ROTATION_GRACE_SECONDS = 30;

const invalidCredentials = () =>
  new AppError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Hospital code, login or password is incorrect');
const invalidSession = () => new AppError(HttpStatus.UNAUTHORIZED, 'invalid_refresh_token', 'Please sign in again');

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

type LoginInput = z.output<typeof loginRequestSchema>;
export interface IssuedTokens extends AuthTokens {
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
    private readonly principals: PrincipalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, ip?: string): Promise<IssuedTokens & { user: Me }> {
    const [tenant] = await this.db.db.select().from(tenants).where(eq(tenants.code, input.tenantCode)).limit(1);
    if (!tenant || !['trial', 'active', 'grace'].includes(tenant.status)) throw invalidCredentials();

    const identifier = input.identifier.toLowerCase();
    const outcome = await this.db.asTenant({ tenantId: tenant.id }, async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${identifier} or ${users.mobile} = ${identifier}`)
        .limit(1);
      if (!user?.passwordHash || user.status !== 'active') return { ok: false as const };
      if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) return { ok: false as const, locked: true };

      if (!(await verifyPassword(input.password, user.passwordHash))) {
        const failed = user.failedLoginCount + 1;
        await tx
          .update(users)
          .set({
            failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
            lockedUntil: failed >= MAX_FAILED_LOGINS ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : null,
          })
          .where(eq(users.id, user.id));
        return { ok: false as const, locked: failed >= MAX_FAILED_LOGINS };
      }

      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` })
        .where(eq(users.id, user.id));
      const refresh = await this.createRefreshToken(tx, tenant.id, user.id, randomUUID(), input.client, input.deviceName, ip);
      return { ok: true as const, userId: user.id, refresh };
    });

    if (!outcome.ok) {
      if (outcome.locked) {
        throw new AppError(HttpStatus.UNAUTHORIZED, 'account_locked', `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`);
      }
      throw invalidCredentials();
    }
    const access = await this.signAccess(tenant.id, outcome.userId, outcome.refresh.sessionId);
    const user = await this.me(tenant.id, outcome.userId);
    return { ...access, refreshToken: outcome.refresh.token, user };
  }

  /** Rotate a refresh token. Presenting an already-rotated token (outside the grace window) ends the whole session. */
  async refresh(raw: string, client: 'web' | 'mobile', ip?: string): Promise<IssuedTokens> {
    const parsed = parseRefreshToken(raw);
    if (!parsed) throw invalidSession();
    const { tenantId, tokenId, secret } = parsed;

    const result = await this.db.asTenant({ tenantId }, async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, tokenId)).limit(1);
      if (!row || row.tokenHash !== sha256(secret)) return null;
      if (new Date(row.expiresAt) <= new Date()) return null;
      if (row.revokedAt) {
        const inGrace = row.replacedBy && Date.now() - new Date(row.revokedAt).getTime() < ROTATION_GRACE_SECONDS * 1000;
        if (!inGrace) {
          // Reuse of an old token: someone may have stolen it. End the session everywhere.
          await tx.update(refreshTokens).set({ revokedAt: sql`now()` }).where(
            and(eq(refreshTokens.sessionId, row.sessionId), sql`${refreshTokens.revokedAt} is null`),
          );
          return null;
        }
      }
      const next = await this.createRefreshToken(tx, tenantId, row.userId, row.sessionId, client, row.deviceName ?? undefined, ip);
      if (!row.revokedAt) {
        await tx.update(refreshTokens).set({ revokedAt: sql`now()`, replacedBy: next.id }).where(eq(refreshTokens.id, row.id));
      }
      return { userId: row.userId, sessionId: row.sessionId, token: next.token };
    });
    if (!result) throw invalidSession();

    const principal = await this.principals.load(tenantId, result.userId, result.sessionId);
    if (!principal?.active) throw invalidSession();
    const access = await this.signAccess(tenantId, result.userId, result.sessionId);
    return { ...access, refreshToken: result.token };
  }

  /** Revoke every token of the session this refresh token belongs to. */
  async logout(raw: string | undefined): Promise<void> {
    const parsed = raw ? parseRefreshToken(raw) : null;
    if (!parsed) return;
    await this.db.asTenant({ tenantId: parsed.tenantId }, async (tx) => {
      const [row] = await tx.select().from(refreshTokens).where(eq(refreshTokens.id, parsed.tokenId)).limit(1);
      if (!row || row.tokenHash !== sha256(parsed.secret)) return;
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.sessionId, row.sessionId), sql`${refreshTokens.revokedAt} is null`));
    });
  }

  async me(tenantId: string, userId: string): Promise<Me> {
    return this.db.asTenant({ tenantId, userId }, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
      if (!user || !tenant) throw invalidSession();
      const principal = await this.principals.load(tenantId, userId);
      const facilityRows =
        principal?.facilityIds === 'all'
          ? await tx.select().from(facilities).where(eq(facilities.isActive, true)).orderBy(facilities.name)
          : principal?.facilityIds.length
            ? await tx.select().from(facilities).where(inArray(facilities.id, principal.facilityIds)).orderBy(facilities.name)
            : [];
      return {
        id: user.id,
        tenantId,
        tenantCode: tenant.code,
        tenantName: tenant.name,
        name: user.name,
        email: user.email,
        mobile: user.mobile,
        roles: principal?.roles ?? [],
        permissions: principal?.permissions ?? [],
        facilities: facilityRows.map((f) => ({ id: f.id, code: f.code, name: f.name })),
      };
    });
  }

  private async signAccess(tenantId: string, userId: string, sessionId: string): Promise<AuthTokens> {
    const claims: AccessTokenClaims = { sub: userId, tid: tenantId, sid: sessionId, typ: 'staff' };
    const accessToken = await this.jwt.signAsync(claims);
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, expiresIn: exp - iat };
  }

  private async createRefreshToken(
    tx: Tx,
    tenantId: string,
    userId: string,
    sessionId: string,
    client: 'web' | 'mobile',
    deviceName?: string,
    ip?: string,
  ): Promise<{ id: string; token: string; sessionId: string }> {
    const secret = randomBytes(32).toString('base64url');
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        tenantId,
        userId,
        sessionId,
        tokenHash: sha256(secret),
        client,
        deviceName,
        createdIp: ip,
        expiresAt: sql`now() + make_interval(days => ${this.config.JWT_REFRESH_TTL_DAYS})` as unknown as string,
      })
      .returning({ id: refreshTokens.id });
    return { id: row!.id, token: `${tenantId}.${row!.id}.${secret}`, sessionId };
  }
}

/** Refresh tokens look like `<tenantId>.<tokenId>.<secret>` so they can be looked up under RLS. */
function parseRefreshToken(raw: string): { tenantId: string; tokenId: string; secret: string } | null {
  const [tenantId, tokenId, secret, extra] = raw.split('.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (extra !== undefined || !tenantId || !tokenId || !secret || !uuid.test(tenantId) || !uuid.test(tokenId)) return null;
  return { tenantId, tokenId, secret };
}

