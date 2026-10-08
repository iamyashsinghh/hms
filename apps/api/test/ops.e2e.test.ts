import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { config } from 'dotenv';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, provisionTenant } from '@hms/db';
import { bearer, bootApp, login } from './helpers';

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

let app: NestFastifyApplication;
let admin: string;
let nurse: string;
let doctor: string;
let reception: string;
let clerk: string;
let pharmacist: string;
let city: string;
let other: string;
let otherFacilityId: string;
let facilityId: string;
let cityFacilityId: string;
let patientId: string;
let npoPatientId: string;
const tag = Date.now().toString(36).toUpperCase();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const plusDays = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown, facility: string | null = facilityId) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...bearer(token), ...(facility ? { 'x-facility-id': facility } : {}) },
    payload,
  } as Inject);
/** A second hospital on the Growth plan (city is on Starter, which has no Facility Services). */
const otherCall = (method: string, url: string, payload?: unknown) => call(other, method, url, payload, otherFacilityId);
const OTHER = `ops-${tag.toLowerCase().slice(-6)}`;

async function provisionOtherHospital() {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const t = await provisionTenant(client, {
      code: OTHER,
      name: `Ops Isolation ${tag}`,
      plan: 'growth',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Ops Admin', email: `admin@${OTHER}.test`, password: DEMO_PASSWORD },
    });
    await client.query('COMMIT');
    return t.facilityId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  facilityId = me.facilities[0].id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  city = (await login(app, 'admin@city.hms', 'city')).accessToken;
  const cityMe = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(city) })).json();
  cityFacilityId = cityMe.facilities[0].id;
  otherFacilityId = await provisionOtherHospital();
  other = (await login(app, `admin@${OTHER}.test`, OTHER)).accessToken;

  const p = await call(admin, 'POST', '/patients', { firstName: 'Ops', lastName: `Patient${tag}`, gender: 'female', ageYears: 52, allergies: ['Peanuts'] });
  expect(p.statusCode, p.body).toBe(201);
  patientId = p.json().id;
  const q = await call(admin, 'POST', '/patients', { firstName: 'Npo', lastName: `Patient${tag}`, gender: 'male', ageYears: 61 });
  npoPatientId = q.json().id;
});
afterAll(() => app.close());

describe('biomedical equipment & maintenance', () => {
  let assetId: string;
  let breakdownId: string;

  it('registers equipment with a PM schedule (managers only)', async () => {
    const body = { name: `Ventilator ${tag}`, category: 'life_support', criticality: 'high', serialNo: `SN-${tag}`, pmIntervalDays: 90, calibrationDue: plusDays(10) };
    expect((await call(nurse, 'POST', '/ops/assets', body)).statusCode).toBe(403);
    const res = await call(admin, 'POST', '/ops/assets', body);
    expect(res.statusCode, res.body).toBe(201);
    const a = res.json();
    expect(a).toMatchObject({ status: 'in_service', nextPmDue: plusDays(90), openWorkOrders: 0, facilityId });
    expect(a.code).toMatch(/^BME\d{5}$/);
    assetId = a.id;
  });

  it('lists equipment due for calibration', async () => {
    const due = (await call(nurse, 'GET', `/ops/assets?dueWithinDays=30&q=${tag}`)).json();
    expect(due.items.map((a: { id: string }) => a.id)).toContain(assetId);
    const notDue = (await call(nurse, 'GET', `/ops/assets?dueWithinDays=5&q=${tag}`)).json();
    expect(notDue.items).toHaveLength(0);
  });

  it('lets a nurse report a breakdown, which takes the equipment out of service', async () => {
    const res = await call(nurse, 'POST', '/ops/work-orders', { assetId, type: 'breakdown', problem: 'Alarm keeps beeping' });
    expect(res.statusCode, res.body).toBe(201);
    const wo = res.json();
    expect(wo).toMatchObject({ status: 'open', priority: 'urgent', assetName: `Ventilator ${tag}` });
    breakdownId = wo.id;
    expect((await call(nurse, 'GET', `/ops/assets/${assetId}`)).json()).toMatchObject({ status: 'under_maintenance', openWorkOrders: 1 });
    const again = await call(doctor, 'POST', '/ops/work-orders', { assetId, type: 'breakdown', problem: 'Same again' });
    expect(again.statusCode).toBe(409);
  });

  it('only managers schedule PM and close work orders', async () => {
    expect((await call(doctor, 'POST', '/ops/work-orders', { assetId, type: 'preventive', problem: 'Quarterly PM' })).statusCode).toBe(403);
    expect((await call(nurse, 'PATCH', `/ops/work-orders/${breakdownId}`, { status: 'completed', resolution: 'x' })).statusCode).toBe(403);
    const manual = await call(admin, 'PATCH', `/ops/assets/${assetId}`, { status: 'in_service' });
    expect(manual.statusCode).toBe(409);
  });

  it('closing the breakdown puts the equipment back in service and records downtime', async () => {
    const noNote = await call(admin, 'PATCH', `/ops/work-orders/${breakdownId}`, { status: 'completed' });
    expect(noNote.statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ops/work-orders/${breakdownId}`, { status: 'in_progress', assignedTo: 'Biomed vendor' })).statusCode).toBe(200);
    const done = await call(admin, 'PATCH', `/ops/work-orders/${breakdownId}`, { status: 'completed', resolution: 'Replaced O2 sensor', cost: 4500 });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'completed', cost: 4500 });
    expect(typeof done.json().downtimeMinutes).toBe('number');
    expect((await call(admin, 'GET', `/ops/assets/${assetId}`)).json().status).toBe('in_service');
  });

  it('completing PM and calibration moves the due dates', async () => {
    const pm = (await call(admin, 'POST', '/ops/work-orders', { assetId, type: 'preventive', problem: 'Quarterly PM' })).json();
    await call(admin, 'PATCH', `/ops/work-orders/${pm.id}`, { status: 'completed', resolution: 'PM checklist done' });
    const cal = (await call(admin, 'POST', '/ops/work-orders', { assetId, type: 'calibration', problem: 'Annual calibration' })).json();
    await call(admin, 'PATCH', `/ops/work-orders/${cal.id}`, { status: 'completed', resolution: 'Calibrated', nextCalibrationDue: plusDays(365) });
    const a = (await call(admin, 'GET', `/ops/assets/${assetId}`)).json();
    expect(a).toMatchObject({ nextPmDue: plusDays(90), calibrationDue: plusDays(365) });
    const history = (await call(nurse, 'GET', `/ops/work-orders?assetId=${assetId}`)).json();
    expect(history.total).toBe(3);
  });

  it('needs a facility to register equipment', async () => {
    const res = await call(admin, 'POST', '/ops/assets', { name: 'No facility' }, null);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('facility_required');
  });
});

describe('CSSD', () => {
  let setId: string;
  let cycleNumber: string;

  it('runs a set through a failed and then a passed cycle', async () => {
    const created = await call(admin, 'POST', '/ops/cssd/sets', { name: `Delivery set ${tag}`, department: 'Labour room', contents: ['Artery forceps x4', 'Scissors x2'], shelfLifeDays: 15 });
    expect(created.statusCode, created.body).toBe(201);
    setId = created.json().id;
    expect(created.json().status).toBe('dirty');

    expect((await call(admin, 'POST', '/ops/cssd/issues', { setId, issuedTo: 'OT 1' })).statusCode).toBe(409);

    const c1 = (await call(admin, 'POST', '/ops/cssd/cycles', { sterilizer: 'Autoclave 1', method: 'steam', setIds: [setId], temperatureC: 134 })).json();
    expect(c1.sets).toHaveLength(1);
    expect((await call(admin, 'POST', '/ops/cssd/cycles', { sterilizer: 'Autoclave 2', setIds: [setId] })).statusCode).toBe(409);
    const failed = await call(admin, 'POST', `/ops/cssd/cycles/${c1.id}/complete`, { chemicalIndicatorPassed: false, notes: 'Strip did not change' });
    expect(failed.json().status).toBe('failed');
    expect((await call(admin, 'GET', `/ops/cssd/sets?q=${tag}`)).json()[0].status).toBe('dirty');

    const c2 = (await call(admin, 'POST', '/ops/cssd/cycles', { sterilizer: 'Autoclave 1', setIds: [setId] })).json();
    cycleNumber = c2.number;
    const passed = await call(admin, 'POST', `/ops/cssd/cycles/${c2.id}/complete`, { chemicalIndicatorPassed: true, biologicalIndicatorPassed: true });
    expect(passed.json().status).toBe('passed');
    const set = (await call(nurse, 'GET', `/ops/cssd/sets?q=${tag}`)).json()[0];
    expect(set).toMatchObject({ status: 'sterile', expired: false });
    const days = (new Date(set.sterileUntil).getTime() - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(15);
  });

  it('issues to a patient, traces the load, and takes the set back as dirty', async () => {
    const issued = await call(admin, 'POST', '/ops/cssd/issues', { setId, issuedTo: 'Labour room', patientId });
    expect(issued.statusCode, issued.body).toBe(201);
    expect(issued.json()).toMatchObject({ cycleNumber, patientId, returnedAt: null });
    expect((await call(admin, 'POST', '/ops/cssd/issues', { setId, issuedTo: 'OT 2' })).statusCode).toBe(409);

    const ret = await call(admin, 'POST', `/ops/cssd/issues/${issued.json().id}/return`, {});
    expect(ret.statusCode).toBe(200);
    expect(ret.json().returnedAt).not.toBeNull();
    expect((await call(admin, 'GET', `/ops/cssd/sets?q=${tag}`)).json()[0].status).toBe('dirty');
    const trace = (await call(nurse, 'GET', `/ops/cssd/issues?setId=${setId}`)).json();
    expect(trace).toHaveLength(1);
  });

  it('keeps CSSD away from roles without access', async () => {
    expect((await call(doctor, 'GET', '/ops/cssd/sets')).statusCode).toBe(403);
    expect((await call(nurse, 'POST', '/ops/cssd/sets', { name: 'Nope' })).statusCode).toBe(403);
  });
});

describe('linen', () => {
  let itemId: string;

  it('moves linen through ward, soiled and laundry without going negative', async () => {
    const item = await call(nurse, 'POST', '/ops/linen/items', { name: `Bedsheet ${tag}`, parLevel: 40 });
    expect(item.statusCode, item.body).toBe(201);
    itemId = item.json().id;
    expect((await call(nurse, 'POST', '/ops/linen/items', { name: `bedsheet ${tag}` })).statusCode).toBe(409);

    const move = (kind: string, qty: number, extra: object = {}) => call(nurse, 'POST', '/ops/linen/txns', { itemId, kind, qty, ...extra });
    expect((await move('stock_in', 50)).statusCode).toBe(201);
    expect((await move('issue', 60, { location: 'Ward 1' })).statusCode).toBe(409);
    expect((await move('issue', 20)).statusCode).toBe(400);
    expect((await move('issue', 20, { location: 'Ward 1' })).statusCode).toBe(201);
    expect((await move('collect', 15, { location: 'Ward 1' })).statusCode).toBe(201);
    expect((await move('laundry_out', 10)).statusCode).toBe(201);
    expect((await move('laundry_in', 4)).statusCode).toBe(201);
    expect((await move('laundry_in', 7)).statusCode).toBe(409);
    expect((await move('condemn', 1, { fromPool: 'soiled' })).statusCode).toBe(201);

    const stock = (await call(nurse, 'GET', '/ops/linen/stock')).json().find((s: { itemId: string }) => s.itemId === itemId);
    expect(stock).toMatchObject({ clean: 34, inUse: 5, soiled: 4, atLaundry: 6, condemned: 1, belowPar: true });
    const txns = (await call(nurse, 'GET', `/ops/linen/txns?itemId=${itemId}`)).json();
    expect(txns.total).toBe(6);
  });

  it('keeps linen away from roles without access', async () => {
    expect((await call(doctor, 'GET', '/ops/linen/stock')).statusCode).toBe(403);
  });
});

describe('ambulance', () => {
  let vehicleId: string;
  let tripId: string;

  it('books, dispatches and bills a trip through Billing', async () => {
    const reg = `KA01${tag.slice(-6)}`;
    const v = await call(reception, 'POST', '/ops/ambulance/vehicles', { registrationNo: reg, type: 'als', driverName: 'Ramesh', ratePerKm: 25, baseCharge: 500 });
    expect(v.statusCode, v.body).toBe(201);
    vehicleId = v.json().id;
    expect((await call(reception, 'POST', '/ops/ambulance/vehicles', { registrationNo: reg })).statusCode).toBe(409);

    const t = await call(reception, 'POST', '/ops/ambulance/trips', {
      patientId,
      contactName: 'Son of patient',
      contactMobile: '9876543210',
      pickupAddress: '12 MG Road',
      vehicleId,
      kind: 'emergency_pickup',
    });
    expect(t.statusCode, t.body).toBe(201);
    tripId = t.json().id;
    expect(t.json()).toMatchObject({ status: 'dispatched', vehicleRegistrationNo: reg });
    expect(t.json().number).toMatch(/^AMB\d{6}$/);

    const other = (await call(reception, 'POST', '/ops/ambulance/trips', { contactName: 'Walk-in caller', contactMobile: '9876500001', pickupAddress: 'Bus stand' })).json();
    expect((await call(reception, 'POST', `/ops/ambulance/trips/${other.id}/actions`, { action: 'dispatch', vehicleId })).statusCode).toBe(409);

    expect((await call(reception, 'POST', `/ops/ambulance/trips/${tripId}/actions`, { action: 'onboard' })).statusCode).toBe(200);
    const done = await call(reception, 'POST', `/ops/ambulance/trips/${tripId}/actions`, { action: 'complete', distanceKm: 12, bill: true });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'completed', distanceKm: 12, charge: 800 });
    const invoiceId = done.json().invoiceId;
    expect(invoiceId).toBeTruthy();

    const inv = (await call(admin, 'GET', `/billing/invoices/${invoiceId}`)).json();
    expect(inv).toMatchObject({ status: 'final', total: 800, patientId });

    const vehicles = (await call(reception, 'GET', '/ops/ambulance/vehicles')).json();
    expect(vehicles.find((x: { id: string }) => x.id === vehicleId).status).toBe('available');

    const noPatient = await call(reception, 'POST', `/ops/ambulance/trips/${other.id}/actions`, { action: 'dispatch', vehicleId });
    expect(noPatient.statusCode).toBe(200);
    const unbilled = await call(reception, 'POST', `/ops/ambulance/trips/${other.id}/actions`, { action: 'complete', distanceKm: 3, bill: true });
    expect(unbilled.statusCode).toBe(400);
    const cancelled = await call(reception, 'POST', `/ops/ambulance/trips/${other.id}/actions`, { action: 'cancel', reason: 'Caller went by own vehicle' });
    expect(cancelled.json().status).toBe('cancelled');
  });

  it('lets billing see trips but not dispatch them', async () => {
    expect((await call(clerk, 'GET', '/ops/ambulance/trips?active=false')).statusCode).toBe(200);
    expect((await call(clerk, 'POST', '/ops/ambulance/trips', { contactName: 'X', contactMobile: '9876500002', pickupAddress: 'Y' })).statusCode).toBe(403);
    expect((await call(nurse, 'GET', '/ops/ambulance/vehicles')).statusCode).toBe(403);
  });
});

describe('diet kitchen', () => {
  it('orders, replaces and serves diets with allergy and NPO checks', async () => {
    expect((await call(reception, 'POST', '/ops/diet/orders', { patientId, location: 'Ward 2 / Bed 4', dietType: 'soft' })).statusCode).toBe(403);
    const first = await call(nurse, 'POST', '/ops/diet/orders', { patientId, location: 'Ward 2 / Bed 4', dietType: 'soft' });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({ status: 'active', allergies: ['Peanuts'], patientName: `Ops Patient${tag}` });
    const second = await call(doctor, 'POST', '/ops/diet/orders', { patientId, location: 'Ward 2 / Bed 4', dietType: 'diabetic', vegetarian: false });
    expect(second.statusCode).toBe(201);
    const history = (await call(nurse, 'GET', `/ops/diet/orders?patientId=${patientId}`)).json();
    expect(history.items.map((o: { status: string }) => o.status).sort()).toEqual(['active', 'stopped']);

    const npo = (await call(doctor, 'POST', '/ops/diet/orders', { patientId: npoPatientId, location: 'ICU / Bed 1', dietType: 'npo' })).json();

    const sheet = (await call(nurse, 'GET', '/ops/diet/kitchen-sheet?meal=lunch')).json();
    const row = sheet.rows.find((r: { id: string }) => r.id === second.json().id);
    expect(row).toMatchObject({ dietType: 'diabetic', allergies: ['Peanuts'], mealStatus: null });
    expect(sheet.counts.find((c: { dietType: string }) => c.dietType === 'diabetic').nonVegetarian).toBeGreaterThanOrEqual(1);
    expect(sheet.counts.find((c: { dietType: string }) => c.dietType === 'npo')).toBeUndefined();

    expect((await call(nurse, 'POST', '/ops/diet/meals', { orderId: second.json().id, meal: 'lunch', status: 'delivered' })).statusCode).toBe(403);
    expect((await call(admin, 'POST', '/ops/diet/meals', { orderId: npo.id, meal: 'lunch', status: 'delivered' })).statusCode).toBe(409);
    expect((await call(admin, 'POST', '/ops/diet/meals', { orderId: second.json().id, meal: 'lunch', status: 'prepared' })).statusCode).toBe(200);
    expect((await call(admin, 'POST', '/ops/diet/meals', { orderId: second.json().id, meal: 'lunch', status: 'delivered' })).statusCode).toBe(200);
    const after = (await call(nurse, 'GET', '/ops/diet/kitchen-sheet?meal=lunch')).json();
    expect(after.rows.find((r: { id: string }) => r.id === second.json().id).mealStatus).toBe('delivered');

    expect((await call(nurse, 'POST', `/ops/diet/orders/${npo.id}/stop`)).json().status).toBe('stopped');
    expect((await call(nurse, 'POST', `/ops/diet/orders/${npo.id}/stop`)).statusCode).toBe(409);
  });
});

describe('housekeeping', () => {
  it('runs a request from raised to verified', async () => {
    const res = await call(reception, 'POST', '/ops/housekeeping/tasks', { location: `Room ${tag}`, kind: 'discharge_clean', priority: 'urgent' });
    expect(res.statusCode, res.body).toBe(201);
    const task = res.json();
    expect(task.number).toMatch(/^HK\d{6}$/);
    const dueIn = (new Date(task.dueAt).getTime() - Date.now()) / 60000;
    expect(Math.round(dueIn)).toBe(30);

    expect((await call(reception, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { status: 'done' })).statusCode).toBe(403);
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { status: 'verified' })).statusCode).toBe(409);
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { assignedTo: 'Sunita', status: 'in_progress' })).json().startedAt).not.toBeNull();
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { status: 'done' })).json().status).toBe('done');
    const verified = (await call(admin, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { status: 'verified', remarks: 'Checked' })).json();
    expect(verified).toMatchObject({ status: 'verified', assignedTo: 'Sunita', overdue: false });
    expect(verified.verifiedBy).toBeTruthy();
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${task.id}`, { status: 'in_progress' })).statusCode).toBe(409);

    const open = (await call(nurse, 'GET', '/ops/housekeeping/tasks?open=true')).json();
    expect(open.items.find((t: { id: string }) => t.id === task.id)).toBeUndefined();
  });
});

describe('overview', () => {
  it('shows the summary to anyone with an ops read permission', async () => {
    const s = await call(admin, 'GET', '/ops/summary');
    expect(s.statusCode, s.body).toBe(200);
    expect(s.json().assets.total).toBeGreaterThanOrEqual(1);
    expect(s.json().linen.belowPar).toBeGreaterThanOrEqual(1);
    expect((await call(clerk, 'GET', '/ops/summary')).statusCode).toBe(200);
    expect((await call(pharmacist, 'GET', '/ops/summary')).statusCode).toBe(403);
  });
});

describe('plan entitlement', () => {
  it('blocks hospitals whose plan has no Facility Services', async () => {
    const res = await call(city, 'GET', '/ops/assets', undefined, cityFacilityId);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });
});

describe('cross-hospital isolation', () => {
  it('another hospital sees none of these records and cannot act on them', async () => {
    const demoAsset = (await call(admin, 'GET', `/ops/assets?q=${tag}`)).json().items[0];
    expect((await otherCall('GET', `/ops/assets/${demoAsset.id}`)).statusCode).toBe(404);
    expect((await otherCall('GET', `/ops/assets?q=${tag}`)).json().total).toBe(0);
    expect((await otherCall('POST', '/ops/work-orders', { assetId: demoAsset.id, type: 'breakdown', problem: 'x' })).statusCode).toBe(404);

    const demoSet = (await call(admin, 'GET', `/ops/cssd/sets?q=${tag}`)).json()[0];
    expect((await otherCall('POST', '/ops/cssd/cycles', { sterilizer: 'A', setIds: [demoSet.id] })).statusCode).toBe(404);
    expect((await otherCall('GET', `/ops/cssd/sets?q=${tag}`)).json()).toHaveLength(0);

    const demoTrip = (await call(admin, 'GET', '/ops/ambulance/trips')).json().items[0];
    expect((await otherCall('GET', `/ops/ambulance/trips/${demoTrip.id}`)).statusCode).toBe(404);
    expect((await otherCall('POST', '/ops/ambulance/trips', { patientId, contactName: 'X', contactMobile: '9876500003', pickupAddress: 'Y' })).statusCode).toBe(404);
    expect((await otherCall('POST', '/ops/diet/orders', { patientId, location: 'W', dietType: 'normal' })).statusCode).toBe(404);

    const otherStock = (await otherCall('GET', '/ops/linen/stock')).json();
    expect(otherStock.find((s: { name: string }) => s.name === `Bedsheet ${tag}`)).toBeUndefined();
    const otherHk = (await otherCall('GET', '/ops/housekeeping/tasks')).json();
    expect(otherHk.items.find((t: { location: string }) => t.location === `Room ${tag}`)).toBeUndefined();
  });
});

describe('editing facility-services masters', () => {
  it('edits a CSSD set without resetting fields it did not send', async () => {
    const set = (await call(admin, 'POST', '/ops/cssd/sets', { name: `Edit set ${tag}`, department: 'OT 2', contents: ['Forceps x2'], shelfLifeDays: 20 })).json();
    const renamed = await call(admin, 'PATCH', `/ops/cssd/sets/${set.id}`, { name: `Edited set ${tag}` });
    expect(renamed.statusCode, renamed.body).toBe(200);
    // Partial update keeps contents and shelf life (Zod defaults are not re-applied).
    expect(renamed.json()).toMatchObject({ name: `Edited set ${tag}`, contents: ['Forceps x2'], shelfLifeDays: 20, department: 'OT 2' });
    const cleared = (await call(admin, 'PATCH', `/ops/cssd/sets/${set.id}`, { department: null, contents: ['Forceps x4', 'Scissors'], isActive: false })).json();
    expect(cleared).toMatchObject({ department: null, contents: ['Forceps x4', 'Scissors'], isActive: false, shelfLifeDays: 20 });
    expect((await call(admin, 'PATCH', `/ops/cssd/sets/${set.id}`, { shelfLifeDays: 0 })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ops/cssd/sets/${set.id}`, { name: '' })).statusCode).toBe(400);
    expect((await call(nurse, 'PATCH', `/ops/cssd/sets/${set.id}`, { name: 'Nope' })).statusCode).toBe(403);
  });

  it('edits a linen item: keeps par level, refuses duplicates and negatives', async () => {
    const a = (await call(admin, 'POST', '/ops/linen/items', { name: `Pillow cover ${tag}`, parLevel: 25 })).json();
    const b = (await call(admin, 'POST', '/ops/linen/items', { name: `Towel ${tag}`, parLevel: 10 })).json();
    const off = (await call(admin, 'PATCH', `/ops/linen/items/${a.id}`, { isActive: false })).json();
    expect(off).toMatchObject({ isActive: false, parLevel: 25 });
    expect((await call(admin, 'PATCH', `/ops/linen/items/${a.id}`, { name: `towel ${tag}` })).statusCode).toBe(409);
    expect((await call(admin, 'PATCH', `/ops/linen/items/${a.id}`, { parLevel: -1 })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ops/linen/items/${b.id}`, { name: `Bath towel ${tag}` })).json().name).toBe(`Bath towel ${tag}`);
    expect((await call(doctor, 'PATCH', `/ops/linen/items/${b.id}`, { parLevel: 1 })).statusCode).toBe(403);
  });

  it('edits an ambulance: keeps its type, clears the driver, refuses a taken registration and bad mobile', async () => {
    const r1 = `MH14${tag.slice(-6)}`;
    const r2 = `MH15${tag.slice(-6)}`;
    const v1 = (await call(admin, 'POST', '/ops/ambulance/vehicles', { registrationNo: r1, type: 'als', driverName: 'Ravi', driverMobile: '9876500000' })).json();
    await call(admin, 'POST', '/ops/ambulance/vehicles', { registrationNo: r2 });
    const edited = (await call(admin, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { baseCharge: 750 })).json();
    expect(edited).toMatchObject({ type: 'als', baseCharge: 750, driverName: 'Ravi' });
    const cleared = (await call(admin, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { driverName: null, driverMobile: null })).json();
    expect(cleared).toMatchObject({ driverName: null, driverMobile: null });
    expect((await call(admin, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { registrationNo: r2 })).statusCode).toBe(409);
    expect((await call(admin, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { driverMobile: '12345' })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { ratePerKm: -2 })).statusCode).toBe(400);
    expect((await call(doctor, 'PATCH', `/ops/ambulance/vehicles/${v1.id}`, { baseCharge: 1 })).statusCode).toBe(403);
  });

  it('edits an open housekeeping task, not a closed one', async () => {
    const t = (await call(reception, 'POST', '/ops/housekeeping/tasks', { location: `Bay ${tag}`, priority: 'low' })).json();
    const due = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const res = await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { location: `Bay 2 ${tag}`, kind: 'spill', priority: 'urgent', description: 'Spill near bed', dueAt: due });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ location: `Bay 2 ${tag}`, kind: 'spill', priority: 'urgent', description: 'Spill near bed', status: 'pending' });
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { description: null, dueAt: null })).json()).toMatchObject({ description: null, dueAt: null });
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { location: '' })).statusCode).toBe(400);
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { priority: 'asap' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { location: 'x' })).statusCode).toBe(403);
    await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { status: 'done' });
    expect((await call(admin, 'PATCH', `/ops/housekeeping/tasks/${t.id}`, { location: 'Late' })).json().error.code).toBe('task_closed');
  });
});
