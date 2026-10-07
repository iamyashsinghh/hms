import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@hms/db';
import { lab } from '@hms/shared';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { LabController } from '../src/modules/lab/lab.controller';
import { ENTITLEMENT } from '../src/modules/platform/entitlement.guard';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let tech: string;
let doctor: string;
let doctorId: string;
let nurse: string;
let reception: string;
let otherHospital: string;
let tenantId: string;
let facilityId: string;
let malePatientId: string;
let femalePatientId: string;

const sfx = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload });

async function newPatient(gender: 'male' | 'female', ageYears = 40) {
  const res = await inject('POST', '/patients', reception, { firstName: 'Lab', lastName: `Test${sfx()}`, gender, ageYears });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function outbox(match: string) {
  return app.get(DbService).asTenant({ tenantId }, async (tx) => {
    const r = await tx.execute<{ topic: string; payload: Record<string, unknown> }>(
      sql`select topic, payload from audit.outbox where payload->>'orderId' = ${match} order by created_at`,
    );
    return r.rows;
  });
}

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  tech = (await login(app, 'lab@demo.hms')).accessToken;
  const d = await login(app, 'doctor@demo.hms');
  doctor = d.accessToken;
  doctorId = d.user.id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  malePatientId = await newPatient('male');
  femalePatientId = await newPatient('female');
});
afterAll(() => app.close());

describe('lab flags', () => {
  const r = { resultType: 'numeric' as const, options: [], refLow: 13, refHigh: 17, criticalLow: 7, criticalHigh: 20 };
  it('flags values against the reference and critical ranges', () => {
    expect(lab.flagFor(r, '14.2')).toBe('normal');
    expect(lab.flagFor(r, '12')).toBe('low');
    expect(lab.flagFor(r, '18')).toBe('high');
    expect(lab.flagFor(r, '6.5')).toBe('critical_low');
    expect(lab.flagFor(r, '> 21')).toBe('critical_high');
    expect(lab.flagFor(r, 'abc')).toBeNull();
    expect(lab.flagFor({ ...r, resultType: 'option', options: ['Negative', 'Positive'] }, 'Positive')).toBe('abnormal');
  });
});

describe('lab plan entitlement', () => {
  it('needs the lab module in the hospital plan', () => {
    expect(Reflect.getMetadata(ENTITLEMENT, LabController)).toBe('lab');
  });
});

describe('lab catalogue', () => {
  it('loads the starter catalogue once', async () => {
    const res = await inject('POST', '/lab/catalogue/starter', admin);
    expect(res.statusCode).toBe(200);
    const again = await inject('POST', '/lab/catalogue/starter', admin);
    expect(again.json()).toEqual({ testsAdded: 0, panelsAdded: 0 });
    const panels = (await inject('GET', '/lab/panels?q=CBC', tech)).json() as lab.LabPanel[];
    expect(panels.find((p) => p.code === 'CBC')?.tests.length).toBe(10);
  });

  it('only lets catalogue managers add tests', async () => {
    const body = { code: `X${sfx()}`, name: 'Nope', section: 'biochemistry', price: 10 };
    expect((await inject('POST', '/lab/tests', tech, body)).statusCode).toBe(403);
    expect((await inject('POST', '/lab/tests', reception, body)).statusCode).toBe(403);
    expect((await inject('GET', '/lab/tests', reception)).statusCode).toBe(200);
  });

  it('rejects a duplicate code', async () => {
    const code = `D${sfx()}`;
    expect((await inject('POST', '/lab/tests', admin, { code, name: 'Dup test' })).statusCode).toBe(201);
    const dup = await inject('POST', '/lab/tests', admin, { code, name: 'Dup test 2' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('code_taken');
  });
});

describe('lab order to verified report', () => {
  const s = sfx();
  let hbId: string;
  let sugarId: string;
  let panelId: string;
  let orderId: string;
  let order: lab.Order;

  it('creates tests with gender-specific ranges and a panel', async () => {
    let res = await inject('POST', '/lab/tests', admin, {
      code: `HB${s}`,
      name: `Haemoglobin ${s}`,
      section: 'haematology',
      sampleType: 'blood',
      container: 'EDTA',
      unit: 'g/dL',
      price: 100,
      ranges: [
        { gender: 'male', low: 13, high: 17, criticalLow: 7, criticalHigh: 20 },
        { gender: 'female', low: 12, high: 15, criticalLow: 7, criticalHigh: 20 },
      ],
    });
    expect(res.statusCode).toBe(201);
    hbId = res.json().id;
    expect(res.json().ranges).toHaveLength(2);

    res = await inject('POST', '/lab/tests', admin, {
      code: `FBS${s}`,
      name: `Fasting sugar ${s}`,
      section: 'biochemistry',
      sampleType: 'plasma',
      container: 'Fluoride',
      unit: 'mg/dL',
      decimals: 0,
      price: 60,
      ranges: [{ low: 70, high: 100, criticalLow: 40, criticalHigh: 450 }],
    });
    sugarId = res.json().id;

    res = await inject('POST', '/lab/panels', admin, { code: `PNL${s}`, name: `Panel ${s}`, price: 150, testIds: [hbId, sugarId] });
    expect(res.statusCode).toBe(201);
    panelId = res.json().id;
    expect(res.json().tests.map((t: { id: string }) => t.id)).toEqual([hbId, sugarId]);
  });

  it('books a walk-in order, bills it through billing and makes one barcode per sample type', async () => {
    const res = await inject('POST', '/lab/orders', reception, {
      patientId: femalePatientId,
      doctorId,
      items: [{ panelId }],
      payNow: { mode: 'cash', amount: 150 },
    });
    expect(res.statusCode).toBe(201);
    order = res.json();
    orderId = order.id;
    expect(order.orderNo).toMatch(/^LAB\d{6}$/);
    expect(order.status).toBe('ordered');
    expect(order.invoiceNo).toBeTruthy();
    expect(order.doctorName).toBeTruthy();
    expect(order.samples).toHaveLength(2);
    expect(order.samples.every((x) => /^LS\d{7}$/.test(x.barcode))).toBe(true);
    expect(order.results).toHaveLength(2);
    const hb = order.results.find((r) => r.testId === hbId)!;
    expect(hb).toMatchObject({ refLow: 12, refHigh: 15, panelName: `Panel ${s}`, status: 'pending' });

    const inv = await inject('GET', `/billing/invoices/${order.invoiceId}`, admin);
    expect(inv.statusCode).toBe(200);
    expect(inv.json().total).toBe(150);
  });

  it('does not accept results before the sample is collected', async () => {
    const hb = order.results.find((r) => r.testId === hbId)!;
    const res = await inject('PUT', `/lab/orders/${orderId}/results`, tech, { results: [{ resultId: hb.id, value: '13' }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('sample_not_collected');
  });

  it('collects samples (the nurse may) and shows them on the worklist', async () => {
    const pending = (await inject('GET', '/lab/samples?status=pending', tech)).json() as lab.WorklistSample[];
    expect(pending.filter((x) => x.orderId === orderId)).toHaveLength(2);
    const first = order.samples[0]!;
    let res = await inject('POST', `/lab/samples/${first.id}/collect`, nurse);
    expect(res.statusCode).toBe(200);
    res = await inject('POST', `/lab/orders/${orderId}/collect`, tech);
    expect(res.json().status).toBe('collected');
    res = await inject('POST', `/lab/samples/${first.id}/receive`, tech);
    expect(res.json().samples.find((x: lab.Sample) => x.id === first.id).status).toBe('received');
    expect((await inject('POST', `/lab/samples/${first.id}/collect`, tech)).statusCode).toBe(409);
  });

  it('finds the order by barcode', async () => {
    const list = await inject('GET', `/lab/orders?q=${order.samples[0]!.barcode}`, tech);
    expect(list.json().items.map((o: { id: string }) => o.id)).toEqual([orderId]);
  });

  it('enters results, flags them and raises a critical alert', async () => {
    const hb = order.results.find((r) => r.testId === hbId)!;
    const fbs = order.results.find((r) => r.testId === sugarId)!;
    expect((await inject('PUT', `/lab/orders/${orderId}/results`, reception, { results: [{ resultId: hb.id, value: '11' }] })).statusCode).toBe(403);
    const bad = await inject('PUT', `/lab/orders/${orderId}/results`, tech, { results: [{ resultId: fbs.id, value: 'high' }] });
    expect(bad.statusCode).toBe(400);

    const res = await inject('PUT', `/lab/orders/${orderId}/results`, tech, {
      results: [
        { resultId: hb.id, value: '6.1' },
        { resultId: fbs.id, value: '112', remarks: 'Non-fasting?' },
      ],
    });
    expect(res.statusCode).toBe(200);
    const o = res.json() as lab.Order;
    expect(o.status).toBe('in_progress');
    expect(o.hasCritical).toBe(true);
    expect(o.results.find((r) => r.id === hb.id)!.flag).toBe('critical_low');
    expect(o.results.find((r) => r.id === fbs.id)!.flag).toBe('high');
    const events = await outbox(orderId);
    expect(events.filter((e) => e.topic === 'lab.result.critical')).toHaveLength(1);
    expect(events[0]!.topic).toBe('lab.order.created');
  });

  it('lets only verifiers verify, then releases the report once', async () => {
    expect((await inject('POST', `/lab/orders/${orderId}/verify`, nurse, {})).statusCode).toBe(403);
    expect((await inject('POST', `/lab/orders/${orderId}/verify`, doctor, {})).statusCode).toBe(403);
    const res = await inject('POST', `/lab/orders/${orderId}/verify`, tech, {});
    expect(res.statusCode).toBe(200);
    const o = res.json() as lab.Order;
    expect(o.status).toBe('completed');
    expect(o.verifiedByName).toBeTruthy();
    expect(o.results.every((r) => r.status === 'verified')).toBe(true);

    const events = (await outbox(orderId)).filter((e) => e.topic === 'lab.report.verified');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ reportId: orderId, patientId: femalePatientId, url: `/lab/orders/${orderId}/report` });
    expect(events[0]!.payload.title).toContain(`Panel ${s}`);
    expect(typeof events[0]!.payload.issuedAt).toBe('string');
  });

  it('locks verified results until amended', async () => {
    const hb = order.results.find((r) => r.testId === hbId)!;
    const locked = await inject('PUT', `/lab/orders/${orderId}/results`, tech, { results: [{ resultId: hb.id, value: '7.1' }] });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe('result_verified');

    // Even a direct write by the app role is refused by the database.
    await expect(
      app.get(DbService).asTenant({ tenantId }, (tx) => tx.execute(sql`update lab.results set value = '1' where id = ${hb.id}`)),
    ).rejects.toThrow();

    let res = await inject('POST', `/lab/orders/${orderId}/amend`, tech, { resultId: hb.id, reason: 'Wrong sample tube read' });
    expect(res.json().status).toBe('in_progress');
    res = await inject('PUT', `/lab/orders/${orderId}/results`, tech, { results: [{ resultId: hb.id, value: '7.1' }] });
    expect(res.json().results.find((r: lab.Result) => r.id === hb.id).flag).toBe('low');
    res = await inject('POST', `/lab/orders/${orderId}/verify`, tech, {});
    expect(res.json().status).toBe('completed');
    expect((await outbox(orderId)).filter((e) => e.topic === 'lab.report.verified')).toHaveLength(2);
  });

  it('serves the report and refuses to cancel a reported order', async () => {
    const res = await inject('GET', `/lab/orders/${orderId}/report`, doctor);
    expect(res.statusCode).toBe(200);
    expect(res.json().order.orderNo).toBe(order.orderNo);
    expect(res.json().hospital.name).toBeTruthy();
    const cancel = await inject('POST', `/lab/orders/${orderId}/cancel`, tech, { reason: 'Patient left' });
    expect(cancel.statusCode).toBe(409);
  });

  it('uses the male range for a male patient and can bill later', async () => {
    const res = await inject('POST', '/lab/orders', doctor, { patientId: malePatientId, items: [{ testId: hbId }], bill: false, priority: 'urgent' });
    expect(res.statusCode).toBe(201);
    const o = res.json() as lab.Order;
    expect(o.invoiceId).toBeNull();
    expect(o.results[0]).toMatchObject({ refLow: 13, refHigh: 17 });
    const billed = await inject('POST', `/lab/orders/${o.id}/bill`, reception, {});
    expect(billed.statusCode).toBe(200);
    expect(billed.json().invoiceNo).toBeTruthy();
    expect((await inject('POST', `/lab/orders/${o.id}/bill`, reception, {})).statusCode).toBe(409);
  });

  it('rejects and recollects a sample with a new barcode, and cancels an open order', async () => {
    const o = (await inject('POST', '/lab/orders', reception, { patientId: malePatientId, items: [{ testId: sugarId }], bill: false })).json() as lab.Order;
    const sample = o.samples[0]!;
    await inject('POST', `/lab/samples/${sample.id}/collect`, tech);
    let res = await inject('POST', `/lab/samples/${sample.id}/reject`, tech, { reason: 'Haemolysed' });
    expect(res.json().samples[0].status).toBe('rejected');
    res = await inject('POST', `/lab/samples/${sample.id}/recollect`, tech);
    const after = res.json() as lab.Order;
    expect(after.samples).toHaveLength(2);
    const fresh = after.samples.find((x) => x.id !== sample.id)!;
    expect(fresh.barcode).not.toBe(sample.barcode);
    expect(after.results[0]!.sampleId).toBe(fresh.id);
    expect((await inject('POST', `/lab/samples/${sample.id}/recollect`, tech)).statusCode).toBe(409);

    expect((await inject('POST', `/lab/orders/${o.id}/cancel`, reception, { reason: 'x' })).statusCode).toBe(403);
    res = await inject('POST', `/lab/orders/${o.id}/cancel`, tech, { reason: 'Patient left' });
    expect(res.json().status).toBe('cancelled');
    expect((await inject('POST', `/lab/orders/${o.id}/collect`, tech)).statusCode).toBe(409);
  });
});

describe('lab orders from a signed consultation', () => {
  it('turns EMR lab lines into one lab order, matching by code or name, once', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId: malePatientId })).json();
    await inject('PATCH', `/emr/encounters/${enc.id}`, doctor, { notes: { chiefComplaints: 'Fatigue' } });
    await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, {
      orders: [
        { kind: 'lab', name: 'CBC' },
        { kind: 'lab', name: 'thyroid profile', priority: 'urgent' },
        { kind: 'lab', name: 'Some rare test nobody has' },
        { kind: 'radiology', name: 'X-ray chest' },
      ],
    });
    expect((await inject('POST', `/emr/encounters/${enc.id}/sign`, doctor)).statusCode).toBe(200);

    const event = { id: randomUUID(), tenantId, topic: 'emr.encounter.signed', payload: { encounterId: enc.id, patientId: malePatientId, doctorId }, createdAt: new Date().toISOString() };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch({ ...event, id: randomUUID() });

    const list = (await inject('GET', `/lab/orders?patientId=${malePatientId}&pageSize=50`, tech)).json().items as lab.OrderSummary[];
    const fromEmr = list.filter((o) => o.source === 'emr');
    expect(fromEmr).toHaveLength(1);
    const o = (await inject('GET', `/lab/orders/${fromEmr[0]!.id}`, tech)).json() as lab.Order;
    expect(o.encounterId).toBe(enc.id);
    expect(o.priority).toBe('urgent');
    expect(o.doctorId).toBe(doctorId);
    expect(o.invoiceId).toBeNull();
    expect(o.items.map((i) => [i.kind, i.code])).toEqual([
      ['panel', 'CBC'],
      ['panel', 'TFT'],
      ['unmatched', null],
    ]);
    expect(o.results).toHaveLength(12);

    // Lab progress flows back to the consultation's order lines.
    await inject('POST', `/lab/orders/${o.id}/collect`, tech);
    const statusEvents = (await outbox(o.id)).filter((e) => e.topic === 'lab.order.status_changed');
    expect(statusEvents.map((e) => e.payload.status)).toEqual(['collected', 'collected']);
    const emrLines = ((await inject('GET', `/emr/encounters/${enc.id}`, doctor)).json().orders as { id: string; name: string }[]).filter((l) => ['CBC', 'thyroid profile'].includes(l.name));
    expect(statusEvents.map((e) => e.payload.emrOrderId).sort()).toEqual(emrLines.map((l) => l.id).sort());
    expect(statusEvents[0]!.payload).toMatchObject({ encounterId: enc.id, patientId: malePatientId });
  });
});

describe('lab results from analysers', () => {
  it('fills results by tube barcode and test code, leaving them for a person to verify', async () => {
    const [panel] = (await inject('GET', '/lab/panels?q=KFT', tech)).json() as lab.LabPanel[];
    const o = (await inject('POST', '/lab/orders', reception, { patientId: femalePatientId, items: [{ panelId: panel!.id }], bill: false })).json() as lab.Order;
    const barcode = o.samples[0]!.barcode;
    const event = {
      id: randomUUID(),
      tenantId,
      topic: 'integrations.device.results_received',
      payload: {
        messageId: randomUUID(),
        deviceId: randomUUID(),
        deviceCode: 'BIO-1',
        sampleId: barcode,
        patientRef: o.patient.uhid,
        results: [
          { code: 'UREA', name: 'Urea', value: '32', unit: 'mg/dL' },
          { code: 'k', name: 'Potassium', value: 6.8, unit: 'mmol/L' },
          { code: 'XYZ', name: 'Unknown analyte', value: '1' },
        ],
      },
      createdAt: new Date().toISOString(),
    };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch({ ...event, id: randomUUID() });

    const after = (await inject('GET', `/lab/orders/${o.id}`, tech)).json() as lab.Order;
    expect(after.samples[0]!.status).toBe('received');
    expect(after.status).toBe('in_progress');
    expect(after.results.find((r) => r.code === 'UREA')).toMatchObject({ value: '32', flag: 'normal', status: 'entered' });
    expect(after.results.find((r) => r.code === 'K')).toMatchObject({ value: '6.8', flag: 'critical_high', status: 'entered' });
    expect(after.results.filter((r) => r.status === 'pending')).toHaveLength(3);
    expect((await outbox(o.id)).filter((e) => e.topic === 'lab.result.critical')).toHaveLength(1);
  });
});

describe('lab hospital isolation', () => {
  it("never shows or changes one hospital's lab orders from another", async () => {
    const [test] = (await inject('GET', '/lab/tests?q=HB', tech)).json() as lab.LabTest[];
    const o = (await inject('POST', '/lab/orders', reception, { patientId: malePatientId, items: [{ testId: test!.id }], bill: false })).json() as lab.Order;

    // The city hospital's plan (Starter) has no lab, so the API refuses before touching data.
    const cityFacility = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(otherHospital) })).json().facilities[0].id;
    const city = (method: 'GET' | 'POST', url: string) => app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(otherHospital), 'x-facility-id': cityFacility } });
    const blocked = await city('GET', `/lab/orders/${o.id}`);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('plan_upgrade_required');
    expect((await city('GET', '/lab/tests')).statusCode).toBe(403);

    // And the database itself hides and protects demo's lab rows from the city hospital.
    const cityTenant = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(otherHospital) })).json().tenantId;
    const changed = await app.get(DbService).asTenant({ tenantId: cityTenant }, async (tx) => {
      const r = await tx.execute(sql`update lab.orders set clinical_notes = 'x' where id = ${o.id}`);
      return r.rowCount;
    });
    expect(changed).toBe(0);
    const seen = await app.get(DbService).asTenant({ tenantId: cityTenant }, async (tx) => {
      const r = await tx.execute(sql`select 1 from lab.orders where id = ${o.id} union all select 1 from lab.results where order_id = ${o.id} union all select 1 from lab.tests where id = ${test!.id}`);
      return r.rows.length;
    });
    expect(seen).toBe(0);
  });
});
