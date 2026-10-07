import { Injectable } from '@nestjs/common';
import { iso, sql, type Tx } from '@hms/db';
import { notifications as n, type Paginated } from '@hms/shared';
import { DbService } from '../../common/db/db.service';
import { OutboxService } from '../../common/events/outbox.service';
import { currentContext, emptyContext, requestContext } from '../../common/context/request-context';
import { badRequest, conflict, notFound } from '../../common/errors/errors';
import { PatientsService } from '../patients/patients.service';
import { ProvidersService } from './providers/providers.service';
import { normalizeAddress, normalizeMobile, render, smsParts, startOfTodayIST, templateVariables } from './render';
import {
  NotificationsRepository,
  type DeviceRow,
  type LedgerRow,
  type MessageRow,
  type OptOutRow,
  type SettingsRow,
  type TemplateRow,
} from './notifications.repository';

type Channel = n.Channel;
type Data = Record<string, string | number | boolean | null | undefined>;

interface EffectiveTemplate {
  subject: string | null;
  body: string;
  dltTemplateId: string | null;
  providerTemplateName: string | null;
  isActive: boolean;
}

interface ResolvedRecipient {
  mobile: string | null;
  email: string | null;
  patientId: string | null;
  userId: string | null;
  patientName: string | null;
}

const DEFAULTS = new Map(n.DEFAULT_TEMPLATES.map((t) => [t.key, t]));

/**
 * Messaging for every module. Other modules import NotificationsModule and call
 * `send(tx, {...})` inside their own transaction; messages go out only if that transaction commits.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DbService,
    private readonly repo: NotificationsRepository,
    private readonly outbox: OutboxService,
    private readonly patients: PatientsService,
    private readonly providers: ProvidersService,
  ) {}

  // =====================================================================
  // send() — the cross-module contract
  // =====================================================================

  /**
   * Queue a templated message on one or more channels. Never throws for delivery problems:
   * a channel that cannot be used is logged as 'skipped' with a reason.
   */
  async send(tx: Tx, input: n.SendInput): Promise<n.SendResult> {
    const settings = await this.settingsRow(tx);
    const tenantId = settings.tenantId;
    const channels = [...new Set(input.channels?.length ? input.channels : (settings.defaultChannels as Channel[]))];
    const who = await this.resolveRecipient(tenantId, input.to);
    const data: Data = {
      hospitalName: await this.hospitalName(tx, settings),
      ...(who.patientName ? { patientName: who.patientName } : {}),
      ...input.data,
    };
    const result: n.SendResult = { messages: [] };
    const actor = currentContext()?.userId ?? null;

    for (const channel of channels) {
      const base = {
        tenantId,
        channel,
        templateKey: input.template,
        patientId: who.patientId,
        userId: who.userId,
        sourceModule: input.source?.module ?? null,
        sourceRef: input.source?.refId ?? null,
        createdBy: actor,
      };
      const idem = (suffix = '') => (input.idempotencyKey ? `${input.idempotencyKey}:${channel}${suffix}` : null);

      const existing = idem() ? await this.repo.findByIdempotencyKey(tx, idem()!) : undefined;
      if (existing) {
        result.messages.push(summary(existing));
        continue;
      }

      const skip = async (reason: (typeof n.MESSAGE_REASONS)[number], recipient: string | null = null, body = '') => {
        const row = await this.repo.insertMessage(tx, { ...base, recipient, body, status: 'skipped', reason, idempotencyKey: idem() });
        result.messages.push(summary(row));
      };

      const tpl = await this.effectiveTemplate(tx, input.template, channel);
      if (!tpl || !tpl.isActive) {
        await skip('no_template');
        continue;
      }
      if (!settings.enabledChannels.includes(channel)) {
        await skip('channel_disabled');
        continue;
      }

      const addresses = await this.addressesFor(tx, channel, who);
      if (!addresses.length) {
        await skip('no_address');
        continue;
      }

      for (const [i, address] of addresses.entries()) {
        const key = idem(addresses.length > 1 ? `:${i}` : '');
        const subject = tpl.subject ? render(tpl.subject, data).text : null;
        const rendered = render(tpl.body, data);
        if (await this.repo.isOptedOut(tx, channel, normalizeAddress(channel, address))) {
          const row = await this.repo.insertMessage(tx, { ...base, recipient: address, subject, body: rendered.text, status: 'skipped', reason: 'opted_out', idempotencyKey: key });
          result.messages.push(summary(row));
          continue;
        }
        const cost = costOf(channel, rendered.text, settings);
        const variables = Object.fromEntries(templateVariables(tpl.body).map((v) => [v, data[v] == null ? '' : String(data[v])]));
        const meta = { variables, missing: rendered.missing, dltTemplateId: tpl.dltTemplateId, providerTemplateName: tpl.providerTemplateName };

        if (cost > 0) {
          await this.repo.lockCredits(tx);
          const balance = await this.repo.balance(tx);
          if (balance < cost) {
            const row = await this.repo.insertMessage(tx, { ...base, recipient: address, subject, body: rendered.text, status: 'skipped', reason: 'insufficient_credits', cost: '0', idempotencyKey: key, meta });
            result.messages.push(summary(row));
            continue;
          }
          const row = await this.repo.insertMessage(tx, { ...base, recipient: address, subject, body: rendered.text, status: 'queued', cost: cost.toFixed(2), idempotencyKey: key, meta });
          await this.repo.insertLedger(tx, { tenantId, entryType: 'debit', amount: (-cost).toFixed(2), channel, messageId: row.id, createdBy: actor });
          await this.maybeLowBalance(tx, settings, balance, balance - cost);
          await this.outbox.publish(tx, 'notifications.message.queued', { messageId: row.id } satisfies n.MessageQueuedEvent, tenantId);
          result.messages.push(summary(row));
        } else {
          const row = await this.repo.insertMessage(tx, { ...base, recipient: address, subject, body: rendered.text, status: 'queued', idempotencyKey: key, meta });
          await this.outbox.publish(tx, 'notifications.message.queued', { messageId: row.id } satisfies n.MessageQueuedEvent, tenantId);
          result.messages.push(summary(row));
        }
      }
    }
    return result;
  }

  private async resolveRecipient(tenantId: string, to: n.Recipient): Promise<ResolvedRecipient> {
    const out: ResolvedRecipient = {
      mobile: normalizeMobile(to.mobile),
      email: to.email?.toLowerCase() ?? null,
      patientId: to.patientId ?? null,
      userId: to.userId ?? null,
      patientName: null,
    };
    if (to.patientId) {
      const patient = await this.lookupPatient(tenantId, to.patientId);
      if (patient) {
        out.mobile ??= normalizeMobile(patient.mobile);
        out.email ??= patient.email?.toLowerCase() ?? null;
        out.patientName = [patient.firstName, patient.lastName].filter(Boolean).join(' ');
      } else {
        // Unknown in this hospital (or not committed yet): keep the id off the row so the FK holds.
        out.patientId = null;
      }
    }
    return out;
  }

  /** Reads the patient through PatientsService (works in requests and in the worker). */
  private async lookupPatient(tenantId: string, patientId: string) {
    const get = () => this.patients.get(patientId).catch(() => null);
    const ctx = currentContext();
    if (ctx?.tenantId === tenantId) return get();
    return requestContext.run({ ...emptyContext('notifications'), tenantId }, get);
  }

  private async addressesFor(tx: Tx, channel: Channel, who: ResolvedRecipient): Promise<string[]> {
    switch (channel) {
      case 'sms':
      case 'whatsapp':
        return who.mobile ? [who.mobile] : [];
      case 'email':
        return who.email ? [who.email] : [];
      case 'push': {
        if (!who.userId && !who.patientId) return [];
        const list = await this.repo.listDevices(tx, who.userId ? { userId: who.userId } : { patientId: who.patientId! });
        return list.map((d) => d.token);
      }
    }
  }

  private async maybeLowBalance(tx: Tx, s: SettingsRow, before: number, after: number) {
    const threshold = Number(s.lowBalanceThreshold);
    if (before >= threshold && after < threshold) {
      await this.outbox.publish(tx, 'notifications.credits.low', { balance: after, threshold } satisfies n.CreditsLowEvent, s.tenantId);
    }
  }

  // =====================================================================
  // Settings
  // =====================================================================

  /** The hospital's settings row, created with defaults (and welcome credits) on first use. */
  async settingsRow(tx: Tx): Promise<SettingsRow> {
    const found = await this.repo.findSettings(tx);
    if (found) return found;
    const tenantId = await currentTenant(tx);
    const created = await this.repo.insertSettings(tx, {
      tenantId,
      enabledChannels: ['sms', 'whatsapp', 'email', 'push'],
      defaultChannels: ['sms'],
      rates: { ...n.DEFAULT_RATES },
    });
    const welcome = this.providers.config.NOTIFY_WELCOME_CREDITS;
    if (created && welcome > 0) {
      await this.repo.insertLedger(tx, { tenantId, entryType: 'grant', amount: welcome.toFixed(2), note: 'Welcome credits' });
    }
    return (await this.repo.findSettings(tx))!;
  }

  private async hospitalName(tx: Tx, s: SettingsRow): Promise<string> {
    return s.displayName || (await this.repo.tenantName(tx, s.tenantId)) || 'our hospital';
  }

  getSettings(): Promise<n.Settings> {
    return this.db.tx(async (tx) => settingsDto(await this.settingsRow(tx)));
  }

  updateSettings(input: n.UpdateSettings): Promise<n.Settings> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const current = await this.settingsRow(tx);
      const enabled = input.enabledChannels ?? current.enabledChannels;
      const defaults = input.defaultChannels ?? current.defaultChannels;
      if (defaults.some((c) => !enabled.includes(c))) throw badRequest('default_channel_disabled', 'Default channels must be switched on');
      const row = await this.repo.updateSettings(tx, {
        enabledChannels: input.enabledChannels,
        defaultChannels: input.defaultChannels,
        displayName: input.displayName === undefined ? undefined : input.displayName || null,
        smsSenderId: input.smsSenderId === undefined ? undefined : input.smsSenderId || null,
        emailFromName: input.emailFromName === undefined ? undefined : input.emailFromName || null,
        emailReplyTo: input.emailReplyTo === undefined ? undefined : input.emailReplyTo || null,
        lowBalanceThreshold: input.lowBalanceThreshold?.toFixed(2),
        updatedBy: ctx.userId,
      });
      return settingsDto(row!);
    });
  }

  // =====================================================================
  // Templates
  // =====================================================================

  private async effectiveTemplate(tx: Tx, key: string, channel: Channel): Promise<EffectiveTemplate | null> {
    const row = await this.repo.findTemplate(tx, key, channel);
    if (row) return row;
    const def = DEFAULTS.get(key)?.channels[channel];
    return def ? { subject: def.subject ?? null, body: def.body, dltTemplateId: null, providerTemplateName: null, isActive: true } : null;
  }

  listTemplates(): Promise<n.Template[]> {
    return this.db.tx(async (tx) => {
      const custom = new Map((await this.repo.listTemplates(tx)).map((r) => [`${r.key}|${r.channel}`, r]));
      const out: n.Template[] = [];
      for (const def of n.DEFAULT_TEMPLATES) {
        for (const channel of n.CHANNELS) {
          const d = def.channels[channel];
          const c = custom.get(`${def.key}|${channel}`);
          if (!d && !c) continue;
          custom.delete(`${def.key}|${channel}`);
          out.push(c ? templateDto(c, def) : defaultTemplateDto(def, channel, d!));
        }
      }
      // Hospital-only templates (keys with no built-in default).
      for (const c of custom.values()) out.push(templateDto(c));
      return out;
    });
  }

  upsertTemplate(key: string, channel: Channel, input: n.UpsertTemplate): Promise<n.Template> {
    const ctx = currentContext()!;
    const parsed = n.upsertTemplateSchema.parse(input);
    return this.db.tx(async (tx) => {
      const row = await this.repo.upsertTemplate(tx, {
        tenantId: ctx.tenantId!,
        key,
        channel,
        subject: parsed.subject || null,
        body: parsed.body,
        dltTemplateId: parsed.dltTemplateId || null,
        providerTemplateName: parsed.providerTemplateName || null,
        isActive: parsed.isActive,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      return templateDto(row, DEFAULTS.get(key));
    });
  }

  resetTemplate(key: string, channel: Channel): Promise<void> {
    return this.db.tx(async (tx) => {
      if (!(await this.repo.deleteTemplate(tx, key, channel))) throw notFound('Custom template');
    });
  }

  previewTemplate(input: n.PreviewTemplate): Promise<n.TemplatePreview> {
    const p = n.previewTemplateSchema.parse(input);
    return this.db.tx(async (tx) => {
      const s = await this.settingsRow(tx);
      const data = { hospitalName: await this.hospitalName(tx, s), patientName: 'Asha Sharma', ...p.data };
      const body = render(p.body, data);
      const subject = p.subject ? render(p.subject, data) : null;
      return {
        subject: subject?.text ?? null,
        body: body.text,
        parts: p.channel === 'sms' ? smsParts(body.text) : 1,
        cost: costOf(p.channel, body.text, s),
        missingVariables: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
      };
    });
  }

  // =====================================================================
  // Rules
  // =====================================================================

  /** Default rules merged with the hospital's overrides. */
  async effectiveRules(tx: Tx, eventTopic?: string): Promise<n.Rule[]> {
    const custom = new Map((await this.repo.listRules(tx, eventTopic)).map((r) => [`${r.eventTopic}|${r.templateKey}`, r]));
    return n.NOTIFICATION_EVENTS.filter((e) => !eventTopic || e.topic === eventTopic).map((e) => {
      const c = custom.get(`${e.topic}|${e.templateKey}`);
      return {
        eventTopic: e.topic,
        eventName: e.name,
        templateKey: e.templateKey,
        channels: (c ? c.channels : [...e.defaultChannels]) as Channel[],
        isActive: c ? c.isActive : e.defaultChannels.length > 0,
        isCustom: !!c,
      };
    });
  }

  listRules(): Promise<n.Rule[]> {
    return this.db.tx((tx) => this.effectiveRules(tx));
  }

  updateRule(input: n.UpdateRule): Promise<n.Rule> {
    const ctx = currentContext()!;
    const event = n.NOTIFICATION_EVENTS.find((e) => e.topic === input.eventTopic);
    if (!event) throw badRequest('unknown_event', `Unknown event ${input.eventTopic}`);
    return this.db.tx(async (tx) => {
      await this.repo.upsertRule(tx, {
        tenantId: ctx.tenantId!,
        eventTopic: event.topic,
        templateKey: event.templateKey,
        channels: [...new Set(input.channels)],
        isActive: input.isActive,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      });
      return (await this.effectiveRules(tx, event.topic))[0]!;
    });
  }

  // =====================================================================
  // Messages (delivery log, manual send, retry)
  // =====================================================================

  listMessages(q: { status?: n.MessageStatus; channel?: Channel; patientId?: string; q?: string; page: number; pageSize: number }): Promise<Paginated<n.Message>> {
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchMessages(tx, q, q.page, q.pageSize);
      return { items: items.map(messageDto), page: q.page, pageSize: q.pageSize, total };
    });
  }

  getMessage(id: string): Promise<n.Message> {
    return this.db.tx(async (tx) => {
      const row = await this.repo.findMessage(tx, id);
      if (!row) throw notFound('Message');
      return messageDto(row);
    });
  }

  stats(): Promise<n.MessageStats> {
    return this.db.tx(async (tx) => {
      const counts = await this.repo.statusCounts(tx, startOfTodayIST());
      const today = Object.fromEntries(n.MESSAGE_STATUSES.map((s) => [s, counts[s] ?? 0])) as n.MessageStats['today'];
      return { today };
    });
  }

  /** Manual send from the web screen. */
  sendManual(input: n.SendRequest): Promise<n.SendResult> {
    const parsed = n.sendRequestSchema.parse(input);
    if (parsed.template === 'custom.message' && !String(parsed.data.message ?? '').trim()) {
      throw badRequest('message_required', 'Type the message to send');
    }
    return this.db.tx((tx) =>
      this.send(tx, { to: parsed.to, template: parsed.template, data: parsed.data, channels: parsed.channels, source: { module: 'notifications', refId: 'manual' } }),
    );
  }

  /** Queue a failed message again (charges credits again; the failure was refunded). */
  retry(id: string): Promise<n.Message> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.findMessage(tx, id, true);
      if (!row) throw notFound('Message');
      if (row.status !== 'failed') throw conflict('not_failed', 'Only failed messages can be retried');
      const settings = await this.settingsRow(tx);
      const cost = Number(row.cost);
      if (cost > 0) {
        await this.repo.lockCredits(tx);
        const balance = await this.repo.balance(tx);
        if (balance < cost) throw conflict('insufficient_credits', 'Not enough message credits');
        await this.repo.insertLedger(tx, { tenantId: row.tenantId, entryType: 'debit', amount: (-cost).toFixed(2), channel: row.channel, messageId: row.id, createdBy: ctx.userId, note: 'Retry' });
        await this.maybeLowBalance(tx, settings, balance, balance - cost);
      }
      const updated = await this.repo.updateMessage(tx, id, { status: 'queued', reason: null, error: null, attempts: 0, failedAt: null });
      await this.outbox.publish(tx, 'notifications.message.queued', { messageId: id } satisfies n.MessageQueuedEvent);
      return messageDto(updated!);
    });
  }

  // =====================================================================
  // Opt-outs
  // =====================================================================

  listOptOuts(q: string | undefined, page: number, pageSize: number): Promise<Paginated<n.OptOut>> {
    return this.db.tx(async (tx) => {
      const { items, total } = await this.repo.searchOptOuts(tx, q, page, pageSize);
      return { items: items.map(optOutDto), page, pageSize, total };
    });
  }

  addOptOut(input: n.CreateOptOut): Promise<n.OptOut> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.insertOptOut(tx, {
        tenantId: ctx.tenantId!,
        channel: input.channel,
        address: normalizeAddress(input.channel, input.address),
        reason: input.reason || null,
        createdBy: ctx.userId,
      });
      return optOutDto(row);
    });
  }

  removeOptOut(id: string): Promise<void> {
    return this.db.tx(async (tx) => {
      if (!(await this.repo.deleteOptOut(tx, id))) throw notFound('Opt-out');
    });
  }

  // =====================================================================
  // Credits
  // =====================================================================

  credits(): Promise<n.CreditSummary> {
    return this.db.tx(async (tx) => {
      const s = await this.settingsRow(tx);
      const balance = await this.repo.balance(tx);
      const threshold = Number(s.lowBalanceThreshold);
      return { balance, rates: ratesOf(s), lowBalanceThreshold: threshold, low: balance < threshold };
    });
  }

  ledger(page: number, pageSize: number): Promise<Paginated<n.LedgerEntry>> {
    return this.db.tx(async (tx) => {
      await this.settingsRow(tx);
      const { items, total } = await this.repo.listLedger(tx, page, pageSize);
      return { items: items.map(ledgerDto), page, pageSize, total };
    });
  }

  /** Add credits. Also used by the platform module after an online payment. */
  topup(input: n.Topup, tx?: Tx): Promise<n.CreditSummary> {
    const run = async (t: Tx) => {
      const s = await this.settingsRow(t);
      await this.repo.lockCredits(t);
      await this.repo.insertLedger(t, { tenantId: s.tenantId, entryType: 'topup', amount: input.amount.toFixed(2), note: input.note || null, createdBy: currentContext()?.userId ?? null });
      const balance = await this.repo.balance(t);
      const threshold = Number(s.lowBalanceThreshold);
      return { balance, rates: ratesOf(s), lowBalanceThreshold: threshold, low: balance < threshold };
    };
    return tx ? run(tx) : this.db.tx(run);
  }

  // =====================================================================
  // Push devices
  // =====================================================================

  registerDevice(input: n.RegisterDevice): Promise<n.Device> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      const row = await this.repo.upsertDevice(tx, {
        tenantId: ctx.tenantId!,
        userId: ctx.userId,
        token: input.token,
        platform: input.platform,
        appVariant: input.appVariant,
        deviceName: input.deviceName ?? null,
      });
      return deviceDto(row);
    });
  }

  /** For the patient portal: register a device against a patient instead of a staff user. */
  registerPatientDevice(tx: Tx, patientId: string, input: n.RegisterDevice): Promise<n.Device> {
    return currentTenant(tx).then(async (tenantId) =>
      deviceDto(
        await this.repo.upsertDevice(tx, {
          tenantId,
          patientId,
          token: input.token,
          platform: input.platform,
          appVariant: input.appVariant,
          deviceName: input.deviceName ?? null,
        }),
      ),
    );
  }

  unregisterDevice(token: string): Promise<void> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => {
      await this.repo.deactivateDevice(tx, token, ctx.userId);
    });
  }

  myDevices(): Promise<n.Device[]> {
    const ctx = currentContext()!;
    return this.db.tx(async (tx) => (await this.repo.listDevices(tx, { userId: ctx.userId })).map(deviceDto));
  }
}

// ---------- helpers ----------

async function currentTenant(tx: Tx): Promise<string> {
  const res = await tx.execute<{ id: string | null }>(sql`select app.current_tenant_id() as id`);
  const id = res.rows[0]?.id;
  if (!id) throw new Error('No tenant in the transaction');
  return id;
}

function ratesOf(s: SettingsRow): Record<Channel, number> {
  return { ...n.DEFAULT_RATES, ...(s.rates as Partial<Record<Channel, number>>) };
}

function costOf(channel: Channel, body: string, s: SettingsRow): number {
  const rate = ratesOf(s)[channel] ?? 0;
  const units = channel === 'sms' ? smsParts(body) : 1;
  return Math.round(rate * units * 100) / 100;
}

const summary = (r: MessageRow) => ({ id: r.id, channel: r.channel as Channel, status: r.status as n.MessageStatus, reason: r.reason });

export function messageDto(r: MessageRow): n.Message {
  return {
    id: r.id,
    channel: r.channel as Channel,
    templateKey: r.templateKey,
    recipient: r.recipient,
    patientId: r.patientId,
    userId: r.userId,
    subject: r.subject,
    body: r.body,
    status: r.status as n.MessageStatus,
    reason: r.reason,
    error: r.error,
    provider: r.provider,
    providerMessageId: r.providerMessageId,
    cost: Number(r.cost),
    attempts: r.attempts,
    sourceModule: r.sourceModule,
    sourceRef: r.sourceRef,
    createdAt: iso(r.createdAt),
    sentAt: iso(r.sentAt),
    deliveredAt: iso(r.deliveredAt),
  };
}

function templateDto(r: TemplateRow, def?: n.TemplateDef): n.Template {
  return {
    key: r.key,
    name: def?.name ?? r.key,
    channel: r.channel as Channel,
    variables: def?.variables ?? templateVariables(`${r.subject ?? ''} ${r.body}`),
    subject: r.subject,
    body: r.body,
    dltTemplateId: r.dltTemplateId,
    providerTemplateName: r.providerTemplateName,
    isActive: r.isActive,
    isCustom: true,
    updatedAt: iso(r.updatedAt),
  };
}

function defaultTemplateDto(def: n.TemplateDef, channel: Channel, d: { subject?: string; body: string }): n.Template {
  return {
    key: def.key,
    name: def.name,
    channel,
    variables: def.variables,
    subject: d.subject ?? null,
    body: d.body,
    dltTemplateId: null,
    providerTemplateName: null,
    isActive: true,
    isCustom: false,
    updatedAt: null,
  };
}

function settingsDto(s: SettingsRow): n.Settings {
  return {
    enabledChannels: s.enabledChannels as Channel[],
    defaultChannels: s.defaultChannels as Channel[],
    displayName: s.displayName,
    smsSenderId: s.smsSenderId,
    emailFromName: s.emailFromName,
    emailReplyTo: s.emailReplyTo,
    lowBalanceThreshold: Number(s.lowBalanceThreshold),
  };
}

const optOutDto = (r: OptOutRow): n.OptOut => ({
  id: r.id,
  channel: r.channel as n.OptOut['channel'],
  address: r.address,
  reason: r.reason,
  createdAt: iso(r.createdAt),
});

const ledgerDto = (r: LedgerRow): n.LedgerEntry => ({
  id: r.id,
  entryType: r.entryType as n.LedgerEntryType,
  amount: Number(r.amount),
  channel: r.channel as Channel | null,
  messageId: r.messageId,
  note: r.note,
  createdAt: iso(r.createdAt),
});

const deviceDto = (r: DeviceRow): n.Device => ({
  id: r.id,
  platform: r.platform as n.Device['platform'],
  appVariant: r.appVariant as n.Device['appVariant'],
  deviceName: r.deviceName,
  lastSeenAt: iso(r.lastSeenAt),
});
