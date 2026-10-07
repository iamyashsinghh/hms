import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, sql, upsertUser } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let reception: string;
let doctor: string;
let doctorId: string;
let nurse: string;
let billingClerk: string;
let radiologist: string;
let otherHospital: string;
let tenantId: string;
let facilityId: string;
let patientId: string;
let modalityId: string;
let testId: string;
let testName: string;

const suffix = Date.now().toString(36).toUpperCase();
const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload });

async function newPatient() {
  const res = await inject('POST', '/patients', reception, { firstName: 'Rad', lastName: `Test${suffix}${Math.random().toString(36).slice(2, 6)}`, gender: 'female', ageYears: 52 });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function newOrder(token = reception, extra: object = {}) {
  const res = await inject('POST', '/radiology/orders', token, { patientId, testId, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json();
}

/** A far-future slot unique to this run so repeated runs never clash on the shared demo hospital. */
const slotBase = (() => {
  const base = new Date(Date.UTC(2030 + (Date.now() % 60), 0, 1, 4, 0, 0));
  base.setUTCDate(base.getUTCDate() + (Math.floor(Date.now() / 1000) % 300));
  return base.getTime();
})();
function slot(minutesFromBase: number) {
  return new Date(slotBase + minutesFromBase * 60_000).toISOString();
}

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  const d = await login(app, 'doctor@demo.hms');
  doctor = d.accessToken;
  doctorId = d.user.id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  billingClerk = (await login(app, 'billing@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;

  // The seed has no radiologist yet; add one (a new user, so other suites' data is untouched).
  const pool = createPool(process.env.DATABASE_MIGRATOR_URL!);
  const client = await pool.connect();
  try {
    await upsertUser(client, tenantId, { name: 'Dr. Radiology E2E', email: 'radiologist.e2e@demo.hms', mobile: '9000000091', password: 'Demo@12345', roleKeys: ['radiologist'] });
  } finally {
    client.release();
    await pool.end();
  }
  radiologist = (await login(app, 'radiologist.e2e@demo.hms')).accessToken;
  patientId = await newPatient();
});
afterAll(() => app.close());

describe('radiology masters', () => {
  it('loads the starter list once', async () => {
    const first = await inject('POST', '/radiology/masters/starter', admin);
    expect(first.statusCode).toBe(200);
    const again = await inject('POST', '/radiology/masters/starter', admin);
    expect(again.json()).toEqual({ modalities: 0, tests: 0, templates: 0 });
    const tests = (await inject('GET', '/radiology/tests?q=chest', doctor)).json();
    expect(tests.map((t: { code: string }) => t.code)).toContain('XR-CHEST-PA');
  });

  it('creates a modality, a template and a test', async () => {
    let res = await inject('POST', '/radiology/modalities', admin, { code: `E2E${suffix}`.slice(0, 20), name: `E2E USG ${suffix}`, kind: 'US', room: 'Room 4' });
    expect(res.statusCode).toBe(201);
    modalityId = res.json().id;

    const dup = await inject('POST', '/radiology/modalities', admin, { code: `E2E${suffix}`.slice(0, 20), name: 'dup', kind: 'US' });
    expect(dup.statusCode).toBe(409);

    res = await inject('POST', '/radiology/templates', radiologist, { name: `E2E normal ${suffix}`, modalityId, findings: 'Normal study.', impression: 'Normal.' });
    expect(res.statusCode).toBe(201);
    const templateId = res.json().id;

    testName = `E2E USG KUB ${suffix}`;
    res = await inject('POST', '/radiology/tests', admin, {
      code: `E2E-KUB-${suffix}`,
      name: testName,
      modalityId,
      price: 900,
      taxRate: 0,
      durationMinutes: 20,
      preparation: 'Full bladder',
      defaultTemplateId: templateId,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ price: 900, durationMinutes: 20, modalityName: `E2E USG ${suffix}` });
    testId = res.json().id;

    const noPrice = await inject('POST', '/radiology/tests', admin, { code: `E2E-NP-${suffix}`, name: 'No price', modalityId });
    expect(noPrice.statusCode).toBe(400);
  });

  it('keeps masters to their roles', async () => {
    expect((await inject('POST', '/radiology/modalities', doctor, { code: 'X', name: 'x', kind: 'XR' })).statusCode).toBe(403);
    expect((await inject('POST', '/radiology/masters/starter', reception)).statusCode).toBe(403);
    expect((await inject('GET', '/radiology/tests', doctor)).statusCode).toBe(200);
  });
});

describe('radiology order to report', () => {
  let order: { id: string; orderNo: string };

  it('creates an order at the desk', async () => {
    order = await newOrder(reception, { referringDoctorName: 'Dr. Outside', priority: 'urgent' });
    expect(order.orderNo).toMatch(/^RAD\d{6}$/);
    expect(order).toMatchObject({ status: 'ordered', source: 'desk', studyName: testName, modalityId, priority: 'urgent' });
    expect((await inject('POST', '/radiology/orders', nurse, { patientId, testId })).statusCode).toBe(403);
  });

  it('books a machine slot and refuses a clash', async () => {
    let res = await inject('POST', `/radiology/orders/${order.id}/schedule`, reception, { scheduledAt: slot(0) });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('scheduled');
    expect(new Date(res.json().scheduledEnd).getTime() - new Date(res.json().scheduledAt).getTime()).toBe(20 * 60_000);

    const other = await newOrder();
    res = await inject('POST', `/radiology/orders/${other.id}/schedule`, reception, { scheduledAt: slot(10) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('slot_taken');
    res = await inject('POST', `/radiology/orders/${other.id}/schedule`, reception, { scheduledAt: slot(20) });
    expect(res.statusCode).toBe(200);

    const day = slot(0).slice(0, 10);
    const schedule = (await inject('GET', `/radiology/schedule?date=${day}&modalityId=${modalityId}`, doctor)).json();
    expect(schedule.map((s: { orderId: string }) => s.orderId)).toEqual(expect.arrayContaining([order.id, other.id]));

    // Cancelling frees the slot.
    res = await inject('POST', `/radiology/orders/${other.id}/cancel`, reception, { reason: 'Patient left' });
    expect(res.json().status).toBe('cancelled');
    const third = await newOrder();
    res = await inject('POST', `/radiology/orders/${third.id}/schedule`, reception, { scheduledAt: slot(20) });
    expect(res.statusCode).toBe(200);
  });

  it('bills the order once through billing', async () => {
    const res = await inject('POST', `/radiology/orders/${order.id}/bill`, billingClerk, { payNow: { mode: 'cash', amount: 900 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().invoiceNo).toMatch(/^INV/);
    const invoice = await inject('GET', `/billing/invoices/${res.json().invoiceId}`, billingClerk);
    expect(invoice.statusCode).toBe(200);
    expect(invoice.json()).toMatchObject({ total: 900, patientId });
    expect(invoice.json()).toMatchObject({ sourceModule: 'radiology', sourceRef: order.id });

    const again = await inject('POST', `/radiology/orders/${order.id}/bill`, billingClerk, {});
    expect(again.statusCode).toBe(409);
    expect((await inject('POST', `/radiology/orders/${order.id}/bill`, nurse, {})).statusCode).toBe(403);
  });

  it('runs the scan', async () => {
    expect((await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'x', impression: 'y' })).statusCode).toBe(409);
    let res = await inject('POST', `/radiology/orders/${order.id}/start`, radiologist);
    expect(res.json().status).toBe('in_progress');
    res = await inject('POST', `/radiology/orders/${order.id}/complete`, radiologist, { studyUid: '1.2.840.113619.2.1', imagesUrl: 'https://pacs.example.test/viewer?study=1' });
    expect(res.json()).toMatchObject({ status: 'acquired', studyUid: '1.2.840.113619.2.1' });
  });

  it('writes, signs and locks the report', async () => {
    expect((await inject('PUT', `/radiology/orders/${order.id}/report`, doctor, { findings: 'x', impression: 'y' })).statusCode).toBe(403);
    let res = await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'Both kidneys normal.', impression: 'Normal study.' });
    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe('reported');
    expect(res.json().reports[0]).toMatchObject({ version: 1, status: 'draft', authorName: 'Dr. Radiology E2E' });

    res = await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'Both kidneys normal. No calculus.', impression: 'Normal study.', isCritical: false });
    expect(res.json().reports).toHaveLength(1);

    expect((await inject('POST', `/radiology/orders/${order.id}/report/finalize`, doctor)).statusCode).toBe(403);
    res = await inject('POST', `/radiology/orders/${order.id}/report/finalize`, radiologist);
    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe('finalized');
    const report = res.json().reports[0];
    expect(report).toMatchObject({ status: 'final', finalizedByName: 'Dr. Radiology E2E' });
    expect(res.json().order.finalReportId).toBe(report.id);

    const db = app.get(DbService);
    const events = await db.asTenant({ tenantId }, async (tx) =>
      (await tx.execute<{ payload: Record<string, unknown> }>(sql`select payload from audit.outbox where topic = 'radiology.report.finalized' and payload->>'reportId' = ${report.id}`)).rows,
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ reportId: report.id, patientId, title: testName, version: 1 });
    expect(new Date(events[0]!.payload.issuedAt as string).toISOString()).toBe(events[0]!.payload.issuedAt);

    // Locked: no edits through the API or straight in the database.
    res = await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'changed', impression: 'changed' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('report_finalized');
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`update radiology.reports set findings = 'x' where id = ${report.id}`))).rejects.toThrow();
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`delete from radiology.reports where id = ${report.id}`))).rejects.toThrow();
    expect((await inject('POST', `/radiology/orders/${order.id}/cancel`, reception, { reason: 'too late' })).statusCode).toBe(409);

    const printable = await inject('GET', `/radiology/reports/${report.id}`, doctor);
    expect(printable.statusCode).toBe(200);
    expect(printable.json().order.patient.uhid).toMatch(/^UH/);
    expect((await inject('GET', `/radiology/reports/${report.id}`, billingClerk)).statusCode).toBe(403);
  });

  it('amends a signed report as a new version', async () => {
    let res = await inject('POST', `/radiology/orders/${order.id}/report/amend`, radiologist, { reason: 'Missed a small left renal cyst' });
    expect(res.statusCode).toBe(200);
    expect(res.json().reports.map((r: { version: number; status: string }) => [r.version, r.status])).toEqual([[2, 'draft'], [1, 'final']]);
    res = await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'Left kidney: 8 mm simple cyst.', impression: 'Simple left renal cyst.' });
    expect(res.statusCode).toBe(200);
    res = await inject('POST', `/radiology/orders/${order.id}/report/finalize`, radiologist);
    expect(res.json().reports.map((r: { version: number; status: string }) => [r.version, r.status])).toEqual([[2, 'final'], [1, 'superseded']]);
    const doc = (await inject('GET', `/radiology/reports/${res.json().reports[0].id}`, doctor)).json();
    expect(doc.report.amendmentReason).toContain('cyst');
    expect(doc.history).toHaveLength(1);
  });

  it('lists the reporting worklist', async () => {
    const res = await inject('GET', `/radiology/orders?statuses=finalized&modalityId=${modalityId}`, radiologist);
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(res.json().items.every((o: { status: string }) => o.status === 'finalized')).toBe(true);
  });
});

describe('radiology orders from EMR', () => {
  it('imports radiology lines from a signed consultation once', async () => {
    let res = await inject('POST', '/emr/encounters', doctor, { patientId });
    expect(res.statusCode).toBe(201);
    const encounterId = res.json().id;
    await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { notes: { chiefComplaints: 'Flank pain' } });
    res = await inject('PUT', `/emr/encounters/${encounterId}/orders`, doctor, {
      orders: [
        { kind: 'radiology', name: testName.toLowerCase(), priority: 'urgent' },
        { kind: 'radiology', name: `Something unlisted ${suffix}` },
        { kind: 'lab', name: 'Urine routine' },
      ],
    });
    expect(res.statusCode).toBe(200);
    res = await inject('POST', `/emr/encounters/${encounterId}/sign`, doctor);
    expect(res.statusCode).toBe(200);

    const event = { id: randomUUID(), tenantId, topic: 'emr.encounter.signed', payload: { encounterId, patientId, doctorId }, createdAt: new Date().toISOString() };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch({ ...event, id: randomUUID() });

    const items = (await inject('GET', `/radiology/orders?patientId=${patientId}&pageSize=200`, reception)).json().items.filter(
      (o: { encounterId: string | null }) => o.encounterId === encounterId,
    );
    expect(items).toHaveLength(2);
    const matched = items.find((o: { testId: string | null }) => o.testId === testId);
    expect(matched).toMatchObject({ source: 'emr', priority: 'urgent', referringDoctorId: doctorId, referringDoctorName: 'Dr. Asha Rao' });
    const unmatched = items.find((o: { testId: string | null }) => o.testId === null);
    expect(unmatched.studyName).toBe(`Something unlisted ${suffix}`);

    // The desk picks the test for the unmatched line, then it can be booked.
    expect((await inject('POST', `/radiology/orders/${unmatched.id}/schedule`, reception, { scheduledAt: slot(600) })).statusCode).toBe(400);
    res = await inject('PATCH', `/radiology/orders/${unmatched.id}`, reception, { testId });
    expect(res.json()).toMatchObject({ testId, studyName: testName });
  });
});

describe('radiology hospital isolation', () => {
  it("never shows or changes one hospital's radiology data from another", async () => {
    const order = await newOrder();
    // The city admin holds radiology.order.read, so these reach the database and RLS hides demo's rows.
    const cityGet = await app.inject({ method: 'GET', url: `/api/v1/radiology/orders/${order.id}`, headers: bearer(otherHospital) });
    expect(cityGet.statusCode).toBe(404);
    const cityList = await app.inject({ method: 'GET', url: `/api/v1/radiology/orders?patientId=${patientId}`, headers: bearer(otherHospital) });
    expect(cityList.json().items).toEqual([]);
    const cityTests = await app.inject({ method: 'GET', url: `/api/v1/radiology/tests?q=${encodeURIComponent(testName)}`, headers: bearer(otherHospital) });
    expect(cityTests.json()).toEqual([]);
    const citySchedule = await app.inject({ method: 'POST', url: `/api/v1/radiology/orders/${order.id}/schedule`, headers: bearer(otherHospital), payload: { scheduledAt: slot(900) } });
    expect(citySchedule.statusCode).toBe(404);

    const cityTenant = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(otherHospital) })).json().tenantId;
    const db = app.get(DbService);
    const changed = await db.asTenant({ tenantId: cityTenant }, async (tx) => (await tx.execute(sql`update radiology.orders set clinical_notes = 'x' where id = ${order.id}`)).rowCount);
    expect(changed).toBe(0);
    await expect(
      db.asTenant({ tenantId: cityTenant }, (tx) =>
        tx.execute(sql`insert into radiology.modalities (tenant_id, code, name, kind) values (${tenantId}, 'HACK', 'x', 'XR')`),
      ),
    ).rejects.toThrow();
  });
});
