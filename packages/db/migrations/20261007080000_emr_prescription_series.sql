-- emr: prescription numbers now use the Setup number series key 'emr.prescription' (configurable prefix).
-- Carry the old 'emr.rx' counter over so existing Rx numbers are never reissued.
INSERT INTO setup.counters (tenant_id, key, next_value)
SELECT tenant_id, 'emr.prescription', next_value FROM setup.counters WHERE key = 'emr.rx'
ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = greatest(setup.counters.next_value, EXCLUDED.next_value);
