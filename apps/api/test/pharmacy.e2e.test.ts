import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from '@hms/db';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { PharmacyService } from '../src/modules/pharmacy/pharmacy.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let pharmacist: string;
let doctor: string;
let reception: string;
let otherHospital: string;
let tenantId: string;
let facilityId: string;
let storeId: string;
let patientId: string;
const run = Date.now().toString(36).toUpperCase();

const call = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1/pharmacy${url}`, headers: bearer(token), payload: payload as object });

const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function newItem(extra: Record<string, unknown> = {}) {
  const res = await call(pharmacist, 'POST', '/items', {
    code: `T${run}${Math.random().toString(36).slice(2, 6)}`,
    name: `Paracetamol 500 ${run} ${Math.random().toString(36).slice(2, 6)}`,
    genericName: 'Paracetamol',
    form: 'tablet',
    strength: '500 mg',
    hsnCode: '30049099',
    gstRate: 5,
    unit: 'tablet',
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; code: string; name: string };
}

async function stockUp(itemId: string, lines: { batchNo: string; expiryDate: string; mrp: number; qty: number }[]) {
  const res = await call(pharmacist, 'POST', '/stock/opening', { storeId, lines: lines.map((l) => ({ itemId, purchaseRate: 5, ...l })) });
  expect(res.statusCode, res.body).toBe(201);
}

async function stockOf(itemId: string): Promise<number> {
  const res = await call(pharmacist, 'GET', `/stores/${storeId}/items/${itemId}/batches`);
  return (res.json() as { qty: number; isExpired: boolean }[]).filter((b) => !b.isExpired).reduce((s, b) => s + b.qty, 0);
}

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  const me = a.user as unknown as { tenantId: string; facilities: { id: string }[] };
  tenantId = me.tenantId;
  facilityId = me.facilities[0]!.id;

  const store = await call(admin, 'POST', '/stores', { facilityId, code: `PH${run}`, name: `Pharmacy ${run}` });
  expect(store.statusCode, store.body).toBe(201);
  storeId = store.json().id;

  const patients = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: bearer(pharmacist) });
  patientId = patients.json().items[0].id;
});
afterAll(() => app.close());

describe('pharmacy item master', () => {
  it('creates, finds and updates items; codes are unique per hospital', async () => {
    const item = await newItem();
    expect(item.code).toBe(item.code.toUpperCase());
    const dup = await call(pharmacist, 'POST', '/items', { code: item.code.toLowerCase(), name: 'Dup' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('item_code_taken');

    const search = await call(pharmacist, 'GET', `/items?q=${encodeURIComponent(item.name.toLowerCase())}`);
    expect(search.json().items.map((x: { id: string }) => x.id)).toContain(item.id);

    const upd = await call(pharmacist, 'PATCH', `/items/${item.id}`, { reorderLevel: 20, schedule: 'H' });
    expect(upd.statusCode).toBe(200);
    expect(upd.json()).toMatchObject({ reorderLevel: 20, schedule: 'H' });
  });

  it('validates input with the shared schema', async () => {
    const res = await call(pharmacist, 'POST', '/items', { code: 'bad code!', name: '', gstRate: 99 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });
});

describe('stock, FEFO sales and returns', () => {
  it('sells first-expiry-first-out, skips expired batches, prices GST-inclusive and writes the ledger', async () => {
    const item = await newItem();
    await stockUp(item.id, [
      { batchNo: 'LATE', expiryDate: daysFromNow(400), mrp: 12, qty: 10 },
      { batchNo: 'EARLY', expiryDate: daysFromNow(60), mrp: 10, qty: 4 },
      { batchNo: 'OLD', expiryDate: daysFromNow(-5), mrp: 10, qty: 50 },
    ]);
    expect(await stockOf(item.id)).toBe(14);

    const sale = await call(pharmacist, 'POST', '/sales', { storeId, customerName: 'Walk-in', paymentMode: 'upi', lines: [{ itemId: item.id, qty: 6 }] });
    expect(sale.statusCode, sale.body).toBe(201);
    const s = sale.json();
    expect(s.number).toMatch(/^PH\d{6}$/);
    expect(s.lines.map((l: { batchNo: string; qty: number }) => [l.batchNo, l.qty])).toEqual([
      ['EARLY', 4],
      ['LATE', 2],
    ]);
    // 4 x 10 + 2 x 12 = 64.00 incl. 5% GST
    expect(s.total).toBe(64);
    expect(s.taxableAmount + s.taxAmount).toBeCloseTo(64, 2);
    expect(s.invoiceId).toBeNull(); // walk-in: the PH bill is the bill
    expect(await stockOf(item.id)).toBe(8);

    const ledger = await call(pharmacist, 'GET', `/stock/ledger?itemId=${item.id}`);
    const types = ledger.json().items.map((e: { txnType: string; qtyChange: number }) => `${e.txnType}:${e.qtyChange}`);
    expect(types).toEqual(expect.arrayContaining(['sale:-4', 'sale:-2', 'opening:10', 'opening:4', 'opening:50']));

    const stock = await call(pharmacist, 'GET', `/stock?storeId=${storeId}&q=${encodeURIComponent(item.code)}`);
    expect(stock.statusCode, stock.body).toBe(200);
    expect(stock.json().items[0]).toMatchObject({ itemId: item.id, qty: 8, expiredQty: 50, nearestExpiry: daysFromNow(400) });
    const low = await call(pharmacist, 'GET', `/stock?storeId=${storeId}&lowOnly=true&pageSize=200`);
    expect(low.statusCode, low.body).toBe(200);
    const sales = await call(pharmacist, 'GET', `/sales?q=${s.number.toLowerCase()}`);
    expect(sales.json().items.map((x: { id: string }) => x.id)).toEqual([s.id]);
    const today = await call(pharmacist, 'GET', `/sales?type=otc&from=${daysFromNow(-1)}&to=${daysFromNow(1)}`);
    expect(today.json().total).toBeGreaterThan(0);
  });

  it('never goes negative and refuses expired batches', async () => {
    const item = await newItem();
    await stockUp(item.id, [
      { batchNo: 'B1', expiryDate: daysFromNow(100), mrp: 5, qty: 3 },
      { batchNo: 'EXP', expiryDate: daysFromNow(-1), mrp: 5, qty: 3 },
    ]);
    const tooMany = await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 4 }] });
    expect(tooMany.statusCode).toBe(409);
    expect(tooMany.json().error).toMatchObject({ code: 'insufficient_stock', details: { requested: 4, available: 3 } });
    expect(await stockOf(item.id)).toBe(3);

    const batches = await call(pharmacist, 'GET', `/stores/${storeId}/items/${item.id}/batches`);
    const expired = batches.json().find((b: { batchNo: string }) => b.batchNo === 'EXP');
    const res = await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 1, batchId: expired.batchId }] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('batch_expired');

    const expiring = await call(pharmacist, 'GET', `/stock/expiring?storeId=${storeId}&days=120`);
    expect(expiring.json().map((b: { batchId: string }) => b.batchId)).toContain(expired.batchId);

    const writeOff = await call(pharmacist, 'POST', '/stock/adjustments', { storeId, batchId: expired.batchId, qtyChange: -3, type: 'expiry_writeoff', reason: 'Expired' });
    expect(writeOff.statusCode, writeOff.body).toBe(201);
    expect(writeOff.json().balance).toBe(0);
    const again = await call(pharmacist, 'POST', '/stock/adjustments', { storeId, batchId: expired.batchId, qtyChange: -1, reason: 'Oops' });
    expect(again.statusCode).toBe(409);
  });

  it('invoices OTC sales to registered patients through billing, credit sales stay unpaid', async () => {
    const item = await newItem();
    await stockUp(item.id, [{ batchNo: 'INV', expiryDate: daysFromNow(200), mrp: 13.45, qty: 10 }]);
    const paid = await call(pharmacist, 'POST', '/sales', { storeId, patientId, paymentMode: 'upi', lines: [{ itemId: item.id, qty: 1 }] });
    expect(paid.statusCode, paid.body).toBe(201);
    const inv = (await app.inject({ method: 'GET', url: `/api/v1/billing/invoices/${paid.json().invoiceId}`, headers: bearer(admin) })).json();
    expect(inv.status).toBe('final');
    expect(inv.paidAmount).toBe(inv.total); // fully paid even when billing rounds to the rupee
    expect(Math.abs(inv.total - 13.45)).toBeLessThan(1);

    const credit = await call(pharmacist, 'POST', '/sales', { storeId, patientId, paymentMode: 'credit', lines: [{ itemId: item.id, qty: 1 }] });
    const inv2 = (await app.inject({ method: 'GET', url: `/api/v1/billing/invoices/${credit.json().invoiceId}`, headers: bearer(admin) })).json();
    expect(inv2.paidAmount).toBe(0);
  });

  it('credits returns of an invoiced sale on the invoice and refunds the paid part, including round-off', async () => {
    const item = await newItem();
    await stockUp(item.id, [{ batchNo: 'CN', expiryDate: daysFromNow(200), mrp: 13.45, qty: 10 }]);
    const sale = (await call(pharmacist, 'POST', '/sales', { storeId, patientId, paymentMode: 'cash', lines: [{ itemId: item.id, qty: 2 }] })).json();
    const getInv = async () => (await app.inject({ method: 'GET', url: `/api/v1/billing/invoices/${sale.invoiceId}`, headers: bearer(admin) })).json();
    const inv = await getInv();

    const r1 = await call(pharmacist, 'POST', `/sales/${sale.id}/returns`, { reason: 'Unopened strip', lines: [{ saleLineId: sale.lines[0].id, qty: 1 }] });
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json()).toMatchObject({ refundAmount: 13.45, creditNoteNumber: expect.any(String), billingRefundNumber: expect.any(String) });
    expect((await getInv()).creditedAmount).toBe(13.45);

    const r2 = await call(pharmacist, 'POST', `/sales/${sale.id}/returns`, { lines: [{ saleLineId: sale.lines[0].id, qty: 1 }] });
    expect(r2.statusCode, r2.body).toBe(201);
    const after = await getInv();
    expect(after.creditedAmount).toBe(inv.total); // last return credits the rounded remainder too
    expect(r2.json().refundAmount).toBeCloseTo(inv.total - 13.45, 2);
  });

  it('asks for a prescription before selling Schedule H drugs over the counter', async () => {
    const item = await newItem({ schedule: 'H' });
    await stockUp(item.id, [{ batchNo: 'H1', expiryDate: daysFromNow(200), mrp: 50, qty: 5 }]);
    const no = await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 1 }] });
    expect(no.statusCode).toBe(400);
    expect(no.json().error.code).toBe('prescription_required');
    const yes = await call(pharmacist, 'POST', '/sales', { storeId, prescriptionSeen: true, lines: [{ itemId: item.id, qty: 1 }] });
    expect(yes.statusCode).toBe(201);
  });

  it('receives a GRN with free quantity and publishes stock.low when stock drops to the reorder level', async () => {
    const item = await newItem({ reorderLevel: 5 });
    const grn = await call(pharmacist, 'POST', '/grns', {
      storeId,
      supplierName: 'Shree Pharma Distributors',
      invoiceNo: `INV-${run}`,
      lines: [{ itemId: item.id, batchNo: 'G1', expiryDate: daysFromNow(300), mrp: 20, purchaseRate: 12, qty: 10, freeQty: 2 }],
    });
    expect(grn.statusCode, grn.body).toBe(201);
    expect(grn.json().number).toMatch(/^GRN\d{6}$/);
    expect(grn.json().totalAmount).toBe(126); // 10 x 12 + 5% GST; free units cost nothing
    expect(await stockOf(item.id)).toBe(12);
    expect((await call(pharmacist, 'GET', '/grns')).json().items[0].id).toBe(grn.json().id);
    const detail = await call(pharmacist, 'GET', `/grns/${grn.json().id}`);
    expect(detail.json().lines[0]).toMatchObject({ batchNo: 'G1', qty: 10, freeQty: 2 });

    await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 7 }] });
    const events = await app.get(DbService).asTenant({ tenantId }, (tx) =>
      tx.execute<{ n: number }>(sql`select count(*)::int as n from audit.outbox where topic = 'pharmacy.stock.low' and payload->>'itemId' = ${item.id}`),
    );
    expect(events.rows[0]!.n).toBe(1);
  });

  it('takes returns back into the same batch and refunds proportionally', async () => {
    const item = await newItem();
    await stockUp(item.id, [{ batchNo: 'R1', expiryDate: daysFromNow(200), mrp: 10, qty: 10 }]);
    const sale = (await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 3, discountPct: 10 }] })).json();
    expect(sale.total).toBe(27);
    const lineId = sale.lines[0].id;

    const r1 = await call(pharmacist, 'POST', `/sales/${sale.id}/returns`, { reason: 'Not needed', lines: [{ saleLineId: lineId, qty: 1 }] });
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json().refundAmount).toBe(9);
    const over = await call(pharmacist, 'POST', `/sales/${sale.id}/returns`, { lines: [{ saleLineId: lineId, qty: 3 }] });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('over_return');
    const r2 = await call(pharmacist, 'POST', `/sales/${sale.id}/returns`, { lines: [{ saleLineId: lineId, qty: 2 }] });
    expect(r2.json().refundAmount).toBe(18);

    const after = (await call(pharmacist, 'GET', `/sales/${sale.id}`)).json();
    expect(after).toMatchObject({ status: 'returned', returnedAmount: 27 });
    expect(after.returns).toHaveLength(2);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('keeps the stock ledger append-only even for the API database role', async () => {
    const db = app.get(DbService);
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`update inventory.stock_ledger set qty_change = 1`))).rejects.toThrow();
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`delete from inventory.stock_ledger`))).rejects.toThrow();
  });
});

describe('prescription dispense queue', () => {
  it('queues EMR prescriptions once, matches items, dispenses partially then fully and publishes dispense.completed', async () => {
    const item = await newItem();
    await stockUp(item.id, [{ batchNo: 'D1', expiryDate: daysFromNow(200), mrp: 2, qty: 100 }]);
    const prescriptionId = randomUUID();
    const event = {
      id: randomUUID(),
      tenantId,
      topic: 'emr.prescription.created',
      createdAt: new Date().toISOString(),
      payload: {
        prescriptionId,
        patientId,
        lines: [
          { drugName: item.name, itemCode: item.code, dose: '1 tab', frequency: 'TDS', days: 5, qty: 15 },
          { drugName: 'Some brand we do not stock', dose: '5 ml', frequency: 'BD', days: 3, qty: 1 },
        ],
      },
    };
    const bus = app.get(EventBus);
    await bus.dispatch(event);
    await bus.dispatch(event); // at-least-once delivery: must not queue twice

    const queue = (await call(pharmacist, 'GET', '/prescriptions?status=open&pageSize=200')).json();
    const mine = queue.items.filter((r: { prescriptionId: string }) => r.prescriptionId === prescriptionId);
    expect(mine).toHaveLength(1);
    const rx = mine[0];
    expect(rx.status).toBe('pending');
    expect(rx.lines[0]).toMatchObject({ itemId: item.id, qty: 15, dispensedQty: 0 });
    expect(rx.lines[1].itemId).toBeNull();

    const over = await call(pharmacist, 'POST', `/prescriptions/${rx.id}/dispense`, { storeId, lines: [{ prescriptionLineId: rx.lines[0].id, qty: 16 }] });
    expect(over.json().error.code).toBe('over_dispense');

    const part = await call(pharmacist, 'POST', `/prescriptions/${rx.id}/dispense`, { storeId, lines: [{ prescriptionLineId: rx.lines[0].id, qty: 15 }] });
    expect(part.statusCode, part.body).toBe(201);
    expect(part.json()).toMatchObject({ type: 'rx', patientId, total: 30 });
    // Registered patient: billing raises a final, paid invoice for the dispense.
    expect(part.json().invoiceId).toEqual(expect.any(String));
    expect(part.json().invoiceNumber).toEqual(expect.any(String));
    const inv = await app.inject({ method: 'GET', url: `/api/v1/billing/invoices/${part.json().invoiceId}`, headers: bearer(admin) });
    expect(inv.statusCode, inv.body).toBe(200);
    expect(inv.json()).toMatchObject({ status: 'final', total: 30, paidAmount: 30 });
    expect((await call(pharmacist, 'GET', `/prescriptions/${rx.id}`)).json().status).toBe('partial');

    // The pharmacist substitutes an item for the unmatched brand.
    const full = await call(pharmacist, 'POST', `/prescriptions/${rx.id}/dispense`, {
      storeId,
      lines: [{ prescriptionLineId: rx.lines[1].id, itemId: item.id, qty: 1 }],
    });
    expect(full.statusCode, full.body).toBe(201);
    expect((await call(pharmacist, 'GET', `/prescriptions/${rx.id}`)).json().status).toBe('dispensed');
    const closed = await call(pharmacist, 'POST', `/prescriptions/${rx.id}/dispense`, { storeId, lines: [{ prescriptionLineId: rx.lines[0].id, qty: 1 }] });
    expect(closed.statusCode).toBe(409);

    const events = await app.get(DbService).asTenant({ tenantId }, (tx) =>
      tx.execute<{ status: string }>(
        sql`select payload->>'status' as status from audit.outbox where topic = 'pharmacy.dispense.completed' and payload->>'prescriptionId' = ${prescriptionId} order by created_at`,
      ),
    );
    expect(events.rows.map((r) => r.status)).toEqual(['partial', 'dispensed']);
  });

  it('accepts paper prescriptions typed in at the counter and can cancel them', async () => {
    const res = await call(pharmacist, 'POST', '/prescriptions', { patientId, doctorName: 'Dr Outside', lines: [{ drugName: 'Amoxicillin 500', qty: 10 }] });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ source: 'manual', status: 'pending', doctorName: 'Dr Outside' });
    const cancel = await call(pharmacist, 'POST', `/prescriptions/${res.json().id}/cancel`);
    expect(cancel.json().status).toBe('cancelled');
  });
});

describe('pharmacy access control', () => {
  it('enforces permissions per role', async () => {
    const sale = await call(doctor, 'POST', '/sales', { storeId, lines: [{ itemId: randomUUID(), qty: 1 }] });
    expect(sale.statusCode).toBe(403);
    expect(sale.json().error.details.missing).toEqual(['pharmacy.sale.create']);
    const stock = await call(reception, 'GET', `/stock?storeId=${storeId}`);
    expect(stock.statusCode).toBe(403);
    const store = await call(pharmacist, 'POST', '/stores', { facilityId, code: `X${run}`, name: 'No' });
    expect(store.statusCode).toBe(403);
    const items = await call(doctor, 'GET', '/items');
    expect(items.statusCode).toBe(200);
  });

  it("never shows one hospital's pharmacy data to another", async () => {
    const item = await newItem();
    await stockUp(item.id, [{ batchNo: 'ISO', expiryDate: daysFromNow(200), mrp: 1, qty: 5 }]);
    const sale = (await call(pharmacist, 'POST', '/sales', { storeId, lines: [{ itemId: item.id, qty: 1 }] })).json();

    expect((await call(otherHospital, 'GET', `/items/${item.id}`)).statusCode).toBe(404);
    expect((await call(otherHospital, 'PATCH', `/items/${item.id}`, { name: 'Hacked' })).statusCode).toBe(404);
    expect((await call(otherHospital, 'GET', `/sales/${sale.id}`)).statusCode).toBe(404);
    const list = await call(otherHospital, 'GET', `/items?q=${encodeURIComponent(item.name)}`);
    expect(list.json().items).toEqual([]);
    const stores = await call(otherHospital, 'GET', '/stores');
    expect(stores.json().find((s: { id: string }) => s.id === storeId)).toBeUndefined();
    const useStore = await call(otherHospital, 'POST', '/stock/opening', {
      storeId,
      lines: [{ itemId: item.id, batchNo: 'X', expiryDate: daysFromNow(10), mrp: 1, qty: 1 }],
    });
    expect(useStore.statusCode).toBe(404);
    const sellMine = await call(otherHospital, 'POST', `/sales/${sale.id}/returns`, { lines: [{ saleLineId: sale.lines[0].id, qty: 1 }] });
    expect(sellMine.statusCode).toBe(404);

    const db = app.get(DbService);
    const pharmacy = app.get(PharmacyService);
    const mine = await db.asTenant({ tenantId }, (tx) => pharmacy.getStore(storeId, tx));
    expect(mine).toMatchObject({ id: storeId, facilityId, name: `Pharmacy ${run}`, type: expect.any(String), isActive: true });
    await expect(db.asTenant({ tenantId: randomUUID() }, (tx) => pharmacy.getStore(storeId, tx))).rejects.toThrow();
  });
});
