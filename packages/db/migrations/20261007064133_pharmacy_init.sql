-- pharmacy: item master, stores, batches, append-only stock ledger, GRN, Rx dispense queue, sales and returns.
-- Stock tables (items, stores, batches, stock_*) belong to pharmacy; the inventory workstream moves stock
-- through PharmacyService. Quantities are whole units of the item's sale unit; money is numeric(14,2).

-- ---------- item master ----------

CREATE TABLE inventory.items (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  generic_name text,
  form text NOT NULL DEFAULT 'tablet'
    CHECK (form IN ('tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'cream', 'drops',
                    'inhaler', 'powder', 'solution', 'device', 'consumable', 'other')),
  strength text,
  manufacturer text,
  hsn_code text,
  gst_rate numeric(5,2) NOT NULL DEFAULT 5 CHECK (gst_rate >= 0 AND gst_rate <= 40),
  unit text NOT NULL DEFAULT 'unit',
  pack_size integer NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  schedule text NOT NULL DEFAULT 'otc' CHECK (schedule IN ('otc', 'G', 'H', 'H1', 'X', 'narcotic')),
  reorder_level integer NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX items_code_uq ON inventory.items (tenant_id, upper(code));
CREATE INDEX items_name_trgm_idx ON inventory.items USING gin (lower(name) gin_trgm_ops);
CREATE INDEX items_generic_trgm_idx ON inventory.items USING gin (lower(generic_name) gin_trgm_ops);

-- ---------- stores (a pharmacy counter or store room inside a facility) ----------

CREATE TABLE inventory.stores (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  facility_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'pharmacy' CHECK (type IN ('pharmacy', 'main', 'ward', 'ot', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id)
);
CREATE UNIQUE INDEX stores_code_uq ON inventory.stores (tenant_id, upper(code));

-- ---------- batches (one per item + batch no + expiry) ----------

CREATE TABLE inventory.batches (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  item_id uuid NOT NULL,
  batch_no text NOT NULL,
  expiry_date date NOT NULL,
  mrp numeric(14,2) NOT NULL CHECK (mrp >= 0),
  purchase_rate numeric(14,2) NOT NULL DEFAULT 0 CHECK (purchase_rate >= 0),
  -- Selling price per unit including GST; defaults to MRP. Never above MRP.
  sale_rate numeric(14,2) NOT NULL CHECK (sale_rate >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  CHECK (sale_rate <= mrp)
);
CREATE UNIQUE INDEX batches_item_batch_uq ON inventory.batches (tenant_id, item_id, upper(batch_no), expiry_date);

-- ---------- current stock per store + batch (never negative) ----------

CREATE TABLE inventory.stock_balances (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  store_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  qty integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id)
);
CREATE UNIQUE INDEX stock_balances_store_batch_uq ON inventory.stock_balances (tenant_id, store_id, batch_id);
CREATE INDEX stock_balances_item_idx ON inventory.stock_balances (tenant_id, store_id, item_id);

-- ---------- stock ledger (append-only; every movement) ----------

CREATE TABLE inventory.stock_ledger (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  store_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  txn_type text NOT NULL CHECK (txn_type IN ('opening', 'grn', 'sale', 'dispense', 'sale_return', 'purchase_return',
                                              'adjustment', 'expiry_writeoff', 'transfer_in', 'transfer_out')),
  qty_change integer NOT NULL CHECK (qty_change <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  ref_type text,
  ref_id uuid,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id)
);
CREATE INDEX stock_ledger_item_idx ON inventory.stock_ledger (tenant_id, item_id, created_at);
CREATE INDEX stock_ledger_ref_idx ON inventory.stock_ledger (tenant_id, ref_type, ref_id);

CREATE OR REPLACE FUNCTION inventory.forbid_ledger_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory.stock_ledger is append-only; post a correcting entry instead';
END $$;
CREATE TRIGGER stock_ledger_append_only BEFORE UPDATE OR DELETE ON inventory.stock_ledger
  FOR EACH ROW EXECUTE FUNCTION inventory.forbid_ledger_change();
REVOKE UPDATE, DELETE ON inventory.stock_ledger FROM hms_app;

-- ---------- goods receipt (simple GRN, no PO yet) ----------

CREATE TABLE inventory.pharmacy_grns (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  store_id uuid NOT NULL,
  supplier_name text NOT NULL,
  supplier_gstin text,
  invoice_no text,
  invoice_date date,
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'cancelled')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id)
);
CREATE UNIQUE INDEX pharmacy_grns_number_uq ON inventory.pharmacy_grns (tenant_id, number);

CREATE TABLE inventory.pharmacy_grn_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  grn_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  free_qty integer NOT NULL DEFAULT 0 CHECK (free_qty >= 0),
  purchase_rate numeric(14,2) NOT NULL CHECK (purchase_rate >= 0),
  mrp numeric(14,2) NOT NULL CHECK (mrp >= 0),
  gst_rate numeric(5,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, grn_id) REFERENCES inventory.pharmacy_grns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id)
);
CREATE INDEX pharmacy_grn_lines_grn_idx ON inventory.pharmacy_grn_lines (tenant_id, grn_id);

-- ---------- prescriptions waiting to be dispensed (from EMR, or typed in from paper) ----------

CREATE TABLE inventory.pharmacy_prescriptions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  -- emr.prescription.created id; NULL for paper prescriptions entered at the counter.
  prescription_id uuid,
  source text NOT NULL DEFAULT 'emr' CHECK (source IN ('emr', 'manual')),
  patient_id uuid NOT NULL,
  doctor_id uuid,
  doctor_name text,
  facility_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partial', 'dispensed', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);
CREATE UNIQUE INDEX pharmacy_prescriptions_rx_uq ON inventory.pharmacy_prescriptions (tenant_id, prescription_id)
  WHERE prescription_id IS NOT NULL;
CREATE INDEX pharmacy_prescriptions_status_idx ON inventory.pharmacy_prescriptions (tenant_id, status, created_at);

CREATE TABLE inventory.pharmacy_prescription_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  pharmacy_prescription_id uuid NOT NULL,
  line_no integer NOT NULL,
  drug_name text NOT NULL,
  item_code text,
  -- Matched item master row (by code, then by name); the pharmacist can pick another at dispense.
  item_id uuid,
  dose text,
  frequency text,
  days integer,
  qty integer NOT NULL CHECK (qty >= 0),
  dispensed_qty integer NOT NULL DEFAULT 0 CHECK (dispensed_qty >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, pharmacy_prescription_id) REFERENCES inventory.pharmacy_prescriptions (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id)
);
CREATE INDEX pharmacy_prescription_lines_rx_idx ON inventory.pharmacy_prescription_lines (tenant_id, pharmacy_prescription_id);

-- ---------- sales (OTC and Rx dispense) ----------

CREATE TABLE inventory.pharmacy_sales (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  type text NOT NULL CHECK (type IN ('otc', 'rx')),
  facility_id uuid NOT NULL,
  store_id uuid NOT NULL,
  patient_id uuid,
  customer_name text,
  customer_mobile text,
  pharmacy_prescription_id uuid,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'partially_returned', 'returned')),
  subtotal numeric(14,2) NOT NULL,
  discount numeric(14,2) NOT NULL DEFAULT 0,
  taxable_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  total numeric(14,2) NOT NULL,
  returned_amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_mode text CHECK (payment_mode IN ('cash', 'upi', 'card', 'credit')),
  -- Invoice raised through BillingService (null until billing is connected).
  invoice_id uuid,
  invoice_number text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, pharmacy_prescription_id) REFERENCES inventory.pharmacy_prescriptions (tenant_id, id)
);
CREATE UNIQUE INDEX pharmacy_sales_number_uq ON inventory.pharmacy_sales (tenant_id, number);
CREATE INDEX pharmacy_sales_created_idx ON inventory.pharmacy_sales (tenant_id, created_at);
CREATE INDEX pharmacy_sales_patient_idx ON inventory.pharmacy_sales (tenant_id, patient_id);

CREATE TABLE inventory.pharmacy_sale_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  sale_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  pharmacy_prescription_line_id uuid,
  qty integer NOT NULL CHECK (qty > 0),
  returned_qty integer NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  unit_price numeric(14,2) NOT NULL,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  gst_rate numeric(5,2) NOT NULL,
  taxable_amount numeric(14,2) NOT NULL,
  tax_amount numeric(14,2) NOT NULL,
  amount numeric(14,2) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES inventory.pharmacy_sales (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id),
  CHECK (returned_qty <= qty)
);
CREATE INDEX pharmacy_sale_lines_sale_idx ON inventory.pharmacy_sale_lines (tenant_id, sale_id);

CREATE TABLE inventory.pharmacy_sale_returns (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  sale_id uuid NOT NULL,
  refund_amount numeric(14,2) NOT NULL,
  refund_mode text CHECK (refund_mode IN ('cash', 'upi', 'card', 'credit')),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_id) REFERENCES inventory.pharmacy_sales (tenant_id, id)
);
CREATE UNIQUE INDEX pharmacy_sale_returns_number_uq ON inventory.pharmacy_sale_returns (tenant_id, number);
CREATE INDEX pharmacy_sale_returns_sale_idx ON inventory.pharmacy_sale_returns (tenant_id, sale_id);

CREATE TABLE inventory.pharmacy_sale_return_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  return_id uuid NOT NULL,
  sale_line_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, return_id) REFERENCES inventory.pharmacy_sale_returns (tenant_id, id),
  FOREIGN KEY (tenant_id, sale_line_id) REFERENCES inventory.pharmacy_sale_lines (tenant_id, id)
);

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('inventory.items');
SELECT app.enable_tenant_rls('inventory.stores');
SELECT app.enable_tenant_rls('inventory.batches');
SELECT app.enable_tenant_rls('inventory.stock_balances');
SELECT app.enable_tenant_rls('inventory.stock_ledger');
SELECT app.enable_tenant_rls('inventory.pharmacy_grns');
SELECT app.enable_tenant_rls('inventory.pharmacy_grn_lines');
SELECT app.enable_tenant_rls('inventory.pharmacy_prescriptions');
SELECT app.enable_tenant_rls('inventory.pharmacy_prescription_lines');
SELECT app.enable_tenant_rls('inventory.pharmacy_sales');
SELECT app.enable_tenant_rls('inventory.pharmacy_sale_lines');
SELECT app.enable_tenant_rls('inventory.pharmacy_sale_returns');
SELECT app.enable_tenant_rls('inventory.pharmacy_sale_return_lines');

SELECT app.enable_updated_at('inventory.items');
SELECT app.enable_updated_at('inventory.stores');
SELECT app.enable_updated_at('inventory.batches');
SELECT app.enable_updated_at('inventory.stock_balances');
SELECT app.enable_updated_at('inventory.pharmacy_grns');
SELECT app.enable_updated_at('inventory.pharmacy_prescriptions');
SELECT app.enable_updated_at('inventory.pharmacy_sales');

SELECT app.enable_audit('inventory.items');
SELECT app.enable_audit('inventory.batches');
SELECT app.enable_audit('inventory.pharmacy_grns');
SELECT app.enable_audit('inventory.pharmacy_prescriptions');
SELECT app.enable_audit('inventory.pharmacy_sales');
SELECT app.enable_audit('inventory.pharmacy_sale_returns');
