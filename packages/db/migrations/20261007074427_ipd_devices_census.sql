-- ipd: invasive devices per admission (for HAI device-days) and a ledger of published daily census
-- so ipd.census.daily goes out once per facility and date.

CREATE TABLE inpatient.devices (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  admission_id uuid NOT NULL,
  device_type text NOT NULL CHECK (device_type IN ('urinary_catheter', 'central_line', 'ventilator', 'peripheral_iv', 'other')),
  site text,
  notes text,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  inserted_by uuid,
  removed_at timestamptz,
  removed_by uuid,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, admission_id) REFERENCES inpatient.admissions (tenant_id, id),
  CHECK (removed_at IS NULL OR removed_at >= inserted_at)
);
CREATE INDEX ipd_devices_admission_idx ON inpatient.devices (tenant_id, admission_id, inserted_at);
REVOKE DELETE ON inpatient.devices FROM hms_app;

CREATE TABLE inpatient.census_runs (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  census_date date NOT NULL,
  ward_count integer NOT NULL,
  patient_days integer NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ipd_census_runs_uq ON inpatient.census_runs (tenant_id, facility_id, census_date);
REVOKE UPDATE, DELETE ON inpatient.census_runs FROM hms_app;

SELECT app.enable_tenant_rls('inpatient.devices');
SELECT app.enable_tenant_rls('inpatient.census_runs');
SELECT app.enable_updated_at('inpatient.devices');
SELECT app.enable_audit('inpatient.devices');
