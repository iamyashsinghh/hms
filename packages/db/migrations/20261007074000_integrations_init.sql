-- integrations: ABDM (ABHA requests and links, Scan-and-Share tokens, HIP care contexts, HIU consent
-- requests), online payment intents, public API keys, outbound webhooks and lab-machine interfaces.
-- No secrets are stored here except webhook signing secrets (we generate them and must sign with them).
-- Aadhaar numbers are never stored; ABHA requests keep a masked identifier only.

-- ---------- settings (one row per hospital) ----------

CREATE TABLE integrations.settings (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  abdm_mode text NOT NULL DEFAULT 'disabled' CHECK (abdm_mode IN ('disabled', 'mock', 'sandbox')),
  hfr_id text,
  hip_name text,
  payment_provider text NOT NULL DEFAULT 'none' CHECK (payment_provider IN ('none', 'mock', 'razorpay')),
  payment_key_id text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX integrations_settings_tenant_uq ON integrations.settings (tenant_id);

-- ---------- ABHA OTP requests (create / verify) ----------

CREATE TABLE integrations.abha_requests (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  purpose text NOT NULL CHECK (purpose IN ('create', 'verify')),
  method text NOT NULL CHECK (method IN ('aadhaar', 'mobile', 'abha')),
  identifier_masked text NOT NULL,
  gateway_txn_id text NOT NULL,
  sent_to text,
  status text NOT NULL DEFAULT 'otp_sent' CHECK (status IN ('otp_sent', 'verified', 'failed', 'expired')),
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  patient_id uuid,
  profile jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE INDEX integrations_abha_requests_created_idx ON integrations.abha_requests (tenant_id, created_at DESC);

-- ---------- ABHA links (patient <-> ABHA) ----------

CREATE TABLE integrations.abha_links (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  abha_number text NOT NULL CHECK (abha_number ~ '^\d{14}$'),
  abha_address text,
  name text NOT NULL,
  gender text,
  year_of_birth integer,
  verified_via text NOT NULL CHECK (verified_via IN ('aadhaar', 'mobile', 'abha', 'scan_share')),
  request_id uuid,
  status text NOT NULL DEFAULT 'linked' CHECK (status IN ('linked', 'unlinked')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlink_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
-- One active ABHA per patient, and one patient per ABHA, within a hospital.
CREATE UNIQUE INDEX integrations_abha_links_patient_uq ON integrations.abha_links (tenant_id, patient_id) WHERE status = 'linked';
CREATE UNIQUE INDEX integrations_abha_links_abha_uq ON integrations.abha_links (tenant_id, abha_number) WHERE status = 'linked';

-- ---------- Scan and Share tokens ----------

CREATE TABLE integrations.scan_share_tokens (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  gateway_request_id text NOT NULL,
  token_date date NOT NULL,
  token_no integer NOT NULL,
  profile jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'registered', 'linked', 'dismissed')),
  patient_id uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX integrations_scan_share_request_uq ON integrations.scan_share_tokens (tenant_id, gateway_request_id);
CREATE UNIQUE INDEX integrations_scan_share_token_uq ON integrations.scan_share_tokens (tenant_id, token_date, token_no);

-- ---------- HIP care contexts ----------

CREATE TABLE integrations.care_contexts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  abha_link_id uuid NOT NULL,
  reference text NOT NULL,
  display text NOT NULL,
  hi_types text[] NOT NULL,
  source_module text NOT NULL,
  source_ref_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'linked', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  linked_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, abha_link_id) REFERENCES integrations.abha_links (tenant_id, id)
);
CREATE UNIQUE INDEX integrations_care_contexts_ref_uq ON integrations.care_contexts (tenant_id, reference);
CREATE INDEX integrations_care_contexts_patient_idx ON integrations.care_contexts (tenant_id, patient_id);

-- ---------- HIU consent requests ----------

CREATE TABLE integrations.consent_requests (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  abha_address text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('CAREMGT', 'BTG', 'PUBHLTH', 'HPAYMT', 'DSRCH', 'PATRQT')),
  hi_types text[] NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'granted', 'denied', 'expired', 'revoked')),
  gateway_request_id text,
  artefact_ids text[] NOT NULL DEFAULT '{}',
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  CHECK (date_to >= date_from)
);
CREATE INDEX integrations_consents_patient_idx ON integrations.consent_requests (tenant_id, patient_id, created_at DESC);

-- ---------- Online payment intents ----------

CREATE TABLE integrations.payment_intents (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  provider text NOT NULL CHECK (provider IN ('mock', 'razorpay')),
  provider_order_id text NOT NULL,
  provider_payment_id text,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed', 'cancelled')),
  settlement_status text NOT NULL DEFAULT 'pending' CHECK (settlement_status IN ('pending', 'recorded', 'error')),
  settlement_error text,
  failure_reason text,
  checkout jsonb NOT NULL DEFAULT '{}',
  paid_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX integrations_payment_intents_order_uq ON integrations.payment_intents (tenant_id, provider, provider_order_id);
CREATE INDEX integrations_payment_intents_invoice_idx ON integrations.payment_intents (tenant_id, invoice_id);

-- ---------- Public API keys ----------

CREATE TABLE integrations.api_keys (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  prefix text NOT NULL,
  -- sha256 of the secret part; the key itself is shown once and never stored.
  key_hash text NOT NULL,
  scopes text[] NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);

-- ---------- Outbound webhooks ----------

CREATE TABLE integrations.webhook_endpoints (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  url text NOT NULL,
  description text,
  events text[] NOT NULL,
  secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX integrations_webhook_endpoints_events_idx ON integrations.webhook_endpoints USING gin (events);

CREATE TABLE integrations.webhook_deliveries (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  endpoint_id uuid NOT NULL,
  event_id uuid NOT NULL,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  response_status integer,
  last_error text,
  dry_run boolean NOT NULL DEFAULT false,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, endpoint_id) REFERENCES integrations.webhook_endpoints (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX integrations_webhook_deliveries_event_uq ON integrations.webhook_deliveries (tenant_id, endpoint_id, event_id);
CREATE INDEX integrations_webhook_deliveries_created_idx ON integrations.webhook_deliveries (tenant_id, created_at DESC);

-- ---------- Lab machine interfaces ----------

CREATE TABLE integrations.lab_devices (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
  name text NOT NULL,
  model text,
  protocol text NOT NULL DEFAULT 'hl7v2' CHECK (protocol IN ('hl7v2')),
  facility_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  last_message_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX integrations_lab_devices_code_uq ON integrations.lab_devices (tenant_id, code);

CREATE TABLE integrations.device_messages (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  device_id uuid NOT NULL,
  message_type text,
  control_id text,
  sample_id text,
  patient_ref text,
  results jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL CHECK (status IN ('accepted', 'rejected')),
  error text,
  raw text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, device_id) REFERENCES integrations.lab_devices (tenant_id, id)
);
-- A machine resending an accepted message (same MSH-10) gets the original ACK back and no duplicate results.
CREATE UNIQUE INDEX integrations_device_messages_control_uq ON integrations.device_messages (tenant_id, device_id, control_id) WHERE control_id IS NOT NULL AND status = 'accepted';
CREATE INDEX integrations_device_messages_sample_idx ON integrations.device_messages (tenant_id, sample_id);
CREATE INDEX integrations_device_messages_received_idx ON integrations.device_messages (tenant_id, received_at DESC);

-- ---------- RLS, updated_at, audit ----------

SELECT app.enable_tenant_rls('integrations.settings');
SELECT app.enable_tenant_rls('integrations.abha_requests');
SELECT app.enable_tenant_rls('integrations.abha_links');
SELECT app.enable_tenant_rls('integrations.scan_share_tokens');
SELECT app.enable_tenant_rls('integrations.care_contexts');
SELECT app.enable_tenant_rls('integrations.consent_requests');
SELECT app.enable_tenant_rls('integrations.payment_intents');
SELECT app.enable_tenant_rls('integrations.api_keys');
SELECT app.enable_tenant_rls('integrations.webhook_endpoints');
SELECT app.enable_tenant_rls('integrations.webhook_deliveries');
SELECT app.enable_tenant_rls('integrations.lab_devices');
SELECT app.enable_tenant_rls('integrations.device_messages');

SELECT app.enable_updated_at('integrations.settings');
SELECT app.enable_updated_at('integrations.abha_requests');
SELECT app.enable_updated_at('integrations.abha_links');
SELECT app.enable_updated_at('integrations.scan_share_tokens');
SELECT app.enable_updated_at('integrations.care_contexts');
SELECT app.enable_updated_at('integrations.consent_requests');
SELECT app.enable_updated_at('integrations.payment_intents');
SELECT app.enable_updated_at('integrations.api_keys');
SELECT app.enable_updated_at('integrations.webhook_endpoints');
SELECT app.enable_updated_at('integrations.webhook_deliveries');
SELECT app.enable_updated_at('integrations.lab_devices');

-- Identity links, consents, money and API keys are audited (webhook endpoints are not: the row holds a signing secret).
SELECT app.enable_audit('integrations.settings');
SELECT app.enable_audit('integrations.abha_links');
SELECT app.enable_audit('integrations.consent_requests');
SELECT app.enable_audit('integrations.payment_intents');
SELECT app.enable_audit('integrations.api_keys');
