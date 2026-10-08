import { z } from 'zod';
import { defineModule } from '../manifest';
import { patchSchema } from '../patch';

/**
 * Integrations: ABDM (ABHA, Scan-and-Share, HIP care contexts, HIU consents, FHIR R4), online payment
 * gateways, public API keys, outbound webhooks and lab-machine (HL7 v2) interfaces.
 * Owned by the "integrations" workstream. Every external system sits behind an adapter; the shipped
 * adapters are mock/sandbox only and never reach a real external service.
 */
export const integrationsModule = defineModule({
  key: 'integrations',
  name: 'Integrations (ABDM)',
  permissions: [
    { key: 'integrations.settings.manage', description: 'Configure ABDM and payment gateway settings' },
    { key: 'integrations.abha.read', description: 'View ABHA links, Scan-and-Share tokens and care contexts' },
    { key: 'integrations.abha.manage', description: 'Create/verify ABHA, link it to patients, handle Scan-and-Share' },
    { key: 'integrations.consent.read', description: 'View ABDM consent requests and fetched records' },
    { key: 'integrations.consent.manage', description: 'Raise ABDM consent requests for a patient' },
    { key: 'integrations.payment.read', description: 'View online payment links' },
    { key: 'integrations.payment.create', description: 'Create and cancel online payment links for bills' },
    { key: 'integrations.device.read', description: 'View lab machines and their messages' },
    { key: 'integrations.device.manage', description: 'Add and edit lab machine interfaces' },
    { key: 'integrations.developer.manage', description: 'Manage public API keys and webhooks' },
  ],
  grants: {
    hospital_admin: [
      'integrations.settings.manage', 'integrations.abha.read', 'integrations.abha.manage', 'integrations.consent.read',
      'integrations.consent.manage', 'integrations.payment.read', 'integrations.payment.create', 'integrations.device.read',
      'integrations.device.manage', 'integrations.developer.manage',
    ],
    owner: ['integrations.abha.read', 'integrations.payment.read', 'integrations.device.read'],
    doctor: ['integrations.abha.read', 'integrations.consent.read', 'integrations.consent.manage'],
    nurse: ['integrations.abha.read'],
    receptionist: ['integrations.abha.read', 'integrations.abha.manage', 'integrations.payment.read', 'integrations.payment.create'],
    billing_clerk: ['integrations.payment.read', 'integrations.payment.create'],
    accountant: ['integrations.payment.read'],
    lab_technician: ['integrations.device.read'],
  },
});

const optionalText = (max: number) => z.string().trim().max(max).optional();
const listQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

// ---------- Settings ----------

/** disabled: ABDM screens off. mock: built-in simulator (OTP 123456). sandbox: ABDM sandbox (needs credentials on the server). */
export const ABDM_MODES = ['disabled', 'mock', 'sandbox'] as const;
export type AbdmMode = (typeof ABDM_MODES)[number];
/** none: no online payments. mock: built-in simulator. razorpay: Razorpay (needs keys on the server). */
export const PAYMENT_PROVIDERS = ['none', 'mock', 'razorpay'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const settingsInputSchema = z.object({
  abdmMode: z.enum(ABDM_MODES),
  /** Health Facility Registry id of this hospital (HIP id). */
  hfrId: z.string().trim().max(50).optional().nullable(),
  hipName: z.string().trim().max(200).optional().nullable(),
  paymentProvider: z.enum(PAYMENT_PROVIDERS),
  /** Public key id only (e.g. rzp_test_…). Secrets live in server environment variables, never in the database. */
  paymentKeyId: z.string().trim().max(100).optional().nullable(),
});
export type SettingsInput = z.input<typeof settingsInputSchema>;

export interface IntegrationSettings {
  abdmMode: AbdmMode;
  hfrId: string | null;
  hipName: string | null;
  paymentProvider: PaymentProvider;
  paymentKeyId: string | null;
  /** URLs to register with ABDM / the payment gateway for this hospital. */
  callbackUrls: { abdmProfileShare: string; paymentWebhook: string | null };
  /** Whether the server has the secrets the chosen live adapters need. */
  serverReady: { abdmSandbox: boolean; razorpay: boolean };
  updatedAt: string | null;
}

// ---------- ABHA ----------

export const ABHA_OTP_METHODS = ['aadhaar', 'mobile', 'abha'] as const;
export type AbhaOtpMethod = (typeof ABHA_OTP_METHODS)[number];
export const ABHA_PURPOSES = ['create', 'verify'] as const;
export type AbhaPurpose = (typeof ABHA_PURPOSES)[number];

const abhaNumber = z.string().trim().transform((s) => s.replace(/-/g, '')).pipe(z.string().regex(/^\d{14}$/, 'ABHA number has 14 digits'));
const abhaAddress = z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,32}@(sbx|abdm)$/, 'ABHA address looks like name@abdm');

export const abhaOtpRequestSchema = z
  .object({
    purpose: z.enum(ABHA_PURPOSES),
    method: z.enum(ABHA_OTP_METHODS),
    /** Aadhaar (12 digits) for create; mobile, ABHA number or ABHA address for verify. Aadhaar is never stored. */
    identifier: z.string().trim().min(3).max(64),
    patientId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const id = v.identifier.replace(/[\s-]/g, '');
    const ok =
      v.method === 'aadhaar' ? /^\d{12}$/.test(id)
      : v.method === 'mobile' ? /^[6-9]\d{9}$/.test(id)
      : /^\d{14}$/.test(id) || abhaAddress.safeParse(v.identifier).success;
    if (!ok) ctx.addIssue({ code: 'custom', path: ['identifier'], message: `Enter a valid ${v.method === 'abha' ? 'ABHA number or address' : v.method === 'aadhaar' ? '12-digit Aadhaar number' : '10-digit mobile number'}` });
    if (v.purpose === 'create' && v.method === 'abha') ctx.addIssue({ code: 'custom', path: ['method'], message: 'Create ABHA with Aadhaar or mobile' });
  });
export type AbhaOtpRequest = z.input<typeof abhaOtpRequestSchema>;

export const abhaOtpVerifySchema = z.object({
  requestId: z.uuid(),
  otp: z.string().trim().regex(/^\d{6}$/, 'OTP has 6 digits'),
});
export type AbhaOtpVerify = z.input<typeof abhaOtpVerifySchema>;

export interface AbhaProfile {
  abhaNumber: string;
  abhaAddress: string | null;
  name: string;
  gender: 'male' | 'female' | 'other' | 'unknown';
  yearOfBirth: number | null;
  mobile: string | null;
}

export type AbhaRequestStatus = 'otp_sent' | 'verified' | 'failed' | 'expired';
export interface AbhaRequest {
  id: string;
  purpose: AbhaPurpose;
  method: AbhaOtpMethod;
  /** Masked: Aadhaar/mobile show only the last 4 digits. */
  identifierMasked: string;
  status: AbhaRequestStatus;
  sentTo: string | null;
  expiresAt: string;
  patientId: string | null;
  profile: AbhaProfile | null;
  createdAt: string;
}

export const abhaLinkSchema = z.object({
  requestId: z.uuid(),
  patientId: z.uuid(),
});
export type AbhaLinkInput = z.input<typeof abhaLinkSchema>;

export const abhaUnlinkSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export type AbhaUnlinkInput = z.input<typeof abhaUnlinkSchema>;

export type AbhaLinkStatus = 'linked' | 'unlinked';
export interface AbhaLink {
  id: string;
  patientId: string;
  abhaNumber: string;
  abhaAddress: string | null;
  name: string;
  gender: string | null;
  yearOfBirth: number | null;
  verifiedVia: AbhaOtpMethod | 'scan_share';
  status: AbhaLinkStatus;
  linkedAt: string;
  unlinkedAt: string | null;
  unlinkReason: string | null;
}

export const abhaLinkQuerySchema = z.object({
  patientId: z.uuid().optional(),
  status: z.enum(['linked', 'unlinked', 'all']).default('linked'),
  ...listQuery,
});
export type AbhaLinkQuery = { patientId?: string; status?: 'linked' | 'unlinked' | 'all'; page?: number; pageSize?: number };

// ---------- Scan and Share ----------

export type ScanShareStatus = 'pending' | 'registered' | 'linked' | 'dismissed';
export interface ScanShareToken {
  id: string;
  tokenNo: number;
  tokenDate: string;
  profile: AbhaProfile;
  status: ScanShareStatus;
  patientId: string | null;
  createdAt: string;
}

/** Body ABDM (or the simulator) posts to the profile-share callback. */
export const profileShareCallbackSchema = z.object({
  requestId: z.string().min(1).max(100),
  hipId: z.string().max(50).optional(),
  profile: z.object({
    abhaNumber,
    abhaAddress: abhaAddress.optional().nullable(),
    name: z.string().trim().min(1).max(200),
    gender: z.enum(['male', 'female', 'other', 'unknown']).default('unknown'),
    yearOfBirth: z.number().int().min(1900).max(2100).optional().nullable(),
    mobile: z.string().regex(/^[6-9]\d{9}$/).optional().nullable(),
  }),
});
export type ProfileShareCallback = z.input<typeof profileShareCallbackSchema>;

export const scanShareQuerySchema = z.object({
  date: z.iso.date().optional(),
  status: z.enum(['pending', 'registered', 'linked', 'dismissed', 'all']).default('pending'),
});
export type ScanShareQuery = { date?: string; status?: ScanShareStatus | 'all' };

export const scanShareResolveSchema = z.discriminatedUnion('action', [
  /** Register a new patient from the ABHA profile. */
  z.object({ action: z.literal('register') }),
  /** Link the profile to an existing patient. */
  z.object({ action: z.literal('link'), patientId: z.uuid() }),
  z.object({ action: z.literal('dismiss') }),
]);
export type ScanShareResolve = z.input<typeof scanShareResolveSchema>;

export const scanShareSimulateSchema = z.object({
  name: z.string().trim().min(1).max(200).default('Sandbox Patient'),
  gender: z.enum(['male', 'female', 'other', 'unknown']).default('female'),
  yearOfBirth: z.number().int().min(1900).max(2100).default(1990),
  mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
});
export type ScanShareSimulate = z.input<typeof scanShareSimulateSchema>;

// ---------- HIP care contexts ----------

export const HEALTH_INFO_TYPES = [
  'OPConsultation', 'Prescription', 'DischargeSummary', 'DiagnosticReport', 'ImmunizationRecord', 'HealthDocumentRecord', 'WellnessRecord',
] as const;
export type HealthInfoType = (typeof HEALTH_INFO_TYPES)[number];

export type CareContextStatus = 'pending' | 'linked' | 'failed';
export interface CareContext {
  id: string;
  patientId: string;
  abhaNumber: string;
  reference: string;
  display: string;
  hiTypes: HealthInfoType[];
  sourceModule: string;
  sourceRefId: string | null;
  status: CareContextStatus;
  linkedAt: string | null;
  error: string | null;
  createdAt: string;
}

export const careContextQuerySchema = z.object({
  patientId: z.uuid().optional(),
  status: z.enum(['pending', 'linked', 'failed', 'all']).default('all'),
  ...listQuery,
});
export type CareContextQuery = { patientId?: string; status?: CareContextStatus | 'all'; page?: number; pageSize?: number };

// ---------- HIU consent requests ----------

/** ABDM purpose codes. */
export const CONSENT_PURPOSES = ['CAREMGT', 'BTG', 'PUBHLTH', 'HPAYMT', 'DSRCH', 'PATRQT'] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export const CONSENT_PURPOSE_LABELS: Record<ConsentPurpose, string> = {
  CAREMGT: 'Care management',
  BTG: 'Break the glass (emergency)',
  PUBHLTH: 'Public health',
  HPAYMT: 'Healthcare payment',
  DSRCH: 'Disease specific research',
  PATRQT: 'Self requested',
};

export const consentRequestSchema = z
  .object({
    patientId: z.uuid(),
    purpose: z.enum(CONSENT_PURPOSES).default('CAREMGT'),
    hiTypes: z.array(z.enum(HEALTH_INFO_TYPES)).min(1).max(HEALTH_INFO_TYPES.length),
    dateFrom: z.iso.date(),
    dateTo: z.iso.date(),
    /** Days the consent stays valid once granted. */
    validDays: z.number().int().min(1).max(365).default(30),
  })
  .refine((v) => v.dateTo >= v.dateFrom, { path: ['dateTo'], message: 'End date must be on or after the start date' });
export type ConsentRequestInput = z.input<typeof consentRequestSchema>;

export type ConsentStatus = 'requested' | 'granted' | 'denied' | 'expired' | 'revoked';
export interface ConsentRequest {
  id: string;
  patientId: string;
  abhaAddress: string;
  purpose: ConsentPurpose;
  hiTypes: HealthInfoType[];
  dateFrom: string;
  dateTo: string;
  expiresAt: string;
  status: ConsentStatus;
  gatewayRequestId: string | null;
  artefactIds: string[];
  requestedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const consentQuerySchema = z.object({
  patientId: z.uuid().optional(),
  status: z.enum(['requested', 'granted', 'denied', 'expired', 'revoked', 'all']).default('all'),
  ...listQuery,
});
export type ConsentQuery = { patientId?: string; status?: ConsentStatus | 'all'; page?: number; pageSize?: number };

/** Minimal FHIR R4 shapes used by this module. */
export interface FhirResource {
  resourceType: string;
  id?: string;
  [key: string]: unknown;
}
export interface FhirBundle extends FhirResource {
  resourceType: 'Bundle';
  type: string;
  entry: { fullUrl?: string; resource: FhirResource }[];
}

// ---------- Online payments ----------

export type PaymentIntentStatus = 'created' | 'paid' | 'failed' | 'cancelled';
export type SettlementStatus = 'pending' | 'recorded' | 'error';
export interface PaymentIntent {
  id: string;
  invoiceId: string;
  patientId: string;
  amount: number;
  currency: 'INR';
  provider: Exclude<PaymentProvider, 'none'>;
  providerOrderId: string;
  providerPaymentId: string | null;
  status: PaymentIntentStatus;
  /** Whether the money was posted to the bill in Billing. */
  settlementStatus: SettlementStatus;
  settlementError: string | null;
  /** What a checkout page needs (key id, order id, or the simulator link). */
  checkout: { keyId: string | null; orderId: string; payUrl: string | null };
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

export const createPaymentIntentSchema = z.object({
  invoiceId: z.uuid(),
  /** Defaults to the bill's balance. */
  amount: z.number().positive().multipleOf(0.01).optional(),
});
export type CreatePaymentIntent = z.input<typeof createPaymentIntentSchema>;

export const paymentIntentQuerySchema = z.object({
  invoiceId: z.uuid().optional(),
  status: z.enum(['created', 'paid', 'failed', 'cancelled', 'all']).default('all'),
  ...listQuery,
});
export type PaymentIntentQuery = { invoiceId?: string; status?: PaymentIntentStatus | 'all'; page?: number; pageSize?: number };

export const mockPaymentOutcomeSchema = z.object({ outcome: z.enum(['success', 'failure']) });
export type MockPaymentOutcome = z.input<typeof mockPaymentOutcomeSchema>;

// ---------- Public API keys ----------

export const API_SCOPES = ['patients.read', 'lab.results.write', 'payments.read'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'patients.read': 'Read patient demographics (FHIR Patient)',
  'lab.results.write': 'Send lab machine results (HL7 v2)',
  'payments.read': 'Read online payment status',
};

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type CreateApiKey = z.input<typeof createApiKeySchema>;

export interface ApiKey {
  id: string;
  name: string;
  /** First characters of the key, to tell keys apart. */
  prefix: string;
  scopes: ApiScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
/** Returned once at creation. The full key is never shown again. */
export interface CreatedApiKey extends ApiKey {
  key: string;
}

// ---------- Outbound webhooks ----------

/** Events third parties can subscribe to. */
export const WEBHOOK_EVENTS = [
  'core.patient.registered',
  'frontoffice.appointment.booked',
  'frontoffice.appointment.cancelled',
  'emr.encounter.signed',
  'billing.invoice.finalized',
  'billing.payment.received',
  'integrations.abha.linked',
  'integrations.payment.captured',
  'integrations.device.results_received',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const webhookUrl = z
  .url({ protocol: /^https?$/ })
  .max(500)
  .refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u + '/'), 'Webhook URLs must use https');

export const webhookEndpointInputSchema = z.object({
  url: webhookUrl,
  description: optionalText(200),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  isActive: z.boolean().default(true),
});
export type WebhookEndpointInput = z.input<typeof webhookEndpointInputSchema>;

export interface WebhookEndpoint {
  id: string;
  url: string;
  description: string | null;
  events: WebhookEvent[];
  isActive: boolean;
  /** Only returned when the endpoint is created or its secret is rotated. */
  secret?: string;
  secretHint: string;
  createdAt: string;
  updatedAt: string;
}

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed';
export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  topic: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  /** True when the server is in dry-run mode and did not actually send it. */
  dryRun: boolean;
  deliveredAt: string | null;
  createdAt: string;
}

export const webhookDeliveryQuerySchema = z.object({
  endpointId: z.uuid().optional(),
  status: z.enum(['pending', 'delivered', 'failed', 'all']).default('all'),
  ...listQuery,
});
export type WebhookDeliveryQuery = { endpointId?: string; status?: WebhookDeliveryStatus | 'all'; page?: number; pageSize?: number };

// ---------- Lab machine interfaces ----------

export const DEVICE_PROTOCOLS = ['hl7v2'] as const;
export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];

export const deviceInputSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, 'Use letters, digits, - or _'),
  name: z.string().trim().min(2).max(100),
  model: optionalText(100),
  protocol: z.enum(DEVICE_PROTOCOLS).default('hl7v2'),
  facilityId: z.uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});
export type DeviceInput = z.input<typeof deviceInputSchema>;
export const updateDeviceSchema = patchSchema(deviceInputSchema.omit({ code: true }));
export type UpdateDevice = z.input<typeof updateDeviceSchema>;

export interface LabDevice {
  id: string;
  code: string;
  name: string;
  model: string | null;
  protocol: DeviceProtocol;
  facilityId: string | null;
  isActive: boolean;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface DeviceResult {
  code: string;
  name: string | null;
  value: string;
  unit: string | null;
  referenceRange: string | null;
  /** HL7 abnormal flag: N, L, H, LL, HH, A… */
  flag: string | null;
  observedAt: string | null;
}

export type DeviceMessageStatus = 'accepted' | 'rejected';
export interface DeviceMessage {
  id: string;
  deviceId: string;
  deviceCode: string;
  messageType: string | null;
  controlId: string | null;
  sampleId: string | null;
  patientRef: string | null;
  results: DeviceResult[];
  status: DeviceMessageStatus;
  error: string | null;
  raw: string;
  receivedAt: string;
}

export const deviceMessageQuerySchema = z.object({
  deviceId: z.uuid().optional(),
  sampleId: z.string().trim().max(64).optional(),
  status: z.enum(['accepted', 'rejected', 'all']).default('all'),
  ...listQuery,
});
export type DeviceMessageQuery = { deviceId?: string; sampleId?: string; status?: DeviceMessageStatus | 'all'; page?: number; pageSize?: number };

/** Body for POST /integrations/public/v1/lab/hl7 (API key with lab.results.write) and the staff test endpoint. */
export const hl7InboundSchema = z.object({
  deviceCode: z.string().trim().toUpperCase().min(2).max(30),
  /** One HL7 v2 ORU^R01 message; segments separated by \r or newlines. */
  message: z.string().min(10).max(200_000),
});
export type Hl7Inbound = z.input<typeof hl7InboundSchema>;
export const deviceTestMessageSchema = z.object({ message: z.string().min(10).max(200_000) });
export type DeviceTestMessage = z.input<typeof deviceTestMessageSchema>;

export interface Hl7AckResponse {
  messageId: string | null;
  status: DeviceMessageStatus;
  /** HL7 ACK message (MSA AA = accepted, AE = error). */
  ack: string;
  resultCount: number;
  duplicate: boolean;
  error: string | null;
}

// ---------- Events published by this module ----------

/** `integrations.abha.linked` */
export interface AbhaLinkedEvent {
  patientId: string;
  abhaNumber: string;
  abhaAddress: string | null;
}
/** `integrations.payment.captured`: money is also posted to the bill through BillingService. */
export interface PaymentCapturedEvent {
  intentId: string;
  invoiceId: string;
  patientId: string;
  amount: number;
  provider: string;
  providerPaymentId: string;
}
/** `integrations.device.results_received`: for the lab module to match by sample barcode. */
export interface DeviceResultsReceivedEvent {
  messageId: string;
  deviceId: string;
  deviceCode: string;
  sampleId: string | null;
  patientRef: string | null;
  results: DeviceResult[];
}
