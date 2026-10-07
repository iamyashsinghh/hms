-- insurance: payers (insurers, TPAs, corporates, government schemes), scheme packages, patient policies,
-- pre-authorisations, claims (bills, documents), settlements and their postings to billing, and an
-- append-only history of every status change.

-- ---------- payers ----------

CREATE TABLE insurance.payers (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('insurer', 'tpa', 'corporate', 'government')),
  scheme text CHECK (scheme IN ('pmjay', 'cghs', 'echs', 'esic', 'state', 'other')),
  contact_name text,
  phone text,
  email text,
  address text,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
  portal_url text,
  credit_days integer NOT NULL DEFAULT 30 CHECK (credit_days BETWEEN 0 AND 365),
  tds_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (tds_percent BETWEEN 0 AND 100),
  copay_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (copay_percent BETWEEN 0 AND 100),
  credit_limit numeric(14,2) CHECK (credit_limit >= 0),
  preauth_required boolean NOT NULL DEFAULT true,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (type <> 'government' OR scheme IS NOT NULL)
);
CREATE UNIQUE INDEX insurance_payers_code_uq ON insurance.payers (tenant_id, code);
CREATE INDEX insurance_payers_name_trgm_idx ON insurance.payers USING gin (lower(name) gin_trgm_ops);

-- ---------- scheme / payer packages (PM-JAY HBP, CGHS rates, corporate packages) ----------

CREATE TABLE insurance.packages (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  payer_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name text NOT NULL,
  specialty text,
  rate numeric(14,2) NOT NULL CHECK (rate >= 0),
  los_days integer CHECK (los_days BETWEEN 0 AND 365),
  preauth_required boolean NOT NULL DEFAULT true,
  inclusions text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_id) REFERENCES insurance.payers (tenant_id, id)
);
CREATE UNIQUE INDEX insurance_packages_code_uq ON insurance.packages (tenant_id, payer_id, code);

-- ---------- patient policies ----------

CREATE TABLE insurance.policies (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  -- Snapshot for lists; the patient master stays the source of truth.
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  payer_id uuid NOT NULL,
  tpa_id uuid,
  policy_number text NOT NULL,
  member_id text,
  holder_name text,
  relation text NOT NULL DEFAULT 'self' CHECK (relation IN ('self', 'spouse', 'child', 'parent', 'sibling', 'other')),
  employee_id text,
  valid_from date,
  valid_to date,
  sum_insured numeric(14,2) CHECK (sum_insured >= 0),
  copay_percent numeric(5,2) CHECK (copay_percent BETWEEN 0 AND 100),
  room_rent_limit numeric(14,2) CHECK (room_rent_limit >= 0),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  verified_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_id) REFERENCES insurance.payers (tenant_id, id),
  FOREIGN KEY (tenant_id, tpa_id) REFERENCES insurance.payers (tenant_id, id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE INDEX insurance_policies_patient_idx ON insurance.policies (tenant_id, patient_id);
CREATE UNIQUE INDEX insurance_policies_number_uq ON insurance.policies (tenant_id, payer_id, policy_number, patient_id);

-- ---------- pre-authorisations ----------

CREATE TABLE insurance.preauths (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  policy_id uuid NOT NULL,
  -- Who decides it: the policy's TPA, else its payer.
  payer_id uuid NOT NULL,
  doctor_id uuid,
  package_id uuid,
  admission_ref text,
  diagnosis text NOT NULL,
  icd_codes text[] NOT NULL DEFAULT '{}',
  procedure text,
  expected_admission date,
  expected_los_days integer,
  estimated_amount numeric(14,2) NOT NULL CHECK (estimated_amount >= 0),
  requested_amount numeric(14,2) NOT NULL CHECK (requested_amount >= 0),
  approved_amount numeric(14,2) CHECK (approved_amount >= 0),
  payer_ref text,
  valid_until date,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'query', 'approved', 'rejected', 'cancelled')),
  submitted_at timestamptz,
  decided_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES insurance.policies (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_id) REFERENCES insurance.payers (tenant_id, id),
  FOREIGN KEY (tenant_id, package_id) REFERENCES insurance.packages (tenant_id, id)
);
CREATE UNIQUE INDEX insurance_preauths_number_uq ON insurance.preauths (tenant_id, number);
CREATE INDEX insurance_preauths_status_idx ON insurance.preauths (tenant_id, status, created_at DESC);
CREATE INDEX insurance_preauths_patient_idx ON insurance.preauths (tenant_id, patient_id);

-- ---------- claims ----------

CREATE TABLE insurance.claims (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  policy_id uuid NOT NULL,
  payer_id uuid NOT NULL,
  preauth_id uuid,
  claim_type text NOT NULL DEFAULT 'cashless' CHECK (claim_type IN ('cashless', 'credit')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'query', 'approved', 'partially_settled', 'settled', 'rejected', 'cancelled')),
  payer_claim_no text,
  admission_date date,
  discharge_date date,
  diagnosis text,
  notes text,
  claimed_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
  approved_amount numeric(14,2) CHECK (approved_amount >= 0),
  settled_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
  tds_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  deduction_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  write_off_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (write_off_amount >= 0),
  patient_recovery_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (patient_recovery_amount >= 0),
  submitted_at timestamptz,
  due_date date,
  closed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, policy_id) REFERENCES insurance.policies (tenant_id, id),
  FOREIGN KEY (tenant_id, payer_id) REFERENCES insurance.payers (tenant_id, id),
  FOREIGN KEY (tenant_id, preauth_id) REFERENCES insurance.preauths (tenant_id, id),
  CHECK (discharge_date IS NULL OR admission_date IS NULL OR discharge_date >= admission_date)
);
CREATE UNIQUE INDEX insurance_claims_number_uq ON insurance.claims (tenant_id, number);
CREATE INDEX insurance_claims_status_idx ON insurance.claims (tenant_id, status, created_at DESC);
CREATE INDEX insurance_claims_payer_idx ON insurance.claims (tenant_id, payer_id, status);
CREATE INDEX insurance_claims_patient_idx ON insurance.claims (tenant_id, patient_id);

-- Bills on a claim and the payer's share of each. A bill sits on one live claim at a time.
CREATE TABLE insurance.claim_invoices (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  claim_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  invoice_total numeric(14,2) NOT NULL,
  payer_amount numeric(14,2) NOT NULL CHECK (payer_amount >= 0),
  patient_amount numeric(14,2) NOT NULL CHECK (patient_amount >= 0),
  -- Set when the claim is cancelled, so the bill can go on another claim.
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES insurance.claims (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id)
);
CREATE UNIQUE INDEX insurance_claim_invoices_live_uq ON insurance.claim_invoices (tenant_id, invoice_id) WHERE released_at IS NULL;
CREATE INDEX insurance_claim_invoices_claim_idx ON insurance.claim_invoices (tenant_id, claim_id);

-- Document checklist for a claim (files live elsewhere; url points at them).
CREATE TABLE insurance.claim_documents (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  claim_id uuid NOT NULL,
  doc_type text NOT NULL CHECK (doc_type IN ('preauth_form', 'policy_card', 'id_proof', 'consultation_notes',
    'investigation_reports', 'discharge_summary', 'final_bill', 'pharmacy_bills', 'claim_form', 'other')),
  title text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  url text,
  note text,
  received_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES insurance.claims (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX insurance_claim_documents_claim_idx ON insurance.claim_documents (tenant_id, claim_id);

-- ---------- settlements ----------

CREATE TABLE insurance.settlements (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  claim_id uuid NOT NULL,
  settled_on date NOT NULL,
  reference text NOT NULL,
  amount_paid numeric(14,2) NOT NULL CHECK (amount_paid >= 0),
  tds_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_amount >= 0),
  deductions jsonb NOT NULL DEFAULT '[]',
  deduction_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  write_off_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (write_off_amount >= 0),
  patient_recovery_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (patient_recovery_amount >= 0),
  posting_status text NOT NULL DEFAULT 'pending' CHECK (posting_status IN ('pending', 'posted', 'failed')),
  posting_error text,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES insurance.claims (tenant_id, id)
);
CREATE INDEX insurance_settlements_claim_idx ON insurance.settlements (tenant_id, claim_id);
CREATE INDEX insurance_settlements_date_idx ON insurance.settlements (tenant_id, settled_on);

-- How a settlement lands on each bill: a billing receipt (payment, tds), a credit note (write_off), or
-- a deduction the patient pays (recovery: nothing posted, the amount stays due on the bill). Posted once each.
CREATE TABLE insurance.settlement_postings (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  settlement_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_number text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('payment', 'tds', 'write_off', 'recovery')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  billing_ref text,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, settlement_id) REFERENCES insurance.settlements (tenant_id, id)
);
CREATE UNIQUE INDEX insurance_settlement_postings_uq ON insurance.settlement_postings (tenant_id, settlement_id, invoice_id, kind);

-- ---------- history (append-only) ----------

CREATE TABLE insurance.case_events (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  entity text NOT NULL CHECK (entity IN ('preauth', 'claim')),
  entity_id uuid NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text,
  amount numeric(14,2),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX insurance_case_events_entity_idx ON insurance.case_events (tenant_id, entity, entity_id, created_at);
REVOKE UPDATE, DELETE ON insurance.case_events FROM hms_app;

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('insurance.payers');
SELECT app.enable_tenant_rls('insurance.packages');
SELECT app.enable_tenant_rls('insurance.policies');
SELECT app.enable_tenant_rls('insurance.preauths');
SELECT app.enable_tenant_rls('insurance.claims');
SELECT app.enable_tenant_rls('insurance.claim_invoices');
SELECT app.enable_tenant_rls('insurance.claim_documents');
SELECT app.enable_tenant_rls('insurance.settlements');
SELECT app.enable_tenant_rls('insurance.settlement_postings');
SELECT app.enable_tenant_rls('insurance.case_events');

SELECT app.enable_updated_at('insurance.payers');
SELECT app.enable_updated_at('insurance.packages');
SELECT app.enable_updated_at('insurance.policies');
SELECT app.enable_updated_at('insurance.preauths');
SELECT app.enable_updated_at('insurance.claims');
SELECT app.enable_updated_at('insurance.claim_documents');
SELECT app.enable_updated_at('insurance.settlements');
SELECT app.enable_updated_at('insurance.settlement_postings');

SELECT app.enable_audit('insurance.payers');
SELECT app.enable_audit('insurance.packages');
SELECT app.enable_audit('insurance.policies');
SELECT app.enable_audit('insurance.preauths');
SELECT app.enable_audit('insurance.claims');
SELECT app.enable_audit('insurance.claim_invoices');
SELECT app.enable_audit('insurance.settlements');
SELECT app.enable_audit('insurance.settlement_postings');
