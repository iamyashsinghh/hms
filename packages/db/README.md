# @hms/db

Drizzle schema, SQL migrations, seeds and tenancy helpers.

- `src/schema/*.ts` – Drizzle table definitions, one file per module.
- `migrations/*.sql` – forward-only SQL, named `YYYYMMDDHHMMSS_<module>_<what>.sql`. Create one with `pnpm db:new <module> <what>`.
- `pnpm db:migrate` – applies new files as `hms_migrator` (checksums stop edits to applied files).
- `pnpm db:seed` – idempotent: permission catalog, system roles for every hospital, demo hospitals.
- `pnpm --filter @hms/db test` – fails if any `tenant_id` table lacks RLS, or the Drizzle schema and migrations drift apart.
