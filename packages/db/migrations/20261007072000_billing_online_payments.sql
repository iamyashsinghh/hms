-- billing: 'online' payment mode for payments captured by the patient portal (payment gateway).
ALTER TABLE billing.payments DROP CONSTRAINT payments_mode_check;
ALTER TABLE billing.payments ADD CONSTRAINT payments_mode_check
  CHECK (mode IN ('cash', 'upi', 'card', 'bank', 'cheque', 'deposit', 'online'));
CREATE INDEX billing_payments_reference_idx ON billing.payments (tenant_id, reference) WHERE reference IS NOT NULL;
