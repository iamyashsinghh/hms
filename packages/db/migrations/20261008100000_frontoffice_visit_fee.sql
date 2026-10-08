-- frontoffice: how the consultation was charged when the patient was checked in (billing charges).
-- 'full' = doctor's consultation fee, 'follow_up' = follow-up fee inside the doctor's follow-up days,
-- 'free_follow_up' = follow-up fee 0 (no charge), 'none' = the doctor has no fee. NULL for older visits.
-- A follow-up is counted from the last full-fee visit, so free follow-ups never extend the window.
ALTER TABLE clinical.opd_visits
  ADD COLUMN fee_type text CHECK (fee_type IN ('full', 'follow_up', 'free_follow_up', 'none'));

CREATE INDEX opd_visits_patient_doctor_idx ON clinical.opd_visits (tenant_id, patient_id, doctor_id, visit_date);
