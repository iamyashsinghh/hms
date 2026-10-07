import { httpFailure, ProviderError, type FetchFn, type MessageProvider, type OutboundMessage, type SendOutcome } from './provider';

/**
 * SMS through MSG91 Flow API (DLT-registered templates). The template's dltTemplateId holds the
 * MSG91 flow/template id; variables are sent as flow variables.
 */
export class Msg91SmsProvider implements MessageProvider {
  readonly name = 'msg91';
  readonly channel = 'sms' as const;

  constructor(
    private readonly authKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(m: OutboundMessage): Promise<SendOutcome> {
    if (!m.dltTemplateId) throw new ProviderError('SMS template has no DLT/MSG91 template id', false);
    const res = await this.fetchFn('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: this.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        template_id: m.dltTemplateId,
        short_url: '0',
        recipients: [{ mobiles: `91${m.to}`, ...m.variables }],
      }),
    });
    if (!res.ok) throw await httpFailure(this.name, res);
    const data = (await res.json()) as { type?: string; message?: string };
    if (data.type !== 'success') throw new ProviderError(`msg91: ${data.message ?? 'rejected'}`, false);
    return { providerMessageId: data.message ?? null, status: 'sent' };
  }
}
