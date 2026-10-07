import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntitlementsService } from '../src/modules/platform/entitlements.service';
import { EntitlementGuard, ENTITLEMENT } from '../src/modules/platform/entitlement.guard';
import { SignupService } from '../src/modules/platform/signup.service';
import { AdminAuthService } from '../src/modules/platform/admin-auth.service';
import { bearer, bootApp, login } from './helpers';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

let app: NestFastifyApplication;
let pg: Client;
let superToken: string;
let demoAdmin: string;
let reception: string;
let doctor: string;
let cityAdmin: string;

const SUPER = { email: process.env.PLATFORM_ADMIN_EMAIL ?? 'super@hms.local', password: process.env.PLATFORM_ADMIN_PASSWORD ?? 'Super@12345' };
const uniq = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function signupBody(code: string, extra: Record<string, unknown> = {}) {
  return {
    hospitalName: `Test Hospital ${code}`,
    code,
    adminName: 'Asha Admin',
    email: `admin@${code}.test`,
    mobile: '9876500000',
    password: 'Welcome@123',
    planCode: 'starter',
    acceptTerms: true,
    ...extra,
  };
}

async function signup(code = uniq()) {
  app.get(SignupService).limiter.reset();
  const res = await app.inject({ method: 'POST', url: '/api/v1/platform/signup', payload: signupBody(code) });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const staff = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { tenantCode: code, identifier: `admin@${code}.test`, password: 'Welcome@123', client: 'mobile' },
  });
  return { ...res.json(), code, token: staff.json().accessToken as string, loginStatus: staff.statusCode };
}

const admin = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object, token = superToken) =>
  app.inject({ method, url: `/api/v1/platform/admin${url}`, headers: bearer(token), payload });

beforeAll(async () => {
  app = await bootApp();
  pg = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await pg.connect();
  app.get(AdminAuthService).limiter.reset();
  const res = await app.inject({ method: 'POST', url: '/api/v1/platform/admin/auth/login', payload: SUPER });
  if (res.statusCode !== 200) throw new Error(`super admin login failed: ${res.body}`);
  superToken = res.json().accessToken;
  demoAdmin = (await login(app, 'admin@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
});
afterAll(async () => {
  await pg.end();
  await app.close();
});

describe('signup', () => {
  it('lists public plans without login', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/platform/plans' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { code: string }) => p.code)).toEqual(['starter', 'growth', 'enterprise']);
  });

  it('creates a hospital on a trial and its admin can sign in', async () => {
    const h = await signup();
    expect(h.planCode).toBe('starter');
    expect(new Date(h.trialEndsAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
    expect(h.loginStatus).toBe(200);

    const sub = await app.inject({ method: 'GET', url: '/api/v1/platform/subscription', headers: bearer(h.token) });
    expect(sub.statusCode).toBe(200);
    const body = sub.json();
    expect(body.tenant.status).toBe('trial');
    expect(body.subscription.status).toBe('trial');
    expect(body.trialDaysLeft).toBe(14);
    expect(body.usage).toEqual({ users: 1, facilities: 1 });
    expect(body.entitlements.modules).toContain('emr');
    expect(body.entitlements.modules).not.toContain('lab');
  });

  it('rejects taken, reserved and invalid codes', async () => {
    app.get(SignupService).limiter.reset();
    const taken = await app.inject({ method: 'POST', url: '/api/v1/platform/signup', payload: signupBody('city') });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('code_taken');
    const reserved = await app.inject({ method: 'POST', url: '/api/v1/platform/signup', payload: signupBody('admin') });
    expect(reserved.json().error.code).toBe('code_reserved');
    const check = await app.inject({ method: 'GET', url: '/api/v1/platform/signup/code-availability?code=demo' });
    expect(check.json()).toMatchObject({ available: false });
    const free = await app.inject({ method: 'GET', url: `/api/v1/platform/signup/code-availability?code=${uniq()}` });
    expect(free.json().available).toBe(true);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/platform/signup', payload: { ...signupBody(uniq()), acceptTerms: false } });
    expect(bad.statusCode).toBe(400);
  });

  it('never lets a signup add a user to an existing hospital', async () => {
    const before = await pg.query(`select count(*)::int as n from iam.users u join platform.tenants t on t.id = u.tenant_id where t.code = 'demo'`);
    app.get(SignupService).limiter.reset();
    await app.inject({ method: 'POST', url: '/api/v1/platform/signup', payload: signupBody('demo', { email: 'evil@x.test' }) });
    const after = await pg.query(`select count(*)::int as n from iam.users u join platform.tenants t on t.id = u.tenant_id where t.code = 'demo'`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('subscription', () => {
  it('checkout and sandbox payment make the subscription active with 18% GST', async () => {
    const h = await signup();
    const inv = await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/checkout', headers: bearer(h.token) });
    expect(inv.statusCode).toBe(200);
    expect(inv.json()).toMatchObject({ amount: '2499.00', taxAmount: '449.82', total: '2948.82', status: 'issued' });
    // Paying during the trial keeps the trial days: the paid period starts when the trial ends.
    expect(new Date(inv.json().periodStart).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);

    const again = await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/checkout', headers: bearer(h.token) });
    expect(again.json().id).toBe(inv.json().id);

    const paid = await app.inject({ method: 'POST', url: `/api/v1/platform/subscription/invoices/${inv.json().id}/pay`, headers: bearer(h.token), payload: {} });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().subscription.status).toBe('active');
    expect(paid.json().tenant.status).toBe('active');
    expect(paid.json().invoices[0]).toMatchObject({ status: 'paid', paymentMode: 'sandbox' });

    const twice = await app.inject({ method: 'POST', url: `/api/v1/platform/subscription/invoices/${inv.json().id}/pay`, headers: bearer(h.token), payload: {} });
    expect(twice.statusCode).toBe(409);
  });

  it('upgrades a paid hospital to Growth with a new invoice and new modules', async () => {
    const h = await signup();
    const inv = (await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/checkout', headers: bearer(h.token) })).json();
    await app.inject({ method: 'POST', url: `/api/v1/platform/subscription/invoices/${inv.id}/pay`, headers: bearer(h.token), payload: {} });

    const up = await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/change', headers: bearer(h.token), payload: { planCode: 'growth', billingCycle: 'yearly' } });
    expect(up.statusCode).toBe(200);
    const body = up.json();
    expect(body.plan.code).toBe('growth');
    expect(body.subscription).toMatchObject({ status: 'active', billingCycle: 'yearly' });
    expect(body.invoices[0]).toMatchObject({ status: 'issued', amount: '249990.00', planCode: 'growth' });
    expect(body.entitlements.modules).toContain('lab');

    const ent = await app.inject({ method: 'GET', url: '/api/v1/platform/entitlements', headers: bearer(h.token) });
    expect(ent.json()).toMatchObject({ planCode: 'growth', limits: { users: 75, facilities: 2 } });

    const enterprise = await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/change', headers: bearer(h.token), payload: { planCode: 'enterprise' } });
    expect(enterprise.json().error.code).toBe('contact_sales');
  });

  it('enforces permissions: a doctor cannot see or change the plan', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/v1/platform/subscription', headers: bearer(doctor) });
    expect(read.statusCode).toBe(403);
    const change = await app.inject({ method: 'POST', url: '/api/v1/platform/subscription/change', headers: bearer(doctor), payload: { planCode: 'growth' } });
    expect(change.statusCode).toBe(403);
    const ent = await app.inject({ method: 'GET', url: '/api/v1/platform/entitlements', headers: bearer(doctor) });
    expect(ent.statusCode).toBe(200);
  });
});

describe('entitlements and limits', () => {
  it('the guard blocks a module the plan does not include, and overrides change it', async () => {
    const h = await signup();
    const guard = app.get(EntitlementGuard);
    const ctxFor = (key: string) =>
      ({
        getHandler: () => Object.assign(() => undefined, {}),
        getClass: () => class {},
        switchToHttp: () => ({ getRequest: () => ({ ctx: { tenantId: h.tenantId } }) }),
        key,
      }) as never;
    // The guard reads the module key from route metadata; feed it directly instead of mounting a route.
    const reflector = (guard as unknown as { reflector: { getAllAndOverride: (k: string) => unknown } }).reflector;
    const original = reflector.getAllAndOverride;
    const check = async (moduleKey: string) => {
      reflector.getAllAndOverride = (k: string) => (k === ENTITLEMENT ? moduleKey : undefined);
      try {
        return await guard.canActivate(ctxFor(moduleKey));
      } finally {
        reflector.getAllAndOverride = original;
      }
    };
    await expect(check('lab')).rejects.toMatchObject({ response: { code: 'plan_upgrade_required' } });
    await expect(check('emr')).resolves.toBe(true);

    const set = await admin('PUT', `/tenants/${h.tenantId}/entitlements`, { modules: { lab: true, emr: false }, limits: { users: 1 }, note: 'pilot' });
    expect(set.statusCode).toBe(200);
    expect(set.json().entitlements.modules).toContain('lab');
    expect(set.json().entitlements.modules).not.toContain('emr');
    await expect(check('lab')).resolves.toBe(true);
    await expect(check('emr')).rejects.toMatchObject({ response: { code: 'plan_upgrade_required' } });
    await expect(app.get(EntitlementsService).assertWithinLimit('users', { tenantId: h.tenantId })).rejects.toMatchObject({
      response: { code: 'plan_limit_reached' },
    });
    // null resets to the plan default.
    const reset = await admin('PUT', `/tenants/${h.tenantId}/entitlements`, { modules: { lab: null, emr: null }, limits: { users: null } });
    expect(reset.json().entitlements).toMatchObject({ limits: { users: 5 } });
    expect(reset.json().entitlements.modules).not.toContain('lab');
  });
});

describe('support tickets', () => {
  it('flows between hospital staff and the platform team, isolated per hospital', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/tickets',
      headers: bearer(reception),
      payload: { subject: 'Printer shows blank bill', body: 'Bill BL0001 prints blank on the thermal printer.', priority: 'high' },
    });
    expect(created.statusCode).toBe(201);
    const t = created.json();
    expect(t.number).toMatch(/^TKT-\d{6}$/);
    expect(t.messages).toHaveLength(1);

    // Another hospital cannot see it.
    const other = await app.inject({ method: 'GET', url: `/api/v1/platform/tickets/${t.id}`, headers: bearer(cityAdmin) });
    expect(other.statusCode).toBe(404);
    const otherList = await app.inject({ method: 'GET', url: '/api/v1/platform/tickets', headers: bearer(cityAdmin) });
    expect(otherList.json().items.find((x: { id: string }) => x.id === t.id)).toBeUndefined();
    // A doctor in the same hospital sees only their own tickets.
    const doc = await app.inject({ method: 'GET', url: `/api/v1/platform/tickets/${t.id}`, headers: bearer(doctor) });
    expect(doc.statusCode).toBe(404);
    // The hospital admin sees all of the hospital's tickets.
    const adm = await app.inject({ method: 'GET', url: `/api/v1/platform/tickets/${t.id}`, headers: bearer(demoAdmin) });
    expect(adm.statusCode).toBe(200);

    const list = await admin('GET', '/tickets?status=open');
    expect(list.json().items.find((x: { id: string }) => x.id === t.id)).toMatchObject({ tenantName: expect.any(String) });
    await admin('POST', `/tickets/${t.id}/messages`, { body: 'Checking with the print team', isInternal: true });
    const reply = await admin('POST', `/tickets/${t.id}/messages`, { body: 'Please update the printer driver.' });
    expect(reply.json().status).toBe('waiting_on_customer');
    expect(reply.json().messages).toHaveLength(3);

    const seen = await app.inject({ method: 'GET', url: `/api/v1/platform/tickets/${t.id}`, headers: bearer(reception) });
    expect(seen.json().messages.map((m: { authorType: string }) => m.authorType)).toEqual(['staff', 'platform']);
    const resolved = await app.inject({ method: 'POST', url: `/api/v1/platform/tickets/${t.id}/resolve`, headers: bearer(reception) });
    expect(resolved.json().status).toBe('resolved');
  });
});

describe('super-admin console', () => {
  it('keeps staff and platform tokens apart', async () => {
    expect((await admin('GET', '/dashboard', undefined, demoAdmin)).statusCode).toBe(401);
    const pat = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: bearer(superToken) });
    expect(pat.statusCode).toBe(401);
    expect((await admin('GET', '/dashboard')).statusCode).toBe(200);
  });

  it('support staff cannot change plans or money', async () => {
    const email = `${uniq()}@support.test`;
    const created = await admin('POST', '/admins', { email, name: 'Support Sam', role: 'support', password: 'Support@123' });
    expect(created.statusCode).toBe(201);
    const s = await app.inject({ method: 'POST', url: '/api/v1/platform/admin/auth/login', payload: { email, password: 'Support@123' } });
    const token = s.json().accessToken;
    expect((await admin('GET', '/tenants', undefined, token)).statusCode).toBe(200);
    expect((await admin('POST', '/plans', { code: 'x-plan', name: 'X' }, token)).statusCode).toBe(403);
    // Disabling ends the session.
    await admin('PATCH', `/admins/${created.json().id}`, { status: 'disabled' });
    expect((await admin('GET', '/tenants', undefined, token)).statusCode).toBe(401);
  });

  it('suspends a hospital (sign-in stops) and reactivates it', async () => {
    const h = await signup();
    const sus = await admin('POST', `/tenants/${h.tenantId}/status`, { status: 'suspended', reason: 'Fraud check' });
    expect(sus.json().status).toBe('suspended');
    const staffCall = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(h.token) });
    expect(staffCall.statusCode).toBe(401);
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { tenantCode: h.code, identifier: `admin@${h.code}.test`, password: 'Welcome@123', client: 'mobile' },
    });
    expect(loginRes.statusCode).toBe(401);
    const back = await admin('POST', `/tenants/${h.tenantId}/status`, { status: 'active', reason: 'Cleared' });
    expect(back.json().status).toBe('active');
    const audit = await admin('GET', `/audit?tenantId=${h.tenantId}`);
    expect(audit.json().items.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['tenant.suspended', 'tenant.active']));
  });

  it('runs the trial → grace → suspended → paid lifecycle', async () => {
    const h = await signup();
    await pg.query(`update platform.subscriptions set trial_ends_at = now() - interval '1 day' where tenant_id = $1 and ended_at is null`, [h.tenantId]);
    const run1 = await admin('POST', '/lifecycle/run');
    expect(run1.statusCode).toBe(200);
    let d = (await admin('GET', `/tenants/${h.tenantId}`)).json();
    expect(d.status).toBe('grace');
    expect(d.subscription.status).toBe('past_due');
    expect(d.invoices[0].status).toBe('issued');
    // Grace still lets staff in.
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(h.token) })).statusCode).toBe(200);

    await pg.query(`update platform.invoices set due_at = now() - interval '8 days' where tenant_id = $1 and status = 'issued'`, [h.tenantId]);
    await admin('POST', '/lifecycle/run');
    d = (await admin('GET', `/tenants/${h.tenantId}`)).json();
    expect(d.status).toBe('suspended');

    const paid = await admin('POST', `/invoices/${d.invoices[0].id}/mark-paid`, { mode: 'bank_transfer', ref: 'NEFT123' });
    expect(paid.json()).toMatchObject({ status: 'paid', paymentMode: 'bank_transfer' });
    d = (await admin('GET', `/tenants/${h.tenantId}`)).json();
    expect(d.status).toBe('active');
    expect(d.subscription.status).toBe('active');
  });

  it('extends a trial and sets a custom enterprise price', async () => {
    const h = await signup();
    const trialEnd = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const ext = await admin('PUT', `/tenants/${h.tenantId}/subscription`, { planCode: 'starter', trialEndsAt: trialEnd });
    expect(ext.json().subscription).toMatchObject({ status: 'trial', trialEndsAt: trialEnd });
    const ent = await admin('PUT', `/tenants/${h.tenantId}/subscription`, { planCode: 'enterprise', billingCycle: 'yearly', price: '600000', activateNow: true });
    expect(ent.json()).toMatchObject({ planCode: 'enterprise', status: 'active', subscription: { status: 'active', price: '600000.00' } });
    const dash = await admin('GET', '/dashboard');
    expect(Number(dash.json().mrr)).toBeGreaterThanOrEqual(50000);
  });
});

describe('announcements, help and onboarding', () => {
  it('shows announcements by plan and hides dismissed ones', async () => {
    const all = (await admin('POST', '/announcements', { title: 'Maintenance tonight', body: 'Down 2-3 AM', severity: 'warning' })).json();
    const growthOnly = (await admin('POST', '/announcements', { title: 'Lab module launched', body: 'For Growth', planCodes: ['growth'] })).json();
    // City is on Starter (demo is seeded on Growth).
    const seen = await app.inject({ method: 'GET', url: '/api/v1/platform/announcements', headers: bearer(cityAdmin) });
    const ids = seen.json().map((a: { id: string }) => a.id);
    expect(ids).toContain(all.id);
    expect(ids).not.toContain(growthOnly.id);
    const demoSees = await app.inject({ method: 'GET', url: '/api/v1/platform/announcements', headers: bearer(reception) });
    expect(demoSees.json().map((a: { id: string }) => a.id)).toContain(growthOnly.id);
    const d = await app.inject({ method: 'POST', url: `/api/v1/platform/announcements/${all.id}/dismiss`, headers: bearer(cityAdmin) });
    expect(d.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/v1/platform/announcements', headers: bearer(cityAdmin) });
    expect(after.json().map((a: { id: string }) => a.id)).not.toContain(all.id);
    await admin('PATCH', `/announcements/${all.id}`, { isPublished: false });
    await admin('PATCH', `/announcements/${growthOnly.id}`, { isPublished: false });
  });

  it('serves help articles and the onboarding checklist', async () => {
    const help = await app.inject({ method: 'GET', url: '/api/v1/platform/help?q=trial', headers: bearer(doctor) });
    expect(help.json().map((a: { slug: string }) => a.slug)).toContain('trial-and-plans');
    const one = await app.inject({ method: 'GET', url: '/api/v1/platform/help/getting-started', headers: bearer(doctor) });
    expect(one.json().title).toBe('Getting started with HMS');

    const h = await signup();
    const list = await app.inject({ method: 'GET', url: '/api/v1/platform/onboarding', headers: bearer(h.token) });
    expect(list.json()).toMatchObject({ done: 0, total: 6 });
    const tick = await app.inject({ method: 'POST', url: '/api/v1/platform/onboarding/hospital_profile', headers: bearer(h.token) });
    expect(tick.json().done).toBe(1);
    const auto = await app.inject({ method: 'POST', url: '/api/v1/platform/onboarding/add_staff', headers: bearer(h.token) });
    expect(auto.json().error.code).toBe('auto_step');
    const untick = await app.inject({ method: 'DELETE', url: '/api/v1/platform/onboarding/hospital_profile', headers: bearer(h.token) });
    expect(untick.json().done).toBe(0);
  });
});
