-- emr: OPD consultations (encounters), vitals, diagnoses, prescriptions, orders, favourites,
-- certificates, addenda. Signed consultations are immutable (enforced by triggers below).

CREATE TABLE clinical.encounters (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_no text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  visit_id uuid,
  appointment_id uuid,
  token_no integer,
  encounter_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'in_progress', 'completed', 'cancelled')),
  -- Patient snapshot at the time of the visit (printed on the prescription).
  patient_uhid text NOT NULL,
  patient_name text NOT NULL,
  patient_gender text NOT NULL,
  patient_dob date,
  patient_mobile text,
  patient_allergies text[] NOT NULL DEFAULT '{}',
  notes jsonb NOT NULL DEFAULT '{}',
  follow_up_date date,
  follow_up_notes text,
  started_at timestamptz,
  signed_at timestamptz,
  signed_by uuid,
  cancelled_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES iam.users (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  CHECK ((status = 'completed') = (signed_at IS NOT NULL))
);
CREATE UNIQUE INDEX encounters_no_uq ON clinical.encounters (tenant_id, encounter_no);
CREATE UNIQUE INDEX encounters_visit_uq ON clinical.encounters (tenant_id, visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX encounters_doctor_day_idx ON clinical.encounters (tenant_id, doctor_id, encounter_date);
CREATE INDEX encounters_patient_idx ON clinical.encounters (tenant_id, patient_id, encounter_date DESC);

CREATE TABLE clinical.encounter_vitals (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_id uuid NOT NULL,
  temperature_c numeric(4,1),
  pulse integer,
  resp_rate integer,
  bp_systolic integer,
  bp_diastolic integer,
  spo2 integer,
  weight_kg numeric(5,2),
  height_cm numeric(5,1),
  bmi numeric(4,1),
  blood_sugar integer,
  pain_score integer CHECK (pain_score BETWEEN 0 AND 10),
  notes text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id)
);
CREATE INDEX encounter_vitals_enc_idx ON clinical.encounter_vitals (tenant_id, encounter_id);

CREATE TABLE clinical.encounter_diagnoses (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  icd10_code text,
  description text NOT NULL,
  kind text NOT NULL DEFAULT 'provisional' CHECK (kind IN ('provisional', 'final')),
  is_primary boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id)
);
CREATE INDEX encounter_diagnoses_enc_idx ON clinical.encounter_diagnoses (tenant_id, encounter_id);

CREATE TABLE clinical.prescriptions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  rx_no text NOT NULL,
  encounter_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX prescriptions_no_uq ON clinical.prescriptions (tenant_id, rx_no);
CREATE UNIQUE INDEX prescriptions_encounter_uq ON clinical.prescriptions (tenant_id, encounter_id);
CREATE INDEX prescriptions_patient_idx ON clinical.prescriptions (tenant_id, patient_id);

CREATE TABLE clinical.prescription_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  prescription_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  drug_name text NOT NULL,
  item_code text,
  generic_name text,
  form text,
  strength text,
  dose text NOT NULL,
  route text NOT NULL DEFAULT 'oral',
  frequency text NOT NULL,
  timing text,
  days integer CHECK (days >= 0),
  qty numeric(10,2) CHECK (qty >= 0),
  instructions text,
  allergy_override_reason text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, prescription_id) REFERENCES clinical.prescriptions (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX prescription_lines_rx_idx ON clinical.prescription_lines (tenant_id, prescription_id);

CREATE TABLE clinical.encounter_orders (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  kind text NOT NULL CHECK (kind IN ('lab', 'radiology', 'procedure')),
  code text,
  name text NOT NULL,
  priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine', 'urgent')),
  notes text,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id)
);
CREATE INDEX encounter_orders_enc_idx ON clinical.encounter_orders (tenant_id, encounter_id);
CREATE INDEX encounter_orders_open_idx ON clinical.encounter_orders (tenant_id, kind, status);

CREATE TABLE clinical.encounter_addenda (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  encounter_id uuid NOT NULL,
  text text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id)
);
CREATE INDEX encounter_addenda_enc_idx ON clinical.encounter_addenda (tenant_id, encounter_id);

CREATE TABLE clinical.rx_favourites (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  doctor_id uuid NOT NULL,
  name text NOT NULL,
  lines jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES iam.users (tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX rx_favourites_name_uq ON clinical.rx_favourites (tenant_id, doctor_id, lower(name));

CREATE TABLE clinical.medical_certificates (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  certificate_no text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sick_leave', 'fitness', 'medical')),
  patient_id uuid NOT NULL,
  encounter_id uuid,
  doctor_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  patient_uhid text NOT NULL,
  patient_name text NOT NULL,
  patient_gender text NOT NULL,
  patient_dob date,
  from_date date,
  to_date date,
  diagnosis text,
  remarks text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, encounter_id) REFERENCES clinical.encounters (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES iam.users (tenant_id, id),
  CHECK (from_date IS NULL OR to_date IS NULL OR from_date <= to_date)
);
CREATE UNIQUE INDEX medical_certificates_no_uq ON clinical.medical_certificates (tenant_id, certificate_no);
CREATE INDEX medical_certificates_patient_idx ON clinical.medical_certificates (tenant_id, patient_id);

-- ---------- sign & lock ----------

-- A signed encounter cannot be changed or deleted. Corrections go in clinical.encounter_addenda.
CREATE OR REPLACE FUNCTION clinical.emr_lock_signed_encounter() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NOT NULL THEN
    RAISE EXCEPTION 'encounter % is signed and cannot be changed', OLD.encounter_no USING ERRCODE = 'P0001', HINT = 'emr_signed_locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER emr_lock_signed BEFORE UPDATE OR DELETE ON clinical.encounters
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_encounter();

-- Children of a signed encounter (vitals, diagnoses, prescription, orders) are frozen too.
CREATE OR REPLACE FUNCTION clinical.emr_lock_signed_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  enc_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'prescription_lines' THEN
    SELECT p.encounter_id INTO enc_id FROM clinical.prescriptions p WHERE p.tenant_id = r.tenant_id AND p.id = r.prescription_id;
  ELSE
    enc_id := r.encounter_id;
  END IF;
  IF EXISTS (SELECT 1 FROM clinical.encounters e WHERE e.tenant_id = r.tenant_id AND e.id = enc_id AND e.signed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'encounter is signed; % cannot be changed', TG_TABLE_NAME USING ERRCODE = 'P0001', HINT = 'emr_signed_locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER emr_lock_signed BEFORE INSERT OR UPDATE OR DELETE ON clinical.encounter_vitals
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_child();
CREATE TRIGGER emr_lock_signed BEFORE INSERT OR UPDATE OR DELETE ON clinical.encounter_diagnoses
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_child();
CREATE TRIGGER emr_lock_signed BEFORE INSERT OR UPDATE OR DELETE ON clinical.prescriptions
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_child();
CREATE TRIGGER emr_lock_signed BEFORE INSERT OR UPDATE OR DELETE ON clinical.prescription_lines
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_child();

-- Orders stay updatable after signing (lab/radiology move their status); only the ordered content is frozen.
CREATE OR REPLACE FUNCTION clinical.emr_lock_signed_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF EXISTS (SELECT 1 FROM clinical.encounters e WHERE e.tenant_id = r.tenant_id AND e.id = r.encounter_id AND e.signed_at IS NOT NULL)
     AND (TG_OP <> 'UPDATE' OR (NEW.kind, NEW.code, NEW.name, NEW.priority, NEW.notes, NEW.encounter_id, NEW.patient_id)
                                IS DISTINCT FROM (OLD.kind, OLD.code, OLD.name, OLD.priority, OLD.notes, OLD.encounter_id, OLD.patient_id)) THEN
    RAISE EXCEPTION 'encounter is signed; orders cannot be changed' USING ERRCODE = 'P0001', HINT = 'emr_signed_locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER emr_lock_signed BEFORE INSERT OR UPDATE OR DELETE ON clinical.encounter_orders
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_lock_signed_order();

-- Addenda and certificates are append-only.
CREATE OR REPLACE FUNCTION clinical.emr_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'P0001', HINT = 'emr_signed_locked';
END $$;
CREATE TRIGGER emr_append_only BEFORE UPDATE OR DELETE ON clinical.encounter_addenda
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_append_only();
CREATE TRIGGER emr_append_only BEFORE UPDATE OR DELETE ON clinical.medical_certificates
  FOR EACH ROW EXECUTE FUNCTION clinical.emr_append_only();

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('clinical.encounters');
SELECT app.enable_tenant_rls('clinical.encounter_vitals');
SELECT app.enable_tenant_rls('clinical.encounter_diagnoses');
SELECT app.enable_tenant_rls('clinical.prescriptions');
SELECT app.enable_tenant_rls('clinical.prescription_lines');
SELECT app.enable_tenant_rls('clinical.encounter_orders');
SELECT app.enable_tenant_rls('clinical.encounter_addenda');
SELECT app.enable_tenant_rls('clinical.rx_favourites');
SELECT app.enable_tenant_rls('clinical.medical_certificates');

SELECT app.enable_updated_at('clinical.encounters');
SELECT app.enable_updated_at('clinical.prescriptions');
SELECT app.enable_updated_at('clinical.rx_favourites');

SELECT app.enable_audit('clinical.encounters');
SELECT app.enable_audit('clinical.encounter_vitals');
SELECT app.enable_audit('clinical.encounter_diagnoses');
SELECT app.enable_audit('clinical.prescriptions');
SELECT app.enable_audit('clinical.prescription_lines');
SELECT app.enable_audit('clinical.encounter_orders');
SELECT app.enable_audit('clinical.encounter_addenda');
SELECT app.enable_audit('clinical.medical_certificates');
