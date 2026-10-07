/** Notifications tables. Owned by the "notifications" workstream (Postgres schema: comms). */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, comms, idColumn, tenantIdColumn, timestamps } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Hospital overrides of the built-in templates (DEFAULT_TEMPLATES in @hms/shared). */
export const notificationsTemplates = comms.table(
  'templates',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    key: text('key').notNull(),
    channel: text('channel').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    dltTemplateId: text('dlt_template_id'),
    providerTemplateName: text('provider_template_name'),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('templates_key_channel_uq').on(t.tenantId, t.key, t.channel)],
);

/** Hospital overrides of the default event -> template rules (NOTIFICATION_EVENTS in @hms/shared). */
export const notificationsRules = comms.table(
  'rules',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    eventTopic: text('event_topic').notNull(),
    templateKey: text('template_key').notNull(),
    channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('rules_event_template_uq').on(t.tenantId, t.eventTopic, t.templateKey)],
);

/** One row per message per channel: the delivery log. */
export const notificationsMessages = comms.table(
  'messages',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    channel: text('channel').notNull(),
    templateKey: text('template_key').notNull(),
    recipient: text('recipient'),
    patientId: uuid('patient_id'),
    userId: uuid('user_id'),
    subject: text('subject'),
    body: text('body').notNull(),
    status: text('status').notNull().default('queued'),
    reason: text('reason'),
    error: text('error'),
    provider: text('provider'),
    providerMessageId: text('provider_message_id'),
    cost: numeric('cost', { precision: 14, scale: 2 }).notNull().default('0'),
    attempts: integer('attempts').notNull().default(0),
    sourceModule: text('source_module'),
    sourceRef: text('source_ref'),
    idempotencyKey: text('idempotency_key'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    failedAt: ts('failed_at'),
    createdBy: uuid('created_by'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('messages_idempotency_uq').on(t.tenantId, t.idempotencyKey),
    index('messages_created_idx').on(t.tenantId, t.createdAt),
    index('messages_patient_idx').on(t.tenantId, t.patientId),
    index('messages_status_idx').on(t.tenantId, t.status),
  ],
);

/** Do-not-contact list. channel 'all' blocks every channel for that address. */
export const notificationsOptOuts = comms.table(
  'opt_outs',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    channel: text('channel').notNull(),
    address: text('address').notNull(),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('opt_outs_channel_address_uq').on(t.tenantId, t.channel, t.address)],
);

/** Prepaid message credits. Append-only: the balance is the sum of amounts. */
export const notificationsCreditLedger = comms.table(
  'credit_ledger',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    entryType: text('entry_type').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    channel: text('channel'),
    messageId: uuid('message_id'),
    note: text('note'),
    createdBy: uuid('created_by'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), index('credit_ledger_created_idx').on(t.tenantId, t.createdAt)],
);

/** One row per hospital. */
export const notificationsSettings = comms.table(
  'settings',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    enabledChannels: text('enabled_channels').array().notNull(),
    defaultChannels: text('default_channels').array().notNull(),
    displayName: text('display_name'),
    smsSenderId: text('sms_sender_id'),
    emailFromName: text('email_from_name'),
    emailReplyTo: text('email_reply_to'),
    rates: jsonb('rates').$type<Record<string, number>>().notNull(),
    lowBalanceThreshold: numeric('low_balance_threshold', { precision: 14, scale: 2 }).notNull().default('50'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('settings_tenant_uq').on(t.tenantId)],
);

/** Push tokens (Expo) for staff users and patients. */
export const notificationsDevices = comms.table(
  'devices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    userId: uuid('user_id'),
    patientId: uuid('patient_id'),
    token: text('token').notNull(),
    platform: text('platform').notNull(),
    appVariant: text('app_variant').notNull(),
    deviceName: text('device_name'),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('devices_token_uq').on(t.tenantId, t.token),
    index('devices_user_idx').on(t.tenantId, t.userId),
    index('devices_patient_idx').on(t.tenantId, t.patientId),
  ],
);
