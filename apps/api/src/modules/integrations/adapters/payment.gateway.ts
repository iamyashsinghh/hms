import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/errors';
import { hmacSha256, safeEqual } from '../crypto';

export interface GatewayOrder {
  orderId: string;
  checkout: { keyId: string | null; orderId: string; payUrl: string | null };
}

/** What a provider webhook tells us, normalised. */
export interface GatewayPaymentEvent {
  orderId: string;
  paymentId: string | null;
  outcome: 'paid' | 'failed' | 'ignored';
  /** Rupees. */
  amount: number | null;
  method: string | null;
  failureReason: string | null;
}

export interface PaymentGateway {
  readonly name: 'mock' | 'razorpay';
  createOrder(input: { amount: number; receipt: string; keyId: string | null; notes: Record<string, string> }): Promise<GatewayOrder>;
  /** `body` is the request body exactly as received. */
  verifySignature(body: string, headers: Record<string, string | string[] | undefined>): boolean;
  parseEvent(payload: unknown): GatewayPaymentEvent;
}

const header = (h: Record<string, string | string[] | undefined>, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Built-in simulator: orders are local ids, webhooks are signed with MOCK_PAYMENT_WEBHOOK_SECRET. */
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock' as const;
  static readonly SIGNATURE_HEADER = 'x-mock-signature';
  constructor(private readonly secret: string) {}

  async createOrder(_input: { amount: number; receipt: string }): Promise<GatewayOrder> {
    const orderId = `order_mock_${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    return { orderId, checkout: { keyId: null, orderId, payUrl: null } };
  }

  verifySignature(body: string, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = header(headers, MockPaymentGateway.SIGNATURE_HEADER);
    return !!this.secret && !!sig && safeEqual(sig, hmacSha256(this.secret, body));
  }

  /** Builds the webhook the simulator "sends" when the customer finishes paying. */
  buildWebhook(orderId: string, amount: number, outcome: 'success' | 'failure'): { body: string; signature: string } {
    const payload = {
      event: outcome === 'success' ? 'payment.captured' : 'payment.failed',
      orderId,
      paymentId: `pay_mock_${randomUUID().replace(/-/g, '').slice(0, 14)}`,
      amount,
      method: 'upi',
      error: outcome === 'success' ? null : 'Payment declined by the bank (simulated)',
    };
    const body = JSON.stringify(payload);
    return { body, signature: hmacSha256(this.secret, body) };
  }

  parseEvent(payload: unknown): GatewayPaymentEvent {
    const p = payload as { event?: string; orderId?: string; paymentId?: string; amount?: number; method?: string; error?: string | null };
    if (!p?.orderId) return { orderId: '', paymentId: null, outcome: 'ignored', amount: null, method: null, failureReason: null };
    const outcome = p.event === 'payment.captured' ? 'paid' : p.event === 'payment.failed' ? 'failed' : 'ignored';
    return { orderId: p.orderId, paymentId: p.paymentId ?? null, outcome, amount: p.amount ?? null, method: p.method ?? null, failureReason: p.error ?? null };
  }
}

/**
 * Razorpay. Orders: POST https://api.razorpay.com/v1/orders (basic auth key id + secret, amount in paise).
 * Webhooks: `X-Razorpay-Signature` = HMAC-SHA256(webhook secret, raw body). Needs RAZORPAY_KEY_SECRET and
 * RAZORPAY_WEBHOOK_SECRET on the server and the key id in hospital settings; without them it refuses to run.
 */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  constructor(private readonly secrets: { keySecret: string; webhookSecret: string } | null) {}

  async createOrder(input: { amount: number; receipt: string; keyId: string | null; notes: Record<string, string> }): Promise<GatewayOrder> {
    if (!this.secrets || !input.keyId) {
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'integration_not_configured', 'Razorpay keys are not set up for this hospital yet');
    }
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${input.keyId}:${this.secrets.keySecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ amount: Math.round(input.amount * 100), currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new AppError(HttpStatus.BAD_GATEWAY, 'gateway_error', `Razorpay refused the order (${res.status})`);
    const order = (await res.json()) as { id: string };
    return { orderId: order.id, checkout: { keyId: input.keyId, orderId: order.id, payUrl: null } };
  }

  verifySignature(body: string, headers: Record<string, string | string[] | undefined>): boolean {
    const sig = header(headers, 'x-razorpay-signature');
    return !!this.secrets && !!sig && safeEqual(sig, hmacSha256(this.secrets.webhookSecret, body));
  }

  parseEvent(payload: unknown): GatewayPaymentEvent {
    const p = payload as { event?: string; payload?: { payment?: { entity?: { id: string; order_id: string; amount: number; method?: string; error_description?: string } } } };
    const e = p?.payload?.payment?.entity;
    if (!e?.order_id) return { orderId: '', paymentId: null, outcome: 'ignored', amount: null, method: null, failureReason: null };
    const outcome = p.event === 'payment.captured' ? 'paid' : p.event === 'payment.failed' ? 'failed' : 'ignored';
    return { orderId: e.order_id, paymentId: e.id, outcome, amount: e.amount / 100, method: e.method ?? null, failureReason: e.error_description ?? null };
  }
}
