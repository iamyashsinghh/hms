import { createHash, createHmac } from 'node:crypto';
import { httpFailure, type FetchFn, type MessageProvider, type OutboundMessage, type SendOutcome } from './provider';

export interface SesCredentials {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  fromEmail: string;
}

/** Email through Amazon SES v2 (SendEmail), signed with AWS Signature V4 so no SDK is needed. */
export class SesEmailProvider implements MessageProvider {
  readonly name = 'ses';
  readonly channel = 'email' as const;

  constructor(
    private readonly creds: SesCredentials,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async send(m: OutboundMessage): Promise<SendOutcome> {
    const from = m.emailFromName ? `"${m.emailFromName.replace(/"/g, '')}" <${this.creds.fromEmail}>` : this.creds.fromEmail;
    const body = JSON.stringify({
      FromEmailAddress: from,
      Destination: { ToAddresses: [m.to] },
      ReplyToAddresses: m.emailReplyTo ? [m.emailReplyTo] : undefined,
      Content: {
        Simple: {
          Subject: { Data: m.subject ?? '', Charset: 'UTF-8' },
          Body: { Text: { Data: m.body, Charset: 'UTF-8' } },
        },
      },
    });
    const host = `email.${this.creds.region}.amazonaws.com`;
    const path = '/v2/email/outbound-emails';
    const headers = signV4({ ...this.creds, service: 'ses', host, path, body, date: this.now() });
    const res = await this.fetchFn(`https://${host}${path}`, { method: 'POST', headers, body });
    if (!res.ok) throw await httpFailure(this.name, res);
    const data = (await res.json()) as { MessageId?: string };
    return { providerMessageId: data.MessageId ?? null, status: 'sent' };
  }
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s, 'utf8').digest();

/** AWS Signature V4 headers for a JSON POST. */
export function signV4(p: {
  region: string;
  service: string;
  host: string;
  path: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}): Record<string, string> {
  const amzDate = p.date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(p.body);
  const canonicalHeaders = `content-type:application/json\nhost:${p.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['POST', p.path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${p.region}/${p.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${p.secretAccessKey}`, day), p.region), p.service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    'content-type': 'application/json',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    authorization: `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
