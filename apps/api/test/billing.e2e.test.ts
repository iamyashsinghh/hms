import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
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

  it('keeps the payer when a payer price list is edited (BIL-46)', async () => {
    const svc = (await call(admin, 'GET', `/billing/services?q=${XRAY}`)).json().items[0];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const payerId = crypto.randomUUID();
    const created = await call(admin, 'POST', '/billing/price-lists', { name: `Payer ${tag}`, payerId, effectiveFrom: today, items: [{ serviceId: svc.id, price: 700 }] });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json().id;
    // Edit as the price-lists screen did before the fix: no payerId in the body.
    const edited = await call(admin, 'PUT', `/billing/price-lists/${id}`, { name: `Payer ${tag} v2`, effectiveFrom: today, items: [{ serviceId: svc.id, price: 650 }] });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(edited.json()).toMatchObject({ name: `Payer ${tag} v2`, payerId, items: [{ serviceId: svc.id, price: 650 }] });
    expect((await call(admin, 'GET', `/billing/price-lists/${id}`)).json().payerId).toBe(payerId);
    // The cash price is untouched; the payer price comes from the edited list.
    expect((await call(clerk, 'GET', `/billing/services/price?code=${XRAY}`)).json().price).toBe(800);
    expect((await call(clerk, 'GET', `/billing/services/price?code=${XRAY}&payerId=${payerId}`)).json().price).toBe(650);
    // An explicit null still turns it into a general list; bad dates and negative prices are refused.
    const bad = await call(admin, 'PUT', `/billing/price-lists/${id}`, { name: 'x', effectiveFrom: today, effectiveTo: '2000-01-01', items: [] });
    expect(bad.statusCode).toBe(400);
    const neg = await call(admin, 'PUT', `/billing/price-lists/${id}`, { name: 'x', effectiveFrom: today, items: [{ serviceId: svc.id, price: -1 }] });
    expect(neg.statusCode).toBe(400);
    expect((await call(clerk, 'PUT', `/billing/price-lists/${id}`, { name: 'x', effectiveFrom: today, items: [] })).statusCode).toBe(403);
    expect((await call(admin, 'PUT', `/billing/price-lists/${crypto.randomUUID()}`, { name: 'x', effectiveFrom: today, items: [] })).statusCode).toBe(404);
    const cleared = await call(admin, 'PUT', `/billing/price-lists/${id}`, { name: `Payer ${tag} v3`, payerId: null, effectiveFrom: today, isActive: false, items: [] });
    expect(cleared.json().payerId).toBeNull();
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

  it('edits only what is sent on a draft (web edit screen), validates lines and needs invoice.create', async () => {
    const draft = await call(clerk, 'POST', '/billing/invoices', { patientId, supplyType: 'inter', notes: 'first', lines: [{ serviceCode: XRAY }] });
    expect(draft.statusCode, draft.body).toBe(201);
    const id = draft.json().id;
    // A notes-only edit must not reset the GST supply type to the schema default ('intra').
    const notes = await call(clerk, 'PATCH', `/billing/invoices/${id}`, { notes: 'second' });
    expect(notes.statusCode, notes.body).toBe(200);
    expect(notes.json()).toMatchObject({ supplyType: 'inter', notes: 'second', igstTotal: 144 });
    // What the edit screen sends: every line with explicit price, discount and GST, plus a free-text line.
    const full = await call(clerk, 'PATCH', `/billing/invoices/${id}`, {
      supplyType: 'intra',
      notes: '',
      lines: [
        { serviceCode: XRAY, description: 'X-ray chest PA', qty: 2, unitPrice: 800, discount: 100, taxRate: 18 },
        { description: 'Dressing', qty: 1, unitPrice: 50, taxRate: 0 },
      ],
    });
    expect(full.statusCode, full.body).toBe(200);
    expect(full.json()).toMatchObject({ supplyType: 'intra', notes: null, igstTotal: 0, total: 1500 * 1.18 + 50 });
    expect(full.json().lines).toHaveLength(2);
    for (const bad of [{ lines: [] }, { lines: [{ description: 'x', unitPrice: -1 }] }, { lines: [{ serviceCode: XRAY, qty: 0 }] }, { lines: [{ description: 'no price' }] }]) {
      expect((await call(clerk, 'PATCH', `/billing/invoices/${id}`, bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
    expect((await call(owner, 'PATCH', `/billing/invoices/${id}`, { notes: 'x' })).statusCode).toBe(403);
    expect((await call(clerk, 'DELETE', `/billing/invoices/${id}`)).statusCode).toBe(204);
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
    const events = await db.asTenant({ tenantId }, (tx) =>
      tx.execute<{ topic: string; payload: Record<string, unknown> }>(
        sql`select topic, payload from audit.outbox where payload->>'invoiceId' = ${created.invoiceId}`,
      ),
    );
    // Both rows come from one transaction (same now(), same uuid_v7 millisecond), so match by topic, not order.
    const byTopic = (t: string) => events.rows.filter((r) => r.topic === t).map((r) => r.payload);
    expect(events.rows.map((r) => r.topic).sort()).toEqual(['billing.invoice.finalized', 'billing.payment.received']);
    expect(byTopic('billing.invoice.finalized')[0]).toMatchObject({
      number: created.number,
      facilityId,
      total: 22,
      source: { module: 'pharmacy', refId: 'RX-1' },
      lines: [{ description: 'Paracetamol 500mg', qty: 10, amount: 22.4 }],
      paid: 22,
    });
    expect(byTopic('billing.payment.received')[0]).toMatchObject({ amount: 22, mode: 'cash', kind: 'payment', facilityId, ref: null });
    const price = await db.asTenant({ tenantId }, (tx) => billing.getServicePrice(CONS, null, tx));
    expect(price.price).toBe(450);
  });

  it('credits pharmacy returns on a bill, refunding what was already paid (returnOnInvoice)', async () => {
    const billing = app.get(BillingService);
    const db = app.get(DbService);
    const inv = await db.asTenant({ tenantId }, (tx) =>
      billing.createInvoice(tx, { patientId, facilityId, source: { module: 'pharmacy', refId: `S-${tag}` }, lines: [{ description: 'Syrup', qty: 2, unitPrice: 100 }], payNow: { mode: 'cash', amount: 150 } }),
    );
    // 200 billed, 150 paid, 50 due. Returning 120: 50 is credited off the due, 70 goes back in cash.
    await expect(db.asTenant({ tenantId }, (tx) => billing.returnOnInvoice(tx, inv.invoiceId, { amount: 120, reason: 'Returned 1 bottle' }))).rejects.toThrow(/refundMode/);
    const ret = { amount: 120, reason: 'Returned 1 bottle', refundMode: 'cash' as const, reference: `RET-${tag}` };
    const r1 = await db.asTenant({ tenantId }, (tx) => billing.returnOnInvoice(tx, inv.invoiceId, ret));
    expect(r1).toMatchObject({ refundAmount: 70, balance: 0 });
    expect(r1.creditNoteNumber).toMatch(/^CN\d{6}$/);
    expect(r1.refundNumber).toMatch(/^RFD\d{6}$/);
    const r2 = await db.asTenant({ tenantId }, (tx) => billing.returnOnInvoice(tx, inv.invoiceId, ret));
    expect(r2).toEqual(r1);
    const after = (await call(clerk, 'GET', `/billing/invoices/${inv.invoiceId}`)).json();
    expect(after).toMatchObject({ total: 200, paidAmount: 80, creditedAmount: 120, balance: 0 });
    await expect(
      db.asTenant({ tenantId }, (tx) => billing.returnOnInvoice(tx, inv.invoiceId, { amount: 81, reason: 'Too much', refundMode: 'cash' })),
    ).rejects.toThrow();
  });

  it('takes insurer settlements and disallowance credit notes inside a caller transaction, once per reference', async () => {
    const billing = app.get(BillingService);
    const db = app.get(DbService);
    const inv = await db.asTenant({ tenantId }, (tx) => billing.createInvoice(tx, { patientId, facilityId, lines: [{ serviceCode: CONS }] }));
    const pay = { mode: 'insurance' as const, amount: 300, reference: `CLM-${tag}` };
    const p1 = await db.asTenant({ tenantId }, (tx) => billing.collectPaymentTx(tx, inv.invoiceId, pay));
    const p2 = await db.asTenant({ tenantId }, (tx) => billing.collectPaymentTx(tx, inv.invoiceId, pay));
    expect(p2.id).toBe(p1.id);
    expect(p1).toMatchObject({ mode: 'insurance', amount: 300, shiftId: null });
    const cn = { amount: 100, reason: 'Disallowed by TPA', reference: `DIS-${tag}` };
    const c1 = await db.asTenant({ tenantId }, (tx) => billing.creditNoteTx(tx, inv.invoiceId, cn));
    const c2 = await db.asTenant({ tenantId }, (tx) => billing.creditNoteTx(tx, inv.invoiceId, cn));
    expect(c2.id).toBe(c1.id);
    const after = (await call(clerk, 'GET', `/billing/invoices/${inv.invoiceId}`)).json();
    expect(after).toMatchObject({ paidAmount: 300, creditedAmount: 100, balance: 50 });
  });

  it('records portal online payments once, keeping any excess as advance', async () => {
    const inv = (await call(clerk, 'POST', '/billing/invoices', { patientId, finalize: true, lines: [{ serviceCode: CONS }] })).json();
    const before = (await call(clerk, 'GET', `/billing/patients/${patientId}/account`)).json().depositBalance;
    const bus = app.get(EventBus);
    const event = {
      id: `evt-${tag}`,
      tenantId,
      topic: 'portal.payment.captured',
      createdAt: new Date().toISOString(),
      payload: { intentId: `pi_${tag}`, invoiceId: inv.id, patientId, amount: '500.00', mode: 'online', providerPaymentId: 'pay_123' },
    };
    await bus.dispatch(event);
    await bus.dispatch(event); // delivered twice: still one receipt
    const after = (await call(clerk, 'GET', `/billing/invoices/${inv.id}`)).json();
    expect(after).toMatchObject({ paymentStatus: 'paid', paidAmount: 450 });
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ mode: 'online', reference: `pi_${tag}` });
    const acct = (await call(clerk, 'GET', `/billing/patients/${patientId}/account`)).json();
    expect(acct.depositBalance).toBe(before + 50);
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

describe('billing validation', () => {
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  it('keeps the payer when a payer price list is edited without one (BIL-46)', async () => {
    const payer = await call(admin, 'POST', '/insurance/payers', { code: `BPL-${tag}`, name: `Price list payer ${tag}`, type: 'corporate' });
    expect(payer.statusCode, payer.body).toBe(201);
    const svc = (await call(admin, 'GET', `/billing/services?q=${XRAY}`)).json().items[0];
    const list = await call(admin, 'POST', '/billing/price-lists', {
      name: `Payer ${tag}`,
      payerId: payer.json().id,
      effectiveFrom: today(),
      items: [{ serviceId: svc.id, price: 700 }],
    });
    expect(list.statusCode, list.body).toBe(201);
    const edit = await call(admin, 'PUT', `/billing/price-lists/${list.json().id}`, { name: `Payer ${tag} v2`, effectiveFrom: today(), items: [{ serviceId: svc.id, price: 650 }] });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json()).toMatchObject({ name: `Payer ${tag} v2`, payerId: payer.json().id });
    const clear = await call(admin, 'PUT', `/billing/price-lists/${list.json().id}`, { name: `Payer ${tag} v3`, payerId: null, effectiveFrom: today(), isActive: false, items: [] });
    expect(clear.json().payerId).toBeNull();
  });

  it('a partial service update does not reset category, GST or active flag', async () => {
    const svc = (await call(admin, 'GET', `/billing/services?q=${XRAY}`)).json().items[0];
    const res = await call(admin, 'PATCH', `/billing/services/${svc.id}`, { basePrice: 800 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ category: 'radiology', taxRate: 18, isActive: true, basePrice: 800 });
  });

  it('gives clear messages for bad bills, settings, refunds and date ranges', async () => {
    const msg = (r: { json: () => { error: { message: string } } }) => r.json().error.message;
    const disc = await call(clerk, 'POST', '/billing/invoices', { patientId, lines: [{ description: 'Dressing', unitPrice: 100, discount: 150 }] });
    expect(disc.statusCode).toBe(400);
    expect(msg(disc)).toContain('Discount is more than the line amount');
    const qty = await call(clerk, 'POST', '/billing/invoices', { patientId, lines: [{ description: 'Dressing', unitPrice: 100, qty: 0 }] });
    expect(qty.statusCode).toBe(400);
    expect(msg(qty)).toContain('Quantity must be more than 0');
    const gst = await call(clerk, 'POST', '/billing/invoices', { patientId, lines: [{ description: 'Kit', unitPrice: 100, taxRate: 7 }] });
    expect(msg(gst)).toContain('Use a GST slab');

    const settings = await call(admin, 'PUT', '/billing/settings', { gstin: '27AAAAA0000A1Z5', stateCode: '29' });
    expect(settings.statusCode).toBe(400);
    expect(msg(settings)).toContain('State code must match');
    const phone = await call(admin, 'PUT', '/billing/settings', { phone: 'call me' });
    expect(msg(phone)).toContain('Enter a valid phone number');

    const refund = await call(admin, 'POST', '/billing/refunds', { patientId, mode: 'cash', amount: 10, notes: 'ok' });
    expect(refund.statusCode).toBe(400);
    expect(msg(refund)).toContain('at least 3 characters');

    const range = await call(admin, 'GET', `/billing/invoices?from=${today()}&to=2000-01-01`);
    expect(range.statusCode).toBe(400);
    expect(msg(range)).toContain('End date is before start date');
    const list = await call(admin, 'POST', '/billing/price-lists', { name: `Bad ${tag}`, effectiveFrom: '2026-12-01', effectiveTo: '2026-01-01' });
    expect(msg(list)).toContain('End date is before start date');
  });
});
