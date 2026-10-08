#!/usr/bin/env bash
# Blocks the HMS port (4001) from the internet with ufw, in a way that also works for Docker.
#   sudo ./infra/firewall.sh
# Plain `ufw deny 4001` does nothing for Docker: Docker publishes ports through its own iptables
# chains, before ufw's rules. So this adds a rule to Docker's DOCKER-USER chain, kept in
# /etc/ufw/after.rules so it survives reboots and `ufw reload`. Nginx on this server still reaches
# 127.0.0.1:4001. It also allows SSH, 80 and 443 before turning ufw on. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { echo "Error: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run it with sudo: sudo ./infra/firewall.sh"
command -v ufw >/dev/null || die "ufw is not installed. Fix: sudo apt update && sudo apt install -y ufw"

PORT=$(grep -s '^HMS_PORT=' .env.prod | tail -1 | cut -d= -f2)
PORT=${PORT:-4001}
RULES=/etc/ufw/after.rules
BEGIN="# BEGIN HMS docker port block"
END="# END HMS docker port block"

# Never lock ourselves out: allow every port sshd listens on (plus 22), and web traffic.
ssh_ports=$( (sshd -T 2>/dev/null | awk '$1=="port"{print $2}'; echo 22) | sort -u)
for p in $ssh_ports; do ufw allow "$p/tcp" comment 'SSH' >/dev/null; done
ufw allow 80/tcp comment 'HTTP' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw deny "$PORT/tcp" comment 'HMS (local only)' >/dev/null

# Drop new connections from outside to the Docker-published HMS port. The packet's destination
# port is already rewritten to the container's, so match the original port via conntrack.
cp "$RULES" "$RULES.hms-backup"
sed -i "/^$BEGIN\$/,/^$END\$/d" "$RULES"
cat >> "$RULES" <<EOF
$BEGIN
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -p tcp -m conntrack --ctstate NEW --ctorigdstport $PORT --ctdir ORIGINAL -j DROP
-A DOCKER-USER -j RETURN
COMMIT
$END
EOF

if ufw status | grep -q "Status: active"; then
  ufw reload >/dev/null
else
  ufw --force enable >/dev/null
fi
echo "Firewall on. Allowed: SSH ($(echo $ssh_ports | tr ' ' ',')), 80, 443. Port $PORT is blocked from outside."
ufw status numbered
