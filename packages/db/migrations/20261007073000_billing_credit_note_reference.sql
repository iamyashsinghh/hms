-- billing: caller reference on credit notes (e.g. pharmacy return id), unique so retried calls cannot double-credit.
ALTER TABLE billing.credit_notes ADD COLUMN reference text;
CREATE UNIQUE INDEX billing_credit_notes_reference_uq ON billing.credit_notes (tenant_id, reference) WHERE reference IS NOT NULL;
