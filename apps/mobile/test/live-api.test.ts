// Mobile sign-in and data-layer checks against a real API, whatever modules it has.
// Opt-in: MOBILE_LIVE_API=http://localhost:4000/api/v1 pnpm test (needs a migrated + seeded database).
// The full OPD flow is in live-flow.test.ts.
import { ApiError, createApiClient } from '@hms/api-client';
import { describe, expect, it } from 'vitest';
import { FeatureUnavailableError, createMobileData, isMissingRoute } from '@/data/client';
import { isoDate } from '@/data/dates';

const BASE = process.env.MOBILE_LIVE_API;

async function signIn(tenantCode: string, identifier: string) {
  let token: string | null = null;
  const api = createApiClient({ baseUrl: BASE!, getAccessToken: () => token });
  const res = await api.auth.login({ tenantCode, identifier, password: 'Demo@12345', client: 'mobile', deviceName: 'vitest' });
  token = res.accessToken;
  return { api, res };
}

describe.runIf(BASE)('live API', () => {
  it('doctor signs in as a mobile client and gets a rotating refresh token', async () => {
    const { api, res } = await signIn('demo', 'doctor@demo.hms');
    expect(res.refreshToken).toBeTruthy();
    expect(res.user.roles).toContain('doctor');
    expect(res.user.permissions).toContain('core.patient.read');
    const next = await api.auth.refresh({ refreshToken: res.refreshToken, client: 'mobile' });
    expect(next.refreshToken).toBeTruthy();
    expect(next.refreshToken).not.toBe(res.refreshToken);
  });

  it('doctor queue and timeline load (real data, or demo data from real patients when a module is missing)', async () => {
    const { api, res } = await signIn('demo', 'doctor@demo.hms');
    const data = createMobileData(api.http, { demoFallback: true });
    const queue = await data.doctorQueue(isoDate(), res.user.id);
    expect(Array.isArray(queue.data)).toBe(true);
    const p = (await api.patients.list({ pageSize: 1 })).items[0];
    if (!p) return;
    expect((await data.patient(p.id)).data.id).toBe(p.id);
    expect(Array.isArray((await data.timeline(p.id)).data)).toBe(true);
  });

  it('release builds never show demo data: a missing module is FeatureUnavailableError, a forbidden one is 403', async () => {
    const { api, res } = await signIn('demo', 'doctor@demo.hms');
    const data = createMobileData(api.http, { demoFallback: false });
    for (const call of [() => data.doctorQueue(isoDate(), res.user.id), () => data.ownerSummary(isoDate())]) {
      const out = await call().catch((e: unknown) => e);
      if (out instanceof Error) {
        expect(out instanceof FeatureUnavailableError || (out instanceof ApiError && out.status === 403)).toBe(true);
      } else {
        expect(out).toMatchObject({ demo: false });
      }
    }
  });

  it("another hospital's staff cannot open this hospital's patient", async () => {
    const demo = await signIn('demo', 'doctor@demo.hms');
    const p = (await demo.api.patients.list({ pageSize: 1 })).items[0];
    if (!p) return;
    const city = await signIn('city', 'admin@city.hms');
    const err = await createMobileData(city.api.http, { demoFallback: true })
      .patient(p.id)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect(isMissingRoute(err)).toBe(false);
  });
});
