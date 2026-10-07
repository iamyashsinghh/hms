import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { notifications as n } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EventBus, type EventEnvelope } from '../../common/events/event-bus';
import { emptyContext, requestContext } from '../../common/context/request-context';
import { ProviderError, type OutboundMessage } from './providers/provider';
import { ProvidersService } from './providers/providers.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { formatAmount, formatDateIST, formatTimeIST } from './render';

/** Provider attempts per message before it is marked failed and refunded. */
export const MAX_ATTEMPTS = 3;

const MODE_LABELS: Record<string, string> = { cash: 'cash', upi: 'UPI', card: 'card', netbanking: 'net banking', cheque: 'cheque' };

/**
 * Runs in the worker. Delivers queued messages through the providers and turns other modules'
 * events into messages using the hospital's rules. Every handler is idempotent.
 */
@Injectable()
export class NotificationsDispatcher implements OnModuleInit {
  private readonly logger = new Logger(NotificationsDispatcher.name);

  constructor(
    private readonly db: DbService,
    private readonly bus: EventBus,
    private readonly repo: NotificationsRepository,
    private readonly service: NotificationsService,
    private readonly providers: ProvidersService,
  ) {}

  onModuleInit() {
    this.bus.on<n.MessageQueuedEvent>('notifications.message.queued', (e) => this.deliver(e.tenantId, e.payload.messageId));
    for (const event of n.NOTIFICATION_EVENTS) {
      this.bus.on(event.topic, (e) => this.onDomainEvent(e));
    }
  }

  /** Sends one queued message. Throws only to ask BullMQ for a retry. */
  async deliver(tenantId: string, messageId: string): Promise<void> {
    const scope = { tenantId };
    const claim = await this.db.asTenant(scope, async (tx) => {
      const m = await this.repo.findMessage(tx, messageId, true);
      if (!m || m.status !== 'queued') return null;
      const settings = await this.service.settingsRow(tx);
      const attempts = m.attempts + 1;
      await this.repo.updateMessage(tx, m.id, { attempts });
      return { m, settings, attempts };
    });
    if (!claim) return;
    const { m, settings, attempts } = claim;
    const provider = this.providers.get(m.channel as n.Channel);
    const meta = m.meta as { variables?: Record<string, string>; dltTemplateId?: string | null; providerTemplateName?: string | null };
    const outbound: OutboundMessage = {
      id: m.id,
      tenantId,
      channel: m.channel as n.Channel,
      to: m.recipient!,
      subject: m.subject,
      body: m.body,
      variables: meta.variables ?? {},
      templateKey: m.templateKey,
      dltTemplateId: meta.dltTemplateId,
      providerTemplateName: meta.providerTemplateName,
      smsSenderId: settings.smsSenderId,
      emailFromName: settings.emailFromName,
      emailReplyTo: settings.emailReplyTo,
    };

    try {
      const out = await provider.send(outbound);
      await this.db.asTenant(scope, (tx) =>
        this.repo.updateMessage(tx, m.id, {
          status: out.status,
          provider: provider.name,
          providerMessageId: out.providerMessageId,
          error: null,
          sentAt: new Date().toISOString(),
          deliveredAt: out.status === 'delivered' ? new Date().toISOString() : null,
        }),
      );
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      const retryable = !(err instanceof ProviderError) || err.retryable;
      if (retryable && attempts < MAX_ATTEMPTS) {
        await this.db.asTenant(scope, (tx) => this.repo.updateMessage(tx, m.id, { provider: provider.name, error: message }));
        throw err;
      }
      this.logger.warn(`message ${m.id} failed after ${attempts} attempt(s): ${message}`);
      await this.db.asTenant(scope, async (tx) => {
        await this.repo.updateMessage(tx, m.id, {
          status: 'failed',
          reason: 'provider_error',
          provider: provider.name,
          error: message,
          failedAt: new Date().toISOString(),
        });
        const cost = Number(m.cost);
        if (cost > 0 && !(await this.repo.hasRefund(tx, m.id))) {
          await this.repo.insertLedger(tx, { tenantId, entryType: 'refund', amount: cost.toFixed(2), channel: m.channel, messageId: m.id, note: 'Delivery failed' });
        }
      });
    }
  }

  /** Applies the hospital's rules to another module's event. */
  async onDomainEvent(e: EventEnvelope): Promise<void> {
    const payload = e.payload as Record<string, unknown>;
    const patientId = typeof payload.patientId === 'string' ? payload.patientId : undefined;
    if (!patientId) return;
    const ctx = { ...emptyContext(`event:${e.id}`), tenantId: e.tenantId, facilityIds: 'all' as const };
    await requestContext.run(ctx, () =>
      this.db.tx(async (tx) => {
        const rules = (await this.service.effectiveRules(tx, e.topic)).filter((r) => r.isActive && r.channels.length);
        for (const rule of rules) {
          await this.service.send(tx, {
            to: { patientId },
            template: rule.templateKey,
            data: eventData(e.topic, payload),
            channels: rule.channels,
            idempotencyKey: `event:${e.id}:${rule.templateKey}`,
            source: { module: e.topic.split('.')[0]!, refId: refIdOf(payload) },
          });
        }
      }),
    );
  }
}

/** Template variables from an event payload (see the contracts in PARALLEL_PLAN.md section 4). */
export function eventData(topic: string, p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof p.uhid === 'string') out.uhid = p.uhid;
  if (typeof p.start === 'string' && !Number.isNaN(Date.parse(p.start))) {
    const d = new Date(p.start);
    out.date = formatDateIST(d);
    out.time = formatTimeIST(d);
  }
  if (p.tokenNo !== undefined && p.tokenNo !== null) out.tokenNo = String(p.tokenNo);
  if (topic === 'billing.payment.received') {
    if (p.amount !== undefined) out.amount = formatAmount(Number(p.amount));
    if (typeof p.mode === 'string') out.mode = MODE_LABELS[p.mode] ?? p.mode;
  }
  if (typeof p.doctorName === 'string') out.doctorName = p.doctorName;
  return out;
}

function refIdOf(p: Record<string, unknown>): string | undefined {
  for (const k of ['appointmentId', 'visitId', 'invoiceId', 'prescriptionId', 'encounterId', 'patientId']) {
    if (typeof p[k] === 'string') return p[k] as string;
  }
  return undefined;
}
