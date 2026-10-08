-- emr: procedure orders are picked from the billing service master; the service code is kept on the
-- order so signing the consultation can post the charge. Free-text procedures have none.

ALTER TABLE clinical.encounter_orders ADD COLUMN service_code text;

-- The service is part of what was ordered, so it is frozen with the rest once the consultation is signed.
CREATE OR REPLACE FUNCTION clinical.emr_lock_signed_order() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF EXISTS (SELECT 1 FROM clinical.encounters e WHERE e.tenant_id = r.tenant_id AND e.id = r.encounter_id AND e.signed_at IS NOT NULL)
     AND (TG_OP <> 'UPDATE' OR (NEW.kind, NEW.code, NEW.name, NEW.service_code, NEW.priority, NEW.notes, NEW.encounter_id, NEW.patient_id)
                                IS DISTINCT FROM (OLD.kind, OLD.code, OLD.name, OLD.service_code, OLD.priority, OLD.notes, OLD.encounter_id, OLD.patient_id)) THEN
    RAISE EXCEPTION 'encounter is signed; orders cannot be changed' USING ERRCODE = 'P0001', HINT = 'emr_signed_locked';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
