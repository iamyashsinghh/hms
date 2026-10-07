-- billing: doctor on the invoice (for doctor-wise revenue in reports). No FK: doctors are iam.users,
-- and a bill should survive a staff record being removed.
ALTER TABLE billing.invoices ADD COLUMN doctor_id uuid;
CREATE INDEX billing_invoices_doctor_idx ON billing.invoices (tenant_id, doctor_id, invoice_date) WHERE doctor_id IS NOT NULL;
