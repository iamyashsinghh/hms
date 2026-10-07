import { describe, expect, it, vi } from 'vitest';
import { eventData } from '../src/modules/notifications/notifications.dispatcher';
import { ExpoPushProvider } from '../src/modules/notifications/providers/expo.provider';
import { GupshupWhatsappProvider } from '../src/modules/notifications/providers/gupshup.provider';
import { Msg91SmsProvider } from '../src/modules/notifications/providers/msg91.provider';
import { ProviderError, type OutboundMessage } from '../src/modules/notifications/providers/provider';
import { SesEmailProvider, signV4 } from '../src/modules/notifications/providers/ses.provider';
import { normalizeAddress, normalizeMobile, render, smsParts, startOfTodayIST, templateVariables } from '../src/modules/notifications/render';

const msg = (o: Partial<OutboundMessage> = {}): OutboundMessage => ({
  id: 'm1',
  tenantId: 't1',
  channel: 'sms',
  to: '9876543210',
  subject: null,
  body: 'Hello Asha',
  variables: { patientName: 'Asha' },
  templateKey: 'custom.message',
  ...o,
});

const jsonRes = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('render', () => {
  it('fills variables and reports missing ones', () => {
    expect(render('Hi {{ name }}, token {{tokenNo}}', { name: 'Asha', tokenNo: 7 })).toEqual({ text: 'Hi Asha, token 7', missing: [] });
    expect(render('Hi {{name}} {{x}} end', {})).toEqual({ text: 'Hi end', missing: ['name', 'x'] });
    expect(templateVariables('{{a}} {{b}} {{a}}')).toEqual(['a', 'b']);
  });

  it('counts SMS parts for GSM and Unicode text', () => {
    expect(smsParts('a'.repeat(160))).toBe(1);
    expect(smsParts('a'.repeat(161))).toBe(2);
    expect(smsParts('a'.repeat(306))).toBe(2);
    expect(smsParts('a'.repeat(307))).toBe(3);
    expect(smsParts('€'.repeat(80))).toBe(1);
    expect(smsParts('€'.repeat(81))).toBe(2);
    expect(smsParts('न'.repeat(70))).toBe(1);
    expect(smsParts('न'.repeat(71))).toBe(2);
  });

  it('normalises mobiles and addresses', () => {
    expect(normalizeMobile('+91 98765-43210')).toBe('9876543210');
    expect(normalizeMobile('09876543210')).toBe('9876543210');
    expect(normalizeMobile('12345')).toBeNull();
    expect(normalizeAddress('email', ' A@B.COM ')).toBe('a@b.com');
    expect(normalizeAddress('all', '+919876543210')).toBe('9876543210');
  });

  it('computes IST midnight', () => {
    expect(startOfTodayIST(new Date('2026-10-07T20:00:00Z')).toISOString()).toBe('2026-10-07T18:30:00.000Z');
    expect(startOfTodayIST(new Date('2026-10-07T10:00:00Z')).toISOString()).toBe('2026-10-06T18:30:00.000Z');
  });

  it('maps event payloads to template variables', () => {
    expect(eventData('billing.payment.received', { amount: 1500, mode: 'upi' })).toEqual({ amount: '1,500.00', mode: 'UPI' });
    expect(eventData('frontoffice.visit.checked_in', { tokenNo: 12 })).toEqual({ tokenNo: '12' });
    expect(eventData('frontoffice.appointment.booked', { start: '2026-10-08T12:15:00Z' })).toEqual({ date: '08 Oct 2026', time: '05:45 PM' });
  });
});

describe('providers (no network: fetch is mocked)', () => {
  it('MSG91 sends the flow with variables and needs a template id', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { type: 'success', message: 'req-1' }));
    const p = new Msg91SmsProvider('key', fetchFn);
    await expect(p.send(msg())).rejects.toBeInstanceOf(ProviderError);
    expect(await p.send(msg({ dltTemplateId: 'flow-1' }))).toEqual({ providerMessageId: 'req-1', status: 'sent' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect(init.headers.authkey).toBe('key');
    expect(JSON.parse(init.body)).toEqual({ template_id: 'flow-1', short_url: '0', recipients: [{ mobiles: '919876543210', patientName: 'Asha' }] });
  });

  it('marks 5xx as retryable and 4xx as final', async () => {
    const p = new Msg91SmsProvider('key', vi.fn().mockResolvedValue(new Response('down', { status: 503 })));
    await expect(p.send(msg({ dltTemplateId: 'f' }))).rejects.toMatchObject({ retryable: true });
    const q = new Msg91SmsProvider('key', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })));
    await expect(q.send(msg({ dltTemplateId: 'f' }))).rejects.toMatchObject({ retryable: false });
  });

  it('Gupshup sends a template or a text message', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => jsonRes(202, { status: 'submitted', messageId: 'g1' }));
    const p = new GupshupWhatsappProvider('k', '917000000000', 'hms', fetchFn);
    await p.send(msg({ channel: 'whatsapp' }));
    await p.send(msg({ channel: 'whatsapp', providerTemplateName: 'tpl-1' }));
    const text = new URLSearchParams(fetchFn.mock.calls[0]![1].body);
    expect(fetchFn.mock.calls[0]![0]).toBe('https://api.gupshup.io/wa/api/v1/msg');
    expect(JSON.parse(text.get('message')!)).toEqual({ type: 'text', text: 'Hello Asha' });
    expect(text.get('destination')).toBe('919876543210');
    const tpl = new URLSearchParams(fetchFn.mock.calls[1]![1].body);
    expect(fetchFn.mock.calls[1]![0]).toBe('https://api.gupshup.io/wa/api/v1/template/msg');
    expect(JSON.parse(tpl.get('template')!)).toEqual({ id: 'tpl-1', params: ['Asha'] });
  });

  it('Expo push posts title/body and reads the ticket', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { data: { status: 'ok', id: 'ticket-1' } }));
    const p = new ExpoPushProvider(undefined, fetchFn);
    expect(await p.send(msg({ channel: 'push', to: 'ExponentPushToken[x]', subject: 'Hi' }))).toEqual({ providerMessageId: 'ticket-1', status: 'sent' });
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body)).toMatchObject({ to: 'ExponentPushToken[x]', title: 'Hi', body: 'Hello Asha' });
    const bad = new ExpoPushProvider(undefined, vi.fn().mockResolvedValue(jsonRes(200, { data: { status: 'error', message: 'DeviceNotRegistered' } })));
    await expect(bad.send(msg({ channel: 'push' }))).rejects.toMatchObject({ retryable: false });
  });

  it('SES signs the request with SigV4', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonRes(200, { MessageId: 'ses-1' }));
    const p = new SesEmailProvider({ region: 'ap-south-1', accessKeyId: 'AKID', secretAccessKey: 'secret', fromEmail: 'no-reply@hms.test' }, fetchFn, () => new Date('2026-10-07T00:00:00Z'));
    expect(await p.send(msg({ channel: 'email', to: 'a@b.com', subject: 'S', emailFromName: 'Demo' }))).toEqual({ providerMessageId: 'ses-1', status: 'sent' });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://email.ap-south-1.amazonaws.com/v2/email/outbound-emails');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/20261007\/ap-south-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(JSON.parse(init.body).FromEmailAddress).toBe('"Demo" <no-reply@hms.test>');
    // Signing is deterministic.
    const args = { region: 'r', service: 's', host: 'h', path: '/', body: '{}', accessKeyId: 'a', secretAccessKey: 'b', date: new Date(0) };
    expect(signV4(args)).toEqual(signV4(args));
  });
});
