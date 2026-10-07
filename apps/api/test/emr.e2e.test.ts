import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../src/common/events/event-bus';
import { DbService } from '../src/common/db/db.service';
import { sql } from '@hms/db';
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

const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, token: string, payload?: object) =>
  app.inject({ method, url: `/api/v1${url}`, headers: bearer(token), payload });

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
      followUpDate: '2026-12-01',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('in_progress');
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
    expect(signedEvent).toMatchObject({ followUpDate: '2026-12-01', followUpNotes: null });
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
      followUpDate: '2026-11-01',
      sign: true,
    });
    expect(res.statusCode).toBe(201);
    const { encounterId, prescriptionId, rxNo } = res.json();
    expect(rxNo).toMatch(/^RX/);
    const enc = (await inject('GET', `/emr/encounters/${encounterId}`, doctor)).json();
    expect(enc).toMatchObject({ status: 'completed', followUpDate: '2026-11-01', notes: { advice: 'Steam inhalation' } });
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

  it('issues a sick-leave certificate', async () => {
    const bad = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave' });
    expect(bad.statusCode).toBe(400);
    const res = await inject('POST', '/emr/certificates', doctor, { patientId, kind: 'sick_leave', fromDate: '2026-10-07', toDate: '2026-10-09', diagnosis: 'Acute pharyngitis' });
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
