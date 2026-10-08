#!/usr/bin/env bash
# One-command deploy:   ./deploy.sh
# First run creates .env.prod with strong random secrets; later runs keep them and just rebuild,
# migrate and restart. Update the server with:  git pull origin staging && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=.env.prod
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

command -v docker >/dev/null || { echo "Docker is not installed: https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is missing (install the docker-compose-plugin package)"; exit 1; }

secret() { openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
# Adds KEY=value to .env.prod only when the key is not there yet, so existing secrets never change.
ensure() { grep -q "^$1=" "$ENV_FILE" 2>/dev/null || echo "$1=$2" >> "$ENV_FILE"; }

if [ ! -f "$ENV_FILE" ]; then
  echo "Creating $ENV_FILE with new secrets"
  ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  cat > "$ENV_FILE" <<EOT
# HMS production settings, created by deploy.sh. Keep this file private and backed up.
# Put a domain in front with:  sudo ./infra/setup-domain.sh <domain> <email>   (sets PUBLIC_URL to https).
PUBLIC_URL=http://${ip:-localhost}:4001
HMS_PORT=4001
# 127.0.0.1 = port 4001 is reachable only from this server (through nginx). 0.0.0.0 opens it to the
# internet; Docker publishes ports past ufw/firewalld, so the firewall does not close it.
HMS_BIND=127.0.0.1
# auto = load the demo hospitals only when the database is empty; never = don't.
SEED_DEMO=auto
EOT
  chmod 600 "$ENV_FILE"
fi
ensure POSTGRES_PASSWORD "$(secret)"
ensure HMS_MIGRATOR_PASSWORD "$(secret)"
ensure HMS_APP_PASSWORD "$(secret)"
ensure HMS_PLATFORM_PASSWORD "$(secret)"
ensure JWT_ACCESS_SECRET "$(secret)$(secret)"
ensure ABDM_CALLBACK_SECRET "$(secret)"
ensure MOCK_PAYMENT_WEBHOOK_SECRET "$(secret)"
ensure PLATFORM_ADMIN_EMAIL "super@hms.local"
ensure PLATFORM_ADMIN_PASSWORD "Sa-$(secret | cut -c1-16)"

echo "Building the app image"
"${COMPOSE[@]}" build
echo "Starting the stack (migrations run first)"
"${COMPOSE[@]}" up -d --remove-orphans

echo -n "Waiting for the API"
for _ in $(seq 1 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' "$("${COMPOSE[@]}" ps -q api)" 2>/dev/null || true)
  [ "$status" = healthy ] && break
  if [ "$(docker inspect -f '{{.State.ExitCode}}' "$("${COMPOSE[@]}" ps -aq migrate)" 2>/dev/null)" != 0 ]; then
    echo; echo "Database migration failed:"; "${COMPOSE[@]}" logs --tail 50 migrate; exit 1
  fi
  echo -n .; sleep 3
done
echo
[ "$status" = healthy ] || { echo "API did not become healthy:"; "${COMPOSE[@]}" logs --tail 50 api; exit 1; }
docker image prune -f >/dev/null 2>&1 || true

val() { grep "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
url=$(val PUBLIC_URL)
bind=$(val HMS_BIND)
cat <<EOT

HMS is live on port $(val HMS_PORT)   ->   $url
  Hospital login : $url/login   (hospital code "demo", admin@demo.hms / Demo@12345)
  Super admin    : $url/admin   ($(val PLATFORM_ADMIN_EMAIL) / $(val PLATFORM_ADMIN_PASSWORD))
  DB viewer      : $url/db/     (server postgres, user postgres, password = POSTGRES_PASSWORD in $ENV_FILE)
Logs: docker compose -f docker-compose.prod.yml logs -f api
EOT
if [ "$bind" = 127.0.0.1 ] && [ "${url#https://}" = "$url" ]; then
  echo "Port $(val HMS_PORT) is closed to the internet. Open it through a domain: sudo ./infra/setup-domain.sh <domain> <email>"
elif [ "$bind" != 127.0.0.1 ]; then
  echo "WARNING: port $(val HMS_PORT) is open to the internet (HMS_BIND=$bind). To close it: set HMS_BIND=127.0.0.1 in $ENV_FILE and run ./deploy.sh"
fi
