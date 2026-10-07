import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { BillingService } from '../src/modules/billing/billing.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let clerk: string;
let owner: string;
let doctor: string;
let otherHospital: string;
let tenantId: string;
let facilityId: string;
let patientId: string;
const tag = Date.now().toString(36).toUpperCase();
const CONS = `CONS-${tag}`;
const XRAY = `XRAY-${tag}`;

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  owner = (await login(app, 'owner@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;

  const p = await call(admin, 'POST', '/patients', { firstName: 'Bill', lastName: `Payer${tag}`, gender: 'male', ageYears: 40, mobile: '9876500000' });
  patientId = p.json().id;

  for (const s of [
    { code: CONS, name: 'OPD consultation', category: 'consultation', basePrice: 500, taxRate: 0, hsnSac: '999312' },
    { code: XRAY, name: 'X-ray chest PA', category: 'radiology', basePrice: 800, taxRate: 18 },
  ]) {
    const res = await call(admin, 'POST', '/billing/services', s);
    expect(res.statusCode, res.body).toBe(201);
  }
});
afterAll(() => app.close());

describe('billing masters', () => {
  it('rejects a duplicate service code', async () => {
    const res = await call(admin, 'POST', '/billing/services', { code: CONS, name: 'Again', basePrice: 1 });
    expect(res.statusCode).toBe(409);
  });

  it('prices from the active cash price list, else the base price', async () => {
    expect((await call(clerk, 'GET', `/billing/services/price?code=${CONS}`)).json().price).toBe(500);
    const svc = (await call(admin, 'GET', `/billing/services?q=${CONS}`)).json().items[0];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const list = await call(admin, 'POST', '/billing/price-lists', { name: `Cash ${tag}`, effectiveFrom: today, items: [{ serviceId: svc.id, price: 450 }] });
    expect(list.statusCode, list.body).toBe(201);
    const price = (await call(clerk, 'GET', `/billing/services/price?code=${CONS}`)).json();
    expect(price).toMatchObject({ price: 450, priceListId: list.json().id });
  });

  it('builds packages from services', async () => {
    const svcs = (await call(admin, 'GET', `/billing/services?q=${tag.toLowerCase()}`)).json().items;
    const res = await call(admin, 'POST', '/billing/services', {
      code: `PKG-${tag}`,
      name: 'Health check',
      category: 'package',
      basePrice: 999,
      packageItems: svcs.map((s: { id: string }) => ({ serviceId: s.id, qty: 1 })),
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().packageItems).toHaveLength(2);
  });
});

describe('invoices', () => {
  let invoiceId: string;

  it('creates a draft from service codes (charge engine) and computes GST', async () => {
    const res = await call(clerk, 'POST', '/billing/invoices', {
      patientId,
      lines: [{ serviceCode: CONS }, { serviceCode: XRAY, qty: 1, discount: 100 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const inv = res.json();
    invoiceId = inv.id;
    expect(inv).toMatchObject({ status: 'draft', number: null, patientName: `Bill Payer${tag}` });
    // 450 (list) + (800 - 100) * 1.18 = 450 + 826 = 1276
    expect(inv.taxTotal).toBe(126);
    expect(inv.cgstTotal + inv.sgstTotal).toBe(126);
    expect(inv.total).toBe(1276);
    expect(inv.lines[1]).toMatchObject({ taxableAmount: 700, taxAmount: 126, total: 826, taxRate: 18 });
  });

  it('edits a draft, then finalizes it with a number and makes it immutable', async () => {
    const edit = await call(clerk, 'PATCH', `/billing/invoices/${invoiceId}`, { lines: [{ serviceCode: CONS }, { serviceCode: XRAY }] });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json().total).toBe(450 + 944);

    const fin = await call(clerk, 'POST', `/billing/invoices/${invoiceId}/finalize`);
    expect(fin.statusCode, fin.body).toBe(200);
    expect(fin.json().number).toMatch(/^INV\d{6}$/);
    expect(fin.json().status).toBe('final');

    const again = await call(clerk, 'PATCH', `/billing/invoices/${invoiceId}`, { notes: 'x' });
    expect(again.statusCode).toBe(409);

    // Even a direct SQL change by the API role is refused by the database.
    const db = app.get(DbService);
    await expect(
      db.asTenant({ tenantId }, (tx) => tx.execute(sql`update billing.invoices set total = 1 where id = ${invoiceId}`)),
    ).rejects.toThrow();
    await expect(
      db.asTenant({ tenantId }, (tx) => tx.execute(sql`update billing.invoice_lines set total = 1 where invoice_id = ${invoiceId}`)),
    ).rejects.toThrow();
  });

  it('takes split payments, refuses overpayment and shows a UPI link while money is due', async () => {
    await call(admin, 'PUT', '/billing/settings', { legalName: 'Demo Hospital', upiVpa: 'demo@okhdfc', gstin: '27AAAAA0000A1Z5' });
    const inv = (await call(clerk, 'GET', `/billing/invoices/${invoiceId}`)).json();
    expect(inv.upiLink).toContain('pa=demo%40okhdfc');
    expect(inv.upiLink).toContain('am=1394.00');

    const p1 = await call(clerk, 'POST', `/billing/invoices/${invoiceId}/payments`, { mode: 'cash', amount: 1000 });
    expect(p1.statusCode, p1.body).toBe(201);
    expect(p1.json()).toMatchObject({ paymentStatus: 'partial', balance: 394 });
    expect(p1.json().payments[0].number).toMatch(/^RCP\d{6}$/);

    const over = await call(clerk, 'POST', `/billing/invoices/${invoiceId}/payments`, { mode: 'upi', amount: 500 });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('overpayment');

    const p2 = await call(clerk, 'POST', `/billing/invoices/${invoiceId}/payments`, { mode: 'upi', amount: 394, reference: 'UTR123' });
    expect(p2.json()).toMatchObject({ paymentStatus: 'paid', balance: 0, upiLink: null });
  });

  it('only cancels after payments are refunded', async () => {
    const blocked = await call(admin, 'POST', `/billing/invoices/${invoiceId}/cancel`, { reason: 'Wrong patient' });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe('invoice_has_payments');

    const r = await call(admin, 'POST', '/billing/refunds', { invoiceId, mode: 'cash', amount: 1394, notes: 'Wrong patient' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().number).toMatch(/^RFD\d{6}$/);

    const ok = await call(admin, 'POST', `/billing/invoices/${invoiceId}/cancel`, { reason: 'Wrong patient' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('cancelled');
  });

  it('issues credit notes up to the unpaid balance', async () => {
    const inv = (await call(clerk, 'POST', '/billing/invoices', { patientId, finalize: true, lines: [{ serviceCode: CONS }] })).json();
    const tooMuch = await call(admin, 'POST', `/billing/invoices/${inv.id}/credit-notes`, { amount: 451, reason: 'Goodwill' });
    expect(tooMuch.statusCode).toBe(400);
    const cn = await call(admin, 'POST', `/billing/invoices/${inv.id}/credit-notes`, { amount: 50, reason: 'Goodwill' });
    expect(cn.statusCode, cn.body).toBe(201);
    expect(cn.json()).toMatchObject({ creditedAmount: 50, balance: 400 });
    expect(cn.json().creditNotes[0].number).toMatch(/^CN\d{6}$/);
  });

  it('deletes drafts but not final invoices', async () => {
    const draft = (await call(clerk, 'POST', '/billing/invoices', { patientId, lines: [{ description: 'Dressing', unitPrice: 120 }] })).json();
    expect((await call(clerk, 'DELETE', `/billing/invoices/${draft.id}`)).statusCode).toBe(204);
    expect((await call(clerk, 'GET', `/billing/invoices/${draft.id}`)).statusCode).toBe(404);
    expect((await call(clerk, 'DELETE', `/billing/invoices/${invoiceId}`)).statusCode).toBe(409);
  });
});

describe('deposits and patient account', () => {
  it('takes an advance, adjusts it on a bill and refunds the rest', async () => {
    const dep = await call(clerk, 'POST', '/billing/deposits', { patientId, mode: 'cash', amount: 1000 });
    expect(dep.statusCode, dep.body).toBe(201);

    const inv = (await call(clerk, 'POST', '/billing/invoices', { patientId, finalize: true, lines: [{ serviceCode: XRAY }] })).json();
    const tooMuch = await call(clerk, 'POST', `/billing/invoices/${inv.id}/payments`, { mode: 'deposit', amount: 944.01 });
    expect(tooMuch.statusCode).toBe(400);
    const adj = await call(clerk, 'POST', `/billing/invoices/${inv.id}/payments`, { mode: 'deposit', amount: 944 });
    expect(adj.json().paymentStatus).toBe('paid');

    let acct = (await call(clerk, 'GET', `/billing/patients/${patientId}/account`)).json();
    expect(acct.depositBalance).toBe(56);

    expect((await call(admin, 'POST', '/billing/refunds', { patientId, mode: 'cash', amount: 57, notes: 'Discharge' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/billing/refunds', { patientId, mode: 'cash', amount: 56, notes: 'Discharge' })).statusCode).toBe(201);
    acct = (await call(clerk, 'GET', `/billing/patients/${patientId}/account`)).json();
    expect(acct.depositBalance).toBe(0);
    expect(acct.outstanding).toBe(400);
  });
});

describe('cash shifts', () => {
  it('opens a shift, counts its collections and closes with the difference', async () => {
    const cur = (await call(clerk, 'GET', '/billing/shifts/current')).json();
    if (cur.shift) await call(clerk, 'POST', '/billing/shifts/close', { countedCash: 0 });

    const open = await call(clerk, 'POST', '/billing/shifts/open', { openingCash: 500 });
    expect(open.statusCode, open.body).toBe(201);
    expect((await call(clerk, 'POST', '/billing/shifts/open', { openingCash: 0 })).statusCode).toBe(409);

    await call(clerk, 'POST', '/billing/invoices', { patientId, payNow: { mode: 'cash', amount: 450 }, lines: [{ serviceCode: CONS }] });
    await call(clerk, 'POST', '/billing/invoices', { patientId, payNow: { mode: 'card', amount: 450 }, lines: [{ serviceCode: CONS }] });

    const live = (await call(clerk, 'GET', '/billing/shifts/current')).json().shift;
    expect(live.totals).toEqual({ cash: 450, card: 450 });
    expect(live.expectedCash).toBe(950);

    const closed = await call(clerk, 'POST', '/billing/shifts/close', { countedCash: 940, notes: 'Short by 10' });
    expect(closed.json()).toMatchObject({ status: 'closed', expectedCash: 950, countedCash: 940, difference: -10 });

    const list = await call(admin, 'GET', '/billing/shifts');
    expect(list.json().items.map((s: { id: string }) => s.id)).toContain(closed.json().id);
  });
});

describe('cross-module contract', () => {
  it('BillingService.createInvoice works inside a caller transaction with payNow (e.g. pharmacy, worker)', async () => {
    const billing = app.get(BillingService);
    const db = app.get(DbService);
    const created = await db.asTenant({ tenantId }, (tx) =>
      billing.createInvoice(tx, {
        patientId,
        facilityId,
        source: { module: 'pharmacy', refId: 'RX-1' },
        lines: [{ description: 'Paracetamol 500mg', qty: 10, unitPrice: 2.24, taxRate: 12, priceIncludesTax: true }],
        payNow: { mode: 'cash', amount: 22 },
      }),
    );
    expect(created).toMatchObject({ status: 'final', total: 22 });
    expect(created.number).toMatch(/^INV\d{6}$/);
    const price = await db.asTenant({ tenantId }, (tx) => billing.getServicePrice(CONS, null, tx));
    expect(price.price).toBe(450);
  });
});

describe('permissions and isolation', () => {
  it('enforces billing permissions', async () => {
    const res = await call(doctor, 'POST', '/billing/invoices', { patientId, lines: [{ serviceCode: CONS }] });
    expect(res.statusCode).toBe(403);
    const inv = (await call(clerk, 'GET', '/billing/invoices?status=final')).json().items[0];
    const cancel = await call(clerk, 'POST', `/billing/invoices/${inv.id}/cancel`, { reason: 'test' });
    expect(cancel.statusCode).toBe(403);
    expect(cancel.json().error.details.missing).toEqual(['billing.invoice.cancel']);
    expect((await call(owner, 'POST', '/billing/refunds', { patientId, mode: 'cash', amount: 1, notes: 'nope' })).statusCode).toBe(403);
  });

  it("never shows one hospital's bills to another", async () => {
    const mine = (await call(clerk, 'GET', '/billing/invoices')).json().items[0];
    const other = (path: string, method = 'GET', payload?: unknown) =>
      app.inject({ method, url: `/api/v1${path}`, headers: bearer(otherHospital), payload } as Inject);
    expect((await other(`/billing/invoices/${mine.id}`)).statusCode).toBe(404);
    expect((await other(`/billing/invoices/${mine.id}/payments`, 'POST', { mode: 'cash', amount: 1 })).statusCode).toBe(404);
    expect((await other(`/billing/invoices`)).json().items.find((i: { id: string }) => i.id === mine.id)).toBeUndefined();
    expect((await other(`/billing/services?q=${CONS}`)).json().items).toEqual([]);
    expect((await other(`/billing/patients/${patientId}/account`)).json()).toMatchObject({ depositBalance: 0, outstanding: 0, invoices: [] });
  });
});
