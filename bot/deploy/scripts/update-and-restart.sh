#!/bin/bash
# Daily update + restart (cron, 05:00). Warns players on Discord and in game
# 5 minutes ahead; the bot posts "online" again once the server is back.

ANNOUNCE="/usr/bin/node /home/dragonwilds/rsdw-bot/src/announce.js"
LOG=/home/dragonwilds/update.log
WARN_MINUTES=5

echo "$(date): Starting update..." >> "$LOG"

if [ "$WARN_MINUTES" -gt 1 ]; then
    $ANNOUNCE restart "$WARN_MINUTES" "Daily update" >> "$LOG" 2>&1
    sleep $(( (WARN_MINUTES - 1) * 60 ))
    $ANNOUNCE restart 1 --game-only >> "$LOG" 2>&1
    sleep 60
else
    $ANNOUNCE restart "Daily update" >> "$LOG" 2>&1
fi

# Stop the server (no password needed now)
sudo /bin/systemctl stop dragonwilds

# Update the server
/home/dragonwilds/steamcmd/steamcmd.sh +force_install_dir /home/dragonwilds/rs_server +login anonymous +app_update 4019830 validate +quit

# Make sure the start script is executable
chmod +x /home/dragonwilds/rs_server/RSDragonwildsServer.sh

# Start the server again
sudo /bin/systemctl start dragonwilds

echo "$(date): Server updated and restarted successfully" >> "$LOG"
