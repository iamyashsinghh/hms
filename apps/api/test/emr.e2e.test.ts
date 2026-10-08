import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../src/common/events/event-bus';
import { DbService } from '../src/common/db/db.service';
import { sql } from '@hms/db';
import { todayIso, type billing, type emr } from '@hms/shared';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let doctor: string;
let doctorId: string;
let tenantId: string;
let facilityId: string;
let nurse: string;
let reception: string;
let pharmacist: string;
let otherHospital: string;
let patientId: string;
let allergicPatientId: string;
const FOLLOW_UP = todayIso(30);
const QUICK_FOLLOW_UP = todayIso(14);

const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: bearer(token), payload });

/** An IST date `days` from today, so date rules (follow-up not before the visit) never go stale. */
const istDaysFromNow = (days: number) => new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);

async function newPatient(extra: object = {}) {
  const res = await inject('POST', '/patients', reception, { firstName: 'Emr', lastName: `Test${Date.now()}${Math.random().toString(36).slice(2, 6)}`, gender: 'male', ageYears: 40, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

beforeAll(async () => {
  app = await bootApp();
  const d = await login(app, 'doctor@demo.hms');
  doctor = d.accessToken;
  doctorId = d.user.id;
  const me = (await inject('GET', '/auth/me', doctor)).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  patientId = await newPatient();
  allergicPatientId = await newPatient({ allergies: ['Penicillin'] });
});
afterAll(() => app.close());

describe('emr consultation flow', () => {
  let encounterId: string;

  it('opens a consultation that shows in the doctor queue', async () => {
    const res = await inject('POST', '/emr/encounters', doctor, { patientId });
    expect(res.statusCode).toBe(201);
    const enc = res.json();
    encounterId = enc.id;
    expect(enc.encounterNo).toMatch(/^OP\d{6}$/);
    expect(enc.status).toBe('waiting');
    expect(enc.doctorId).toBe(doctorId);
    expect(enc.doctorName).toBeTruthy();

    const queue = await inject('GET', '/emr/queue', doctor);
    expect(queue.statusCode).toBe(200);
    const item = queue.json().items.find((i: { encounterId: string }) => i.encounterId === encounterId);
    expect(item).toMatchObject({ patientId, status: 'waiting' });
    expect(item.uhid).toMatch(/^UH/);
  });

  it('lets the nurse record vitals and computes BMI', async () => {
    const res = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { pulse: 82, bpSystolic: 130, bpDiastolic: 85, weightKg: 70, heightCm: 175, temperatureC: 37.2 });
    expect(res.statusCode).toBe(201);
    expect(res.json().vitals[0]).toMatchObject({ pulse: 82, bmi: 22.9, temperatureC: 37.2 });
  });

  it('stops a nurse from writing notes', async () => {
    const res = await inject('PATCH', `/emr/encounters/${encounterId}`, nurse, { notes: { chiefComplaints: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('saves notes, ICD-10 diagnoses, orders and starts the consultation', async () => {
    let res = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, {
      notes: { chiefComplaints: 'Fever and sore throat for 3 days', examination: 'Throat congested' },
      followUpDate: FOLLOW_UP,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
    const past = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: istDaysFromNow(-1) });
    expect(past.statusCode).toBe(400);
    expect(past.json().error.code).toBe('invalid_follow_up');
    expect((await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: '2026-13-01' })).statusCode).toBe(400);
    expect(res.json().notes.chiefComplaints).toContain('Fever');

    res = await inject('PUT', `/emr/encounters/${encounterId}/diagnoses`, doctor, {
      diagnoses: [{ icd10Code: 'J02.9', description: 'Acute pharyngitis' }, { description: 'Fever', icd10Code: 'R50.9', kind: 'final' }],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().diagnoses).toHaveLength(2);
    expect(res.json().diagnoses[0].isPrimary).toBe(true);

    res = await inject('PUT', `/emr/encounters/${encounterId}/orders`, doctor, { orders: [{ kind: 'lab', name: 'CBC' }, { kind: 'radiology', name: 'X-ray chest PA', priority: 'urgent' }] });
    expect(res.statusCode).toBe(200);
    expect(res.json().orders.map((o: { name: string }) => o.name)).toEqual(['CBC', 'X-ray chest PA']);

    const bad = await inject('PUT', `/emr/encounters/${encounterId}/diagnoses`, doctor, { diagnoses: [{ icd10Code: 'nope', description: 'x' }] });
    expect(bad.statusCode).toBe(400);
  });

  it('searches ICD-10 codes', async () => {
    const res = await inject('GET', '/emr/icd10?q=pharyng', doctor);
    expect(res.json().map((c: { code: string }) => c.code)).toContain('J02.9');
  });

  it('writes a prescription and auto-calculates quantity', async () => {
    const res = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, {
      lines: [
        { drugName: 'Paracetamol 650', dose: '1 tab', frequency: 'TDS', days: 5, timing: 'after_food' },
        { drugName: 'Azithromycin 500', dose: '1 tab', frequency: '1-0-0', days: 3 },
      ],
    });
    expect(res.statusCode).toBe(200);
    const rx = res.json().prescription;
    expect(rx.rxNo).toMatch(/^RX\d{6}$/);
    expect(rx.lines.map((l: { qty: number }) => l.qty)).toEqual([15, 3]);
  });

  it('only the consulting doctor can change it', async () => {
    const res = await inject('PATCH', `/emr/encounters/${encounterId}`, nurse, { followUpDate: null });
    expect(res.statusCode).toBe(403);
  });

  it('signs and locks the consultation and publishes events', async () => {
    const res = await inject('POST', `/emr/encounters/${encounterId}/sign`, doctor);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('completed');
    expect(res.json().signedAt).toBeTruthy();

    const again = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { notes: { advice: 'changed' } });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('encounter_signed');
    const rx = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, { lines: [] });
    expect(rx.statusCode).toBe(409);
    const vitals = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { pulse: 70 });
    expect(vitals.statusCode).toBe(409);

    const db = app.get(DbService);
    const topics = await db.asTenant({ tenantId }, async (tx) => {
      const r = await tx.execute<{ topic: string; payload: Record<string, unknown> }>(
        sql`select topic, payload from audit.outbox where payload->>'encounterId' = ${encounterId} or payload->>'prescriptionId' = ${res.json().prescription.id}`,
      );
      return r.rows;
    });
    expect(topics.map((t) => t.topic).sort()).toEqual(['emr.encounter.signed', 'emr.prescription.created']);
    const rxEvent = topics.find((t) => t.topic === 'emr.prescription.created')!.payload as {
      doctorId: string;
      doctorName: string;
      createdAt: string;
      lines: { drugName: string; qty: number }[];
    };
    expect(rxEvent.lines[0]).toMatchObject({ drugName: 'Paracetamol 650', qty: 15 });
    expect(rxEvent).toMatchObject({ doctorId, doctorName: 'Dr. Asha Rao' });
    expect(new Date(rxEvent.createdAt).toISOString()).toBe(rxEvent.createdAt);
    const signedEvent = topics.find((t) => t.topic === 'emr.encounter.signed')!.payload;
    expect(signedEvent).toMatchObject({ followUpDate: FOLLOW_UP, followUpNotes: null });
  });

  it('blocks direct database changes to a signed consultation (trigger)', async () => {
    const db = app.get(DbService);
    await expect(
      db.asTenant({ tenantId }, (tx) => tx.execute(sql`update clinical.encounters set follow_up_notes = 'x' where id = ${encounterId}`)),
    ).rejects.toThrow();
    await expect(
      db.asTenant({ tenantId }, (tx) => tx.execute(sql`delete from clinical.encounter_diagnoses where encounter_id = ${encounterId}`)),
    ).rejects.toThrow();
  });

  it('accepts addenda after signing', async () => {
    const res = await inject('POST', `/emr/encounters/${encounterId}/addenda`, doctor, { text: 'Throat swab result normal' });
    expect(res.statusCode).toBe(201);
    expect(res.json().addenda[0]).toMatchObject({ text: 'Throat swab result normal' });
  });

  it('lets the pharmacist read the prescription but not the consultation', async () => {
    const enc = (await inject('GET', `/emr/encounters/${encounterId}`, doctor)).json();
    const rx = await inject('GET', `/emr/prescriptions/${enc.prescription.id}`, pharmacist);
    expect(rx.statusCode).toBe(200);
    expect(rx.json().lines).toHaveLength(2);
    const full = await inject('GET', `/emr/encounters/${encounterId}`, pharmacist);
    expect(full.statusCode).toBe(403);
  });

  it('shows the consultation in the patient timeline', async () => {
    const res = await inject('GET', `/emr/patients/${patientId}/timeline`, doctor);
    expect(res.statusCode).toBe(200);
    const entry = res.json().items.find((e: { encounterId: string }) => e.encounterId === encounterId);
    expect(entry).toMatchObject({ status: 'completed', chiefComplaints: 'Fever and sore throat for 3 days' });
    expect(entry.diagnoses[0].icd10Code).toBe('J02.9');
    expect(entry.medicines).toHaveLength(2);
    expect(entry.vitals.pulse).toBe(82);
  });

  it('cannot sign an empty consultation', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId })).json();
    const res = await inject('POST', `/emr/encounters/${enc.id}/sign`, doctor);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('encounter_empty');
    const cancel = await inject('POST', `/emr/encounters/${enc.id}/cancel`, doctor);
    expect(cancel.json().status).toBe('cancelled');
  });
});

describe('emr allergy check', () => {
  it('rejects a drug matching a recorded allergy unless overridden', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId: allergicPatientId })).json();
    expect(enc.patient.allergies).toEqual(['Penicillin']);
    const res = await inject('PUT', `/emr/encounters/${enc.id}/prescription`, doctor, {
      lines: [{ drugName: 'Paracetamol 500', dose: '1 tab', frequency: 'SOS' }, { drugName: 'Amoxicillin 500', dose: '1 cap', frequency: 'TDS', days: 5 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('allergy_conflict');
    expect(res.json().error.details.conflicts).toEqual([{ line: 1, drugName: 'Amoxicillin 500', allergy: 'Penicillin' }]);

    const ok = await inject('PUT', `/emr/encounters/${enc.id}/prescription`, doctor, {
      lines: [{ drugName: 'Amoxicillin 500', dose: '1 cap', frequency: 'TDS', days: 5, allergyOverrideReason: 'Tolerated before, rash only' }],
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().prescription.lines[0].allergyOverrideReason).toContain('Tolerated');
  });
});

describe('emr quick prescription, favourites, certificates', () => {
  it('writes a quick Rx for a walk-in and signs it', async () => {
    const res = await inject('POST', '/emr/prescriptions', doctor, {
      patientId,
      lines: [{ drugName: 'Cetirizine 10', dose: '1 tab', frequency: '0-0-1', days: 5 }],
      advice: 'Steam inhalation',
      followUpDate: QUICK_FOLLOW_UP,
      sign: true,
    });
    expect(res.statusCode).toBe(201);
    const { encounterId, prescriptionId, rxNo } = res.json();
    expect(rxNo).toMatch(/^RX/);
    const enc = (await inject('GET', `/emr/encounters/${encounterId}`, doctor)).json();
    expect(enc).toMatchObject({ status: 'completed', followUpDate: QUICK_FOLLOW_UP, notes: { advice: 'Steam inhalation' } });
    expect(enc.prescription.id).toBe(prescriptionId);
    expect(enc.prescription.lines[0].qty).toBe(5);
  });

  it('keeps favourites per doctor', async () => {
    const name = `Viral fever ${Date.now()}`;
    const created = await inject('POST', '/emr/favourites', doctor, { name, lines: [{ drugName: 'Paracetamol 650', dose: '1 tab', frequency: 'TDS', days: 3 }] });
    expect(created.statusCode).toBe(201);
    const list = await inject('GET', '/emr/favourites', doctor);
    expect(list.json().map((f: { name: string }) => f.name)).toContain(name);
    const dup = await inject('POST', '/emr/favourites', doctor, { name, lines: [{ drugName: 'X', dose: '1', frequency: 'OD' }] });
    expect(dup.statusCode).toBe(409);
    const del = await inject('DELETE', `/emr/favourites/${created.json().id}`, doctor);
    expect(del.statusCode).toBe(204);
  });

  it('edits a favourite: rename and replace its medicines', async () => {
    const name = `Gastritis ${Date.now()}`;
    const fav = (await inject('POST', '/emr/favourites', doctor, { name, lines: [{ drugName: 'Pantoprazole 40', dose: '1 tab', frequency: 'OD', days: 14, timing: 'empty_stomach' }] })).json();
    const other = (await inject('POST', '/emr/favourites', doctor, { name: `${name} B`, lines: [{ drugName: 'X', dose: '1', frequency: 'OD' }] })).json();

    let res = await inject('PATCH', `/emr/favourites/${fav.id}`, doctor, { name: `${name} (adult)` });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: `${name} (adult)`, lines: [{ drugName: 'Pantoprazole 40', days: 14 }] });
    res = await inject('PATCH', `/emr/favourites/${fav.id}`, doctor, {
      lines: [
        { drugName: 'Pantoprazole 40', dose: '1 tab', frequency: 'OD', days: 30 },
        { drugName: 'Sucralfate syrup', dose: '10 ml', frequency: 'TDS', days: 7, route: 'oral' },
      ],
    });
    expect(res.json().name).toBe(`${name} (adult)`);
    expect(res.json().lines.map((l: { drugName: string }) => l.drugName)).toEqual(['Pantoprazole 40', 'Sucralfate syrup']);

    for (const bad of [{ name: '' }, { lines: [] }, { lines: [{ drugName: 'X', dose: '', frequency: 'OD' }] }, { lines: [{ drugName: 'X', dose: '1', frequency: 'OD', days: 400 }] }]) {
      expect((await inject('PATCH', `/emr/favourites/${fav.id}`, doctor, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await inject('PATCH', `/emr/favourites/${fav.id}`, doctor, { name: `${name} B` })).statusCode).toBe(409);
    // Only the doctor's own favourites, and only for prescribers.
    expect((await inject('PATCH', `/emr/favourites/${fav.id}`, nurse, { name: 'Nope' })).statusCode).toBe(403);
    expect((await inject('PATCH', `/emr/favourites/00000000-0000-4000-8000-000000000000`, doctor, { name: 'Ghost' })).statusCode).toBe(404);
    await inject('DELETE', `/emr/favourites/${fav.id}`, doctor);
    await inject('DELETE', `/emr/favourites/${other.id}`, doctor);
  });

  it('issues a sick-leave certificate', async () => {
    const bad = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave' });
    expect(bad.statusCode).toBe(400);
    const res = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave', fromDate: todayIso(-1), toDate: todayIso(1), diagnosis: 'Acute pharyngitis' });
    expect(res.statusCode).toBe(201);
    expect(res.json().certificateNo).toMatch(/^MC\d{6}$/);
    const list = await inject('GET', `/emr/patients/${patientId}/certificates`, reception);
    expect(list.json().map((c: { id: string }) => c.id)).toContain(res.json().id);
  });
});

describe('emr check-in event', () => {
  it('puts a checked-in patient in the queue once, even if the event repeats', async () => {
    const visitId = randomUUID();
    const event = {
      id: randomUUID(),
      tenantId,
      topic: 'frontoffice.visit.checked_in',
      payload: { visitId, patientId, doctorId, facilityId, tokenNo: 7 },
      createdAt: new Date().toISOString(),
    };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch({ ...event, id: randomUUID() });
    const items = (await inject('GET', '/emr/queue', doctor)).json().items.filter((i: { visitId: string }) => i.visitId === visitId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tokenNo: 7, status: 'waiting' });
  });
});

describe('emr printing and doctor checks (Setup)', () => {
  it('returns letterhead, print template and doctor credentials for the Rx', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId })).json();
    const res = await inject('GET', `/emr/encounters/${enc.id}/print`, doctor);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.encounter.id).toBe(enc.id);
    expect(body.hospital.displayName).toBeTruthy();
    expect(body.template).toMatchObject({ paperSize: expect.any(String) });
    expect(body.doctor).toMatchObject({ userId: doctorId, name: 'Dr. Asha Rao' });
  });

  it('will not open a consultation for a user who is not a doctor', async () => {
    const nurseId = (await login(app, 'nurse@demo.hms')).user.id;
    const res = await inject('POST', '/emr/encounters', doctor, { patientId, doctorId: nurseId });
    expect(res.statusCode).toBe(404);
  });
});

describe('emr order status from lab/radiology', () => {
  it('mirrors department progress on a signed consultation and never moves backwards', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId })).json();
    let res = await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, { orders: [{ kind: 'radiology', name: 'USG abdomen' }, { kind: 'lab', name: 'LFT' }] });
    const [usg, lft] = res.json().orders;
    await inject('PATCH', `/emr/encounters/${enc.id}`, doctor, { notes: { chiefComplaints: 'Pain abdomen' } });
    expect((await inject('POST', `/emr/encounters/${enc.id}/sign`, doctor)).statusCode).toBe(200);

    const bus = app.get(EventBus);
    const send = (topic: string, emrOrderId: string, status: string) =>
      bus.dispatch({ id: randomUUID(), tenantId, topic, payload: { orderId: randomUUID(), emrOrderId, encounterId: enc.id, patientId, status }, createdAt: new Date().toISOString() });
    await send('radiology.order.status_changed', usg.id, 'acquired');
    await send('lab.order.status_changed', lft.id, 'verified');
    res = await inject('GET', `/emr/encounters/${enc.id}`, doctor);
    expect(res.json().orders.map((o: { status: string }) => o.status)).toEqual(['in_progress', 'completed']);

    await send('radiology.order.status_changed', usg.id, 'finalized');
    await send('radiology.order.status_changed', usg.id, 'scheduled'); // late duplicate
    await send('lab.order.status_changed', lft.id, 'cancelled'); // after completion
    await send('radiology.order.status_changed', randomUUID(), 'finalized'); // unknown order
    res = await inject('GET', `/emr/encounters/${enc.id}`, doctor);
    expect(res.json().orders.map((o: { status: string }) => o.status)).toEqual(['completed', 'completed']);
  });
});

describe('emr procedure orders post charges', () => {
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  const DRESS = `DRS-${tag}`;
  let admin: string;
  let pid: string;

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, token: string, payload?: object) =>
    app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload });
  async function charges(encounterId: string) {
    const res = await call('GET', `/billing/charges?patientId=${pid}&sourceModule=emr&pageSize=500`, admin);
    expect(res.statusCode, res.body).toBe(200);
    return (res.json().items as billing.Charge[]).filter((c) => c.sourceRef === encounterId);
  }
  async function signedWith(orders: object[], visitId?: string) {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId: pid, ...(visitId ? { visitId } : {}) })).json();
    await inject('PATCH', `/emr/encounters/${enc.id}`, doctor, { notes: { chiefComplaints: 'Wound on the forearm' } });
    const res = await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, { orders });
    expect(res.statusCode, res.body).toBe(200);
    expect((await inject('POST', `/emr/encounters/${enc.id}/sign`, doctor)).statusCode).toBe(200);
    return (await inject('GET', `/emr/encounters/${enc.id}`, doctor)).json() as emr.Encounter;
  }

  beforeAll(async () => {
    admin = (await login(app, 'admin@demo.hms')).accessToken;
    pid = await newPatient();
    const res = await call('POST', '/billing/services', admin, { code: DRESS, name: `Dressing small ${tag}`, category: 'procedure', basePrice: 150, taxRate: 18 });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('keeps the service of a procedure and refuses an unknown one', async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId: pid })).json();
    let res = await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, { orders: [{ kind: 'procedure', name: 'Dressing', serviceCode: `NOPE-${tag}` }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('unknown_service');
    res = await inject('PUT', `/emr/encounters/${enc.id}/orders`, doctor, {
      orders: [
        { kind: 'procedure', name: 'Dressing small', serviceCode: DRESS.toLowerCase() },
        { kind: 'lab', name: 'CBC', serviceCode: 'IGNORED' },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().orders.map((o: emr.Order) => o.serviceCode)).toEqual([DRESS, null]);
  });

  it('posts one charge per priced procedure when the consultation is signed, on its OPD visit', async () => {
    const visitId = randomUUID();
    const enc = await signedWith(
      [
        { kind: 'procedure', name: 'Dressing small', serviceCode: DRESS, notes: 'Left forearm' },
        { kind: 'procedure', name: 'Suture removal (free text)' },
        { kind: 'lab', name: 'CBC' },
      ],
      visitId,
    );
    const [dressing] = enc.orders;
    const posted = await charges(enc.id);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      status: 'pending',
      sourceLine: dressing!.id,
      serviceCode: DRESS,
      unitPrice: 150,
      taxRate: 18,
      amount: 177,
      visitId,
      account: 'opd',
      doctorId,
      notes: 'Left forearm',
    });
  });

  it('cancels a signed procedure and its pending charge', async () => {
    const enc = await signedWith([
      { kind: 'procedure', name: 'Dressing small', serviceCode: DRESS },
      { kind: 'lab', name: 'CBC' },
    ]);
    const [dressing, cbc] = enc.orders;
    const url = `/emr/encounters/${enc.id}/orders/${dressing!.id}/cancel`;
    expect((await inject('POST', url, nurse, { reason: 'Not needed' })).statusCode).toBe(403);
    expect((await inject('POST', `/emr/encounters/${enc.id}/orders/${cbc!.id}/cancel`, doctor, { reason: 'Not needed' })).json().error.code).toBe('not_a_procedure');
    expect((await inject('POST', url, doctor, { reason: 'x' })).statusCode).toBe(400);
    let res = await inject('POST', url, doctor, { reason: 'Wound healed, not needed' });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().orders.find((o: emr.Order) => o.id === dressing!.id).status).toBe('cancelled');
    expect((await charges(enc.id)).map((c) => [c.status, c.cancelReason])).toEqual([['cancelled', 'Wound healed, not needed']]);
    res = await inject('POST', url, doctor, { reason: 'Wound healed, not needed' });
    expect(res.statusCode).toBe(200);

    // Before signing the doctor just removes the line.
    const open = (await inject('POST', '/emr/encounters', doctor, { patientId: pid })).json();
    const saved = (await inject('PUT', `/emr/encounters/${open.id}/orders`, doctor, { orders: [{ kind: 'procedure', name: 'Dressing', serviceCode: DRESS }] })).json();
    res = await inject('POST', `/emr/encounters/${open.id}/orders/${saved.orders[0].id}/cancel`, doctor, { reason: 'Not needed' });
    expect(res.statusCode).toBe(409);
  });

  it('suggests a credit note when a billed procedure is cancelled', async () => {
    const enc = await signedWith([{ kind: 'procedure', name: 'Dressing small', serviceCode: DRESS }]);
    const [c] = await charges(enc.id);
    const bill = await call('POST', '/billing/charges/bill', admin, { patientId: pid, chargeIds: [c!.id] });
    expect(bill.statusCode, bill.body).toBe(201);
    const res = await inject('POST', `/emr/encounters/${enc.id}/orders/${enc.orders[0]!.id}/cancel`, doctor, { reason: 'Done by mistake' });
    expect(res.statusCode, res.body).toBe(200);
    const [after] = await charges(enc.id);
    expect(after).toMatchObject({ status: 'billed', invoiceId: bill.json().id, reversalReason: 'Done by mistake' });
    expect(after!.reversalRequestedAt).toBeTruthy();
  });
});

describe('emr hospital isolation', () => {
  it("never shows or changes one hospital's consultations from another", async () => {
    const enc = (await inject('POST', '/emr/encounters', doctor, { patientId })).json();
    // The city admin holds emr.encounter.read, so these reach the database and RLS hides demo's rows.
    expect((await inject('GET', `/emr/encounters/${enc.id}`, otherHospital)).statusCode).toBe(404);
    expect((await inject('GET', `/emr/patients/${patientId}/timeline`, otherHospital)).json().items).toEqual([]);
    expect((await inject('GET', `/emr/queue?doctorId=${doctorId}`, otherHospital)).json().items).toEqual([]);

    // Writes scoped to the other hospital touch nothing.
    const cityTenant = (await inject('GET', '/auth/me', otherHospital)).json().tenantId;
    const db = app.get(DbService);
    const changed = await db.asTenant({ tenantId: cityTenant }, async (tx) => {
      const r = await tx.execute(sql`update clinical.encounters set follow_up_notes = 'x' where id = ${enc.id}`);
      return r.rowCount;
    });
    expect(changed).toBe(0);
    await expect(
      db.asTenant({ tenantId: cityTenant }, (tx) =>
        tx.execute(sql`insert into clinical.encounter_addenda (tenant_id, encounter_id, text) values (${tenantId}, ${enc.id}, 'x')`),
      ),
    ).rejects.toThrow();
  });
});

describe('emr validations', () => {
  let encounterId: string;
  const msg = (res: { json: () => { error: { message: string } } }) => res.json().error.message;

  beforeAll(async () => {
    encounterId = (await inject('POST', '/emr/encounters', doctor, { patientId })).json().id;
  });

  it('refuses vitals out of range, half-entered BP and an empty reading', async () => {
    const pulse = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { pulse: 300 });
    expect(pulse.statusCode).toBe(400);
    expect(msg(pulse)).toContain('Pulse must be between 20 and 250');
    const spo2 = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { spo2: 120 });
    expect(spo2.statusCode).toBe(400);
    expect(msg(spo2)).toContain('SpO2 must be between 40 and 100');
    const half = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { bpSystolic: 120 });
    expect(half.statusCode).toBe(400);
    expect(msg(half)).toContain('Enter both systolic and diastolic BP');
    const upside = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { bpSystolic: 80, bpDiastolic: 120 });
    expect(msg(upside)).toContain('Diastolic BP must be lower than systolic BP');
    const empty = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { notes: 'nothing measured' });
    expect(empty.statusCode).toBe(400);
    expect(msg(empty)).toContain('Enter at least one reading');
    const ok = await inject('POST', `/emr/encounters/${encounterId}/vitals`, nurse, { bpSystolic: 120, bpDiastolic: 80, pulse: 78, temperatureC: 37.2, spo2: 98, weightKg: 70, heightCm: 170 });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().vitals.at(-1).bmi).toBe(24.2);
  });

  it('refuses a follow-up date in the past but keeps an old one on re-save', async () => {
    const past = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: todayIso(-1) });
    expect(past.statusCode).toBe(400);
    expect(msg(past)).toBe('Follow-up date cannot be in the past');
    const far = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: todayIso(365 * 3) });
    expect(msg(far)).toBe('Follow-up date can be at most 2 years ahead');
    const bad = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: '2026-02-30' });
    expect(bad.statusCode).toBe(400);
    const ok = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: todayIso() });
    expect(ok.statusCode).toBe(200);
    const again = await inject('PATCH', `/emr/encounters/${encounterId}`, doctor, { followUpDate: todayIso(), notes: { advice: 'Rest' } });
    expect(again.statusCode).toBe(200);
    const quick = await inject('POST', '/emr/prescriptions', doctor, { patientId, lines: [{ drugName: 'ORS', dose: '1 sachet', frequency: 'TDS' }], followUpDate: todayIso(-2) });
    expect(quick.statusCode).toBe(400);
    expect(msg(quick)).toContain('Follow-up date cannot be in the past');
  });

  it('refuses prescription lines without dose, with negative days or a short override reason', async () => {
    const noDose = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, { lines: [{ drugName: 'Paracetamol 650', dose: '', frequency: 'TDS' }] });
    expect(noDose.statusCode).toBe(400);
    expect(msg(noDose)).toContain('Enter the dose');
    const days = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, { lines: [{ drugName: 'Paracetamol 650', dose: '1 tab', frequency: 'TDS', days: -2 }] });
    expect(msg(days)).toContain('Days cannot be negative');
    const reason = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, { lines: [{ drugName: 'Amoxicillin 500', dose: '1 cap', frequency: 'TDS', allergyOverrideReason: 'ok' }] });
    expect(msg(reason)).toContain('at least 3 characters');
    const ok = await inject('PUT', `/emr/encounters/${encounterId}/prescription`, doctor, { lines: [{ drugName: 'Paracetamol 650', dose: '1 tab', frequency: 'TDS', days: 5 }] });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().prescription.lines[0].qty).toBe(15);
  });

  it('checks certificate dates', async () => {
    const reversed = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave', fromDate: todayIso(2), toDate: todayIso() });
    expect(reversed.statusCode).toBe(400);
    expect(msg(reversed)).toContain('End date is before start date');
    const old = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'medical', fromDate: todayIso(-400) });
    expect(msg(old)).toContain('From date can be at most 90 days in the past');
    const noTo = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave', fromDate: todayIso() });
    expect(msg(noTo)).toContain('Sick leave needs a to date');
    const fit = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'fitness', fromDate: todayIso(-3) });
    expect(fit.statusCode).toBe(201);
  });
});
