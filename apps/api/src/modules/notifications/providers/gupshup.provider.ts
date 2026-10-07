import { httpFailure, ProviderError, type FetchFn, type MessageProvider, type OutboundMessage, type SendOutcome } from './provider';

/**
 * WhatsApp through Gupshup. Uses the approved template (providerTemplateName = Gupshup template id)
 * when set, otherwise a plain text session message (only works inside the 24-hour window).
 */
export class GupshupWhatsappProvider implements MessageProvider {
  readonly name = 'gupshup';
  readonly channel = 'whatsapp' as const;

  constructor(
    private readonly apiKey: string,
    private readonly source: string,
    private readonly appName: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(m: OutboundMessage): Promise<SendOutcome> {
    const form = new URLSearchParams({ channel: 'whatsapp', source: this.source, destination: `91${m.to}`, 'src.name': this.appName });
    let url = 'https://api.gupshup.io/wa/api/v1/msg';
    if (m.providerTemplateName) {
      url = 'https://api.gupshup.io/wa/api/v1/template/msg';
      form.set('template', JSON.stringify({ id: m.providerTemplateName, params: Object.values(m.variables) }));
    } else {
      form.set('message', JSON.stringify({ type: 'text', text: m.body }));
    }
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { apikey: this.apiKey, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw await httpFailure(this.name, res);
    const data = (await res.json()) as { status?: string; messageId?: string; message?: string };
    if (data.status !== 'submitted') throw new ProviderError(`gupshup: ${data.message ?? 'rejected'}`, false);
    return { providerMessageId: data.messageId ?? null, status: 'sent' };
  }
}
