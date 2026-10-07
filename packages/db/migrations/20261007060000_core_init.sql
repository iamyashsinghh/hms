-- Foundation: schemas, helper functions, tenancy (RLS), identity, facilities, patients, audit.
-- Runs as hms_migrator. Requires roles from infra/postgres/init.sql.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- ---------- schemas ----------
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS setup;
CREATE SCHEMA IF NOT EXISTS clinical;
CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS lab;
CREATE SCHEMA IF NOT EXISTS radiology;
CREATE SCHEMA IF NOT EXISTS inpatient;
CREATE SCHEMA IF NOT EXISTS insurance;
CREATE SCHEMA IF NOT EXISTS comms;
CREATE SCHEMA IF NOT EXISTS portal;
CREATE SCHEMA IF NOT EXISTS reporting;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS quality;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS integrations;
CREATE SCHEMA IF NOT EXISTS audit;

-- The API role can use every schema. Tenant schemas get full DML by default (RLS decides
-- which rows); audit and platform get narrower grants below.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app','platform','iam','setup','clinical','billing','inventory','lab','radiology',
    'inpatient','insurance','comms','portal','reporting','crm','hr','quality','ops','integrations','audit']
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO hms_app, hms_platform', s);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO hms_platform', s);
    IF s NOT IN ('audit', 'platform', 'app') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hms_app', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO hms_app', s);
    END IF;
  END LOOP;
END $$;

-- ---------- helper functions ----------

-- Time-ordered UUID (v7) so primary-key indexes stay compact.
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
    52, 1), 53, 1), 'hex')::uuid;
$$;

-- Request context. The API sets these with set_config(..., true) inside each transaction.
CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_facility_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.facility_id', true), '')::uuid $$;

-- Turn on tenant isolation for a table that has a tenant_id column.
-- Every tenant table's migration must call this: SELECT app.enable_tenant_rls('schema.table');
CREATE OR REPLACE FUNCTION app.enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %s', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s USING (tenant_id = app.current_tenant_id()) '
    'WITH CHECK (tenant_id = app.current_tenant_id())', tbl);
END $$;

-- Keep updated_at current: SELECT app.enable_updated_at('schema.table');
CREATE OR REPLACE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION app.enable_updated_at(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS touch_updated_at ON %s', tbl);
  EXECUTE format('CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at()', tbl);
END $$;

-- ---------- platform ----------

CREATE TABLE platform.tenants (
  id uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'grace', 'suspended', 'closed')),
  plan text NOT NULL DEFAULT 'starter',
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tenants_code_uq ON platform.tenants (code);
SELECT app.enable_updated_at('platform.tenants');
-- The API resolves tenants by code before login and the platform module creates them.
GRANT SELECT, INSERT, UPDATE ON platform.tenants TO hms_app;

-- ---------- iam ----------

CREATE TABLE iam.permissions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z]+\.[a-z_]+\.[a-z_]+$'),
  module text NOT NULL,
  description text NOT NULL
);
-- Global catalog, written by seeds only.
REVOKE INSERT, UPDATE, DELETE ON iam.permissions FROM hms_app;

CREATE TABLE iam.users (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  email text,
  mobile text,
  password_hash text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON iam.users (tenant_id, lower(email));
CREATE UNIQUE INDEX users_mobile_uq ON iam.users (tenant_id, mobile);

CREATE TABLE iam.roles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name text NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX roles_key_uq ON iam.roles (tenant_id, key);

CREATE TABLE iam.role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_key text NOT NULL REFERENCES iam.permissions (key) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE iam.user_roles (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  facility_id uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES iam.roles (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX user_roles_user_idx ON iam.user_roles (tenant_id, user_id);
CREATE UNIQUE INDEX user_roles_uq ON iam.user_roles (tenant_id, user_id, role_id, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE iam.refresh_tokens (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  token_hash text NOT NULL,
  client text NOT NULL CHECK (client IN ('web', 'mobile')),
  device_name text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by uuid,
  created_ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX refresh_tokens_session_idx ON iam.refresh_tokens (tenant_id, session_id);

-- ---------- setup ----------

CREATE TABLE setup.facilities (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'hospital' CHECK (type IN ('hospital', 'clinic', 'diagnostic_centre', 'pharmacy')),
  phone text,
  gstin text,
  address jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX facilities_code_uq ON setup.facilities (tenant_id, code);

ALTER TABLE iam.user_roles
  ADD FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id) ON DELETE CASCADE;

CREATE TABLE setup.counters (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  key text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- ---------- clinical: patient master ----------

CREATE TABLE clinical.patients (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  uhid text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  gender text NOT NULL CHECK (gender IN ('male', 'female', 'other', 'unknown')),
  date_of_birth date,
  mobile text,
  email text,
  blood_group text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  abha_number text,
  address jsonb,
  allergies text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  merged_into_id uuid,
  registered_facility_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, merged_into_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, registered_facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX patients_uhid_uq ON clinical.patients (tenant_id, uhid);
CREATE INDEX patients_mobile_idx ON clinical.patients (tenant_id, mobile);
CREATE INDEX patients_abha_idx ON clinical.patients (tenant_id, abha_number);
CREATE INDEX patients_name_trgm_idx ON clinical.patients
  USING gin ((lower(first_name || ' ' || coalesce(last_name, ''))) gin_trgm_ops);

-- ---------- audit ----------

CREATE TABLE audit.audit_log (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  table_name text NOT NULL,
  record_id uuid,
  action text NOT NULL,
  old_row jsonb,
  new_row jsonb,
  actor_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_log_record_idx ON audit.audit_log (tenant_id, table_name, record_id);

CREATE TABLE audit.record_views (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  entity text NOT NULL,
  record_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  reason text,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX record_views_record_idx ON audit.record_views (tenant_id, entity, record_id);

CREATE TABLE audit.outbox (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX outbox_unpublished_idx ON audit.outbox (created_at) WHERE published_at IS NULL;

-- Audit rows are append-only for the app.
GRANT SELECT, INSERT ON audit.audit_log, audit.record_views, audit.outbox TO hms_app;

-- Generic change trigger: SELECT app.enable_audit('schema.table'); (table needs uuid `id` and `tenant_id`).
CREATE OR REPLACE FUNCTION audit.log_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  new_row jsonb;
  old_row jsonb;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN new_row := to_jsonb(NEW) - 'password_hash'; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN old_row := to_jsonb(OLD) - 'password_hash'; END IF;
  INSERT INTO audit.audit_log (tenant_id, table_name, record_id, action, old_row, new_row, actor_id)
  VALUES (
    coalesce(new_row ->> 'tenant_id', old_row ->> 'tenant_id')::uuid,
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    coalesce(new_row ->> 'id', old_row ->> 'id')::uuid,
    TG_OP, old_row, new_row, app.current_user_id());
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION app.enable_audit(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS audit_change ON %s', tbl);
  EXECUTE format('CREATE TRIGGER audit_change AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION audit.log_change()', tbl);
END $$;

-- The outbox relay runs as hms_app across all tenants, so it claims rows through this function.
-- Call inside a transaction; rows are marked published and roll back if the publish fails.
CREATE OR REPLACE FUNCTION audit.claim_outbox(batch_size integer) RETURNS SETOF audit.outbox
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  UPDATE audit.outbox o
     SET published_at = now(), attempts = o.attempts + 1
   WHERE (o.tenant_id, o.id) IN (
     SELECT tenant_id, id FROM audit.outbox
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;
REVOKE ALL ON FUNCTION audit.claim_outbox(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audit.claim_outbox(integer) TO hms_app;

-- ---------- tenant isolation, triggers ----------

SELECT app.enable_tenant_rls('iam.users');
SELECT app.enable_tenant_rls('iam.roles');
SELECT app.enable_tenant_rls('iam.role_permissions');
SELECT app.enable_tenant_rls('iam.user_roles');
SELECT app.enable_tenant_rls('iam.refresh_tokens');
SELECT app.enable_tenant_rls('setup.facilities');
SELECT app.enable_tenant_rls('setup.counters');
SELECT app.enable_tenant_rls('clinical.patients');
SELECT app.enable_tenant_rls('audit.audit_log');
SELECT app.enable_tenant_rls('audit.record_views');
SELECT app.enable_tenant_rls('audit.outbox');

SELECT app.enable_updated_at('iam.users');
SELECT app.enable_updated_at('iam.roles');
SELECT app.enable_updated_at('setup.facilities');
SELECT app.enable_updated_at('clinical.patients');

SELECT app.enable_audit('iam.users');
SELECT app.enable_audit('iam.roles');
SELECT app.enable_audit('iam.user_roles');
SELECT app.enable_audit('setup.facilities');
SELECT app.enable_audit('clinical.patients');
