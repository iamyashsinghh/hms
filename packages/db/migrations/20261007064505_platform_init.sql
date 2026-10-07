-- platform: plans, subscriptions, subscription invoices, entitlement and limit overrides,
-- platform admins (super-admin console), announcements, help articles, support tickets, onboarding.
--
-- Global tables (plans, admins, announcements, help) have no tenant_id and no RLS.
-- Per-hospital tables have tenant_id + the usual tenant_isolation policy, plus a second
-- policy that lets the super-admin console (app.platform_admin = 'on', set by the API's
-- platform-admin guard path only) read and write across hospitals.

-- ---------- helpers ----------

CREATE OR REPLACE FUNCTION platform.is_admin_scope() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION platform.enable_admin_access(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS platform_admin ON %s', tbl);
  EXECUTE format('CREATE POLICY platform_admin ON %s USING (platform.is_admin_scope()) WITH CHECK (platform.is_admin_scope())', tbl);
END $$;

-- ---------- plans (global catalog) ----------

CREATE TABLE platform.plans (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_-]{1,30}$'),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_monthly numeric(14,2) CHECK (price_monthly >= 0),
  price_yearly numeric(14,2) CHECK (price_yearly >= 0),
  currency text NOT NULL DEFAULT 'INR',
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 0 AND 180),
  modules text[] NOT NULL DEFAULT '{}',
  max_facilities integer CHECK (max_facilities >= 0),
  max_users integer CHECK (max_users >= 0),
  max_beds integer CHECK (max_beds >= 0),
  is_public boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT app.enable_updated_at('platform.plans');

-- Indicative prices from the product plan (estimates until pricing is final).
INSERT INTO platform.plans (code, name, description, price_monthly, price_yearly, trial_days, modules,
                            max_facilities, max_users, max_beds, sort_order) VALUES
  ('starter', 'Starter', 'Clinics and polyclinics: OPD, billing, basic pharmacy, patient portal and apps.',
   2499.00, 24990.00, 14,
   ARRAY['frontoffice','emr','billing','pharmacy','notifications','reports','portal','mobile'],
   1, 5, 0, 10),
  ('growth', 'Growth', 'Nursing homes and hospitals (20-200 beds): adds lab, radiology, IPD, inventory, insurance and more.',
   24999.00, 249990.00, 14,
   ARRAY['frontoffice','emr','billing','pharmacy','notifications','reports','portal','mobile',
         'lab','radiology','ipd','inventory','insurance','crm','hr','quality','ops','integrations'],
   2, 75, 200, 20),
  ('enterprise', 'Enterprise', 'Multi-branch groups: everything, custom limits and an annual contract.',
   NULL, NULL, 30,
   ARRAY['frontoffice','emr','billing','pharmacy','notifications','reports','portal','mobile',
         'lab','radiology','ipd','inventory','insurance','crm','hr','quality','ops','integrations'],
   NULL, NULL, NULL, 30)
ON CONFLICT (code) DO NOTHING;

-- ---------- platform admins (super-admin console) ----------

CREATE TABLE platform.admins (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'support' CHECK (role IN ('super_admin', 'support')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admins_email_uq ON platform.admins (lower(email));
SELECT app.enable_updated_at('platform.admins');

CREATE TABLE platform.admin_sessions (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  admin_id uuid NOT NULL REFERENCES platform.admins (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_admin_idx ON platform.admin_sessions (admin_id);

-- Every super-admin action, append-only.
CREATE TABLE platform.admin_audit (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  admin_id uuid REFERENCES platform.admins (id),
  target_tenant_id uuid REFERENCES platform.tenants (id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_tenant_idx ON platform.admin_audit (target_tenant_id, at DESC);

-- ---------- subscriptions ----------

CREATE TABLE platform.subscriptions (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  plan_code text NOT NULL REFERENCES platform.plans (code),
  status text NOT NULL CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
  price numeric(14,2) CHECK (price >= 0),
  trial_ends_at timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
-- One live subscription per hospital; plan changes end the old row and start a new one.
CREATE UNIQUE INDEX subscriptions_current_uq ON platform.subscriptions (tenant_id) WHERE ended_at IS NULL;

CREATE SEQUENCE platform.invoice_number_seq;

CREATE TABLE platform.invoices (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  subscription_id uuid NOT NULL,
  number text NOT NULL,
  plan_code text NOT NULL REFERENCES platform.plans (code),
  billing_cycle text NOT NULL CHECK (billing_cycle IN ('monthly', 'yearly')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 18.00,
  tax_amount numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'void')),
  due_at timestamptz NOT NULL,
  paid_at timestamptz,
  payment_mode text CHECK (payment_mode IN ('sandbox', 'manual', 'upi', 'bank_transfer', 'card', 'cheque')),
  payment_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, subscription_id) REFERENCES platform.subscriptions (tenant_id, id),
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND payment_mode IS NOT NULL))
);
CREATE UNIQUE INDEX invoices_number_uq ON platform.invoices (number);
CREATE INDEX invoices_status_idx ON platform.invoices (status, due_at);

-- ---------- entitlement and limit overrides (super-admin) ----------

CREATE TABLE platform.entitlement_overrides (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  module_key text NOT NULL,
  enabled boolean NOT NULL,
  note text,
  expires_at timestamptz,
  created_by_admin uuid REFERENCES platform.admins (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX entitlement_overrides_module_uq ON platform.entitlement_overrides (tenant_id, module_key);

CREATE TABLE platform.limit_overrides (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  limit_key text NOT NULL CHECK (limit_key IN ('facilities', 'users', 'beds')),
  -- null = unlimited
  value integer CHECK (value >= 0),
  created_by_admin uuid REFERENCES platform.admins (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX limit_overrides_key_uq ON platform.limit_overrides (tenant_id, limit_key);

-- ---------- announcements ----------

CREATE TABLE platform.announcements (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  title text NOT NULL,
  body text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  plan_codes text[] NOT NULL DEFAULT '{}',
  tenant_ids uuid[] NOT NULL DEFAULT '{}',
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  is_published boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES platform.admins (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
SELECT app.enable_updated_at('platform.announcements');

CREATE TABLE platform.announcement_dismissals (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  announcement_id uuid NOT NULL REFERENCES platform.announcements (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX announcement_dismissals_uq ON platform.announcement_dismissals (tenant_id, announcement_id, user_id);

-- ---------- help articles ----------

CREATE TABLE platform.help_articles (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  title text NOT NULL,
  module_key text,
  summary text NOT NULL DEFAULT '',
  body text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX help_articles_slug_uq ON platform.help_articles (slug);
SELECT app.enable_updated_at('platform.help_articles');

INSERT INTO platform.help_articles (slug, title, module_key, summary, body, sort_order) VALUES
  ('getting-started', 'Getting started with HMS', NULL,
   'The first things to set up after you sign up.',
   E'Welcome to HMS.\n\n1. Complete your hospital profile (address, GSTIN, letterhead).\n2. Add staff users and give each one a role.\n3. Set doctor schedules and consultation fees.\n4. Set up services and prices for billing.\n5. Register a test patient and book an appointment.\n\nYour onboarding checklist on the Subscription page tracks these steps.', 10),
  ('trial-and-plans', 'Your free trial and plans', 'platform',
   'How the trial works, what each plan includes and how to pay.',
   E'Every new hospital starts with a free trial of its chosen plan. Before the trial ends, choose a plan and pay the subscription invoice from Subscription & plan.\n\nIf the trial ends without payment, you get a 7-day grace period with full access. After that the account is suspended until the invoice is paid. Your data is never deleted when suspended.\n\nStarter covers OPD, billing, basic pharmacy and the patient portal for one facility and 5 users. Growth adds lab, radiology, IPD, inventory, insurance and more for up to 2 facilities and 75 users. Enterprise is a custom annual contract.', 20),
  ('add-staff-users', 'Adding staff and roles', 'setup',
   'Invite users and choose what they can see.',
   E'Go to Setup, then Users. Invite a user with their email or mobile number and choose one or more roles. Roles decide which screens and actions a user has. Your plan sets how many active users you can have.', 30),
  ('raise-support-ticket', 'Getting help from support', 'platform',
   'Raise a ticket and follow the conversation.',
   E'Open Help & support, then New ticket. Describe what happened, the patient UHID or bill number if relevant (never share passwords), and choose a priority. Our team replies in the ticket and you get notified. Mark it resolved when you are done.', 40)
ON CONFLICT (slug) DO NOTHING;

-- ---------- support tickets ----------

CREATE SEQUENCE platform.ticket_number_seq;

CREATE TABLE platform.tickets (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  subject text NOT NULL,
  category text NOT NULL DEFAULT 'technical'
    CHECK (category IN ('technical', 'billing', 'training', 'feature_request', 'data_correction', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed')),
  raised_by_user_id uuid NOT NULL,
  raised_by_name text NOT NULL,
  assigned_admin_id uuid REFERENCES platform.admins (id),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, raised_by_user_id) REFERENCES iam.users (tenant_id, id)
);
CREATE UNIQUE INDEX tickets_number_uq ON platform.tickets (number);
CREATE INDEX tickets_status_idx ON platform.tickets (status, last_activity_at DESC);
CREATE INDEX tickets_tenant_idx ON platform.tickets (tenant_id, last_activity_at DESC);

CREATE TABLE platform.ticket_messages (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  ticket_id uuid NOT NULL,
  author_type text NOT NULL CHECK (author_type IN ('staff', 'platform')),
  author_id uuid NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  is_internal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, ticket_id) REFERENCES platform.tickets (tenant_id, id) ON DELETE CASCADE,
  CHECK (author_type = 'platform' OR NOT is_internal)
);
CREATE INDEX ticket_messages_ticket_idx ON platform.ticket_messages (tenant_id, ticket_id, created_at);

-- ---------- onboarding ----------

CREATE TABLE platform.onboarding_steps (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  step_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX onboarding_steps_uq ON platform.onboarding_steps (tenant_id, step_key);

-- ---------- isolation, triggers, grants ----------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['platform.subscriptions', 'platform.invoices', 'platform.entitlement_overrides',
    'platform.limit_overrides', 'platform.announcement_dismissals', 'platform.tickets', 'platform.ticket_messages',
    'platform.onboarding_steps']
  LOOP
    PERFORM app.enable_tenant_rls(t::regclass);
    PERFORM platform.enable_admin_access(t::regclass);
  END LOOP;
END $$;

SELECT app.enable_updated_at('platform.subscriptions');
SELECT app.enable_updated_at('platform.invoices');
SELECT app.enable_updated_at('platform.entitlement_overrides');
SELECT app.enable_updated_at('platform.limit_overrides');
SELECT app.enable_updated_at('platform.tickets');

-- Financial records for the hospital's own audit trail.
SELECT app.enable_audit('platform.subscriptions');
SELECT app.enable_audit('platform.invoices');

-- The platform schema has no default grants for hms_app; grant table by table.
GRANT SELECT ON platform.plans, platform.help_articles, platform.announcements TO hms_app;
GRANT INSERT, UPDATE ON platform.plans, platform.help_articles, platform.announcements TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.admins, platform.admin_sessions TO hms_app;
GRANT SELECT, INSERT ON platform.admin_audit TO hms_app;
GRANT SELECT, INSERT, UPDATE ON platform.subscriptions, platform.invoices, platform.tickets TO hms_app;
GRANT SELECT, INSERT ON platform.ticket_messages, platform.announcement_dismissals TO hms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.entitlement_overrides, platform.limit_overrides,
  platform.onboarding_steps TO hms_app;
GRANT USAGE ON SEQUENCE platform.invoice_number_seq, platform.ticket_number_seq TO hms_app;
GRANT EXECUTE ON FUNCTION platform.is_admin_scope() TO hms_app;
