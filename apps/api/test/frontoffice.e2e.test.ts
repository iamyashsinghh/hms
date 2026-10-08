import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let reception: string;
let doctor: string;
let doctorId: string;
let nurse: string;
let pharmacist: string;
let admin: string;
let otherHospital: string;
let facilityId: string;

/** Demo-hospital headers; the plan asks every test to send the facility explicitly. */
const h = (token: string) => ({ ...bearer(token), 'x-facility-id': facilityId });

const run = Date.now();

function slot(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60_000).toISOString();
}
const IST = 330 * 60_000;
const istDate = (iso: string) => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);

async function newPatient(token = reception, extra: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/patients',
    headers: h(token),
    payload: { firstName: 'Queue', lastName: `Tester${run}${Math.floor(Math.random() * 1e6)}`, gender: 'male', ageYears: 40, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; uhid: string; firstName: string; lastName: string };
}

async function book(patientId: string, slotStart: string, token = reception) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/frontoffice/appointments',
    headers: token === otherHospital ? bearer(token) : h(token),
    payload: { patientId, doctorId, slotStart, type: 'new', durationMinutes: 5 },
  });
}

/**
 * Books the first free 5-minute slot from `minutesFromNow` on (the database keeps earlier runs' bookings).
 * With `today`, stays inside today's IST day so check-in is allowed.
 */
async function bookFree(patientId: string, minutesFromNow: number, today = false) {
  for (let i = 0; i < 60; i++) {
    const start = slot(minutesFromNow + i * 7 + Math.floor(Math.random() * 5));
    if (today && istDate(start) !== istDate(new Date().toISOString())) break;
    const res = await book(patientId, start);
    if (res.statusCode === 201) return res.json();
    if (res.json().error?.code !== 'slot_taken') throw new Error(res.body);
  }
  throw new Error('no free slot found');
}

beforeAll(async () => {
  app = await bootApp();
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  const doc = await login(app, 'doctor@demo.hms');
  doctor = doc.accessToken;
  doctorId = doc.user.id;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) });
  facilityId = me.json().facilities.find((f: { code: string }) => f.code === 'MAIN').id;
});
afterAll(() => app.close());

describe('frontoffice: doctors', () => {
  it('lists active doctors', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/frontoffice/doctors', headers: h(reception) });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((d: { userId: string }) => d.userId)).toContain(doctorId);
  });
});

describe('frontoffice: appointments', () => {
  it('books, rejects a double booking, reschedules and cancels with history', async () => {
    const p = await newPatient();
    const appt = await bookFree(p.id, 60 * 24 * 3);
    const start = appt.slotStart;
    expect(appt.appointmentNo).toMatch(/^AP\d{6}$/);
    expect(appt.status).toBe('booked');
    expect(appt.patient.uhid).toBe(p.uhid);
    expect(appt.doctorName).toBe('Dr. Asha Rao');

    // Same doctor, overlapping slot.
    const other = await newPatient();
    const clash = await book(other.id, new Date(new Date(start).getTime() + 2 * 60_000).toISOString());
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('slot_taken');

    let newStart = slot(60 * 24 * 4 + Math.floor(Math.random() * 600));
    let moved = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/appointments/${appt.id}/reschedule`,
      headers: h(reception),
      payload: { slotStart: newStart, reason: 'Patient asked' },
    });
    for (let i = 0; moved.statusCode === 409 && i < 30; i++) {
      newStart = slot(60 * 24 * 4 + 600 + i * 11);
      moved = await app.inject({
        method: 'POST',
        url: `/api/v1/frontoffice/appointments/${appt.id}/reschedule`,
        headers: h(reception),
        payload: { slotStart: newStart, reason: 'Patient asked' },
      });
    }
    expect(moved.statusCode).toBe(201);
    expect(moved.json().rescheduleCount).toBe(1);
    expect(moved.json().slotStart).toBe(new Date(newStart).toISOString());

    // The old slot is free again.
    expect((await book(other.id, start)).statusCode).toBe(201);

    const cancelled = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/appointments/${appt.id}/cancel`,
      headers: h(reception),
      payload: { reason: 'Travelling' },
    });
    expect(cancelled.json().status).toBe('cancelled');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/appointments/${appt.id}/no-show`,
      headers: h(reception),
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invalid_status');

    const detail = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/appointments/${appt.id}`, headers: h(reception) });
    expect(detail.json().history.map((h: { event: string }) => h.event)).toEqual(['booked', 'rescheduled', 'cancelled']);
  });

  it('rejects past slots and non-doctors', async () => {
    const p = await newPatient();
    const past = await book(p.id, slot(-120));
    expect(past.json().error.code).toBe('slot_in_past');
    const notDoc = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/appointments',
      headers: h(reception),
      payload: { patientId: p.id, doctorId: (await login(app, 'nurse@demo.hms')).user.id, slotStart: slot(600) },
    });
    expect(notDoc.json().error.code).toBe('not_a_doctor');
  });

  it('lists appointments by date and doctor', async () => {
    const p = await newPatient();
    const appt = await bookFree(p.id, 60 * 24 * 6);
    const date = istDate(appt.slotStart);
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/frontoffice/appointments?date=${date}&doctorId=${doctorId}`,
      headers: h(doctor),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items.map((a: { id: string }) => a.id)).toContain(appt.id);
  });

  it('enforces permissions', async () => {
    const p = await newPatient();
    const res = await book(p.id, slot(900), doctor);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.missing).toEqual(['frontoffice.appointment.create']);
    const q = await app.inject({ method: 'GET', url: '/api/v1/frontoffice/queue', headers: h(pharmacist) });
    expect(q.statusCode).toBe(403);
  });
});

describe('frontoffice: doctor schedules from setup', () => {
  let schedDoctor: string;
  let day: string;

  beforeAll(async () => {
    const roles = await app.inject({ method: 'GET', url: '/api/v1/setup/roles', headers: h(admin) });
    const roleId = roles.json().find((r: { key: string }) => r.key === 'doctor').id;
    const user = await app.inject({
      method: 'POST',
      url: '/api/v1/setup/users',
      headers: h(admin),
      payload: { name: `Dr. Slot ${run}`, email: `slot${run}@demo.hms`, roles: [{ roleId }] },
    });
    expect(user.statusCode).toBe(201);
    schedDoctor = user.json().id;
    day = istDate(slot(60 * 24 * 3));
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    const sched = await app.inject({
      method: 'PUT',
      url: `/api/v1/setup/doctors/${schedDoctor}/schedule`,
      headers: h(admin),
      payload: { blocks: [{ facilityId, weekday, startTime: '10:00', endTime: '11:00', slotMinutes: 15, maxPatients: 2 }] },
    });
    expect(sched.statusCode).toBe(200);
  });

  const bookAt = (patientId: string, slotStart: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/appointments',
      headers: h(reception),
      payload: { patientId, doctorId: schedDoctor, slotStart },
    });

  it('books only into schedule slots, up to the slot capacity, and reports occupancy', async () => {
    const slots = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/doctors/${schedDoctor}/slots?date=${day}`, headers: h(reception) });
    expect(slots.statusCode).toBe(200);
    expect(slots.json()).toHaveLength(4);
    expect(slots.json()[0]).toMatchObject({ capacity: 2, booked: 0, available: true });

    const tenAm = new Date(`${day}T10:00:00+05:30`).toISOString();
    const offSlot = await bookAt((await newPatient()).id, new Date(`${day}T10:07:00+05:30`).toISOString());
    expect(offSlot.json().error.code).toBe('not_a_slot');

    const first = await bookAt((await newPatient()).id, tenAm);
    expect(first.statusCode).toBe(201);
    expect(first.json().slotEnd).toBe(new Date(`${day}T10:15:00+05:30`).toISOString());
    expect((await bookAt((await newPatient()).id, tenAm)).statusCode).toBe(201);
    const full = await bookAt((await newPatient()).id, tenAm);
    expect(full.json().error.code).toBe('slot_taken');

    const after = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/doctors/${schedDoctor}/slots?date=${day}`, headers: h(reception) });
    expect(after.json()[0]).toMatchObject({ booked: 2, available: false });
    expect(after.json()[1]).toMatchObject({ booked: 0, available: true });
  });

  it('refuses days the doctor does not work', async () => {
    const nextDay = istDate(new Date(new Date(`${day}T12:00:00Z`).getTime() + 86_400_000).toISOString());
    const res = await bookAt((await newPatient()).id, new Date(`${nextDay}T10:00:00+05:30`).toISOString());
    expect(res.json().error.code).toBe('doctor_unavailable');
  });
});

describe('frontoffice: check-in and queue', () => {
  it('checks in an appointment, issues tokens, and moves through the queue', async () => {
    const a = await newPatient();
    const appt = await bookFree(a.id, 1, true);
    const checkIn = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/appointments/${appt.id}/check-in`,
      headers: h(reception),
      payload: {},
    });
    expect(checkIn.statusCode).toBe(201);
    const visit = checkIn.json();
    expect(visit.status).toBe('waiting');
    expect(visit.kind).toBe('appointment');
    expect(visit.tokenNo).toBeGreaterThan(0);
    expect(visit.visitNo).toMatch(/^OP\d{6}$/);

    // A walk-in for the same doctor gets the next token.
    const b = await newPatient();
    const walk = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/walk-ins',
      headers: h(reception),
      payload: { patientId: b.id, doctorId, priority: 'urgent' },
    });
    expect(walk.statusCode).toBe(201);
    expect(walk.json().tokenNo).toBe(visit.tokenNo + 1);

    // Same patient twice in today's queue is refused.
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/walk-ins',
      headers: h(reception),
      payload: { patientId: b.id, doctorId },
    });
    expect(dup.json().error.code).toBe('already_in_queue');

    // Urgent walk-in is ordered ahead of normal waiting tokens.
    const queue = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/queue?doctorId=${doctorId}`, headers: h(doctor) });
    expect(queue.statusCode).toBe(200);
    const ids = queue.json().items.filter((v: { status: string }) => v.status === 'waiting').map((v: { id: string }) => v.id);
    expect(ids.indexOf(walk.json().id)).toBeLessThan(ids.indexOf(visit.id));
    expect(queue.json().summary.waiting).toBeGreaterThanOrEqual(2);

    const move = (id: string, action: string, token = doctor) =>
      app.inject({ method: 'POST', url: `/api/v1/frontoffice/visits/${id}/transition`, headers: h(token), payload: { action, room: 'Cabin 2' } });

    expect((await move(visit.id, 'call')).json().status).toBe('called');
    expect((await move(visit.id, 'start')).json().status).toBe('in_consultation');
    const done = await move(visit.id, 'complete');
    expect(done.json().status).toBe('completed');
    expect(done.json().completedAt).toBeTruthy();
    expect((await move(visit.id, 'call')).json().error.code).toBe('invalid_status');

    // The appointment followed the visit.
    const detail = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/appointments/${appt.id}`, headers: h(reception) });
    expect(detail.json().status).toBe('completed');
    expect(detail.json().visitId).toBe(visit.id);
    expect(detail.json().history.map((h: { event: string }) => h.event)).toEqual(['booked', 'checked_in', 'started', 'completed']);

    // Skip and requeue the walk-in, then the nurse calls it.
    expect((await move(walk.json().id, 'skip')).json().status).toBe('skipped');
    expect((await move(walk.json().id, 'requeue')).json().status).toBe('waiting');
    expect((await move(walk.json().id, 'call', nurse)).json().status).toBe('called');

    // TV board shows masked names.
    const board = await app.inject({ method: 'GET', url: '/api/v1/frontoffice/display', headers: h(nurse) });
    expect(board.statusCode).toBe(200);
    const mine = board.json().doctors.find((d: { doctorId: string }) => d.doctorId === doctorId);
    expect(mine.nowServing.tokenNo).toBe(walk.json().tokenNo);
    expect(mine.nowServing.patientName).toBe(`Queue ${b.lastName[0]}.`);
    expect(mine.nowServing.room).toBe('Cabin 2');
  });

  it('refuses check-in for an appointment on another day', async () => {
    const p = await newPatient();
    const appt = await bookFree(p.id, 60 * 24 * 8);
    const res = await app.inject({ method: 'POST', url: `/api/v1/frontoffice/appointments/${appt.id}/check-in`, headers: h(reception), payload: {} });
    expect(res.json().error.code).toBe('not_today');
  });
});

describe('frontoffice: duplicates, merge and ABHA', () => {
  it('finds duplicates by mobile and name, merges them, and moves appointments', async () => {
    const mobile = `9${String(run).slice(-9)}`;
    const keep = await newPatient(reception, { firstName: 'Mohini', lastName: `Dup${run}`, mobile, dateOfBirth: '1990-02-03' });
    const dupe = await newPatient(reception, { firstName: 'Mohini', lastName: `Dup${run}`, mobile, ageYears: undefined });

    const search = await app.inject({
      method: 'GET',
      url: `/api/v1/frontoffice/patients/duplicates?firstName=Mohini&lastName=Dup${run}&mobile=${mobile}&dateOfBirth=1990-02-03`,
      headers: h(reception),
    });
    expect(search.statusCode).toBe(200);
    const top = search.json()[0];
    expect([keep.id, dupe.id]).toContain(top.patient.id);
    expect(top.score).toBeGreaterThanOrEqual(80);
    expect(top.reasons).toContain('Same mobile');

    const appt = await bookFree(dupe.id, 60 * 24 * 10);

    // Receptionists cannot merge; admins can.
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/patients/merge',
      headers: h(reception),
      payload: { sourcePatientId: dupe.id, targetPatientId: keep.id, reason: 'Same person' },
    });
    expect(denied.statusCode).toBe(403);

    const merged = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/patients/merge',
      headers: h(admin),
      payload: { sourcePatientId: dupe.id, targetPatientId: keep.id, reason: 'Same person, registered twice' },
    });
    expect(merged.statusCode).toBe(201);
    expect(merged.json().movedAppointments).toBe(1);

    const moved = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/appointments/${appt.id}`, headers: h(reception) });
    expect(moved.json().patientId).toBe(keep.id);

    // The duplicate cannot be booked or merged again.
    const bookMerged = await book(dupe.id, slot(60 * 24 * 11));
    expect(bookMerged.json().error.code).toBe('patient_merged');
    const twice = await app.inject({
      method: 'POST',
      url: '/api/v1/frontoffice/patients/merge',
      headers: h(admin),
      payload: { sourcePatientId: dupe.id, targetPatientId: keep.id, reason: 'again' },
    });
    expect(twice.json().error.code).toBe('already_merged');
  });

  it('captures an ABHA number and refuses one already linked to another patient', async () => {
    const abha = `91${String(run).slice(-12).padStart(12, '0')}`;
    const a = await newPatient();
    const b = await newPatient();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/patients/${a.id}/abha`,
      headers: h(reception),
      payload: { abhaNumber: `${abha.slice(0, 2)}-${abha.slice(2, 6)}-${abha.slice(6, 10)}-${abha.slice(10)}`, abhaAddress: 'queue@abdm' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().abhaNumber).toBe(abha);
    const clash = await app.inject({ method: 'POST', url: `/api/v1/frontoffice/patients/${b.id}/abha`, headers: h(reception), payload: { abhaNumber: abha } });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('abha_in_use');

    const found = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/patients/duplicates?abhaNumber=${abha}`, headers: h(reception) });
    expect(found.json()[0].patient.id).toBe(a.id);
    expect(found.json()[0].score).toBe(100);
  });
});

describe('frontoffice: validation messages', () => {
  const bad = async (method: 'GET' | 'POST', url: string, payload: Record<string, unknown> | undefined, message: string) => {
    const res = await app.inject({ method, url, headers: h(reception), payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain(message);
  };

  it('explains bad ABHA numbers and addresses', async () => {
    const p = await newPatient();
    await bad('POST', `/api/v1/frontoffice/patients/${p.id}/abha`, { abhaNumber: '9112345678901' }, 'ABHA number has 14 digits');
    await bad('POST', `/api/v1/frontoffice/patients/${p.id}/abha`, { abhaNumber: '91123456789012', abhaAddress: 'no at sign' }, 'Enter an ABHA address like name@abdm');
  });

  it('needs a real reason to merge or cancel, and two different patients', async () => {
    const a = await newPatient();
    const b = await newPatient();
    const merge = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/frontoffice/patients/merge', headers: h(admin), payload });
    let res = await merge({ sourcePatientId: a.id, targetPatientId: b.id, reason: 'ab' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Reason needs at least 3 characters');
    res = await merge({ sourcePatientId: a.id, targetPatientId: a.id, reason: 'Registered twice' });
    expect(res.json().error.message).toContain('Pick two different patients');

    const appt = await bookFree(a.id, 60 * 24 * 14);
    await bad('POST', `/api/v1/frontoffice/appointments/${appt.id}/cancel`, { reason: '   ' }, 'Give a reason for cancelling');
  });

  it('checks walk-in, token and list inputs', async () => {
    await bad('POST', '/api/v1/frontoffice/walk-ins', { doctorId }, 'Pick a patient');
    const p = await newPatient();
    await bad('POST', '/api/v1/frontoffice/walk-ins', { patientId: p.id, doctorId, priority: 'vip' }, 'Pick a priority');
    await bad('GET', '/api/v1/frontoffice/appointments?from=2026-05-10&to=2026-05-01', undefined, 'End date is before start date');
  });
});

describe('frontoffice: hospital isolation', () => {
  it("never shows or changes one hospital's appointments and queue from another", async () => {
    const p = await newPatient();
    const appt = await bookFree(p.id, 60 * 24 * 12);

    const read = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/appointments/${appt.id}`, headers: bearer(otherHospital) });
    expect(read.statusCode).toBe(404);
    const cancel = await app.inject({
      method: 'POST',
      url: `/api/v1/frontoffice/appointments/${appt.id}/cancel`,
      headers: bearer(otherHospital),
      payload: { reason: 'x' },
    });
    expect(cancel.statusCode).toBe(404);
    const list = await app.inject({ method: 'GET', url: '/api/v1/frontoffice/appointments', headers: bearer(otherHospital) });
    expect(list.json().items.find((x: { id: string }) => x.id === appt.id)).toBeUndefined();

    // The other hospital cannot book our patient with our doctor either.
    const cross = await book(p.id, slot(60 * 24 * 13), otherHospital);
    expect(cross.statusCode).toBe(404);

    const queue = await app.inject({ method: 'GET', url: '/api/v1/frontoffice/queue', headers: bearer(otherHospital) });
    expect(queue.json().items.find((v: { patientId: string }) => v.patientId === p.id)).toBeUndefined();
    const dupes = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/patients/duplicates?firstName=Queue&lastName=${p.lastName}`, headers: bearer(otherHospital) });
    expect(dupes.json()).toEqual([]);
  });
});

describe('frontoffice: OPD billing', () => {
  let feeDoctorId: string;
  let codes: { consultation: string; followUp: string };
  let tenantId: string;
  const api = (token: string, method: string, url: string, payload?: unknown) =>
    app.inject({ method: method as 'GET', url: `/api/v1${url}`, headers: h(token), payload: payload as object });
  const service = async (code: string) =>
    (await api(admin, 'GET', `/billing/services?q=${code}&active=all`)).json().items.find((s: { code: string }) => s.code === code);
  const walkIn = async (patientId: string, doc = feeDoctorId) => {
    const res = await api(reception, 'POST', '/frontoffice/walk-ins', { patientId, doctorId: doc });
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const move = (id: string, action: string, token = reception) => api(token, 'POST', `/frontoffice/visits/${id}/transition`, { action });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charges = async (patientId: string) => (await api(admin, 'GET', `/billing/charges?patientId=${patientId}`)).json().items as Array<Record<string, any>>;
  const setRules = async (rules: Record<string, unknown>) => {
    const res = await api(admin, 'PUT', '/billing/rules', { rules });
    expect(res.statusCode, res.body).toBe(200);
  };
  const profile = (fees: Record<string, unknown>) => api(admin, 'PUT', `/setup/staff/${feeDoctorId}/profile`, { staffType: 'doctor', ...fees });

  beforeAll(async () => {
    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
    tenantId = me.tenantId;
    const roles = (await api(admin, 'GET', '/setup/roles')).json() as { id: string; key: string }[];
    const created = await api(admin, 'POST', '/setup/users', {
      name: `Dr. Fee ${run}`,
      email: `dr.fee.${run}@demo.hms`,
      roles: [{ roleId: roles.find((r) => r.key === 'doctor')!.id }],
      staffProfile: { staffType: 'doctor', consultationFee: 500, followUpFee: 200, followUpDays: 7 },
    });
    expect(created.statusCode, created.body).toBe(201);
    feeDoctorId = created.json().id;
    const last8 = feeDoctorId.replace(/-/g, '').slice(-8).toUpperCase();
    codes = { consultation: `CONS-${last8}`, followUp: `FUP-${last8}` };
    // Start from the hospital's default rules.
    await api(admin, 'PUT', '/billing/rules', { replace: true, rules: {} });
    await api(admin, 'PUT', '/billing/rules', { facilityId, replace: true, rules: {} });
  });
  afterAll(async () => {
    await api(admin, 'PUT', '/billing/rules', { replace: true, rules: {} });
  });

  it("keeps the doctor's fees as billing services when the fee is edited in setup", async () => {
    expect(await service(codes.consultation)).toMatchObject({ category: 'consultation', basePrice: 500, isActive: true });
    expect((await service(codes.consultation)).name).toBe(`Consultation - Dr. Fee ${run}`);
    expect(await service(codes.followUp)).toMatchObject({ basePrice: 200, isActive: true });

    expect((await profile({ consultationFee: 600, followUpDays: 7 })).statusCode).toBe(200);
    expect(await service(codes.consultation)).toMatchObject({ basePrice: 600, isActive: true });
    // Follow-up fee cleared: its service is switched off.
    expect(await service(codes.followUp)).toMatchObject({ isActive: false });

    expect((await profile({ consultationFee: 600, followUpFee: 200, followUpDays: 7 })).statusCode).toBe(200);
    expect(await service(codes.followUp)).toMatchObject({ basePrice: 200, isActive: true });
  });

  it("charges the doctor's fee at walk-in and the follow-up fee on a revisit inside the follow-up days", async () => {
    const p = await newPatient();
    const v1 = await walkIn(p.id);
    expect(v1).toMatchObject({ feeType: 'full', paymentState: 'pending', collectNow: true });
    expect(v1.chargeIds).toHaveLength(1);
    let list = await charges(p.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: v1.chargeIds[0],
      serviceCode: codes.consultation,
      unitPrice: 600,
      amount: 600,
      status: 'pending',
      visitId: v1.id,
      account: 'opd',
      doctorId: feeDoctorId,
      sourceModule: 'frontoffice',
      sourceRef: v1.id,
      sourceLine: 'consultation',
    });

    // The queue shows the flag.
    const q = (await api(reception, 'GET', `/frontoffice/queue?doctorId=${feeDoctorId}`)).json();
    expect(q.items.find((v: { id: string }) => v.id === v1.id).paymentState).toBe('pending');
    expect(q.billing).toEqual({ collectAtCheckIn: true, blockUnpaid: false });

    // Flag only (default rule): the doctor can still see the patient.
    expect((await move(v1.id, 'start')).statusCode).toBe(201);
    expect((await move(v1.id, 'complete')).statusCode).toBe(201);

    const v2 = await walkIn(p.id);
    expect(v2.feeType).toBe('follow_up');
    list = await charges(p.id);
    expect(list.find((c) => c.sourceRef === v2.id)).toMatchObject({ serviceCode: codes.followUp, unitPrice: 200, status: 'pending' });
    expect((await move(v2.id, 'start')).statusCode).toBe(201);
    expect((await move(v2.id, 'complete')).statusCode).toBe(201);

    // The hospital always charges the full fee.
    await setRules({ followUp: 'full_fee' });
    const v3 = await walkIn(p.id);
    expect(v3.feeType).toBe('full');
    expect((await charges(p.id)).find((c) => c.sourceRef === v3.id)).toMatchObject({ serviceCode: codes.consultation, unitPrice: 600 });
    await move(v3.id, 'cancel');
    await setRules({ followUp: 'doctor_fee' });

    // A free follow-up (fee 0) posts no charge.
    expect((await profile({ consultationFee: 600, followUpFee: 0, followUpDays: 7 })).statusCode).toBe(200);
    const v4 = await walkIn(p.id);
    expect(v4).toMatchObject({ feeType: 'free_follow_up', chargeIds: [], paymentState: 'none' });
    expect((await charges(p.id)).filter((c) => c.sourceRef === v4.id)).toHaveLength(0);
    await move(v4.id, 'cancel');
    expect((await profile({ consultationFee: 600, followUpFee: 200, followUpDays: 7 })).statusCode).toBe(200);
  });

  it('charges at check-in, not at booking, and cancelling the appointment cancels the charge', async () => {
    const p = await newPatient();
    let appt: { id: string; slotStart: string } | undefined;
    for (let i = 0; i < 40 && !appt; i++) {
      const start = slot(2 + i * 6 + Math.floor(Math.random() * 4));
      if (istDate(start) !== istDate(new Date().toISOString())) break;
      const res = await api(reception, 'POST', '/frontoffice/appointments', { patientId: p.id, doctorId: feeDoctorId, slotStart: start, type: 'new', durationMinutes: 5 });
      if (res.statusCode === 201) appt = res.json();
    }
    if (!appt) return; // too close to midnight (IST) to book today
    expect(await charges(p.id)).toHaveLength(0);

    const checkIn = await api(reception, 'POST', `/frontoffice/appointments/${appt.id}/check-in`, {});
    expect(checkIn.statusCode, checkIn.body).toBe(201);
    const v = checkIn.json();
    expect(v).toMatchObject({ kind: 'appointment', feeType: 'full', collectNow: true });
    expect((await charges(p.id))[0]).toMatchObject({ id: v.chargeIds[0], unitPrice: 600, visitId: v.id, status: 'pending' });

    const cancelled = await api(reception, 'POST', `/frontoffice/appointments/${appt.id}/cancel`, { reason: 'Had to leave' });
    expect(cancelled.statusCode).toBe(201);
    expect((await charges(p.id))[0]).toMatchObject({ status: 'cancelled' });
  });

  it('posts no charge for a doctor without a fee', async () => {
    const p = await newPatient();
    const v = await walkIn(p.id, doctorId);
    expect(v).toMatchObject({ feeType: 'none', chargeIds: [], paymentState: 'none' });
    expect(await charges(p.id)).toHaveLength(0);
    await move(v.id, 'cancel');
  });

  it('cancelling a token cancels its pending consultation charge', async () => {
    const p = await newPatient();
    const v = await walkIn(p.id);
    expect((await move(v.id, 'cancel')).statusCode).toBe(201);
    expect((await charges(p.id))[0]).toMatchObject({ status: 'cancelled', sourceRef: v.id });
  });

  it('keeps an unpaid patient from being called when the hospital blocks unpaid OPD', async () => {
    await setRules({ opdPayment: 'before', opdUnpaid: 'block' });
    try {
      const p = await newPatient();
      const v = await walkIn(p.id);
      const q = (await api(reception, 'GET', `/frontoffice/queue?doctorId=${feeDoctorId}`)).json();
      expect(q.billing).toEqual({ collectAtCheckIn: true, blockUnpaid: true });

      const refused = await move(v.id, 'call');
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error).toMatchObject({ code: 'consultation_unpaid', message: 'Collect the consultation fee first' });
      expect((await move(v.id, 'start')).statusCode).toBe(409);

      const paid = await api(admin, 'POST', '/billing/charges/bill', { patientId: p.id, chargeIds: v.chargeIds, payNow: { mode: 'cash', amount: 600 } });
      expect(paid.statusCode, paid.body).toBe(201);
      expect((await api(reception, 'GET', `/frontoffice/visits/${v.id}`)).json().paymentState).toBe('paid');
      expect((await move(v.id, 'call')).statusCode).toBe(201);
      expect((await move(v.id, 'start')).statusCode).toBe(201);

      // Paying at the end of the visit ('after'): no prompt and no block.
      await setRules({ opdPayment: 'after' });
      const p2 = await newPatient();
      const v2 = await walkIn(p2.id);
      expect(v2.collectNow).toBe(false);
      expect((await move(v2.id, 'call')).statusCode).toBe(201);
      await move(v2.id, 'cancel');
    } finally {
      await setRules({ opdPayment: 'before', opdUnpaid: 'flag' });
    }
  });

  it('charges the registration fee when the hospital switches it on, and again once it expires', async () => {
    await setRules({ registrationFee: { enabled: true, amount: 150, validityMonths: 12 } });
    try {
      const p = await newPatient();
      const reg = await charges(p.id);
      expect(reg).toHaveLength(1);
      expect(reg[0]).toMatchObject({
        description: 'Registration fee',
        unitPrice: 150,
        amount: 150,
        status: 'pending',
        sourceModule: 'patients',
        sourceRef: p.id,
        sourceLine: 'registration',
        account: 'other',
        visitId: null,
      });

      // Still valid at check-in: nothing more is posted (this doctor has no fee).
      const v1 = await walkIn(p.id, doctorId);
      expect(v1.chargeIds).toHaveLength(0);
      await move(v1.id, 'cancel');
      expect(await charges(p.id)).toHaveLength(1);

      // Thirteen months later the registration is renewed at check-in, on that visit.
      await app.get(DbService).asTenant({ tenantId }, (tx) =>
        tx.execute(sql`update billing.charges set charge_date = charge_date - interval '13 months' where id = ${reg[0]!.id}`),
      );
      const v2 = await walkIn(p.id, doctorId);
      expect(v2.chargeIds).toHaveLength(1);
      const renewal = (await charges(p.id)).find((c) => c.id === v2.chargeIds[0]);
      expect(renewal).toMatchObject({ description: 'Registration fee (renewal)', unitPrice: 150, visitId: v2.id, sourceModule: 'patients' });
      expect(renewal!.sourceLine).toMatch(/^registration-\d{4}-\d{2}-\d{2}$/);
      expect(v2.paymentState).toBe('pending');
      await move(v2.id, 'cancel');

      await setRules({ registrationFee: { enabled: false, amount: 150, validityMonths: 12 } });
      const off = await newPatient();
      expect(await charges(off.id)).toHaveLength(0);
    } finally {
      await setRules({ registrationFee: { enabled: false, amount: 0, validityMonths: 12 } });
    }
  });
});
