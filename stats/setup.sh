#!/usr/bin/env bash
# Installs or updates the install counter on this machine:
#   sudo bash stats/setup.sh your-name.duckdns.org
# Puts server.js in /opt/rsdw-stats, runs it as the rsdw-stats user on
# 127.0.0.1:8090, and serves it over HTTPS with Caddy (certificate included).
# Running it again updates server.js and keeps the data and the token.
set -euo pipefail

HOST="${1:?usage: sudo bash stats/setup.sh your-name.duckdns.org}"
HERE="$(cd "$(dirname "$0")" && pwd)"

id rsdw-stats >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin rsdw-stats
install -d -o root -g root -m 755 /opt/rsdw-stats
install -o root -g root -m 644 "$HERE/server.js" /opt/rsdw-stats/server.js
install -o root -g root -m 644 "$HERE/rsdw-stats.service" /etc/systemd/system/rsdw-stats.service

if [ ! -f /etc/rsdw-stats.env ]; then
    umask 077
    echo "STATS_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')" > /etc/rsdw-stats.env
    chown root:rsdw-stats /etc/rsdw-stats.env
    chmod 640 /etc/rsdw-stats.env
fi

systemctl daemon-reload
systemctl enable --now rsdw-stats
systemctl restart rsdw-stats

if ! command -v caddy >/dev/null; then
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
    encode gzip
    reverse_proxy 127.0.0.1:8090
}
EOF
systemctl enable --now caddy
systemctl reload caddy

if command -v ufw >/dev/null && ufw status | grep -q active; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
fi

echo "Done: https://$HOST/  (stats token in /etc/rsdw-stats.env)"
