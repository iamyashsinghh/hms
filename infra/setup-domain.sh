#!/usr/bin/env bash
# Puts a domain with HTTPS in front of the HMS Docker stack (host nginx -> localhost:4001).
#   sudo ./infra/setup-domain.sh hms.staging.ashniva.com you@example.com
# The email is for Let's Encrypt expiry notices; without it certbot asks its questions itself.
# Safe to re-run: it keeps the certificate and the HTTPS config certbot already added.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${1:-}"
EMAIL="${2:-}"
ENV_FILE=.env.prod
APT_FIX="sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx"

die() { echo "Error: $*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "usage: sudo ./infra/setup-domain.sh <domain> [email]"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "'$DOMAIN' does not look like a domain name"
[ "$(id -u)" = 0 ] || die "run it with sudo: sudo ./infra/setup-domain.sh $DOMAIN $EMAIL"
command -v nginx >/dev/null || die "nginx is not installed. Fix: $APT_FIX"
command -v certbot >/dev/null || die "certbot is not installed. Fix: $APT_FIX"
certbot plugins 2>/dev/null | grep -q nginx || die "certbot's nginx plugin is missing. Fix: $APT_FIX"

# DNS must already point here, or Let's Encrypt cannot verify the domain.
server_ip=$(curl -fsS -4 --max-time 5 https://api.ipify.org 2>/dev/null || true)
dns_ip=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}')
if [ -z "$dns_ip" ]; then
  die "$DOMAIN does not resolve yet. Add a DNS A record: $DOMAIN -> ${server_ip:-<server IP>}, wait a few minutes, run again."
elif [ -n "$server_ip" ] && [ "$dns_ip" != "$server_ip" ]; then
  echo "Warning: $DOMAIN points to $dns_ip but this server is $server_ip. Certbot will fail unless that is a proxy/CDN in front of this server."
fi

# 1. nginx site. Not overwritten once certbot has added HTTPS to it.
if [ -d /etc/nginx/sites-available ]; then
  SITE=/etc/nginx/sites-available/hms-$DOMAIN.conf
  LINK=/etc/nginx/sites-enabled/hms-$DOMAIN.conf
else
  SITE=/etc/nginx/conf.d/hms-$DOMAIN.conf
  LINK=
fi
if [ -f "$SITE" ] && grep -q "managed by Certbot" "$SITE"; then
  echo "nginx: $SITE already has HTTPS, keeping it"
else
  sed "s/hms\.example\.com/$DOMAIN/g" infra/nginx/hms.conf.example > "$SITE"
  # Servers without IPv6 cannot listen on [::]:80.
  [ -f /proc/net/if_inet6 ] || sed -i '/listen \[::\]/d' "$SITE"
  echo "nginx: wrote $SITE"
fi
[ -z "$LINK" ] || ln -sf "$SITE" "$LINK"
nginx -t
systemctl reload-or-restart nginx 2>/dev/null || nginx -s reload 2>/dev/null || nginx

# 2. HTTPS certificate (renewals are handled by certbot's own timer).
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring
else
  certbot --nginx -d "$DOMAIN" --redirect --keep-until-expiring
fi

# 3. App settings: public HTTPS URL, and port 4001 only reachable through nginx.
set_env() {
  touch "$ENV_FILE"
  if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi
}
set_env PUBLIC_URL "https://$DOMAIN"
set_env HMS_BIND 127.0.0.1
chmod 600 "$ENV_FILE"
[ -z "${SUDO_USER:-}" ] || chown "$SUDO_USER" "$ENV_FILE"

# 4. Restart the stack with the new settings.
./deploy.sh

echo
echo "Done: https://$DOMAIN   (super admin: https://$DOMAIN/admin, DB viewer: https://$DOMAIN/db/)"
