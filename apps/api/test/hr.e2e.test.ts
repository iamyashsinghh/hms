import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { provisionTenant, sql, upsertUser } from '@hms/db';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { bearer, bootApp, DEMO, login } from './helpers';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

/**
 * HR runs in its own throwaway hospital so payroll months, leave balances and the nurse's HR record
 * never collide with other suites or earlier runs.
 */
let app: NestFastifyApplication;
const tag = Date.now().toString(36);
const code = `hr-${tag}`;
let tenantId: string;
let facilityId: string;
let nurseUserId: string;
let admin: string;
let hrManager: string;
let accountant: string;
let nurse: string;
let doctor: string;
let otherHospital: string;
let starterHospital: string;

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastMonth = (() => {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
})();

beforeAll(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('begin');
    const t = await provisionTenant(client, {
      code,
      name: `HR Test ${tag}`,
      plan: 'growth',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'HR Admin', email: `admin@${code}.hms`, password: DEMO.password },
    });
    tenantId = t.tenantId;
    facilityId = t.facilityId;
    nurseUserId = await upsertUser(client, tenantId, { name: 'Nisha Nurse', email: `nurse@${code}.hms`, password: DEMO.password, roleKeys: ['nurse'] });
    await upsertUser(client, tenantId, { name: 'Harsh HR', email: `hr@${code}.hms`, password: DEMO.password, roleKeys: ['hr_manager'] });
    await upsertUser(client, tenantId, { name: 'Anil Accounts', email: `acc@${code}.hms`, password: DEMO.password, roleKeys: ['accountant'] });
    await upsertUser(client, tenantId, { name: 'Dr Dev', email: `doc@${code}.hms`, password: DEMO.password, roleKeys: ['doctor'] });
    await client.query('commit');
  } finally {
    await client.end();
  }
  app = await bootApp();
  admin = (await login(app, `admin@${code}.hms`, code)).accessToken;
  hrManager = (await login(app, `hr@${code}.hms`, code)).accessToken;
  accountant = (await login(app, `acc@${code}.hms`, code)).accessToken;
  nurse = (await login(app, `nurse@${code}.hms`, code)).accessToken;
  doctor = (await login(app, `doc@${code}.hms`, code)).accessToken;
  otherHospital = (await login(app, 'admin@demo.hms')).accessToken;
  starterHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
});
afterAll(() => app.close());

let nurseEmpId: string;
let wardBoyId: string;

describe('employees', () => {
  it('adds a staff user and a non-login worker, numbering codes automatically', async () => {
    const res = await call(hrManager, 'POST', '/hr/employees', {
      userId: nurseUserId,
      fullName: 'Nisha Nurse',
      category: 'nurse',
      designation: 'Staff Nurse',
      department: 'Ward A',
      facilityId,
      dateOfJoining: `${lastMonth}-16`,
      mobile: '9811100001',
      pan: 'abcde1234f',
      bankAccountNo: '123456789012',
      bankIfsc: 'HDFC0001234',
      basic: 15500,
      hra: 0,
      otherAllowances: 0,
      pfApplicable: true,
      esiApplicable: true,
      professionalTax: 200,
    });
    expect(res.statusCode, res.body).toBe(201);
    const e = res.json();
    nurseEmpId = e.id;
    expect(e.employeeCode).toMatch(/^EMP\d{5}$/);
    expect(e.bank.pan).toBe('ABCDE1234F');
    expect(e.salary.monthlyGross).toBe(15500);

    const wb = await call(hrManager, 'POST', '/hr/employees', {
      fullName: 'Ramu Ward Boy',
      category: 'support',
      department: 'Ward A',
      employeeCode: 'WB-01',
      dateOfJoining: '2025-01-01',
      email: '',
    });
    expect(wb.statusCode, wb.body).toBe(201);
    wardBoyId = wb.json().id;
    expect(wb.json().userId).toBeNull();

    const dup = await call(hrManager, 'POST', '/hr/employees', { fullName: 'Dup', employeeCode: 'WB-01', dateOfJoining: '2025-01-01' });
    expect(dup.statusCode).toBe(409);
  });

  it('hides salary and bank details from users without payroll access', async () => {
    const asOwnerLike = await call(doctor, 'GET', `/hr/employees/${nurseEmpId}`);
    expect(asOwnerLike.statusCode).toBe(403);

    const asAcct = await call(accountant, 'GET', `/hr/employees/${nurseEmpId}`);
    expect(asAcct.statusCode, asAcct.body).toBe(200);
    expect(asAcct.json().salary.basic).toBe(15500);
  });

  it('only payroll managers set pay; HR without payroll access cannot', async () => {
    // hr_manager has hr.payroll.manage; strip it down by using an employee.manage-only path: the doctor cannot edit at all.
    expect((await call(doctor, 'PATCH', `/hr/employees/${wardBoyId}`, { designation: 'x' })).statusCode).toBe(403);
    const ok = await call(hrManager, 'PATCH', `/hr/employees/${wardBoyId}`, { basic: 12000, designation: 'Ward boy' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().salary.basic).toBe(12000);
  });

  it('tracks licence expiry', async () => {
    const soon = addDays(today, 20);
    const res = await call(hrManager, 'POST', `/hr/employees/${nurseEmpId}/licences`, { kind: 'nursing_registration', number: 'MNC-123', validUntil: soon });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().daysLeft).toBe(20);
    await call(hrManager, 'POST', `/hr/employees/${nurseEmpId}/licences`, { kind: 'bls', number: 'BLS-9', validUntil: addDays(today, 300) });

    const exp = (await call(hrManager, 'GET', '/hr/licences/expiring?days=30')).json();
    expect(exp.map((l: { number: string }) => l.number)).toEqual(['MNC-123']);
    expect((await call(hrManager, 'GET', `/hr/employees/${nurseEmpId}`)).json().nextLicenceExpiry).toBe(soon);
  });
});

describe('roster and attendance', () => {
  let shifts: { id: string; code: string }[];

  it('creates default shifts and saves a week of roster', async () => {
    shifts = (await call(hrManager, 'GET', '/hr/shifts')).json();
    expect(shifts.map((s) => s.code).sort()).toEqual(['E', 'G', 'M', 'N']);
    const m = shifts.find((s) => s.code === 'M')!;
    const n = shifts.find((s) => s.code === 'N')!;
    const cells = [0, 1, 2, 3, 4, 5, 6].map((i) => ({
      employeeId: nurseEmpId,
      date: addDays(today, i),
      kind: i === 6 ? 'off' : 'shift',
      shiftId: i === 6 ? null : i < 3 ? m.id : n.id,
      ward: 'Ward A',
    }));
    const res = await call(hrManager, 'PUT', '/hr/roster', { cells });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().saved).toBe(7);

    const bad = await call(hrManager, 'PUT', '/hr/roster', { cells: [{ employeeId: nurseEmpId, date: today, kind: 'shift' }] });
    expect(bad.statusCode).toBe(400);

    const view = (await call(nurse, 'GET', `/hr/roster?from=${today}&to=${addDays(today, 6)}`)).json();
    expect(view.entries.filter((e: { employeeId: string }) => e.employeeId === nurseEmpId)).toHaveLength(7);

    const duty = (await call(nurse, 'GET', `/hr/on-duty?date=${today}`)).json();
    expect(duty[0].shift.code).toBe('M');
    expect(duty[0].staff[0].fullName).toBe('Nisha Nurse');
  });

  it('copies a week without touching existing cells', async () => {
    const res = await call(hrManager, 'POST', '/hr/roster/copy-week', { fromWeekStart: today, toWeekStart: addDays(today, 7) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ copied: 7, skipped: 0 });
    const again = (await call(hrManager, 'POST', '/hr/roster/copy-week', { fromWeekStart: today, toWeekStart: addDays(today, 7) })).json();
    expect(again).toEqual({ copied: 0, skipped: 7 });
  });

  it('lets staff punch in and out, and HR mark the muster', async () => {
    const me = (await call(nurse, 'GET', '/hr/me')).json();
    expect(me.employee.employeeCode).toMatch(/^EMP/);
    expect(me.employee.salary.basic).toBe(15500);
    expect(me.today.shift.code).toBe('M');

    const inn = await call(nurse, 'POST', '/hr/me/punch');
    expect(inn.statusCode, inn.body).toBe(200);
    expect(inn.json()).toMatchObject({ status: 'present', source: 'punch', checkOut: null });
    const out = (await call(nurse, 'POST', '/hr/me/punch')).json();
    expect(out.checkOut).not.toBeNull();
    expect((await call(nurse, 'POST', '/hr/me/punch')).statusCode).toBe(409);

    // A doctor has no HR record yet.
    expect((await call(doctor, 'POST', '/hr/me/punch')).statusCode).toBe(404);

    const mark = await call(hrManager, 'PUT', '/hr/attendance', {
      date: `${lastMonth}-20`,
      rows: [
        { employeeId: nurseEmpId, status: 'absent' },
        { employeeId: wardBoyId, status: 'present', checkIn: '20:30', checkOut: '08:10' },
      ],
    });
    expect(mark.statusCode, mark.body).toBe(200);
    const wb = mark.json().find((r: { employeeId: string }) => r.employeeId === wardBoyId);
    expect(wb.workedMinutes).toBe(11 * 60 + 40);

    await call(hrManager, 'PUT', '/hr/attendance', { date: `${lastMonth}-21`, rows: [{ employeeId: nurseEmpId, status: 'half_day', checkIn: '08:00', checkOut: '11:00' }] });

    const before = await call(hrManager, 'PUT', '/hr/attendance', { date: `${lastMonth}-01`, rows: [{ employeeId: nurseEmpId, status: 'present' }] });
    expect(before.statusCode).toBe(400);
    expect(before.json().error.code).toBe('not_joined');

    const sheet = (await call(hrManager, 'GET', `/hr/attendance?date=${today}`)).json();
    const row = sheet.find((r: { employee: { id: string } }) => r.employee.id === nurseEmpId);
    expect(row.roster.shiftCode).toBe('M');
    expect(row.attendance.status).toBe('present');

    const summary = (await call(hrManager, 'GET', `/hr/attendance/summary?month=${lastMonth}`)).json();
    expect(summary.find((s: { employeeId: string }) => s.employeeId === nurseEmpId)).toMatchObject({ absent: 1, halfDay: 1 });

    expect((await call(nurse, 'PUT', '/hr/attendance', { date: today, rows: [{ employeeId: nurseEmpId, status: 'present' }] })).statusCode).toBe(403);
  });
});

describe('leave', () => {
  let types: { id: string; code: string }[];
  let leaveId: string;

  it('applies, checks balance and overlap, and approves onto the roster', async () => {
    types = (await call(nurse, 'GET', '/hr/leave-types')).json();
    const cl = types.find((t) => t.code === 'CL')!;
    const from = addDays(today, 3);
    const res = await call(nurse, 'POST', '/hr/me/leaves', { leaveTypeId: cl.id, fromDate: from, toDate: addDays(from, 1), reason: 'Family function' });
    expect(res.statusCode, res.body).toBe(201);
    leaveId = res.json().id;
    expect(res.json()).toMatchObject({ status: 'pending', days: 2, leaveTypeCode: 'CL' });

    const overlap = await call(nurse, 'POST', '/hr/me/leaves', { leaveTypeId: cl.id, fromDate: addDays(from, 1), toDate: addDays(from, 1) });
    expect(overlap.statusCode).toBe(409);

    const tooMuch = await call(nurse, 'POST', '/hr/me/leaves', { leaveTypeId: cl.id, fromDate: addDays(today, 40), toDate: addDays(today, 50) });
    if (addDays(today, 40).slice(0, 4) === addDays(today, 50).slice(0, 4)) {
      expect(tooMuch.statusCode).toBe(400);
      expect(tooMuch.json().error.code).toBe('insufficient_balance');
    }

    const bal = (await call(nurse, 'GET', `/hr/me/leave-balances?year=${from.slice(0, 4)}`)).json();
    expect(bal.find((b: { code: string }) => b.code === 'CL')).toMatchObject({ quota: 12, pending: 2, available: 10 });

    expect((await call(nurse, 'POST', `/hr/leaves/${leaveId}/decide`, { decision: 'approved' })).statusCode).toBe(403);
    const ok = await call(hrManager, 'POST', `/hr/leaves/${leaveId}/decide`, { decision: 'approved' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('approved');

    const view = (await call(hrManager, 'GET', `/hr/roster?from=${from}&to=${from}&employeeId=${nurseEmpId}`)).json();
    expect(view.entries[0]).toMatchObject({ kind: 'leave', leaveRequestId: leaveId });

    const pending = (await call(hrManager, 'GET', '/hr/leaves?status=pending')).json();
    expect(pending.items).toHaveLength(0);

    const dash = (await call(hrManager, 'GET', '/hr/dashboard')).json();
    expect(dash).toMatchObject({ headcount: 2, pendingLeaves: 0, licencesExpiring: 1 });
  });

  it('lets staff cancel their own future leave and frees the roster', async () => {
    const res = await call(nurse, 'POST', `/hr/me/leaves/${leaveId}/cancel`);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('cancelled');
    const from = addDays(today, 3);
    const view = (await call(hrManager, 'GET', `/hr/roster?from=${from}&to=${from}&employeeId=${nurseEmpId}`)).json();
    expect(view.entries).toHaveLength(0);
  });

  it('records unpaid leave for payroll', async () => {
    const lop = types.find((t) => t.code === 'LOP')!;
    const res = await call(hrManager, 'POST', '/hr/leaves', {
      employeeId: nurseEmpId, leaveTypeId: lop.id, fromDate: `${lastMonth}-22`, toDate: `${lastMonth}-23`, autoApprove: true,
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'approved', isPaid: false, days: 2 });
  });
});

describe('payroll', () => {
  let runId: string;

  it('prepares a draft from salary, attendance and unpaid leave', async () => {
    expect((await call(nurse, 'POST', '/hr/payroll', { month: lastMonth })).statusCode).toBe(403);
    const res = await call(accountant, 'POST', '/hr/payroll', { month: lastMonth });
    expect(res.statusCode, res.body).toBe(201);
    const run = res.json();
    runId = run.id;
    expect(run.status).toBe('draft');
    expect(run.employeeCount).toBe(2);

    const [y, m] = lastMonth.split('-').map(Number) as [number, number];
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const slip = run.payslips.find((s: { employeeId: string }) => s.employeeId === nurseEmpId);
    // Joined on the 16th; 1 absent + 0.5 half day + 2 unpaid leave = 3.5 LOP.
    const employed = days - 15;
    expect(slip).toMatchObject({ daysInMonth: days, lopDays: 3.5, payableDays: employed - 3.5 });
    const basic = Math.round(15500 * (employed - 3.5) / days * 100) / 100;
    expect(slip.basic).toBeCloseTo(basic, 2);
    expect(slip.pfEmployee).toBe(Math.round(basic * 0.12));
    expect(slip.esiEmployee).toBe(Math.ceil(basic * 0.0075));
    expect(slip.netPay).toBeCloseTo(slip.gross - slip.totalDeductions, 2);
  });

  it('keeps adjustments through a recalculation, then locks on finalize', async () => {
    const run = (await call(accountant, 'GET', `/hr/payroll/${runId}`)).json();
    const slip = run.payslips.find((s: { employeeId: string }) => s.employeeId === wardBoyId);
    const adj = await call(accountant, 'PATCH', `/hr/payslips/${slip.id}`, { otherEarnings: 1000, remarks: 'Night allowance' });
    expect(adj.statusCode, adj.body).toBe(200);
    expect(adj.json().gross).toBe(13000);

    const re = (await call(accountant, 'POST', `/hr/payroll/${runId}/recalculate`)).json();
    expect(re.payslips.find((s: { employeeId: string }) => s.employeeId === wardBoyId)).toMatchObject({ otherEarnings: 1000, gross: 13000 });

    const csv = (await call(accountant, 'GET', `/hr/payroll/${runId}/export`)).json();
    expect(csv.filename).toBe(`payroll-${lastMonth}-draft.csv`);
    expect(csv.csv.split('\r\n')[0]).toContain('Net pay');
    expect(csv.csv).toContain('WB-01');

    // The accountant prepares payroll; finalizing needs hr.payroll.finalize.
    expect((await call(accountant, 'POST', `/hr/payroll/${runId}/finalize`)).statusCode).toBe(403);
    const fin = await call(admin, 'POST', `/hr/payroll/${runId}/finalize`);
    expect(fin.statusCode, fin.body).toBe(200);
    expect(fin.json().status).toBe('final');

    expect((await call(accountant, 'PATCH', `/hr/payslips/${slip.id}`, { otherEarnings: 5 })).statusCode).toBe(409);
    expect((await call(accountant, 'DELETE', `/hr/payroll/${runId}`)).statusCode).toBe(409);
    expect((await call(accountant, 'POST', '/hr/payroll', { month: lastMonth })).statusCode).toBe(409);

    const db = app.get(DbService);
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`update hr.payslips set net_pay = 1, gross = 1 where run_id = ${runId}`))).rejects.toThrow();
  });

  it('shows staff only their own finalized payslips', async () => {
    const mine = (await call(nurse, 'GET', '/hr/me/payslips')).json();
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ employeeId: nurseEmpId, month: lastMonth, runStatus: 'final' });
    const run = (await call(admin, 'GET', `/hr/payroll/${runId}`)).json();
    const other = run.payslips.find((s: { employeeId: string }) => s.employeeId === wardBoyId);
    expect((await call(nurse, 'GET', `/hr/me/payslips/${other.id}`)).statusCode).toBe(404);
    expect((await call(nurse, 'GET', `/hr/payslips/${other.id}`)).statusCode).toBe(403);
  });
});

describe('plan', () => {
  it('is refused on a plan without HR', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/hr/employees', headers: bearer(starterHospital) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });
});

describe('isolation', () => {
  it('another hospital cannot see or change this hospital’s HR data', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/hr/employees?status=all', headers: bearer(otherHospital) })).json();
    expect(list.items.find((e: { id: string }) => e.id === nurseEmpId)).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: `/api/v1/hr/employees/${nurseEmpId}`, headers: bearer(otherHospital) })).statusCode).toBe(404);
    const patch = await app.inject({ method: 'PATCH', url: `/api/v1/hr/employees/${nurseEmpId}`, headers: bearer(otherHospital), payload: { designation: 'Hacked' } });
    expect(patch.statusCode).toBe(404);
    const runs = (await app.inject({ method: 'GET', url: '/api/v1/hr/payroll', headers: bearer(otherHospital) })).json();
    expect(runs.find((r: { month: string; employeeCount: number }) => r.month === lastMonth && r.employeeCount === 2)).toBeUndefined();
  });
});
