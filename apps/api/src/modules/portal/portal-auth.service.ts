import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { eq, sql, tenants, type Tx } from '@hms/db';
import type { portal } from '@hms/shared';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DbService } from '../../common/db/db.service';
import { AppError, badRequest } from '../../common/errors/errors';
import { OTP_SENDER, type OtpSender } from './otp.sender';
import { PortalRepository } from './portal.repository';
import { PortalPatientsService } from './portal-patients.service';

const OTP_TTL_SECONDS = 5 * 60;
const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per mobile per window. */
const OTP_MAX_PER_WINDOW = 5;
const OTP_WINDOW_MINUTES = 15;
/** A just-rotated refresh token still works this long (two tabs refreshing at once). */
const ROTATION_GRACE_SECONDS = 30;

const invalidSession = () => new AppError(HttpStatus.UNAUTHORIZED, 'invalid_refresh_token', 'Please sign in again');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface IssuedPatientTokens extends portal.PatientTokens {
  refreshToken: string;
}

@Injectable()
export class PortalAuthService {
  constructor(
    private readonly db: DbService,
    private readonly repo: PortalRepository,
    private readonly jwt: JwtService,
    private readonly patients: PortalPatientsService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Public hospital lookup for the portal landing page. */
  async hospital(code: string): Promise<portal.PortalHospital> {
    const tenant = await this.activeTenant(code);
    if (!tenant) throw new AppError(HttpStatus.NOT_FOUND, 'hospital_not_found', 'No hospital with this code');
    const facilities = await this.patients.facilities(tenant.id);
    return { code: tenant.code, name: tenant.name, facilities };
  }

  async requestOtp(input: { tenantCode: string; mobile: string }, ip?: string): Promise<portal.OtpRequestResponse> {
    const tenant = await this.activeTenant(input.tenantCode);
    if (!tenant) throw new AppError(HttpStatus.NOT_FOUND, 'hospital_not_found', 'No hospital with this code');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');

    const challenge = await this.db.asTenant({ tenantId: tenant.id }, async (tx) => {
      const recent = await this.repo.countRecentChallenges(tx, input.mobile, OTP_WINDOW_MINUTES);
      if (recent >= OTP_MAX_PER_WINDOW) return null;
      return this.repo.insertChallenge(tx, {
        tenantId: tenant.id,
        mobile: input.mobile,
        codeHash: this.hashCode(tenant.id, input.mobile, code),
        expiresAt: sql`now() + make_interval(secs => ${OTP_TTL_SECONDS})` as unknown as string,
        createdIp: ip,
      });
    });
    if (!challenge) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'otp_rate_limited', `Too many codes requested. Try again in ${OTP_WINDOW_MINUTES} minutes.`);
    }
    await this.sender.send({ tenantId: tenant.id, mobile: input.mobile, code, hospitalName: tenant.name });
    const echo = this.sender.isMock && this.config.NODE_ENV !== 'production';
    return { challengeId: challenge.id, expiresIn: OTP_TTL_SECONDS, ...(echo ? { devCode: code } : {}) };
  }

  async verifyOtp(
    input: { tenantCode: string; mobile: string; otp: string; client: 'web' | 'mobile'; deviceName?: string },
    ip?: string,
  ): Promise<IssuedPatientTokens & { me: portal.PortalMe }> {
    const tenant = await this.activeTenant(input.tenantCode);
    if (!tenant) throw badRequest('invalid_otp', 'The code is incorrect or has expired');

    const outcome = await this.db.asTenant({ tenantId: tenant.id }, async (tx) => {
      const ch = await this.repo.latestOpenChallenge(tx, input.mobile);
      if (!ch || new Date(ch.expiresAt) <= new Date()) return { ok: false as const, code: 'otp_expired' };
      if (ch.attempts >= OTP_MAX_ATTEMPTS) return { ok: false as const, code: 'otp_locked' };
      const expected = Buffer.from(ch.codeHash, 'hex');
      const given = Buffer.from(this.hashCode(tenant.id, input.mobile, input.otp), 'hex');
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
        await this.repo.updateChallenge(tx, ch.id, { attempts: ch.attempts + 1 });
        return { ok: false as const, code: ch.attempts + 1 >= OTP_MAX_ATTEMPTS ? 'otp_locked' : 'invalid_otp' };
      }
      await this.repo.updateChallenge(tx, ch.id, { consumedAt: sql`now()` as unknown as string });
      const account = await this.repo.upsertAccountOnLogin(tx, tenant.id, input.mobile);
      if (account.status !== 'active') return { ok: false as const, code: 'account_blocked' };
      const session = await this.createSession(tx, tenant.id, account.id, input.client, input.deviceName, ip);
      return { ok: true as const, accountId: account.id, session };
    });

    if (!outcome.ok) {
      const messages: Record<string, string> = {
        otp_expired: 'The code has expired. Request a new one.',
        otp_locked: 'Too many wrong attempts. Request a new code.',
        invalid_otp: 'The code is incorrect',
        account_blocked: 'This account is blocked. Please contact the hospital.',
      };
      throw badRequest(outcome.code, messages[outcome.code] ?? 'The code is incorrect');
    }

    await this.patients.linkByMobile(tenant.id, outcome.accountId, input.mobile);
    const tokens = await this.signAccess(tenant.id, outcome.accountId, outcome.session.id);
    const me = await this.patients.me(tenant.id, outcome.accountId);
    return { ...tokens, refreshToken: outcome.session.token, me };
  }

  /** Rotate a refresh token. An old token presented after the grace window ends the session (likely stolen). */
  async refresh(raw: string, ip?: string): Promise<IssuedPatientTokens> {
    const parsed = parseRefreshToken(raw);
    if (!parsed) throw invalidSession();
    const { tenantId, sessionId, secret } = parsed;
    const result = await this.db.asTenant({ tenantId }, async (tx) => {
      const s = await this.repo.findSession(tx, sessionId);
      if (!s || s.revokedAt || new Date(s.expiresAt) <= new Date()) return null;
      const hash = sha256(secret);
      const current = hash === s.tokenHash;
      const inGrace =
        !current &&
        hash === s.previousTokenHash &&
        s.rotatedAt !== null &&
        Date.now() - new Date(s.rotatedAt).getTime() < ROTATION_GRACE_SECONDS * 1000;
      if (!current && !inGrace) {
        if (hash === s.previousTokenHash) await this.repo.updateSession(tx, s.id, { revokedAt: sql`now()` as unknown as string });
        return null;
      }
      const account = await this.repo.findAccount(tx, s.accountId);
      if (account?.status !== 'active') return null;
      const next = randomBytes(32).toString('base64url');
      await this.repo.updateSession(tx, s.id, {
        tokenHash: sha256(next),
        previousTokenHash: current ? s.tokenHash : s.previousTokenHash,
        rotatedAt: sql`now()` as unknown as string,
        createdIp: ip ?? s.createdIp,
      });
      return { accountId: s.accountId, token: `${tenantId}.${s.id}.${next}` };
    });
    if (!result) throw invalidSession();
    if (!(await this.activeTenantById(tenantId))) throw invalidSession();
    const tokens = await this.signAccess(tenantId, result.accountId, sessionId);
    return { ...tokens, refreshToken: result.token };
  }

  async logout(raw: string | undefined): Promise<void> {
    const parsed = raw ? parseRefreshToken(raw) : null;
    if (!parsed) return;
    await this.db.asTenant({ tenantId: parsed.tenantId }, async (tx) => {
      const s = await this.repo.findSession(tx, parsed.sessionId);
      const hash = sha256(parsed.secret);
      if (!s || (hash !== s.tokenHash && hash !== s.previousTokenHash)) return;
      await this.repo.updateSession(tx, s.id, { revokedAt: sql`now()` as unknown as string });
    });
  }

  private async createSession(
    tx: Tx,
    tenantId: string,
    accountId: string,
    client: 'web' | 'mobile',
    deviceName?: string,
    ip?: string,
  ) {
    const secret = randomBytes(32).toString('base64url');
    const row = await this.repo.insertSession(tx, {
      tenantId,
      accountId,
      tokenHash: sha256(secret),
      client,
      deviceName,
      createdIp: ip,
      expiresAt: sql`now() + make_interval(days => ${this.config.JWT_REFRESH_TTL_DAYS})` as unknown as string,
    });
    return { id: row.id, token: `${tenantId}.${row.id}.${secret}` };
  }

  private async signAccess(tenantId: string, accountId: string, sessionId: string): Promise<portal.PatientTokens> {
    const claims: portal.PatientTokenClaims = { sub: accountId, tid: tenantId, sid: sessionId, typ: 'patient' };
    const accessToken = await this.jwt.signAsync(claims);
    const { exp, iat } = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return { accessToken, expiresIn: exp - iat };
  }

  /** Code hash is keyed with the server secret so a database leak doesn't reveal codes. */
  private hashCode(tenantId: string, mobile: string, code: string): string {
    return createHmac('sha256', this.config.JWT_ACCESS_SECRET).update(`portal-otp:${tenantId}:${mobile}:${code}`).digest('hex');
  }

  private async activeTenant(code: string) {
    const [t] = await this.db.db.select().from(tenants).where(eq(tenants.code, code.toLowerCase())).limit(1);
    return t && ['trial', 'active', 'grace'].includes(t.status) ? t : undefined;
  }

  private async activeTenantById(id: string) {
    const [t] = await this.db.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return t && ['trial', 'active', 'grace'].includes(t.status) ? t : undefined;
  }
}

/** Patient refresh tokens look like `<tenantId>.<sessionId>.<secret>`. */
function parseRefreshToken(raw: string): { tenantId: string; sessionId: string; secret: string } | null {
  const [tenantId, sessionId, secret, extra] = raw.split('.');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (extra !== undefined || !tenantId || !sessionId || !secret || !uuid.test(tenantId) || !uuid.test(sessionId)) return null;
  return { tenantId, sessionId, secret };
}
