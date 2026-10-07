import { z } from 'zod';
import { defineModule } from '../manifest';

/**
 * Notifications: permissions and API contracts (Zod schemas + types).
 * Owned by the "notifications" workstream.
 */
export const notificationsModule = defineModule({
  key: 'notifications',
  name: 'Notifications',
  permissions: [
    { key: 'notifications.message.read', description: 'View the message delivery log' },
    { key: 'notifications.message.send', description: 'Send a message to a patient manually and retry failed messages' },
    { key: 'notifications.template.read', description: 'View message templates and automatic rules' },
    { key: 'notifications.template.manage', description: 'Edit message templates and automatic rules' },
    { key: 'notifications.optout.manage', description: 'View and manage opt-outs (do-not-contact list)' },
    { key: 'notifications.credit.read', description: 'View the message credit balance and ledger' },
    { key: 'notifications.credit.topup', description: 'Add message credits to the wallet' },
    { key: 'notifications.settings.manage', description: 'Change messaging settings (channels, sender ID, rates)' },
    { key: 'notifications.device.register', description: 'Register this device for push notifications' },
  ],
  grants: {
    hospital_admin: [
      'notifications.message.read', 'notifications.message.send', 'notifications.template.read',
      'notifications.template.manage', 'notifications.optout.manage', 'notifications.credit.read',
      'notifications.settings.manage', 'notifications.device.register',
    ],
    owner: ['notifications.message.read', 'notifications.template.read', 'notifications.credit.read', 'notifications.device.register'],
    receptionist: ['notifications.message.read', 'notifications.message.send', 'notifications.optout.manage', 'notifications.device.register'],
    doctor: ['notifications.device.register'],
    nurse: ['notifications.device.register'],
    pharmacist: ['notifications.device.register'],
    lab_technician: ['notifications.device.register'],
    radiologist: ['notifications.device.register'],
    billing_clerk: ['notifications.device.register'],
    accountant: ['notifications.credit.read', 'notifications.device.register'],
    store_keeper: ['notifications.device.register'],
    hr_manager: ['notifications.device.register'],
    quality_manager: ['notifications.device.register'],
  },
});

// ---------- Enums ----------

export const CHANNELS = ['sms', 'whatsapp', 'email', 'push'] as const;
export type Channel = (typeof CHANNELS)[number];

export const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'skipped'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Why a message was skipped or failed. */
export const MESSAGE_REASONS = [
  'no_address',
  'no_template',
  'opted_out',
  'channel_disabled',
  'insufficient_credits',
  'provider_error',
] as const;

export const LEDGER_ENTRY_TYPES = ['grant', 'topup', 'debit', 'refund', 'adjustment'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export const DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
export const APP_VARIANTS = ['doctor', 'staff', 'owner', 'patient'] as const;

const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit Indian mobile number');
const templateKey = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'Use dotted lowercase keys, e.g. appointment.booked');

// ---------- Built-in templates and events ----------

export interface TemplateDef {
  key: string;
  name: string;
  /** Variables the template can use as {{name}}. */
  variables: readonly string[];
  /** Default body per channel. A hospital can override any of them. */
  channels: Partial<Record<Channel, { subject?: string; body: string }>>;
}

/** Default templates every hospital starts with. {{hospitalName}} and {{patientName}} are always filled in. */
export const DEFAULT_TEMPLATES: readonly TemplateDef[] = [
  {
    key: 'patient.registered',
    name: 'Welcome / registration',
    variables: ['hospitalName', 'patientName', 'uhid'],
    channels: {
      sms: { body: 'Dear {{patientName}}, welcome to {{hospitalName}}. Your UHID is {{uhid}}. Please quote it on every visit.' },
      whatsapp: { body: 'Dear {{patientName}}, welcome to *{{hospitalName}}*. Your UHID is *{{uhid}}*. Please quote it on every visit.' },
      email: {
        subject: 'Welcome to {{hospitalName}}',
        body: 'Dear {{patientName}},\n\nWelcome to {{hospitalName}}. Your UHID is {{uhid}}. Please quote it on every visit.\n\nRegards,\n{{hospitalName}}',
      },
    },
  },
  {
    key: 'appointment.booked',
    name: 'Appointment booked',
    variables: ['hospitalName', 'patientName', 'date', 'time', 'doctorName'],
    channels: {
      sms: { body: 'Dear {{patientName}}, your appointment at {{hospitalName}} is confirmed for {{date}} at {{time}}.' },
      whatsapp: { body: 'Dear {{patientName}}, your appointment at *{{hospitalName}}* is confirmed for *{{date}} at {{time}}*.' },
      email: {
        subject: 'Appointment confirmed: {{date}} {{time}}',
        body: 'Dear {{patientName}},\n\nYour appointment at {{hospitalName}} is confirmed for {{date}} at {{time}}.\n\nRegards,\n{{hospitalName}}',
      },
      push: { subject: 'Appointment confirmed', body: '{{date}} at {{time}}, {{hospitalName}}' },
    },
  },
  {
    key: 'appointment.cancelled',
    name: 'Appointment cancelled',
    variables: ['hospitalName', 'patientName', 'date', 'time'],
    channels: {
      sms: { body: 'Dear {{patientName}}, your appointment at {{hospitalName}} on {{date}} at {{time}} has been cancelled.' },
      whatsapp: { body: 'Dear {{patientName}}, your appointment at *{{hospitalName}}* on {{date}} at {{time}} has been cancelled.' },
      push: { subject: 'Appointment cancelled', body: '{{date}} at {{time}}, {{hospitalName}}' },
    },
  },
  {
    key: 'visit.checked_in',
    name: 'Checked in (token number)',
    variables: ['hospitalName', 'patientName', 'tokenNo'],
    channels: {
      sms: { body: 'Dear {{patientName}}, you are checked in at {{hospitalName}}. Your token number is {{tokenNo}}.' },
      whatsapp: { body: 'Dear {{patientName}}, you are checked in at *{{hospitalName}}*. Your token number is *{{tokenNo}}*.' },
      push: { subject: 'Token {{tokenNo}}', body: 'You are checked in at {{hospitalName}}' },
    },
  },
  {
    key: 'payment.received',
    name: 'Payment received',
    variables: ['hospitalName', 'patientName', 'amount', 'mode'],
    channels: {
      sms: { body: 'Dear {{patientName}}, we have received Rs {{amount}} by {{mode}} at {{hospitalName}}. Thank you.' },
      whatsapp: { body: 'Dear {{patientName}}, we have received *Rs {{amount}}* by {{mode}} at {{hospitalName}}. Thank you.' },
      email: {
        subject: 'Payment received: Rs {{amount}}',
        body: 'Dear {{patientName}},\n\nWe have received Rs {{amount}} by {{mode}}. Thank you.\n\nRegards,\n{{hospitalName}}',
      },
    },
  },
  {
    key: 'prescription.created',
    name: 'Prescription ready',
    variables: ['hospitalName', 'patientName'],
    channels: {
      sms: { body: 'Dear {{patientName}}, your prescription from {{hospitalName}} is ready. Please collect your medicines at the pharmacy.' },
      whatsapp: { body: 'Dear {{patientName}}, your prescription from *{{hospitalName}}* is ready. Please collect your medicines at the pharmacy.' },
      push: { subject: 'Prescription ready', body: 'Your prescription from {{hospitalName}} is ready' },
    },
  },
  {
    key: 'staff.invited',
    name: 'Staff invite (login details)',
    variables: ['hospitalName', 'staffName', 'hospitalCode', 'loginId', 'tempPassword', 'loginUrl'],
    channels: {
      sms: { body: 'Dear {{staffName}}, your {{hospitalName}} HMS login: hospital code {{hospitalCode}}, user {{loginId}}, temporary password {{tempPassword}}. Change it after first login.' },
      email: {
        subject: 'Your {{hospitalName}} HMS login',
        body: 'Dear {{staffName}},\n\nAn account has been created for you at {{hospitalName}}.\n\nHospital code: {{hospitalCode}}\nUser: {{loginId}}\nTemporary password: {{tempPassword}}\nSign in: {{loginUrl}}\n\nPlease change your password after the first login.\n\n{{hospitalName}}',
      },
    },
  },
  {
    key: 'staff.password_reset',
    name: 'Staff password reset',
    variables: ['hospitalName', 'staffName', 'hospitalCode', 'loginId', 'tempPassword', 'loginUrl'],
    channels: {
      sms: { body: 'Dear {{staffName}}, your {{hospitalName}} HMS password was reset. Temporary password {{tempPassword}} (hospital code {{hospitalCode}}). Change it after login.' },
      email: {
        subject: 'Your {{hospitalName}} HMS password was reset',
        body: 'Dear {{staffName}},\n\nYour password was reset by the hospital administrator.\n\nHospital code: {{hospitalCode}}\nUser: {{loginId}}\nTemporary password: {{tempPassword}}\nSign in: {{loginUrl}}\n\nIf you did not ask for this, contact your administrator.\n\n{{hospitalName}}',
      },
    },
  },
  {
    key: 'custom.message',
    name: 'Custom message (typed by staff)',
    variables: ['hospitalName', 'patientName', 'message'],
    channels: {
      sms: { body: '{{message}} - {{hospitalName}}' },
      whatsapp: { body: '{{message}}\n\n- {{hospitalName}}' },
      email: { subject: 'Message from {{hospitalName}}', body: '{{message}}\n\n{{hospitalName}}' },
      push: { subject: '{{hospitalName}}', body: '{{message}}' },
    },
  },
];

export interface EventDef {
  topic: string;
  name: string;
  /** Template used by the default rule. */
  templateKey: string;
  /** Channels the default rule sends on; empty means the rule starts switched off. */
  defaultChannels: readonly Channel[];
}

/** Events the notifications module can react to. Hospitals switch rules on/off and pick channels. */
export const NOTIFICATION_EVENTS: readonly EventDef[] = [
  { topic: 'core.patient.registered', name: 'Patient registered', templateKey: 'patient.registered', defaultChannels: ['sms'] },
  { topic: 'frontoffice.appointment.booked', name: 'Appointment booked', templateKey: 'appointment.booked', defaultChannels: ['sms', 'push'] },
  { topic: 'frontoffice.appointment.cancelled', name: 'Appointment cancelled', templateKey: 'appointment.cancelled', defaultChannels: ['sms', 'push'] },
  { topic: 'frontoffice.visit.checked_in', name: 'Patient checked in', templateKey: 'visit.checked_in', defaultChannels: [] },
  { topic: 'billing.payment.received', name: 'Payment received', templateKey: 'payment.received', defaultChannels: ['sms'] },
  { topic: 'emr.prescription.created', name: 'Prescription created', templateKey: 'prescription.created', defaultChannels: [] },
];

/** Default cost per message in credits (1 credit = Rs 1). SMS is per 160-character part. */
export const DEFAULT_RATES: Record<Channel, number> = { sms: 0.25, whatsapp: 0.8, email: 0.05, push: 0 };

// ---------- NotificationsService.send() contract (used by other modules) ----------

export const recipientSchema = z
  .object({
    patientId: z.uuid().optional(),
    userId: z.uuid().optional(),
    mobile: mobile.optional(),
    email: z.email().optional(),
  })
  .refine((r) => r.patientId || r.userId || r.mobile || r.email, 'Give a patient, user, mobile or email');
export type Recipient = z.infer<typeof recipientSchema>;

export const sendRequestSchema = z.object({
  to: recipientSchema,
  template: templateKey,
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  /** Defaults to the hospital's default channels. */
  channels: z.array(z.enum(CHANNELS)).min(1).max(4).optional(),
});
export type SendRequest = z.input<typeof sendRequestSchema>;

/** What NotificationsService.send(tx, input) takes. idempotencyKey makes repeated calls safe. */
export interface SendInput {
  to: Recipient;
  template: string;
  data?: Record<string, string | number | boolean | null | undefined>;
  channels?: Channel[];
  idempotencyKey?: string;
  source?: { module: string; refId?: string };
}

export interface SendResult {
  messages: { id: string; channel: Channel; status: MessageStatus; reason: string | null }[];
}

// ---------- Messages (delivery log) ----------

export const messageSchema = z.object({
  id: z.uuid(),
  channel: z.enum(CHANNELS),
  templateKey: z.string(),
  recipient: z.string().nullable(),
  patientId: z.string().nullable(),
  userId: z.string().nullable(),
  subject: z.string().nullable(),
  body: z.string(),
  status: z.enum(MESSAGE_STATUSES),
  reason: z.string().nullable(),
  error: z.string().nullable(),
  provider: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  cost: z.number(),
  attempts: z.number(),
  sourceModule: z.string().nullable(),
  sourceRef: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
});
export type Message = z.infer<typeof messageSchema>;

export const messageQuerySchema = z.object({
  status: z.enum(MESSAGE_STATUSES).optional(),
  channel: z.enum(CHANNELS).optional(),
  patientId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type MessageQuery = {
  status?: MessageStatus;
  channel?: Channel;
  patientId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export interface MessageStats {
  /** Counts for today (IST) by status. */
  today: Record<MessageStatus, number>;
}

// ---------- Templates ----------

export interface Template {
  key: string;
  name: string;
  channel: Channel;
  variables: readonly string[];
  subject: string | null;
  body: string;
  /** India DLT template id for SMS; approved template name for WhatsApp. */
  dltTemplateId: string | null;
  providerTemplateName: string | null;
  isActive: boolean;
  /** True when the hospital changed it from the default. */
  isCustom: boolean;
  updatedAt: string | null;
}

export const upsertTemplateSchema = z.object({
  subject: z.string().trim().max(200).nullish(),
  body: z.string().trim().min(1).max(2000),
  dltTemplateId: z.string().trim().max(50).nullish(),
  providerTemplateName: z.string().trim().max(100).nullish(),
  isActive: z.boolean().default(true),
});
export type UpsertTemplate = z.input<typeof upsertTemplateSchema>;

export const previewTemplateSchema = z.object({
  channel: z.enum(CHANNELS),
  subject: z.string().max(200).nullish(),
  body: z.string().min(1).max(2000),
  data: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
});
export type PreviewTemplate = z.input<typeof previewTemplateSchema>;

export interface TemplatePreview {
  subject: string | null;
  body: string;
  /** SMS parts (160 GSM / 70 Unicode characters each); 1 for other channels. */
  parts: number;
  cost: number;
  missingVariables: string[];
}

// ---------- Rules (event -> template) ----------

export interface Rule {
  eventTopic: string;
  eventName: string;
  templateKey: string;
  channels: Channel[];
  isActive: boolean;
  isCustom: boolean;
}

export const updateRuleSchema = z.object({
  eventTopic: z.string().min(3).max(100),
  channels: z.array(z.enum(CHANNELS)).max(4),
  isActive: z.boolean(),
});
export type UpdateRule = z.input<typeof updateRuleSchema>;

// ---------- Opt-outs ----------

export const createOptOutSchema = z
  .object({
    channel: z.enum([...CHANNELS, 'all']),
    address: z.string().trim().min(3).max(254),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((o) => (o.channel === 'email' || o.channel === 'push' || o.channel === 'all' ? true : /^[6-9]\d{9}$/.test(o.address.replace(/\D/g, '').slice(-10))), {
    message: 'Enter a 10-digit Indian mobile number',
    path: ['address'],
  });
export type CreateOptOut = z.input<typeof createOptOutSchema>;

export interface OptOut {
  id: string;
  channel: Channel | 'all';
  address: string;
  reason: string | null;
  createdAt: string;
}

export const optOutQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type OptOutQuery = { q?: string; page?: number; pageSize?: number };

// ---------- Credits wallet ----------

export interface LedgerEntry {
  id: string;
  entryType: LedgerEntryType;
  amount: number;
  channel: Channel | null;
  messageId: string | null;
  note: string | null;
  createdAt: string;
}

export interface CreditSummary {
  balance: number;
  rates: Record<Channel, number>;
  lowBalanceThreshold: number;
  low: boolean;
}

export const topupSchema = z.object({
  amount: z.number().positive().max(1_000_000),
  note: z.string().trim().max(200).optional(),
});
export type Topup = z.input<typeof topupSchema>;

export const ledgerQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------- Settings ----------

export const settingsSchema = z.object({
  /** Channels the hospital has switched on. */
  enabledChannels: z.array(z.enum(CHANNELS)),
  /** Used when a caller does not pick channels. */
  defaultChannels: z.array(z.enum(CHANNELS)).min(1),
  /** Name used as {{hospitalName}}; empty means the hospital's registered name. */
  displayName: z.string().trim().max(100).nullish(),
  /** 6-letter DLT sender id (header) for SMS. */
  smsSenderId: z.string().trim().regex(/^[A-Z]{6}$/, 'Six capital letters, e.g. HMSHSP').nullish(),
  emailFromName: z.string().trim().max(100).nullish(),
  emailReplyTo: z.email().nullish(),
  lowBalanceThreshold: z.number().min(0).max(100_000),
});
export type Settings = z.infer<typeof settingsSchema>;
export const updateSettingsSchema = settingsSchema.partial();
export type UpdateSettings = z.input<typeof updateSettingsSchema>;

// ---------- Push devices ----------

export const registerDeviceSchema = z.object({
  token: z.string().trim().min(10).max(300),
  platform: z.enum(DEVICE_PLATFORMS),
  appVariant: z.enum(APP_VARIANTS),
  deviceName: z.string().trim().max(100).optional(),
});
export type RegisterDevice = z.input<typeof registerDeviceSchema>;

export const unregisterDeviceSchema = z.object({ token: z.string().trim().min(10).max(300) });

export interface Device {
  id: string;
  platform: (typeof DEVICE_PLATFORMS)[number];
  appVariant: (typeof APP_VARIANTS)[number];
  deviceName: string | null;
  lastSeenAt: string;
}

// ---------- Events this module publishes ----------

/** notifications.message.queued: the worker picks the message up and sends it. */
export interface MessageQueuedEvent {
  messageId: string;
}
/** notifications.credits.low: balance fell below the threshold (once per crossing). */
export interface CreditsLowEvent {
  balance: number;
  threshold: number;
}
