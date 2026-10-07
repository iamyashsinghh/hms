-- notifications: init
-- Tenant tables: (tenant_id, id) primary key, FKs include tenant_id, then:
--   SELECT app.enable_tenant_rls('schema.table');
--   SELECT app.enable_updated_at('schema.table');   -- if it has updated_at
--   SELECT app.enable_audit('schema.table');        -- for clinical/financial records

-- Templates: hospital overrides of the built-in defaults in @hms/shared (DEFAULT_TEMPLATES).
CREATE TABLE comms.templates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'push')),
  subject text,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  dlt_template_id text,
  provider_template_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX templates_key_channel_uq ON comms.templates (tenant_id, key, channel);
SELECT app.enable_tenant_rls('comms.templates');
SELECT app.enable_updated_at('comms.templates');

-- Rules: hospital overrides of the default event -> template rules (NOTIFICATION_EVENTS).
CREATE TABLE comms.rules (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  event_topic text NOT NULL,
  template_key text NOT NULL,
  channels text[] NOT NULL DEFAULT '{}' CHECK (channels <@ ARRAY['sms', 'whatsapp', 'email', 'push']),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX rules_event_template_uq ON comms.rules (tenant_id, event_topic, template_key);
SELECT app.enable_tenant_rls('comms.rules');
SELECT app.enable_updated_at('comms.rules');

-- Delivery log: one row per message per channel.
CREATE TABLE comms.messages (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'push')),
  template_key text NOT NULL,
  recipient text,
  patient_id uuid,
  user_id uuid,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'skipped')),
  reason text CHECK (reason IN ('no_address', 'no_template', 'opted_out', 'channel_disabled', 'insufficient_credits', 'provider_error')),
  error text,
  provider text,
  provider_message_id text,
  cost numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  attempts integer NOT NULL DEFAULT 0,
  source_module text,
  source_ref text,
  idempotency_key text,
  meta jsonb NOT NULL DEFAULT '{}',
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id)
);
CREATE UNIQUE INDEX messages_idempotency_uq ON comms.messages (tenant_id, idempotency_key);
CREATE INDEX messages_created_idx ON comms.messages (tenant_id, created_at);
CREATE INDEX messages_patient_idx ON comms.messages (tenant_id, patient_id);
CREATE INDEX messages_status_idx ON comms.messages (tenant_id, status);
SELECT app.enable_tenant_rls('comms.messages');
SELECT app.enable_updated_at('comms.messages');

-- Do-not-contact list. channel 'all' blocks every channel for the address.
CREATE TABLE comms.opt_outs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'push', 'all')),
  address text NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX opt_outs_channel_address_uq ON comms.opt_outs (tenant_id, channel, address);
SELECT app.enable_tenant_rls('comms.opt_outs');

-- Prepaid message credits (1 credit = Rs 1). Append-only; balance = sum(amount).
CREATE TABLE comms.credit_ledger (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  entry_type text NOT NULL CHECK (entry_type IN ('grant', 'topup', 'debit', 'refund', 'adjustment')),
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  channel text CHECK (channel IN ('sms', 'whatsapp', 'email', 'push')),
  message_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK ((entry_type = 'debit') = (amount < 0) OR entry_type = 'adjustment'),
  FOREIGN KEY (tenant_id, message_id) REFERENCES comms.messages (tenant_id, id)
);
CREATE INDEX credit_ledger_created_idx ON comms.credit_ledger (tenant_id, created_at);
-- A message is refunded at most once.
CREATE UNIQUE INDEX credit_ledger_refund_uq ON comms.credit_ledger (tenant_id, message_id) WHERE entry_type = 'refund';
SELECT app.enable_tenant_rls('comms.credit_ledger');
SELECT app.enable_audit('comms.credit_ledger');
REVOKE UPDATE, DELETE ON comms.credit_ledger FROM hms_app;

-- Per-hospital messaging settings (one row, created on first use).
CREATE TABLE comms.settings (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  enabled_channels text[] NOT NULL CHECK (enabled_channels <@ ARRAY['sms', 'whatsapp', 'email', 'push']),
  default_channels text[] NOT NULL CHECK (default_channels <@ ARRAY['sms', 'whatsapp', 'email', 'push']),
  display_name text,
  sms_sender_id text CHECK (sms_sender_id ~ '^[A-Z]{6}$'),
  email_from_name text,
  email_reply_to text,
  rates jsonb NOT NULL,
  low_balance_threshold numeric(14,2) NOT NULL DEFAULT 50 CHECK (low_balance_threshold >= 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX settings_tenant_uq ON comms.settings (tenant_id);
SELECT app.enable_tenant_rls('comms.settings');
SELECT app.enable_updated_at('comms.settings');
SELECT app.enable_audit('comms.settings');

-- Push tokens for staff users and patients.
CREATE TABLE comms.devices (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid,
  patient_id uuid,
  token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_variant text NOT NULL CHECK (app_variant IN ('doctor', 'staff', 'owner', 'patient')),
  device_name text,
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX devices_token_uq ON comms.devices (tenant_id, token);
CREATE INDEX devices_user_idx ON comms.devices (tenant_id, user_id);
CREATE INDEX devices_patient_idx ON comms.devices (tenant_id, patient_id);
SELECT app.enable_tenant_rls('comms.devices');
SELECT app.enable_updated_at('comms.devices');
