import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { pickRule } from '../src/modules/crm/referrals.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let reception: string;
let clerk: string;
let accountant: string | null = null;
let doctor: string;
let owner: string;
let cityAdmin: string;
let tenantId: string;
let cityTenantId: string;
let facilityId: string;
const tag = Date.now().toString(36).toUpperCase();
const uniqueMobile = (n: number) => `8${String(Date.now() + n).slice(-9)}`;

type Inject = Parameters<NestFastifyApplication['inject']>[0];
const call = (token: string, method: string, url: string, payload?: unknown) =>
  app.inject({ method, url: `/api/v1${url}`, headers: { ...bearer(token), 'x-facility-id': facilityId }, payload } as Inject);

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Runs the worker side: dispatches this module's outbox events for one record to the EventBus handlers. */
async function dispatch(topic: string, key: string, value: string) {
  const db = app.get(DbService);
  const rows = await db.asTenant({ tenantId }, async (tx) => {
    const r = await tx.execute<{ id: string; payload: Record<string, unknown>; created_at: string }>(
      sql`select id, payload, created_at from audit.outbox where topic = ${topic} and payload->>${key} = ${value}`,
    );
    return r.rows;
  });
  expect(rows.length, `${topic} for ${value}`).toBeGreaterThan(0);
  for (const r of rows) {
    await app.get(EventBus).dispatch({ id: r.id, tenantId, topic, payload: r.payload, createdAt: new Date(r.created_at).toISOString() });
  }
}

async function crmMessages(refId: string) {
  return app.get(DbService).asTenant({ tenantId }, async (tx) => {
    const r = await tx.execute<{ status: string; channel: string; body: string; recipient: string | null }>(
      sql`select status, channel, body, recipient from comms.messages where source_module = 'crm' and source_ref = ${refId}`,
    );
    return r.rows;
  });
}

beforeAll(async () => {
  app = await bootApp();
  admin = (await login(app, 'admin@demo.hms')).accessToken;
  const me = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) })).json();
  tenantId = me.tenantId;
  facilityId = me.facilities[0].id;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  clerk = (await login(app, 'billing@demo.hms')).accessToken;
  doctor = (await login(app, 'doctor@demo.hms')).accessToken;
  owner = (await login(app, 'owner@demo.hms')).accessToken;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
  cityTenantId = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(cityAdmin) })).json().tenantId;
  accountant = await login(app, 'accounts@demo.hms').then((r) => r.accessToken).catch(() => null);
});
afterAll(() => app.close());

describe('leads (enquiries)', () => {
  let leadId: string;

  it('captures an enquiry with the next LD number', async () => {
    const res = await call(reception, 'POST', '/crm/leads', {
      name: `Sita ${tag}`,
      mobile: uniqueMobile(1),
      source: 'phone',
      interest: 'Knee replacement',
      gender: 'female',
      ageYears: 58,
    });
    expect(res.statusCode, res.body).toBe(201);
    const lead = res.json();
    expect(lead.number).toMatch(/^LD\d{6}$/);
    expect(lead.status).toBe('new');
    leadId = lead.id;

    const list = await call(reception, 'GET', `/crm/leads?q=${encodeURIComponent(`sita ${tag}`.toLowerCase())}`);
    expect(list.json().items.map((x: { id: string }) => x.id)).toEqual([leadId]);
  });

  it('needs a mobile or an email', async () => {
    const res = await call(reception, 'POST', '/crm/leads', { name: 'No contact' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
  });

  it('logs a call, moves the lead to contacted and shows it as due', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await call(reception, 'POST', `/crm/leads/${leadId}/activities`, { type: 'call', note: 'Asked for package price', nextFollowUpAt: past });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().status).toBe('contacted');
    expect(res.json().activities.map((a: { type: string }) => a.type)).toEqual(expect.arrayContaining(['call', 'status_change']));
    const due = await call(reception, 'GET', '/crm/leads?due=true&pageSize=200');
    expect(due.json().items.map((x: { id: string }) => x.id)).toContain(leadId);
  });

  it('closes as lost with a reason and can be reopened', async () => {
    const noReason = await call(reception, 'POST', `/crm/leads/${leadId}/lose`, {});
    expect(noReason.statusCode).toBe(400);
    const lost = await call(reception, 'POST', `/crm/leads/${leadId}/lose`, { reason: 'Went elsewhere' });
    expect(lost.json()).toMatchObject({ status: 'lost', lostReason: 'Went elsewhere' });
    const blocked = await call(reception, 'POST', `/crm/leads/${leadId}/activities`, { type: 'call', note: 'x' });
    expect(blocked.statusCode).toBe(409);
    const reopened = await call(reception, 'POST', `/crm/leads/${leadId}/reopen`);
    expect(reopened.json().status).toBe('contacted');
  });

  it('enforces permissions: a doctor cannot see enquiries, the owner cannot edit them', async () => {
    expect((await call(doctor, 'GET', '/crm/leads')).statusCode).toBe(403);
    const res = await call(owner, 'POST', '/crm/leads', { name: 'X', mobile: '9999999999' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.details.missing).toEqual(['crm.lead.manage']);
    expect((await call(owner, 'GET', '/crm/dashboard')).statusCode).toBe(200);
  });
});

describe('referrals and commission', () => {
  let referrerId: string;
  let leadId: string;
  let patientId: string;
  let invoiceId: string;
  let statementId: string;

  it('adds a referring doctor and a commission rule', async () => {
    const r = await call(admin, 'POST', '/crm/referrers', { type: 'doctor', name: `Dr. Ref ${tag}`, mobile: uniqueMobile(2), city: 'Pune', pan: 'abcde1234f' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().code).toMatch(/^RF\d{5}$/);
    expect(r.json().pan).toBe('ABCDE1234F');
    referrerId = r.json().id;

    const bad = await call(admin, 'POST', '/crm/commission-rules', { referrerId, rateType: 'percent', rate: 120 });
    expect(bad.statusCode).toBe(400);
    const rule = await call(admin, 'POST', '/crm/commission-rules', { referrerId, appliesTo: 'all', rateType: 'percent', rate: 10 });
    expect(rule.statusCode, rule.body).toBe(201);
    expect(rule.json()).toMatchObject({ referrerName: `Dr. Ref ${tag}`, rate: 10, effectiveFrom: today() });

    expect((await call(reception, 'POST', '/crm/referrers', { name: 'Nope' })).statusCode).toBe(403);
  });

  it('converts a referred enquiry into a patient and starts the referral', async () => {
    const lead = await call(reception, 'POST', '/crm/leads', { name: `Ramesh ${tag}`, mobile: uniqueMobile(3), source: 'referral', referrerId });
    expect(lead.statusCode, lead.body).toBe(201);
    leadId = lead.json().id;
    const res = await call(reception, 'POST', `/crm/leads/${leadId}/convert`, {
      register: { firstName: 'Ramesh', lastName: `Ref${tag}`, gender: 'male', ageYears: 50 },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().status).toBe('converted');
    patientId = res.json().patientId;
    expect(patientId).toBeTruthy();

    const again = await call(reception, 'POST', `/crm/leads/${leadId}/convert`, { patientId });
    expect(again.statusCode).toBe(409);

    const refs = (await call(admin, 'GET', `/crm/referrals?referrerId=${referrerId}`)).json();
    expect(refs.items).toHaveLength(1);
    expect(refs.items[0]).toMatchObject({ patientId, leadId, referredOn: today(), status: 'active' });
    expect(refs.items[0].validUntil > today()).toBe(true);
  });

  it('accrues commission when the patient is billed (billing.invoice.finalized), once', async () => {
    const inv = await call(clerk, 'POST', '/billing/invoices', {
      patientId,
      finalize: true,
      lines: [{ description: `Knee X-ray ${tag}`, unitPrice: 1000 }, { description: 'Dressing', unitPrice: 250 }],
    });
    expect(inv.statusCode, inv.body).toBe(201);
    invoiceId = inv.json().id;

    await dispatch('billing.invoice.finalized', 'invoiceId', invoiceId);
    await dispatch('billing.invoice.finalized', 'invoiceId', invoiceId); // at-least-once delivery

    const list = (await call(admin, 'GET', `/crm/commissions?referrerId=${referrerId}`)).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ kind: 'accrual', invoiceId, baseAmount: 1250, amount: 125, status: 'open', statementId: null });
    expect(list.items[0].breakdown.map((l: { commission: number }) => l.commission)).toEqual([100, 25]);

    const ref = (await call(admin, 'GET', `/crm/referrers/${referrerId}`)).json();
    expect(ref).toMatchObject({ referralCount: 1, openCommission: 125, payableCommission: 0 });
  });

  it('ignores bills for patients without a live referral', async () => {
    const p = await call(reception, 'POST', '/patients', { firstName: 'Walkin', lastName: tag, gender: 'female', ageYears: 30 });
    const inv = await call(clerk, 'POST', '/billing/invoices', { patientId: p.json().id, finalize: true, lines: [{ description: 'Consult', unitPrice: 500 }] });
    await dispatch('billing.invoice.finalized', 'invoiceId', inv.json().id);
    const list = (await call(admin, 'GET', `/crm/commissions?pageSize=200`)).json();
    expect(list.items.find((c: { invoiceId: string }) => c.invoiceId === inv.json().id)).toBeUndefined();
  });

  it('bills the commission on a statement, approves and pays it; paid statements are final', async () => {
    const accounts = accountant ?? admin;
    const empty = await call(accounts, 'POST', '/crm/statements', { referrerId, periodFrom: '2020-01-01', periodTo: '2020-01-31' });
    expect(empty.statusCode).toBe(409);

    const st = await call(accounts, 'POST', '/crm/statements', { referrerId, periodFrom: today(), periodTo: today() });
    expect(st.statusCode, st.body).toBe(201);
    expect(st.json()).toMatchObject({ status: 'draft', total: 125 });
    expect(st.json().number).toMatch(/^CS\d{6}$/);
    expect(st.json().commissions).toHaveLength(1);
    statementId = st.json().id;

    const payDraft = await call(accounts, 'POST', `/crm/statements/${statementId}/pay`, { mode: 'upi' });
    expect(payDraft.statusCode).toBe(409);
    expect((await call(reception, 'POST', `/crm/statements/${statementId}/approve`)).statusCode).toBe(403);
    expect((await call(accounts, 'POST', `/crm/statements/${statementId}/approve`)).json().status).toBe('approved');
    const paid = await call(accounts, 'POST', `/crm/statements/${statementId}/pay`, { mode: 'bank', reference: `NEFT${tag}` });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json()).toMatchObject({ status: 'paid', paymentMode: 'bank', paymentRef: `NEFT${tag}` });
    expect((await call(accounts, 'POST', `/crm/statements/${statementId}/cancel`)).statusCode).toBe(409);

    const ref = (await call(admin, 'GET', `/crm/referrers/${referrerId}`)).json();
    expect(ref).toMatchObject({ openCommission: 0, paidCommission: 125 });

    const db = app.get(DbService);
    await expect(
      db.asTenant({ tenantId }, (tx) => tx.execute(sql`update crm.commission_statements set total = 1 where id = ${statementId}`)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/is paid/) } });
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`delete from crm.commissions where invoice_id = ${invoiceId}`))).rejects.toMatchObject(
      { cause: { message: expect.stringMatching(/append-only/) } },
    );
  });

  it('cancels or reverses commission when the bill is cancelled', async () => {
    const inv = await call(clerk, 'POST', '/billing/invoices', { patientId, finalize: true, lines: [{ description: 'Physio', unitPrice: 400 }] });
    const id = inv.json().id;
    await dispatch('billing.invoice.finalized', 'invoiceId', id);
    // Not on a statement yet: cancelling the bill simply cancels the commission.
    const cancel = await call(admin, 'POST', `/billing/invoices/${id}/cancel`, { reason: 'Wrong patient' });
    expect(cancel.statusCode, cancel.body).toBe(200);
    await dispatch('billing.invoice.cancelled', 'invoiceId', id);
    await dispatch('billing.invoice.cancelled', 'invoiceId', id);
    const rows = (await call(admin, 'GET', `/crm/commissions?referrerId=${referrerId}&pageSize=50`)).json().items.filter(
      (c: { invoiceId: string }) => c.invoiceId === id,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'accrual', amount: 40, status: 'cancelled' });

    // The first invoice is on a paid statement: cancelling it books a negative line for the next statement.
    const c2 = await call(admin, 'POST', `/billing/invoices/${invoiceId}/cancel`, { reason: 'Billing error' });
    expect(c2.statusCode, c2.body).toBe(200);
    await dispatch('billing.invoice.cancelled', 'invoiceId', invoiceId);
    await dispatch('billing.invoice.cancelled', 'invoiceId', invoiceId);
    const open = (await call(admin, 'GET', `/crm/commissions?referrerId=${referrerId}&state=open`)).json().items;
    expect(open).toEqual([expect.objectContaining({ kind: 'reversal', invoiceId, amount: -125, statementId: null })]);
    // Nothing positive left to bill, so no statement can be made from the reversal alone.
    const st = await call(admin, 'POST', '/crm/statements', { referrerId, periodFrom: today(), periodTo: today() });
    expect(st.statusCode).toBe(409);
    expect(st.json().error.code).toBe('nothing_to_pay');
  });

  it('ignores a partial billing.invoice.finalized payload', async () => {
    const bus = app.get(EventBus);
    const env = { id: crypto.randomUUID(), tenantId, topic: 'billing.invoice.finalized', createdAt: new Date().toISOString() };
    await bus.dispatch({ ...env, payload: { invoiceId: crypto.randomUUID(), patientId, number: 'INV-X', total: 500 } });
    await bus.dispatch({ ...env, id: crypto.randomUUID(), payload: { invoiceId: crypto.randomUUID(), patientId } });
  });

  it('picks the most specific rule', () => {
    const base = { tenantId: 't', isActive: true, effectiveTo: null, createdBy: null, updatedBy: null, createdAt: '', updatedAt: '' };
    const rules = [
      { ...base, id: 'all', referrerId: null, appliesTo: 'all', serviceCode: null, rateType: 'percent', rate: '5', effectiveFrom: '2026-01-01' },
      { ...base, id: 'lab', referrerId: null, appliesTo: 'lab', serviceCode: null, rateType: 'percent', rate: '20', effectiveFrom: '2026-01-01' },
      { ...base, id: 'mine', referrerId: 'r', appliesTo: 'all', serviceCode: null, rateType: 'percent', rate: '8', effectiveFrom: '2026-01-01' },
      { ...base, id: 'mri', referrerId: null, appliesTo: 'all', serviceCode: 'MRI', rateType: 'flat', rate: '500', effectiveFrom: '2026-01-01' },
    ];
    expect(pickRule(rules, null, 'lab')?.id).toBe('mine');
    expect(pickRule(rules.filter((r) => r.id !== 'mine'), null, 'lab')?.id).toBe('lab');
    expect(pickRule(rules.filter((r) => r.id !== 'mine'), 'MRI', 'radiology')?.id).toBe('mri');
    expect(pickRule(rules.filter((r) => r.id !== 'mine'), null, 'pharmacy')?.id).toBe('all');
  });
});

describe('camps and campaigns', () => {
  let campId: string;
  let campaignId: string;

  it('plans a camp and counts the enquiries captured there', async () => {
    const res = await call(admin, 'POST', '/crm/camps', { name: `Diabetes camp ${tag}`, startsOn: today(), endsOn: today(), location: 'Ward 12 hall', targetCount: 100 });
    expect(res.statusCode, res.body).toBe(201);
    campId = res.json().id;
    expect(res.json().code).toMatch(/^CMP\d{4}$/);
    const bad = await call(admin, 'PATCH', `/crm/camps/${campId}`, { endsOn: '2020-01-01' });
    expect(bad.statusCode).toBe(400);
    for (const n of [10, 11]) {
      const l = await call(reception, 'POST', '/crm/leads', { name: `Camp visitor ${n} ${tag}`, mobile: uniqueMobile(n), campId });
      expect(l.json().source).toBe('camp');
    }
    await call(reception, 'POST', '/crm/leads', { name: `Camp email ${tag}`, email: `camp.${tag.toLowerCase()}@example.com`, campId });
    const camp = (await call(reception, 'GET', `/crm/camps/${campId}`)).json();
    expect(camp).toMatchObject({ leadCount: 3, convertedCount: 0, status: 'planned' });
    expect((await call(reception, 'POST', '/crm/camps', { name: 'x', startsOn: today(), endsOn: today() })).statusCode).toBe(403);
  });

  it('sends a campaign to the camp audience through notifications, once', async () => {
    const res = await call(admin, 'POST', '/crm/campaigns', {
      name: `Free HbA1c ${tag}`,
      channel: 'sms',
      message: 'Free HbA1c test this Sunday 8-11 AM.',
      audience: { campId },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toMatchObject({ status: 'draft', audienceSize: 3 });
    campaignId = res.json().id;

    const sent = await call(admin, 'POST', `/crm/campaigns/${campaignId}/send`);
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json()).toMatchObject({ status: 'sent', recipientCount: 3 });
    // The email-only lead cannot get an SMS.
    expect(sent.json().skippedCount).toBeGreaterThanOrEqual(1);
    const msgs = await crmMessages(campaignId);
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.body).toContain('Free HbA1c test this Sunday');

    expect((await call(admin, 'POST', `/crm/campaigns/${campaignId}/send`)).statusCode).toBe(409);
    expect((await call(admin, 'PUT', `/crm/campaigns/${campaignId}`, { name: 'x', channel: 'sms', message: 'y' })).statusCode).toBe(409);
    expect((await call(reception, 'GET', '/crm/campaigns')).statusCode).toBe(403);
  });
});

describe('follow-ups', () => {
  let patientId: string;
  let followUpId: string;

  beforeAll(async () => {
    const p = await call(reception, 'POST', '/patients', { firstName: 'Follow', lastName: `Up${tag}`, gender: 'male', ageYears: 62, mobile: uniqueMobile(20) });
    patientId = p.json().id;
  });

  it('creates a follow-up and sends a reminder through notifications', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const res = await call(reception, 'POST', '/crm/follow-ups', { patientId, dueDate: tomorrow, type: 'revisit', reason: 'BP review' });
    expect(res.statusCode, res.body).toBe(201);
    followUpId = res.json().id;
    expect(res.json()).toMatchObject({ status: 'pending', source: 'manual', patientName: `Follow Up${tag}` });

    const due = await call(reception, 'POST', '/crm/follow-ups/remind-due', { date: tomorrow });
    expect(due.statusCode, due.body).toBe(200);
    expect(due.json().reminded).toBeGreaterThanOrEqual(1);
    // Same day again: nothing new for this follow-up.
    await call(reception, 'POST', '/crm/follow-ups/remind-due', { date: tomorrow });
    const msgs = await crmMessages(followUpId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toMatch(/follow-up visit is due/);

    const got = (await call(reception, 'GET', `/crm/follow-ups/${followUpId}`)).json();
    expect(got.reminderCount).toBe(1);
    expect((await call(doctor, 'POST', `/crm/follow-ups/${followUpId}/remind`, {})).statusCode).toBe(403);
  });

  it('closes a follow-up with an outcome', async () => {
    const res = await call(reception, 'POST', `/crm/follow-ups/${followUpId}/close`, { status: 'done', outcome: 'Booked for Monday' });
    expect(res.json()).toMatchObject({ status: 'done', outcome: 'Booked for Monday' });
    expect((await call(reception, 'POST', `/crm/follow-ups/${followUpId}/close`, { status: 'done' })).statusCode).toBe(409);
  });

  it("creates follow-ups from the doctor's follow-up date and from low portal ratings, idempotently", async () => {
    const bus = app.get(EventBus);
    const env = (topic: string, payload: Record<string, unknown>) => ({ id: crypto.randomUUID(), tenantId, topic, payload, createdAt: new Date().toISOString() });
    const encounterId = crypto.randomUUID();
    const signed = { encounterId, patientId, doctorId: crypto.randomUUID(), followUpDate: '2030-01-15', followUpNotes: 'Review sugar' };
    await bus.dispatch(env('emr.encounter.signed', signed));
    await bus.dispatch(env('emr.encounter.signed', signed));
    await bus.dispatch(env('emr.encounter.signed', { encounterId: crypto.randomUUID(), patientId, doctorId: crypto.randomUUID() }));
    const feedbackId = crypto.randomUUID();
    await bus.dispatch(env('portal.feedback.submitted', { feedbackId, patientId, rating: 1 }));
    await bus.dispatch(env('portal.feedback.submitted', { feedbackId: crypto.randomUUID(), patientId, rating: 5 }));

    const list = (await call(reception, 'GET', `/crm/follow-ups?patientId=${patientId}&status=pending`)).json().items;
    expect(list.filter((f: { source: string }) => f.source === 'emr')).toEqual([
      expect.objectContaining({ dueDate: '2030-01-15', reason: 'Review sugar', sourceRef: encounterId }),
    ]);
    expect(list.filter((f: { source: string }) => f.source === 'feedback')).toEqual([
      expect.objectContaining({ type: 'feedback_recovery', sourceRef: feedbackId }),
    ]);
  });
});

describe('plan entitlement', () => {
  it('blocks CRM for a hospital whose plan does not include it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/crm/leads', headers: bearer(cityAdmin) });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('plan_upgrade_required');
  });
});

describe('hospital isolation', () => {
  it("never shows one hospital's CRM data to another", async () => {
    const lead = (await call(reception, 'POST', '/crm/leads', { name: `Private ${tag}`, mobile: uniqueMobile(30) })).json();
    const ref = (await call(admin, 'POST', '/crm/referrers', { name: `Private Dr ${tag}` })).json();
    const fu = (await call(reception, 'POST', '/crm/follow-ups', { leadId: lead.id, dueDate: today() })).json();

    const city = (method: string, url: string, payload?: unknown) =>
      app.inject({ method, url: `/api/v1${url}`, headers: bearer(cityAdmin), payload } as Inject);
    // 404 (not found) or 403 (plan without CRM): never the record.
    for (const [m, u, b] of [
      ['GET', `/crm/leads/${lead.id}`],
      ['PATCH', `/crm/leads/${lead.id}`, { name: 'Hacked' }],
      ['GET', `/crm/referrers/${ref.id}`],
      ['GET', `/crm/follow-ups/${fu.id}`],
      ['POST', `/crm/follow-ups/${fu.id}/close`, { status: 'done' }],
    ] as const) {
      const res = await city(m, u, b);
      expect([403, 404], `${m} ${u}`).toContain(res.statusCode);
    }
    const list = await city('GET', '/crm/leads?pageSize=200');
    if (list.statusCode === 200) expect(list.json().items.find((x: { id: string }) => x.id === lead.id)).toBeUndefined();

    const seen = await app.get(DbService).asTenant({ tenantId: cityTenantId }, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`select count(*) as n from crm.leads where id = ${lead.id}`);
      return Number(r.rows[0]!.n);
    });
    expect(seen).toBe(0);
    expect((await call(reception, 'GET', `/crm/leads/${lead.id}`)).json().name).toBe(`Private ${tag}`);
  });
});

describe('editing CRM records', () => {
  let staffId: string;
  let cityUserId: string;

  beforeAll(async () => {
    const staff = await call(reception, 'GET', '/crm/staff');
    expect(staff.statusCode, staff.body).toBe(200);
    staffId = staff.json().find((u: { name: string }) => u.name)!.id;
    cityUserId = (await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(cityAdmin) })).json().id;
  });

  it('lists staff only for users who can assign work', async () => {
    expect((await call(doctor, 'GET', '/crm/staff')).statusCode).toBe(403);
    expect((await call(owner, 'GET', '/crm/staff')).statusCode).toBe(403);
  });

  it('edits an enquiry and assigns it to a staff member', async () => {
    const lead = (await call(reception, 'POST', '/crm/leads', { name: `Edit ${tag}`, mobile: uniqueMobile(40) })).json();
    const res = await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { name: `Edited ${tag}`, interest: 'Cardiology', ageYears: 44, assignedTo: staffId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ name: `Edited ${tag}`, interest: 'Cardiology', ageYears: 44, assignedTo: staffId });
    expect(res.json().assignedToName).toBeTruthy();

    // validation: bad mobile, negative age, removing every contact, an assignee from another hospital
    expect((await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { mobile: '12345' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { ageYears: -1 })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { email: 'not-an-email' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { mobile: null })).statusCode).toBe(409);
    const foreign = await call(reception, 'PATCH', `/crm/leads/${lead.id}`, { assignedTo: cityUserId });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json().error.code).toBe('invalid_assignee');

    // permission: the owner can read but not edit
    const denied = await call(owner, 'PATCH', `/crm/leads/${lead.id}`, { name: 'Nope' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.details.missing).toEqual(['crm.lead.manage']);
  });

  it('edits and reschedules a pending follow-up, not a closed one', async () => {
    const lead = (await call(reception, 'POST', '/crm/leads', { name: `FU edit ${tag}`, mobile: uniqueMobile(41) })).json();
    const fu = (await call(reception, 'POST', '/crm/follow-ups', { leadId: lead.id, dueDate: today() })).json();
    const res = await call(reception, 'PATCH', `/crm/follow-ups/${fu.id}`, { dueDate: '2031-02-03', type: 'call', reason: 'Call back', assignedTo: staffId });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ dueDate: '2031-02-03', type: 'call', reason: 'Call back', assignedTo: staffId });
    expect(res.json().assignedToName).toBeTruthy();

    expect((await call(reception, 'PATCH', `/crm/follow-ups/${fu.id}`, { dueDate: '2020-01-01' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/crm/follow-ups/${fu.id}`, { dueDate: '31-12-2031' })).statusCode).toBe(400);
    expect((await call(reception, 'PATCH', `/crm/follow-ups/${fu.id}`, { assignedTo: cityUserId })).statusCode).toBe(400);
    expect((await call(reception, 'POST', '/crm/follow-ups', { leadId: lead.id, dueDate: '2020-01-01' })).statusCode).toBe(400);
    expect((await call(doctor, 'PATCH', `/crm/follow-ups/${fu.id}`, { reason: 'x' })).statusCode).toBe(403);

    await call(reception, 'POST', `/crm/follow-ups/${fu.id}/close`, { status: 'done' });
    expect((await call(reception, 'PATCH', `/crm/follow-ups/${fu.id}`, { reason: 'late' })).statusCode).toBe(409);
  });

  it('edits a commission rule with the same validation as create', async () => {
    const ref = (await call(admin, 'POST', '/crm/referrers', { name: `Rule edit ${tag}` })).json();
    const rule = (await call(admin, 'POST', '/crm/commission-rules', { referrerId: ref.id, rateType: 'percent', rate: 10, effectiveFrom: '2026-01-01' })).json();
    const body = { referrerId: ref.id, appliesTo: 'lab', rateType: 'flat', rate: 250, effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', isActive: false };
    const res = await call(admin, 'PUT', `/crm/commission-rules/${rule.id}`, body);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ appliesTo: 'lab', rateType: 'flat', rate: 250, effectiveTo: '2026-12-31', isActive: false });

    expect((await call(admin, 'PUT', `/crm/commission-rules/${rule.id}`, { ...body, rateType: 'percent', rate: 150 })).statusCode).toBe(400);
    expect((await call(admin, 'PUT', `/crm/commission-rules/${rule.id}`, { ...body, rate: -5 })).statusCode).toBe(400);
    expect((await call(admin, 'PUT', `/crm/commission-rules/${rule.id}`, { ...body, effectiveTo: '2025-01-01' })).statusCode).toBe(400);
    // end date before the stored start date when the start date is not sent
    const { effectiveFrom: _skip, ...noFrom } = body;
    expect((await call(admin, 'PUT', `/crm/commission-rules/${rule.id}`, { ...noFrom, effectiveTo: '2025-06-01' })).statusCode).toBe(400);
    expect((await call(reception, 'PUT', `/crm/commission-rules/${rule.id}`, body)).statusCode).toBe(403);
  });
});
