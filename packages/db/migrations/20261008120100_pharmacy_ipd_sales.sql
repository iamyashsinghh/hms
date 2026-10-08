-- pharmacy: medicines for an admitted patient can go on the IPD bill (billing rule ipdPharmacy = 'ipd_bill').
-- Such a sale posts one charge per line to the admission instead of raising its own invoice; invoice_id is
-- filled in once the charges are billed (IPD final bill or the billing desk).
ALTER TABLE inventory.pharmacy_sales ADD COLUMN admission_id uuid;
CREATE INDEX pharmacy_sales_admission_idx ON inventory.pharmacy_sales (tenant_id, admission_id) WHERE admission_id IS NOT NULL;
