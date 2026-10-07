-- lab: test and panel catalogue with reference ranges, orders (walk-in, EMR, B2B), samples with
-- barcodes, results with flags, verification. Verified results are locked (trigger below); a
-- correction goes through "amend", which records the reason and reopens the result.

-- ---------- catalogue ----------

CREATE TABLE lab.tests (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  name text NOT NULL,
  section text NOT NULL DEFAULT 'other'
    CHECK (section IN ('haematology', 'biochemistry', 'clinical_pathology', 'serology', 'microbiology', 'hormones', 'histopathology', 'other')),
  sample_type text NOT NULL DEFAULT 'blood'
    CHECK (sample_type IN ('blood', 'serum', 'plasma', 'urine', 'stool', 'sputum', 'swab', 'csf', 'fluid', 'tissue', 'other')),
  container text,
  unit text,
  method text,
  result_type text NOT NULL DEFAULT 'numeric' CHECK (result_type IN ('numeric', 'text', 'option')),
  options text[] NOT NULL DEFAULT '{}',
  decimals integer NOT NULL DEFAULT 1 CHECK (decimals BETWEEN 0 AND 4),
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  service_code text,
  tat_hours integer NOT NULL DEFAULT 24 CHECK (tat_hours >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX lab_tests_code_uq ON lab.tests (tenant_id, code);

CREATE TABLE lab.test_ranges (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  test_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  gender text NOT NULL DEFAULT 'any' CHECK (gender IN ('any', 'male', 'female')),
  age_min_years numeric(6,2) NOT NULL DEFAULT 0,
  age_max_years numeric(6,2) NOT NULL DEFAULT 150,
  low numeric,
  high numeric,
  critical_low numeric,
  critical_high numeric,
  text text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, test_id) REFERENCES lab.tests (tenant_id, id) ON DELETE CASCADE,
  CHECK (age_max_years > age_min_years)
);
CREATE INDEX lab_test_ranges_test_idx ON lab.test_ranges (tenant_id, test_id);

CREATE TABLE lab.panels (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  name text NOT NULL,
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  service_code text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX lab_panels_code_uq ON lab.panels (tenant_id, code);

CREATE TABLE lab.panel_tests (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  panel_id uuid NOT NULL,
  test_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, panel_id) REFERENCES lab.panels (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, test_id) REFERENCES lab.tests (tenant_id, id)
);
CREATE UNIQUE INDEX lab_panel_tests_uq ON lab.panel_tests (tenant_id, panel_id, test_id);

-- ---------- orders ----------

CREATE TABLE lab.orders (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_no text NOT NULL,
  facility_id uuid NOT NULL,
  order_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  source text NOT NULL DEFAULT 'walkin' CHECK (source IN ('walkin', 'emr', 'b2b')),
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent', 'stat')),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'collected', 'in_progress', 'completed', 'cancelled')),
  patient_id uuid NOT NULL,
  -- Patient snapshot printed on the report.
  patient_uhid text NOT NULL,
  patient_name text NOT NULL,
  patient_gender text NOT NULL,
  patient_dob date,
  patient_mobile text,
  doctor_id uuid,
  doctor_name text,
  referred_by text,
  encounter_id uuid,
  clinical_notes text,
  invoice_id uuid,
  invoice_no text,
  has_critical boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_by uuid,
  cancelled_at timestamptz,
  cancelled_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX lab_orders_no_uq ON lab.orders (tenant_id, order_no);
-- One lab order per signed consultation (the EMR event can arrive more than once).
CREATE UNIQUE INDEX lab_orders_encounter_uq ON lab.orders (tenant_id, encounter_id) WHERE encounter_id IS NOT NULL;
CREATE INDEX lab_orders_day_idx ON lab.orders (tenant_id, order_date, status);
CREATE INDEX lab_orders_patient_idx ON lab.orders (tenant_id, patient_id, order_date);

CREATE TABLE lab.order_items (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('test', 'panel', 'unmatched')),
  test_id uuid,
  panel_id uuid,
  code text,
  name text NOT NULL,
  price numeric(14,2) NOT NULL DEFAULT 0,
  service_code text,
  emr_order_id uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES lab.orders (tenant_id, id),
  FOREIGN KEY (tenant_id, test_id) REFERENCES lab.tests (tenant_id, id),
  FOREIGN KEY (tenant_id, panel_id) REFERENCES lab.panels (tenant_id, id),
  CHECK ((kind = 'test') = (test_id IS NOT NULL) AND (kind = 'panel') = (panel_id IS NOT NULL))
);
CREATE INDEX lab_order_items_order_idx ON lab.order_items (tenant_id, order_id);

CREATE TABLE lab.samples (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  barcode text NOT NULL,
  sample_type text NOT NULL,
  container text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected', 'received', 'rejected')),
  collected_at timestamptz,
  collected_by uuid,
  received_at timestamptz,
  received_by uuid,
  rejected_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES lab.orders (tenant_id, id)
);
CREATE UNIQUE INDEX lab_samples_barcode_uq ON lab.samples (tenant_id, barcode);
CREATE INDEX lab_samples_order_idx ON lab.samples (tenant_id, order_id);
CREATE INDEX lab_samples_status_idx ON lab.samples (tenant_id, status);

CREATE TABLE lab.results (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  item_id uuid NOT NULL,
  test_id uuid NOT NULL,
  sample_id uuid,
  sort integer NOT NULL DEFAULT 0,
  -- Test snapshot, so later catalogue edits never change an issued report.
  code text NOT NULL,
  name text NOT NULL,
  section text NOT NULL,
  unit text,
  method text,
  result_type text NOT NULL,
  options text[] NOT NULL DEFAULT '{}',
  decimals integer NOT NULL DEFAULT 1,
  panel_name text,
  ref_low numeric,
  ref_high numeric,
  critical_low numeric,
  critical_high numeric,
  ref_text text,
  value text,
  value_num numeric,
  flag text CHECK (flag IN ('normal', 'low', 'high', 'critical_low', 'critical_high', 'abnormal')),
  remarks text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'entered', 'verified')),
  entered_at timestamptz,
  entered_by uuid,
  verified_at timestamptz,
  verified_by uuid,
  amend_count integer NOT NULL DEFAULT 0,
  last_amend_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES lab.orders (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES lab.order_items (tenant_id, id),
  FOREIGN KEY (tenant_id, test_id) REFERENCES lab.tests (tenant_id, id),
  FOREIGN KEY (tenant_id, sample_id) REFERENCES lab.samples (tenant_id, id)
);
CREATE INDEX lab_results_order_idx ON lab.results (tenant_id, order_id);

-- A verified result can only change through amend (which bumps amend_count and reopens it).
CREATE OR REPLACE FUNCTION lab.lock_verified_result() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'verified' AND NEW.amend_count = OLD.amend_count THEN
    RAISE EXCEPTION 'Verified lab results are locked' USING HINT = 'lab_result_locked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lock_verified_result BEFORE UPDATE ON lab.results FOR EACH ROW EXECUTE FUNCTION lab.lock_verified_result();
REVOKE DELETE ON lab.results, lab.samples, lab.orders, lab.order_items FROM hms_app;

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('lab.tests');
SELECT app.enable_tenant_rls('lab.test_ranges');
SELECT app.enable_tenant_rls('lab.panels');
SELECT app.enable_tenant_rls('lab.panel_tests');
SELECT app.enable_tenant_rls('lab.orders');
SELECT app.enable_tenant_rls('lab.order_items');
SELECT app.enable_tenant_rls('lab.samples');
SELECT app.enable_tenant_rls('lab.results');

SELECT app.enable_updated_at('lab.tests');
SELECT app.enable_updated_at('lab.panels');
SELECT app.enable_updated_at('lab.orders');
SELECT app.enable_updated_at('lab.samples');
SELECT app.enable_updated_at('lab.results');

SELECT app.enable_audit('lab.tests');
SELECT app.enable_audit('lab.panels');
SELECT app.enable_audit('lab.orders');
SELECT app.enable_audit('lab.samples');
SELECT app.enable_audit('lab.results');
