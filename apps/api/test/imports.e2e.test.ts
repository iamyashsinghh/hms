import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ImportResult } from '@hms/shared';
import { bearer, bootApp, login } from './helpers';

/** Bulk import from Excel / CSV across the masters that offer it. */
let app: NestFastifyApplication;
let admin: string;
let pharmacist: string;
let doctor: string;
let otherHospital: string;
let facilityId: string;
let storeId: string;
const run = Date.now().toString(36).toUpperCase().slice(-6);

const call = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload: payload as object });

async function importRows(token: string, url: string, rows: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  const res = await call(token, 'POST', url, { rows: rows.map((r, i) => ({ __row: i + 2, ...r })), ...extra });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as ImportResult;
}
const errorsOf = (r: ImportResult, row: number) => r.rows.find((x) => x.row === row)!.errors.map((e) => `${e.column ?? ''}: ${e.message}`);
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('/');

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  pharmacist = (await login(app, 'pharmacy@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  facilityId = (a.user as unknown as { facilities: { id: string }[] }).facilities[0]!.id;
  const store = await call(admin, 'POST', '/pharmacy/stores', { facilityId, code: `IM${run}`, name: `Import store ${run}` });
  expect(store.statusCode, store.body).toBe(201);
  storeId = store.json().id;
});
afterAll(() => app.close());

describe('drug import', () => {
  const code = (n: string) => `IMP${run}${n}`;

  it('previews per-row errors without saving anything', async () => {
    const res = await importRows(pharmacist, '/pharmacy/items/import', [
      { code: code('A'), name: 'Paracetamol 500', form: 'Tablet', gstRate: '12%', schedule: 'h1', packSize: '10' },
      { code: code('B'), name: '', gstRate: 7 },
      { code: code('A'), name: 'Duplicate of row 2' },
      { code: code('C'), name: 'Expired batch', batchNo: 'X1', expiryDate: '01/2020', mrp: 10, qty: 5 },
      { code: code('D'), name: 'Half a batch', batchNo: 'X2' },
      { code: code('E'), name: 'Bad cells', packSize: 'ten', form: 'pill', hsnCode: '12', expiryDate: '31/02/2027' },
    ], { dryRun: true, storeId });
    expect(res).toMatchObject({ dryRun: true, total: 6, created: 1, failed: 5 });
    expect(res.rows[0]).toMatchObject({ row: 2, key: code('A'), status: 'create' });
    expect(errorsOf(res, 3).join()).toMatch(/Name/);
    expect(errorsOf(res, 3).join()).toMatch(/GST %: Use one of/);
    expect(errorsOf(res, 4)).toEqual([': Duplicate of row 2 in this file']);
    expect(errorsOf(res, 5).join()).toMatch(/already expired/);
    expect(errorsOf(res, 6).join()).toMatch(/Expiry: Required when loading stock/);
    const bad = errorsOf(res, 7).join(' | ');
    expect(bad).toMatch(/Pack size: Enter a number/);
    expect(bad).toMatch(/Form: Use one of/);
    expect(bad).toMatch(/HSN/);
    expect(bad).toMatch(/Expiry: Enter a valid date/);

    const list = await call(pharmacist, 'GET', `/pharmacy/items?q=${code('A')}`);
    expect(list.json().total).toBe(0);
  });

  it('imports drugs with opening stock, then reports duplicates or updates them', async () => {
    const expiry = inDays(400);
    const rows = [
      { code: code('S1'), name: `Amoxicillin 500 ${run}`, form: 'capsule', gstRate: 12, hsnCode: 30041010, batchNo: 'AMX1', expiryDate: ddmmyyyy(expiry), mrp: '₹8.50', purchaseRate: 5, qty: 200 },
      { code: code('S2'), name: `Cetirizine 10 ${run}`, gstRate: '5', schedule: 'otc' },
    ];
    const res = await importRows(pharmacist, '/pharmacy/items/import', rows, { dryRun: false, storeId });
    expect(res).toMatchObject({ created: 2, failed: 0 });
    expect(res.rows.map((r) => r.status)).toEqual(['created', 'created']);

    const item = (await call(pharmacist, 'GET', `/pharmacy/items?q=${code('S1')}`)).json().items[0];
    expect(item).toMatchObject({ form: 'capsule', gstRate: 12, hsnCode: '30041010' });
    const batches = (await call(pharmacist, 'GET', `/pharmacy/stores/${storeId}/items/${item.id}/batches`)).json();
    expect(batches).toMatchObject([{ batchNo: 'AMX1', expiryDate: expiry, qty: 200, mrp: 8.5 }]);

    const again = await importRows(pharmacist, '/pharmacy/items/import', rows, { dryRun: true, storeId });
    expect(again.failed).toBe(2);
    expect(errorsOf(again, 2).join()).toMatch(/already exists/);

    // Update: only the filled cells change; blank cells keep their values.
    const upd = await importRows(pharmacist, '/pharmacy/items/import', [{ code: code('S1').toLowerCase(), name: `Amoxicillin 500mg ${run}`, reorderLevel: 50 }], {
      dryRun: false,
      updateExisting: true,
    });
    expect(upd).toMatchObject({ updated: 1, failed: 0 });
    const after = (await call(pharmacist, 'GET', `/pharmacy/items/${item.id}`)).json();
    expect(after).toMatchObject({ name: `Amoxicillin 500mg ${run}`, reorderLevel: 50, form: 'capsule', gstRate: 12 });
  });

  it('needs a store for stock rows, the manage permission, and stays inside the hospital', async () => {
    const stockRow = { code: code('N1'), name: 'No store', batchNo: 'B', expiryDate: inDays(100), mrp: 5, qty: 1 };
    const noStore = await importRows(pharmacist, '/pharmacy/items/import', [stockRow], { dryRun: true });
    expect(errorsOf(noStore, 2).join()).toMatch(/Choose a store/);

    expect((await call(doctor, 'POST', '/pharmacy/items/import', { rows: [{ code: 'X', name: 'X' }] })).statusCode).toBe(403);
    expect((await call(pharmacist, 'POST', '/pharmacy/items/import', { rows: [] })).statusCode).toBe(400);

    // The same code is free in another hospital.
    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/pharmacy/items/import',
      headers: bearer(otherHospital),
      payload: { rows: [{ code: code('S1'), name: 'Other hospital drug' }], dryRun: true },
    });
    if (other.statusCode !== 403) expect(other.json()).toMatchObject({ created: 1, failed: 0 });
  });
});

describe('other masters', () => {
  it('imports lab tests with a reference range', async () => {
    const c = `LT${run}`;
    const res = await importRows(admin, '/lab/tests/import', [
      { code: c, name: `Import Hb ${run}`, section: 'Haematology', unit: 'g/dL', price: 150, refLow: 12, refHigh: 16, criticalLow: 7 },
      { code: `${c}X`, name: 'Bad range', refLow: 10, refHigh: 5 },
      { code: `${c}O`, name: 'Option test', resultType: 'option', options: 'Positive' },
    ], { dryRun: false });
    expect(res).toMatchObject({ created: 1, failed: 2 });
    expect(errorsOf(res, 3).join()).toMatch(/Normal high/);
    expect(errorsOf(res, 4).join()).toMatch(/two options/);
    const tests = (await call(admin, 'GET', `/lab/tests?q=${c}`)).json() as { code: string; ranges: unknown[] }[];
    const t = tests.find((x) => x.code === c)!;
    expect(t.ranges).toMatchObject([{ gender: 'any', low: 12, high: 16, criticalLow: 7 }]);
  });

  it('imports radiology tests against a modality code', async () => {
    const m = await call(admin, 'POST', '/radiology/modalities', { code: `IM${run}`, name: `Import XR ${run}`, kind: 'XR' });
    expect(m.statusCode, m.body).toBe(201);
    const res = await importRows(admin, '/radiology/tests/import', [
      { code: `RT${run}`, name: 'Chest PA', modality: `im${run}`, price: 400, contrast: 'no' },
      { code: `RT${run}B`, name: 'Unknown modality', modality: 'NOPE', price: 1 },
      { code: `RT${run}C`, name: 'No price', modality: `IM${run}` },
    ], { dryRun: false });
    expect(res).toMatchObject({ created: 1, failed: 2 });
    expect(errorsOf(res, 3).join()).toMatch(/No active modality/);
    expect(errorsOf(res, 4).join()).toMatch(/price or a billing service code/);
  });

  it('imports billing services with GST slabs only', async () => {
    const res = await importRows(admin, '/billing/services/import', [
      { code: `SV${run}`, name: 'Dressing', category: 'procedure', basePrice: '1,200', taxRate: 18 },
      { code: `SV${run}B`, name: 'Bad GST', basePrice: 10, taxRate: 15 },
      { code: `SV${run}C`, name: 'Package', category: 'package', basePrice: 10 },
    ], { dryRun: false });
    expect(res).toMatchObject({ created: 1, failed: 2 });
    const svc = (await call(admin, 'GET', `/billing/services?q=SV${run}`)).json();
    expect(JSON.stringify(svc)).toContain('"basePrice":1200');
  });

  it('imports vendors with format checks', async () => {
    const res = await importRows(admin, '/inventory/vendors/import', [
      { code: `VN${run}`, name: 'Surgi Supplies', phone: 9876543210, gstin: '07aabcs1429b1zb' },
      { code: `VN${run}B`, name: 'Bad', email: 'not-an-email', gstin: '123' },
    ], { dryRun: false });
    expect(res).toMatchObject({ created: 1, failed: 1 });
    expect(errorsOf(res, 3).join()).toMatch(/GSTIN/);
  });

  it('imports beds into wards by ward code', async () => {
    const ward = await call(admin, 'POST', '/ipd/wards', { code: `IW${run}`, name: `Import ward ${run}`, defaultDailyRate: 1000 });
    expect(ward.statusCode, ward.body).toBe(201);
    const rows = [
      { ward: `IW${run}`, code: 'B1', roomNo: 101 },
      { ward: `iw${run}`, code: 'B2', dailyRate: 2000 },
      { ward: 'NOWARD', code: 'B3' },
    ];
    const res = await importRows(admin, '/ipd/beds/import', rows, { dryRun: false });
    expect(res).toMatchObject({ created: 2, failed: 1 });
    expect(errorsOf(res, 4).join()).toMatch(/No active ward/);
    const again = await importRows(admin, '/ipd/beds/import', rows.slice(0, 1), { dryRun: true });
    expect(errorsOf(again, 2).join()).toMatch(/already exists/);
  });

  it('imports staff with dates in Indian format', async () => {
    const res = await importRows(admin, '/hr/employees/import', [
      { employeeCode: `E${run}`, fullName: 'Anita Import', gender: 'Female', mobile: 9876543210, category: 'nurse', dateOfJoining: '01/04/2024', dateOfBirth: '15-08-1990' },
      { fullName: 'No joining date', mobile: '12345' },
    ], { dryRun: false });
    expect(res).toMatchObject({ created: 1, failed: 1 });
    expect(errorsOf(res, 3).join()).toMatch(/Date of joining: Required/);
    expect(errorsOf(res, 3).join()).toMatch(/Mobile/);
  });
});
