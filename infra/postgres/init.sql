-- Database roles (run once per cluster, as a superuser).
-- hms_migrator owns every table and runs migrations.
-- hms_app is what the API connects as: no table ownership, no BYPASSRLS, so RLS always applies.
-- hms_platform is for cross-tenant platform reports (read-only, audited in code).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_migrator') THEN
    CREATE ROLE hms_migrator LOGIN PASSWORD 'hms_migrator';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_app') THEN
    CREATE ROLE hms_app LOGIN PASSWORD 'hms_app' NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hms_platform') THEN
    CREATE ROLE hms_platform LOGIN PASSWORD 'hms_platform' NOBYPASSRLS;
  END IF;
END $$;
GRANT ALL ON DATABASE hms TO hms_migrator;
ALTER DATABASE hms OWNER TO hms_migrator;
