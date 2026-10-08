import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReportsIngestService } from '../src/modules/reports/reports.ingest';
import { bearer, bootApp, login } from './helpers';

type User = { id: string; tenantId: string; facilities: { id: string }[] };

let app: NestFastifyApplication;
let ingest: ReportsIngestService;
let owner: string;
let reception: string;
let billingClerk: string;
let doctor: User;
let demo: User;
let city: { token: string; user: User };
let patientA: string;
let patientB: string;

// Each run uses its own random past day so repeated runs against the same database don't collide.
const day = new Date(Date.UTC(2001 + Math.floor(Math.random() * 20), Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 28)))
  .toISOString()
  .slice(0, 10);
/** 10:30 IST on the test day. */
const at = (hhmm = '05:00') => `${day}T${hhmm}:00.000Z`;

const event = (tenantId: string, topic: string, payload: Record<string, unknown>, createdAt = at()) => ({
  id: randomUUID(),
  tenantId,
  topic,
  payload,
  createdAt,
});

const get = (token: string, url: string) => app.inject({ method: 'GET', url: `/api/v1/reports/${url}`, headers: bearer(token) });

beforeAll(async () => {
  app = await bootApp();
  ingest = app.get(ReportsIngestService);
  const o = await login(app, 'owner@demo.hms');
  owner = o.accessToken;
  demo = o.user as unknown as User;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  billingClerk = (await login(app, 'billing@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).user as unknown as User;
  const c = await login(app, 'admin@city.hms', 'city');
  city = { token: c.accessToken, user: c.user as unknown as User };
  const patients = await app.inject({ method: 'GET', url: '/api/v1/patients?pageSize=2', headers: bearer(reception) });
  [patientA, patientB] = patients.json().items.map((p: { id: string }) => p.id);
});
afterAll(() => app.close());

describe('reports', () => {
  it('projects events into the owner summary, idempotently', async () => {
    const before = (await get(owner, `owner-summary?date=${day}`)).json();
    const facilityId = demo.facilities[0]!.id;
    const visit1 = randomUUID();
    const inv1 = randomUUID();
    const inv2 = randomUUID();
    const t = demo.tenantId;
    const events = [
      event(t, 'frontoffice.visit.checked_in', { visitId: visit1, patientId: patientA, doctorId: doctor.id, facilityId, tokenNo: 1 }, at('04:00')),
      event(t, 'frontoffice.visit.checked_in', { visitId: randomUUID(), patientId: patientA, doctorId: doctor.id, facilityId, tokenNo: 2 }, at('06:00')),
      event(t, 'frontoffice.visit.checked_in', { visitId: randomUUID(), patientId: patientB, facilityId, tokenNo: 3 }, at('07:00')),
      event(t, 'frontoffice.appointment.booked', { appointmentId: randomUUID(), patientId: patientB, doctorId: doctor.id, start: at('09:00') }),
      event(t, 'emr.encounter.signed', { encounterId: randomUUID(), patientId: patientA, doctorId: doctor.id }),
      event(t, 'billing.invoice.finalized', {
        invoiceId: inv1,
        number: `INV-${day}-1`,
        patientId: patientA,
        facilityId,
        total: 500,
        source: { module: 'frontoffice', refId: visit1 },
        lines: [{ serviceCode: 'CONSULT', description: 'Consultation', qty: 1, amount: 500 }],
      }),
      event(t, 'billing.invoice.finalized', {
        invoiceId: inv2,
        number: `INV-${day}-2`,
        patientId: patientB,
        facilityId,
        lines: [
          { serviceCode: 'CBC', description: 'Complete blood count', qty: 1, unitPrice: 400 },
          { description: 'Dressing', qty: 2, unitPrice: 300 },
        ],
      }),
      event(t, 'billing.payment.received', { invoiceId: inv1, patientId: patientA, amount: 500, mode: 'cash' }),
      event(t, 'billing.payment.received', { invoiceId: inv2, patientId: patientB, amount: '300.00', mode: 'UPI' }),
      event(t, 'pharmacy.dispense.completed', { prescriptionId: randomUUID(), invoiceId: inv2 }),
    ];
    for (const e of events) expect(await ingest.ingest(e)).toBe(true);
    // Redelivery is a no-op.
    for (const e of events) expect(await ingest.ingest(e)).toBe(false);
    // Malformed payloads are skipped, not retried forever.
    expect(await ingest.ingest(event(t, 'billing.payment.received', { amount: 'lots' }))).toBe(false);

    const res = await get(owner, `owner-summary?date=${day}`);
    expect(res.statusCode).toBe(200);
    const s = res.json();
    expect(s.date).toBe(day);
    expect(s.timezone).toBe('Asia/Kolkata');
    expect(s.opdVisits - before.opdVisits).toBe(3);
    expect(s.appointmentsBooked - before.appointmentsBooked).toBe(1);
    expect(s.consultationsSigned - before.consultationsSigned).toBe(1);
    expect(s.pharmacyDispenses - before.pharmacyDispenses).toBe(1);
    expect(s.billed - before.billed).toBe(1500);
    expect(s.collections - before.collections).toBe(800);
    expect(s.pendingBills.count - before.pendingBills.count).toBe(1);
    expect(s.pendingBills.amount - before.pendingBills.amount).toBe(700);
    const dr = s.topDoctors.find((d: { doctorId: string }) => d.doctorId === doctor.id);
    expect(dr).toMatchObject({ name: 'Dr. Asha Rao' });
    expect(dr.visits).toBeGreaterThanOrEqual(2);
    expect(dr.revenue).toBeGreaterThanOrEqual(500);
    expect(s.collectionsByMode.map((m: { mode: string }) => m.mode)).toEqual(expect.arrayContaining(['cash', 'upi']));
    expect(s.previous.date).toBe(new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10));
  });

  it('lists the daily collection with invoice and patient details', async () => {
    const res = await get(billingClerk, `daily-collection?date=${day}`);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    const mine = r.rows.filter((x: { invoiceNumber: string | null }) => x.invoiceNumber?.startsWith(`INV-${day}`));
    expect(mine).toHaveLength(2);
    expect(mine[0].uhid).toMatch(/^UH\d+/);
    expect(mine[0].patientName).toBeTruthy();
  });

  it('breaks revenue down by service and day', async () => {
    const res = await get(owner, `revenue?from=${day}&to=${day}`);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.byDay).toHaveLength(1);
    const codes = r.byService.map((s: { code: string | null; description: string }) => s.code ?? s.description);
    expect(codes).toEqual(expect.arrayContaining(['CONSULT', 'CBC', 'Dressing']));
    expect(r.byService.find((s: { code: string }) => s.code === 'CBC').amount).toBeGreaterThanOrEqual(400);
  });

  it('reports OPD visits by doctor, day and hour in hospital time', async () => {
    const res = await get(reception, `opd?from=${day}&to=${day}&doctorId=${doctor.id}`);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.followUpVisits).toBeGreaterThanOrEqual(1);
    expect(r.byDoctor.every((d: { doctorId: string }) => d.doctorId === doctor.id)).toBe(true);
    // 04:00Z and 06:00Z are 09:30 and 11:30 IST.
    expect(r.byHour.map((h: { hour: number }) => h.hour)).toEqual(expect.arrayContaining([9, 11]));
  });

  it('builds the dashboard series and the patients report', async () => {
    const from = new Date(Date.parse(day) - 2 * 86_400_000).toISOString().slice(0, 10);
    const dash = (await get(owner, `dashboard?from=${from}&to=${day}`)).json();
    expect(dash.daily.map((d: { date: string }) => d.date)).toEqual([from, expect.any(String), day]);
    expect(dash.totals.billed).toBeGreaterThanOrEqual(1500);

    const today = new Date().toISOString().slice(0, 10);
    const p = await get(owner, `patients?from=${today}&to=${today}`);
    expect(p.statusCode).toBe(200);
    expect(p.json()).toMatchObject({ from: today, byGender: expect.any(Array), byAgeBand: expect.any(Array) });
  });

  it('exports CSV with the right headers', async () => {
    const res = await get(owner, `export?report=collections&from=${day}&to=${day}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`collections_${day}_to_${day}.csv`);
    expect(res.body).toContain('received_at,invoice_no,uhid,patient,mode,amount');
    expect(res.body).toContain(`INV-${day}-1`);
  });

  it('validates ranges', async () => {
    const bad = await get(owner, `dashboard?from=2026-02-01&to=2026-01-01`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toContain('"from" must be on or before "to"');
    const long = await get(owner, `dashboard?from=2024-01-01&to=2026-01-01`);
    expect(long.statusCode).toBe(400);
    expect(long.json().error.message).toContain('A report can cover at most 366 days');
    const wrongFormat = await get(owner, `patients?from=08-10-2026&to=2026-10-08`);
    expect(wrongFormat.statusCode).toBe(400);
    expect(wrongFormat.json().error.message).toContain('Enter a valid date');
    const exportReversed = await get(owner, `export?report=collections&from=2026-02-01&to=2026-01-01`);
    expect(exportReversed.statusCode).toBe(400);
  });

  it('enforces permissions', async () => {
    expect((await get(reception, `owner-summary?date=${day}`)).statusCode).toBe(403);
    expect((await get(reception, `daily-collection?date=${day}`)).statusCode).toBe(403);
    expect((await get(billingClerk, `revenue?from=${day}&to=${day}`)).statusCode).toBe(403);
    expect((await get(billingClerk, `export?report=collections&from=${day}&to=${day}`)).statusCode).toBe(403);
  });

  it('filters by facility', async () => {
    const res = await get(owner, `owner-summary?date=${day}&facilityId=${randomUUID()}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ opdVisits: 0, billed: 0, collections: 0 });
  });

  it("never shows one hospital's figures to another", async () => {
    // City sees none of demo's events for the day...
    const s = (await get(city.token, `owner-summary?date=${day}`)).json();
    expect(s.topDoctors.find((d: { doctorId: string }) => d.doctorId === doctor.id)).toBeUndefined();
    const col = (await get(city.token, `daily-collection?date=${day}`)).json();
    expect(col.rows.find((x: { invoiceNumber: string | null }) => x.invoiceNumber?.startsWith(`INV-${day}`))).toBeUndefined();
    const csv = await get(city.token, `export?report=collections&from=${day}&to=${day}`);
    expect(csv.body).not.toContain(`INV-${day}`);

    // ...and an event for city lands only in city's reports.
    const before = (await get(owner, `owner-summary?date=${day}`)).json();
    const cityBefore = s.opdVisits;
    await ingest.ingest(event(city.user.tenantId, 'frontoffice.visit.checked_in', { visitId: randomUUID(), patientId: randomUUID() }));
    expect((await get(city.token, `owner-summary?date=${day}`)).json().opdVisits).toBe(cityBefore + 1);
    expect((await get(owner, `owner-summary?date=${day}`)).json().opdVisits).toBe(before.opdVisits);
  });
});
