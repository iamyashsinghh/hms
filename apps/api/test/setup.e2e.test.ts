import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { config } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, provisionTenant, syncSystemRoles, upsertUser } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { SetupService } from '../src/modules/setup/setup.service';
import { bearer, bootApp, login } from './helpers';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

let app: NestFastifyApplication;
let admin: string;
let adminId: string;
let tenantId: string;
let reception: string;
let demoReception: string;
let cityAdmin: string;
const run = Date.now().toString(36).toUpperCase().slice(-6);
/** Setup tests change facilities, roles and the profile, so they run in their own throwaway hospital, not the shared demo one. */
const HOSPITAL = `setup-${run.toLowerCase()}`;

/** A small hospital on the starter plan (1 facility, 5 users) for the plan-limit checks. */
const STARTER = `setup-s-${run.toLowerCase()}`;

async function provisionTestHospitals() {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const t = await provisionTenant(client, {
      code: HOSPITAL,
      name: `Setup Test Hospital ${run}`,
      plan: 'enterprise',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Setup Admin', email: `admin@${HOSPITAL}.test`, password: DEMO_PASSWORD },
    });
    await upsertUser(client, t.tenantId, { name: 'Setup Reception', email: `reception@${HOSPITAL}.test`, password: DEMO_PASSWORD, roleKeys: ['receptionist'] });
    await upsertUser(client, t.tenantId, { name: 'Dr. Seeded', email: `doctor@${HOSPITAL}.test`, password: DEMO_PASSWORD, roleKeys: ['doctor'] });
    const s = await provisionTenant(client, {
      code: STARTER,
      name: `Setup Starter Hospital ${run}`,
      plan: 'starter',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Starter Admin', email: `admin@${STARTER}.test`, password: DEMO_PASSWORD },
    });
    for (let i = 1; i <= 4; i++) {
      await upsertUser(client, s.tenantId, { name: `Starter Staff ${i}`, email: `staff${i}@${STARTER}.test`, password: DEMO_PASSWORD, roleKeys: ['receptionist'] });
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

type Json = Record<string, unknown> | unknown[];
async function call(token: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: Json) {
  const res = await app.inject({ method, url: `/api/v1${url}`, headers: bearer(token), payload });
  return { status: res.statusCode, body: res.body ? res.json() : undefined };
}

async function loginWith(identifier: string, password: string, tenantCode = HOSPITAL) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { tenantCode, identifier, password, client: 'mobile' } });
}

async function roleId(token: string, key: string): Promise<string> {
  const res = await call(token, 'GET', '/setup/roles');
  return (res.body as { id: string; key: string }[]).find((r) => r.key === key)!.id;
}

beforeAll(async () => {
  await provisionTestHospitals();
  app = await bootApp();
  const a = await login(app, `admin@${HOSPITAL}.test`, HOSPITAL);
  admin = a.accessToken;
  adminId = a.user.id;
  tenantId = (a.user as unknown as { tenantId: string }).tenantId;
  reception = (await login(app, `reception@${HOSPITAL}.test`, HOSPITAL)).accessToken;
  demoReception = (await login(app, 'reception@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
});
afterAll(() => app.close());

describe('hospital profile and wizard', () => {
  it('saves the profile with GSTIN and reports wizard progress', async () => {
    const bad = await call(admin, 'PUT', '/setup/profile', { legalName: 'Setup Test Pvt Ltd', displayName: 'Setup Test', gstin: 'NOT-A-GSTIN' });
    expect(bad.status).toBe(400);

    const res = await call(admin, 'PUT', '/setup/profile', {
      legalName: 'Setup Test Hospital Pvt Ltd',
      displayName: 'Setup Test Hospital',
      gstin: '27AAPFU0939F1ZV',
      address: { city: 'Pune', state: 'Maharashtra', pincode: '411001' },
      letterhead: { tagline: 'Care you can trust' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ gstin: '27AAPFU0939F1ZV', timezone: 'Asia/Kolkata' });

    const wizard = await call(admin, 'GET', '/setup/wizard');
    expect(wizard.status).toBe(200);
    const steps = (wizard.body as { steps: { key: string; done: boolean }[] }).steps;
    expect(steps.find((s) => s.key === 'profile')?.done).toBe(true);
    expect(steps.find((s) => s.key === 'facilities')?.done).toBe(true);
  });

  it('lets other staff read the profile but not change it', async () => {
    expect((await call(reception, 'GET', '/setup/profile')).status).toBe(200);
    const res = await call(reception, 'PUT', '/setup/profile', { legalName: 'Hacked', displayName: 'Hacked' });
    expect(res.status).toBe(403);
  });
});

describe('facilities, departments, specializations', () => {
  it('creates a facility and rejects a duplicate code', async () => {
    const created = await call(admin, 'POST', '/setup/facilities', { code: `BR${run}`, name: `Branch ${run}`, type: 'clinic' });
    expect(created.status).toBe(201);
    const dup = await call(admin, 'POST', '/setup/facilities', { code: `br${run}`, name: 'Again' });
    expect(dup.status).toBe(409);
    const list = await call(reception, 'GET', '/setup/facilities');
    expect((list.body as { code: string }[]).map((f) => f.code)).toContain(`BR${run}`);
    const off = await call(admin, 'PATCH', `/setup/facilities/${(created.body as { id: string }).id}`, { isActive: false });
    expect(off.status).toBe(200);
    const after = await call(reception, 'GET', '/setup/facilities');
    expect((after.body as { code: string }[]).map((f) => f.code)).not.toContain(`BR${run}`);
  });

  it('will not deactivate the last active facility', async () => {
    const list = (await call(admin, 'GET', '/setup/facilities')).body as { id: string }[];
    expect(list).toHaveLength(1);
    const res = await call(admin, 'PATCH', `/setup/facilities/${list[0]!.id}`, { isActive: false });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('last_facility');
  });

  it('renames a department and keeps fields a partial edit leaves out', async () => {
    const d = (await call(admin, 'POST', '/setup/departments', { code: `RN${run}`, name: 'Radio', type: 'diagnostic' })).body as { id: string };
    const off = await call(admin, 'PATCH', `/setup/departments/${d.id}`, { isActive: false });
    expect(off.body).toMatchObject({ isActive: false, type: 'diagnostic', name: 'Radio' });
    const renamed = await call(admin, 'PATCH', `/setup/departments/${d.id}`, { name: 'Radiology' });
    expect(renamed.body).toMatchObject({ isActive: false, type: 'diagnostic', name: 'Radiology' });
    expect((await call(reception, 'PATCH', `/setup/departments/${d.id}`, { name: 'Nope' })).status).toBe(403);
  });

  it('creates departments and specializations', async () => {
    const dept = await call(admin, 'POST', '/setup/departments', { code: `GM${run}`, name: 'General Medicine' });
    expect(dept.status).toBe(201);
    const spec = await call(admin, 'POST', '/setup/specializations', { code: `CARD${run}`, name: 'Cardiology' });
    expect(spec.status).toBe(201);
    const depts = await call(reception, 'GET', '/setup/departments');
    expect((depts.body as { id: string }[]).map((d) => d.id)).toContain((dept.body as { id: string }).id);
    expect((await call(reception, 'POST', '/setup/departments', { code: 'X1', name: 'Nope' })).status).toBe(403);
  });
});

describe('users, doctors, schedules', () => {
  let doctorId: string;
  let departmentId: string;
  let facilityId: string;
  let tempPassword: string;
  const email = `dr.${run.toLowerCase()}@${HOSPITAL}.test`;

  beforeAll(async () => {
    departmentId = ((await call(admin, 'POST', '/setup/departments', { code: `ORTH${run}`, name: 'Orthopaedics' })).body as { id: string }).id;
    facilityId = ((await call(admin, 'GET', '/setup/facilities')).body as { id: string; code: string }[]).find((f) => f.code === 'MAIN')!.id;
  });

  it('creates a doctor with a staff profile and a one-time temporary password', async () => {
    const res = await call(admin, 'POST', '/setup/users', {
      name: `Dr. Test ${run}`,
      email,
      roles: [{ roleId: await roleId(admin, 'doctor') }],
      staffProfile: { staffType: 'doctor', departmentId, qualification: 'MS Ortho', registrationNo: `MMC-${run}`, consultationFee: 500, followUpFee: 250, followUpDays: 7 },
    });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; temporaryPassword: string; roles: { roleKey: string }[] };
    expect(body.temporaryPassword).toMatch(/^[A-Za-z]{6}\d{4}$/);
    // Login details go out by email through Notifications (only email was given).
    const delivery = (res.body as { delivery: { channel: string; status: string }[] }).delivery;
    expect(delivery.map((d) => d.channel)).toEqual(['email']);
    expect(body.roles.map((r) => r.roleKey)).toEqual(['doctor']);
    doctorId = body.id;
    tempPassword = body.temporaryPassword;

    const signIn = await loginWith(email, tempPassword);
    expect(signIn.statusCode).toBe(200);
  });

  it('rejects a second user with the same email', async () => {
    const res = await call(admin, 'POST', '/setup/users', { name: 'Copy', email: email.toUpperCase(), roles: [{ roleId: await roleId(admin, 'nurse') }] });
    expect(res.status).toBe(409);
  });

  it('lists doctors per the cross-module contract', async () => {
    const all = (await call(reception, 'GET', '/setup/doctors')).body as { userId: string; name: string; consultationFee?: number; departmentId: string | null }[];
    const mine = all.find((d) => d.userId === doctorId);
    expect(mine).toMatchObject({ departmentId, consultationFee: 500, specialization: null, registrationNo: `MMC-${run}`, signatureUrl: null });
    // A doctor with the doctor role but no profile yet is still listed.
    expect(all.some((d) => d.name === 'Dr. Seeded')).toBe(true);
    const demo = (await call(demoReception, 'GET', '/setup/doctors')).body as { name: string }[];
    expect(demo.some((d) => d.name === 'Dr. Asha Rao')).toBe(true);

    const byDept = (await call(reception, 'GET', `/setup/doctors?departmentId=${departmentId}`)).body as { userId: string }[];
    expect(byDept.map((d) => d.userId)).toEqual([doctorId]);
  });

  it('saves a weekly schedule, rejects overlaps and produces IST slots', async () => {
    const overlap = await call(admin, 'PUT', `/setup/doctors/${doctorId}/schedule`, {
      blocks: [
        { facilityId, weekday: 1, startTime: '10:00', endTime: '12:00' },
        { facilityId, weekday: 1, startTime: '11:30', endTime: '13:00' },
      ],
    });
    expect(overlap.status).toBe(400);

    const saved = await call(admin, 'PUT', `/setup/doctors/${doctorId}/schedule`, {
      blocks: [
        { facilityId, weekday: 1, startTime: '10:00', endTime: '11:00', slotMinutes: 15 },
        { facilityId, weekday: 1, startTime: '17:00', endTime: '18:00', slotMinutes: 30 },
        { facilityId, weekday: 3, startTime: '09:00', endTime: '10:00', slotMinutes: 20 },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toHaveLength(3);

    // 2030-01-07 is a Monday. 10:00 IST = 04:30 UTC.
    const slots = (await call(reception, 'GET', `/setup/doctors/${doctorId}/slots?date=2030-01-07`)).body as { start: string; end: string }[];
    expect(slots).toHaveLength(6);
    expect(slots[0]).toMatchObject({ start: '2030-01-07T04:30:00.000Z', end: '2030-01-07T04:45:00.000Z' });
    expect(slots[5]).toMatchObject({ start: '2030-01-07T12:00:00.000Z' });

    const tuesday = (await call(reception, 'GET', `/setup/doctors/${doctorId}/slots?date=2030-01-08`)).body as unknown[];
    expect(tuesday).toEqual([]);

    expect((await call(reception, 'PUT', `/setup/doctors/${doctorId}/schedule`, { blocks: [] })).status).toBe(403);

    // Front office uses hasScheduleInTx to tell "no timings yet" from "day off".
    const setupService = app.get(SetupService);
    const db = app.get(DbService);
    const seeded = ((await call(admin, 'GET', '/setup/doctors')).body as { userId: string; name: string }[]).find((d) => d.name === 'Dr. Seeded')!;
    await db.asTenant({ tenantId }, async (tx) => {
      expect(await setupService.hasScheduleInTx(tx, doctorId)).toBe(true);
      expect(await setupService.hasScheduleInTx(tx, doctorId, facilityId)).toBe(true);
      expect(await setupService.hasScheduleInTx(tx, seeded.userId)).toBe(false);
    });
  });

  it('returns no slots on a leave day, and slots again after the leave is removed', async () => {
    const leave = await call(admin, 'POST', `/setup/doctors/${doctorId}/leaves`, { fromDate: '2030-01-07', toDate: '2030-01-07', reason: 'Conference' });
    expect(leave.status).toBe(201);
    expect((await call(reception, 'GET', `/setup/doctors/${doctorId}/slots?date=2030-01-07`)).body).toEqual([]);
    const del = await call(admin, 'DELETE', `/setup/doctors/${doctorId}/leaves/${(leave.body as { id: string }).id}`);
    expect(del.status).toBe(204);
    expect((await call(reception, 'GET', `/setup/doctors/${doctorId}/slots?date=2030-01-07`)).body).toHaveLength(6);
  });

  it('resets a password and deactivates a user, which ends their sessions', async () => {
    const reset = await call(admin, 'POST', `/setup/users/${doctorId}/reset-password`, {});
    expect(reset.status).toBe(200);
    const newPassword = (reset.body as { temporaryPassword: string }).temporaryPassword;
    expect((reset.body as { delivery: { channel: string }[] }).delivery.map((d) => d.channel)).toEqual(['email']);
    expect((await loginWith(email, tempPassword)).statusCode).toBe(401);
    const signIn = await loginWith(email, newPassword);
    expect(signIn.statusCode).toBe(200);
    const doctorToken = signIn.json().accessToken as string;

    const off = await call(admin, 'POST', `/setup/users/${doctorId}/deactivate`);
    expect(off.status).toBe(200);
    expect((off.body as { status: string }).status).toBe('disabled');
    expect((await call(doctorToken, 'GET', '/setup/doctors')).status).toBe(401);
    expect((await loginWith(email, newPassword)).statusCode).toBe(401);
    const doctors = (await call(reception, 'GET', '/setup/doctors')).body as { userId: string }[];
    expect(doctors.map((d) => d.userId)).not.toContain(doctorId);

    expect((await call(admin, 'POST', `/setup/users/${doctorId}/activate`)).status).toBe(200);
  });

  it('protects the last hospital admin and your own account', async () => {
    expect((await call(admin, 'POST', `/setup/users/${adminId}/deactivate`)).status).toBe(400);
    const res = await call(admin, 'PUT', `/setup/users/${adminId}/roles`, { roles: [{ roleId: await roleId(admin, 'doctor') }] });
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('last_admin');
  });

  it('only admins manage users', async () => {
    expect((await call(reception, 'GET', '/setup/users')).status).toBe(403);
    expect((await call(reception, 'POST', '/setup/users', { name: 'X', email: 'x@demo.hms', roles: [] })).status).toBe(403);
  });
});

describe('roles', () => {
  it('creates a custom role whose permissions are enforced, and protects system roles', async () => {
    const role = await call(admin, 'POST', '/setup/roles', { name: `Front Desk Lead ${run}`, permissions: ['setup.department.read', 'core.patient.read'] });
    expect(role.status).toBe(201);
    const r = role.body as { id: string; key: string; permissions: string[] };
    expect(r.key).toMatch(/^front_desk_lead_/);
    expect(r.permissions).toEqual(['core.patient.read', 'setup.department.read']);

    const unknown = await call(admin, 'POST', '/setup/roles', { name: 'Bad', permissions: ['setup.nothing.here'] });
    expect(unknown.status).toBe(400);

    const mobile = `7${String(Date.now()).slice(-9)}`;
    const user = await call(admin, 'POST', '/setup/users', { name: 'Lead User', mobile, password: 'Lead@1234', roles: [{ roleId: r.id }] });
    expect(user.status).toBe(201);
    const token = (await loginWith(mobile, 'Lead@1234')).json().accessToken as string;
    expect((await call(token, 'GET', '/setup/departments')).status).toBe(200);
    expect((await call(token, 'POST', '/setup/departments', { code: 'NOPE', name: 'Nope' })).status).toBe(403);

    // Adding a permission to the role takes effect on the next request.
    expect((await call(admin, 'PATCH', `/setup/roles/${r.id}`, { permissions: [...r.permissions, 'setup.department.manage'] })).status).toBe(200);
    expect((await call(token, 'POST', '/setup/departments', { code: `LD${run}`, name: 'Lead dept' })).status).toBe(201);

    expect((await call(admin, 'DELETE', `/setup/roles/${r.id}`)).status).toBe(409);
    const systemRole = await roleId(admin, 'doctor');
    expect((await call(admin, 'PATCH', `/setup/roles/${systemRole}`, { name: 'Changed' })).status).toBe(403);
    expect((await call(admin, 'DELETE', `/setup/roles/${systemRole}`)).status).toBe(403);
  });

  it("edits a system role's permissions but not its name, and keeps Hospital Admin locked", async () => {
    const nurseId = await roleId(admin, 'nurse');
    const before = (await call(admin, 'GET', '/setup/roles')).body as { id: string; permissions: string[] }[];
    const nurse = before.find((r) => r.id === nurseId)!;
    const dropped = nurse.permissions[0]!;
    const kept = nurse.permissions.filter((p) => p !== dropped);
    const res = await call(admin, 'PATCH', `/setup/roles/${nurseId}`, { permissions: [...kept, 'setup.department.read'] });
    expect(res.status).toBe(200);
    expect((res.body as { permissions: string[] }).permissions).toEqual(expect.arrayContaining(['setup.department.read']));
    expect((res.body as { permissions: string[] }).permissions).not.toContain(dropped);
    expect((await call(admin, 'PATCH', `/setup/roles/${nurseId}`, { name: 'Nurse', permissions: kept })).status).toBe(200);
    expect((await call(admin, 'PATCH', `/setup/roles/${nurseId}`, { name: 'Senior Nurse' })).status).toBe(403);
    expect((await call(admin, 'PATCH', `/setup/roles/${await roleId(admin, 'hospital_admin')}`, { permissions: [] })).status).toBe(403);
    expect((await call(reception, 'PATCH', `/setup/roles/${nurseId}`, { permissions: kept })).status).toBe(403);

    // A deploy's role sync does not undo the hospital's edit, but still grants permissions new to the catalog.
    const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await syncSystemRoles(client, tenantId, [dropped]);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
    const after = ((await call(admin, 'GET', '/setup/roles')).body as { id: string; permissions: string[] }[]).find((r) => r.id === nurseId)!;
    expect(after.permissions).toContain(dropped);

    await call(admin, 'PATCH', `/setup/roles/${nurseId}`, { permissions: kept });
    const client2 = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
    await client2.connect();
    try {
      await client2.query('BEGIN');
      await client2.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await syncSystemRoles(client2, tenantId, []);
      await client2.query('COMMIT');
    } finally {
      await client2.end();
    }
    const final = ((await call(admin, 'GET', '/setup/roles')).body as { id: string; permissions: string[] }[]).find((r) => r.id === nurseId)!;
    expect(final.permissions).not.toContain(dropped);
  });

  it('renames a custom role and rejects a duplicate name', async () => {
    const a = (await call(admin, 'POST', '/setup/roles', { name: `Rename A ${run}`, permissions: ['core.patient.read'] })).body as { id: string };
    await call(admin, 'POST', '/setup/roles', { name: `Rename B ${run}`, permissions: ['core.patient.read'] });
    const ok = await call(admin, 'PATCH', `/setup/roles/${a.id}`, { name: `Renamed A ${run}` });
    expect(ok.status).toBe(200);
    expect((ok.body as { name: string }).name).toBe(`Renamed A ${run}`);
    expect((await call(admin, 'PATCH', `/setup/roles/${a.id}`, { name: `rename b ${run}` })).status).toBe(409);
  });

  it('lists the permission catalog', async () => {
    const res = await call(admin, 'GET', '/setup/permissions');
    expect((res.body as { key: string }[]).map((p) => p.key)).toEqual(expect.arrayContaining(['core.user.manage', 'setup.schedule.manage']));
  });
});

describe('number series and print templates', () => {
  it('changes a prefix and never moves the counter backwards', async () => {
    const key = `test.series_${run.toLowerCase()}`;
    const res = await call(admin, 'PUT', `/setup/number-series/${key}`, { prefix: 'T/', width: 4, nextValue: 50 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ preview: 'T/0050', nextValue: 50 });
    const back = await call(admin, 'PUT', `/setup/number-series/${key}`, { prefix: 'T/', width: 4, nextValue: 10 });
    expect(back.status).toBe(400);
    const list = (await call(admin, 'GET', '/setup/number-series')).body as { key: string }[];
    expect(list.map((s) => s.key)).toEqual(expect.arrayContaining(['uhid', 'billing.invoice', key]));
  });

  it('falls back from facility to hospital to default templates', async () => {
    const def = (await call(reception, 'GET', '/setup/print-templates/receipt')).body as { saved: boolean; paperSize: string };
    expect(def.paperSize).toBe('thermal_80mm');
    const saved = await call(admin, 'PUT', '/setup/print-templates/invoice', { paperSize: 'A5', footerText: `Thank you ${run}` });
    expect(saved.status).toBe(200);
    const facilityId = ((await call(admin, 'GET', '/setup/facilities')).body as { id: string; code: string }[]).find((f) => f.code === 'MAIN')!.id;
    const viaFacility = (await call(reception, 'GET', `/setup/print-templates/invoice?facilityId=${facilityId}`)).body as { footerText: string };
    expect(viaFacility.footerText).toBe(`Thank you ${run}`);
    expect((await call(admin, 'PUT', '/setup/print-templates/nonsense', {})).status).toBe(400);
  });
});

describe('plan limits', () => {
  it('stops new users and facilities once a starter hospital is full, and frees a seat on deactivation', async () => {
    const starter = (await login(app, `admin@${STARTER}.test`, STARTER)).accessToken;
    const recId = await roleId(starter, 'receptionist');
    const newUser = (n: string) => ({ name: `Starter Extra ${n}`, email: `extra${n}@${STARTER}.test`, roles: [{ roleId: recId }] });

    const full = await call(starter, 'POST', '/setup/users', newUser('1'));
    expect(full.status).toBe(403);
    expect((full.body as { error: { code: string } }).error.code).toBe('plan_limit_reached');

    const fac = await call(starter, 'POST', '/setup/facilities', { code: 'SAT', name: 'Satellite', type: 'clinic' });
    expect(fac.status).toBe(403);
    expect((fac.body as { error: { code: string } }).error.code).toBe('plan_limit_reached');

    const users = (await call(starter, 'GET', '/setup/users?q=staff1')).body as { items: { id: string }[] };
    const staff1 = users.items[0]!.id;
    expect((await call(starter, 'POST', `/setup/users/${staff1}/deactivate`)).status).toBe(200);
    const added = await call(starter, 'POST', '/setup/users', newUser('2'));
    expect(added.status).toBe(201);

    const back = await call(starter, 'POST', `/setup/users/${staff1}/activate`);
    expect(back.status).toBe(403);
    expect((back.body as { error: { code: string } }).error.code).toBe('plan_limit_reached');
  });
});

describe('cross-hospital isolation', () => {
  it("never shows or changes another hospital's setup data", async () => {
    const demoDept = ((await call(admin, 'GET', '/setup/departments')).body as { id: string }[])[0]!;
    const demoUsers = ((await call(admin, 'GET', '/setup/users')).body as { items: { id: string; email: string | null }[] }).items;
    const demoDoctor = demoUsers.find((u) => u.email === `doctor@${HOSPITAL}.test`)!;
    const demoRole = await roleId(admin, 'nurse');

    expect((await call(cityAdmin, 'PATCH', `/setup/departments/${demoDept.id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await call(cityAdmin, 'GET', `/setup/users/${demoDoctor.id}`)).status).toBe(404);
    expect((await call(cityAdmin, 'PATCH', `/setup/users/${demoDoctor.id}`, { name: 'Hacked' })).status).toBe(404);
    expect((await call(cityAdmin, 'POST', `/setup/users/${demoDoctor.id}/reset-password`, {})).status).toBe(404);
    expect((await call(cityAdmin, 'GET', `/setup/staff/${demoDoctor.id}`)).status).toBe(404);
    expect((await call(cityAdmin, 'GET', `/setup/doctors/${demoDoctor.id}/schedule`)).status).toBe(404);
    expect((await call(cityAdmin, 'GET', `/setup/doctors/${demoDoctor.id}/slots?date=2030-01-07`)).body).toEqual([]);

    const cityDepts = (await call(cityAdmin, 'GET', '/setup/departments')).body as { id: string }[];
    expect(cityDepts.find((d) => d.id === demoDept.id)).toBeUndefined();
    const cityUsers = ((await call(cityAdmin, 'GET', '/setup/users')).body as { items: { id: string }[] }).items;
    expect(cityUsers.find((u) => u.id === demoDoctor.id)).toBeUndefined();
    const cityDoctors = (await call(cityAdmin, 'GET', '/setup/doctors')).body as { userId: string }[];
    expect(cityDoctors.find((d) => d.userId === demoDoctor.id)).toBeUndefined();

    // A role id from another hospital cannot be assigned.
    const res = await call(cityAdmin, 'POST', '/setup/users', { name: 'Sneaky', email: `sneaky.${run.toLowerCase()}@city.hms`, roles: [{ roleId: demoRole }] });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('invalid_role');

    const cityProfile = (await call(cityAdmin, 'GET', '/setup/profile')).body as { gstin: string | null; displayName: string };
    expect(cityProfile.gstin).toBeNull();
    expect(cityProfile.displayName).toBe('City Care Clinic');
  });
});
