-- setup: hospital profile, departments, specializations, staff profiles, doctor schedules and leaves,
-- number series display settings, print templates.

CREATE TABLE setup.hospital_profiles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  legal_name text NOT NULL,
  display_name text NOT NULL,
  gstin text CHECK (gstin ~ '^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  pan text CHECK (pan ~ '^[A-Z]{5}\d{4}[A-Z]$'),
  registration_no text,
  accreditation text,
  phone text,
  email text,
  website text,
  address jsonb,
  logo_url text,
  letterhead jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  setup_completed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX hospital_profiles_tenant_uq ON setup.hospital_profiles (tenant_id);

CREATE TABLE setup.departments (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'clinical' CHECK (type IN ('clinical', 'diagnostic', 'support', 'administrative')),
  facility_id uuid,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX departments_code_uq ON setup.departments (tenant_id, code);

CREATE TABLE setup.specializations (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX specializations_code_uq ON setup.specializations (tenant_id, code);

CREATE TABLE setup.staff_profiles (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL,
  staff_type text NOT NULL CHECK (staff_type IN ('doctor', 'nurse', 'technician', 'pharmacist', 'admin', 'support', 'other')),
  employee_code text,
  designation text,
  department_id uuid,
  specialization_id uuid,
  qualification text,
  registration_no text,
  registration_council text,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  date_of_joining date,
  consultation_fee numeric(14,2) CHECK (consultation_fee >= 0),
  follow_up_fee numeric(14,2) CHECK (follow_up_fee >= 0),
  follow_up_days integer CHECK (follow_up_days BETWEEN 0 AND 365),
  signature_url text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, department_id) REFERENCES setup.departments (tenant_id, id),
  FOREIGN KEY (tenant_id, specialization_id) REFERENCES setup.specializations (tenant_id, id)
);
CREATE UNIQUE INDEX staff_profiles_user_uq ON setup.staff_profiles (tenant_id, user_id);
CREATE UNIQUE INDEX staff_profiles_employee_code_uq ON setup.staff_profiles (tenant_id, employee_code);

CREATE TABLE setup.doctor_schedules (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  slot_minutes integer NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 5 AND 240),
  max_patients integer CHECK (max_patients > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (start_time < end_time),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE INDEX doctor_schedules_user_idx ON setup.doctor_schedules (tenant_id, user_id, weekday);

CREATE TABLE setup.doctor_leaves (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  user_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (from_date <= to_date),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX doctor_leaves_user_idx ON setup.doctor_leaves (tenant_id, user_id, from_date);

CREATE TABLE setup.number_series (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  key text NOT NULL,
  prefix text NOT NULL DEFAULT '',
  width integer NOT NULL DEFAULT 6 CHECK (width BETWEEN 1 AND 12),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX number_series_key_uq ON setup.number_series (tenant_id, key);

CREATE TABLE setup.print_templates (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  key text NOT NULL CHECK (key IN ('letterhead', 'invoice', 'receipt', 'prescription', 'lab_report', 'discharge_summary')),
  facility_id uuid,
  paper_size text NOT NULL DEFAULT 'A4' CHECK (paper_size IN ('A4', 'A5', 'thermal_80mm')),
  show_logo boolean NOT NULL DEFAULT true,
  show_letterhead boolean NOT NULL DEFAULT true,
  header_text text,
  footer_text text,
  margin_top_mm integer NOT NULL DEFAULT 10 CHECK (margin_top_mm BETWEEN 0 AND 100),
  margin_bottom_mm integer NOT NULL DEFAULT 10 CHECK (margin_bottom_mm BETWEEN 0 AND 100),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX print_templates_key_uq ON setup.print_templates
  (tenant_id, key, coalesce(facility_id, '00000000-0000-0000-0000-000000000000'::uuid));

SELECT app.enable_tenant_rls('setup.hospital_profiles');
SELECT app.enable_tenant_rls('setup.departments');
SELECT app.enable_tenant_rls('setup.specializations');
SELECT app.enable_tenant_rls('setup.staff_profiles');
SELECT app.enable_tenant_rls('setup.doctor_schedules');
SELECT app.enable_tenant_rls('setup.doctor_leaves');
SELECT app.enable_tenant_rls('setup.number_series');
SELECT app.enable_tenant_rls('setup.print_templates');

SELECT app.enable_updated_at('setup.hospital_profiles');
SELECT app.enable_updated_at('setup.departments');
SELECT app.enable_updated_at('setup.specializations');
SELECT app.enable_updated_at('setup.staff_profiles');
SELECT app.enable_updated_at('setup.doctor_schedules');
SELECT app.enable_updated_at('setup.number_series');
SELECT app.enable_updated_at('setup.print_templates');

-- Admin configuration changes are audited (who changed fees, schedules, letterhead...).
SELECT app.enable_audit('setup.hospital_profiles');
SELECT app.enable_audit('setup.departments');
SELECT app.enable_audit('setup.staff_profiles');
SELECT app.enable_audit('setup.doctor_schedules');
SELECT app.enable_audit('setup.doctor_leaves');
SELECT app.enable_audit('setup.number_series');
SELECT app.enable_audit('setup.print_templates');
