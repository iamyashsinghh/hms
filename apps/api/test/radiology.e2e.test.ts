import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, DEMO_PASSWORD, provisionTenant, sql } from '@hms/db';
import type { billing, radiology } from '@hms/shared';
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

/**
 * A future slot for this run (slots may be booked at most a year ahead). Each run makes its own
 * machine, so runs never clash; the day still varies so a run never lands on a past time.
 */
const slotBase = (() => {
  const base = new Date();
  base.setUTCHours(4, 0, 0, 0);
  base.setUTCDate(base.getUTCDate() + 2 + (Math.floor(Date.now() / 1000) % 300));
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

  radiologist = (await login(app, 'radiology@demo.hms')).accessToken;
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

  it('edits masters without resetting the fields it was not sent', async () => {
    let res = await inject('PATCH', `/radiology/modalities/${modalityId}`, admin, { room: 'Room 5' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ room: 'Room 5', kind: 'US', isActive: true, name: `E2E USG ${suffix}` });

    res = await inject('PATCH', `/radiology/tests/${testId}`, admin, { price: 950 });
    expect(res.statusCode, res.body).toBe(200);
    // durationMinutes/taxRate/contrast/isActive have create defaults that must not creep into a partial update.
    expect(res.json()).toMatchObject({ price: 950, durationMinutes: 20, taxRate: 0, contrast: false, isActive: true, preparation: 'Full bladder' });
    res = await inject('PATCH', `/radiology/tests/${testId}`, admin, { price: 900, preparation: '' });
    expect(res.json()).toMatchObject({ price: 900, preparation: null, durationMinutes: 20 });
    for (const bad of [{ price: -1 }, { durationMinutes: 2 }, { taxRate: 50 }, { name: '' }]) {
      expect((await inject('PATCH', `/radiology/tests/${testId}`, admin, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }

    const tpl = (await inject('GET', `/radiology/templates?modalityId=${modalityId}`, radiologist)).json()[0];
    res = await inject('PATCH', `/radiology/templates/${tpl.id}`, radiologist, { impression: 'Normal study.' });
    expect(res.json()).toMatchObject({ impression: 'Normal study.', findings: 'Normal study.', isActive: true });

    expect((await inject('PATCH', `/radiology/tests/${testId}`, doctor, { price: 1 })).statusCode).toBe(403);
    expect((await inject('PATCH', `/radiology/modalities/${modalityId}`, reception, { room: 'x' })).statusCode).toBe(403);
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

  it('edits the priority, referrer and notes before the scan', async () => {
    let res = await inject('PATCH', `/radiology/orders/${order.id}`, reception, { clinicalNotes: 'Right flank pain, ? calculus' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ clinicalNotes: 'Right flank pain, ? calculus', priority: 'urgent', referringDoctorName: 'Dr. Outside' });
    res = await inject('PATCH', `/radiology/orders/${order.id}`, doctor, { priority: 'stat', referringDoctorName: 'Dr. Outside Clinic' });
    expect(res.json()).toMatchObject({ priority: 'stat', referringDoctorName: 'Dr. Outside Clinic', clinicalNotes: 'Right flank pain, ? calculus' });
    expect((await inject('PATCH', `/radiology/orders/${order.id}`, reception, { priority: 'asap' })).statusCode).toBe(400);
    expect((await inject('PATCH', `/radiology/orders/${order.id}`, reception, { clinicalNotes: 'x'.repeat(1001) })).statusCode).toBe(400);
    expect((await inject('PATCH', `/radiology/orders/${order.id}`, nurse, { priority: 'routine' })).statusCode).toBe(403);
    expect((await inject('PATCH', `/radiology/orders/${order.id}`, billingClerk, { priority: 'routine' })).statusCode).toBe(403);
    res = await inject('PATCH', `/radiology/orders/${order.id}`, reception, { priority: 'urgent' });
    expect(res.json().priority).toBe('urgent');
  });

  it('refuses to book a slot in the past', async () => {
    const res = await inject('POST', `/radiology/orders/${order.id}/schedule`, reception, { scheduledAt: '2020-01-01T10:00:00+05:30' });
    expect(res.statusCode).toBe(400);
    // The shared schema refuses it before the service's own slot_in_past check.
    expect(res.json().error.message).toContain('Slot time cannot be in the past');
  });

  it('does not edit a cancelled order', async () => {
    const o = await newOrder();
    expect((await inject('POST', `/radiology/orders/${o.id}/cancel`, admin, { reason: 'Duplicate order' })).statusCode).toBe(200);
    const res = await inject('PATCH', `/radiology/orders/${o.id}`, reception, { priority: 'stat' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('order_cancelled');
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
    expect(res.json().reports[0]).toMatchObject({ version: 1, status: 'draft', authorName: 'Dr. Vikram Iyer' });

    res = await inject('PUT', `/radiology/orders/${order.id}/report`, radiologist, { findings: 'Both kidneys normal. No calculus.', impression: 'Normal study.', isCritical: false });
    expect(res.json().reports).toHaveLength(1);

    expect((await inject('POST', `/radiology/orders/${order.id}/report/finalize`, doctor)).statusCode).toBe(403);
    res = await inject('POST', `/radiology/orders/${order.id}/report/finalize`, radiologist);
    expect(res.statusCode).toBe(200);
    expect(res.json().order.status).toBe('finalized');
    const report = res.json().reports[0];
    expect(report).toMatchObject({ status: 'final', finalizedByName: 'Dr. Vikram Iyer' });
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
        { kind: 'radiology', name: `Something unlisted ${suffix}`, priority: 'urgent' },
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
    // Picking the test keeps the doctor's priority (it used to fall back to routine).
    expect(unmatched.priority).not.toBe('routine');
    expect(res.json()).toMatchObject({ testId, studyName: testName, priority: unmatched.priority });
  });
});

describe('radiology charges on the patient account', () => {
  const s = Math.random().toString(36).slice(2, 6).toUpperCase();
  const svcCode = `RSV${suffix}${s}`.slice(0, 40);
  let svcTestId: string;
  let ownTestId: string;
  let pid: string;

  async function charges(orderId: string) {
    const res = await inject('GET', `/billing/charges?patientId=${pid}&sourceModule=radiology&pageSize=500`, admin);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().items as billing.Charge[]).filter((c) => c.sourceRef === orderId);
  }
  const setRules = (rules: Partial<billing.BillingRules>) => inject('PUT', '/billing/rules', admin, { rules });
  const resetRules = () => inject('PUT', '/billing/rules', admin, { replace: true, rules: {} });
  const order = async (test: string, extra: object = {}) => {
    const res = await inject('POST', '/radiology/orders', reception, { patientId: pid, testId: test, ...extra });
    expect(res.statusCode, res.body).toBe(201);
    return res.json() as radiology.RadiologyOrder;
  };

  /** Runs the billing.charges.billed event of an invoice through the bus, as the worker would. */
  async function deliverBilled(invoiceId: string) {
    const rows = await app.get(DbService).asTenant({ tenantId }, async (tx) => {
      const r = await tx.execute<{ payload: Record<string, unknown> }>(
        sql`select payload from audit.outbox where topic = 'billing.charges.billed' and payload->>'invoiceId' = ${invoiceId}`,
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    const event = { id: randomUUID(), tenantId, topic: 'billing.charges.billed', payload: rows[0]!.payload, createdAt: new Date().toISOString() };
    await app.get(EventBus).dispatch(event);
    await app.get(EventBus).dispatch({ ...event, id: randomUUID() });
  }

  beforeAll(async () => {
    await resetRules();
    pid = await newPatient();
    const svc = await inject('POST', '/billing/services', admin, { code: svcCode, name: `CT head ${s}`, category: 'radiology', basePrice: 2500, taxRate: 0 });
    expect(svc.statusCode, svc.body).toBe(201);
    let res = await inject('POST', '/radiology/tests', admin, { code: `CTH-${suffix}${s}`, name: `CT head ${s}`, modalityId, serviceCode: svcCode, durationMinutes: 15 });
    expect(res.statusCode, res.body).toBe(201);
    svcTestId = res.json().id;
    res = await inject('POST', '/radiology/tests', admin, { code: `XRC-${suffix}${s}`, name: `X-ray chest ${s}`, modalityId, price: 400, taxRate: 5, durationMinutes: 10 });
    expect(res.statusCode, res.body).toBe(201);
    ownTestId = res.json().id;
  });
  afterAll(() => resetRules());

  it('posts the charge when ordered (the default rule), priced from the service or the test', async () => {
    const a = await order(svcTestId);
    expect(a).toMatchObject({ paymentState: 'pending', payFirst: true, invoiceId: null });
    expect(await charges(a.id)).toMatchObject([{ status: 'pending', sourceLine: svcTestId, serviceCode: svcCode, unitPrice: 2500, description: `CT head ${s}` }]);
    const b = await order(ownTestId);
    expect(await charges(b.id)).toMatchObject([{ status: 'pending', sourceLine: ownTestId, serviceCode: null, unitPrice: 400, taxRate: 5, amount: 420 }]);
  });

  it('moves the charge when the study is changed, and keeps the bill number once billed at the desk', async () => {
    const o = await order(ownTestId);
    let res = await inject('PATCH', `/radiology/orders/${o.id}`, reception, { testId: svcTestId });
    expect(res.statusCode, res.body).toBe(200);
    const posted = await charges(o.id);
    expect(posted.map((c) => [c.sourceLine, c.status])).toEqual([
      [ownTestId, 'cancelled'],
      [svcTestId, 'pending'],
    ]);

    const bill = await inject('POST', '/billing/charges/bill', admin, { patientId: pid, chargeIds: [posted[1]!.id] });
    expect(bill.statusCode, bill.body).toBe(201);
    const inv = bill.json() as billing.Invoice;
    // Billed but the event has not arrived yet: the study can no longer be changed.
    res = await inject('PATCH', `/radiology/orders/${o.id}`, reception, { testId: ownTestId });
    expect(res.statusCode).toBe(409);
    await deliverBilled(inv.id);
    const after = (await inject('GET', `/radiology/orders/${o.id}`, reception)).json().order as radiology.RadiologyOrder;
    expect(after).toMatchObject({ invoiceId: inv.id, invoiceNo: inv.number, paymentState: 'unpaid' });
    const list = (await inject('GET', `/radiology/orders?patientId=${pid}&pageSize=200`, reception)).json().items as radiology.RadiologyOrder[];
    expect(list.find((x) => x.id === o.id)?.paymentState).toBe('unpaid');
  });

  it('charges when the scan is done when the hospital says so, and bills through the old endpoint', async () => {
    expect((await setRules({ radiologyChargeAt: 'scan_done' })).statusCode).toBe(200);
    try {
      const o = await order(ownTestId);
      expect(o.paymentState).toBe('none');
      expect(await charges(o.id)).toHaveLength(0);
      let res = await inject('POST', `/radiology/orders/${o.id}/complete`, radiologist, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().paymentState).toBe('pending');
      expect((await charges(o.id)).map((c) => c.status)).toEqual(['pending']);

      // Bill now before the scan: the charge is posted and billed at once, and paid.
      const p = await order(svcTestId);
      res = await inject('POST', `/radiology/orders/${p.id}/bill`, billingClerk, { payNow: { mode: 'cash', amount: 2500 } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ paymentState: 'paid' });
      expect(res.json().invoiceNo).toMatch(/^INV/);
      const [c] = await charges(p.id);
      expect(c).toMatchObject({ status: 'billed', invoiceId: res.json().invoiceId });
      // The scan later does not charge again.
      await inject('POST', `/radiology/orders/${p.id}/complete`, radiologist, {});
      expect(await charges(p.id)).toHaveLength(1);
    } finally {
      await resetRules();
    }
  });

  it('cancelling reverses the charge (cancelled if pending, credit note suggested if billed)', async () => {
    const o = await order(ownTestId);
    let res = await inject('POST', `/radiology/orders/${o.id}/cancel`, reception, { reason: 'Patient refused' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await charges(o.id)).map((c) => c.status)).toEqual(['cancelled']);

    const billed = await order(ownTestId);
    res = await inject('POST', `/radiology/orders/${billed.id}/bill`, billingClerk, {});
    expect(res.statusCode, res.body).toBe(200);
    res = await inject('POST', `/radiology/orders/${billed.id}/cancel`, reception, { reason: 'Wrong side ordered' });
    expect(res.statusCode, res.body).toBe(200);
    const [c] = await charges(billed.id);
    expect(c).toMatchObject({ status: 'billed' });
    expect(c!.reversalRequestedAt).toBeTruthy();
  });

  it('charges a consultation order on the OPD visit once a test is picked', async () => {
    const visitId = randomUUID();
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId: pid, visitId })).json();
    await inject('PATCH', `/emr/encounters/${enc.id}`, doctor, { notes: { chiefComplaints: 'Cough' } });
    await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, {
      orders: [
        { kind: 'radiology', name: `X-ray chest ${s}` },
        { kind: 'radiology', name: `Unlisted view ${s}` },
      ],
    });
    expect((await inject('POST', `/emr/encounters/${enc.id}/sign`, doctor)).statusCode).toBe(200);
    const event = { id: randomUUID(), tenantId, topic: 'emr.encounter.signed', payload: { encounterId: enc.id, patientId: pid, doctorId }, createdAt: new Date().toISOString() };
    await app.get(EventBus).dispatch(event);
    await app.get(EventBus).dispatch({ ...event, id: randomUUID() });
    const items = ((await inject('GET', `/radiology/orders?patientId=${pid}&pageSize=200`, reception)).json().items as radiology.RadiologyOrder[]).filter(
      (o) => o.encounterId === enc.id,
    );
    const matched = items.find((o) => o.testId === ownTestId)!;
    const unmatched = items.find((o) => o.testId === null)!;
    expect(await charges(matched.id)).toMatchObject([{ status: 'pending', visitId, account: 'opd', doctorId, unitPrice: 400 }]);
    expect(await charges(unmatched.id)).toHaveLength(0);
    const res = await inject('PATCH', `/radiology/orders/${unmatched.id}`, reception, { testId: svcTestId });
    expect(res.statusCode, res.body).toBe(200);
    expect(await charges(unmatched.id)).toMatchObject([{ status: 'pending', visitId, unitPrice: 2500 }]);
  });
});

describe('radiology plan check and hospital isolation', () => {
  it('blocks hospitals whose plan has no radiology', async () => {
    // City is on the Starter plan, which does not include radiology.
    const res = await app.inject({ method: 'GET', url: '/api/v1/radiology/orders', headers: bearer(otherHospital) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });

  it("never shows or changes one hospital's radiology data from another", async () => {
    const order = await newOrder();
    // A throwaway Growth hospital: its admin holds radiology.order.read and passes the plan check,
    // so these reach the database and RLS hides demo's rows.
    const code = `rad${suffix}`.toLowerCase().slice(0, 20);
    const pool = createPool(process.env.DATABASE_MIGRATOR_URL!);
    const client = await pool.connect();
    let other: { tenantId: string };
    try {
      other = await provisionTenant(client, {
        code,
        name: 'Radiology Isolation Test',
        plan: 'growth',
        facility: { code: 'MAIN', name: 'Main' },
        admin: { name: 'Iso Admin', email: `admin@${code}.hms`, password: DEMO_PASSWORD },
      });
    } finally {
      client.release();
      await pool.end();
    }
    const token = (await login(app, `admin@${code}.hms`, code)).accessToken;
    const get = (url: string) => app.inject({ method: 'GET', url: `/api/v1${url}`, headers: bearer(token) });

    expect((await get(`/radiology/orders/${order.id}`)).statusCode).toBe(404);
    expect((await get(`/radiology/orders?patientId=${patientId}`)).json().items).toEqual([]);
    expect((await get(`/radiology/tests?q=${encodeURIComponent(testName)}`)).json()).toEqual([]);
    expect((await get(`/radiology/reports/${order.id}`)).statusCode).toBe(404);
    const schedule = await app.inject({ method: 'POST', url: `/api/v1/radiology/orders/${order.id}/schedule`, headers: bearer(token), payload: { scheduledAt: slot(900) } });
    expect(schedule.statusCode).toBe(404);

    const db = app.get(DbService);
    const changed = await db.asTenant({ tenantId: other.tenantId }, async (tx) => (await tx.execute(sql`update radiology.orders set clinical_notes = 'x' where id = ${order.id}`)).rowCount);
    expect(changed).toBe(0);
    await expect(
      db.asTenant({ tenantId: other.tenantId }, (tx) =>
        tx.execute(sql`insert into radiology.modalities (tenant_id, code, name, kind) values (${tenantId}, 'HACK', 'x', 'XR')`),
      ),
    ).rejects.toThrow();
  });
});

describe('radiology validations', () => {
  const msg = (res: { json: () => { error: { message: string } } }) => res.json().error.message;

  it('keeps slot length between 5 and 480 minutes and GST sensible', async () => {
    for (const durationMinutes of [2, 500]) {
      const res = await inject('POST', '/radiology/tests', admin, { code: `V-${durationMinutes}-${suffix}`, name: 'Slot check', modalityId, price: 100, durationMinutes });
      expect(res.statusCode).toBe(400);
      expect(msg(res)).toContain('Slot length must be between 5 and 480 minutes');
    }
    const gst = await inject('POST', '/radiology/tests', admin, { code: `V-GST-${suffix}`, name: 'GST check', modalityId, price: 100, taxRate: 7 });
    expect(msg(gst)).toContain('Use a GST slab');
    const noMachine = await inject('POST', '/radiology/tests', admin, { code: `V-NM-${suffix}`, name: 'No machine', price: 100 });
    expect(msg(noMachine)).toContain('Pick the machine');
    const ae = await inject('POST', '/radiology/modalities', admin, { code: `VAE${suffix}`.slice(0, 20), name: 'AE check', kind: 'XR', aeTitle: 'BAD\\AE' });
    expect(msg(ae)).toContain('no backslash');
  });

  it('refuses a slot in the past or more than a year ahead', async () => {
    const order = await newOrder();
    const past = await inject('POST', `/radiology/orders/${order.id}/schedule`, reception, { scheduledAt: new Date(Date.now() - 3 * 3_600_000).toISOString() });
    expect(past.statusCode).toBe(400);
    expect(msg(past)).toContain('Slot time cannot be in the past');
    const far = await inject('POST', `/radiology/orders/${order.id}/schedule`, reception, { scheduledAt: new Date(Date.now() + 400 * 86_400_000).toISOString() });
    expect(msg(far)).toContain('at most a year ahead');
    const ok = await inject('POST', `/radiology/orders/${order.id}/schedule`, reception, { scheduledAt: slot(1500) });
    expect(ok.statusCode).toBe(200);
  });

  it('checks the PACS link and study UID', async () => {
    const order = await newOrder();
    await inject('POST', `/radiology/orders/${order.id}/start`, reception);
    const bad = await inject('POST', `/radiology/orders/${order.id}/complete`, radiologist, { imagesUrl: 'not a url' });
    expect(bad.statusCode).toBe(400);
    expect(msg(bad)).toContain('Enter a valid link starting with http:// or https://');
    const ftp = await inject('POST', `/radiology/orders/${order.id}/complete`, radiologist, { imagesUrl: 'javascript:alert(1)' });
    expect(ftp.statusCode).toBe(400);
    const uid = await inject('POST', `/radiology/orders/${order.id}/complete`, radiologist, { studyUid: 'abc' });
    expect(msg(uid)).toContain('Study UID is digits separated by dots');
    const ok = await inject('POST', `/radiology/orders/${order.id}/complete`, radiologist, { studyUid: '1.2.3.4', imagesUrl: 'https://pacs.example/1' });
    expect(ok.statusCode).toBe(200);
    const cancel = await inject('POST', `/radiology/orders/${(await newOrder()).id}/cancel`, reception, { reason: 'no' });
    expect(msg(cancel)).toContain('A reason needs at least 3 characters');
  });
});
