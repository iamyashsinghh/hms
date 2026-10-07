-- inventory (procurement & stores): vendors, purchase requisitions, purchase orders, PO-based goods receipts,
-- purchase returns, department indents and store-to-store issues. Tables are prefixed proc_.
-- Items, stores, batches and stock belong to pharmacy (inventory.items/stores/...); every stock movement here goes
-- through PharmacyService so the stock ledger stays the single source of truth.
-- Item and store names are snapshotted on documents so a printed PO never changes later.

-- ---------- vendors ----------

CREATE TABLE inventory.proc_vendors (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  code text NOT NULL,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  gstin text,
  pan text,
  address text,
  payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days >= 0 AND payment_terms_days <= 365),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE UNIQUE INDEX proc_vendors_code_uq ON inventory.proc_vendors (tenant_id, upper(code));

-- ---------- purchase requisitions (a store asks purchase to buy) ----------

CREATE TABLE inventory.proc_requisitions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  store_id uuid NOT NULL,
  store_name text NOT NULL,
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'ordered', 'cancelled')),
  needed_by date,
  notes text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id)
);
CREATE UNIQUE INDEX proc_requisitions_number_uq ON inventory.proc_requisitions (tenant_id, number);
CREATE INDEX proc_requisitions_status_idx ON inventory.proc_requisitions (tenant_id, status, created_at);

CREATE TABLE inventory.proc_requisition_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  requisition_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_id uuid NOT NULL,
  item_code text NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  note text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, requisition_id) REFERENCES inventory.proc_requisitions (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id)
);
CREATE INDEX proc_requisition_lines_req_idx ON inventory.proc_requisition_lines (tenant_id, requisition_id);

-- ---------- purchase orders ----------

CREATE TABLE inventory.proc_purchase_orders (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  store_id uuid NOT NULL,
  store_name text NOT NULL,
  vendor_id uuid NOT NULL,
  vendor_name text NOT NULL,
  requisition_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'partially_received', 'received', 'closed', 'cancelled')),
  expected_date date,
  terms text,
  notes text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  approved_by uuid,
  approved_at timestamptz,
  closed_reason text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, vendor_id) REFERENCES inventory.proc_vendors (tenant_id, id),
  FOREIGN KEY (tenant_id, requisition_id) REFERENCES inventory.proc_requisitions (tenant_id, id)
);
CREATE UNIQUE INDEX proc_purchase_orders_number_uq ON inventory.proc_purchase_orders (tenant_id, number);
CREATE INDEX proc_purchase_orders_status_idx ON inventory.proc_purchase_orders (tenant_id, status, created_at);
CREATE INDEX proc_purchase_orders_vendor_idx ON inventory.proc_purchase_orders (tenant_id, vendor_id, created_at);

CREATE TABLE inventory.proc_purchase_order_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  purchase_order_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_id uuid NOT NULL,
  item_code text NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  received_qty integer NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  -- Rate per unit before GST, as on the supplier's invoice.
  rate numeric(14,2) NOT NULL CHECK (rate >= 0),
  gst_rate numeric(5,2) NOT NULL CHECK (gst_rate >= 0 AND gst_rate <= 40),
  tax_amount numeric(14,2) NOT NULL CHECK (tax_amount >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES inventory.proc_purchase_orders (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  CHECK (received_qty <= qty)
);
CREATE INDEX proc_purchase_order_lines_po_idx ON inventory.proc_purchase_order_lines (tenant_id, purchase_order_id);

-- ---------- goods receipts against a PO ----------

CREATE TABLE inventory.proc_grns (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  purchase_order_id uuid NOT NULL,
  facility_id uuid NOT NULL,
  store_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  vendor_name text NOT NULL,
  invoice_no text,
  invoice_date date,
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES inventory.proc_purchase_orders (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, vendor_id) REFERENCES inventory.proc_vendors (tenant_id, id)
);
CREATE UNIQUE INDEX proc_grns_number_uq ON inventory.proc_grns (tenant_id, number);
CREATE INDEX proc_grns_po_idx ON inventory.proc_grns (tenant_id, purchase_order_id);

CREATE TABLE inventory.proc_grn_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  grn_id uuid NOT NULL,
  po_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  item_name text NOT NULL,
  batch_id uuid NOT NULL,
  batch_no text NOT NULL,
  expiry_date date NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  free_qty integer NOT NULL DEFAULT 0 CHECK (free_qty >= 0),
  returned_qty integer NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  rate numeric(14,2) NOT NULL CHECK (rate >= 0),
  gst_rate numeric(5,2) NOT NULL,
  mrp numeric(14,2) NOT NULL CHECK (mrp >= 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, grn_id) REFERENCES inventory.proc_grns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, po_line_id) REFERENCES inventory.proc_purchase_order_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id),
  CHECK (returned_qty <= qty + free_qty)
);
CREATE INDEX proc_grn_lines_grn_idx ON inventory.proc_grn_lines (tenant_id, grn_id);

-- ---------- purchase returns (goods sent back to the vendor) ----------

CREATE TABLE inventory.proc_purchase_returns (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  grn_id uuid NOT NULL,
  store_id uuid NOT NULL,
  vendor_id uuid NOT NULL,
  reason text NOT NULL,
  total numeric(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, grn_id) REFERENCES inventory.proc_grns (tenant_id, id),
  FOREIGN KEY (tenant_id, store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, vendor_id) REFERENCES inventory.proc_vendors (tenant_id, id)
);
CREATE UNIQUE INDEX proc_purchase_returns_number_uq ON inventory.proc_purchase_returns (tenant_id, number);

CREATE TABLE inventory.proc_purchase_return_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  purchase_return_id uuid NOT NULL,
  grn_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, purchase_return_id) REFERENCES inventory.proc_purchase_returns (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, grn_line_id) REFERENCES inventory.proc_grn_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id)
);

-- ---------- indents (a department store asks the central store) ----------

CREATE TABLE inventory.proc_indents (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  facility_id uuid NOT NULL,
  -- The store that asks (ward, OT, pharmacy) and the store that supplies (usually the main store).
  to_store_id uuid NOT NULL,
  to_store_name text NOT NULL,
  from_store_id uuid NOT NULL,
  from_store_name text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'partially_issued', 'issued', 'rejected', 'cancelled', 'closed')),
  notes text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES setup.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, to_store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, from_store_id) REFERENCES inventory.stores (tenant_id, id),
  CHECK (to_store_id <> from_store_id)
);
CREATE UNIQUE INDEX proc_indents_number_uq ON inventory.proc_indents (tenant_id, number);
CREATE INDEX proc_indents_status_idx ON inventory.proc_indents (tenant_id, status, created_at);

CREATE TABLE inventory.proc_indent_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  indent_id uuid NOT NULL,
  line_no integer NOT NULL,
  item_id uuid NOT NULL,
  item_code text NOT NULL,
  item_name text NOT NULL,
  unit text NOT NULL,
  requested_qty integer NOT NULL CHECK (requested_qty > 0),
  approved_qty integer CHECK (approved_qty >= 0),
  issued_qty integer NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  note text,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, indent_id) REFERENCES inventory.proc_indents (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  CHECK (issued_qty <= coalesce(approved_qty, requested_qty))
);
CREATE INDEX proc_indent_lines_indent_idx ON inventory.proc_indent_lines (tenant_id, indent_id);

-- ---------- issues (stock moved from the supplying store to the asking store) ----------

CREATE TABLE inventory.proc_issues (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  number text NOT NULL,
  indent_id uuid NOT NULL,
  from_store_id uuid NOT NULL,
  to_store_id uuid NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, indent_id) REFERENCES inventory.proc_indents (tenant_id, id),
  FOREIGN KEY (tenant_id, from_store_id) REFERENCES inventory.stores (tenant_id, id),
  FOREIGN KEY (tenant_id, to_store_id) REFERENCES inventory.stores (tenant_id, id)
);
CREATE UNIQUE INDEX proc_issues_number_uq ON inventory.proc_issues (tenant_id, number);
CREATE INDEX proc_issues_indent_idx ON inventory.proc_issues (tenant_id, indent_id);

CREATE TABLE inventory.proc_issue_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT app.uuid_v7(),
  issue_id uuid NOT NULL,
  indent_line_id uuid NOT NULL,
  item_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  batch_no text NOT NULL,
  expiry_date date NOT NULL,
  qty integer NOT NULL CHECK (qty > 0),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, issue_id) REFERENCES inventory.proc_issues (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, indent_line_id) REFERENCES inventory.proc_indent_lines (tenant_id, id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES inventory.items (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES inventory.batches (tenant_id, id)
);
CREATE INDEX proc_issue_lines_issue_idx ON inventory.proc_issue_lines (tenant_id, issue_id);

-- ---------- tenancy, timestamps, audit ----------

SELECT app.enable_tenant_rls('inventory.proc_vendors');
SELECT app.enable_tenant_rls('inventory.proc_requisitions');
SELECT app.enable_tenant_rls('inventory.proc_requisition_lines');
SELECT app.enable_tenant_rls('inventory.proc_purchase_orders');
SELECT app.enable_tenant_rls('inventory.proc_purchase_order_lines');
SELECT app.enable_tenant_rls('inventory.proc_grns');
SELECT app.enable_tenant_rls('inventory.proc_grn_lines');
SELECT app.enable_tenant_rls('inventory.proc_purchase_returns');
SELECT app.enable_tenant_rls('inventory.proc_purchase_return_lines');
SELECT app.enable_tenant_rls('inventory.proc_indents');
SELECT app.enable_tenant_rls('inventory.proc_indent_lines');
SELECT app.enable_tenant_rls('inventory.proc_issues');
SELECT app.enable_tenant_rls('inventory.proc_issue_lines');

SELECT app.enable_updated_at('inventory.proc_vendors');
SELECT app.enable_updated_at('inventory.proc_requisitions');
SELECT app.enable_updated_at('inventory.proc_purchase_orders');
SELECT app.enable_updated_at('inventory.proc_indents');

SELECT app.enable_audit('inventory.proc_vendors');
SELECT app.enable_audit('inventory.proc_purchase_orders');
SELECT app.enable_audit('inventory.proc_grns');
SELECT app.enable_audit('inventory.proc_purchase_returns');
SELECT app.enable_audit('inventory.proc_indents');
