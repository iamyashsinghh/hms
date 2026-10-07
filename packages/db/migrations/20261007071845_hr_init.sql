-- hr: employees (HR record on top of a staff user, or staff without a login), licences, shifts and duty roster,
-- attendance, leave types and requests, monthly payroll runs with payslips. Finalized payroll is immutable.

-- ---------- employees ----------

CREATE TABLE hr.employees (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  -- Staff who log in link to their iam.users row; ward boys, housekeeping etc. may have none.
  user_id uuid,
  employee_code text NOT NULL CHECK (employee_code ~ '^[A-Z0-9][A-Z0-9_/-]{0,29}$'),
  full_name text NOT NULL,
  gender text CHECK (gender IS NULL OR gender IN ('male', 'female', 'other')),
  date_of_birth date,
  mobile text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$'),
  email text,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('doctor', 'nurse', 'technician', 'pharmacist', 'admin', 'support', 'other')),
  designation text,
  department text,
  facility_id uuid,
  employment_type text NOT NULL DEFAULT 'permanent'
    CHECK (employment_type IN ('permanent', 'contract', 'consultant', 'trainee', 'intern')),
  date_of_joining date NOT NULL,
  date_of_exit date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'on_notice', 'exited')),
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  -- statutory and bank details (shown only to users with hr.payroll.read)
  pan text CHECK (pan IS NULL OR pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  uan text CHECK (uan IS NULL OR uan ~ '^[0-9]{12}$'),
  esic_no text,
  bank_account_no text,
  bank_ifsc text CHECK (bank_ifsc IS NULL OR bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
  bank_name text,
  -- monthly salary structure
  basic numeric(14,2) NOT NULL DEFAULT 0 CHECK (basic >= 0),
  hra numeric(14,2) NOT NULL DEFAULT 0 CHECK (hra >= 0),
  other_allowances numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_allowances >= 0),
  pf_applicable boolean NOT NULL DEFAULT false,
  esi_applicable boolean NOT NULL DEFAULT false,
  professional_tax numeric(14,2) NOT NULL DEFAULT 0 CHECK (professional_tax >= 0),
  tds_monthly numeric(14,2) NOT NULL DEFAULT 0 CHECK (tds_monthly >= 0),
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  CHECK (date_of_exit IS NULL OR date_of_exit >= date_of_joining)
);
CREATE UNIQUE INDEX hr_employees_code_uq ON hr.employees (tenant_id, employee_code);
CREATE UNIQUE INDEX hr_employees_user_uq ON hr.employees (tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX hr_employees_name_idx ON hr.employees USING gin (lower(full_name) gin_trgm_ops);

-- Registrations and certificates that expire (medical/nursing council, BLS, ACLS, radiation safety...).
CREATE TABLE hr.licences (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  employee_id uuid NOT NULL,
  kind text NOT NULL
    CHECK (kind IN ('medical_registration', 'nursing_registration', 'pharmacy_registration', 'paramedical_registration',
                    'bls', 'acls', 'radiation_safety', 'other')),
  number text NOT NULL,
  issued_by text,
  valid_from date,
  valid_until date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr.employees (tenant_id, id) ON DELETE CASCADE,
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX hr_licences_employee_idx ON hr.licences (tenant_id, employee_id);
CREATE INDEX hr_licences_expiry_idx ON hr.licences (tenant_id, valid_until);

-- ---------- shifts and roster ----------

CREATE TABLE hr.shifts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,9}$'),
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  -- end_time <= start_time means the shift ends the next day (night duty)
  break_minutes integer NOT NULL DEFAULT 0 CHECK (break_minutes BETWEEN 0 AND 240),
  grace_minutes integer NOT NULL DEFAULT 10 CHECK (grace_minutes BETWEEN 0 AND 120),
  color text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX hr_shifts_code_uq ON hr.shifts (tenant_id, code);

-- One duty-roster cell per employee per day.
CREATE TABLE hr.roster_entries (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  duty_date date NOT NULL,
  kind text NOT NULL DEFAULT 'shift' CHECK (kind IN ('shift', 'off', 'leave', 'holiday')),
  shift_id uuid,
  ward text,
  leave_request_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr.employees (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, shift_id) REFERENCES hr.shifts (tenant_id, id),
  CHECK ((kind = 'shift') = (shift_id IS NOT NULL))
);
CREATE UNIQUE INDEX hr_roster_employee_day_uq ON hr.roster_entries (tenant_id, employee_id, duty_date);
CREATE INDEX hr_roster_facility_day_idx ON hr.roster_entries (tenant_id, facility_id, duty_date);

-- ---------- attendance ----------

CREATE TABLE hr.attendance (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'off', 'holiday')),
  check_in timestamptz,
  check_out timestamptz,
  late_minutes integer NOT NULL DEFAULT 0 CHECK (late_minutes >= 0),
  worked_minutes integer CHECK (worked_minutes IS NULL OR worked_minutes >= 0),
  overtime_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_minutes >= 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('punch', 'manual', 'biometric')),
  remarks text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr.employees (tenant_id, id) ON DELETE CASCADE,
  CHECK (check_out IS NULL OR check_in IS NULL OR check_out >= check_in)
);
CREATE UNIQUE INDEX hr_attendance_employee_day_uq ON hr.attendance (tenant_id, employee_id, work_date);
CREATE INDEX hr_attendance_facility_day_idx ON hr.attendance (tenant_id, facility_id, work_date);

-- ---------- leave ----------

CREATE TABLE hr.leave_types (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{0,9}$'),
  name text NOT NULL,
  annual_quota numeric(5,1) NOT NULL DEFAULT 0 CHECK (annual_quota >= 0),
  is_paid boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX hr_leave_types_code_uq ON hr.leave_types (tenant_id, code);

CREATE TABLE hr.leave_requests (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  days numeric(5,1) NOT NULL CHECK (days > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr.employees (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, leave_type_id) REFERENCES hr.leave_types (tenant_id, id),
  CHECK (to_date >= from_date),
  CHECK (NOT half_day OR from_date = to_date)
);
CREATE INDEX hr_leave_requests_employee_idx ON hr.leave_requests (tenant_id, employee_id, from_date);
CREATE INDEX hr_leave_requests_status_idx ON hr.leave_requests (tenant_id, status);

ALTER TABLE hr.roster_entries
  ADD FOREIGN KEY (tenant_id, leave_request_id) REFERENCES hr.leave_requests (tenant_id, id) ON DELETE SET NULL (leave_request_id);

-- ---------- payroll ----------

CREATE TABLE hr.payroll_runs (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  -- first day of the month being paid
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  employee_count integer NOT NULL DEFAULT 0,
  gross_total numeric(14,2) NOT NULL DEFAULT 0,
  deduction_total numeric(14,2) NOT NULL DEFAULT 0,
  net_total numeric(14,2) NOT NULL DEFAULT 0,
  employer_cost_total numeric(14,2) NOT NULL DEFAULT 0,
  finalized_at timestamptz,
  finalized_by uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX hr_payroll_runs_month_uq ON hr.payroll_runs (tenant_id, month);

CREATE TABLE hr.payslips (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  -- snapshot of who was paid, so later edits to the employee do not change history
  employee_code text NOT NULL,
  employee_name text NOT NULL,
  designation text,
  department text,
  pan text,
  uan text,
  bank_account_no text,
  bank_ifsc text,
  days_in_month integer NOT NULL,
  payable_days numeric(5,1) NOT NULL,
  lop_days numeric(5,1) NOT NULL DEFAULT 0,
  basic numeric(14,2) NOT NULL DEFAULT 0,
  hra numeric(14,2) NOT NULL DEFAULT 0,
  other_allowances numeric(14,2) NOT NULL DEFAULT 0,
  other_earnings numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_earnings >= 0),
  gross numeric(14,2) NOT NULL DEFAULT 0,
  pf_employee numeric(14,2) NOT NULL DEFAULT 0,
  esi_employee numeric(14,2) NOT NULL DEFAULT 0,
  professional_tax numeric(14,2) NOT NULL DEFAULT 0,
  tds numeric(14,2) NOT NULL DEFAULT 0,
  other_deductions numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_deductions >= 0),
  total_deductions numeric(14,2) NOT NULL DEFAULT 0,
  net_pay numeric(14,2) NOT NULL DEFAULT 0,
  pf_employer numeric(14,2) NOT NULL DEFAULT 0,
  esi_employer numeric(14,2) NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES hr.payroll_runs (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES hr.employees (tenant_id, id),
  CHECK (net_pay = gross - total_deductions)
);
CREATE UNIQUE INDEX hr_payslips_run_employee_uq ON hr.payslips (tenant_id, run_id, employee_id);
CREATE INDEX hr_payslips_employee_idx ON hr.payslips (tenant_id, employee_id);

-- ---------- immutability: a final payroll run and its payslips never change ----------

CREATE OR REPLACE FUNCTION hr.guard_payroll_run() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'Payroll for % is final and cannot change', to_char(OLD.month, 'Mon YYYY') USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER guard_payroll_run BEFORE UPDATE OR DELETE ON hr.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION hr.guard_payroll_run();

CREATE OR REPLACE FUNCTION hr.guard_payslip() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM hr.payroll_runs
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id) AND id = COALESCE(NEW.run_id, OLD.run_id);
  IF st = 'final' THEN
    RAISE EXCEPTION 'Payslips cannot change after payroll is finalized' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER guard_payslip BEFORE INSERT OR UPDATE OR DELETE ON hr.payslips
  FOR EACH ROW EXECUTE FUNCTION hr.guard_payslip();

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('hr.employees');
SELECT app.enable_tenant_rls('hr.licences');
SELECT app.enable_tenant_rls('hr.shifts');
SELECT app.enable_tenant_rls('hr.roster_entries');
SELECT app.enable_tenant_rls('hr.attendance');
SELECT app.enable_tenant_rls('hr.leave_types');
SELECT app.enable_tenant_rls('hr.leave_requests');
SELECT app.enable_tenant_rls('hr.payroll_runs');
SELECT app.enable_tenant_rls('hr.payslips');

SELECT app.enable_updated_at('hr.employees');
SELECT app.enable_updated_at('hr.licences');
SELECT app.enable_updated_at('hr.shifts');
SELECT app.enable_updated_at('hr.roster_entries');
SELECT app.enable_updated_at('hr.attendance');
SELECT app.enable_updated_at('hr.leave_types');
SELECT app.enable_updated_at('hr.leave_requests');
SELECT app.enable_updated_at('hr.payroll_runs');
SELECT app.enable_updated_at('hr.payslips');

SELECT app.enable_audit('hr.employees');
SELECT app.enable_audit('hr.licences');
SELECT app.enable_audit('hr.attendance');
SELECT app.enable_audit('hr.leave_requests');
SELECT app.enable_audit('hr.payroll_runs');
SELECT app.enable_audit('hr.payslips');
