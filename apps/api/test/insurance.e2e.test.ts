import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let clerk: string;
let owner: string;
let doctor: string;
let nurse: string;
let reception: string;
let otherHospital: string;
let tenantId: string;
let facilityId: string;
let patientId: string;
let insurerId: string;
let tpaId: string;
let schemeId: string;
let policyId: string;
let preauthId: string;
let claimId: string;
const invoices: string[] = [];
const tag = Date.now().toString(36).toUpperCase();
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);

async function bill(amount: number, payerId?: string): Promise<string> {
  const res = await call(clerk, 'POST', '/billing/invoices', {
    patientId,
    payerId,
    finalize: true,
    lines: [{ description: `Room and procedure ${tag}`, unitPrice: amount, taxRate: 0 }],
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id;
}

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  owner = (await login(app, 'owner@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  nurse = (await login(app, 'nurse@demo.hms')).accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  otherHospital = (await login(app, 'admin@city.hms', 'city')).accessToken;
  const p = await call(admin, 'POST', '/patients', { firstName: 'Insa', lastName: `Claimant${tag}`, gender: 'female', ageYears: 52, mobile: '9876511111' });
  expect(p.statusCode, p.body).toBe(201);
  patientId = p.json().id;
});
afterAll(() => app.close());

describe('payers and packages', () => {
  it('creates an insurer, a TPA and a PM-JAY scheme payer', async () => {
    const insurer = await call(admin, 'POST', '/insurance/payers', { code: `STAR-${tag}`, name: `Star Health ${tag}`, type: 'insurer', tdsPercent: 10, copayPercent: 10 });
    expect(insurer.statusCode, insurer.body).toBe(201);
    insurerId = insurer.json().id;
    expect(insurer.json()).toMatchObject({ type: 'insurer', creditDays: 30, tdsPercent: 10, copayPercent: 10, preauthRequired: true });

    const tpa = await call(admin, 'POST', '/insurance/payers', { code: `MEDI-${tag}`, name: `Medi Assist ${tag}`, type: 'tpa', creditDays: 45 });
    expect(tpa.statusCode, tpa.body).toBe(201);
    tpaId = tpa.json().id;

    const noScheme = await call(admin, 'POST', '/insurance/payers', { code: `GOV-${tag}`, name: 'Some scheme', type: 'government' });
    expect(noScheme.statusCode).toBe(400);
    const scheme = await call(admin, 'POST', '/insurance/payers', { code: `PMJAY-${tag}`, name: `PM-JAY ${tag}`, type: 'government', scheme: 'pmjay' });
    expect(scheme.statusCode, scheme.body).toBe(201);
    schemeId = scheme.json().id;

    expect((await call(admin, 'POST', '/insurance/payers', { code: `STAR-${tag}`, name: 'Again', type: 'insurer' })).statusCode).toBe(409);
  });

  it('keeps scheme packages per payer', async () => {
    const pkg = await call(admin, 'POST', `/insurance/payers/${schemeId}/packages`, { code: 'SG039A', name: 'Appendicectomy (open)', specialty: 'General surgery', rate: 22800, losDays: 3 });
    expect(pkg.statusCode, pkg.body).toBe(201);
    expect((await call(admin, 'POST', `/insurance/payers/${schemeId}/packages`, { code: 'SG039A', name: 'Dup', rate: 1 })).statusCode).toBe(409);
    const off = await call(admin, 'PATCH', `/insurance/payers/${schemeId}/packages/${pkg.json().id}`, { isActive: false });
    expect(off.json().isActive).toBe(false);
    expect((await call(reception, 'GET', `/insurance/payers/${schemeId}/packages`)).json()).toEqual([]);
    expect((await call(reception, 'GET', `/insurance/payers/${schemeId}/packages?all=true`)).json()).toHaveLength(1);
    const list = (await call(reception, 'GET', `/insurance/payers?q=${tag}`)).json();
    expect(list.total).toBe(3);
  });
});

describe('policies', () => {
  it('records a policy with an insurer and a TPA, and checks eligibility', async () => {
    const asTpa = await call(reception, 'POST', '/insurance/policies', { patientId, payerId: tpaId, policyNumber: `P-${tag}` });
    expect(asTpa.statusCode).toBe(400);
    expect(asTpa.json().error.code).toBe('payer_is_tpa');

    const res = await call(reception, 'POST', '/insurance/policies', {
      patientId,
      payerId: insurerId,
      tpaId,
      policyNumber: `P-${tag}`,
      memberId: `M-${tag}`,
      validFrom: yearAgo,
      validTo: nextYear,
      sumInsured: 100000,
    });
    expect(res.statusCode, res.body).toBe(201);
    policyId = res.json().id;
    expect(res.json()).toMatchObject({ patientName: `Insa Claimant${tag}`, claimPayerId: tpaId, tpaName: `Medi Assist ${tag}`, balanceSumInsured: 100000 });
    expect((await call(reception, 'POST', '/insurance/policies', { patientId, payerId: insurerId, policyNumber: `P-${tag}` })).statusCode).toBe(409);

    const ok = await call(reception, 'POST', `/insurance/policies/${policyId}/verify`);
    expect(ok.json()).toMatchObject({ eligible: true, reasons: [] });

    const old = await call(reception, 'POST', '/insurance/policies', { patientId, payerId: insurerId, policyNumber: `OLD-${tag}`, validFrom: '2020-01-01', validTo: '2021-01-01' });
    const expired = await call(reception, 'POST', `/insurance/policies/${old.json().id}/verify`);
    expect(expired.json().eligible).toBe(false);
    expect(expired.json().reasons[0]).toContain('ended');

    const mine = (await call(doctor, 'GET', `/insurance/policies?patientId=${patientId}`)).json();
    expect(mine.total).toBe(2);
  });
});

describe('pre-authorisation', () => {
  it('runs draft → submitted → query → approved → enhancement → approved', async () => {
    const res = await call(clerk, 'POST', '/insurance/preauths', {
      policyId,
      diagnosis: 'Acute appendicitis',
      icdCodes: ['K35.8'],
      procedure: 'Laparoscopic appendicectomy',
      expectedLosDays: 3,
      estimatedAmount: 30000,
    });
    expect(res.statusCode, res.body).toBe(201);
    preauthId = res.json().id;
    expect(res.json()).toMatchObject({ number: expect.stringMatching(/^PA\d{6}$/), status: 'draft', payerId: tpaId, requestedAmount: 30000 });

    const step = async (path: string, body: unknown, status: string) => {
      const r = await call(clerk, 'POST', `/insurance/preauths/${preauthId}/${path}`, body);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().status).toBe(status);
      return r.json();
    };
    expect((await call(clerk, 'POST', `/insurance/preauths/${preauthId}/approve`, { approvedAmount: 1 })).statusCode).toBe(409);
    await step('submit', {}, 'submitted');
    await step('query', { note: 'Send USG report' }, 'query');
    await step('submit', { note: 'USG attached' }, 'submitted');
    expect((await call(clerk, 'POST', `/insurance/preauths/${preauthId}/approve`, { approvedAmount: 40000 })).statusCode).toBe(400);
    await step('approve', { approvedAmount: 25000, payerRef: `AUTH-${tag}` }, 'approved');
    await step('enhance', { requestedAmount: 50000, note: 'Converted to open surgery' }, 'submitted');
    const final = await step('approve', { approvedAmount: 45000 }, 'approved');
    expect(final.approvedAmount).toBe(45000);
    expect(final.payerRef).toBe(`AUTH-${tag}`);
    expect(final.history.map((h: { action: string }) => h.action)).toEqual([
      'created', 'submitted', 'query_raised', 'query_answered', 'approved', 'enhancement_requested', 'approved',
    ]);
    expect(final.history[1].byName).toBeTruthy();
  });

  it('keeps the history append-only in the database', async () => {
    const db = app.get(DbService);
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`update insurance.case_events set note = 'x' where entity_id = ${preauthId}`))).rejects.toThrow();
  });
});

describe('claims and settlement', () => {
  it('prepares a claim from final bills with co-pay, within the pre-auth', async () => {
    invoices.push(await bill(20000, tpaId), await bill(10000, tpaId));
    const res = await call(clerk, 'POST', '/insurance/claims', {
      policyId,
      preauthId,
      invoices: invoices.map((invoiceId) => ({ invoiceId })),
      admissionDate: today,
      dischargeDate: today,
    });
    expect(res.statusCode, res.body).toBe(201);
    const c = res.json();
    claimId = c.id;
    // 10% co-pay from the insurer: 18,000 + 9,000.
    expect(c).toMatchObject({ number: expect.stringMatching(/^CLM\d{6}$/), status: 'draft', claimedAmount: 27000, payerId: tpaId, preauthNumber: expect.any(String) });
    expect(c.invoices.map((i: { payerAmount: number }) => i.payerAmount)).toEqual([18000, 9000]);
    expect(c.documents.filter((d: { required: boolean }) => d.required).length).toBeGreaterThanOrEqual(5);

    const split = (await call(reception, 'GET', `/insurance/invoices/${invoices[0]}/split`)).json();
    expect(split).toMatchObject({ claimId, payerAmount: 18000, patientAmount: 2000, payerOutstanding: 18000, patientDue: 2000 });

    const again = await call(clerk, 'POST', '/insurance/claims', { policyId, invoices: [{ invoiceId: invoices[0] }] });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('invoice_already_claimed');

    const tooMuch = await call(clerk, 'PATCH', `/insurance/claims/${claimId}`, { invoices: [{ invoiceId: invoices[1], payerAmount: 10001 }] });
    expect(tooMuch.statusCode).toBe(400);
  });

  it('will not submit until required documents are in', async () => {
    const res = await call(clerk, 'POST', `/insurance/claims/${claimId}/submit`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('documents_missing');
    const claim = (await call(clerk, 'GET', `/insurance/claims/${claimId}`)).json();
    for (const d of claim.documents.filter((x: { required: boolean }) => x.required)) {
      const r = await call(clerk, 'PATCH', `/insurance/claims/${claimId}/documents/${d.id}`, { received: true });
      expect(r.statusCode, r.body).toBe(200);
    }
    const ok = await call(clerk, 'POST', `/insurance/claims/${claimId}/submit`, { payerRef: `TPA-${tag}` });
    expect(ok.statusCode, ok.body).toBe(200);
    // Claim goes to the TPA, whose credit period is 45 days.
    expect(ok.json()).toMatchObject({ status: 'submitted', payerClaimNo: `TPA-${tag}`, outstanding: 27000 });
    expect(ok.json().dueDate > today).toBe(true);
  });

  it('only finance roles record settlements', async () => {
    const approve = await call(clerk, 'POST', `/insurance/claims/${claimId}/approve`, { approvedAmount: 25000 });
    expect(approve.statusCode, approve.body).toBe(200);
    const res = await call(clerk, 'POST', `/insurance/claims/${claimId}/settlements`, { settledOn: today, reference: 'UTR1', amountPaid: 1 });
    expect(res.statusCode).toBe(403);
    const over = await call(admin, 'POST', `/insurance/claims/${claimId}/settlements`, { settledOn: today, reference: 'UTR1', amountPaid: 25001 });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe('over_settlement');
  });

  it('settles with TDS and deductions and posts receipts and credit notes to billing', async () => {
    const res = await call(admin, 'POST', `/insurance/claims/${claimId}/settlements`, {
      settledOn: today,
      reference: `UTR${tag}`,
      amountPaid: 20000,
      tdsAmount: 2000,
      deductions: [
        { category: 'non_payable', reason: 'Consumables', amount: 1500, recoverFromPatient: true },
        { category: 'tariff_difference', reason: 'Above agreed tariff', amount: 1500 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const c = res.json();
    expect(c).toMatchObject({ status: 'settled', settledAmount: 20000, tdsAmount: 2000, deductionAmount: 3000, writeOffAmount: 1500, patientRecoveryAmount: 1500, outstanding: 0 });
    const s = c.settlements[0];
    expect(s.postingStatus).toBe('posted');
    expect(s.postings.filter((p: { kind: string }) => p.kind !== 'recovery').every((p: { billingRef: string }) => /^(RCP|CN)\d{6}$/.test(p.billingRef))).toBe(true);

    // Billing now shows the payer's money and the write-off on the bills.
    const inv1 = (await call(clerk, 'GET', `/billing/invoices/${invoices[0]}`)).json();
    const inv2 = (await call(clerk, 'GET', `/billing/invoices/${invoices[1]}`)).json();
    expect(inv1.paidAmount).toBe(18000);
    expect(inv1.balance).toBe(2000);
    expect(inv1.payments.map((p: { mode: string }) => p.mode)).toEqual(['insurance']);
    expect(inv2.paidAmount).toBe(4000); // 2,000 money + 2,000 TDS
    expect(inv2.creditedAmount).toBe(1500);
    expect(inv2.balance).toBe(4500); // co-pay 1,000 + recovery 1,500 + 2,000 not approved

    const split = (await call(clerk, 'GET', `/insurance/invoices/${invoices[1]}/split`)).json();
    expect(split).toMatchObject({ claimStatus: 'settled', payerOutstanding: 0, patientDue: 4500 });

    // Retrying a posted settlement changes nothing in billing.
    const again = await call(admin, 'POST', `/insurance/settlements/${s.id}/post`);
    expect(again.statusCode, again.body).toBe(200);
    expect((await call(clerk, 'GET', `/billing/invoices/${invoices[1]}`)).json().balance).toBe(4500);

    const closed = await call(admin, 'POST', `/insurance/claims/${claimId}/settlements`, { settledOn: today, reference: 'UTR2', amountPaid: 1 });
    expect(closed.statusCode).toBe(409);
    expect((await call(clerk, 'POST', `/insurance/claims/${claimId}/cancel`, { note: 'oops' })).statusCode).toBe(409);
  });

  it('frees a bill when its claim is cancelled, and counts receivables by payer', async () => {
    const inv3 = await bill(5000, tpaId);
    const draft = await call(clerk, 'POST', '/insurance/claims', { policyId, claimType: 'credit', invoices: [{ invoiceId: inv3, payerAmount: 5000 }] });
    expect(draft.statusCode, draft.body).toBe(201);
    expect((await call(clerk, 'POST', `/insurance/claims/${draft.json().id}/cancel`, { note: 'Wrong policy' })).json().status).toBe('cancelled');
    expect((await call(clerk, 'GET', `/insurance/invoices/${inv3}/split`)).json()).toMatchObject({ claimId: null, patientDue: 5000 });

    const live = await call(clerk, 'POST', '/insurance/claims', { policyId, claimType: 'credit', invoices: [{ invoiceId: inv3, payerAmount: 5000 }] });
    expect(live.statusCode, live.body).toBe(201);
    for (const d of live.json().documents.filter((x: { required: boolean }) => x.required)) {
      await call(clerk, 'PATCH', `/insurance/claims/${live.json().id}/documents/${d.id}`, { received: true });
    }
    expect((await call(clerk, 'POST', `/insurance/claims/${live.json().id}/submit`, {})).statusCode).toBe(200);

    const summary = await call(owner, 'GET', '/insurance/summary');
    expect(summary.statusCode, summary.body).toBe(200);
    const row = summary.json().byPayer.find((p: { payerId: string }) => p.payerId === tpaId);
    expect(row).toMatchObject({ openClaims: 1, outstanding: 5000, ageing: { d0_30: 5000 } });
    expect(summary.json().claims.settled).toBeGreaterThanOrEqual(1);

    const policy = (await call(clerk, 'GET', `/insurance/policies/${policyId}`)).json();
    expect(policy.balanceSumInsured).toBe(100000 - 22000 - 5000);
  });
});

describe('permissions and isolation', () => {
  it('enforces insurance permissions', async () => {
    expect((await call(nurse, 'GET', '/insurance/payers')).statusCode).toBe(403);
    expect((await call(doctor, 'POST', '/insurance/claims', { policyId, invoices: [{ invoiceId: invoices[0] }] })).statusCode).toBe(403);
    expect((await call(reception, 'POST', '/insurance/payers', { code: `X-${tag}`, name: 'Nope', type: 'insurer' })).statusCode).toBe(403);
    expect((await call(clerk, 'GET', '/insurance/summary')).statusCode).toBe(403);
    expect((await call(doctor, 'GET', `/insurance/preauths/${preauthId}`)).statusCode).toBe(200);
  });

  it("never shows one hospital's insurance data to another", async () => {
    const other = (path: string, method = 'GET', payload?: unknown) =>
      app.inject({ method, url: `/api/v1${path}`, headers: bearer(otherHospital), payload } as Inject);
    expect((await other(`/insurance/claims/${claimId}`)).statusCode).toBe(404);
    expect((await other(`/insurance/preauths/${preauthId}`)).statusCode).toBe(404);
    expect((await other(`/insurance/policies/${policyId}`)).statusCode).toBe(404);
    expect((await other(`/insurance/payers/${insurerId}`)).statusCode).toBe(404);
    expect((await other(`/insurance/payers?q=${tag}`)).json().items).toEqual([]);
    expect((await other(`/insurance/claims?q=${tag}`)).json().items).toEqual([]);
    expect((await other(`/insurance/policies`, 'POST', { patientId, payerId: insurerId, policyNumber: 'X' })).statusCode).toBe(404);
    expect((await other(`/insurance/claims/${claimId}/settlements`, 'POST', { settledOn: today, reference: 'UTR', amountPaid: 1 })).statusCode).toBe(404);
  });
});
