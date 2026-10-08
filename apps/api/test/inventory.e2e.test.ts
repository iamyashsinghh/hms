import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inventoryPurchaseOrders, inventoryVendors, inArray } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let pharmacist: string;
let nurse: string;
let doctor: string;
let otherHospital: string;
let otherTenantId: string;
let facilityId: string;
let mainStoreId: string;
let wardStoreId: string;
let vendorId: string;
const run = Date.now().toString(36).toUpperCase();
const rnd = () => Math.random().toString(36).slice(2, 6).toUpperCase();

type Method = 'GET' | 'POST' | 'PATCH';
const raw = (token: string, method: Method, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: bearer(token), payload: payload as object });
const call = (token: string, method: Method, url: string, payload?: unknown) => raw(token, method, `/inventory${url}`, payload);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
async function ok<T = any>(p: Promise<{ statusCode: number; body: string; json: () => unknown }>, status = 200): Promise<T> {
  const res = await p;
  expect(res.statusCode, res.body).toBe(status);
  return res.json() as T;
}

async function newItem(gstRate = 12) {
  return ok<{ id: string; name: string }>(
    raw(admin, 'POST', '/pharmacy/items', { code: `GL${run}${rnd()}`, name: `Gloves ${run} ${rnd()}`, form: 'consumable', unit: 'pair', gstRate, hsnCode: '40151900' }),
    201,
  );
}

async function stockIn(storeId: string, itemId: string): Promise<number> {
  const res = await raw(admin, 'GET', `/pharmacy/stores/${storeId}/items/${itemId}/batches`);
  return (res.json() as { qty: number }[]).reduce((s, b) => s + b.qty, 0);
}

/** Draft → approved PO for `qty` units at `rate`. */
async function approvedPo(itemId: string, qty: number, rate: number) {
  const po = await ok(call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId, qty, rate }] }), 201);
  return ok(call(admin, 'POST', `/purchase-orders/${po.id}/approve`));
}

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  const city = await login(app, 'admin@city.hms', 'city');
  otherHospital = city.accessToken;
  otherTenantId = (city.user as unknown as { tenantId: string }).tenantId;
  facilityId = (a.user as unknown as { facilities: { id: string }[] }).facilities[0]!.id;

  mainStoreId = (await ok(raw(admin, 'POST', '/pharmacy/stores', { facilityId, code: `MS${run}`, name: `Main store ${run}`, type: 'main' }), 201)).id;
  wardStoreId = (await ok(raw(admin, 'POST', '/pharmacy/stores', { facilityId, code: `WD${run}`, name: `Ward 3 ${run}`, type: 'ward' }), 201)).id;
  vendorId = (await ok(call(admin, 'POST', '/vendors', { code: `V${run}`, name: `Medline Traders ${run}`, gstin: '27AAPFU0939F1ZV', paymentTermsDays: 45 }), 201)).id;
});
afterAll(() => app.close());

describe('vendors', () => {
  it('creates, searches, validates and deactivates vendors; codes are unique per hospital', async () => {
    const v = await ok(call(admin, 'POST', '/vendors', { code: `v${run}x`, name: `Surgical House ${run}`, phone: '98200 11223', pan: 'aapfu0939f' }), 201);
    expect(v).toMatchObject({ code: `V${run}X`, pan: 'AAPFU0939F', paymentTermsDays: 30, isActive: true });

    const dup = await call(admin, 'POST', '/vendors', { code: `V${run}X`, name: 'Dup' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('vendor_code_taken');

    const bad = await call(admin, 'POST', '/vendors', { code: 'X1', name: 'Bad', gstin: '12345' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('validation_failed');

    const found = await ok(call(pharmacist, 'GET', `/vendors?q=${encodeURIComponent(`surgical house ${run}`.toLowerCase())}`));
    expect(found.items.map((x: { id: string }) => x.id)).toEqual([v.id]);

    await ok(call(admin, 'PATCH', `/vendors/${v.id}`, { isActive: false }));
    const active = await ok(call(admin, 'GET', `/vendors?q=${run}`));
    expect(active.items.map((x: { id: string }) => x.id)).not.toContain(v.id);

    const item = await newItem();
    const po = await call(admin, 'POST', '/purchase-orders', { vendorId: v.id, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 1, rate: 1 }] });
    expect(po.statusCode).toBe(409);
    expect(po.json().error.code).toBe('vendor_inactive');
  });
});

describe('requisition → purchase order → GRN → purchase return', () => {
  it('runs the full purchase cycle and moves stock through the pharmacy ledger', async () => {
    const item = await newItem(12);

    // A pharmacist asks; an approver approves.
    const req = await ok(call(pharmacist, 'POST', '/requisitions', { storeId: mainStoreId, lines: [{ itemId: item.id, qty: 100 }] }), 201);
    expect(req.number).toMatch(/^PRQ\d{6}$/);
    expect(req.lines[0]).toMatchObject({ itemName: item.name, unit: 'pair', qty: 100 });
    expect((await call(pharmacist, 'POST', `/requisitions/${req.id}/decision`, { approve: true })).statusCode).toBe(403);
    expect((await ok(call(admin, 'POST', `/requisitions/${req.id}/decision`, { approve: true, note: 'ok' }))).status).toBe('approved');

    // PO from the requisition: 100 x 10.00 + 12% GST.
    const draft = await ok(
      call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, requisitionId: req.id, lines: [{ itemId: item.id, qty: 90, rate: 9.5 }] }),
      201,
    );
    expect(draft).toMatchObject({ status: 'draft', number: expect.stringMatching(/^PO\d{6}$/), vendorName: `Medline Traders ${run}` });
    expect((await ok(call(admin, 'GET', `/requisitions/${req.id}`))).status).toBe('ordered');
    const again = await call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, requisitionId: req.id, lines: [{ itemId: item.id, qty: 1, rate: 1 }] });
    expect(again.json().error.code).toBe('requisition_not_approved');

    const edited = await ok(call(admin, 'PATCH', `/purchase-orders/${draft.id}`, { lines: [{ itemId: item.id, qty: 100, rate: 10 }], terms: 'Net 45' }));
    expect(edited).toMatchObject({ subtotal: 1000, taxTotal: 120, total: 1120, terms: 'Net 45' });
    expect(edited.lines[0]).toMatchObject({ qty: 100, rate: 10, gstRate: 12, amount: 1120, pendingQty: 100 });

    // Not receivable until approved.
    const early = await call(admin, 'POST', '/grns', { purchaseOrderId: draft.id, lines: [{ poLineId: edited.lines[0].id, qty: 1 }] });
    expect(early.json().error.code).toBe('po_not_receivable');

    const po = await ok(call(admin, 'POST', `/purchase-orders/${draft.id}/approve`));
    expect(po.status).toBe('approved');
    expect((await call(admin, 'PATCH', `/purchase-orders/${po.id}`, { notes: 'late edit' })).json().error.code).toBe('po_not_draft');
    const lineId = po.lines[0].id;

    // Part receipt without batch (consumable) plus 5 free.
    const grn1 = await ok(call(admin, 'POST', '/grns', { purchaseOrderId: po.id, invoiceNo: `INV-${run}`, lines: [{ poLineId: lineId, qty: 60, freeQty: 5 }] }), 201);
    expect(grn1.number).toMatch(/^GR\d{6}$/);
    expect(grn1.total).toBe(672); // 60 x 10 x 1.12
    expect(grn1.lines[0]).toMatchObject({ batchNo: 'NA', expiryDate: '2099-12-31', mrp: 11.2 });
    expect(await stockIn(mainStoreId, item.id)).toBe(65);
    const mid = await ok(call(admin, 'GET', `/purchase-orders/${po.id}`));
    expect(mid.status).toBe('partially_received');
    expect(mid.lines[0]).toMatchObject({ receivedQty: 60, pendingQty: 40 });

    const over = await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: lineId, qty: 41 }] });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe('over_receipt');

    const grn2 = await ok(
      call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: lineId, qty: 40, batchNo: 'b77', expiryDate: '2030-01-31', mrp: 15 }] }),
      201,
    );
    expect(grn2.lines[0]).toMatchObject({ batchNo: 'B77', mrp: 15 });
    expect(await stockIn(mainStoreId, item.id)).toBe(105);
    expect((await ok(call(admin, 'GET', `/purchase-orders/${po.id}`))).status).toBe('received');
    expect((await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: lineId, qty: 1 }] })).json().error.code).toBe('po_not_receivable');

    const grns = await ok(call(admin, 'GET', `/grns?purchaseOrderId=${po.id}`));
    expect(grns.items).toHaveLength(2);
    expect(grns.items[0].poNumber).toBe(po.number);

    // Return 10 damaged pairs from the first receipt.
    const ret = await ok(call(admin, 'POST', `/grns/${grn1.id}/returns`, { reason: 'Torn packs', lines: [{ grnLineId: grn1.lines[0].id, qty: 10 }] }), 201);
    expect(ret).toMatchObject({ number: expect.stringMatching(/^PRT\d{6}$/), total: 112 });
    expect(await stockIn(mainStoreId, item.id)).toBe(95);
    const tooMany = await call(admin, 'POST', `/grns/${grn1.id}/returns`, { reason: 'More', lines: [{ grnLineId: grn1.lines[0].id, qty: 56 }] });
    expect(tooMany.json().error.code).toBe('over_return');
    const detail = await ok(call(admin, 'GET', `/grns/${grn1.id}`));
    expect(detail.lines[0].returnedQty).toBe(10);
    expect(detail.returns).toHaveLength(1);

    const ledger = await ok(raw(admin, 'GET', `/pharmacy/stock/ledger?itemId=${item.id}`));
    const types = ledger.items.map((e: { txnType: string; qtyChange: number }) => `${e.txnType}:${e.qtyChange}`).sort();
    expect(types).toEqual(['grn:40', 'grn:65', 'purchase_return:-10']);
  });

  it('cancels drafts and short-closes part-received orders', async () => {
    const item = await newItem();
    const draft = await ok(call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 5, rate: 2 }] }), 201);
    expect((await ok(call(admin, 'POST', `/purchase-orders/${draft.id}/cancel`, { reason: 'Ordered by mistake' }))).status).toBe('cancelled');

    const po = await approvedPo(item.id, 10, 3);
    expect((await call(admin, 'POST', `/purchase-orders/${po.id}/close`, { reason: 'x' })).json().error.code).toBe('invalid_status');
    await ok(call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: po.lines[0].id, qty: 4 }] }), 201);
    expect((await call(admin, 'POST', `/purchase-orders/${po.id}/cancel`, { reason: 'x' })).json().error.code).toBe('invalid_status');
    const closed = await ok(call(admin, 'POST', `/purchase-orders/${po.id}/close`, { reason: 'Vendor out of stock' }));
    expect(closed).toMatchObject({ status: 'closed', closedReason: 'Vendor out of stock' });

    const open = await ok(call(admin, 'GET', `/purchase-orders?open=true&vendorId=${vendorId}&pageSize=200`));
    expect(open.items.map((p: { id: string }) => p.id)).not.toContain(po.id);
  });
});

describe('indents and issues', () => {
  it('a ward asks, the store approves less and issues in two goes, FEFO, through the ledger', async () => {
    const item = await newItem();
    const po = await approvedPo(item.id, 50, 4);
    await ok(
      call(admin, 'POST', '/grns', {
        purchaseOrderId: po.id,
        lines: [
          { poLineId: po.lines[0].id, qty: 30, batchNo: 'LATE', expiryDate: '2031-06-30' },
          { poLineId: po.lines[0].id, qty: 20, batchNo: 'EARLY', expiryDate: '2029-01-31' },
        ],
      }),
      201,
    );

    const indent = await ok(
      call(nurse, 'POST', '/indents', { toStoreId: wardStoreId, fromStoreId: mainStoreId, priority: 'urgent', lines: [{ itemId: item.id, qty: 30 }] }),
      201,
    );
    expect(indent).toMatchObject({ number: expect.stringMatching(/^IND\d{6}$/), status: 'submitted', toStoreName: `Ward 3 ${run}` });
    expect((await call(nurse, 'POST', `/indents/${indent.id}/decision`, { approve: true })).statusCode).toBe(403);
    expect((await call(nurse, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 1 }] })).statusCode).toBe(403);
    const notYet = await call(admin, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 1 }] });
    expect(notYet.json().error.code).toBe('indent_not_issuable');

    const tooMuch = await call(admin, 'POST', `/indents/${indent.id}/decision`, { approve: true, lines: [{ indentLineId: indent.lines[0].id, approvedQty: 31 }] });
    expect(tooMuch.json().error.code).toBe('approved_above_requested');
    const approved = await ok(call(admin, 'POST', `/indents/${indent.id}/decision`, { approve: true, lines: [{ indentLineId: indent.lines[0].id, approvedQty: 25 }] }));
    expect(approved.lines[0]).toMatchObject({ approvedQty: 25, pendingQty: 25 });

    const first = await ok(call(admin, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 22 }] }), 201);
    expect(first.status).toBe('partially_issued');
    expect(first.issues[0].lines.map((l: { batchNo: string; qty: number }) => [l.batchNo, l.qty])).toEqual([
      ['EARLY', 20],
      ['LATE', 2],
    ]);
    expect(await stockIn(wardStoreId, item.id)).toBe(22);
    expect(await stockIn(mainStoreId, item.id)).toBe(28);

    const over = await call(admin, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 4 }] });
    expect(over.json().error.code).toBe('over_issue');
    const done = await ok(call(admin, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 3 }] }), 201);
    expect(done.status).toBe('issued');
    expect(done.lines[0]).toMatchObject({ issuedQty: 25, pendingQty: 0 });
    expect(await stockIn(wardStoreId, item.id)).toBe(25);

    const ledger = await ok(raw(admin, 'GET', `/pharmacy/stock/ledger?itemId=${item.id}&storeId=${wardStoreId}`));
    expect(ledger.items.every((e: { txnType: string }) => e.txnType === 'transfer_in')).toBe(true);

    const list = await ok(call(nurse, 'GET', `/indents?storeId=${wardStoreId}`));
    expect(list.items.map((i: { id: string }) => i.id)).toContain(indent.id);
  });

  it('cannot issue more than the store holds, and keeps nothing half-done', async () => {
    const item = await newItem();
    const indent = await ok(call(nurse, 'POST', '/indents', { toStoreId: wardStoreId, fromStoreId: mainStoreId, lines: [{ itemId: item.id, qty: 5 }] }), 201);
    await ok(call(admin, 'POST', `/indents/${indent.id}/decision`, { approve: true }));
    const res = await call(admin, 'POST', `/indents/${indent.id}/issue`, { lines: [{ indentLineId: indent.lines[0].id, qty: 5 }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('insufficient_stock');
    const after = await ok(call(admin, 'GET', `/indents/${indent.id}`));
    expect(after).toMatchObject({ status: 'approved', issues: [] });

    const closed = await ok(call(admin, 'POST', `/indents/${indent.id}/close`, { reason: 'Bought locally' }));
    expect(closed.status).toBe('closed');
  });

  it('rejects and cancels', async () => {
    const item = await newItem();
    const same = await call(nurse, 'POST', '/indents', { toStoreId: wardStoreId, fromStoreId: wardStoreId, lines: [{ itemId: item.id, qty: 1 }] });
    expect(same.json().error.code).toBe('same_store');
    const a = await ok(call(nurse, 'POST', '/indents', { toStoreId: wardStoreId, fromStoreId: mainStoreId, lines: [{ itemId: item.id, qty: 1 }] }), 201);
    expect((await ok(call(admin, 'POST', `/indents/${a.id}/decision`, { approve: false, note: 'Use ward stock' }))).status).toBe('rejected');
    const b = await ok(call(nurse, 'POST', '/indents', { toStoreId: wardStoreId, fromStoreId: mainStoreId, lines: [{ itemId: item.id, qty: 1 }] }), 201);
    expect((await ok(call(nurse, 'POST', `/indents/${b.id}/cancel`))).status).toBe('cancelled');
  });
});

describe('access control', () => {
  it('enforces permissions per role', async () => {
    expect((await call(doctor, 'GET', '/vendors')).statusCode).toBe(403);
    expect((await call(doctor, 'GET', '/purchase-orders')).statusCode).toBe(403);
    expect((await call(doctor, 'GET', '/indents')).statusCode).toBe(403);
    expect((await call(nurse, 'POST', '/vendors', { code: 'N1', name: 'Nope' })).statusCode).toBe(403);
    expect((await call(nurse, 'GET', '/purchase-orders')).statusCode).toBe(403);
    const item = await newItem();
    expect((await call(pharmacist, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 1, rate: 1 }] })).statusCode).toBe(403);
    const draft = await ok(call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 1, rate: 1 }] }), 201);
    expect((await call(pharmacist, 'POST', `/purchase-orders/${draft.id}/approve`)).statusCode).toBe(403);
    expect((await call(pharmacist, 'GET', `/purchase-orders/${draft.id}`)).statusCode).toBe(200);
  });

  it('a store keeper buys and issues but cannot approve purchase orders', async () => {
    const store = (await login(app, 'store@demo.hms')).accessToken;
    const item = await newItem();
    const draft = await ok(call(store, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 2, rate: 5 }] }), 201);
    expect((await call(store, 'POST', `/purchase-orders/${draft.id}/approve`)).statusCode).toBe(403);
    const po = await ok(call(admin, 'POST', `/purchase-orders/${draft.id}/approve`));
    await ok(call(store, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: po.lines[0].id, qty: 2 }] }), 201);
    expect(await stockIn(mainStoreId, item.id)).toBe(2);
  });

  it('needs a plan that includes inventory', async () => {
    // The seeded "city" hospital is on the starter plan, which has no inventory module.
    const res = await call(otherHospital, 'GET', '/purchase-orders');
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
    expect((await call(otherHospital, 'POST', '/vendors', { code: 'X', name: 'X' })).statusCode).toBe(403);
  });

  it('keeps one hospital out of another hospital’s procurement rows (RLS)', async () => {
    const item = await newItem();
    const po = await approvedPo(item.id, 3, 1);
    const db = app.get(DbService);
    const seen = await db.asTenant({ tenantId: otherTenantId }, async (tx) => ({
      pos: await tx.select({ id: inventoryPurchaseOrders.id }).from(inventoryPurchaseOrders).where(inArray(inventoryPurchaseOrders.id, [po.id])),
      vendors: await tx.select({ id: inventoryVendors.id }).from(inventoryVendors).where(inArray(inventoryVendors.id, [vendorId])),
    }));
    expect(seen).toEqual({ pos: [], vendors: [] });
    // Updating another hospital's row touches nothing.
    await expect(
      db.asTenant({ tenantId: otherTenantId }, (tx) =>
        tx.update(inventoryPurchaseOrders).set({ notes: 'hijack' }).where(inArray(inventoryPurchaseOrders.id, [po.id])).returning(),
      ),
    ).resolves.toEqual([]);
    expect((await ok(call(admin, 'GET', `/purchase-orders/${po.id}`))).notes).toBeNull();
  });
});

describe('validation', () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const msg = (res: { json: () => unknown }) => {
    const e = (res.json() as { error: { message: string; details?: unknown } }).error;
    return [e.message, ...(Array.isArray(e.details) ? (e.details as { message: string }[]).map((d) => d.message) : [])].join(' | ');
  };

  it('checks vendor identifiers and contact details', async () => {
    const bad = await call(admin, 'POST', '/vendors', { code: `BAD${run}`, name: 'Bad Vendor', gstin: '27ABC', pan: '1234', phone: 'abc', email: 'x@' });
    expect(bad.statusCode).toBe(400);
    for (const m of ['valid 15-character GSTIN', 'valid PAN', 'valid phone number', 'valid email']) expect(msg(bad)).toContain(m);

    const space = await call(admin, 'POST', '/vendors', { code: 'MS 01', name: 'Spacey' });
    expect(msg(space)).toContain('no spaces');

    const mismatch = await call(admin, 'POST', '/vendors', { code: `MM${run}`, name: 'Mismatch', gstin: '27AAPFU0939F1ZV', pan: 'ABCDE1234F' });
    expect(mismatch.statusCode).toBe(400);
    expect(msg(mismatch)).toContain('PAN does not match the GSTIN');

    const blanks = await call(admin, 'POST', '/vendors', { code: `BL${run}`, name: 'Blank Fields', phone: '', email: '', gstin: '', pan: '' });
    expect(blanks.statusCode, blanks.body).toBe(201);
    expect(blanks.json()).toMatchObject({ phone: null, email: null, gstin: null, pan: null });
  });

  it('refuses past needed-by and expected dates, duplicate items and bad quantities', async () => {
    const item = await newItem();
    const past = await call(pharmacist, 'POST', '/requisitions', { storeId: mainStoreId, neededBy: addDays(today, -1), lines: [{ itemId: item.id, qty: 5 }] });
    expect(past.statusCode).toBe(400);
    expect(msg(past)).toContain('Needed-by date cannot be in the past');

    const dup = await call(pharmacist, 'POST', '/requisitions', { storeId: mainStoreId, lines: [{ itemId: item.id, qty: 5 }, { itemId: item.id, qty: 2 }] });
    expect(dup.statusCode).toBe(400);
    expect(msg(dup)).toContain('listed twice');

    const frac = await call(pharmacist, 'POST', '/requisitions', { storeId: mainStoreId, lines: [{ itemId: item.id, qty: 1.5 }] });
    expect(msg(frac)).toContain('whole number');

    const poPast = await call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, expectedDate: addDays(today, -3), lines: [{ itemId: item.id, qty: 1, rate: 1 }] });
    expect(poPast.statusCode).toBe(400);
    expect(msg(poPast)).toContain('Expected delivery date cannot be in the past');

    const rate = await call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, lines: [{ itemId: item.id, qty: 1, rate: 1.005 }] });
    expect(msg(rate)).toContain('2 decimal');

    const draft = await ok(call(admin, 'POST', '/purchase-orders', { vendorId, storeId: mainStoreId, expectedDate: addDays(today, 7), lines: [{ itemId: item.id, qty: 1, rate: 1 }] }), 201);
    const edit = await call(admin, 'PATCH', `/purchase-orders/${draft.id}`, { expectedDate: addDays(today, -1) });
    expect(edit.statusCode).toBe(400);
    expect(edit.json().error.code).toBe('expected_date_past');
    // Saving the same date again is fine.
    expect((await call(admin, 'PATCH', `/purchase-orders/${draft.id}`, { expectedDate: addDays(today, 7), notes: 'ok' })).statusCode).toBe(200);
  });

  it('refuses expired batches, future invoice dates and MRP below the rate on a GRN', async () => {
    const item = await newItem();
    const po = await approvedPo(item.id, 10, 10);
    const lineId = po.lines[0].id;
    const expired = await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: lineId, qty: 1, batchNo: 'OLD1', expiryDate: addDays(today, -1) }] });
    expect(expired.statusCode).toBe(400);
    expect(msg(expired)).toContain('already expired');

    const invoice = await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, invoiceDate: addDays(today, 1), lines: [{ poLineId: lineId, qty: 1 }] });
    expect(msg(invoice)).toContain('Invoice date cannot be in the future');

    const cheap = await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, lines: [{ poLineId: lineId, qty: 1, mrp: 5 }] });
    expect(cheap.statusCode).toBe(400);
    expect(cheap.json().error.code).toBe('mrp_below_rate');

    const good = await call(admin, 'POST', '/grns', { purchaseOrderId: po.id, invoiceNo: '', invoiceDate: today, lines: [{ poLineId: lineId, qty: 2, batchNo: '', expiryDate: addDays(today, 365), mrp: 12 }] });
    expect(good.statusCode, good.body).toBe(201);
    expect(good.json().lines[0]).toMatchObject({ batchNo: 'NA', mrp: 12 });

    const noReason = await call(admin, 'POST', `/grns/${good.json().id}/returns`, { reason: ' ', lines: [{ grnLineId: good.json().lines[0].id, qty: 1 }] });
    expect(noReason.statusCode).toBe(400);
    expect(msg(noReason)).toContain('reason');
  });
});
