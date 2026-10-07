export interface WebhookSendResult {
  ok: boolean;
  status: number | null;
  error: string | null;
  dryRun: boolean;
}

/** Sends one signed webhook. */
export interface WebhookTransport {
  send(url: string, body: string, headers: Record<string, string>): Promise<WebhookSendResult>;
}

/** Default: records the delivery without any network call (INTEGRATIONS_WEBHOOKS_LIVE is not "true"). */
export class DryRunWebhookTransport implements WebhookTransport {
  async send(): Promise<WebhookSendResult> {
    return { ok: true, status: null, error: null, dryRun: true };
  }
}

/** POSTs to the subscriber with a 5 s timeout; 2xx counts as delivered. */
export class HttpWebhookTransport implements WebhookTransport {
  async send(url: string, body: string, headers: Record<string, string>): Promise<WebhookSendResult> {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body, redirect: 'manual', signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}`, dryRun: false };
    } catch (e) {
      return { ok: false, status: null, error: e instanceof Error ? e.message.slice(0, 300) : 'send failed', dryRun: false };
    }
  }
}

export const WEBHOOK_TRANSPORT = Symbol('WEBHOOK_TRANSPORT');
