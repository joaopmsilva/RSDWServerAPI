#!/bin/bash
# Builds the mod from the uploaded project and puts it in place for the next
# server start. Safe while the server runs: the new file is renamed over the old
# one, so the running server keeps the copy it already loaded.
#
#   update-mod.sh              build and install; loads at the daily restart
#   update-mod.sh --restart    the same, then warn players and restart now
#   update-mod.sh --rollback   put the previous mod back (loads at the next start)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR=/home/dragonwilds/rs_server
SERVER_USER=dragonwilds
SERVICE=dragonwilds
ANNOUNCE="/usr/bin/node /home/dragonwilds/rsdw-bot/src/announce.js"
WARN_MINUTES=2

MOD="$SERVER_DIR/librsdwapi.so"

# Copy next to the target, then rename over it: never overwrite the loaded file in place.
swap_in() {
    sudo install -o "$SERVER_USER" -g "$SERVER_USER" -m 755 "$1" "$MOD.new"
    sudo mv -f "$MOD.new" "$MOD"
}

if [ "${1:-}" = "--rollback" ]; then
    sudo test -f "$MOD.old" || { echo "No $MOD.old to roll back to"; exit 1; }
    swap_in "$MOD.old"
    echo "== Rolled back to the previous mod. It loads at the next server start."
    exit 0
fi

echo "== Building in $SRC"
cd "$SRC"
make -j"$(nproc)"
NEW="$SRC/dist/librsdwapi.so"
[ -s "$NEW" ] || { echo "The build produced no $NEW"; exit 1; }

if sudo cmp -s "$NEW" "$MOD"; then
    echo "== This build is already installed, nothing to do."
else
    # Keep the one being replaced, for --rollback.
    if sudo test -f "$MOD"; then sudo cp -p "$MOD" "$MOD.old"; fi
    swap_in "$NEW"
    echo "== Installed the new mod. The previous one is kept as $MOD.old"
fi

if [ "${1:-}" = "--restart" ]; then
    echo "== Warning players, restarting in $WARN_MINUTES minutes"
    sudo -u "$SERVER_USER" $ANNOUNCE restart "$WARN_MINUTES" "Mod update" || true
    sleep $((WARN_MINUTES * 60))
    sudo systemctl restart "$SERVICE"
    echo "== Restarted. In a minute or two, check the log:"
    echo "   sudo grep -E 'loaded|PlayerChatComponent|engine ready' $SERVER_DIR/rsdwapi/logs/api.log"
else
    echo "== It loads at the next server start (the daily restart at 05:00)."
fi
