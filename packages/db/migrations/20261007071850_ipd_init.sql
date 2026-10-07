-- ipd: wards and beds, admissions with bed stays (transfers), nursing (vitals, notes, I/O, MAR),
-- doctor rounds, running-bill charges and advances, discharge summary.
-- Clinical entries (vitals, notes, I/O, administrations, rounds) are append-only.

-- ---------- wards and beds ----------

CREATE TABLE inpatient.wards (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  name text NOT NULL,
  ward_type text NOT NULL DEFAULT 'general'
    CHECK (ward_type IN ('general', 'semi_private', 'private', 'deluxe', 'icu', 'nicu', 'picu', 'hdu', 'emergency', 'daycare', 'labour', 'other')),
  floor text,
  -- Default per-day rate for new beds in this ward.
  default_daily_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (default_daily_rate >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ipd_wards_code_uq ON inpatient.wards (tenant_id, facility_id, code);

CREATE TABLE inpatient.beds (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  ward_id uuid NOT NULL,
  code text NOT NULL CHECK (length(code) BETWEEN 1 AND 20),
  room_no text,
  daily_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (daily_rate >= 0),
  -- Optional billing service code for bed charges (room rent); otherwise a plain description line.
  charge_service_code text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance', 'reserved')),
  current_admission_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, ward_id) REFERENCES inpatient.wards (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  CHECK ((status = 'occupied') = (current_admission_id IS NOT NULL))
);
CREATE UNIQUE INDEX ipd_beds_code_uq ON inpatient.beds (tenant_id, ward_id, code);
CREATE INDEX ipd_beds_facility_idx ON inpatient.beds (tenant_id, facility_id, status);

-- ---------- admissions ----------

CREATE TABLE inpatient.admissions (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  ipd_no text NOT NULL,
  patient_id uuid NOT NULL,
  -- Snapshot for lists and print.
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  patient_gender text,
  patient_dob date,
  patient_mobile text,
  doctor_id uuid NOT NULL,
  doctor_name text NOT NULL,
  admission_type text NOT NULL DEFAULT 'planned' CHECK (admission_type IN ('planned', 'emergency', 'daycare', 'maternity', 'transfer_in')),
  reason text NOT NULL,
  provisional_diagnosis text,
  is_mlc boolean NOT NULL DEFAULT false,
  mlc_no text,
  attendant_name text,
  attendant_relation text,
  attendant_mobile text,
  expected_discharge_date date,
  status text NOT NULL DEFAULT 'admitted' CHECK (status IN ('admitted', 'discharged', 'cancelled')),
  current_bed_id uuid,
  admitted_at timestamptz NOT NULL DEFAULT now(),
  -- Running bill turned into a final invoice (billing module) before discharge.
  invoice_id uuid,
  billed_at timestamptz,
  discharged_at timestamptz,
  discharge_type text CHECK (discharge_type IN ('normal', 'lama', 'dama', 'referred', 'death', 'absconded')),
  discharge_notes text,
  cancel_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, current_bed_id) REFERENCES inpatient.beds (tenant_id, id),
  CHECK (status <> 'discharged' OR (discharged_at IS NOT NULL AND discharge_type IS NOT NULL)),
  CHECK (status = 'admitted' OR current_bed_id IS NULL)
);
CREATE UNIQUE INDEX ipd_admissions_no_uq ON inpatient.admissions (tenant_id, ipd_no);
-- A patient can only hold one active admission per hospital.
CREATE UNIQUE INDEX ipd_admissions_active_uq ON inpatient.admissions (tenant_id, patient_id) WHERE status = 'admitted';
CREATE INDEX ipd_admissions_status_idx ON inpatient.admissions (tenant_id, facility_id, status, admitted_at DESC);

ALTER TABLE inpatient.beds
  ADD FOREIGN KEY (tenant_id, current_admission_id) REFERENCES inpatient.admissions (tenant_id, id);

-- Bed stays: one row per bed the patient occupied. A transfer closes one stay and opens the next.
CREATE TABLE inpatient.bed_stays (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  bed_id uuid NOT NULL,
  ward_id uuid NOT NULL,
  -- Rate snapshot at the time the bed was given.
  daily_rate numeric(14,2) NOT NULL CHECK (daily_rate >= 0),
  charge_service_code text,
  bed_label text NOT NULL,
  from_at timestamptz NOT NULL,
  to_at timestamptz,
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id),
  FOREIGN KEY (tenant_id, bed_id) REFERENCES inpatient.beds (tenant_id, id),
  FOREIGN KEY (tenant_id, ward_id) REFERENCES inpatient.wards (tenant_id, id),
  CHECK (to_at IS NULL OR to_at >= from_at)
);
CREATE INDEX ipd_bed_stays_admission_idx ON inpatient.bed_stays (tenant_id, admission_id, from_at);
CREATE UNIQUE INDEX ipd_bed_stays_open_uq ON inpatient.bed_stays (tenant_id, admission_id) WHERE to_at IS NULL;

-- ---------- nursing ----------

CREATE TABLE inpatient.vitals (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  temperature_c numeric(4,1) CHECK (temperature_c BETWEEN 25 AND 45),
  pulse integer CHECK (pulse BETWEEN 0 AND 300),
  resp_rate integer CHECK (resp_rate BETWEEN 0 AND 100),
  bp_systolic integer CHECK (bp_systolic BETWEEN 0 AND 300),
  bp_diastolic integer CHECK (bp_diastolic BETWEEN 0 AND 200),
  spo2 integer CHECK (spo2 BETWEEN 0 AND 100),
  pain_score integer CHECK (pain_score BETWEEN 0 AND 10),
  blood_sugar numeric(5,1) CHECK (blood_sugar BETWEEN 0 AND 1000),
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_vitals_admission_idx ON inpatient.vitals (tenant_id, admission_id, recorded_at DESC);

CREATE TABLE inpatient.nursing_notes (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  shift text CHECK (shift IN ('morning', 'evening', 'night')),
  note text NOT NULL,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_nursing_notes_admission_idx ON inpatient.nursing_notes (tenant_id, admission_id, created_at DESC);

CREATE TABLE inpatient.intake_output (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('intake', 'output')),
  -- intake: oral, iv, ryles, other; output: urine, drain, vomit, stool, other
  category text NOT NULL CHECK (category IN ('oral', 'iv', 'ryles', 'urine', 'drain', 'vomit', 'stool', 'other')),
  volume_ml integer NOT NULL CHECK (volume_ml BETWEEN 0 AND 20000),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_io_admission_idx ON inpatient.intake_output (tenant_id, admission_id, recorded_at DESC);

-- Medication orders for the MAR (what the doctor ordered) ...
CREATE TABLE inpatient.medication_orders (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  drug_name text NOT NULL,
  dose text NOT NULL,
  route text NOT NULL CHECK (route IN ('oral', 'iv', 'im', 'sc', 'topical', 'inhalation', 'sublingual', 'rectal', 'nasal', 'other')),
  frequency text NOT NULL,
  instructions text,
  is_prn boolean NOT NULL DEFAULT false,
  start_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  stopped_at timestamptz,
  stop_reason text,
  ordered_by uuid,
  ordered_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id),
  CHECK ((status = 'stopped') = (stopped_at IS NOT NULL))
);
CREATE INDEX ipd_med_orders_admission_idx ON inpatient.medication_orders (tenant_id, admission_id, status);

-- ... and each dose given (or not) by the nurse.
CREATE TABLE inpatient.medication_administrations (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  admission_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('given', 'held', 'refused', 'missed')),
  given_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  given_by uuid,
  given_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES inpatient.medication_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_med_admin_order_idx ON inpatient.medication_administrations (tenant_id, order_id, given_at DESC);

-- ---------- doctor rounds ----------

CREATE TABLE inpatient.rounds (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  doctor_id uuid,
  doctor_name text NOT NULL,
  round_at timestamptz NOT NULL DEFAULT now(),
  subjective text,
  findings text,
  plan text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_rounds_admission_idx ON inpatient.rounds (tenant_id, admission_id, round_at DESC);

-- ---------- running bill ----------

-- Service / consumable charges posted during the stay. Bed charges are computed from bed_stays.
CREATE TABLE inpatient.charges (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  charge_date date NOT NULL,
  service_code text,
  description text NOT NULL,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancel_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id),
  CHECK (discount <= qty * unit_price)
);
CREATE INDEX ipd_charges_admission_idx ON inpatient.charges (tenant_id, admission_id, charge_date);

-- Advances taken for this admission. The money itself is a billing deposit (billing.payments).
CREATE TABLE inpatient.advances (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  payment_id uuid NOT NULL,
  receipt_no text NOT NULL,
  mode text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id)
);
CREATE INDEX ipd_advances_admission_idx ON inpatient.advances (tenant_id, admission_id);
CREATE UNIQUE INDEX ipd_advances_payment_uq ON inpatient.advances (tenant_id, payment_id);

-- ---------- discharge summary ----------

CREATE TABLE inpatient.discharge_summaries (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  final_diagnosis text NOT NULL,
  presenting_complaints text,
  history text,
  examination text,
  investigations text,
  procedures text,
  hospital_course text,
  condition_at_discharge text,
  -- [{drugName, dose, frequency, days, instructions?}]
  medications jsonb NOT NULL DEFAULT '[]'::jsonb,
  advice text,
  follow_up_date date,
  follow_up_notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  finalized_by uuid,
  finalized_by_name text,
  finalized_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id),
  CHECK ((status = 'final') = (finalized_at IS NOT NULL))
);
CREATE UNIQUE INDEX ipd_discharge_summaries_admission_uq ON inpatient.discharge_summaries (tenant_id, admission_id);

-- ---------- guards ----------

-- A finalized discharge summary is a signed clinical document.
CREATE OR REPLACE FUNCTION inpatient.guard_discharge_summary() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'Discharge summary is final and cannot change' USING ERRCODE = 'check_violation', HINT = 'ipd_summary_locked';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER guard_discharge_summary BEFORE UPDATE OR DELETE ON inpatient.discharge_summaries
  FOR EACH ROW EXECUTE FUNCTION inpatient.guard_discharge_summary();

-- Charges cannot change once the admission's bill is final.
CREATE OR REPLACE FUNCTION inpatient.guard_charges() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE billed uuid;
BEGIN
  SELECT invoice_id INTO billed FROM inpatient.admissions
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id) AND id = COALESCE(NEW.admission_id, OLD.admission_id);
  IF billed IS NOT NULL THEN
    RAISE EXCEPTION 'The IPD bill is final; charges cannot change' USING ERRCODE = 'check_violation', HINT = 'ipd_bill_final';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER guard_charges BEFORE INSERT OR UPDATE OR DELETE ON inpatient.charges
  FOR EACH ROW EXECUTE FUNCTION inpatient.guard_charges();

-- Clinical entries and advance links are append-only for the app.
REVOKE UPDATE, DELETE ON inpatient.vitals, inpatient.nursing_notes, inpatient.intake_output,
  inpatient.medication_administrations, inpatient.rounds, inpatient.advances FROM hms_app;
REVOKE DELETE ON inpatient.admissions, inpatient.bed_stays, inpatient.charges, inpatient.medication_orders FROM hms_app;

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('inpatient.wards');
SELECT app.enable_tenant_rls('inpatient.beds');
SELECT app.enable_tenant_rls('inpatient.admissions');
SELECT app.enable_tenant_rls('inpatient.bed_stays');
SELECT app.enable_tenant_rls('inpatient.vitals');
SELECT app.enable_tenant_rls('inpatient.nursing_notes');
SELECT app.enable_tenant_rls('inpatient.intake_output');
SELECT app.enable_tenant_rls('inpatient.medication_orders');
SELECT app.enable_tenant_rls('inpatient.medication_administrations');
SELECT app.enable_tenant_rls('inpatient.rounds');
SELECT app.enable_tenant_rls('inpatient.charges');
SELECT app.enable_tenant_rls('inpatient.advances');
SELECT app.enable_tenant_rls('inpatient.discharge_summaries');

SELECT app.enable_updated_at('inpatient.wards');
SELECT app.enable_updated_at('inpatient.beds');
SELECT app.enable_updated_at('inpatient.admissions');
SELECT app.enable_updated_at('inpatient.medication_orders');
SELECT app.enable_updated_at('inpatient.charges');
SELECT app.enable_updated_at('inpatient.discharge_summaries');

SELECT app.enable_audit('inpatient.wards');
SELECT app.enable_audit('inpatient.beds');
SELECT app.enable_audit('inpatient.admissions');
SELECT app.enable_audit('inpatient.bed_stays');
SELECT app.enable_audit('inpatient.vitals');
SELECT app.enable_audit('inpatient.nursing_notes');
SELECT app.enable_audit('inpatient.intake_output');
SELECT app.enable_audit('inpatient.medication_orders');
SELECT app.enable_audit('inpatient.medication_administrations');
SELECT app.enable_audit('inpatient.rounds');
SELECT app.enable_audit('inpatient.charges');
SELECT app.enable_audit('inpatient.advances');
SELECT app.enable_audit('inpatient.discharge_summaries');
