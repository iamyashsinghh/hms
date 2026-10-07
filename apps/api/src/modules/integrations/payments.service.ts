import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { iso } from '@hms/db';
import { integrations, type Paginated } from '@hms/shared';
import { currentContext } from '../../common/context/request-context';
import { DbService } from '../../common/db/db.service';
import { AppError, badRequest, conflict, notFound } from '../../common/errors/errors';
import { OutboxService } from '../../common/events/outbox.service';
import { BillingService } from '../billing/billing.service';
import { MockPaymentGateway, type GatewayPaymentEvent } from './adapters/payment.gateway';
import { IntegrationsRepository, type PaymentIntentRow } from './integrations.repository';
import { IntegrationSettingsService } from './settings.service';

const PROVIDERS = ['mock', 'razorpay'] as const;
type Provider = (typeof PROVIDERS)[number];
type Headers = Record<string, string | string[] | undefined>;

/** Gateway payment method -> Billing payment mode. */
const MODE: Record<string, 'upi' | 'card' | 'bank'> = { upi: 'upi', card: 'card', netbanking: 'bank', emandate: 'bank', nach: 'bank' };

/**
 * Online payment links for bills. The gateway tells us the outcome by webhook; a captured payment is
 * posted to the bill with BillingService.collectPayment and announced as `integrations.payment.captured`.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly repo: IntegrationsRepository,
    private readonly settings: IntegrationSettingsService,
    private readonly billing: BillingService,
    private readonly outbox: OutboxService,
  ) {}

  async create(input: integrations.CreatePaymentIntent): Promise<integrations.PaymentIntent> {
    const d = integrations.createPaymentIntentSchema.parse(input);
    const s = await this.db.tx((tx) => this.settings.effective(tx));
    if (s.paymentProvider === 'none') {
      throw conflict('payments_disabled', 'Online payments are switched off. Choose a payment gateway in Integrations settings.');
    }
    const invoice = await this.billing.getInvoice(d.invoiceId);
    if (invoice.status !== 'final') throw conflict('invoice_not_final', 'Finalize the bill before sending a payment link');
    if (invoice.balance <= 0) throw conflict('nothing_due', 'Nothing is due on this bill');
    const amount = d.amount ?? invoice.balance;
    if (amount > invoice.balance) throw badRequest('overpayment', `Only ₹${invoice.balance.toFixed(2)} is due on this bill`, { balance: invoice.balance });
    const open = await this.db.tx((tx) => this.repo.openIntentForInvoice(tx, invoice.id));
    if (open) throw conflict('open_payment_link', 'This bill already has an open payment link. Cancel it first.');

    const provider = s.paymentProvider;
    const order = await this.settings.paymentGateway(provider).createOrder({
      amount,
      receipt: invoice.number ?? invoice.id,
      keyId: s.paymentKeyId,
      notes: { invoiceId: invoice.id, patientUhid: invoice.patientUhid },
    });
    const userId = currentContext()?.userId ?? null;
    return this.db.tx(async (tx) => {
      const row = await this.repo.insertIntent(tx, {
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        amount: amount.toFixed(2),
        provider,
        providerOrderId: order.orderId,
        checkout: order.checkout,
        createdBy: userId,
        updatedBy: userId,
      });
      return intentDto(row);
    });
  }

  list(query: unknown): Promise<Paginated<integrations.PaymentIntent>> {
    const q = integrations.paymentIntentQuerySchema.parse(query);
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.intents(tx, q);
      return { items: items.map(intentDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  get(id: string): Promise<integrations.PaymentIntent> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.intent(tx, id);
      if (!row) throw notFound('Payment link');
      return intentDto(row);
    });
  }

  cancel(id: string): Promise<integrations.PaymentIntent> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.intent(tx, id, true);
      if (!row) throw notFound('Payment link');
      if (row.status !== 'created') throw conflict('payment_link_closed', `This payment link is already ${row.status}`);
      return intentDto(await this.repo.updateIntent(tx, id, { status: 'cancelled', updatedBy: currentContext()?.userId ?? null }));
    });
  }

  /** Mock provider: plays the gateway's webhook through the same path a real one takes. */
  async mockComplete(id: string, input: integrations.MockPaymentOutcome): Promise<integrations.PaymentIntent> {
    const d = integrations.mockPaymentOutcomeSchema.parse(input);
    const row = await this.db.tx((tx) => this.repo.intent(tx, id));
    if (!row) throw notFound('Payment link');
    if (row.provider !== 'mock') throw conflict('mock_only', 'Only mock payment links can be simulated');
    if (row.status !== 'created') throw conflict('payment_link_closed', `This payment link is already ${row.status}`);
    const hook = this.settings.mockPayments.buildWebhook(row.providerOrderId, Number(row.amount), d.outcome);
    await this.handleWebhook('mock', JSON.parse(hook.body), hook.body, { [MockPaymentGateway.SIGNATURE_HEADER]: hook.signature });
    return this.get(id);
  }

  /**
   * Gateway webhook. The controller has already bound the hospital from the URL. The signature is
   * checked over the raw request body; at-least-once delivery is fine because each order settles once.
   */
  async handleWebhook(provider: string, body: unknown, raw: string, headers: Headers): Promise<{ ok: true; matched: boolean }> {
    if (!PROVIDERS.includes(provider as Provider)) throw notFound('Payment provider');
    const gateway = this.settings.paymentGateway(provider as Provider);
    if (!gateway.verifySignature(raw, headers)) {
      throw new AppError(HttpStatus.UNAUTHORIZED, 'invalid_signature', 'Webhook signature is not valid');
    }
    const event = gateway.parseEvent(body);
    if (event.outcome === 'ignored') return { ok: true, matched: false };

    const step = await this.db.tx(async (tx) => {
      const row = await this.repo.intentByOrder(tx, provider, event.orderId);
      if (!row) return null;
      if (event.outcome === 'failed') {
        if (row.status !== 'created') return { row, settle: false };
        return { row: await this.repo.updateIntent(tx, row.id, { status: 'failed', failureReason: event.failureReason ?? 'Payment failed', providerPaymentId: event.paymentId }), settle: false };
      }
      if (row.status === 'paid') return { row, settle: false };
      // Money taken on a link that was cancelled or had failed earlier is still posted to the bill.
      const paid = await this.repo.updateIntent(tx, row.id, { status: 'paid', providerPaymentId: event.paymentId, paidAt: new Date().toISOString(), failureReason: null });
      const captured: integrations.PaymentCapturedEvent = {
        intentId: paid.id,
        invoiceId: paid.invoiceId,
        patientId: paid.patientId,
        amount: Number(paid.amount),
        provider,
        providerPaymentId: event.paymentId ?? '',
      };
      await this.outbox.publish(tx, 'integrations.payment.captured', { ...captured });
      return { row: paid, settle: true };
    });
    if (!step) {
      this.logger.warn(`${provider} webhook for unknown order ${event.orderId}`);
      return { ok: true, matched: false };
    }
    if (step.settle) await this.settle(step.row, event);
    return { ok: true, matched: true };
  }

  /** Posts the captured money to the bill. A failure is kept on the link for staff to sort out. */
  private async settle(row: PaymentIntentRow, event: GatewayPaymentEvent) {
    try {
      await this.billing.collectPayment(row.invoiceId, {
        mode: MODE[event.method ?? ''] ?? 'upi',
        amount: Number(row.amount),
        reference: (event.paymentId ?? row.providerOrderId).slice(0, 100),
        notes: `Online payment via ${row.provider} (order ${row.providerOrderId})`.slice(0, 500),
      });
      await this.db.tx((tx) => this.repo.updateIntent(tx, row.id, { settlementStatus: 'recorded', settlementError: null }));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not post the payment to the bill';
      this.logger.error(`payment ${row.id} captured but not posted to invoice ${row.invoiceId}: ${message}`);
      await this.db.tx((tx) => this.repo.updateIntent(tx, row.id, { settlementStatus: 'error', settlementError: message.slice(0, 500) }));
    }
  }
}

export function intentDto(r: PaymentIntentRow): integrations.PaymentIntent {
  return {
    id: r.id,
    invoiceId: r.invoiceId,
    patientId: r.patientId,
    amount: Number(r.amount),
    currency: 'INR',
    provider: r.provider as Provider,
    providerOrderId: r.providerOrderId,
    providerPaymentId: r.providerPaymentId,
    status: r.status as integrations.PaymentIntentStatus,
    settlementStatus: r.settlementStatus as integrations.SettlementStatus,
    settlementError: r.settlementError,
    checkout: r.checkout as integrations.PaymentIntent['checkout'],
    failureReason: r.failureReason,
    paidAt: iso(r.paidAt),
    createdAt: iso(r.createdAt),
  };
}
