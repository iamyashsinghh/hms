import { httpFailure, ProviderError, type FetchFn, type MessageProvider, type OutboundMessage, type SendOutcome } from './provider';

/** Push notifications through the Expo push service. */
export class ExpoPushProvider implements MessageProvider {
  readonly name = 'expo';
  readonly channel = 'push' as const;

  constructor(
    private readonly accessToken: string | undefined,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async send(m: OutboundMessage): Promise<SendOutcome> {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
    if (this.accessToken) headers.authorization = `Bearer ${this.accessToken}`;
    const res = await this.fetchFn('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: m.to, title: m.subject ?? undefined, body: m.body, data: { messageId: m.id, template: m.templateKey } }),
    });
    if (!res.ok) throw await httpFailure(this.name, res);
    const { data } = (await res.json()) as { data?: { status: string; id?: string; message?: string } };
    if (data?.status !== 'ok') throw new ProviderError(`expo: ${data?.message ?? 'rejected'}`, false);
    return { providerMessageId: data.id ?? null, status: 'sent' };
  }
}
