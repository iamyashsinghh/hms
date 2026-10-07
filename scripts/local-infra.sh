#!/usr/bin/env bash
# Start Postgres 16 + Redis without Docker (cloud dev containers), create roles, migrate, seed.
# With Docker, use `docker compose up -d` instead, then `pnpm db:migrate && pnpm db:seed`.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || cp .env.example .env

if command -v pg_ctlcluster >/dev/null; then
  pg_ctlcluster 16 main start 2>/dev/null || true
  sleep 2
  su postgres -c "psql -tc \"ALTER USER postgres PASSWORD 'postgres'\"" >/dev/null
  su postgres -c "psql -tc \"SELECT 1 FROM pg_database WHERE datname='hms'\"" | grep -q 1 || su postgres -c "psql -c 'CREATE DATABASE hms'"
  su postgres -c "psql -q -d hms -f infra/postgres/init.sql"
fi
redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null

pnpm install
pnpm --filter @hms/shared --filter @hms/db --filter @hms/api-client build
pnpm db:migrate
pnpm db:seed
echo "Ready. Run: pnpm dev   (web http://localhost:3000, api http://localhost:4000/api/v1)"
echo "Login: hospital 'demo', admin@demo.hms / Demo@12345"
