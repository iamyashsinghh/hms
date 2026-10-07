-- portal: patient accounts (OTP login), family links, online booking, record read models, payments, feedback.

CREATE TABLE portal.accounts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  mobile text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
  name text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX portal_accounts_mobile_uq ON portal.accounts (tenant_id, mobile);

CREATE TABLE portal.otp_challenges (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  mobile text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX portal_otp_mobile_idx ON portal.otp_challenges (tenant_id, mobile, created_at);

CREATE TABLE portal.sessions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  account_id uuid NOT NULL,
  token_hash text NOT NULL,
  previous_token_hash text,
  rotated_at timestamptz,
  client text NOT NULL CHECK (client IN ('web', 'mobile')),
  device_name text,
  created_ip text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES portal.accounts (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX portal_sessions_account_idx ON portal.sessions (tenant_id, account_id);

CREATE TABLE portal.account_patients (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  account_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('self', 'spouse', 'child', 'parent', 'sibling', 'other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES portal.accounts (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX portal_account_patients_uq ON portal.account_patients (tenant_id, account_id, patient_id);

CREATE TABLE portal.appointments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  account_id uuid,
  doctor_id uuid NOT NULL,
  doctor_name text,
  facility_id uuid,
  slot_start timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('requested', 'booked', 'confirmed', 'rejected', 'cancelled', 'completed', 'no_show')),
  source text NOT NULL CHECK (source IN ('portal', 'desk')),
  appointment_id uuid,
  reason text,
  staff_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES portal.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX portal_appointments_appt_uq ON portal.appointments (tenant_id, appointment_id);
CREATE INDEX portal_appointments_patient_idx ON portal.appointments (tenant_id, patient_id, slot_start);
CREATE INDEX portal_appointments_doctor_idx ON portal.appointments (tenant_id, doctor_id, slot_start);
-- One live online booking per doctor slot.
CREATE UNIQUE INDEX portal_appointments_slot_uq ON portal.appointments (tenant_id, doctor_id, slot_start)
  WHERE source = 'portal' AND status IN ('requested', 'booked', 'confirmed');

CREATE TABLE portal.prescriptions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  prescription_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid,
  doctor_name text,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX portal_prescriptions_src_uq ON portal.prescriptions (tenant_id, prescription_id);
CREATE INDEX portal_prescriptions_patient_idx ON portal.prescriptions (tenant_id, patient_id);

CREATE TABLE portal.invoices (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL,
  number text,
  patient_id uuid NOT NULL,
  total numeric(14,2) NOT NULL CHECK (total >= 0),
  paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid >= 0),
  status text NOT NULL CHECK (status IN ('unpaid', 'partially_paid', 'paid', 'cancelled')),
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX portal_invoices_src_uq ON portal.invoices (tenant_id, invoice_id);
CREATE INDEX portal_invoices_patient_idx ON portal.invoices (tenant_id, patient_id);

CREATE TABLE portal.reports (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  report_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lab', 'radiology', 'other')),
  title text NOT NULL,
  url text,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX portal_reports_src_uq ON portal.reports (tenant_id, report_id);
CREATE INDEX portal_reports_patient_idx ON portal.reports (tenant_id, patient_id);

CREATE TABLE portal.payment_intents (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  account_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  provider text NOT NULL CHECK (provider IN ('razorpay_stub')),
  provider_order_id text NOT NULL,
  provider_payment_id text,
  status text NOT NULL CHECK (status IN ('created', 'paid', 'failed')),
  paid_at timestamptz,
  -- Set when billing confirms it recorded this payment (billing.payment.received with ref = intent id).
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES portal.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE INDEX portal_payment_intents_invoice_idx ON portal.payment_intents (tenant_id, invoice_id);

CREATE TABLE portal.feedback (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  account_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  appointment_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES portal.accounts (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_request_id) REFERENCES portal.appointments (tenant_id, id)
);
CREATE INDEX portal_feedback_created_idx ON portal.feedback (tenant_id, created_at);

CREATE TABLE portal.processed_events (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  topic text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);

SELECT app.enable_tenant_rls('portal.accounts');
SELECT app.enable_tenant_rls('portal.otp_challenges');
SELECT app.enable_tenant_rls('portal.sessions');
SELECT app.enable_tenant_rls('portal.account_patients');
SELECT app.enable_tenant_rls('portal.appointments');
SELECT app.enable_tenant_rls('portal.prescriptions');
SELECT app.enable_tenant_rls('portal.invoices');
SELECT app.enable_tenant_rls('portal.reports');
SELECT app.enable_tenant_rls('portal.payment_intents');
SELECT app.enable_tenant_rls('portal.feedback');
SELECT app.enable_tenant_rls('portal.processed_events');

SELECT app.enable_updated_at('portal.accounts');
SELECT app.enable_updated_at('portal.appointments');
SELECT app.enable_updated_at('portal.invoices');
SELECT app.enable_updated_at('portal.payment_intents');

SELECT app.enable_audit('portal.accounts');
SELECT app.enable_audit('portal.account_patients');
SELECT app.enable_audit('portal.appointments');
SELECT app.enable_audit('portal.payment_intents');
