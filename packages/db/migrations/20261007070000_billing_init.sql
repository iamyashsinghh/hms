-- billing: masters (services, price lists, packages, settings), invoices, payments/deposits/refunds,
-- credit notes and cash shifts. Final invoices are immutable; money movements are append-only.

-- ---------- settings (one row per hospital) ----------

CREATE TABLE billing.settings (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  legal_name text,
  gstin text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]{3}$'),
  state_code text CHECK (state_code IS NULL OR state_code ~ '^[0-9]{2}$'),
  address text,
  phone text,
  upi_vpa text,
  upi_payee_name text,
  invoice_footer text,
  round_off boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX billing_settings_tenant_uq ON billing.settings (tenant_id);

-- ---------- services master ----------

CREATE TABLE billing.services (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,39}$'),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('consultation', 'procedure', 'lab', 'radiology', 'room', 'nursing', 'pharmacy', 'package', 'other')),
  department_id uuid,
  hsn_sac text,
  base_price numeric(14,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate IN (0, 0.1, 0.25, 3, 5, 12, 18, 28, 40)),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX billing_services_code_uq ON billing.services (tenant_id, code);
CREATE INDEX billing_services_name_trgm_idx ON billing.services USING gin (lower(name) gin_trgm_ops);

-- A package is a service with category 'package'; its contents are listed here (for print and reports).
CREATE TABLE billing.package_items (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  package_id uuid NOT NULL,
  service_id uuid NOT NULL,
  qty numeric(12,3) NOT NULL DEFAULT 1 CHECK (qty > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, package_id) REFERENCES billing.services (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES billing.services (tenant_id, id)
);
CREATE UNIQUE INDEX billing_package_items_uq ON billing.package_items (tenant_id, package_id, service_id);

-- ---------- price lists (per payer, with effective dates) ----------

CREATE TABLE billing.price_lists (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  name text NOT NULL,
  -- NULL = cash / self-pay price list. Payers (insurance, corporate) arrive with the insurance module.
  payer_id uuid,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX billing_price_lists_payer_idx ON billing.price_lists (tenant_id, payer_id, effective_from);

CREATE TABLE billing.price_list_items (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  price_list_id uuid NOT NULL,
  service_id uuid NOT NULL,
  price numeric(14,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES billing.price_lists (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES billing.services (tenant_id, id)
);
CREATE UNIQUE INDEX billing_price_list_items_uq ON billing.price_list_items (tenant_id, price_list_id, service_id);

-- ---------- cash shifts ----------

CREATE TABLE billing.cash_shifts (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  closed_at timestamptz,
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  difference numeric(14,2),
  totals jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES iam.users (tenant_id, id)
);
-- One open shift per cashier.
CREATE UNIQUE INDEX billing_cash_shifts_open_uq ON billing.cash_shifts (tenant_id, user_id) WHERE status = 'open';
CREATE INDEX billing_cash_shifts_opened_idx ON billing.cash_shifts (tenant_id, opened_at DESC);

-- ---------- invoices ----------

CREATE TABLE billing.invoices (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  -- Assigned when finalized; drafts have no number.
  number text,
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  patient_name text NOT NULL,
  patient_uhid text NOT NULL,
  patient_mobile text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'cancelled')),
  source_module text NOT NULL DEFAULT 'billing',
  source_ref text,
  payer_id uuid,
  invoice_date date NOT NULL DEFAULT current_date,
  supply_type text NOT NULL DEFAULT 'intra' CHECK (supply_type IN ('intra', 'inter')),
  buyer_gstin text,
  seller_name text,
  seller_gstin text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  discount_total numeric(14,2) NOT NULL DEFAULT 0,
  taxable_total numeric(14,2) NOT NULL DEFAULT 0,
  cgst_total numeric(14,2) NOT NULL DEFAULT 0,
  sgst_total numeric(14,2) NOT NULL DEFAULT 0,
  igst_total numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  round_off numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- Net money received (payments minus refunds) and credit notes issued against this invoice.
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  credited_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  finalized_at timestamptz,
  finalized_by uuid,
  cancelled_at timestamptz,
  cancelled_by uuid,
  cancel_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  CHECK (status = 'draft' OR number IS NOT NULL),
  CHECK (paid_amount + credited_amount <= total OR status = 'cancelled')
);
CREATE UNIQUE INDEX billing_invoices_number_uq ON billing.invoices (tenant_id, number);
CREATE INDEX billing_invoices_patient_idx ON billing.invoices (tenant_id, patient_id, created_at DESC);
CREATE INDEX billing_invoices_date_idx ON billing.invoices (tenant_id, invoice_date DESC);
CREATE INDEX billing_invoices_source_idx ON billing.invoices (tenant_id, source_module, source_ref);

CREATE TABLE billing.invoice_lines (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  invoice_id uuid NOT NULL,
  line_no integer NOT NULL,
  service_id uuid,
  service_code text,
  -- Pharmacy item id (inventory module), stored without a foreign key.
  item_id uuid,
  description text NOT NULL,
  hsn_sac text,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  discount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_rate numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  taxable_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, service_id) REFERENCES billing.services (tenant_id, id)
);
CREATE UNIQUE INDEX billing_invoice_lines_no_uq ON billing.invoice_lines (tenant_id, invoice_id, line_no);

-- ---------- payments, deposits and refunds (append-only) ----------

CREATE TABLE billing.payments (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  -- payment: against an invoice; deposit: advance; refund: money paid back (invoice or deposit).
  kind text NOT NULL CHECK (kind IN ('payment', 'deposit', 'refund')),
  facility_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  invoice_id uuid,
  -- 'deposit' mode = adjusted from the patient's advance, no new money.
  mode text NOT NULL CHECK (mode IN ('cash', 'upi', 'card', 'bank', 'cheque', 'deposit')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reference text,
  notes text,
  shift_id uuid,
  received_by uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, shift_id) REFERENCES billing.cash_shifts (tenant_id, id),
  CHECK (kind <> 'payment' OR invoice_id IS NOT NULL),
  CHECK (kind <> 'deposit' OR (invoice_id IS NULL AND mode <> 'deposit'))
);
CREATE UNIQUE INDEX billing_payments_number_uq ON billing.payments (tenant_id, number);
CREATE INDEX billing_payments_invoice_idx ON billing.payments (tenant_id, invoice_id);
CREATE INDEX billing_payments_patient_idx ON billing.payments (tenant_id, patient_id);
CREATE INDEX billing_payments_shift_idx ON billing.payments (tenant_id, shift_id);
CREATE INDEX billing_payments_received_idx ON billing.payments (tenant_id, received_at DESC);

-- ---------- credit notes ----------

CREATE TABLE billing.credit_notes (
  tenant_id uuid NOT NULL REFERENCES platform.tenants (id),
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  invoice_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES billing.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX billing_credit_notes_number_uq ON billing.credit_notes (tenant_id, number);
CREATE INDEX billing_credit_notes_invoice_idx ON billing.credit_notes (tenant_id, invoice_id);

-- ---------- immutability guards ----------

-- A final invoice can only change its running paid/credited amounts or be cancelled.
CREATE OR REPLACE FUNCTION billing.guard_invoice() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Invoice % is %, it cannot be deleted', OLD.number, OLD.status USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'Invoice % is cancelled and cannot change', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'final' AND (
       NEW.number IS DISTINCT FROM OLD.number OR NEW.facility_id IS DISTINCT FROM OLD.facility_id
    OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.patient_name IS DISTINCT FROM OLD.patient_name
    OR NEW.invoice_date IS DISTINCT FROM OLD.invoice_date OR NEW.supply_type IS DISTINCT FROM OLD.supply_type
    OR NEW.buyer_gstin IS DISTINCT FROM OLD.buyer_gstin OR NEW.seller_gstin IS DISTINCT FROM OLD.seller_gstin
    OR NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.discount_total IS DISTINCT FROM OLD.discount_total
    OR NEW.taxable_total IS DISTINCT FROM OLD.taxable_total OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
    OR NEW.cgst_total IS DISTINCT FROM OLD.cgst_total OR NEW.sgst_total IS DISTINCT FROM OLD.sgst_total
    OR NEW.igst_total IS DISTINCT FROM OLD.igst_total OR NEW.round_off IS DISTINCT FROM OLD.round_off
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
    OR NEW.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Invoice % is final; issue a credit note instead', OLD.number USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER guard_invoice BEFORE UPDATE OR DELETE ON billing.invoices
  FOR EACH ROW EXECUTE FUNCTION billing.guard_invoice();

-- Lines can only change while their invoice is a draft.
CREATE OR REPLACE FUNCTION billing.guard_invoice_lines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM billing.invoices
   WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id) AND id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- st is NULL while the parent invoice itself is being deleted (cascade from a draft).
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Invoice lines cannot change after the invoice is finalized' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER guard_invoice_lines BEFORE INSERT OR UPDATE OR DELETE ON billing.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION billing.guard_invoice_lines();

-- Money movements and credit notes are append-only for the API role.
REVOKE UPDATE, DELETE ON billing.payments, billing.credit_notes FROM hms_app;

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('billing.settings');
SELECT app.enable_tenant_rls('billing.services');
SELECT app.enable_tenant_rls('billing.package_items');
SELECT app.enable_tenant_rls('billing.price_lists');
SELECT app.enable_tenant_rls('billing.price_list_items');
SELECT app.enable_tenant_rls('billing.cash_shifts');
SELECT app.enable_tenant_rls('billing.invoices');
SELECT app.enable_tenant_rls('billing.invoice_lines');
SELECT app.enable_tenant_rls('billing.payments');
SELECT app.enable_tenant_rls('billing.credit_notes');

SELECT app.enable_updated_at('billing.settings');
SELECT app.enable_updated_at('billing.services');
SELECT app.enable_updated_at('billing.price_lists');
SELECT app.enable_updated_at('billing.cash_shifts');
SELECT app.enable_updated_at('billing.invoices');

SELECT app.enable_audit('billing.settings');
SELECT app.enable_audit('billing.services');
SELECT app.enable_audit('billing.price_lists');
SELECT app.enable_audit('billing.price_list_items');
SELECT app.enable_audit('billing.cash_shifts');
SELECT app.enable_audit('billing.invoices');
SELECT app.enable_audit('billing.invoice_lines');
SELECT app.enable_audit('billing.payments');
SELECT app.enable_audit('billing.credit_notes');
