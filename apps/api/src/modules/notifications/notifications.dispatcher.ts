import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Tx } from '@hms/db';
import { notifications as n } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { EventBus, type EventEnvelope } from '../../common/events/event-bus';
import { emptyContext, requestContext } from '../../common/context/request-context';
import { ProviderError, type OutboundMessage } from './providers/provider';
import { ProvidersService } from './providers/providers.service';
import { PlatformService } from '../platform';
import { NotificationsRepository, type StaffContact } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import { formatAmount, formatDateIST, formatTimeIST, normalizeMobile } from './render';

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
    private readonly platform: PlatformService,
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
    if (!(await this.platform.hasModule(e.tenantId, 'notifications'))) return;
    const ctx = { ...emptyContext(`event:${e.id}`), tenantId: e.tenantId, facilityIds: 'all' as const };
    await requestContext.run(ctx, () =>
      this.db.tx(async (tx) => {
        const rules = (await this.service.effectiveRules(tx, e.topic)).filter((r) => r.isActive && r.channels.length);
        for (const rule of rules) {
          const def = n.NOTIFICATION_EVENTS.find((d) => d.topic === rule.eventTopic && d.templateKey === rule.templateKey);
          if (!def || !matches(def, payload)) continue;
          const data = eventData(e.topic, payload);
          const patientId = str(payload.patientId);
          const base = {
            template: rule.templateKey,
            channels: rule.channels,
            source: { module: e.topic.split('.')[0]!, refId: refIdOf(payload) },
          };

          if (def.recipient === 'patient') {
            const mobile = def.mobileField ? normalizeMobile(str(payload[def.mobileField])) : null;
            if (!patientId && !mobile) continue;
            const to = patientId ? { patientId, mobile: mobile ?? undefined } : { mobile: mobile! };
            await this.service.send(tx, { ...base, to, data, idempotencyKey: `event:${e.id}:${rule.templateKey}` });
            continue;
          }

          // Staff alerts: say which patient, but never message the patient.
          if (patientId) {
            const p = await this.service.lookupPatient(e.tenantId, patientId);
            if (p) Object.assign(data, { patientName: [p.firstName, p.lastName].filter(Boolean).join(' '), uhid: p.uhid });
          }
          const staff =
            def.recipient === 'doctor'
              ? await this.doctor(tx, str(payload[def.userField ?? 'doctorId']))
              : await this.repo.staffWithRoles(tx, def.roles ?? []);
          for (const s of staff) {
            await this.service.send(tx, {
              ...base,
              to: { userId: s.userId, mobile: normalizeMobile(s.mobile) ?? undefined, email: s.email ?? undefined },
              data: { ...data, doctorName: s.name, staffName: s.name },
              idempotencyKey: `event:${e.id}:${rule.templateKey}:${s.userId}`,
            });
          }
        }
      }),
    );
  }

  private async doctor(tx: Tx, userId: string | undefined): Promise<StaffContact[]> {
    if (!userId) return [];
    const c = await this.repo.staffContact(tx, userId);
    return c ? [c] : [];
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** EventDef filters: unlessPresent must be empty; matchAny needs one listed key with an allowed value. */
export function matches(def: n.EventDef, payload: Record<string, unknown>): boolean {
  if (def.unlessPresent && payload[def.unlessPresent] != null) return false;
  if (!def.matchAny) return true;
  return Object.entries(def.matchAny).some(([k, allowed]) => typeof payload[k] === 'string' && allowed.includes(payload[k] as string));
}

const human = (v: string) => v.replace(/_/g, ' ');
const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v);

/** Template variables from an event payload (see the contracts in PARALLEL_PLAN.md section 4). */
export function eventData(topic: string, p: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof p.uhid === 'string') out.uhid = p.uhid;
  if (topic === n.OWNER_SUMMARY_TOPIC) {
    return Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]));
  }
  const start = p.start ?? p.slotStart;
  if (typeof start === 'string' && !Number.isNaN(Date.parse(start))) {
    const d = new Date(start);
    out.date = formatDateIST(d);
    out.time = formatTimeIST(d);
  }
  if (p.tokenNo !== undefined && p.tokenNo !== null) out.tokenNo = String(p.tokenNo);
  if (topic === 'billing.payment.received') {
    if (p.amount !== undefined) out.amount = formatAmount(Number(p.amount));
    if (typeof p.mode === 'string') out.mode = MODE_LABELS[p.mode] ?? p.mode;
  }
  if (typeof p.doctorName === 'string') out.doctorName = p.doctorName;
  for (const k of ['testName', 'value', 'unit', 'orderNo', 'studyName', 'incidentNo', 'complaintNo'] as const) {
    if (typeof p[k] === 'string' || typeof p[k] === 'number') out[k] = String(p[k]);
  }
  if (typeof p.flag === 'string') out.flag = p.flag.toUpperCase();
  if (typeof p.impression === 'string') out.impression = clip(p.impression.replace(/\s+/g, ' ').trim(), 140);
  for (const k of ['severity', 'kind', 'category'] as const) if (typeof p[k] === 'string') out[k] = human(p[k] as string);
  for (const k of ['fromDate', 'toDate'] as const) {
    if (typeof p[k] === 'string' && !Number.isNaN(Date.parse(p[k] as string))) out[k] = formatDateIST(new Date(`${(p[k] as string).slice(0, 10)}T12:00:00+05:30`));
  }
  if (typeof p.status === 'string') out.status = human(p.status);
  if (topic === 'hr.leave.cancelled') out.status = 'cancelled';
  if (typeof p.month === 'string') out.month = p.month;
  if (p.employeeCount !== undefined) out.employeeCount = String(p.employeeCount);
  if (p.netTotal !== undefined) out.netTotal = formatAmount(Number(p.netTotal));
  const reportName = p.title ?? p.studyName ?? p.testName ?? p.panelName;
  if (typeof reportName === 'string') out.reportName = reportName;
  return out;
}

function refIdOf(p: Record<string, unknown>): string | undefined {
  for (const k of ['appointmentId', 'requestId', 'visitId', 'invoiceId', 'prescriptionId', 'encounterId', 'reportId', 'resultId', 'orderId', 'incidentId', 'complaintId', 'leaveId', 'runId', 'refId', 'patientId']) {
    if (typeof p[k] === 'string') return p[k] as string;
  }
  return undefined;
}
