-- billing: patient charges (what a patient owes, posted by every department and billed later in one
-- invoice) and per-hospital billing rules (a branch may override the hospital's rules).

CREATE TABLE billing.charges (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  account text NOT NULL DEFAULT 'opd' CHECK (account IN ('opd', 'ipd', 'other')),
  visit_id uuid,
  admission_id uuid,
  source_module text NOT NULL,
  source_ref text NOT NULL,
  source_line text NOT NULL DEFAULT '',
  service_id uuid,
  service_code text,
  item_id uuid,
  description text NOT NULL,
  hsn_sac text,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  price_includes_tax boolean NOT NULL DEFAULT false,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate IN (0, 0.1, 0.25, 3, 5, 12, 18, 28, 40)),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  doctor_id uuid,
  charge_date date NOT NULL DEFAULT current_date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'billed', 'cancelled')),
  invoice_id uuid,
  invoice_line_no integer,
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid,
  reversal_requested_at timestamptz,
  reversal_reason text,
  reversal_done_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, service_id) REFERENCES billing.services (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id),
  CHECK (status <> 'billed' OR invoice_id IS NOT NULL),
  CHECK (discount <= round(qty * unit_price, 2))
);
CREATE UNIQUE INDEX billing_charges_source_uq ON billing.charges (tenant_id, source_module, source_ref, source_line);
CREATE INDEX billing_charges_patient_idx ON billing.charges (tenant_id, patient_id, status, created_at);
CREATE INDEX billing_charges_pending_idx ON billing.charges (tenant_id, created_at) WHERE status = 'pending';
CREATE INDEX billing_charges_visit_idx ON billing.charges (tenant_id, visit_id) WHERE visit_id IS NOT NULL;
CREATE INDEX billing_charges_admission_idx ON billing.charges (tenant_id, admission_id) WHERE admission_id IS NOT NULL;
CREATE INDEX billing_charges_invoice_idx ON billing.charges (tenant_id, invoice_id) WHERE invoice_id IS NOT NULL;

-- One row for the hospital (facility_id NULL) and optionally one per branch that overrides it.
-- `rules` holds only the keys that level sets; the API merges defaults ← hospital ← branch.
CREATE TABLE billing.rule_sets (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX billing_rule_sets_hospital_uq ON billing.rule_sets (tenant_id) WHERE facility_id IS NULL;
CREATE UNIQUE INDEX billing_rule_sets_branch_uq ON billing.rule_sets (tenant_id, facility_id) WHERE facility_id IS NOT NULL;

SELECT app.enable_tenant_rls('billing.charges');
SELECT app.enable_tenant_rls('billing.rule_sets');

SELECT app.enable_updated_at('billing.charges');
SELECT app.enable_updated_at('billing.rule_sets');

SELECT app.enable_audit('billing.charges');
SELECT app.enable_audit('billing.rule_sets');

-- A billed charge keeps its money and invoice; only the reversal flag may change afterwards.
CREATE OR REPLACE FUNCTION billing.guard_charge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Charges cannot be deleted; cancel them instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'billed' AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
    OR NEW.qty IS DISTINCT FROM OLD.qty OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
    OR NEW.discount IS DISTINCT FROM OLD.discount OR NEW.tax_rate IS DISTINCT FROM OLD.tax_rate
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
  ) THEN
    RAISE EXCEPTION 'This charge is already billed; issue a credit note instead' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'cancelled' AND NEW.status = 'billed' THEN
    RAISE EXCEPTION 'A cancelled charge cannot be billed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_charge BEFORE UPDATE OR DELETE ON billing.charges
  FOR EACH ROW EXECUTE FUNCTION billing.guard_charge();
