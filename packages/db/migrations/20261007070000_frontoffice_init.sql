-- frontoffice: appointments, status history, OPD visits (token queue), patient merges, ABHA capture.
-- All tables live in the clinical schema and are tenant-isolated with RLS.

-- ---------- appointments ----------

CREATE TABLE clinical.appointments (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  appointment_no text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  slot_start timestamptz NOT NULL,
  slot_end timestamptz NOT NULL,
  type text NOT NULL DEFAULT 'new' CHECK (type IN ('new', 'follow_up', 'review', 'procedure')),
  source text NOT NULL DEFAULT 'desk' CHECK (source IN ('desk', 'phone', 'portal', 'mobile')),
  status text NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked', 'checked_in', 'in_consultation', 'completed', 'cancelled', 'no_show')),
  reason text,
  cancel_reason text,
  reschedule_count integer NOT NULL DEFAULT 0,
  visit_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (slot_end > slot_start),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES iam.users (tenant_id, id)
);
CREATE UNIQUE INDEX appointments_no_uq ON clinical.appointments (tenant_id, appointment_no);
CREATE INDEX appointments_doctor_day_idx ON clinical.appointments (tenant_id, doctor_id, slot_start);
CREATE INDEX appointments_facility_day_idx ON clinical.appointments (tenant_id, facility_id, slot_start);
CREATE INDEX appointments_patient_idx ON clinical.appointments (tenant_id, patient_id, slot_start DESC);
-- One live booking per doctor per slot start.
CREATE UNIQUE INDEX appointments_slot_uq ON clinical.appointments (tenant_id, doctor_id, slot_start)
  WHERE status IN ('booked', 'checked_in', 'in_consultation');

SELECT app.enable_tenant_rls('clinical.appointments');
SELECT app.enable_updated_at('clinical.appointments');
SELECT app.enable_audit('clinical.appointments');

-- Append-only status/reschedule trail.
CREATE TABLE clinical.appointment_status_history (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  appointment_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  event text NOT NULL CHECK (event IN ('booked', 'rescheduled', 'checked_in', 'started', 'completed', 'cancelled', 'no_show')),
  note text,
  data jsonb,
  actor_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES clinical.appointments (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX appointment_status_history_appt_idx ON clinical.appointment_status_history (tenant_id, appointment_id, at);
SELECT app.enable_tenant_rls('clinical.appointment_status_history');
REVOKE UPDATE, DELETE ON clinical.appointment_status_history FROM hms_app;

-- ---------- OPD visits: the token queue ----------

CREATE TABLE clinical.opd_visits (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  visit_no text NOT NULL,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  appointment_id uuid,
  visit_date date NOT NULL,
  token_no integer NOT NULL CHECK (token_no > 0),
  kind text NOT NULL CHECK (kind IN ('appointment', 'walk_in')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'senior', 'urgent')),
  status text NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'called', 'in_consultation', 'completed', 'skipped', 'cancelled')),
  room text,
  notes text,
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, doctor_id) REFERENCES iam.users (tenant_id, id),
  FOREIGN KEY (tenant_id, appointment_id) REFERENCES clinical.appointments (tenant_id, id)
);
CREATE UNIQUE INDEX opd_visits_no_uq ON clinical.opd_visits (tenant_id, visit_no);
CREATE UNIQUE INDEX opd_visits_token_uq ON clinical.opd_visits (tenant_id, facility_id, doctor_id, visit_date, token_no);
CREATE UNIQUE INDEX opd_visits_appointment_uq ON clinical.opd_visits (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX opd_visits_queue_idx ON clinical.opd_visits (tenant_id, facility_id, visit_date, doctor_id, status);
CREATE INDEX opd_visits_patient_idx ON clinical.opd_visits (tenant_id, patient_id, visit_date DESC);

ALTER TABLE clinical.appointments
  ADD FOREIGN KEY (tenant_id, visit_id) REFERENCES clinical.opd_visits (tenant_id, id);

SELECT app.enable_tenant_rls('clinical.opd_visits');
SELECT app.enable_updated_at('clinical.opd_visits');
SELECT app.enable_audit('clinical.opd_visits');

-- ---------- patient merges ----------

CREATE TABLE clinical.patient_merges (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  source_patient_id uuid NOT NULL,
  target_patient_id uuid NOT NULL,
  reason text NOT NULL,
  moved_appointments integer NOT NULL DEFAULT 0,
  moved_visits integer NOT NULL DEFAULT 0,
  source_snapshot jsonb NOT NULL,
  merged_by uuid,
  merged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (source_patient_id <> target_patient_id),
  FOREIGN KEY (tenant_id, source_patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, target_patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX patient_merges_source_uq ON clinical.patient_merges (tenant_id, source_patient_id);
SELECT app.enable_tenant_rls('clinical.patient_merges');
SELECT app.enable_audit('clinical.patient_merges');
REVOKE UPDATE, DELETE ON clinical.patient_merges FROM hms_app;

-- ---------- ABHA capture log ----------

CREATE TABLE clinical.patient_abha (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  patient_id uuid NOT NULL,
  abha_number text NOT NULL CHECK (abha_number ~ '^\d{14}$'),
  abha_address text,
  verified boolean NOT NULL DEFAULT false,
  captured_by uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE INDEX patient_abha_patient_idx ON clinical.patient_abha (tenant_id, patient_id, captured_at DESC);
SELECT app.enable_tenant_rls('clinical.patient_abha');
SELECT app.enable_audit('clinical.patient_abha');
