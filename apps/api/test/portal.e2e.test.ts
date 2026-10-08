import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { Client } from 'pg';
import { DEMO_PASSWORD, provisionTenant, sql, upsertUser } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { ChargesService } from '../src/modules/billing/charges.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let reception: string;
let doctorStaff: string;
let cityAdmin: string;
let demoTenantId: string;

config({ path: resolve(__dirname, '../../../.env'), quiet: true });

/** Booking needs a doctor timetable, so it runs in a throwaway hospital (no schedule changes in shared demo data). */
const HOSPITAL = { code: `portal-${Date.now().toString(36)}`, admin: '', doctorId: '' };

async function provisionTestHospital() {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const t = await provisionTenant(client, {
      code: HOSPITAL.code,
      name: 'Portal Test Hospital',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Portal Admin', email: `admin@${HOSPITAL.code}.test`, password: DEMO_PASSWORD },
    });
    await upsertUser(client, t.tenantId, { name: 'Dr. Portal Test', email: `doctor@${HOSPITAL.code}.test`, password: DEMO_PASSWORD, roleKeys: ['doctor'] });
    await client.query('COMMIT');
    return t.facilityId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

const randomMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

async function patientLogin(mobile: string, tenantCode = 'demo') {
  const req = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/request', payload: { tenantCode, mobile } });
  expect(req.statusCode).toBe(200);
  const { devCode } = req.json();
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/portal/auth/otp/verify',
    payload: { tenantCode, mobile, otp: devCode, client: 'mobile' },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { accessToken: string; refreshToken: string; me: { accountId: string; patients: Array<{ id: string; relation: string }> } };
}

async function registerPatient(mobile: string, firstName = 'Portal') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/patients',
    headers: bearer(reception),
    payload: { firstName, lastName: `Test${Date.now()}`, gender: 'female', ageYears: 34, mobile },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; uhid: string };
}

function emit(topic: string, payload: Record<string, unknown>, id: string = randomUUID(), tenantId = demoTenantId) {
  return app.get(EventBus).dispatch({ id, tenantId, topic, payload, createdAt: new Date().toISOString() });
}

beforeAll(async () => {
  app = await bootApp();
  const r = await login(app, 'reception@demo.hms');
  reception = r.accessToken;
  demoTenantId = (r.user as unknown as { tenantId: string }).tenantId;
  doctorStaff = (await login(app, 'doctor@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;

  const facilityId = await provisionTestHospital();
  HOSPITAL.admin = (await login(app, `admin@${HOSPITAL.code}.test`, HOSPITAL.code)).accessToken;
  HOSPITAL.doctorId = (await login(app, `doctor@${HOSPITAL.code}.test`, HOSPITAL.code)).user.id;
  const blocks = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ facilityId, weekday, startTime: '10:00', endTime: '13:00', slotMinutes: 15 }));
  const schedule = await app.inject({
    method: 'PUT',
    url: `/api/v1/setup/doctors/${HOSPITAL.doctorId}/schedule`,
    headers: { ...bearer(HOSPITAL.admin), 'x-facility-id': facilityId },
    payload: { blocks },
  });
  if (schedule.statusCode !== 200) throw new Error(`schedule: ${schedule.body}`);
});
afterAll(() => app.close());

describe('portal: OTP login', () => {
  it('signs in with mobile + OTP and links the hospital patients on that mobile', async () => {
    const mobile = randomMobile();
    const p = await registerPatient(mobile);
    const session = await patientLogin(mobile);
    expect(session.accessToken).toBeTruthy();
    expect(session.me.patients).toEqual([expect.objectContaining({ id: p.id, relation: 'self', uhid: p.uhid })]);

    const me = await app.inject({ method: 'GET', url: '/api/v1/portal/me', headers: bearer(session.accessToken) });
    expect(me.statusCode).toBe(200);
    expect(me.json().hospitalName).toContain('Demo');
  });

  it('rejects a wrong code and locks after too many attempts', async () => {
    const mobile = randomMobile();
    const req = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/request', payload: { tenantCode: 'demo', mobile } });
    const { devCode } = req.json();
    const wrong = devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/verify', payload: { tenantCode: 'demo', mobile, otp: wrong } });
      expect(res.statusCode).toBe(400);
    }
    const res = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/verify', payload: { tenantCode: 'demo', mobile, otp: devCode } });
    expect(res.json().error.code).toBe('otp_locked');
  });

  it('rate-limits code requests per mobile', async () => {
    const mobile = randomMobile();
    for (let i = 0; i < 5; i++) {
      const ok = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/request', payload: { tenantCode: 'demo', mobile } });
      expect(ok.statusCode).toBe(200);
    }
    const res = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/request', payload: { tenantCode: 'demo', mobile } });
    expect(res.statusCode).toBe(429);
  });

  it('rotates refresh tokens, detects reuse and logs out', async () => {
    const s = await patientLogin(randomMobile());
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/refresh', payload: { refreshToken: s.refreshToken, client: 'mobile' } });
    expect(r1.statusCode).toBe(200);
    const next = r1.json().refreshToken;
    expect(next).not.toBe(s.refreshToken);

    const r2 = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/refresh', payload: { refreshToken: next, client: 'mobile' } });
    expect(r2.statusCode).toBe(200);
    // `s.refreshToken` is now two rotations old: presenting it is reuse and ends the session.
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/refresh', payload: { refreshToken: s.refreshToken, client: 'mobile' } });
    expect(reuse.statusCode).toBe(401);

    const s2 = await patientLogin(randomMobile());
    await app.inject({ method: 'POST', url: '/api/v1/portal/auth/logout', payload: { refreshToken: s2.refreshToken } });
    const after = await app.inject({ method: 'GET', url: '/api/v1/portal/me', headers: bearer(s2.accessToken) });
    expect(after.statusCode).toBe(401);
  });

  it('keeps patient and staff tokens apart', async () => {
    const s = await patientLogin(randomMobile());
    const staffOnPortal = await app.inject({ method: 'GET', url: '/api/v1/portal/me', headers: bearer(reception) });
    expect(staffOnPortal.statusCode).toBe(401);
    const patientOnStaff = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: bearer(s.accessToken) });
    expect(patientOnStaff.statusCode).toBe(401);
    const patientOnStaffPortal = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/bookings', headers: bearer(s.accessToken) });
    expect(patientOnStaffPortal.statusCode).toBe(401);
  });
});

describe('portal: family, booking and staff inbox', () => {
  it('adds a family member as a new hospital patient', async () => {
    const s = await patientLogin(randomMobile());
    expect(s.me.patients).toEqual([]);
    const self = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/family',
      headers: bearer(s.accessToken),
      payload: { firstName: 'Neha', gender: 'female', ageYears: 31, relation: 'self' },
    });
    expect(self.statusCode).toBe(201);
    const child = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/family',
      headers: bearer(s.accessToken),
      payload: { firstName: 'Ishaan', gender: 'male', dateOfBirth: '2019-03-02', relation: 'child' },
    });
    expect(child.json().uhid).toMatch(/^UH\d{6}$/);
    const me = await app.inject({ method: 'GET', url: '/api/v1/portal/me', headers: bearer(s.accessToken) });
    expect(me.json().patients.map((p: { relation: string }) => p.relation)).toEqual(['self', 'child']);
  });

  it('books into the doctor timetable, blocks double booking, shows it to staff and cancels', async () => {
    const h = HOSPITAL.code;
    const a = await patientLogin(randomMobile(), h);
    const b = await patientLogin(randomMobile(), h);
    const self = (token: string, firstName: string) =>
      app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: bearer(token), payload: { firstName, gender: 'male', ageYears: 40, relation: 'self' } });
    const pa = (await self(a.accessToken, 'A')).json();
    const pb = (await self(b.accessToken, 'B')).json();

    const doctors = await app.inject({ method: 'GET', url: '/api/v1/portal/doctors', headers: bearer(a.accessToken) });
    expect(doctors.json().map((d: { userId: string }) => d.userId)).toContain(HOSPITAL.doctorId);

    // Any weekday works: the test doctor sits 10:00-13:00 IST every day. The diary keeps earlier runs' bookings.
    const day = new Date(Date.now() + (2 + Math.floor(Math.random() * 50)) * 86_400_000).toISOString().slice(0, 10);
    const slotsUrl = `/api/v1/portal/doctors/${HOSPITAL.doctorId}/slots?date=${day}`;
    const slots = await app.inject({ method: 'GET', url: slotsUrl, headers: bearer(a.accessToken) });
    expect(slots.statusCode).toBe(200);
    expect(slots.json()).toHaveLength(12);
    const free = slots.json().filter((s: { available: boolean }) => s.available);
    const slot = free[Math.floor(Math.random() * free.length)];
    expect(slot).toBeTruthy();

    const book = (token: string, patientId: string, slotStart: string) =>
      app.inject({ method: 'POST', url: '/api/v1/portal/appointments', headers: bearer(token), payload: { patientId, doctorId: HOSPITAL.doctorId, slotStart, reason: 'Fever' } });
    const booked = await book(a.accessToken, pa.id, slot.start);
    expect(booked.statusCode, booked.body).toBe(201);
    expect(booked.json()).toMatchObject({ status: 'booked', source: 'portal', doctorName: 'Dr. Portal Test' });
    expect(booked.json().appointmentId).toBeTruthy();

    expect((await book(b.accessToken, pb.id, slot.start)).statusCode).toBe(409);
    // B cannot book for A's patient; a time outside the timetable is refused.
    expect((await book(b.accessToken, pa.id, slot.end)).statusCode).toBe(403);
    expect((await book(b.accessToken, pb.id, `${day}T15:00:00+05:30`)).statusCode).toBe(400);

    const after = await app.inject({ method: 'GET', url: slotsUrl, headers: bearer(a.accessToken) });
    expect(after.json().find((s: { start: string }) => s.start === slot.start).available).toBe(false);

    // Front office has it in the doctor's diary.
    const diary = await app.inject({ method: 'GET', url: `/api/v1/frontoffice/appointments?date=${day}&doctorId=${HOSPITAL.doctorId}`, headers: bearer(HOSPITAL.admin) });
    expect(diary.json().items.find((x: { id: string }) => x.id === booked.json().appointmentId)).toMatchObject({ source: 'portal', status: 'booked' });

    const inbox = await app.inject({ method: 'GET', url: `/api/v1/portal/staff/bookings?date=${day}`, headers: bearer(HOSPITAL.admin) });
    expect(inbox.json().items.map((i: { id: string }) => i.id)).toContain(booked.json().id);

    const mine = await app.inject({ method: 'GET', url: '/api/v1/portal/appointments?scope=upcoming', headers: bearer(a.accessToken) });
    expect(mine.json()[0]).toMatchObject({ id: booked.json().id, status: 'booked' });

    const cancelByOther = await app.inject({ method: 'POST', url: `/api/v1/portal/appointments/${booked.json().id}/cancel`, headers: bearer(b.accessToken) });
    expect(cancelByOther.statusCode).toBe(404);
    const cancel = await app.inject({ method: 'POST', url: `/api/v1/portal/appointments/${booked.json().id}/cancel`, headers: bearer(a.accessToken) });
    expect(cancel.json().status).toBe('cancelled');
    const reopened = await app.inject({ method: 'GET', url: slotsUrl, headers: bearer(b.accessToken) });
    expect(reopened.json().find((s: { start: string }) => s.start === slot.start).available).toBe(true);

    // Notifications listens for these: confirmed on booking, cancelled on the patient's cancel.
    const db = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
    await db.connect();
    try {
      const { rows } = await db.query<{ topic: string; payload: Record<string, unknown> }>(
        "SELECT topic, payload FROM audit.outbox WHERE topic LIKE 'portal.appointment.%' AND payload->>'requestId' = $1 ORDER BY created_at",
        [booked.json().id],
      );
      expect(rows.map((r) => r.topic)).toEqual(['portal.appointment.confirmed', 'portal.appointment.cancelled']);
      expect(rows[0]!.payload).toMatchObject({
        appointmentId: booked.json().appointmentId,
        patientId: pa.id,
        doctorId: HOSPITAL.doctorId,
        doctorName: 'Dr. Portal Test',
        slotStart: slot.start,
        note: null,
      });
      expect(rows[1]!.payload).toMatchObject({ note: 'Cancelled by patient (portal)' });
    } finally {
      await db.end();
    }
  });

  it('collects feedback for the staff dashboard', async () => {
    const s = await patientLogin(randomMobile());
    const p = (await app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: bearer(s.accessToken), payload: { firstName: 'F', gender: 'female', ageYears: 50, relation: 'self' } })).json();
    const fb = await app.inject({ method: 'POST', url: '/api/v1/portal/feedback', headers: bearer(s.accessToken), payload: { patientId: p.id, rating: 5, comment: 'Very kind staff' } });
    expect(fb.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/feedback', headers: bearer(reception) });
    expect(list.json().items[0]).toMatchObject({ id: fb.json().id, rating: 5 });
    expect(list.json().average).toBeGreaterThan(0);
    const doctorView = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/feedback', headers: bearer(doctorStaff) });
    expect(doctorView.statusCode).toBe(403);
  });
});

describe('portal: records from other modules and online payment', () => {
  it('shows prescriptions and bills from events, idempotently, and takes an online payment', async () => {
    const mobile = randomMobile();
    const patient = await registerPatient(mobile, 'Records');
    const s = await patientLogin(mobile);

    const prescriptionId = randomUUID();
    const eventId = randomUUID();
    const rx = { prescriptionId, patientId: patient.id, doctorName: 'Dr. Asha Rao', lines: [{ drugName: 'Paracetamol 650', dose: '1 tab', frequency: 'TDS', days: 3, qty: 9 }] };
    await emit('emr.prescription.created', rx, eventId);
    await emit('emr.prescription.created', rx, eventId); // redelivery
    const list = await app.inject({ method: 'GET', url: '/api/v1/portal/prescriptions', headers: bearer(s.accessToken) });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0].lines[0].drugName).toBe('Paracetamol 650');

    const invoiceId = randomUUID();
    await emit('billing.invoice.finalized', { invoiceId, patientId: patient.id, number: 'INV-0001', total: 500 });
    await emit('billing.payment.received', { invoiceId, patientId: patient.id, amount: 200, mode: 'cash' });
    let bills = (await app.inject({ method: 'GET', url: '/api/v1/portal/bills', headers: bearer(s.accessToken) })).json();
    expect(bills[0]).toMatchObject({ invoiceId, total: '500.00', paid: '200.00', due: '300.00', status: 'partially_paid' });

    const intent = await app.inject({ method: 'POST', url: '/api/v1/portal/payments/intents', headers: bearer(s.accessToken), payload: { invoiceId } });
    expect(intent.statusCode).toBe(201);
    expect(intent.json()).toMatchObject({ amount: '300.00', status: 'created', provider: 'razorpay_stub' });

    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/payments/intents/${intent.json().id}/confirm`,
      headers: bearer(s.accessToken),
      payload: { providerPaymentId: 'pay_x', signature: 'forged' },
    });
    expect(bad.statusCode).toBe(400);

    const intent2 = (await app.inject({ method: 'POST', url: '/api/v1/portal/payments/intents', headers: bearer(s.accessToken), payload: { invoiceId } })).json();
    const paid = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/payments/intents/${intent2.id}/confirm`,
      headers: bearer(s.accessToken),
      payload: { providerPaymentId: 'pay_stub_1', signature: 'stub' },
    });
    expect(paid.json().status).toBe('paid');
    bills = (await app.inject({ method: 'GET', url: '/api/v1/portal/bills', headers: bearer(s.accessToken) })).json();
    expect(bills[0]).toMatchObject({ due: '0.00', status: 'paid' });

    const again = await app.inject({ method: 'POST', url: '/api/v1/portal/payments/intents', headers: bearer(s.accessToken), payload: { invoiceId } });
    expect(again.json().error.code).toBe('nothing_due');

    // Billing records it and echoes the intent id: no double counting.
    await emit('billing.payment.received', { invoiceId, patientId: patient.id, amount: 300, mode: 'online', ref: intent2.id });
    bills = (await app.inject({ method: 'GET', url: '/api/v1/portal/bills', headers: bearer(s.accessToken) })).json();
    expect(bills[0]).toMatchObject({ paid: '500.00', due: '0.00', status: 'paid' });
  });

  it('shows charges not billed yet, then the bill the desk made from them', async () => {
    const mobile = randomMobile();
    const patient = await registerPatient(mobile, 'Charges');
    const s = await patientLogin(mobile);
    const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(reception) })).json();
    const facilityId = me.facilities[0].id as string;
    const db = app.get(DbService);
    const charges = app.get(ChargesService);
    const inTenant = <T>(fn: (tx: Parameters<Parameters<DbService['asTenant']>[1]>[0]) => Promise<T>) => db.asTenant({ tenantId: demoTenantId }, fn);
    const ref = randomUUID();
    const lab = await inTenant((tx) => charges.postCharge(tx, { patientId: patient.id, facilityId, source: { module: 'lab', refId: ref }, description: 'CBC', unitPrice: 350, taxRate: 0 }));
    await inTenant((tx) => charges.postCharge(tx, { patientId: patient.id, facilityId, source: { module: 'ops', refId: ref }, description: 'Ambulance', unitPrice: 800, taxRate: 0 }));

    const pending = await app.inject({ method: 'GET', url: '/api/v1/portal/bills/pending', headers: bearer(s.accessToken) });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json()).toEqual([expect.objectContaining({ patientId: patient.id, count: 2, total: '1150.00' })]);

    // The desk bills the lab charge (sourceModule 'billing' on the invoice) and takes part of it.
    const inv = await inTenant((tx) => charges.billCharges(tx, { patientId: patient.id, chargeIds: [lab.id], payNow: { mode: 'cash', amount: 100 } }));
    const events = await inTenant(async (tx) => {
      const r = await tx.execute<{ id: string; topic: string; payload: Record<string, unknown>; created_at: string }>(
        sql`select id, topic, payload, created_at from audit.outbox where payload->>'invoiceId' = ${inv.id} order by created_at, id`,
      );
      return r.rows;
    });
    expect(events.map((e) => e.topic)).toEqual(expect.arrayContaining(['billing.invoice.finalized', 'billing.payment.received']));
    for (const e of events) await emit(e.topic, e.payload, e.id);

    const bills = (await app.inject({ method: 'GET', url: '/api/v1/portal/bills', headers: bearer(s.accessToken) })).json();
    expect(bills).toEqual([expect.objectContaining({ invoiceId: inv.id, number: inv.number, total: '350.00', paid: '100.00', due: '250.00', status: 'partially_paid' })]);
    const after = (await app.inject({ method: 'GET', url: '/api/v1/portal/bills/pending', headers: bearer(s.accessToken) })).json();
    expect(after).toEqual([expect.objectContaining({ count: 1, total: '800.00' })]);
  });

  it("never shows one family's or one hospital's records to another", async () => {
    const mobile = randomMobile();
    const patient = await registerPatient(mobile, 'Private');
    const owner = await patientLogin(mobile);
    await emit('emr.prescription.created', { prescriptionId: randomUUID(), patientId: patient.id, lines: [] });

    const stranger = await patientLogin(randomMobile());
    const direct = await app.inject({ method: 'GET', url: `/api/v1/portal/prescriptions?patientId=${patient.id}`, headers: bearer(stranger.accessToken) });
    expect(direct.statusCode).toBe(403);
    const all = await app.inject({ method: 'GET', url: '/api/v1/portal/prescriptions', headers: bearer(stranger.accessToken) });
    expect(all.json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/v1/portal/prescriptions', headers: bearer(owner.accessToken) })).json()).toHaveLength(1);

    // Same mobile at another hospital: a separate account that sees none of demo's patients.
    const city = await patientLogin(mobile, 'city');
    expect(city.me.patients).toEqual([]);
    const cityRx = await app.inject({ method: 'GET', url: `/api/v1/portal/prescriptions?patientId=${patient.id}`, headers: bearer(city.accessToken) });
    expect(cityRx.statusCode).toBe(403);

    // City staff see no demo booking requests or feedback.
    const cityInbox = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/bookings', headers: bearer(cityAdmin) });
    expect(cityInbox.statusCode).toBe(200);
    expect(cityInbox.json().items.find((i: { patientId: string }) => i.patientId === patient.id)).toBeUndefined();
    const cityFeedback = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/feedback', headers: bearer(cityAdmin) });
    expect(cityFeedback.json().items.every((f: { patientName: string }) => f.patientName !== '')).toBe(true);
  });
});

describe('portal: input validation', () => {
  it('checks family member details, booking dates and feedback ratings', async () => {
    const s = await patientLogin(randomMobile());
    const h = bearer(s.accessToken);
    const add = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: h, payload });

    const futureDob = await add({ firstName: 'Baby', gender: 'female', dateOfBirth: '2999-01-01', relation: 'child' });
    expect(futureDob.statusCode).toBe(400);
    expect(futureDob.json().error.message).toContain('Date of birth cannot be in the future');
    const digits = await add({ firstName: 'R2D2', gender: 'male', ageYears: 4, relation: 'child' });
    expect(digits.statusCode).toBe(400);
    expect(digits.json().error.message).toContain('First name can only have letters');
    const noAge = await add({ firstName: 'Nobody', gender: 'male', relation: 'child' });
    expect(noAge.statusCode).toBe(400);
    expect(noAge.json().error.message).toContain('Enter date of birth or age');
    const old = await add({ firstName: 'Old', gender: 'male', ageYears: 151, relation: 'parent' });
    expect(old.statusCode).toBe(400);
    expect(old.json().error.message).toContain('Age cannot be more than 150');
    const me = await add({ firstName: 'Valid', lastName: "D'Souza", gender: 'female', dateOfBirth: '1990-05-01', relation: 'self' });
    expect(me.statusCode).toBe(201);

    const yesterday = new Date(Date.now() - 86_400_000 * 2).toISOString().slice(0, 10);
    const pastSlots = await app.inject({ method: 'GET', url: `/api/v1/portal/doctors/${HOSPITAL.doctorId}/slots?date=${yesterday}`, headers: h });
    expect(pastSlots.statusCode).toBe(400);
    expect(pastSlots.json().error.message).toContain('Pick today or a later date');
    const farDay = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    const farSlots = await app.inject({ method: 'GET', url: `/api/v1/portal/doctors/${HOSPITAL.doctorId}/slots?date=${farDay}`, headers: h });
    expect(farSlots.statusCode).toBe(400);
    expect(farSlots.json().error.message).toContain('days ahead');

    const pastBooking = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/appointments',
      headers: h,
      payload: { patientId: me.json().id, doctorId: HOSPITAL.doctorId, slotStart: '2020-01-01T10:00:00+05:30' },
    });
    expect(pastBooking.statusCode).toBe(400);
    expect(pastBooking.json().error.message).toContain('This time has already passed');

    const badRating = await app.inject({ method: 'POST', url: '/api/v1/portal/feedback', headers: h, payload: { patientId: me.json().id, rating: 6 } });
    expect(badRating.statusCode).toBe(400);
    expect(badRating.json().error.message).toContain('Pick a rating from 1 to 5 stars');
  });

  it('rejects a bad mobile at sign-in', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/portal/auth/otp/request', payload: { tenantCode: HOSPITAL.code, mobile: '12345' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('Enter a 10-digit Indian mobile number');
  });
});
