-- quality: census rows can come from IPD's daily census event (ipd.census.daily) as well as manual entry.
-- For a facility-day with IPD rows, indicators use the IPD rows for patient / device days and ignore manual
-- ones (except surgeries, which IPD does not send until an OT module exists).
ALTER TABLE quality.census ADD COLUMN source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ipd'));
ALTER TABLE quality.census ADD COLUMN ward_id uuid;
