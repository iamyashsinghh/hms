import { HttpStatus, Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { count, eq, hashPassword, iso, platformAdmins, platformAdminSessions, sql, verifyPassword } from '@hms/db';
import type { PlatformAccessTokenClaims, PlatformAdmin, PlatformAdminRole, PlatformLoginResponse } from './contracts';
import { APP_CONFIG, type AppConfig } from '../../config';
import { AppError } from '../../common/errors/errors';
import { PlatformDb } from './platform-db';
import type { PlatformPrincipal } from './platform-admin.guard';
import { RateLimiter } from './rate-limit';

const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DEV_ADMIN = { email: 'super@hms.local', password: 'Super@12345' };

const invalid = () => new AppError(HttpStatus.UNAUTHORIZED, 'invalid_credentials', 'Email or password is incorrect');
const ended = () => new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Please sign in again');

export const toAdmin = (r: typeof platformAdmins.$inferSelect): PlatformAdmin => ({
  id: r.id,
  email: r.email,
  name: r.name,
  role: r.role as PlatformAdminRole,
  status: r.status as PlatformAdmin['status'],
  lastLoginAt: iso(r.lastLoginAt),
  createdAt: iso(r.createdAt),
});

/** Login for the super-admin console. Platform tokens carry typ 'platform' so staff routes reject them. */
@Injectable()
export class AdminAuthService implements OnApplicationBootstrap {
  private readonly logger = new Logger('PlatformAdminAuth');
  readonly limiter = new RateLimiter(20, 15 * 60_000);

  constructor(
    private readonly db: PlatformDb,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * First run: create a super admin from PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD.
   * Outside production, falls back to super@hms.local / Super@12345.
   */
  async onApplicationBootstrap() {
    const [{ n }] = await this.db.global.select({ n: count() }).from(platformAdmins);
    if (n > 0) return;
    const envEmail = process.env.PLATFORM_ADMIN_EMAIL;
    const envPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    if (this.config.NODE_ENV === 'production' && (!envEmail || !envPassword)) {
      this.logger.warn('No platform admin exists. Set PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD to create one.');
      return;
    }
    const email = (envEmail ?? DEV_ADMIN.email).toLowerCase();
    await this.db.global
      .insert(platformAdmins)
      .values({ email, name: 'Super Admin', role: 'super_admin', passwordHash: await hashPassword(envPassword ?? DEV_ADMIN.password) })
      .onConflictDoNothing();
    this.logger.log(`Created platform super admin ${email}`);
  }

  async login(email: string, password: string, ip?: string): Promise<PlatformLoginResponse> {
    this.limiter.hit(`login:${ip ?? 'unknown'}`);
    const [admin] = await this.db.global
      .select()
      .from(platformAdmins)
      .where(sql`lower(${platformAdmins.email}) = ${email.toLowerCase()}`)
      .limit(1);
    if (!admin || admin.status !== 'active') throw invalid();
    if (admin.lockedUntil && new Date(admin.lockedUntil) > new Date()) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'account_locked', `Too many wrong attempts. Try again in ${LOCK_MINUTES} minutes.`);
    }
    if (!(await verifyPassword(password, admin.passwordHash))) {
      const failed = admin.failedLoginCount + 1;
      await this.db.global
        .update(platformAdmins)
        .set({
          failedLoginCount: failed >= MAX_FAILED ? 0 : failed,
          lockedUntil: failed >= MAX_FAILED ? sql`now() + make_interval(mins => ${LOCK_MINUTES})` : null,
        })
        .where(eq(platformAdmins.id, admin.id));
      throw invalid();
    }
    const [updated] = await this.db.global
      .update(platformAdmins)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` })
      .where(eq(platformAdmins.id, admin.id))
      .returning();
    const [session] = await this.db.global
      .insert(platformAdminSessions)
      .values({ adminId: admin.id, createdIp: ip, expiresAt: sql`now() + make_interval(hours => ${SESSION_HOURS})` as unknown as string })
      .returning({ id: platformAdminSessions.id });
    const claims: PlatformAccessTokenClaims = { sub: admin.id, sid: session!.id, typ: 'platform', role: admin.role as PlatformAdminRole };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: `${SESSION_HOURS}h` });
    return { accessToken, expiresIn: SESSION_HOURS * 3600, admin: toAdmin(updated!) };
  }

  async verify(token: string): Promise<PlatformPrincipal> {
    let claims: PlatformAccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<PlatformAccessTokenClaims>(token);
    } catch {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'unauthorized', 'Access token is invalid or expired');
    }
    if (claims.typ !== 'platform') throw ended();
    const res = await this.db.global.execute<{ id: string; name: string; email: string; role: PlatformAdminRole }>(sql`
      select a.id, a.name, a.email, a.role
        from platform.admin_sessions s join platform.admins a on a.id = s.admin_id
       where s.id = ${claims.sid}::uuid and a.id = ${claims.sub}::uuid
         and s.revoked_at is null and s.expires_at > now() and a.status = 'active'`);
    const row = res.rows[0];
    if (!row) throw ended();
    return { ...row, sessionId: claims.sid };
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.global.update(platformAdminSessions).set({ revokedAt: sql`now()` }).where(eq(platformAdminSessions.id, sessionId));
  }

  /** End every session of an admin (disabled or password changed). */
  async revokeAll(adminId: string): Promise<void> {
    await this.db.global
      .update(platformAdminSessions)
      .set({ revokedAt: sql`now()` })
      .where(sql`${platformAdminSessions.adminId} = ${adminId} and ${platformAdminSessions.revokedAt} is null`);
  }
}
