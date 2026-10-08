-- inventory: an indent issue can be made for a patient / IPD admission (consumables used on the patient).
-- With the billing rule consumables = 'charge', each issued line is charged to the patient's account.
ALTER TABLE inventory.proc_issues
  ADD COLUMN patient_id uuid,
  ADD COLUMN admission_id uuid,
  ADD COLUMN patient_name text,
  ADD CONSTRAINT proc_issues_patient_fk FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  ADD CONSTRAINT proc_issues_admission_needs_patient CHECK (admission_id IS NULL OR patient_id IS NOT NULL);
CREATE INDEX proc_issues_patient_idx ON inventory.proc_issues (tenant_id, patient_id) WHERE patient_id IS NOT NULL;
