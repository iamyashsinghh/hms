-- frontoffice: doctor schedules (setup) can allow several patients per slot (max_patients), so the
-- one-live-booking-per-slot unique index goes. Capacity is enforced in FrontofficeService under an
-- advisory lock per doctor and slot.
DROP INDEX IF EXISTS clinical.appointments_slot_uq;
