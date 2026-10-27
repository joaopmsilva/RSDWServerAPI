#!/bin/bash
# Installs the bot from the uploaded project into /home/dragonwilds/rsdw-bot and
# restarts it. .env and data/ (saved players, relay position, logs) are kept.
# The game server isn't touched.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/bot"
BOT_DIR=/home/dragonwilds/rsdw-bot
BOT_USER=dragonwilds
CRON_SCRIPTS=/home/dragonwilds/scripts

[ -f "$SRC/package.json" ] || { echo "No bot found in $SRC"; exit 1; }

echo "== Copying the bot to $BOT_DIR"
sudo rsync -a --delete --exclude=.env --exclude=data/ --exclude=node_modules/ "$SRC/" "$BOT_DIR/"
sudo chown -R "$BOT_USER:$BOT_USER" "$BOT_DIR"

echo "== Installing packages"
sudo -u "$BOT_USER" -H bash -c "cd '$BOT_DIR' && npm install --omit=dev --no-audit --no-fund"

# Settings added since your .env was written. Missing ones use their defaults.
keys() { sudo grep -o '^[A-Z_]*=' "$1" 2>/dev/null | tr -d '=' | sort -u; }
missing=$(comm -23 <(keys "$BOT_DIR/.env.example") <(keys "$BOT_DIR/.env") | tr '\n' ' ')
if [ -n "$missing" ]; then
    echo "== New settings in .env.example (their defaults apply unless you add them): $missing"
fi

# The cron scripts are copied by hand (DEPLOY.md step 10); say if they've changed.
for script in backup.sh update-and-restart.sh; do
    if sudo test -f "$CRON_SCRIPTS/$script" && ! sudo cmp -s "$SRC/deploy/scripts/$script" "$CRON_SCRIPTS/$script"; then
        echo "== Note: $CRON_SCRIPTS/$script differs from bot/deploy/scripts/$script"
    fi
done

# Crash reports read the server's systemd log and the kernel log (out-of-memory kills).
if ! id -nG "$BOT_USER" | grep -qw systemd-journal; then
    sudo usermod -aG systemd-journal "$BOT_USER"
    echo "== Let $BOT_USER read the system journal (for crash reports)"
fi

echo "== Restarting the bot"
sudo systemctl restart rsdw-bot
sleep 4
sudo journalctl -u rsdw-bot -n 15 --no-pager
