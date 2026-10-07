/**
 * Integrations tables. Owned by the "integrations" workstream (Postgres schema: integrations).
 * Kept in sync with migrations/*_integrations_*.sql (pnpm test checks it).
 */
import { boolean, date, index, integer, jsonb, numeric, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { actorColumns, integrations as pg, idColumn, tenantIdColumn, timestamps } from './_common';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const integrationsSettings = pg.table(
  'settings',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    abdmMode: text('abdm_mode').notNull().default('disabled'),
    hfrId: text('hfr_id'),
    hipName: text('hip_name'),
    paymentProvider: text('payment_provider').notNull().default('none'),
    paymentKeyId: text('payment_key_id'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('integrations_settings_tenant_uq').on(t.tenantId)],
);

export const integrationsAbhaRequests = pg.table(
  'abha_requests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    purpose: text('purpose').notNull(),
    method: text('method').notNull(),
    identifierMasked: text('identifier_masked').notNull(),
    gatewayTxnId: text('gateway_txn_id').notNull(),
    sentTo: text('sent_to'),
    status: text('status').notNull().default('otp_sent'),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    patientId: uuid('patient_id'),
    profile: jsonb('profile'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const integrationsAbhaLinks = pg.table(
  'abha_links',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    abhaNumber: text('abha_number').notNull(),
    abhaAddress: text('abha_address'),
    name: text('name').notNull(),
    gender: text('gender'),
    yearOfBirth: integer('year_of_birth'),
    verifiedVia: text('verified_via').notNull(),
    requestId: uuid('request_id'),
    status: text('status').notNull().default('linked'),
    linkedAt: ts('linked_at').notNull().defaultNow(),
    unlinkedAt: ts('unlinked_at'),
    unlinkReason: text('unlink_reason'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const integrationsScanShareTokens = pg.table(
  'scan_share_tokens',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    gatewayRequestId: text('gateway_request_id').notNull(),
    tokenDate: date('token_date').notNull(),
    tokenNo: integer('token_no').notNull(),
    profile: jsonb('profile').notNull(),
    status: text('status').notNull().default('pending'),
    patientId: uuid('patient_id'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: ts('resolved_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('integrations_scan_share_request_uq').on(t.tenantId, t.gatewayRequestId),
    uniqueIndex('integrations_scan_share_token_uq').on(t.tenantId, t.tokenDate, t.tokenNo),
  ],
);

export const integrationsCareContexts = pg.table(
  'care_contexts',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    abhaLinkId: uuid('abha_link_id').notNull(),
    reference: text('reference').notNull(),
    display: text('display').notNull(),
    hiTypes: text('hi_types').array().notNull(),
    sourceModule: text('source_module').notNull(),
    sourceRefId: uuid('source_ref_id'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    linkedAt: ts('linked_at'),
    error: text('error'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('integrations_care_contexts_ref_uq').on(t.tenantId, t.reference)],
);

export const integrationsConsentRequests = pg.table(
  'consent_requests',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    patientId: uuid('patient_id').notNull(),
    abhaAddress: text('abha_address').notNull(),
    purpose: text('purpose').notNull(),
    hiTypes: text('hi_types').array().notNull(),
    dateFrom: date('date_from').notNull(),
    dateTo: date('date_to').notNull(),
    expiresAt: ts('expires_at').notNull(),
    status: text('status').notNull().default('requested'),
    gatewayRequestId: text('gateway_request_id'),
    artefactIds: text('artefact_ids').array().notNull().default([]),
    requestedBy: uuid('requested_by'),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const integrationsPaymentIntents = pg.table(
  'payment_intents',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    invoiceId: uuid('invoice_id').notNull(),
    patientId: uuid('patient_id').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('INR'),
    provider: text('provider').notNull(),
    providerOrderId: text('provider_order_id').notNull(),
    providerPaymentId: text('provider_payment_id'),
    status: text('status').notNull().default('created'),
    settlementStatus: text('settlement_status').notNull().default('pending'),
    settlementError: text('settlement_error'),
    failureReason: text('failure_reason'),
    checkout: jsonb('checkout').notNull().default({}),
    paidAt: ts('paid_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('integrations_payment_intents_order_uq').on(t.tenantId, t.provider, t.providerOrderId),
    index('integrations_payment_intents_invoice_idx').on(t.tenantId, t.invoiceId),
  ],
);

export const integrationsApiKeys = pg.table(
  'api_keys',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    lastUsedAt: ts('last_used_at'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const integrationsWebhookEndpoints = pg.table(
  'webhook_endpoints',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    url: text('url').notNull(),
    description: text('description'),
    events: text('events').array().notNull(),
    secret: text('secret').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);

export const integrationsWebhookDeliveries = pg.table(
  'webhook_deliveries',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    endpointId: uuid('endpoint_id').notNull(),
    eventId: uuid('event_id').notNull(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    lastError: text('last_error'),
    dryRun: boolean('dry_run').notNull().default(false),
    deliveredAt: ts('delivered_at'),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.id] }),
    uniqueIndex('integrations_webhook_deliveries_event_uq').on(t.tenantId, t.endpointId, t.eventId),
  ],
);

export const integrationsLabDevices = pg.table(
  'lab_devices',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    model: text('model'),
    protocol: text('protocol').notNull().default('hl7v2'),
    facilityId: uuid('facility_id'),
    isActive: boolean('is_active').notNull().default(true),
    lastMessageAt: ts('last_message_at'),
    ...actorColumns(),
    ...timestamps(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] }), uniqueIndex('integrations_lab_devices_code_uq').on(t.tenantId, t.code)],
);

export const integrationsDeviceMessages = pg.table(
  'device_messages',
  {
    tenantId: tenantIdColumn(),
    id: idColumn(),
    deviceId: uuid('device_id').notNull(),
    messageType: text('message_type'),
    controlId: text('control_id'),
    sampleId: text('sample_id'),
    patientRef: text('patient_ref'),
    results: jsonb('results').notNull().default([]),
    status: text('status').notNull(),
    error: text('error'),
    raw: text('raw').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.id] })],
);
