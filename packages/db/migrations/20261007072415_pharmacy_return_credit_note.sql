-- pharmacy: link sale returns to the billing credit note (and refund receipt) raised for them.
ALTER TABLE inventory.pharmacy_sale_returns
  ADD COLUMN credit_note_id uuid,
  ADD COLUMN credit_note_number text,
  ADD COLUMN billing_refund_number text;
