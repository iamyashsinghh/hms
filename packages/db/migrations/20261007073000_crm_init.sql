-- crm: referrers, commission rules, referrals, commissions and statements; leads (enquiries) with activity log;
-- health camps; message campaigns; patient follow-up reminders.
-- Commissions are accrued from billing.invoice.finalized and reversed on billing.invoice.cancelled (append-only).

-- ---------- referrers (referring doctors, clinics, agents) ----------

CREATE TABLE crm.referrers (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  type text NOT NULL DEFAULT 'doctor'
    CHECK (type IN ('doctor', 'hospital', 'clinic', 'agent', 'corporate', 'staff', 'other')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  mobile text,
  email text,
  organization text,
  city text,
  registration_no text,
  pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX crm_referrers_code_uq ON crm.referrers (tenant_id, code);
CREATE INDEX crm_referrers_name_trgm_idx ON crm.referrers USING gin (lower(name) gin_trgm_ops);

-- ---------- commission rules ----------
-- referrer_id NULL = hospital default for every referrer. The most specific active rule wins:
-- referrer-specific over default, then service_code over applies_to module over 'all'.

CREATE TABLE crm.commission_rules (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  referrer_id uuid,
  applies_to text NOT NULL DEFAULT 'all'
    CHECK (applies_to IN ('all', 'frontoffice', 'emr', 'billing', 'pharmacy', 'lab', 'radiology', 'ipd')),
  service_code text,
  rate_type text NOT NULL CHECK (rate_type IN ('percent', 'flat')),
  rate numeric(14,2) NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES crm.referrers (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (rate_type <> 'percent' OR rate <= 100)
);
CREATE INDEX crm_commission_rules_referrer_idx ON crm.commission_rules (tenant_id, referrer_id);

-- ---------- health camps ----------

CREATE TABLE crm.camps (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  type text NOT NULL DEFAULT 'health_camp'
    CHECK (type IN ('health_camp', 'screening', 'awareness', 'corporate', 'school', 'other')),
  facility_id uuid,
  location text,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'ongoing', 'completed', 'cancelled')),
  target_count integer CHECK (target_count IS NULL OR target_count >= 0),
  budget numeric(14,2) CHECK (budget IS NULL OR budget >= 0),
  spent numeric(14,2) CHECK (spent IS NULL OR spent >= 0),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (ends_on >= starts_on)
);
CREATE UNIQUE INDEX crm_camps_code_uq ON crm.camps (tenant_id, code);
CREATE INDEX crm_camps_starts_idx ON crm.camps (tenant_id, starts_on DESC);

-- ---------- campaigns (bulk messages to leads, sent through NotificationsService) ----------

CREATE TABLE crm.campaigns (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
  message text NOT NULL CHECK (length(trim(message)) > 0),
  -- {statuses?: string[], sources?: string[], campId?: uuid}
  audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'cancelled')),
  recipient_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  sent_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX crm_campaigns_created_idx ON crm.campaigns (tenant_id, created_at DESC);

-- ---------- leads / enquiries ----------

CREATE TABLE crm.leads (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  mobile text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$'),
  email text,
  gender text CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  age_years integer CHECK (age_years IS NULL OR age_years BETWEEN 0 AND 130),
  city text,
  source text NOT NULL DEFAULT 'walk_in'
    CHECK (source IN ('walk_in', 'phone', 'website', 'camp', 'referral', 'campaign', 'social', 'whatsapp', 'other')),
  interest text,
  notes text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'converted', 'lost')),
  lost_reason text,
  assigned_to uuid,
  next_follow_up_at timestamptz,
  referrer_id uuid,
  camp_id uuid,
  campaign_id uuid,
  patient_id uuid,
  converted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES crm.referrers (tenant_id, id),
  FOREIGN KEY (tenant_id, camp_id) REFERENCES crm.camps (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES crm.campaigns (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  CHECK (mobile IS NOT NULL OR email IS NOT NULL),
  CHECK (status <> 'converted' OR patient_id IS NOT NULL),
  CHECK (status <> 'lost' OR lost_reason IS NOT NULL)
);
CREATE UNIQUE INDEX crm_leads_number_uq ON crm.leads (tenant_id, number);
CREATE INDEX crm_leads_status_idx ON crm.leads (tenant_id, status, created_at DESC);
CREATE INDEX crm_leads_mobile_idx ON crm.leads (tenant_id, mobile);
CREATE INDEX crm_leads_follow_up_idx ON crm.leads (tenant_id, next_follow_up_at) WHERE status IN ('new', 'contacted', 'qualified');
CREATE INDEX crm_leads_camp_idx ON crm.leads (tenant_id, camp_id);
CREATE INDEX crm_leads_name_trgm_idx ON crm.leads USING gin (lower(name) gin_trgm_ops);

CREATE TABLE crm.lead_activities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  lead_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('note', 'call', 'message', 'visit', 'status_change')),
  note text,
  from_status text,
  to_status text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES crm.leads (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX crm_lead_activities_lead_idx ON crm.lead_activities (tenant_id, lead_id, created_at);

-- Who each campaign went to (one row per lead, so re-sending is idempotent).
CREATE TABLE crm.campaign_recipients (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  campaign_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'skipped', 'failed')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, campaign_id) REFERENCES crm.campaigns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, lead_id) REFERENCES crm.leads (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX crm_campaign_recipients_uq ON crm.campaign_recipients (tenant_id, campaign_id, lead_id);

-- ---------- referrals (which referrer sent which patient) ----------

CREATE TABLE crm.referrals (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  referrer_id uuid NOT NULL,
  referred_on date NOT NULL DEFAULT current_date,
  -- Bills dated up to this day earn commission. NULL = no end.
  valid_until date,
  lead_id uuid,
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES crm.referrers (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES crm.leads (tenant_id, id),
  CHECK (valid_until IS NULL OR valid_until >= referred_on)
);
CREATE INDEX crm_referrals_patient_idx ON crm.referrals (tenant_id, patient_id, referred_on DESC);
CREATE INDEX crm_referrals_referrer_idx ON crm.referrals (tenant_id, referrer_id, referred_on DESC);

-- ---------- commission statements and commission ledger ----------

CREATE TABLE crm.commission_statements (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  referrer_id uuid NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  total numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
  approved_by uuid,
  approved_at timestamptz,
  paid_at timestamptz,
  paid_by uuid,
  payment_mode text CHECK (payment_mode IS NULL OR payment_mode IN ('cash', 'upi', 'bank', 'cheque')),
  payment_ref text,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES crm.referrers (tenant_id, id),
  CHECK (period_to >= period_from),
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND payment_mode IS NOT NULL))
);
CREATE UNIQUE INDEX crm_commission_statements_number_uq ON crm.commission_statements (tenant_id, number);
CREATE INDEX crm_commission_statements_referrer_idx ON crm.commission_statements (tenant_id, referrer_id, period_to DESC);

-- One accrual per finalized invoice, one reversal per cancelled invoice that had been put on a statement.
CREATE TABLE crm.commissions (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  kind text NOT NULL CHECK (kind IN ('accrual', 'reversal')),
  referrer_id uuid NOT NULL,
  referral_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  source_module text NOT NULL,
  base_amount numeric(14,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  -- [{description, serviceCode, amount, ruleId, rateType, rate, commission}]
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  statement_id uuid,
  reverses_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, referrer_id) REFERENCES crm.referrers (tenant_id, id),
  FOREIGN KEY (tenant_id, referral_id) REFERENCES crm.referrals (tenant_id, id),
  FOREIGN KEY (tenant_id, statement_id) REFERENCES crm.commission_statements (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_id) REFERENCES crm.commissions (tenant_id, id),
  CHECK ((kind = 'accrual') = (reverses_id IS NULL)),
  CHECK (kind <> 'accrual' OR amount >= 0),
  CHECK (kind <> 'reversal' OR amount <= 0)
);
CREATE UNIQUE INDEX crm_commissions_invoice_kind_uq ON crm.commissions (tenant_id, invoice_id, kind);
CREATE INDEX crm_commissions_open_idx ON crm.commissions (tenant_id, referrer_id, invoice_date) WHERE status = 'open' AND statement_id IS NULL;
CREATE INDEX crm_commissions_statement_idx ON crm.commissions (tenant_id, statement_id);

-- ---------- follow-up reminders ----------

CREATE TABLE crm.follow_ups (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid,
  patient_id uuid,
  lead_id uuid,
  due_date date NOT NULL,
  type text NOT NULL DEFAULT 'revisit'
    CHECK (type IN ('revisit', 'call', 'feedback_recovery', 'test_review', 'other')),
  reason text,
  -- manual = created by staff; emr = doctor's follow-up date; feedback = low portal rating.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'emr', 'feedback')),
  source_ref text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled')),
  assigned_to uuid,
  reminder_count integer NOT NULL DEFAULT 0,
  last_reminded_at timestamptz,
  outcome text,
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, lead_id) REFERENCES crm.leads (tenant_id, id) ON DELETE CASCADE,
  CHECK (patient_id IS NOT NULL OR lead_id IS NOT NULL)
);
CREATE INDEX crm_follow_ups_due_idx ON crm.follow_ups (tenant_id, status, due_date);
CREATE INDEX crm_follow_ups_patient_idx ON crm.follow_ups (tenant_id, patient_id);
-- Events can arrive more than once; one follow-up per source record.
CREATE UNIQUE INDEX crm_follow_ups_source_uq ON crm.follow_ups (tenant_id, source, source_ref) WHERE source_ref IS NOT NULL;

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('crm.referrers');
SELECT app.enable_tenant_rls('crm.commission_rules');
SELECT app.enable_tenant_rls('crm.camps');
SELECT app.enable_tenant_rls('crm.campaigns');
SELECT app.enable_tenant_rls('crm.leads');
SELECT app.enable_tenant_rls('crm.lead_activities');
SELECT app.enable_tenant_rls('crm.campaign_recipients');
SELECT app.enable_tenant_rls('crm.referrals');
SELECT app.enable_tenant_rls('crm.commission_statements');
SELECT app.enable_tenant_rls('crm.commissions');
SELECT app.enable_tenant_rls('crm.follow_ups');

SELECT app.enable_updated_at('crm.referrers');
SELECT app.enable_updated_at('crm.commission_rules');
SELECT app.enable_updated_at('crm.camps');
SELECT app.enable_updated_at('crm.campaigns');
SELECT app.enable_updated_at('crm.leads');
SELECT app.enable_updated_at('crm.referrals');
SELECT app.enable_updated_at('crm.commission_statements');
SELECT app.enable_updated_at('crm.commissions');
SELECT app.enable_updated_at('crm.follow_ups');

-- Money records are audited.
SELECT app.enable_audit('crm.commission_rules');
SELECT app.enable_audit('crm.commission_statements');
SELECT app.enable_audit('crm.commissions');

-- Paid statements and the commissions on them are final.
CREATE OR REPLACE FUNCTION crm.guard_paid_statement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'paid' THEN
    RAISE EXCEPTION 'commission statement % is paid and cannot change', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER guard_paid_statement BEFORE UPDATE OR DELETE ON crm.commission_statements
  FOR EACH ROW EXECUTE FUNCTION crm.guard_paid_statement();

CREATE OR REPLACE FUNCTION crm.guard_commission() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'commissions are append-only' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.base_amount <> OLD.base_amount OR NEW.invoice_id <> OLD.invoice_id
     OR NEW.referrer_id <> OLD.referrer_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'commission amounts cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.statement_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM crm.commission_statements s
    WHERE s.tenant_id = OLD.tenant_id AND s.id = OLD.statement_id AND s.status = 'paid'
  ) THEN
    RAISE EXCEPTION 'commission is on a paid statement' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_commission BEFORE UPDATE OR DELETE ON crm.commissions
  FOR EACH ROW EXECUTE FUNCTION crm.guard_commission();
