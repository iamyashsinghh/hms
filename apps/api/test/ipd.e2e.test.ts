import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { DEMO_PASSWORD, provisionTenant, sql } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { IpdCensusService } from '../src/modules/ipd/ipd.census';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let reception: string;
let doctor: string;
let doctorId: string;
let nurse: string;
let clerk: string;
let owner: string;
let otherHospital: string;
let starterHospital: string;
let facilityId: string;
const tag = Date.now().toString(36).toUpperCase();
const WARD = `W${tag}`.slice(0, 20);

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);

let wardId: string;
let beds: { id: string; code: string; status: string }[];
let patientId: string;
let admissionId: string;

/** A throwaway hospital on the growth plan (IPD included), per the test-data rules. */
async function provisionGrowthHospital(): Promise<string> {
  const code = 'ipd-' + tag.toLowerCase();
  const email = `admin@${code}.test`;
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await provisionTenant(client, { code, name: 'IPD Test Hospital', plan: 'growth', facility: { code: 'MAIN', name: 'Main' }, admin: { name: 'IPD Admin', email, password: DEMO_PASSWORD } });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
  return email;
}

async function newPatient(first: string) {
  const res = await call(admin, 'POST', '/patients', { firstName: first, lastName: `Ipd${tag}`, gender: 'female', ageYears: 52, mobile: '9876511111' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  facilityId = me.facilities[0].id;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  const doc = await login(app, 'doctor@demo.hms');
  doctor = doc.accessToken;
  doctorId = doc.user.id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  owner = (await login(app, 'owner@demo.hms')).accessToken;
  starterHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  otherHospital = (await login(app, await provisionGrowthHospital(), 'ipd-' + tag.toLowerCase())).accessToken;

  const ward = await call(admin, 'POST', '/ipd/wards', { code: WARD, name: `General ${tag}`, wardType: 'general', defaultDailyRate: 1500 });
  expect(ward.statusCode, ward.body).toBe(201);
  wardId = ward.json().id;
  const bulk = await call(admin, 'POST', '/ipd/beds/bulk', { wardId, prefix: 'B', from: 1, to: 3 });
  expect(bulk.statusCode, bulk.body).toBe(201);
  beds = bulk.json();
  patientId = await newPatient('Kamla');
});
afterAll(() => app.close());

describe('wards and beds', () => {
  it('creates beds at the ward rate and rejects duplicate codes', async () => {
    expect(beds.map((b) => b.code)).toEqual(['B1', 'B2', 'B3']);
    expect(beds.every((b) => b.status === 'available')).toBe(true);
    expect((await call(admin, 'POST', '/ipd/beds', { wardId, code: 'B1' })).statusCode).toBe(409);
    expect((await call(admin, 'POST', '/ipd/wards', { code: WARD, name: 'Again' })).statusCode).toBe(409);
  });

  it('only ward managers can change wards and beds', async () => {
    expect((await call(nurse, 'POST', '/ipd/wards', { code: `X${tag}`.slice(0, 20), name: 'Nope' })).statusCode).toBe(403);
    expect((await call(reception, 'POST', '/ipd/beds', { wardId, code: 'B9' })).statusCode).toBe(403);
    expect((await call(nurse, 'PATCH', `/ipd/wards/${wardId}`, { name: 'Nope' })).statusCode).toBe(403);
    expect((await call(reception, 'PATCH', `/ipd/beds/${beds[0]!.id}`, { code: 'Nope' })).statusCode).toBe(403);
  });

  it('edits a ward without resetting the fields it was not sent', async () => {
    const res = await call(admin, 'PATCH', `/ipd/wards/${wardId}`, { floor: '2nd floor' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: `General ${tag}`, wardType: 'general', defaultDailyRate: 1500, floor: '2nd floor', isActive: true });

    const icu = await call(admin, 'POST', '/ipd/wards', { code: `I${tag}`.slice(0, 20), name: `ICU ${tag}`, wardType: 'icu', defaultDailyRate: 5000 });
    expect(icu.statusCode, icu.body).toBe(201);
    const icuId = icu.json().id as string;
    const renamed = await call(admin, 'PATCH', `/ipd/wards/${icuId}`, { name: `Medical ICU ${tag}`, wardType: 'hdu', defaultDailyRate: 4200.5 });
    expect(renamed.json()).toMatchObject({ code: `I${tag}`.slice(0, 20), name: `Medical ICU ${tag}`, wardType: 'hdu', defaultDailyRate: 4200.5 });
    // Closing (the web's Close ward button) only flips isActive.
    const closed = await call(admin, 'PATCH', `/ipd/wards/${icuId}`, { isActive: false });
    expect(closed.json()).toMatchObject({ isActive: false, wardType: 'hdu', defaultDailyRate: 4200.5 });
    expect((await call(admin, 'PATCH', `/ipd/wards/${icuId}`, { isActive: true })).json()).toMatchObject({ isActive: true, wardType: 'hdu' });

    for (const bad of [{ name: '' }, { defaultDailyRate: -1 }, { defaultDailyRate: 10.123 }, { wardType: 'palace' }]) {
      expect((await call(admin, 'PATCH', `/ipd/wards/${icuId}`, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(admin, 'PATCH', `/ipd/wards/00000000-0000-4000-8000-000000000000`, { name: 'Ghost' })).statusCode).toBe(404);
  });

  it('adds a single bed and edits it', async () => {
    const icu = await call(admin, 'POST', '/ipd/wards', { code: `J${tag}`.slice(0, 20), name: `Step-down ${tag}`, defaultDailyRate: 2500 });
    const icuId = icu.json().id as string;
    const res = await call(admin, 'POST', '/ipd/beds', { wardId: icuId, code: 'SD-1', roomNo: '201' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ code: 'SD-1', roomNo: '201', dailyRate: 2500, status: 'available' });
    await call(admin, 'POST', '/ipd/beds', { wardId: icuId, code: 'SD-2' });
    const bedId = res.json().id as string;

    const edited = await call(admin, 'PATCH', `/ipd/beds/${bedId}`, { code: 'SD-1A', roomNo: '202', dailyRate: 2750, chargeServiceCode: 'room-sd' });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ code: 'SD-1A', roomNo: '202', dailyRate: 2750, chargeServiceCode: 'ROOM-SD', isActive: true });
    // Blank clears optional fields.
    expect((await call(admin, 'PATCH', `/ipd/beds/${bedId}`, { roomNo: null, chargeServiceCode: null })).json()).toMatchObject({ roomNo: null, chargeServiceCode: null, dailyRate: 2750 });
    expect((await call(admin, 'PATCH', `/ipd/beds/${bedId}`, { code: 'SD-2' })).statusCode).toBe(409);
    expect((await call(admin, 'PATCH', `/ipd/beds/${bedId}`, { dailyRate: -5 })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ipd/beds/${bedId}`, { code: '' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/ipd/beds', { wardId: icuId, code: 'SD-3', dailyRate: -1 })).statusCode).toBe(400);
  });
});

describe('admission to discharge', () => {
  it('admits a patient with an advance and occupies the bed', async () => {
    const res = await call(reception, 'POST', '/ipd/admissions', {
      patientId,
      bedId: beds[0]!.id,
      doctorId,
      admissionType: 'emergency',
      reason: 'Fever with breathlessness',
      provisionalDiagnosis: 'Community acquired pneumonia',
      attendantName: 'Ramesh',
      attendantMobile: '9876522222',
      advance: { mode: 'cash', amount: 5000 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const a = res.json();
    admissionId = a.id;
    expect(a).toMatchObject({ status: 'admitted', bedId: beds[0]!.id, bedLabel: 'B1', wardName: `General ${tag}`, lengthOfStay: 1, summaryStatus: 'none' });
    expect(a.ipdNo).toMatch(/^IP/);
    expect(a.stays).toHaveLength(1);

    const board = (await call(nurse, 'GET', '/ipd/bed-board')).json();
    const ward = board.wards.find((w: { id: string }) => w.id === wardId);
    expect(ward).toMatchObject({ bedCount: 3, occupiedCount: 1 });
    expect(ward.beds[0]).toMatchObject({ status: 'occupied', occupant: { admissionId, patientId } });
  });

  it('refuses a second admission for the same patient or an occupied bed', async () => {
    const again = await call(reception, 'POST', '/ipd/admissions', { patientId, bedId: beds[1]!.id, doctorId, reason: 'Again' });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('already_admitted');
    const other = await newPatient('Sita');
    const taken = await call(reception, 'POST', '/ipd/admissions', { patientId: other, bedId: beds[0]!.id, doctorId, reason: 'Bed taken' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('bed_not_available');
    const notDoctor = await call(reception, 'POST', '/ipd/admissions', { patientId: other, bedId: beds[2]!.id, doctorId: (await login(app, 'nurse@demo.hms')).user.id, reason: 'x y' });
    expect(notDoctor.statusCode).toBe(400);
    expect(notDoctor.json().error.code).toBe('invalid_doctor');
  });

  it('edits the admission details while the patient is admitted', async () => {
    const res = await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, {
      isMlc: true,
      mlcNo: 'PS-123/26',
      attendantName: 'Suresh',
      attendantRelation: 'Son',
      attendantMobile: '9876533333',
      expectedDischargeDate: '2099-01-10',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      isMlc: true,
      mlcNo: 'PS-123/26',
      attendantName: 'Suresh',
      attendantRelation: 'Son',
      attendantMobile: '9876533333',
      expectedDischargeDate: '2099-01-10',
      // Fields not sent stay as they were.
      reason: 'Fever with breathlessness',
      provisionalDiagnosis: 'Community acquired pneumonia',
      admissionType: 'emergency',
      doctorId,
    });
    // A partial update does not reset MLC; turning MLC off clears the number; null clears optional fields.
    expect((await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, { attendantRelation: 'Nephew' })).json()).toMatchObject({ isMlc: true, mlcNo: 'PS-123/26' });
    const cleared = await call(doctor, 'PATCH', `/ipd/admissions/${admissionId}`, { isMlc: false, attendantMobile: null, expectedDischargeDate: '' });
    expect(cleared.json()).toMatchObject({ isMlc: false, mlcNo: null, attendantMobile: null, expectedDischargeDate: null, attendantName: 'Suresh' });

    const before = await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, { expectedDischargeDate: '2020-01-01' });
    expect(before.statusCode).toBe(400);
    expect(before.json().error.code).toBe('invalid_expected_discharge');
    for (const bad of [{ reason: 'x' }, { attendantMobile: '12345' }, { expectedDischargeDate: '2099-02-30' }, { doctorId: 'nope' }]) {
      expect((await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    const nurseUser = (await login(app, 'nurse@demo.hms')).user.id;
    expect((await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, { doctorId: nurseUser })).json().error.code).toBe('invalid_doctor');
    expect((await call(nurse, 'PATCH', `/ipd/admissions/${admissionId}`, { attendantName: 'Nope' })).statusCode).toBe(403);
    expect((await call(owner, 'PATCH', `/ipd/admissions/${admissionId}`, { attendantName: 'Nope' })).statusCode).toBe(403);
  });

  it('refuses an expected discharge before the admission date when admitting', async () => {
    const pid = await newPatient('Early');
    const res = await call(reception, 'POST', '/ipd/admissions', { patientId: pid, bedId: beds[2]!.id, doctorId, reason: 'Back dated', expectedDischargeDate: '2020-01-01' });
    expect(res.statusCode).toBe(400);
    // The shared admit schema refuses a past date before the service's own check.
    expect(res.json().error.message).toContain('Expected discharge date cannot be in the past');
  });

  it('records nursing charts, MAR and rounds with the right roles', async () => {
    const v = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/vitals`, { temperatureC: 38.6, pulse: 104, bpSystolic: 118, bpDiastolic: 76, spo2: 93 });
    expect(v.statusCode, v.body).toBe(201);
    expect(v.json()).toMatchObject({ temperatureC: 38.6, spo2: 93 });
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/vitals`, {})).statusCode).toBe(400);
    expect((await call(reception, 'POST', `/ipd/admissions/${admissionId}/vitals`, { pulse: 80 })).statusCode).toBe(403);

    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/nursing-notes`, { shift: 'morning', note: 'Patient comfortable, on O2 2L' })).statusCode).toBe(201);
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/intake-output`, { direction: 'intake', category: 'iv', volumeMl: 500 })).statusCode).toBe(201);
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/intake-output`, { direction: 'output', category: 'urine', volumeMl: 300 })).statusCode).toBe(201);
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/intake-output`, { direction: 'output', category: 'oral', volumeMl: 1 })).statusCode).toBe(400);
    const io = (await call(doctor, 'GET', `/ipd/admissions/${admissionId}/intake-output`)).json();
    expect(io.days[0]).toMatchObject({ intakeMl: 500, outputMl: 300, balanceMl: 200 });

    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/medications`, { drugName: 'Ceftriaxone', dose: '1 g', route: 'iv', frequency: 'BD' })).statusCode).toBe(403);
    const order = await call(doctor, 'POST', `/ipd/admissions/${admissionId}/medications`, { drugName: 'Ceftriaxone', dose: '1 g', route: 'iv', frequency: 'BD' });
    expect(order.statusCode, order.body).toBe(201);
    const given = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/medications/${order.json().id}/administrations`, { status: 'given' });
    expect(given.statusCode, given.body).toBe(201);
    expect(given.json().lastGivenAt).not.toBeNull();
    const stopped = await call(doctor, 'POST', `/ipd/admissions/${admissionId}/medications/${order.json().id}/stop`, { reason: 'Switched to oral' });
    expect(stopped.json().status).toBe('stopped');
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/medications/${order.json().id}/administrations`, {})).statusCode).toBe(409);

    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/rounds`, { plan: 'Continue' })).statusCode).toBe(403);
    const round = await call(doctor, 'POST', `/ipd/admissions/${admissionId}/rounds`, { findings: 'Crepts right base', plan: 'Continue IV antibiotics, repeat CXR' });
    expect(round.statusCode, round.body).toBe(201);
    expect((await call(nurse, 'GET', `/ipd/admissions/${admissionId}/rounds`)).json()).toHaveLength(1);
  });

  it('transfers to another bed and sends the old bed to cleaning', async () => {
    const res = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/transfer`, { bedId: beds[1]!.id, reason: 'Moved near nursing station' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ bedId: beds[1]!.id, bedLabel: 'B2' });
    expect(res.json().stays).toHaveLength(2);
    const old = (await call(nurse, 'GET', `/ipd/beds?wardId=${wardId}`)).json().find((b: { id: string }) => b.id === beds[0]!.id);
    expect(old).toMatchObject({ status: 'cleaning', occupant: null });
    expect((await call(nurse, 'POST', `/ipd/beds/${beds[0]!.id}/status`, { status: 'available' })).json().status).toBe('available');
    expect((await call(nurse, 'POST', `/ipd/beds/${beds[1]!.id}/status`, { status: 'available' })).statusCode).toBe(409);
  });

  it('keeps a running bill of bed days, charges and advances', async () => {
    const c1 = await call(clerk, 'POST', `/ipd/admissions/${admissionId}/charges`, { description: 'Nebulization', qty: 2, unitPrice: 250 });
    expect(c1.statusCode, c1.body).toBe(201);
    const c2 = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/charges`, { description: 'Wrong entry', unitPrice: 999 });
    expect(c2.statusCode).toBe(201);
    expect((await call(clerk, 'POST', `/ipd/admissions/${admissionId}/charges/${c2.json().id}/cancel`, { reason: 'Posted twice' })).json().status).toBe('cancelled');
    expect((await call(doctor, 'POST', `/ipd/admissions/${admissionId}/charges`, { description: 'x', unitPrice: 1 })).statusCode).toBe(403);

    const bill = (await call(owner, 'GET', `/ipd/admissions/${admissionId}/bill`)).json();
    expect(bill).toMatchObject({ status: 'running', bedTotal: 1500, chargesTotal: 500, grossTotal: 2000, advanceTotal: 5000, estimatedDue: -3000, depositBalance: 5000 });
    // Admitted and transferred the same day: the day is billed to the bed held at midnight (B2).
    expect(bill.bedCharges).toEqual([expect.objectContaining({ bedLabel: `General ${tag} · B2`, days: 1, dailyRate: 1500, amount: 1500 })]);
    expect(bill.advances[0]).toMatchObject({ amount: 5000, mode: 'cash' });
  });

  it('tracks devices and reports the daily census per ward', async () => {
    const cath = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/devices`, { deviceType: 'urinary_catheter', site: 'Foley 14F' });
    expect(cath.statusCode, cath.body).toBe(201);
    expect(cath.json()).toMatchObject({ deviceType: 'urinary_catheter', removedAt: null, days: 1 });
    const iv = (await call(nurse, 'POST', `/ipd/admissions/${admissionId}/devices`, { deviceType: 'peripheral_iv' })).json();
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/devices/${iv.id}/remove`, { reason: 'Tissued' })).json().removedAt).not.toBeNull();
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/devices/${iv.id}/remove`, {})).statusCode).toBe(409);
    expect((await call(reception, 'POST', `/ipd/admissions/${admissionId}/devices`, { deviceType: 'ventilator' })).statusCode).toBe(403);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const census = (await call(nurse, 'GET', `/ipd/census?date=${today}`)).json();
    expect(census.find((w: { wardId: string }) => w.wardId === wardId)).toMatchObject({
      patientDays: 1,
      catheterDays: 1,
      centralLineDays: 0,
      ventilatorDays: 0,
      admissions: 1,
      discharges: 0,
      surgeries: null,
    });

    // The hourly job publishes ipd.census.daily once per facility and date.
    const svc = app.get(IpdCensusService);
    const db = app.get(DbService);
    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
    expect(await svc.publishForTenant(me.tenantId, today)).toBeGreaterThan(0);
    expect(await svc.publishForTenant(me.tenantId, today)).toBe(0);
    const events = await db.asTenant({ tenantId: me.tenantId }, (tx) =>
      tx.execute<{ payload: { date: string; wards: { wardId: string; patientDays: number }[] } }>(
        sql`select payload from audit.outbox where topic = 'ipd.census.daily' and payload->>'facilityId' = ${facilityId} and payload->>'date' = ${today}`,
      ),
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.payload.wards.find((w) => w.wardId === wardId)?.patientDays).toBe(1);
  });

  it('will not discharge before the bill and summary are final', async () => {
    const res = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/discharge`, {});
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('bill_not_final');
  });

  it('finalizes the bill into one invoice and adjusts the advance', async () => {
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/bill/finalize`, {})).statusCode).toBe(403);
    const res = await call(clerk, 'POST', `/ipd/admissions/${admissionId}/bill/finalize`, {});
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ total: 2000, advanceAdjusted: 2000, balanceDue: 0 });
    expect(res.json().number).toMatch(/^INV/);

    const inv = (await call(clerk, 'GET', `/billing/invoices/${res.json().invoiceId}`)).json();
    expect(inv).toMatchObject({ status: 'final', total: 2000, balance: 0, sourceModule: 'ipd', sourceRef: admissionId });
    expect(inv.lines).toHaveLength(2);
    expect((await call(clerk, 'GET', `/billing/patients/${patientId}/account`)).json().depositBalance).toBe(3000);

    const late = await call(clerk, 'POST', `/ipd/admissions/${admissionId}/charges`, { description: 'Late', unitPrice: 10 });
    expect(late.statusCode).toBe(409);
    expect((await call(clerk, 'POST', `/ipd/admissions/${admissionId}/bill/finalize`, {})).statusCode).toBe(409);
    expect((await call(clerk, 'GET', `/ipd/admissions/${admissionId}/bill`)).json()).toMatchObject({ status: 'final', grossTotal: 2000 });
  });

  it('signs the discharge summary and discharges', async () => {
    const early = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/discharge`, {});
    expect(early.json().error.code).toBe('summary_not_final');

    const draft = (await call(doctor, 'GET', `/ipd/admissions/${admissionId}/discharge-summary/draft`)).json();
    expect(draft.finalDiagnosis).toBe('Community acquired pneumonia');
    expect(draft.hospitalCourse).toContain('repeat CXR');
    const saved = await call(doctor, 'PUT', `/ipd/admissions/${admissionId}/discharge-summary`, {
      ...draft,
      conditionAtDischarge: 'Stable, afebrile',
      medications: [{ drugName: 'Amoxiclav 625', dose: '1 tab', frequency: 'BD', days: 5 }],
      followUpDate: new Date(Date.now() + 30 * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }),
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/discharge-summary/finalize`)).statusCode).toBe(403);
    const signed = await call(doctor, 'POST', `/ipd/admissions/${admissionId}/discharge-summary/finalize`);
    expect(signed.statusCode, signed.body).toBe(201);
    expect(signed.json()).toMatchObject({ status: 'final', medications: [expect.objectContaining({ drugName: 'Amoxiclav 625' })] });
    expect((await call(doctor, 'PUT', `/ipd/admissions/${admissionId}/discharge-summary`, draft)).statusCode).toBe(409);

    const res = await call(nurse, 'POST', `/ipd/admissions/${admissionId}/discharge`, { dischargeType: 'normal' });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'discharged', dischargeType: 'normal', bedId: null, summaryStatus: 'final' });
    expect(res.json().stays.every((s: { toAt: string | null }) => s.toAt)).toBe(true);
    const bed = (await call(nurse, 'GET', `/ipd/beds?wardId=${wardId}`)).json().find((b: { id: string }) => b.id === beds[1]!.id);
    expect(bed.status).toBe('cleaning');
    expect((await call(nurse, 'POST', `/ipd/admissions/${admissionId}/vitals`, { pulse: 70 })).statusCode).toBe(409);
    const devices = (await call(nurse, 'GET', `/ipd/admissions/${admissionId}/devices`)).json();
    expect(devices.every((d: { removedAt: string | null }) => d.removedAt)).toBe(true);
    const list = (await call(reception, 'GET', `/ipd/admissions?status=discharged&q=${tag.toLowerCase()}`)).json();
    expect(list.items.map((a: { id: string }) => a.id)).toContain(admissionId);
    const late = await call(reception, 'PATCH', `/ipd/admissions/${admissionId}`, { attendantName: 'Too late' });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe('not_admitted');
  });

  it('cancels an admission made by mistake and frees the bed', async () => {
    const pid = await newPatient('Mistake');
    const a = await call(reception, 'POST', '/ipd/admissions', { patientId: pid, bedId: beds[2]!.id, doctorId, reason: 'Wrong patient' });
    expect(a.statusCode, a.body).toBe(201);
    expect((await call(reception, 'POST', `/ipd/admissions/${a.json().id}/cancel`, { reason: 'Wrong patient picked' })).statusCode).toBe(403);
    const res = await call(admin, 'POST', `/ipd/admissions/${a.json().id}/cancel`, { reason: 'Wrong patient picked' });
    expect(res.json()).toMatchObject({ status: 'cancelled', bedId: null });
    const bed = (await call(admin, 'GET', `/ipd/beds?wardId=${wardId}`)).json().find((b: { id: string }) => b.id === beds[2]!.id);
    expect(bed.status).toBe('available');
  });
});

describe('validation', () => {
  const msg = (res: { json: () => { error: { message: string } } }) => res.json().error.message;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const istDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  let vBedId: string;
  let vPatient: string;
  let vAdmission: string;

  beforeAll(async () => {
    const bed = await call(admin, 'POST', '/ipd/beds', { wardId, code: 'V1' });
    expect(bed.statusCode, bed.body).toBe(201);
    vBedId = bed.json().id;
    vPatient = await newPatient('Valida');
  });

  it('checks wards and beds', async () => {
    expect(msg(await call(admin, 'POST', '/ipd/wards', { code: 'G W!', name: 'Bad' }))).toContain('Letters, digits, - or _');
    expect(msg(await call(admin, 'POST', '/ipd/wards', { code: `N${tag}`.slice(0, 20), name: '  ' }))).toContain('Enter the ward name');
    expect(msg(await call(admin, 'POST', '/ipd/beds/bulk', { wardId, prefix: 'Z', from: 1, to: 150 }))).toContain('Add between 1 and 100 beds');
    expect(msg(await call(admin, 'POST', '/ipd/wards', { code: `R${tag}`.slice(0, 20), name: 'Rate', defaultDailyRate: -5 }))).toContain('cannot be negative');
  });

  it('checks the admit form', async () => {
    const base = { patientId: vPatient, bedId: vBedId, doctorId, reason: 'Observation' };
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, patientId: undefined }))).toContain('Pick the patient to admit');
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, reason: 'a' }))).toContain('at least 2 characters');
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, attendantMobile: '12345' }))).toContain('10-digit');
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, admittedAt: new Date(Date.now() + 86_400_000).toISOString() }))).toContain(
      'Admission time cannot be in the future',
    );
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, expectedDischargeDate: istDay(-1) }))).toContain('Expected discharge date cannot be in the past');
    expect(msg(await call(reception, 'POST', '/ipd/admissions', { ...base, expectedDischargeDate: '2026-02-30' }))).toContain('valid date');

    // Back-dated two days, attendant mobile with +91, blank optional fields.
    const ok = await call(reception, 'POST', '/ipd/admissions', {
      ...base,
      admittedAt: hoursAgo(48),
      attendantMobile: '+91 98765 22222',
      attendantName: '',
      expectedDischargeDate: istDay(3),
    });
    expect(ok.statusCode, ok.body).toBe(201);
    expect(ok.json()).toMatchObject({ attendantMobile: '9876522222', attendantName: null, expectedDischargeDate: istDay(3) });
    vAdmission = ok.json().id;
    expect(msg(await call(admin, 'PATCH', `/ipd/admissions/${vAdmission}`, { expectedDischargeDate: istDay(-5) }))).toContain('before the admission date');
  });

  it('checks chart times and readings', async () => {
    const url = `/ipd/admissions/${vAdmission}`;
    expect(msg(await call(nurse, 'POST', `${url}/vitals`, { pulse: 80, recordedAt: new Date(Date.now() + 3_600_000).toISOString() }))).toContain('cannot be in the future');
    expect(msg(await call(nurse, 'POST', `${url}/vitals`, { pulse: 80, recordedAt: hoursAgo(72) }))).toContain('before the patient was admitted');
    expect(msg(await call(nurse, 'POST', `${url}/vitals`, { bpSystolic: 80, bpDiastolic: 120 }))).toContain('Diastolic BP must be lower than systolic');
    expect(msg(await call(nurse, 'POST', `${url}/vitals`, { bpSystolic: 120 }))).toContain('Enter both systolic and diastolic BP');
    expect(msg(await call(nurse, 'POST', `${url}/vitals`, { temperatureC: 50 }))).toContain('Temperature (°C) must be between 25 and 45');
    expect((await call(nurse, 'POST', `${url}/vitals`, { pulse: 88, recordedAt: hoursAgo(24) })).statusCode).toBe(201);
    expect(msg(await call(nurse, 'POST', `${url}/intake-output`, { direction: 'intake', category: 'oral', volumeMl: -10 }))).toContain('cannot be negative');
    expect(msg(await call(nurse, 'POST', `${url}/devices`, { deviceType: 'peripheral_iv', insertedAt: new Date(Date.now() + 86_400_000).toISOString() }))).toContain(
      'Insertion time cannot be in the future',
    );
    expect(msg(await call(doctor, 'POST', `${url}/rounds`, { plan: 'Observe', roundAt: hoursAgo(72) }))).toContain('before the patient was admitted');
    expect(msg(await call(doctor, 'POST', `${url}/medications`, { drugName: 'PCM', dose: '650 mg', frequency: 'TDS', startAt: hoursAgo(72) }))).toContain(
      'Start time cannot be before the admission',
    );
  });

  it('checks charges and the discharge summary', async () => {
    const url = `/ipd/admissions/${vAdmission}`;
    expect(msg(await call(clerk, 'POST', `${url}/charges`, { description: 'Dressing', unitPrice: 100, chargeDate: istDay(1) }))).toContain('Charge date cannot be in the future');
    expect(msg(await call(clerk, 'POST', `${url}/charges`, { description: 'Dressing', unitPrice: 100, chargeDate: istDay(-10) }))).toContain('before the admission date');
    expect(msg(await call(clerk, 'POST', `${url}/charges`, { description: 'Dressing', unitPrice: 100, taxRate: 7 }))).toContain('Use a GST slab');
    expect(msg(await call(clerk, 'POST', `${url}/charges`, { description: 'Dressing', unitPrice: 100, qty: 0 }))).toContain('Quantity must be more than 0');
    expect(msg(await call(clerk, 'POST', `${url}/charges`, { qty: 1 }))).toContain('Give a service code, or a description and a price');
    const ok = await call(clerk, 'POST', `${url}/charges`, { description: 'Dressing', unitPrice: 100, taxRate: 12, chargeDate: istDay(-1) });
    expect(ok.statusCode, ok.body).toBe(201);

    const past = await call(doctor, 'PUT', `${url}/discharge-summary`, { finalDiagnosis: 'Viral fever', followUpDate: istDay(-1) });
    expect(msg(past)).toContain('Follow-up date cannot be in the past');
    expect(msg(await call(doctor, 'PUT', `${url}/discharge-summary`, { finalDiagnosis: ' ' }))).toContain('final diagnosis needs at least 2 characters');
    expect((await call(doctor, 'PUT', `${url}/discharge-summary`, { finalDiagnosis: 'Viral fever', followUpDate: istDay(7) })).statusCode).toBe(200);
  });
});

describe('permissions and isolation', () => {
  it('owner can look but not admit', async () => {
    expect((await call(owner, 'GET', '/ipd/bed-board')).statusCode).toBe(200);
    expect((await call(owner, 'POST', '/ipd/admissions', { patientId, bedId: beds[0]!.id, doctorId, reason: 'x y' })).statusCode).toBe(403);
  });

  it('needs a plan that includes IPD', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ipd/bed-board', headers: bearer(starterHospital) } as Inject);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });

  it("never shows one hospital's wards or patients to another", async () => {
    const other = (path: string, method = 'GET', payload?: unknown) =>
      app.inject({ method, url: `/api/v1${path}`, headers: bearer(otherHospital), payload } as Inject);
    expect((await other(`/ipd/admissions/${admissionId}`)).statusCode).toBe(404);
    expect((await other(`/ipd/admissions/${admissionId}/bill`)).statusCode).toBe(404);
    expect((await other(`/ipd/admissions/${admissionId}/vitals`, 'POST', { pulse: 80 })).statusCode).toBe(404);
    expect((await other(`/ipd/beds/${beds[0]!.id}/status`, 'POST', { status: 'maintenance' })).statusCode).toBe(404);
    expect((await other(`/ipd/admissions?q=${tag.toLowerCase()}`)).json().items).toEqual([]);
    const board = (await other('/ipd/bed-board')).json();
    expect(board.wards.find((w: { id: string }) => w.id === wardId)).toBeUndefined();
    // Their admit with our bed and patient ids finds neither.
    const admit = await other('/ipd/admissions', 'POST', { patientId, bedId: beds[0]!.id, doctorId, reason: 'cross tenant' });
    expect(admit.statusCode).toBe(404);
  });
});
