import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacSha256 = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('hex');
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');

/** Constant-time comparison of two hex/ascii strings. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Keep only the last 4 characters: 1234 5678 9012 -> ********9012. */
export function mask(value: string, keep = 4): string {
  const v = value.replace(/[\s-]/g, '');
  return v.length <= keep ? v : '*'.repeat(v.length - keep) + v.slice(-keep);
}

// ---------- Public API keys: hmsk.<tenantId>.<keyId>.<secret> ----------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function formatApiKey(tenantId: string, keyId: string, secret: string): string {
  return `hmsk.${tenantId}.${keyId}.${secret}`;
}

export function parseApiKey(key: string): { tenantId: string; keyId: string; secret: string } | null {
  const parts = key.trim().split('.');
  if (parts.length !== 4 || parts[0] !== 'hmsk') return null;
  const [, tenantId, keyId, secret] = parts;
  if (!UUID.test(tenantId) || !UUID.test(keyId) || secret.length < 20) return null;
  return { tenantId, keyId, secret };
}

// ---------- Outbound webhook signatures ----------

/** `x-hms-signature: t=<unix>,v1=<hex hmac of "<t>.<body>">` (same idea as Stripe). */
export function signWebhook(secret: string, body: string, at = Math.floor(Date.now() / 1000)): string {
  return `t=${at},v1=${hmacSha256(secret, `${at}.${body}`)}`;
}
