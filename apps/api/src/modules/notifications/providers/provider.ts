import type { notifications } from '@hms/shared';

export type Channel = notifications.Channel;

/** A rendered message ready for a provider. */
export interface OutboundMessage {
  /** Our message id; providers that support it use it as an idempotency/reference key. */
  id: string;
  tenantId: string;
  channel: Channel;
  /** Mobile (10 digits), email address or push token. */
  to: string;
  subject: string | null;
  body: string;
  /** Template variables, for providers that send pre-approved templates (DLT SMS, WhatsApp). */
  variables: Record<string, string>;
  templateKey: string;
  /** MSG91 flow id / DLT template id for SMS. */
  dltTemplateId?: string | null;
  /** Approved WhatsApp template id. */
  providerTemplateName?: string | null;
  smsSenderId?: string | null;
  emailFromName?: string | null;
  emailReplyTo?: string | null;
}

export interface SendOutcome {
  providerMessageId: string | null;
  /** Most providers only confirm acceptance ('sent'); delivery comes later. */
  status: 'sent' | 'delivered';
}

/** Thrown by providers. retryable=false marks the message failed straight away. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface MessageProvider {
  readonly name: string;
  readonly channel: Channel;
  send(message: OutboundMessage): Promise<SendOutcome>;
}

/** Maps an HTTP failure to a ProviderError: 429 and 5xx are worth retrying, other 4xx are not. */
export async function httpFailure(provider: string, res: Response): Promise<ProviderError> {
  const text = (await res.text().catch(() => '')).slice(0, 300);
  return new ProviderError(`${provider} HTTP ${res.status}: ${text}`, res.status === 429 || res.status >= 500);
}

export type FetchFn = typeof fetch;
