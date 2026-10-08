import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { ChargesService } from '../src/modules/billing/charges.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let clerk: string;
let doctor: string;
let tenantId: string;
let facilityId: string;
let patientId: string;
const tag = Date.now().toString(36).toUpperCase();
const CBC = `CBC-${tag}`;
const DRESS = `DRESS-${tag}`;

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);
const inTenant = <T>(fn: (charges: ChargesService, tx: Parameters<Parameters<DbService['asTenant']>[1]>[0]) => Promise<T>) =>
  app.get(DbService).asTenant({ tenantId }, (tx) => fn(app.get(ChargesService), tx));

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  patientId = (await call(admin, 'POST', '/patients', { firstName: 'Charge', lastName: `Desk${tag}`, gender: 'female', ageYears: 31, mobile: '9876511111' })).json().id;
  for (const s of [
    { code: CBC, name: 'CBC', category: 'lab', basePrice: 350, taxRate: 0 },
    { code: DRESS, name: 'Dressing small', category: 'procedure', basePrice: 150, taxRate: 18 },
  ]) {
    const res = await call(admin, 'POST', '/billing/services', s);
    expect(res.statusCode, res.body).toBe(201);
  }
});
afterAll(() => app.close());

describe('billing rules', () => {
  it('starts from the hospital preset and lets a branch override a rule', async () => {
    const base = (await call(clerk, 'GET', '/billing/rules')).json();
    expect(base.effective).toMatchObject({ opdPayment: 'before', ipdPharmacy: 'ipd_bill', labChargeAt: 'order' });

    expect((await call(clerk, 'PUT', '/billing/rules', { rules: { opdPayment: 'after' } })).statusCode).toBe(403);
    const saved = await call(admin, 'PUT', '/billing/rules', { rules: { maxDiscountPct: 10, registrationFee: { enabled: true, amount: 100, validityMonths: 12 } } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().effective).toMatchObject({ maxDiscountPct: 10, registrationFee: { enabled: true, amount: 100 } });

    const branch = await call(admin, 'PUT', '/billing/rules', { facilityId, rules: { opdPayment: 'after' } });
    expect(branch.statusCode, branch.body).toBe(200);
    expect(branch.json()).toMatchObject({ branch: { opdPayment: 'after' }, effective: { opdPayment: 'after', maxDiscountPct: 10 } });
    expect((await call(admin, 'GET', '/billing/rules')).json().effective.opdPayment).toBe('before');

    expect((await call(admin, 'PUT', '/billing/rules', { rules: { checkoutTime: '25:00' } })).statusCode).toBe(400);
    // Reset the branch so other tests see the hospital rules.
    await call(admin, 'PUT', '/billing/rules', { facilityId, preset: 'hospital', rules: {} });
    await call(admin, 'PUT', '/billing/rules', { facilityId: undefined, rules: { registrationFee: { enabled: false, amount: 0, validityMonths: 12 } } });
  });
});

describe('patient charges', () => {
  let cbc: { id: string };
  let dressing: { id: string };

  it('posts priced charges once per source', async () => {
    cbc = await inTenant((c, tx) => c.postCharge(tx, { patientId, facilityId, source: { module: 'lab', refId: `LAB-${tag}`, line: CBC }, serviceCode: CBC }));
    const again = await inTenant((c, tx) => c.postCharge(tx, { patientId, facilityId, source: { module: 'lab', refId: `LAB-${tag}`, line: CBC }, serviceCode: CBC }));
    expect(again.id).toBe(cbc.id);
    expect(cbc).toMatchObject({ description: 'CBC', unitPrice: 350, amount: 350, status: 'pending', account: 'other' });

    dressing = await inTenant((c, tx) => c.postCharge(tx, { patientId, facilityId, source: { module: 'emr', refId: `ENC-${tag}`, line: DRESS }, serviceCode: DRESS }));
    expect(dressing).toMatchObject({ unitPrice: 150, taxRate: 18, amount: 177 });
  });

  it('shows the patient on the unbilled list and the desk', async () => {
    const list = (await call(clerk, 'GET', `/billing/unbilled?q=${encodeURIComponent(`Desk${tag}`.toLowerCase())}`)).json();
    expect(list.items[0]).toMatchObject({ patientId, pendingCount: 2, pendingTotal: 527 });
    const desk = (await call(clerk, 'GET', `/billing/patients/${patientId}/charges`)).json();
    expect(desk).toMatchObject({ pendingTotal: 527, groups: [{ label: 'Other charges', total: 527 }] });
  });

  it('a manual charge at a changed price needs price override', async () => {
    const res = await call(clerk, 'POST', '/billing/charges', { patientId, serviceCode: CBC, unitPrice: 300 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code ?? res.json().error).toBeDefined();
    const ok = await call(clerk, 'POST', '/billing/charges', { patientId, description: 'Misc', unitPrice: 20 });
    expect(ok.statusCode, ok.body).toBe(201);
    expect((await call(clerk, 'POST', `/billing/charges/${ok.json().id}/cancel`, { reason: 'Entered by mistake' })).statusCode).toBe(200);
  });

  it('bills pending charges into one invoice with advance and payment', async () => {
    const dep = await call(clerk, 'POST', '/billing/deposits', { patientId, mode: 'cash', amount: 100 });
    expect(dep.statusCode, dep.body).toBe(201);
    // Cashier discount above the hospital limit (0%) is refused.
    const limited = await call(clerk, 'POST', '/billing/charges/bill', { patientId, chargeIds: [cbc.id, dressing.id], discount: 50 });
    expect(limited.statusCode).toBe(403);

    const res = await call(clerk, 'POST', '/billing/charges/bill', {
      patientId,
      chargeIds: [cbc.id, dressing.id],
      extraLines: [{ serviceCode: CBC, qty: 1 }],
      useDeposit: true,
      payNow: { mode: 'cash', amount: 1000 },
    });
    expect(res.statusCode, res.body).toBe(201);
    const inv = res.json();
    expect(inv).toMatchObject({ status: 'final', total: 877, balance: 0, paymentStatus: 'paid' });
    expect(inv.lines).toHaveLength(3);
    expect(inv.payments.map((p: { mode: string; amount: number }) => [p.mode, p.amount]).sort()).toEqual([['cash', 777], ['deposit', 100]]);

    const after = (await call(clerk, 'GET', `/billing/charges?patientId=${patientId}&status=billed`)).json();
    expect(after.items).toHaveLength(3);
    expect(after.items.every((c: { invoiceNumber: string }) => c.invoiceNumber === inv.number)).toBe(true);
    expect((await call(clerk, 'POST', '/billing/charges/bill', { patientId, chargeIds: [cbc.id] })).statusCode).toBe(409);
  });

  it('flags a billed charge when its order is cancelled, and credits it with a refund', async () => {
    const states = await inTenant((c, tx) => c.paymentStates(tx, { module: 'lab', refIds: [`LAB-${tag}`] }));
    expect(states.get(`LAB-${tag}`)).toBe('paid');

    const out = await inTenant((c, tx) => c.cancelBySource(tx, { module: 'lab', refId: `LAB-${tag}` }, 'Test not done'));
    expect(out).toMatchObject({ cancelled: 0, reversals: [{ id: cbc.id }] });
    const desk = (await call(clerk, 'GET', `/billing/patients/${patientId}/charges`)).json();
    expect(desk.reversals.map((r: { id: string }) => r.id)).toEqual([cbc.id]);

    expect((await call(clerk, 'POST', `/billing/charges/${cbc.id}/credit`, {})).statusCode).toBe(403);
    const needMode = await call(admin, 'POST', `/billing/charges/${cbc.id}/credit`, {});
    expect(needMode.statusCode).toBe(400);
    const credited = await call(admin, 'POST', `/billing/charges/${cbc.id}/credit`, { refundMode: 'cash' });
    expect(credited.statusCode, credited.body).toBe(200);
    expect(credited.json()).toMatchObject({ creditedAmount: 350 });
    expect((await call(clerk, 'GET', `/billing/patients/${patientId}/charges`)).json().reversals).toHaveLength(0);
  });

  it('pending charges of a cancelled source are simply cancelled', async () => {
    const c = await inTenant((s, tx) => s.postCharge(tx, { patientId, facilityId, source: { module: 'radiology', refId: `RAD-${tag}` }, description: 'X-ray', unitPrice: 400 }));
    expect((await inTenant((s, tx) => s.paymentStates(tx, { module: 'radiology', refIds: [`RAD-${tag}`] }))).get(`RAD-${tag}`)).toBe('pending');
    const out = await inTenant((s, tx) => s.cancelBySource(tx, { module: 'radiology', refId: `RAD-${tag}` }, 'Patient left'));
    expect(out.cancelled).toBe(1);
    const row = (await call(clerk, 'GET', `/billing/charges?patientId=${patientId}&sourceModule=radiology`)).json().items[0];
    expect(row).toMatchObject({ id: c.id, status: 'cancelled', cancelReason: 'Patient left' });
  });

  it('doctors cannot see the billing desk', async () => {
    expect((await call(doctor, 'GET', `/billing/patients/${patientId}/charges`)).statusCode).toBe(403);
  });
});
