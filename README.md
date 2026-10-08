# HMS — Hospital Management System (SaaS)

Multi-tenant hospital software for Indian clinics, nursing homes and hospital groups.
Product plan: https://claude.ai/code/artifact/f71e60ad-6ff3-49b5-8bb2-46bc6f4bcc78

| Layer | Stack |
| --- | --- |
| Web | Next.js 16 (App Router), Tailwind v4, TanStack Query, React Hook Form + Zod — `apps/web` |
| API | NestJS 11 on Fastify, Node 22, TypeScript — `apps/api` |
| Mobile | Expo SDK 57 + Expo Router; one codebase for doctor/staff/owner/patient apps — `apps/mobile` |
| Database | PostgreSQL 16, Drizzle ORM, forward-only SQL migrations, row-level security per hospital — `packages/db` |
| Contracts | Zod schemas, permissions, roles shared by API, web and mobile — `packages/shared` |
| API client | Typed fetch client with token refresh — `packages/api-client` |
| Jobs | Redis + BullMQ, transactional outbox — `apps/api/src/worker.ts` |

## Run it

```bash
# With Docker
docker compose up -d
cp .env.example .env
pnpm install && pnpm build
pnpm db:migrate && pnpm db:seed
pnpm dev                      # api :4000, web :3000

# Without Docker (cloud dev container with Postgres 16 + Redis installed)
./scripts/local-infra.sh && pnpm dev

# Mobile
cd apps/mobile && pnpm start  # APP_VARIANT=doctor|staff|owner|patient
```

Demo login: hospital code `demo`, `admin@demo.hms` / `Demo@12345`
(also `doctor@`, `reception@`, `pharmacy@`, `owner@`, `nurse@`, `billing@`, `lab@`, `radiology@`, `store@`, `accounts@`, `hr@`, `quality@` — same password).
A second hospital `city` (`admin@city.hms`) exists to prove isolation.

## Deploy on a server (Docker)

Needs Docker with the Compose plugin. Everything runs on one port, **4001** (only on 127.0.0.1, so it is reachable through nginx and not from the internet; `HMS_BIND=0.0.0.0` in `.env.prod` opens it): web at `/`, API at `/api/v1`,
database viewer (Adminer) at `/db/`.

```bash
git clone -b staging https://github.com/iamyashsinghh/hms.git && cd hms
./deploy.sh            # first run creates .env.prod with random secrets, builds, migrates, seeds the demo
# every update (on the staging branch):
git pull origin staging && ./deploy.sh
```

- `.env.prod` holds every secret (Postgres, DB roles, JWT, super admin password). It is git-ignored; back it up.
- Migrations run on every deploy before the API starts. The demo hospitals are seeded only on an empty
  database (`SEED_DEMO=auto`; set `never` to skip). Permissions and system roles are synced every deploy.
- Super admin console: `/admin`, login `super@hms.local` with `PLATFORM_ADMIN_PASSWORD` from `.env.prod`.
  Its **Database** button opens `/db/`: server `postgres`, user `postgres`, password `POSTGRES_PASSWORD`, database `hms`.
- Domain + HTTPS in one command (DNS A record must already point at the server):
  `sudo ./infra/setup-domain.sh hms.example.com you@example.com`. It writes the nginx site from
  [infra/nginx/hms.conf.example](infra/nginx/hms.conf.example), gets the certificate with certbot, sets
  `PUBLIC_URL=https://<domain>` and `HMS_BIND=127.0.0.1` in `.env.prod` and redeploys. Safe to re-run.
- Firewall: `sudo ./infra/firewall.sh` turns on ufw (SSH, 80, 443 allowed) and blocks port 4001 from outside
  with a Docker-aware rule (plain `ufw deny` does not cover Docker-published ports).
- Logs: `docker compose -f docker-compose.prod.yml logs -f api worker`. Backup:
  `docker compose -f docker-compose.prod.yml exec postgres pg_dump -U postgres hms > backup.sql`.

## Checks

```bash
pnpm typecheck && pnpm lint && pnpm test   # tests need a migrated + seeded database
```

`pnpm test` includes guards that fail when a table with `tenant_id` has no RLS policy, or when the Drizzle
schema and the SQL migrations drift apart, plus API end-to-end tests for login, refresh rotation, RBAC and
cross-hospital isolation.

## How a request is handled

1. `AuthGuard` verifies the JWT, loads roles, permissions and facilities, checks `X-Facility-Id` and `@RequirePermissions(...)`.
2. `ContextInterceptor` puts that context in AsyncLocalStorage.
3. Services call `db.tx(fn)`: one transaction that first runs `set_config('app.tenant_id', …, true)`, so Postgres RLS only shows that hospital's rows. The API connects as `hms_app`, which owns no tables and cannot bypass RLS.
4. Changes to audited tables are written to `audit.audit_log` by triggers; events go to `audit.outbox` in the same transaction and the worker delivers them.

Parallel development rules: see [PARALLEL_PLAN.md](PARALLEL_PLAN.md).
