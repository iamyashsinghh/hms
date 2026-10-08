import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from '@hms/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../src/common/db/db.service';
import { EventBus } from '../src/common/events/event-bus';
import { emptyContext, requestContext } from '../src/common/context/request-context';
import { NotificationsDispatcher, MAX_ATTEMPTS } from '../src/modules/notifications/notifications.dispatcher';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotificationsScheduler } from '../src/modules/notifications/notifications.scheduler';
import { ConsoleProvider } from '../src/modules/notifications/providers/console.provider';
import { ProviderError, type MessageProvider, type OutboundMessage } from '../src/modules/notifications/providers/provider';
import { ProvidersService } from '../src/modules/notifications/providers/providers.service';
import { bearer, bootApp, login } from './helpers';

let app: NestFastifyApplication;
let admin: string;
let reception: string;
let doctor: string;
let cityAdmin: string;
let tenantId: string;
let doctorUserId: string;
let patient: { id: string; uhid: string; firstName: string; mobile: string };

const uniqueMobile = () => `9${String(Date.now()).slice(-9)}`;

async function api(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, token: string, payload?: unknown) {
  return app.inject({ method, url: `/api/v1/notifications${url}`, headers: bearer(token), payload: payload as never });
}

/** Runs the worker side for every queued message created after `since`. */
async function deliverQueued() {
  const dispatcher = app.get(NotificationsDispatcher);
  const db = app.get(DbService);
  const ids = await db.asTenant({ tenantId }, async (tx) => {
    const res = await tx.execute<{ id: string }>(sql`select id from comms.messages where status = 'queued' order by created_at`);
    return res.rows.map((r) => r.id);
  });
  for (const id of ids) await dispatcher.deliver(tenantId, id).catch(() => undefined);
}

async function balance(token = admin): Promise<number> {
  return (await api('GET', '/credits', token)).json().balance;
}

beforeAll(async () => {
  app = await bootApp();
  const a = await login(app, 'admin@demo.hms');
  admin = a.accessToken;
  reception = (await login(app, 'reception@demo.hms')).accessToken;
  const d = await login(app, 'doctor@demo.hms');
  doctor = d.accessToken;
  doctorUserId = d.user.id;
  cityAdmin = (await login(app, 'admin@city.hms', 'city')).accessToken;
  const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: bearer(admin) });
  tenantId = me.json().tenantId;

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/patients',
    headers: bearer(reception),
    payload: { firstName: 'Notify', lastName: `Test${Date.now()}`, gender: 'female', ageYears: 40, mobile: uniqueMobile(), email: 'notify.test@example.com' },
  });
  patient = res.json();
  // Make sure the wallet has room for the tests.
  await requestContext.run({ ...emptyContext('t'), tenantId }, () => app.get(NotificationsService).topup({ amount: 100, note: 'test' }));
});
afterAll(() => app.close());

describe('notifications: manual send and delivery', () => {
  it('queues an SMS, charges credits, delivers it through the console provider', async () => {
    const before = await balance();
    const mobile = uniqueMobile();
    const res = await api('POST', '/messages', reception, { to: { mobile }, template: 'custom.message', data: { message: 'OPD closed tomorrow' }, channels: ['sms'] });
    expect(res.statusCode).toBe(201);
    const [m] = res.json().messages;
    expect(m).toMatchObject({ channel: 'sms', status: 'queued', reason: null });
    expect(await balance()).toBeCloseTo(before - 0.25, 2);

    await deliverQueued();
    const got = (await api('GET', `/messages/${m.id}`, reception)).json();
    expect(got.status).toBe('delivered');
    expect(got.provider).toBe('console');
    expect(got.body).toBe('OPD closed tomorrow - Demo Hospital'.replace('Demo Hospital', got.body.split(' - ')[1]));
    expect(ConsoleProvider.outbox.some((o) => o.id === m.id && o.to === mobile)).toBe(true);
  });

  it('resolves a patient’s mobile, email and name and renders the template', async () => {
    const res = await api('POST', '/messages', reception, {
      to: { patientId: patient.id },
      template: 'patient.registered',
      data: { uhid: patient.uhid },
      channels: ['sms', 'email', 'push'],
    });
    const msgs = res.json().messages as { id: string; channel: string; status: string; reason: string | null }[];
    expect(msgs.find((x) => x.channel === 'sms')?.status).toBe('queued');
    expect(msgs.find((x) => x.channel === 'email')?.status).toBe('queued');
    // patient.registered has no push template
    expect(msgs.find((x) => x.channel === 'push')).toMatchObject({ status: 'skipped', reason: 'no_template' });
    const sms = (await api('GET', `/messages/${msgs[0]!.id}`, reception)).json();
    expect(sms.recipient).toBe(patient.mobile);
    expect(sms.body).toContain(`Dear ${patient.firstName}`);
    expect(sms.body).toContain(patient.uhid);
    expect(sms.patientId).toBe(patient.id);
  });

  it('requires a message for custom messages and validates recipients', async () => {
    expect((await api('POST', '/messages', reception, { to: { mobile: '9876543210' }, template: 'custom.message', data: {} })).statusCode).toBe(400);
    expect((await api('POST', '/messages', reception, { to: {}, template: 'custom.message', data: { message: 'x' } })).statusCode).toBe(400);
    expect((await api('POST', '/messages', reception, { to: { mobile: '12345' }, template: 'custom.message', data: { message: 'x' } })).statusCode).toBe(400);
  });

  it('skips opted-out numbers without charging', async () => {
    const mobile = uniqueMobile();
    const opt = await api('POST', '/opt-outs', reception, { channel: 'sms', address: `+91 ${mobile}`, reason: 'Asked to stop' });
    expect(opt.statusCode).toBe(201);
    expect(opt.json().address).toBe(mobile);
    const before = await balance();
    const res = await api('POST', '/messages', reception, { to: { mobile }, template: 'custom.message', data: { message: 'hi' }, channels: ['sms', 'whatsapp'] });
    const [sms, wa] = res.json().messages;
    expect(sms).toMatchObject({ status: 'skipped', reason: 'opted_out' });
    expect(wa.status).toBe('queued'); // opt-out was for SMS only
    expect(await balance()).toBeCloseTo(before - 0.8, 2);

    const list = (await api('GET', `/opt-outs?q=${mobile}`, reception)).json();
    expect(list.items).toHaveLength(1);
    expect((await api('DELETE', `/opt-outs/${opt.json().id}`, reception)).statusCode).toBe(204);
  });

  it('skips when credits run out', async () => {
    const db = app.get(DbService);
    const current = await balance();
    // Empty the wallet with an adjustment, then restore it.
    await db.asTenant({ tenantId }, (tx) => tx.execute(sql`insert into comms.credit_ledger (tenant_id, entry_type, amount, note) values (${tenantId}, 'adjustment', ${-current}, 'test drain')`));
    try {
      const res = await api('POST', '/messages', reception, { to: { mobile: uniqueMobile() }, template: 'custom.message', data: { message: 'hi' }, channels: ['sms'] });
      expect(res.json().messages[0]).toMatchObject({ status: 'skipped', reason: 'insufficient_credits' });
    } finally {
      await db.asTenant({ tenantId }, (tx) => tx.execute(sql`insert into comms.credit_ledger (tenant_id, entry_type, amount, note) values (${tenantId}, 'adjustment', ${current}, 'test restore')`));
    }
  });

  it('marks a message failed and refunds when the provider rejects it, and can retry', async () => {
    const providers = app.get(ProvidersService);
    const original = providers.get('sms');
    const failing: MessageProvider = {
      name: 'failing',
      channel: 'sms',
      send: async () => {
        throw new ProviderError('number blocked', false);
      },
    };
    providers.use(failing);
    try {
      const before = await balance();
      const res = await api('POST', '/messages', reception, { to: { mobile: uniqueMobile() }, template: 'custom.message', data: { message: 'x' }, channels: ['sms'] });
      const id = res.json().messages[0].id;
      await app.get(NotificationsDispatcher).deliver(tenantId, id);
      const m = (await api('GET', `/messages/${id}`, reception)).json();
      expect(m).toMatchObject({ status: 'failed', reason: 'provider_error', provider: 'failing', attempts: 1 });
      expect(m.error).toContain('number blocked');
      expect(await balance()).toBeCloseTo(before, 2);

      providers.use(original);
      const retried = await api('POST', `/messages/${id}/retry`, reception);
      expect(retried.statusCode).toBe(200);
      expect(retried.json().status).toBe('queued');
      await deliverQueued();
      expect((await api('GET', `/messages/${id}`, reception)).json().status).toBe('delivered');
      expect((await api('POST', `/messages/${id}/retry`, reception)).statusCode).toBe(409);
    } finally {
      providers.use(original);
    }
  });

  it('retries temporary provider errors up to the limit', async () => {
    const providers = app.get(ProvidersService);
    const original = providers.get('sms');
    let calls = 0;
    providers.use({
      name: 'flaky',
      channel: 'sms',
      send: async () => {
        calls++;
        throw new ProviderError('HTTP 503', true);
      },
    });
    try {
      const res = await api('POST', '/messages', reception, { to: { mobile: uniqueMobile() }, template: 'custom.message', data: { message: 'x' }, channels: ['sms'] });
      const id = res.json().messages[0].id;
      const dispatcher = app.get(NotificationsDispatcher);
      for (let i = 1; i < MAX_ATTEMPTS; i++) {
        await expect(dispatcher.deliver(tenantId, id)).rejects.toThrow('HTTP 503');
        expect((await api('GET', `/messages/${id}`, reception)).json().status).toBe('queued');
      }
      await dispatcher.deliver(tenantId, id);
      const m = (await api('GET', `/messages/${id}`, reception)).json();
      expect(m.status).toBe('failed');
      expect(m.attempts).toBe(MAX_ATTEMPTS);
      expect(calls).toBe(MAX_ATTEMPTS);
      // Already final: delivering again does nothing.
      await dispatcher.deliver(tenantId, id);
      expect(calls).toBe(MAX_ATTEMPTS);
    } finally {
      providers.use(original);
    }
  });

  it('lists the delivery log with filters and today’s stats', async () => {
    const list = await api('GET', '/messages?channel=sms&pageSize=5', reception);
    expect(list.statusCode).toBe(200);
    expect(list.json().items.length).toBeGreaterThan(0);
    expect(list.json().items.every((m: { channel: string }) => m.channel === 'sms')).toBe(true);
    const byPatient = (await api('GET', `/messages?patientId=${patient.id}`, reception)).json();
    expect(byPatient.items.every((m: { patientId: string }) => m.patientId === patient.id)).toBe(true);
    const stats = (await api('GET', '/messages/stats', reception)).json();
    expect(stats.today.delivered).toBeGreaterThan(0);
  });
});

describe('notifications: events and rules', () => {
  const event = (topic: string, payload: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    tenantId,
    topic,
    payload,
    createdAt: new Date().toISOString(),
  });

  it('sends the welcome SMS when a patient is registered, once per event', async () => {
    const bus = app.get(EventBus);
    const e = event('core.patient.registered', { patientId: patient.id, uhid: patient.uhid });
    await bus.dispatch(e);
    await bus.dispatch(e); // redelivery must not send twice
    const list = (await api('GET', `/messages?patientId=${patient.id}&q=patient.registered&pageSize=100`, reception)).json();
    const fromEvent = list.items.filter((m: { sourceModule: string; sourceRef: string }) => m.sourceModule === 'core');
    expect(fromEvent).toHaveLength(1);
    expect(fromEvent[0].body).toContain(patient.uhid);
  });

  it('formats appointment time in IST and respects rule changes', async () => {
    const bus = app.get(EventBus);
    const start = '2026-10-08T05:00:00.000Z'; // 10:30 AM IST
    const e1 = event('frontoffice.appointment.booked', { appointmentId: crypto.randomUUID(), patientId: patient.id, doctorId: doctorUserId, start });
    await bus.dispatch(e1);
    let list = (await api('GET', `/messages?patientId=${patient.id}&q=appointment.booked`, reception)).json();
    const sms = list.items.find((m: { channel: string; sourceRef: string }) => m.channel === 'sms' && m.sourceRef === e1.payload.appointmentId);
    expect(sms.body).toContain('08 Oct 2026');
    expect(sms.body).toContain('10:30 AM');

    const off = await api('PUT', '/rules', admin, { eventTopic: 'frontoffice.appointment.booked', channels: ['sms'], isActive: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ isActive: false, isCustom: true });
    const e2 = event('frontoffice.appointment.booked', { appointmentId: crypto.randomUUID(), patientId: patient.id, doctorId: doctorUserId, start });
    await bus.dispatch(e2);
    list = (await api('GET', `/messages?patientId=${patient.id}&q=appointment.booked&pageSize=100`, reception)).json();
    expect(list.items.some((m: { sourceRef: string }) => m.sourceRef === e2.payload.appointmentId)).toBe(false);
    await api('PUT', '/rules', admin, { eventTopic: 'frontoffice.appointment.booked', channels: ['sms', 'push'], isActive: true });

    const rules = (await api('GET', '/rules', admin)).json();
    expect(rules.find((r: { eventTopic: string }) => r.eventTopic === 'billing.payment.received')).toMatchObject({ isActive: true, channels: ['sms'] });
    expect((await api('PUT', '/rules', admin, { eventTopic: 'nope.thing.done', channels: [], isActive: false })).statusCode).toBe(400);
  });

  it('alerts the doctor about a critical lab value without messaging the patient', async () => {
    const bus = app.get(EventBus);
    const e = event('lab.result.critical', {
      orderId: crypto.randomUUID(), orderNo: 'LB000123', resultId: crypto.randomUUID(), patientId: patient.id,
      doctorId: doctorUserId, testName: 'Potassium', value: '6.8', unit: 'mmol/L', flag: 'critical_high',
    });
    await bus.dispatch(e);
    await bus.dispatch(e);
    const list = (await api('GET', `/messages?q=lab.critical&pageSize=100`, admin)).json();
    const mine = list.items.filter((m: { sourceRef: string }) => m.sourceRef === e.payload.resultId);
    expect(mine.map((m: { channel: string }) => m.channel).sort()).toEqual(['push', 'sms']);
    const sms = mine.find((m: { channel: string }) => m.channel === 'sms');
    expect(sms.recipient).toBe('9000000002');
    expect(sms.userId).toBe(doctorUserId);
    expect(sms.patientId).toBeNull();
    expect(sms.body).toContain(`${patient.firstName}`);
    expect(sms.body).toContain(patient.uhid);
    expect(sms.body).toContain('Potassium 6.8 mmol/L CRITICAL_HIGH');
  });

  it('tells the patient a radiology report is ready and the doctor about a critical finding', async () => {
    const bus = app.get(EventBus);
    const reportId = crypto.randomUUID();
    await bus.dispatch(event('radiology.report.finalized', { reportId, patientId: patient.id, title: 'X-ray chest PA', orderId: crypto.randomUUID(), version: 1, isCritical: true, referringDoctorId: doctorUserId, facilityId: crypto.randomUUID(), issuedAt: new Date().toISOString() }));
    await bus.dispatch(event('radiology.report.critical', { reportId, orderId: crypto.randomUUID(), patientId: patient.id, referringDoctorId: doctorUserId, studyName: 'X-ray chest PA', impression: 'Large right-sided pneumothorax.' }));
    const msgs = (await api('GET', `/messages?q=${encodeURIComponent('X-ray chest PA')}&pageSize=100`, admin)).json().items.filter((m: { sourceRef: string }) => m.sourceRef === reportId);
    const ready = msgs.find((m: { templateKey: string }) => m.templateKey === 'report.ready');
    expect(ready.recipient).toBe(patient.mobile);
    expect(ready.body).toContain('your X-ray chest PA report');
    const critical = msgs.find((m: { templateKey: string; channel: string }) => m.templateKey === 'radiology.critical' && m.channel === 'sms');
    expect(critical.recipient).toBe('9000000002');
    expect(critical.body).toContain('Large right-sided pneumothorax.');
  });

  it('alerts admins only for serious incidents, and SMSes a resolved complaint to the complainant', async () => {
    const bus = app.get(EventBus);
    const minor = event('quality.incident.reported', { incidentId: crypto.randomUUID(), incidentNo: 'INC-1', facilityId: null, kind: 'incident', category: 'patient_fall', severity: 'mild', patientId: null });
    const severe = event('quality.incident.reported', { incidentId: crypto.randomUUID(), incidentNo: 'INC-2', facilityId: null, kind: 'incident', category: 'patient_fall', severity: 'severe', patientId: null });
    await bus.dispatch(minor);
    await bus.dispatch(severe);
    const alerts = (await api('GET', '/messages?q=quality.incident_alert&pageSize=100', admin)).json().items;
    expect(alerts.some((m: { sourceRef: string }) => m.sourceRef === minor.payload.incidentId)).toBe(false);
    const smsList = alerts.filter((m: { sourceRef: string; channel: string }) => m.sourceRef === severe.payload.incidentId && m.channel === 'sms');
    expect(smsList.map((m: { recipient: string }) => m.recipient)).toContain('9000000001'); // hospital admin
    const sms = smsList[0];
    expect(sms.body).toContain('Incident INC-2');
    expect(sms.body).toContain('severe (patient fall)');

    const mobile = uniqueMobile();
    const c = event('quality.complaint.resolved', { complaintId: crypto.randomUUID(), complaintNo: 'CMP-7', patientId: null, complainantMobile: `+91${mobile}` });
    await bus.dispatch(c);
    const resolved = (await api('GET', `/messages?q=${mobile}`, admin)).json().items;
    expect(resolved).toHaveLength(1);
    expect(resolved[0].body).toContain('complaint CMP-7');
  });

  it('tells an employee about their leave decision', async () => {
    const bus = app.get(EventBus);
    const e = event('hr.leave.decided', { leaveId: crypto.randomUUID(), employeeId: crypto.randomUUID(), userId: doctorUserId, status: 'approved', fromDate: '2026-10-20', toDate: '2026-10-22' });
    await bus.dispatch(e);
    const sms = (await api('GET', '/messages?q=hr.leave_update&channel=sms&pageSize=100', admin)).json().items.find((m: { sourceRef: string }) => m.sourceRef === e.payload.leaveId);
    expect(sms.recipient).toBe('9000000002');
    expect(sms.body).toContain('Dear Dr. Asha Rao, your leave from 20 Oct 2026 to 22 Oct 2026 has been approved');
  });

  it('sends the owner their daily summary once per day', async () => {
    const scheduler = app.get(NotificationsScheduler);
    // A fresh past day per run, since the summary is sent once per hospital per day.
    const date = new Date(Date.UTC(2000, 0, 1) + Math.floor(Math.random() * 9000) * 86_400_000).toISOString().slice(0, 10);
    await scheduler.sendOwnerSummary(tenantId, date);
    await scheduler.sendOwnerSummary(tenantId, date);
    const items = (await api('GET', '/messages?q=owner.daily_summary&pageSize=100', admin)).json().items.filter((m: { sourceRef: string }) => m.sourceRef === date);
    const wa = items.filter((m: { channel: string }) => m.channel === 'whatsapp');
    expect(wa).toHaveLength(1);
    expect(wa[0].recipient).toBe('9000000005');
    expect(wa[0].body).toContain('Good morning Sunil Mehta');
    expect(wa[0].body).toContain(new Date(`${date}T12:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }));
    expect(wa[0].body).toMatch(/OPD visits: \*\d+\*/);
  });

  it('messages the patient when an online booking is declined', async () => {
    const bus = app.get(EventBus);
    const e = event('portal.appointment.rejected', { requestId: crypto.randomUUID(), patientId: patient.id, doctorId: doctorUserId, slotStart: '2026-10-09T04:30:00.000Z' });
    await bus.dispatch(e);
    const sms = (await api('GET', '/messages?q=appointment.request_declined&channel=sms&pageSize=100', admin)).json().items.find((m: { sourceRef: string }) => m.sourceRef === e.payload.requestId);
    expect(sms.recipient).toBe(patient.mobile);
    expect(sms.body).toContain('09 Oct 2026 at 10:00 AM');
  });

  it('sends one patient message per portal booking, not two', async () => {
    const bus = app.get(EventBus);
    const appointmentId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const start = '2026-10-10T06:00:00.000Z';
    // A portal booking emits both events; only the frontoffice one should message the patient.
    await bus.dispatch(event('frontoffice.appointment.booked', { appointmentId, patientId: patient.id, doctorId: doctorUserId, start }));
    await bus.dispatch(event('portal.appointment.confirmed', { requestId, appointmentId, patientId: patient.id, doctorId: doctorUserId, doctorName: 'Dr. Asha Rao', facilityId: null, slotStart: start, note: null }));
    const sms = (await api('GET', `/messages?patientId=${patient.id}&channel=sms&pageSize=100`, admin)).json().items.filter(
      (m: { sourceRef: string }) => m.sourceRef === appointmentId || m.sourceRef === requestId,
    );
    expect(sms).toHaveLength(1);
    expect(sms[0].sourceModule).toBe('frontoffice');

    // A request that never became an appointment is messaged by the portal rule.
    const legacy = crypto.randomUUID();
    await bus.dispatch(event('portal.appointment.cancelled', { requestId: legacy, appointmentId: null, patientId: patient.id, doctorId: doctorUserId, doctorName: 'Dr. Asha Rao', facilityId: null, slotStart: start, note: null }));
    const cancelled = (await api('GET', `/messages?patientId=${patient.id}&channel=sms&pageSize=100`, admin)).json().items.filter((m: { sourceRef: string }) => m.sourceRef === legacy);
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].templateKey).toBe('appointment.cancelled');
  });

  it('other modules can call send() inside their own transaction', async () => {
    const svc = app.get(NotificationsService);
    const db = app.get(DbService);
    const key = `test:${crypto.randomUUID()}`;
    const run = () =>
      requestContext.run({ ...emptyContext('t'), tenantId }, () =>
        db.tx((tx) => svc.send(tx, { to: { patientId: patient.id }, template: 'payment.received', data: { amount: '500.00', mode: 'UPI' }, channels: ['sms'], idempotencyKey: key, source: { module: 'billing', refId: 'inv-1' } })),
      );
    const first = await run();
    const second = await run();
    expect(second.messages[0]!.id).toBe(first.messages[0]!.id);

    // Rolled-back caller transaction: nothing is logged or charged.
    const before = await balance();
    await expect(
      requestContext.run({ ...emptyContext('t'), tenantId }, () =>
        db.tx(async (tx) => {
          await svc.send(tx, { to: { mobile: uniqueMobile() }, template: 'custom.message', data: { message: 'rollback' }, channels: ['sms'] });
          throw new Error('caller failed');
        }),
      ),
    ).rejects.toThrow('caller failed');
    expect(await balance()).toBeCloseTo(before, 2);
  });
});

describe('notifications: templates, settings, credits, devices', () => {
  it('sends staff invite login details for the Setup module', async () => {
    const svc = app.get(NotificationsService);
    const db = app.get(DbService);
    const mobile = uniqueMobile();
    const res = await requestContext.run({ ...emptyContext('t'), tenantId }, () =>
      db.tx((tx) =>
        svc.send(tx, {
          to: { mobile, email: 'new.staff@example.com' },
          template: 'staff.invited',
          data: { staffName: 'Ravi', hospitalCode: 'demo', loginId: 'ravi@demo.hms', tempPassword: 'Tmp@12345', loginUrl: 'https://demo.hms.test/login' },
          channels: ['sms', 'email'],
          source: { module: 'setup', refId: 'user-1' },
        }),
      ),
    );
    expect(res.messages.map((m) => m.status)).toEqual(['queued', 'queued']);
    const sms = (await api('GET', `/messages/${res.messages[0]!.id}`, admin)).json();
    expect(sms.body).toContain('temporary password Tmp@12345');
    expect(sms.body).toContain('Dear Ravi');
  });

  it('lets the admin customise, preview and reset a template', async () => {
    const list = (await api('GET', '/templates', admin)).json();
    expect(list.find((t: { key: string; channel: string }) => t.key === 'appointment.booked' && t.channel === 'sms')).toMatchObject({ isCustom: false });

    const put = await api('PUT', '/templates/appointment.booked/sms', admin, { body: 'Hi {{patientName}}, see you {{date}} {{time}}. {{hospitalName}}', dltTemplateId: '1107161234567890' });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ isCustom: true, dltTemplateId: '1107161234567890', name: 'Appointment booked' });

    const preview = await api('POST', '/templates/preview', admin, { channel: 'sms', body: 'Hi {{patientName}}, see you {{date}}', data: {} });
    expect(preview.json()).toMatchObject({ body: 'Hi Asha Sharma, see you ', parts: 1, missingVariables: ['date'] });

    const unicode = await api('POST', '/templates/preview', admin, { channel: 'sms', body: 'नमस्ते '.repeat(12), data: {} });
    expect(unicode.json().parts).toBe(2);

    expect((await api('DELETE', '/templates/appointment.booked/sms', admin)).statusCode).toBe(204);
    expect((await api('DELETE', '/templates/appointment.booked/sms', admin)).statusCode).toBe(404);
    expect((await api('PUT', '/templates/appointment.booked/fax', admin, { body: 'x' })).statusCode).toBe(400);
  });

  it('updates settings and rejects a default channel that is switched off', async () => {
    const s = (await api('GET', '/settings', admin)).json();
    expect(s.enabledChannels).toContain('sms');
    const bad = await api('PUT', '/settings', admin, { enabledChannels: ['email'], defaultChannels: ['sms'] });
    expect(bad.statusCode).toBe(400);
    const ok = await api('PUT', '/settings', admin, { smsSenderId: 'DEMOHS', lowBalanceThreshold: 25 });
    expect(ok.json()).toMatchObject({ smsSenderId: 'DEMOHS', lowBalanceThreshold: 25 });
    expect((await api('PUT', '/settings', admin, { smsSenderId: 'bad' })).statusCode).toBe(400);
  });

  it('shows the credit ledger; top-up needs its own permission', async () => {
    const ledger = (await api('GET', '/credits/ledger?pageSize=50', admin)).json();
    expect(ledger.items.some((e: { entryType: string }) => e.entryType === 'debit')).toBe(true);
    expect(ledger.items.some((e: { entryType: string }) => e.entryType === 'refund')).toBe(true);
    const top = await api('POST', '/credits/topup', admin, { amount: 10 });
    expect(top.statusCode).toBe(403);
    expect(top.json().error.details.missing).toEqual(['notifications.credit.topup']);
  });

  it('keeps the credit ledger append-only for the app role', async () => {
    const db = app.get(DbService);
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`update comms.credit_ledger set amount = 1000000`))).rejects.toThrow();
    await expect(db.asTenant({ tenantId }, (tx) => tx.execute(sql`delete from comms.credit_ledger`))).rejects.toThrow();
  });

  it('registers a push token for the signed-in user and sends push to them', async () => {
    const token = `ExponentPushToken[test-${Date.now()}]`;
    const reg = await api('POST', '/devices', doctor, { token, platform: 'android', appVariant: 'doctor', deviceName: 'Pixel' });
    expect(reg.statusCode).toBe(201);
    expect((await api('GET', '/devices', doctor)).json().some((d: { id: string }) => d.id === reg.json().id)).toBe(true);

    const before = await balance();
    const res = await api('POST', '/messages', reception, { to: { userId: doctorUserId }, template: 'custom.message', data: { message: 'New patient in queue' }, channels: ['push'] });
    const [push] = res.json().messages;
    expect(push.status).toBe('queued');
    expect(await balance()).toBeCloseTo(before, 2); // push is free
    await deliverQueued();
    const sent = ConsoleProvider.outbox.find((o: OutboundMessage) => o.id === push.id);
    expect(sent).toMatchObject({ to: token, subject: expect.any(String), body: 'New patient in queue' });

    expect((await api('POST', '/devices/unregister', doctor, { token })).statusCode).toBe(204);
    const again = await api('POST', '/messages', reception, { to: { userId: doctorUserId }, template: 'custom.message', data: { message: 'x' }, channels: ['push'] });
    expect(again.json().messages[0]).toMatchObject({ status: 'skipped', reason: 'no_address' });
  });
});

describe('notifications: access control and isolation', () => {
  it('enforces permissions', async () => {
    expect((await api('GET', '/messages', doctor)).statusCode).toBe(403);
    expect((await api('POST', '/messages', doctor, { to: { mobile: '9876543210' }, template: 'custom.message', data: { message: 'x' } })).statusCode).toBe(403);
    expect((await api('PUT', '/templates/appointment.booked/sms', reception, { body: 'x' })).statusCode).toBe(403);
    expect((await api('GET', '/settings', reception)).statusCode).toBe(403);
    expect((await api('GET', '/templates', reception)).statusCode).toBe(403);
  });

  it("never shows one hospital's messages, opt-outs or credits to another", async () => {
    const mobile = uniqueMobile();
    const sent = (await api('POST', '/messages', reception, { to: { mobile }, template: 'custom.message', data: { message: 'private' }, channels: ['sms'] })).json();
    const id = sent.messages[0].id;
    expect((await api('GET', `/messages/${id}`, cityAdmin)).statusCode).toBe(404);
    expect((await api('POST', `/messages/${id}/retry`, cityAdmin)).statusCode).toBe(404);
    const cityList = (await api('GET', `/messages?q=${mobile}`, cityAdmin)).json();
    expect(cityList.total).toBe(0);

    const opt = (await api('POST', '/opt-outs', reception, { channel: 'all', address: mobile })).json();
    expect((await api('DELETE', `/opt-outs/${opt.id}`, cityAdmin)).statusCode).toBe(404);
    expect((await api('GET', `/opt-outs?q=${mobile}`, cityAdmin)).json().total).toBe(0);
    // City's own wallet is separate from demo's.
    const cityLedger = (await api('GET', '/credits/ledger?pageSize=100', cityAdmin)).json();
    expect(cityLedger.items.some((e: { messageId: string | null }) => e.messageId === id)).toBe(false);
    // A city patient id cannot be messaged from demo.
    const res = await api('POST', '/messages', cityAdmin, { to: { patientId: patient.id }, template: 'custom.message', data: { message: 'x' }, channels: ['sms'] });
    expect(res.json().messages[0]).toMatchObject({ status: 'skipped', reason: 'no_address' });
    await api('DELETE', `/opt-outs/${opt.id}`, reception);
  });
});

describe('notifications: input validation', () => {
  it('rejects bad recipients, opt-out addresses, template ids and settings with clear messages', async () => {
    const badMobile = await api('POST', '/messages', reception, { to: { mobile: '12345' }, template: 'custom.message', data: { message: 'Hi' }, channels: ['sms'] });
    expect(badMobile.statusCode).toBe(400);
    expect(badMobile.json().error.message).toContain('Enter a 10-digit Indian mobile number');

    const badEmail = await api('POST', '/messages', reception, { to: { email: 'not-an-email' }, template: 'custom.message', data: { message: 'Hi' }, channels: ['email'] });
    expect(badEmail.statusCode).toBe(400);
    expect(badEmail.json().error.message).toContain('Enter a valid email address');

    const emailOptOut = await api('POST', '/opt-outs', reception, { channel: 'email', address: 'nobody' });
    expect(emailOptOut.statusCode).toBe(400);
    expect(emailOptOut.json().error.message).toContain('Enter a valid email address');
    const allOptOut = await api('POST', '/opt-outs', reception, { channel: 'all', address: 'abc' });
    expect(allOptOut.statusCode).toBe(400);
    expect(allOptOut.json().error.message).toContain('mobile number or an email');

    const emptyBody = await api('PUT', '/templates/appointment.booked/sms', admin, { body: '   ' });
    expect(emptyBody.statusCode).toBe(400);
    expect(emptyBody.json().error.message).toContain('Enter the message text');
    const badDlt = await api('PUT', '/templates/appointment.booked/sms', admin, { body: 'Hi', dltTemplateId: '1107 16-x' });
    expect(badDlt.statusCode).toBe(400);
    expect(badDlt.json().error.message).toContain('Template id can only have letters and digits');

    const badReplyTo = await api('PUT', '/settings', admin, { emailReplyTo: 'reply@' });
    expect(badReplyTo.statusCode).toBe(400);
    expect(badReplyTo.json().error.message).toContain('Enter a valid email address');
    const negative = await api('PUT', '/settings', admin, { lowBalanceThreshold: -5 });
    expect(negative.statusCode).toBe(400);
    expect(negative.json().error.message).toContain('Amount cannot be negative');
  });

  it('still accepts a +91 mobile and normalises it', async () => {
    const res = await api('POST', '/messages', reception, { to: { mobile: '+91 98765 00071' }, template: 'custom.message', data: { message: 'Validation check' }, channels: ['sms'] });
    expect(res.statusCode).toBe(201);
    expect(res.json().messages[0]).toMatchObject({ channel: 'sms', status: 'queued' });
  });
});
