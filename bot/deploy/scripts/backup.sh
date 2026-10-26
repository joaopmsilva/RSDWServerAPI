#!/bin/bash
# Hourly save backup (cron). Keeps the newest 10 and posts a short notice on
# Discord - delete the ANNOUNCE line at the bottom if that's too chatty.

ANNOUNCE="/usr/bin/node /home/dragonwilds/rsdw-bot/src/announce.js"
BACKUP_DIR="/home/dragonwilds/backups"
SAVE_DIR="/home/dragonwilds/rs_server/RSDragonwilds/Saved/SaveGames"

# Create backup folder if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Copy all .sav files with a timestamp
cd "$SAVE_DIR" || exit 1
copied=0
for file in *.sav; do
    if [ -f "$file" ]; then
        cp -a "$file" "$BACKUP_DIR/${file%.sav}_$(date +%Y%m%d_%H%M%S).sav" && copied=$((copied + 1))
    fi
done

# Keep only the newest 10 backups
ls -t "$BACKUP_DIR"/*.sav 2>/dev/null | tail -n +11 | xargs -r rm -f

# Log it
echo "$(date): Backup completed ($copied file(s))" >> /home/dragonwilds/backup.log

if [ "$copied" -gt 0 ]; then
    $ANNOUNCE backup-done "Saved $copied world file(s)." >> /home/dragonwilds/backup.log 2>&1
fi
