import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO_PASSWORD, provisionTenant } from '@hms/db';
import { EventBus } from '../src/common/events/event-bus';
import { hmacSha256 } from '../src/modules/integrations/crypto';
import { loadIntegrationsConfig } from '../src/modules/integrations/integrations.config';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let reception: string;
let doctor: string;
let nurse: string;
let billingClerk: string;
let cityAdmin: string;
/** A throwaway hospital on the growth plan (has integrations) used as the 'other hospital'. */
let otherAdmin: string;
let otherTenantId: string;
let tenantId: string;
let facilityId: string;

const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const config = loadIntegrationsConfig();
const OTHER = `intg-${run}`;

async function provisionOtherHospital() {
  const client = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const t = await provisionTenant(client, {
      code: OTHER,
      name: `Integrations Test Hospital ${run}`,
      plan: 'growth',
      facility: { code: 'MAIN', name: 'Main' },
      admin: { name: 'Other Admin', email: `admin@${OTHER}.test`, password: DEMO_PASSWORD },
    });
    await client.query('COMMIT');
    return t.tenantId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

type Res = Awaited<ReturnType<NestFastifyApplication['inject']>>;
async function call(token: string | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...(token ? bearer(token) : {}), ...(facilityId ? { 'x-facility-id': facilityId } : {}), ...headers },
    ...(payload !== undefined ? { payload: payload as object } : {}),
  });
}

async function newPatient(extra: Record<string, unknown> = {}) {
  const res = await call(reception, 'POST', '/patients', { firstName: 'Abha', lastName: `Tester${run}${Math.floor(Math.random() * 1e6)}`, gender: 'female', ageYears: 33, ...extra });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; uhid: string; abhaNumber: string | null };
}

/** Requests and verifies an ABHA OTP for the patient, then links it. */
async function linkAbha(patientId: string, identifier: string, method: 'aadhaar' | 'mobile' = 'aadhaar') {
  const otp = await call(reception, 'POST', '/integrations/abha/otp', { purpose: 'create', method, identifier, patientId });
  expect(otp.statusCode).toBe(201);
  const verified = await call(reception, 'POST', '/integrations/abha/otp/verify', { requestId: otp.json().id, otp: '123456' });
  expect(verified.statusCode).toBe(200);
  const link = await call(reception, 'POST', '/integrations/abha/links', { requestId: otp.json().id, patientId });
  expect(link.statusCode).toBe(201);
  return link.json() as { id: string; abhaNumber: string; abhaAddress: string };
}

const aadhaar = () => `${2 + Math.floor(Math.random() * 7)}${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`;

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  tenantId = (a.user as unknown as { tenantId: string }).tenantId;
  facilityId = (a.user as unknown as { facilities: { id: string }[] }).facilities[0].id;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  billingClerk = (await login(app, 'billing@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
  otherTenantId = await provisionOtherHospital();
  otherAdmin = (await login(app, `admin@${OTHER}.test`, OTHER)).accessToken;

  const s = await call(admin, 'PUT', '/integrations/settings', { abdmMode: 'mock', hfrId: 'IN0000DEMO', hipName: 'Demo Hospital', paymentProvider: 'mock' });
  expect(s.statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
});

describe('integrations: settings', () => {
  it('only admins change settings; staff can read them with callback URLs', async () => {
    expect((await call(reception, 'PUT', '/integrations/settings', { abdmMode: 'disabled', paymentProvider: 'none' })).statusCode).toBe(403);
    const res = await call(nurse, 'GET', '/integrations/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ abdmMode: 'mock', paymentProvider: 'mock', hfrId: 'IN0000DEMO' });
    expect(res.json().callbackUrls.abdmProfileShare).toContain(`/integrations/callbacks/abdm/${tenantId}/profile-share`);
  });

  it('ABDM calls fail cleanly in a hospital that has not switched ABDM on', async () => {
    const res = await call(otherAdmin, 'POST', '/integrations/abha/otp', { purpose: 'create', method: 'aadhaar', identifier: aadhaar() }, { 'x-facility-id': '' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('abdm_disabled');
  });

  it('is only available on plans that include integrations', async () => {
    const res = await call(cityAdmin, 'GET', '/integrations/settings', undefined, { 'x-facility-id': '' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });
});

describe('integrations: ABHA', () => {
  it('creates an ABHA by Aadhaar OTP without storing Aadhaar, and links it to the patient', async () => {
    const p = await newPatient();
    const id = aadhaar();
    const otp = await call(reception, 'POST', '/integrations/abha/otp', { purpose: 'create', method: 'aadhaar', identifier: id, patientId: p.id });
    expect(otp.statusCode).toBe(201);
    expect(otp.json()).toMatchObject({ status: 'otp_sent', identifierMasked: `********${id.slice(-4)}` });
    expect(JSON.stringify(otp.json())).not.toContain(id);

    const wrong = await call(reception, 'POST', '/integrations/abha/otp/verify', { requestId: otp.json().id, otp: '000000' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe('invalid_otp');

    const ok = await call(reception, 'POST', '/integrations/abha/otp/verify', { requestId: otp.json().id, otp: '123456' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().profile.abhaNumber).toMatch(/^91\d{12}$/);

    const link = await call(reception, 'POST', '/integrations/abha/links', { requestId: otp.json().id, patientId: p.id });
    expect(link.statusCode).toBe(201);
    expect(link.json()).toMatchObject({ patientId: p.id, status: 'linked', verifiedVia: 'aadhaar' });
    const patient = (await call(reception, 'GET', `/patients/${p.id}`)).json();
    expect(patient.abhaNumber).toBe(link.json().abhaNumber);

    // The same ABHA cannot be linked to a second patient record.
    const p2 = await newPatient();
    const again = await call(reception, 'POST', '/integrations/abha/links', { requestId: otp.json().id, patientId: p2.id });
    expect(again.statusCode).toBe(409);

    const unlink = await call(reception, 'POST', `/integrations/abha/links/${link.json().id}/unlink`, { reason: 'Wrong patient selected' });
    expect(unlink.json()).toMatchObject({ status: 'unlinked', unlinkReason: 'Wrong patient selected' });
  });

  it('enforces permissions: nurses can read links but not create ABHA', async () => {
    expect((await call(nurse, 'POST', '/integrations/abha/otp', { purpose: 'create', method: 'aadhaar', identifier: aadhaar() })).statusCode).toBe(403);
    expect((await call(nurse, 'GET', '/integrations/abha/links')).statusCode).toBe(200);
    expect((await call(billingClerk, 'GET', '/integrations/abha/links')).statusCode).toBe(403);
  });

  it('turns signed encounters of ABHA patients into linked care contexts', async () => {
    const p = await newPatient();
    await linkAbha(p.id, aadhaar());
    const encounterId = randomUUID();
    const bus = app.get(EventBus);
    const envelope = { id: randomUUID(), tenantId, topic: 'emr.encounter.signed', payload: { encounterId, patientId: p.id, doctorId: randomUUID() }, createdAt: new Date().toISOString() };
    await bus.dispatch(envelope);
    await bus.dispatch(envelope); // at-least-once delivery must not duplicate
    const list = (await call(reception, 'GET', `/integrations/abdm/care-contexts?patientId=${p.id}`)).json();
    expect(list.total).toBe(1);
    expect(list.items[0]).toMatchObject({ reference: `OPD-${encounterId}`, status: 'linked', sourceModule: 'emr', hiTypes: ['OPConsultation', 'Prescription'] });
  });
});

describe('integrations: Scan and Share', () => {
  it('rejects unsigned callbacks and queues signed ones as tokens', async () => {
    const body = { requestId: `share-${run}`, profile: { abhaNumber: `9155${run.slice(-10).padStart(10, '0')}`, name: 'Scan Patient', gender: 'male', yearOfBirth: 1985 } };
    const url = `/integrations/callbacks/abdm/${tenantId}/profile-share`;
    expect((await call(null, 'POST', url, body, { 'x-abdm-signature': 'bad' })).statusCode).toBe(401);
    const sig = hmacSha256(config.abdmCallbackSecret, JSON.stringify(body));
    const ok = await call(null, 'POST', url, body, { 'x-abdm-signature': sig });
    expect(ok.statusCode).toBe(202);
    expect(ok.json().tokenNo).toBeGreaterThan(0);
    // Same request again: same token.
    expect((await call(null, 'POST', url, body, { 'x-abdm-signature': sig })).json().tokenNo).toBe(ok.json().tokenNo);
  });

  it('registers a new patient from a simulated scan', async () => {
    const token = await call(reception, 'POST', '/integrations/abdm/scan-share/simulate', { name: `Meera Scan${run}`, gender: 'female', yearOfBirth: 1992 });
    expect(token.statusCode).toBe(201);
    expect(token.json().status).toBe('pending');
    const resolved = await call(reception, 'POST', `/integrations/abdm/scan-share/${token.json().id}/resolve`, { action: 'register' });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().status).toBe('registered');
    const patient = (await call(reception, 'GET', `/patients/${resolved.json().patientId}`)).json();
    expect(patient).toMatchObject({ firstName: 'Meera', abhaNumber: token.json().profile.abhaNumber });
    const twice = await call(reception, 'POST', `/integrations/abdm/scan-share/${token.json().id}/resolve`, { action: 'dismiss' });
    expect(twice.statusCode).toBe(409);
  });
});

describe('integrations: consents (HIU)', () => {
  it('lets a doctor request records for an ABHA patient and read them once granted', async () => {
    const p = await newPatient();
    await linkAbha(p.id, aadhaar());
    const created = await call(doctor, 'POST', '/integrations/abdm/consents', { patientId: p.id, purpose: 'CAREMGT', hiTypes: ['Prescription', 'DiagnosticReport'], dateFrom: '2025-01-01', dateTo: '2026-10-01' });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('requested');
    expect((await call(doctor, 'GET', `/integrations/abdm/consents/${created.json().id}/records`)).statusCode).toBe(409);
    const refreshed = await call(doctor, 'POST', `/integrations/abdm/consents/${created.json().id}/refresh`);
    expect(refreshed.json().status).toBe('granted');
    const records = await call(doctor, 'GET', `/integrations/abdm/consents/${created.json().id}/records`);
    expect(records.statusCode).toBe(200);
    expect(records.json()).toHaveLength(2);
    expect(records.json()[0].resourceType).toBe('Bundle');
  });

  it('needs a linked ABHA first, and reception cannot raise consents', async () => {
    const p = await newPatient();
    const body = { patientId: p.id, hiTypes: ['Prescription'], dateFrom: '2025-01-01', dateTo: '2025-12-31' };
    expect((await call(doctor, 'POST', '/integrations/abdm/consents', body)).json().error.code).toBe('no_abha_address');
    expect((await call(reception, 'POST', '/integrations/abdm/consents', body)).statusCode).toBe(403);
  });

  it('returns a FHIR Patient with the ABHA identifier', async () => {
    const p = await newPatient();
    const link = await linkAbha(p.id, aadhaar());
    const res = await call(doctor, 'GET', `/integrations/fhir/Patient/${p.id}`);
    expect(res.json()).toMatchObject({ resourceType: 'Patient', id: p.id, gender: 'female' });
    expect(JSON.stringify(res.json().identifier)).toContain(link.abhaAddress);
  });
});

describe('integrations: online payments', () => {
  async function finalInvoice(amount = 750) {
    const p = await newPatient();
    const res = await call(admin, 'POST', '/billing/invoices', { patientId: p.id, finalize: true, lines: [{ description: 'Online consult', unitPrice: amount, taxRate: 0 }] });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; total: number; patientId: string };
  }

  it('creates a payment link, captures it by webhook and posts the money to the bill', async () => {
    const inv = await finalInvoice();
    const created = await call(billingClerk, 'POST', '/integrations/payments', { invoiceId: inv.id });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ amount: inv.total, status: 'created', provider: 'mock' });
    expect((await call(billingClerk, 'POST', '/integrations/payments', { invoiceId: inv.id })).json().error.code).toBe('open_payment_link');

    const paid = await call(billingClerk, 'POST', `/integrations/payments/${created.json().id}/mock-complete`, { outcome: 'success' });
    expect(paid.statusCode).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'paid', settlementStatus: 'recorded' });
    const invoice = (await call(billingClerk, 'GET', `/billing/invoices/${inv.id}`)).json();
    expect(invoice.balance).toBe(0);
    expect(invoice.payments[0]).toMatchObject({ mode: 'upi', reference: paid.json().providerPaymentId });
  });

  it('rejects webhooks with a bad signature and ignores replays', async () => {
    const inv = await finalInvoice(300);
    const intent = (await call(billingClerk, 'POST', '/integrations/payments', { invoiceId: inv.id })).json();
    const url = `/integrations/callbacks/payments/mock/${tenantId}`;
    const body = { event: 'payment.captured', orderId: intent.providerOrderId, paymentId: `pay_${run}`, amount: 300, method: 'card', error: null };
    expect((await call(null, 'POST', url, body, { 'x-mock-signature': 'nope' })).statusCode).toBe(401);
    const sig = hmacSha256(config.mockPaymentWebhookSecret, JSON.stringify(body));
    expect((await call(null, 'POST', url, body, { 'x-mock-signature': sig })).json()).toEqual({ ok: true, matched: true });
    expect((await call(null, 'POST', url, body, { 'x-mock-signature': sig })).statusCode).toBe(200);
    const invoice = (await call(billingClerk, 'GET', `/billing/invoices/${inv.id}`)).json();
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].mode).toBe('card');
  });

  it('records failures and keeps the bill unpaid', async () => {
    const inv = await finalInvoice(200);
    const intent = (await call(billingClerk, 'POST', '/integrations/payments', { invoiceId: inv.id })).json();
    const failed = await call(billingClerk, 'POST', `/integrations/payments/${intent.id}/mock-complete`, { outcome: 'failure' });
    expect(failed.json()).toMatchObject({ status: 'failed', settlementStatus: 'pending' });
    expect((await call(billingClerk, 'GET', `/billing/invoices/${inv.id}`)).json().balance).toBe(200);
    expect((await call(nurse, 'GET', '/integrations/payments')).statusCode).toBe(403);
  });
});

describe('integrations: API keys, lab machines and webhooks', () => {
  let key: string;
  let keyId: string;
  let deviceCode: string;

  it('only admins manage API keys; the key is shown once and works for its scopes', async () => {
    expect((await call(reception, 'POST', '/integrations/api-keys', { name: 'x', scopes: ['patients.read'] })).statusCode).toBe(403);
    const created = await call(admin, 'POST', '/integrations/api-keys', { name: `LIS middleware ${run}`, scopes: ['lab.results.write'] });
    expect(created.statusCode).toBe(201);
    key = created.json().key;
    keyId = created.json().id;
    expect(key.startsWith(`hmsk.${tenantId}.`)).toBe(true);
    expect(JSON.stringify((await call(admin, 'GET', '/integrations/api-keys')).json())).not.toContain(key);

    const ping = await call(null, 'GET', '/integrations/public/v1/ping', undefined, { 'x-api-key': key });
    expect(ping.statusCode).toBe(200);
    expect(ping.json().scopes).toEqual(['lab.results.write']);
    expect((await call(null, 'GET', '/integrations/public/v1/ping')).statusCode).toBe(401);
    expect((await call(null, 'GET', '/integrations/public/v1/ping', undefined, { 'x-api-key': key.slice(0, -2) + 'xx' })).statusCode).toBe(401);
    const p = await newPatient();
    expect((await call(null, 'GET', `/integrations/public/v1/fhir/Patient/${p.id}`, undefined, { 'x-api-key': key })).statusCode).toBe(403);
  });

  it('accepts HL7 results from a registered machine, acks them and dedupes resends', async () => {
    deviceCode = `SYS${run.slice(-8)}`;
    expect((await call(admin, 'POST', '/integrations/devices', { code: deviceCode, name: 'Sysmex XN-550', model: 'XN-550' })).statusCode).toBe(201);
    const msg = [
      `MSH|^~\\&|SYSMEX|LAB|HMS|HOSP|20261007101500||ORU^R01|C${run}|P|2.5.1`,
      'PID|1||UH000123',
      `OBR|1|S${run}|S${run}|CBC`,
      'OBX|1|NM|HGB^Hemoglobin||9.1|g/dL|13.0-17.0|L|||F',
    ].join('\r');
    const res = await call(null, 'POST', '/integrations/public/v1/lab/hl7', { deviceCode, message: msg }, { authorization: `Bearer ${key}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'accepted', resultCount: 1, duplicate: false });
    expect(res.json().ack).toContain(`MSA|AA|C${run}`);
    const again = await call(null, 'POST', '/integrations/public/v1/lab/hl7', { deviceCode, message: msg }, { 'x-api-key': key });
    expect(again.json()).toMatchObject({ duplicate: true, messageId: res.json().messageId });

    const bad = await call(null, 'POST', '/integrations/public/v1/lab/hl7', { deviceCode, message: 'MSH|^~\\&|X|Y|||1||ADT^A01|Z1|P|2.5' }, { 'x-api-key': key });
    expect(bad.json()).toMatchObject({ status: 'rejected' });
    expect(bad.json().ack).toContain('MSA|AE|Z1');

    const lab = (await login(app, 'lab@demo.hms')).accessToken;
    const log = await call(lab, 'GET', `/integrations/devices/messages?sampleId=S${run}`);
    expect(log.json().items[0].results[0]).toMatchObject({ code: 'HGB', value: '9.1', flag: 'L' });
    expect((await call(lab, 'POST', '/integrations/devices', { code: 'LABX', name: 'Nope' })).statusCode).toBe(403);
  });

  it('stops accepting a revoked key', async () => {
    expect((await call(admin, 'POST', `/integrations/api-keys/${keyId}/revoke`)).json().revokedAt).toBeTruthy();
    expect((await call(null, 'GET', '/integrations/public/v1/ping', undefined, { 'x-api-key': key })).statusCode).toBe(401);
  });

  it('fans subscribed events out to webhooks in dry-run mode, once per event', async () => {
    const ep = await call(admin, 'POST', '/integrations/webhooks', { url: 'https://example.invalid/hms-hook', events: ['core.patient.registered'], description: `test ${run}` });
    expect(ep.statusCode).toBe(201);
    expect(ep.json().secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await call(admin, 'GET', '/integrations/webhooks')).json())).not.toContain(ep.json().secret);

    const event = { id: randomUUID(), tenantId, topic: 'core.patient.registered', payload: { patientId: randomUUID(), uhid: 'UH999999' }, createdAt: new Date().toISOString() };
    await app.get(EventBus).dispatch(event);
    await app.get(EventBus).dispatch(event);
    const deliveries = (await call(admin, 'GET', `/integrations/webhooks/deliveries?endpointId=${ep.json().id}`)).json();
    expect(deliveries.total).toBe(1);
    expect(deliveries.items[0]).toMatchObject({ status: 'delivered', dryRun: true, topic: 'core.patient.registered', eventId: event.id });

    const test = await call(admin, 'POST', `/integrations/webhooks/${ep.json().id}/test`);
    expect(test.json()).toMatchObject({ topic: 'integrations.webhook.test', status: 'delivered' });
    expect((await call(admin, 'POST', '/integrations/webhooks', { url: 'http://example.com/x', events: ['core.patient.registered'] })).statusCode).toBe(400);
  });
});

describe('integrations: hospital isolation', () => {
  it('another hospital sees none of these records', async () => {
    const city = (t: string, url: string) => call(t, 'GET', url, undefined, { 'x-facility-id': '' });
    const demoLinks = (await call(reception, 'GET', '/integrations/abha/links?status=all')).json();
    expect(demoLinks.total).toBeGreaterThan(0);
    const cityLinks = (await city(otherAdmin, '/integrations/abha/links?status=all')).json();
    expect(cityLinks.items.map((l: { id: string }) => l.id)).not.toContain(demoLinks.items[0].id);

    const demoPayments = (await call(billingClerk, 'GET', '/integrations/payments')).json();
    expect((await city(otherAdmin, `/integrations/payments/${demoPayments.items[0].id}`)).statusCode).toBe(404);
    const demoMsgs = (await call(admin, 'GET', '/integrations/devices/messages')).json();
    expect((await city(otherAdmin, `/integrations/devices/messages/${demoMsgs.items[0].id}`)).statusCode).toBe(404);
    expect((await city(otherAdmin, '/integrations/settings')).json().abdmMode).toBe('disabled');
  });

  it('a key cannot be replayed against another hospital by editing its tenant id', async () => {
    const k = (await call(admin, 'POST', '/integrations/api-keys', { name: `iso ${run}`, scopes: ['patients.read'] })).json().key as string;
    const forged = k.replace(tenantId, otherTenantId);
    expect((await call(null, 'GET', '/integrations/public/v1/ping', undefined, { 'x-api-key': forged })).statusCode).toBe(401);
    // Callbacks for a hospital that has ABDM off look like an unknown hospital.
    const body = { requestId: `x-${run}`, profile: { abhaNumber: '91000000000001', name: 'X' } };
    const sig = hmacSha256(config.abdmCallbackSecret, JSON.stringify(body));
    expect((await call(null, 'POST', `/integrations/callbacks/abdm/${otherTenantId}/profile-share`, body, { 'x-abdm-signature': sig })).statusCode).toBe(404);
  });
});

describe('editing a lab device', () => {
  it('keeps a deactivated device inactive when only its name changes', async () => {
    const code = `EDIT${run}`.slice(0, 20).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const dev = (await call(admin, 'POST', '/integrations/devices', { code, name: 'Analyser A', model: 'A-1' })).json();
    const off = await call(admin, 'PATCH', `/integrations/devices/${dev.id}`, { isActive: false });
    expect(off.statusCode, off.body).toBe(200);
    const renamed = (await call(admin, 'PATCH', `/integrations/devices/${dev.id}`, { name: 'Analyser A (bench 2)' })).json();
    expect(renamed).toMatchObject({ name: 'Analyser A (bench 2)', isActive: false, model: 'A-1' });
    expect((await call(admin, 'PATCH', `/integrations/devices/${dev.id}`, { name: 'x' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/integrations/devices/${dev.id}`, { name: 'Nope nope' })).statusCode).toBe(403);
  });
});
