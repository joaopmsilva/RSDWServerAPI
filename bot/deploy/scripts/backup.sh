#!/bin/bash
# Hourly save backup (cron). Asks the game to save first (once SAVE_FUNCTION is
# set in the bot's .env), keeps the newest 10 and posts a short notice on
# Discord (BACKUP_NOTICES=false in the bot's .env keeps that quiet).

BOT="/home/dragonwilds/rsdw-bot"
NODE=/usr/bin/node
BACKUP_DIR="/home/dragonwilds/backups"
SAVE_DIR="/home/dragonwilds/rs_server/RSDragonwilds/Saved/SaveGames"
LOG=/home/dragonwilds/backup.log

# Create backup folder if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Make the game write a fresh, complete save before copying it
$NODE "$BOT/src/save-world.js" >> "$LOG" 2>&1

# Copy all .sav files, with one timestamp for the whole run
cd "$SAVE_DIR" || exit 1
STAMP=$(date +%Y%m%d_%H%M%S)
copied=0
for file in *.sav; do
    if [ -f "$file" ]; then
        cp -a "$file" "$BACKUP_DIR/${file%.sav}_${STAMP}.sav" && copied=$((copied + 1))
    fi
done

# Keep only the newest 10 backups
ls -t "$BACKUP_DIR"/*.sav 2>/dev/null | tail -n +11 | xargs -r rm -f

# Log it
echo "$(date): Backup completed ($copied file(s))" >> "$LOG"

if [ "$copied" -gt 0 ]; then
    $NODE "$BOT/src/announce.js" backup-done "Saved $copied world file(s)." >> "$LOG" 2>&1
fi
