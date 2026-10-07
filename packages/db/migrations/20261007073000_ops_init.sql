-- ops (facility services): biomedical assets & maintenance work orders, CSSD sets/cycles/issues,
-- linen stock ledger, ambulance vehicles & trips, diet orders & meal service, housekeeping tasks.

-- ---------- biomedical assets ----------

CREATE TABLE ops.assets (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'general'
    CHECK (category IN ('monitoring', 'life_support', 'imaging', 'laboratory', 'surgical', 'sterilization', 'therapy', 'general', 'other')),
  criticality text NOT NULL DEFAULT 'medium' CHECK (criticality IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'in_service' CHECK (status IN ('in_service', 'under_maintenance', 'out_of_service', 'condemned')),
  make text,
  model text,
  serial_no text,
  location text,
  department_id uuid,
  purchase_date date,
  purchase_cost numeric(14,2) CHECK (purchase_cost IS NULL OR purchase_cost >= 0),
  vendor text,
  warranty_until date,
  amc_vendor text,
  amc_until date,
  pm_interval_days integer CHECK (pm_interval_days IS NULL OR pm_interval_days BETWEEN 0 AND 3650),
  next_pm_due date,
  calibration_due date,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ops_assets_code_uq ON ops.assets (tenant_id, code);
CREATE INDEX ops_assets_facility_idx ON ops.assets (tenant_id, facility_id, status);

CREATE TABLE ops.work_orders (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  asset_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'breakdown' CHECK (type IN ('breakdown', 'preventive', 'calibration')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')),
  problem text NOT NULL,
  assigned_to text,
  resolution text,
  cost numeric(14,2) CHECK (cost IS NULL OR cost >= 0),
  reported_by uuid,
  reported_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, asset_id) REFERENCES ops.assets (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ops_work_orders_number_uq ON ops.work_orders (tenant_id, number);
CREATE INDEX ops_work_orders_asset_idx ON ops.work_orders (tenant_id, asset_id, reported_at DESC);
-- One open work order of each type per asset.
CREATE UNIQUE INDEX ops_work_orders_open_uq ON ops.work_orders (tenant_id, asset_id, type) WHERE status IN ('open', 'in_progress');

-- ---------- CSSD ----------

CREATE TABLE ops.cssd_sets (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  department text,
  contents jsonb NOT NULL DEFAULT '[]'::jsonb,
  shelf_life_days integer NOT NULL DEFAULT 30 CHECK (shelf_life_days BETWEEN 1 AND 365),
  status text NOT NULL DEFAULT 'dirty' CHECK (status IN ('dirty', 'sterilizing', 'sterile', 'issued')),
  sterile_until timestamptz,
  last_cycle_id uuid,
  issued_to text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ops_cssd_sets_code_uq ON ops.cssd_sets (tenant_id, code);

CREATE TABLE ops.cssd_cycles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  sterilizer text NOT NULL,
  method text NOT NULL DEFAULT 'steam' CHECK (method IN ('steam', 'eto', 'plasma', 'dry_heat')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed')),
  temperature_c numeric(5,1),
  pressure text,
  chemical_indicator_passed boolean,
  biological_indicator_passed boolean,
  notes text,
  started_by uuid,
  completed_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  CHECK (status = 'running' OR completed_at IS NOT NULL)
);
CREATE UNIQUE INDEX ops_cssd_cycles_number_uq ON ops.cssd_cycles (tenant_id, number);
CREATE INDEX ops_cssd_cycles_started_idx ON ops.cssd_cycles (tenant_id, facility_id, started_at DESC);

CREATE TABLE ops.cssd_cycle_sets (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  cycle_id uuid NOT NULL,
  set_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES ops.cssd_cycles (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, set_id) REFERENCES ops.cssd_sets (tenant_id, id)
);
CREATE UNIQUE INDEX ops_cssd_cycle_sets_uq ON ops.cssd_cycle_sets (tenant_id, cycle_id, set_id);
CREATE INDEX ops_cssd_cycle_sets_set_idx ON ops.cssd_cycle_sets (tenant_id, set_id);

-- Every issue of a sterile set (traceability: which load, to whom, which patient).
CREATE TABLE ops.cssd_issues (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  set_id uuid NOT NULL,
  cycle_id uuid,
  issued_to text NOT NULL,
  patient_id uuid,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  returned_at timestamptz,
  received_by uuid,
  notes text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, set_id) REFERENCES ops.cssd_sets (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES ops.cssd_cycles (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE INDEX ops_cssd_issues_set_idx ON ops.cssd_issues (tenant_id, set_id, issued_at DESC);
CREATE INDEX ops_cssd_issues_cycle_idx ON ops.cssd_issues (tenant_id, cycle_id);
CREATE UNIQUE INDEX ops_cssd_issues_open_uq ON ops.cssd_issues (tenant_id, set_id) WHERE returned_at IS NULL;

-- ---------- linen ----------

CREATE TABLE ops.linen_items (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  par_level integer NOT NULL DEFAULT 0 CHECK (par_level >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX ops_linen_items_name_uq ON ops.linen_items (tenant_id, lower(name));

-- Append-only ledger; balances per pool are sums over it (see LINEN_TXN_KINDS in @hms/shared).
CREATE TABLE ops.linen_txns (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('stock_in', 'issue', 'collect', 'laundry_out', 'laundry_in', 'condemn')),
  qty integer NOT NULL CHECK (qty > 0),
  location text,
  from_pool text CHECK (from_pool IN ('clean', 'soiled')),
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES ops.linen_items (tenant_id, id),
  CHECK (kind <> 'condemn' OR from_pool IS NOT NULL)
);
CREATE INDEX ops_linen_txns_item_idx ON ops.linen_txns (tenant_id, facility_id, item_id);
CREATE INDEX ops_linen_txns_created_idx ON ops.linen_txns (tenant_id, facility_id, created_at DESC);

CREATE OR REPLACE FUNCTION ops.linen_txns_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ops.linen_txns is append-only; record a correcting movement instead' USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER linen_txns_append_only BEFORE UPDATE OR DELETE ON ops.linen_txns
  FOR EACH ROW EXECUTE FUNCTION ops.linen_txns_append_only();

-- ---------- ambulance ----------

CREATE TABLE ops.vehicles (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  registration_no text NOT NULL,
  type text NOT NULL DEFAULT 'bls' CHECK (type IN ('bls', 'als', 'patient_transport', 'mortuary')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'on_trip', 'maintenance', 'inactive')),
  driver_name text,
  driver_mobile text,
  rate_per_km numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate_per_km >= 0),
  base_charge numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_charge >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ops_vehicles_reg_uq ON ops.vehicles (tenant_id, registration_no);

CREATE TABLE ops.trips (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'emergency_pickup' CHECK (kind IN ('emergency_pickup', 'inter_hospital_transfer', 'drop_home', 'other')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'dispatched', 'patient_onboard', 'completed', 'cancelled')),
  patient_id uuid,
  contact_name text NOT NULL,
  contact_mobile text NOT NULL,
  pickup_address text NOT NULL,
  drop_address text,
  notes text,
  vehicle_id uuid,
  odometer_start integer CHECK (odometer_start IS NULL OR odometer_start >= 0),
  odometer_end integer,
  distance_km numeric(8,1) CHECK (distance_km IS NULL OR distance_km >= 0),
  charge numeric(14,2) CHECK (charge IS NULL OR charge >= 0),
  invoice_id uuid,
  cancel_reason text,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  onboard_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, vehicle_id) REFERENCES ops.vehicles (tenant_id, id),
  CHECK (odometer_end IS NULL OR odometer_start IS NULL OR odometer_end >= odometer_start)
);
CREATE UNIQUE INDEX ops_trips_number_uq ON ops.trips (tenant_id, number);
CREATE INDEX ops_trips_requested_idx ON ops.trips (tenant_id, facility_id, requested_at DESC);
-- A vehicle runs one trip at a time.
CREATE UNIQUE INDEX ops_trips_vehicle_active_uq ON ops.trips (tenant_id, vehicle_id) WHERE status IN ('dispatched', 'patient_onboard');

-- ---------- diet kitchen ----------

CREATE TABLE ops.diet_orders (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  -- Snapshot for the kitchen sheet, taken from the patient master when the diet is ordered.
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  allergies jsonb NOT NULL DEFAULT '[]'::jsonb,
  location text NOT NULL,
  diet_type text NOT NULL
    CHECK (diet_type IN ('normal', 'soft', 'liquid', 'clear_liquid', 'diabetic', 'renal', 'cardiac', 'low_salt', 'high_protein', 'npo')),
  vegetarian boolean NOT NULL DEFAULT true,
  instructions text,
  start_date date NOT NULL DEFAULT current_date,
  end_date date,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stopped')),
  ordered_by uuid,
  stopped_by uuid,
  stopped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
-- One active diet per patient; a new order replaces (stops) the previous one.
CREATE UNIQUE INDEX ops_diet_orders_active_uq ON ops.diet_orders (tenant_id, patient_id) WHERE status = 'active';
CREATE INDEX ops_diet_orders_facility_idx ON ops.diet_orders (tenant_id, facility_id, status);

CREATE TABLE ops.diet_meals (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  order_id uuid NOT NULL,
  meal_date date NOT NULL,
  meal text NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'evening_snack', 'dinner')),
  status text NOT NULL CHECK (status IN ('prepared', 'delivered', 'refused', 'skipped')),
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES ops.diet_orders (tenant_id, id)
);
CREATE UNIQUE INDEX ops_diet_meals_uq ON ops.diet_meals (tenant_id, order_id, meal_date, meal);

-- ---------- housekeeping ----------

CREATE TABLE ops.hk_tasks (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  location text NOT NULL,
  kind text NOT NULL DEFAULT 'routine'
    CHECK (kind IN ('routine', 'discharge_clean', 'spill', 'terminal_clean', 'washroom', 'pest_control', 'other')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'urgent')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'verified', 'cancelled')),
  description text,
  assigned_to text,
  remarks text,
  requested_by uuid,
  due_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  verified_at timestamptz,
  verified_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX ops_hk_tasks_number_uq ON ops.hk_tasks (tenant_id, number);
CREATE INDEX ops_hk_tasks_status_idx ON ops.hk_tasks (tenant_id, facility_id, status, created_at DESC);

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('ops.assets');
SELECT app.enable_tenant_rls('ops.work_orders');
SELECT app.enable_tenant_rls('ops.cssd_sets');
SELECT app.enable_tenant_rls('ops.cssd_cycles');
SELECT app.enable_tenant_rls('ops.cssd_cycle_sets');
SELECT app.enable_tenant_rls('ops.cssd_issues');
SELECT app.enable_tenant_rls('ops.linen_items');
SELECT app.enable_tenant_rls('ops.linen_txns');
SELECT app.enable_tenant_rls('ops.vehicles');
SELECT app.enable_tenant_rls('ops.trips');
SELECT app.enable_tenant_rls('ops.diet_orders');
SELECT app.enable_tenant_rls('ops.diet_meals');
SELECT app.enable_tenant_rls('ops.hk_tasks');

SELECT app.enable_updated_at('ops.assets');
SELECT app.enable_updated_at('ops.work_orders');
SELECT app.enable_updated_at('ops.cssd_sets');
SELECT app.enable_updated_at('ops.cssd_cycles');
SELECT app.enable_updated_at('ops.linen_items');
SELECT app.enable_updated_at('ops.vehicles');
SELECT app.enable_updated_at('ops.trips');
SELECT app.enable_updated_at('ops.diet_orders');
SELECT app.enable_updated_at('ops.diet_meals');
SELECT app.enable_updated_at('ops.hk_tasks');

SELECT app.enable_audit('ops.assets');
SELECT app.enable_audit('ops.work_orders');
SELECT app.enable_audit('ops.cssd_cycles');
SELECT app.enable_audit('ops.cssd_issues');
SELECT app.enable_audit('ops.trips');
SELECT app.enable_audit('ops.diet_orders');
