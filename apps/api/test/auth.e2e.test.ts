import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, bootApp, DEMO, login } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => (app = await bootApp()));
afterAll(() => app.close());

describe('auth', () => {
  it('logs in and returns the user with roles and permissions', async () => {
    const s = await login(app, 'admin@demo.hms');
    expect(s.user.permissions).toContain('core.patient.create');
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(s.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ tenantCode: 'demo', roles: ['hospital_admin'] });
    expect(me.json().facilities.length).toBeGreaterThan(0);
  });

  it('logs in with mobile number too', async () => {
    const s = await login(app, '9000000002');
    expect(s.accessToken).toBeTruthy();
  });

  it('rejects a wrong password and an unknown hospital with the same error', async () => {
    for (const payload of [
      { tenantCode: 'demo', identifier: 'nurse@demo.hms', password: 'wrong-password' },
      { tenantCode: 'nope', identifier: 'admin@demo.hms', password: DEMO.password },
    ]) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('invalid_credentials');
    }
  });

  it('explains missing or malformed login fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantCode: '', identifier: '', password: '' } });
    expect(res.statusCode).toBe(400);
    const msg = res.json().error.message;
    expect(msg).toContain('Enter your hospital code');
    expect(msg).toContain('Enter your email or mobile number');
    expect(msg).toContain('Enter your password');
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantCode: 'de mo!', identifier: 'admin@demo.hms', password: 'x' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('Hospital code has only letters, digits and -');
  });

  it('accepts a mobile number typed with +91 or spaces', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantCode: 'Demo', identifier: '+91 90000 00002', password: DEMO.password, client: 'mobile' } });
    expect(res.statusCode).toBe(200);
  });

  it('web login sets an httpOnly refresh cookie and keeps the token out of the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantCode: 'demo', identifier: 'admin@demo.hms', password: DEMO.password, client: 'web' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().refreshToken).toBeUndefined();
    const cookie = res.cookies.find((c) => c.name === 'hms_rt');
    expect(cookie?.httpOnly).toBe(true);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { client: 'web' },
      cookies: { hms_rt: cookie!.value },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeTruthy();
  });

  it('rotates refresh tokens and ends the session when an old token is replayed later', async () => {
    const s = await login(app, 'billing@demo.hms');
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: s.refreshToken, client: 'mobile' } });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refreshToken as string;
    expect(next).not.toBe(s.refreshToken);

    // Simulate the replay happening after the grace window by ageing the revoked token.
    const { DbService } = await import('../src/common/db/db.service');
    const db = app.get(DbService);
    const [tenantId, tokenId] = s.refreshToken.split('.');
    await db.asTenant({ tenantId }, (tx) =>
      tx.execute(`update iam.refresh_tokens set revoked_at = now() - interval '1 hour' where id = '${tokenId}'` as never),
    );
    const replay = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: s.refreshToken, client: 'mobile' } });
    expect(replay.statusCode).toBe(401);
    // The whole session is now dead: the newest token and the access token stop working.
    const after = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: next, client: 'mobile' } });
    expect(after.statusCode).toBe(401);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(s.accessToken) });
    expect(me.statusCode).toBe(401);
  });

  it('logout revokes the session immediately', async () => {
    const s = await login(app, 'pharmacy@demo.hms');
    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', payload: { refreshToken: s.refreshToken } });
    expect(out.statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(s.accessToken) });
    expect(me.statusCode).toBe(401);
  });

  it('rejects requests without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/patients' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('unauthorized');
  });
});
