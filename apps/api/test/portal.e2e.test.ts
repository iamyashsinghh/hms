import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '../src/common/events/event-bus';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let reception: string;
let doctorStaff: string;
let cityAdmin: string;
let demoTenantId: string;

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

function emit(topic: string, payload: Record<string, unknown>, id = randomUUID(), tenantId = demoTenantId) {
  return app.get(EventBus).dispatch({ id, tenantId, topic, payload, createdAt: new Date().toISOString() });
}

beforeAll(async () => {
  app = await bootApp();
  const r = await login(app, 'reception@demo.hms');
  reception = r.accessToken;
  demoTenantId = (r.user as unknown as { tenantId: string }).tenantId;
  doctorStaff = (await login(app, 'doctor@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
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

  it('books a slot, blocks double booking, and reception confirms it', async () => {
    const a = await patientLogin(randomMobile());
    const b = await patientLogin(randomMobile());
    const pa = (await app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: bearer(a.accessToken), payload: { firstName: 'A', gender: 'male', ageYears: 40, relation: 'self' } })).json();
    const pb = (await app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: bearer(b.accessToken), payload: { firstName: 'B', gender: 'male', ageYears: 41, relation: 'self' } })).json();

    const doctors = await app.inject({ method: 'GET', url: '/api/v1/portal/doctors', headers: bearer(a.accessToken) });
    const doctor = doctors.json().find((d: { name: string }) => d.name === 'Dr. Asha Rao');
    expect(doctor).toBeTruthy();

    const day = new Date(Date.now() + (2 + Math.floor(Math.random() * 50)) * 86_400_000).toISOString().slice(0, 10);
    const slots = await app.inject({ method: 'GET', url: `/api/v1/portal/doctors/${doctor.userId}/slots?date=${day}`, headers: bearer(a.accessToken) });
    expect(slots.statusCode).toBe(200);
    const free = slots.json().filter((s: { available: boolean }) => s.available);
    const slot = free[Math.floor(Math.random() * free.length)];

    const booked = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/appointments',
      headers: bearer(a.accessToken),
      payload: { patientId: pa.id, doctorId: doctor.userId, slotStart: slot.start, reason: 'Fever' },
    });
    expect(booked.statusCode).toBe(201);
    expect(booked.json()).toMatchObject({ status: 'requested', source: 'portal', doctorName: 'Dr. Asha Rao' });

    const clash = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/appointments',
      headers: bearer(b.accessToken),
      payload: { patientId: pb.id, doctorId: doctor.userId, slotStart: slot.start },
    });
    expect(clash.statusCode).toBe(409);

    // B cannot book for A's patient.
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/portal/appointments',
      headers: bearer(b.accessToken),
      payload: { patientId: pa.id, doctorId: doctor.userId, slotStart: slot.end },
    });
    expect(foreign.statusCode).toBe(403);

    const after = await app.inject({ method: 'GET', url: `/api/v1/portal/doctors/${doctor.userId}/slots?date=${day}`, headers: bearer(a.accessToken) });
    expect(after.json().find((s: { start: string }) => s.start === slot.start).available).toBe(false);

    const inbox = await app.inject({ method: 'GET', url: `/api/v1/portal/staff/bookings?status=requested&date=${day}`, headers: bearer(reception) });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().items.map((i: { id: string }) => i.id)).toContain(booked.json().id);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/staff/bookings/${booked.json().id}/decision`,
      headers: bearer(doctorStaff),
      payload: { decision: 'confirm' },
    });
    expect(forbidden.statusCode).toBe(403);

    const confirm = await app.inject({
      method: 'POST',
      url: `/api/v1/portal/staff/bookings/${booked.json().id}/decision`,
      headers: bearer(reception),
      payload: { decision: 'confirm', note: 'See you at 10' },
    });
    expect(confirm.json().status).toBe('confirmed');

    const mine = await app.inject({ method: 'GET', url: '/api/v1/portal/appointments?scope=upcoming', headers: bearer(a.accessToken) });
    expect(mine.json()[0]).toMatchObject({ id: booked.json().id, status: 'confirmed', staffNote: 'See you at 10' });

    const cancel = await app.inject({ method: 'POST', url: `/api/v1/portal/appointments/${booked.json().id}/cancel`, headers: bearer(a.accessToken) });
    expect(cancel.json().status).toBe('cancelled');
    const cancelByOther = await app.inject({ method: 'POST', url: `/api/v1/portal/appointments/${booked.json().id}/cancel`, headers: bearer(b.accessToken) });
    expect(cancelByOther.statusCode).toBe(404);
  });

  it('collects feedback for the staff dashboard', async () => {
    const s = await patientLogin(randomMobile());
    const p = (await app.inject({ method: 'POST', url: '/api/v1/portal/family', headers: bearer(s.accessToken), payload: { firstName: 'F', gender: 'female', ageYears: 50, relation: 'self' } })).json();
    const fb = await app.inject({ method: 'POST', url: '/api/v1/portal/feedback', headers: bearer(s.accessToken), payload: { patientId: p.id, rating: 5, comment: 'Very kind staff' } });
    expect(fb.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/v1/portal/staff/feedback', headers: bearer(reception) });
    expect(list.json().items[0]).toMatchObject({ id: fb.json().id, rating: 5 });
    expect(list.json().average).toBeGreaterThan(0);
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
