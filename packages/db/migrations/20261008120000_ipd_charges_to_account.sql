-- ipd: IPD charges move to the patient account (billing.charges with admission_id). The running bill now
-- reads billing.charges, so every department's charges for the stay (medicines, consumables, lab...) show up
-- in one place. inpatient.charges is kept read-only for history; the app no longer writes it.
--
-- Copied as source {module 'ipd', ref <old charge id>}: date, price, GST, discount and status are kept.
-- Charges of an admission whose IPD bill is final become 'billed' on that invoice; the invoice line is matched
-- by description, qty, price and GST (the n-th identical charge to the n-th identical line), left NULL when no
-- line matches. Charges with a GST rate outside billing's slabs (only possible before slabs were enforced)
-- cannot be copied and stay in inpatient.charges only.

WITH src AS (
  SELECT c.*, a.facility_id, a.patient_id, a.invoice_id AS adm_invoice_id,
         row_number() OVER (PARTITION BY c.tenant_id, c.admission_id, c.description, c.qty, c.unit_price, c.tax_rate
                            ORDER BY c.created_at, c.id) AS rn
    FROM inpatient.charges c
    JOIN inpatient.admissions a ON a.tenant_id = c.tenant_id AND a.id = c.admission_id
   WHERE c.tax_rate IN (0, 0.1, 0.25, 3, 5, 12, 18, 28, 40)
),
lines AS (
  SELECT l.tenant_id, l.invoice_id, l.line_no, l.description, l.qty, l.unit_price, l.tax_rate,
         row_number() OVER (PARTITION BY l.tenant_id, l.invoice_id, l.description, l.qty, l.unit_price, l.tax_rate
                            ORDER BY l.line_no) AS rn
    FROM billing.invoice_lines l
)
INSERT INTO billing.charges (
  tenant_id, facility_id, patient_id, account, admission_id, source_module, source_ref, source_line,
  service_id, service_code, description, qty, unit_price, price_includes_tax, tax_rate, discount, charge_date,
  status, invoice_id, invoice_line_no, cancel_reason, cancelled_at, created_by, updated_by, created_at, updated_at
)
SELECT s.tenant_id, s.facility_id, s.patient_id, 'ipd', s.admission_id, 'ipd', s.id::text, '',
       svc.id, s.service_code, s.description, s.qty, s.unit_price, false, s.tax_rate, s.discount, s.charge_date,
       CASE WHEN s.status = 'cancelled' THEN 'cancelled' WHEN s.adm_invoice_id IS NOT NULL THEN 'billed' ELSE 'pending' END,
       CASE WHEN s.status <> 'cancelled' THEN s.adm_invoice_id END,
       CASE WHEN s.status <> 'cancelled' THEN l.line_no END,
       s.cancel_reason,
       CASE WHEN s.status = 'cancelled' THEN s.updated_at END,
       s.created_by, s.updated_by, s.created_at, s.updated_at
  FROM src s
  LEFT JOIN billing.services svc ON svc.tenant_id = s.tenant_id AND svc.code = s.service_code
  LEFT JOIN lines l ON l.tenant_id = s.tenant_id AND l.invoice_id = s.adm_invoice_id AND l.description = s.description
                   AND l.qty = s.qty AND l.unit_price = s.unit_price AND l.tax_rate = s.tax_rate AND l.rn = s.rn
ON CONFLICT (tenant_id, source_module, source_ref, source_line) DO NOTHING;

-- The app only reads the old table now.
REVOKE INSERT, UPDATE ON inpatient.charges FROM hms_app;
COMMENT ON TABLE inpatient.charges IS 'History only: IPD charges live in billing.charges (admission_id) since 2026-10-08.';
