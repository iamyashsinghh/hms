-- billing: 'insurance' payment mode for TPA / scheme settlements, kept apart from bank receipts.
ALTER TABLE billing.payments DROP CONSTRAINT payments_mode_check;
ALTER TABLE billing.payments ADD CONSTRAINT payments_mode_check
  CHECK (mode IN ('cash', 'upi', 'card', 'bank', 'cheque', 'deposit', 'online', 'insurance'));
