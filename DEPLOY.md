# Deploying on a Linux VPS

How to put the mod and the Discord bot on a plain Linux VPS with a manual Steam install of
the Dragonwilds dedicated server - no Docker, no panel.

The paths below assume this layout. Change them if yours differ.

| What | Where |
| ---- | ----- |
| Linux user that runs the server | `dragonwilds` |
| Server folder | `/home/dragonwilds/rs_server` (with `RSDragonwildsServer.sh`) |
| The mod | `/home/dragonwilds/rs_server/librsdwapi.so` |
| Mod settings and logs | `/home/dragonwilds/rs_server/rsdwapi/` (the log prints the real path) |
| The bot | `/home/dragonwilds/rsdw-bot` |

Run the VPS commands as `dragonwilds` unless they start with `sudo`.

## 1. Discord

In the [Developer Portal](https://discord.com/developers/applications), open your bot's
application:

1. **Bot** → under *Privileged Gateway Intents*, turn on **Message Content Intent**.
2. **Bot** → **Reset Token** if you don't have the token saved. You'll paste it into `.env`.
3. Make sure the bot has these permissions in the channels it should work in: *View
   Channels*, *Send Messages*, *Embed Links*, *Add Reactions*, *Read Message History*.
   *Manage Messages* is optional but makes reaction navigation smoother. To re-invite with
   the right permissions: **OAuth2 → URL Generator**, scopes `bot` **and**
   `applications.commands` (needed for the slash commands), tick those permissions, open the
   URL. Re-inviting over the existing bot keeps its roles.
4. In Discord, **User Settings → Advanced → Developer Mode** on. Right-click the channel for
   in-game chat → **Copy Channel ID**, and the same for deaths and server notices if you want
   them in separate channels.

## 2. Copy the project to the VPS

From PowerShell on your PC (replace `USER` and `VPS_IP`):

```powershell
cd C:\Users\parad\Desktop\rsdwapi
tar --exclude=node_modules --exclude=.git --exclude=bot/data --exclude=bot/.env -czf rsdw.tgz RSDWServerAPI
scp rsdw.tgz USER@VPS_IP:/tmp/
```

On the VPS:

```bash
cd ~ && rm -rf RSDWServerAPI && tar xzf /tmp/rsdw.tgz
```

If you uploaded as a different user than `dragonwilds`, also run
`sudo chown -R dragonwilds:dragonwilds ~dragonwilds/RSDWServerAPI` after extracting into
`~dragonwilds`.

## 3. Build the mod

```bash
sudo apt update && sudo apt install -y build-essential
cd ~/RSDWServerAPI
make -j"$(nproc)"
ls -lh dist/librsdwapi.so
```

## 4. Stop the server and make sure port 8080 is free

Stop the server the way you normally do, then:

```bash
sudo ss -ltnp | grep :8080
```

Nothing should be listed. If something is (a leftover `bash` or server process from the old
mod), stop it with `sudo kill <pid>` using the pid shown, and check again.

## 5. Install the new mod

```bash
cp /home/dragonwilds/rs_server/librsdwapi.so /home/dragonwilds/rs_server/librsdwapi.so.old
cp ~/RSDWServerAPI/dist/librsdwapi.so /home/dragonwilds/rs_server/librsdwapi.so
```

Then edit `/home/dragonwilds/rs_server/rsdwapi/settings.ini`:

- Under `[API]`, set `BindAddress=127.0.0.1`. The bot is on the same machine, so the API
  doesn't need to be reachable from outside.
- The old `[Discord]` section is no longer used; the mod drops it on the next start. The bot
  does the relaying now.

## 6. Start the server and check the mod

Start the server as usual, with `LD_PRELOAD` in front of the command, for example:

```bash
cd /home/dragonwilds/rs_server
LD_PRELOAD=/home/dragonwilds/rs_server/librsdwapi.so ./RSDragonwildsServer.sh -log -port=7777
```

Once it has loaded (a minute or two):

```bash
grep -E "loaded|data directory|Failed to bind|engine ready|not found|Events" /home/dragonwilds/rs_server/rsdwapi/logs/api.log
```

You should see:

- `RSDWRestAPI 0.2.1 loaded`
- `RSDWRestAPI: engine ready, endpoints are live`
- `Events: chat and death feed live at /api/events`

and **no** `Failed to bind` or `... not found` lines.

Test the API (the token is `BearerToken` in `settings.ini`):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/health
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/players
```

`health` should say `"engineReady":true`.

If there is no `0.2.1 loaded` line at all, add `RSDWAPI_FORCE=1` before `LD_PRELOAD=` in the
start command and restart.

## 7. Install the bot

```bash
node --version          # needs v18.17 or newer
mv ~/RSDWServerAPI/bot /home/dragonwilds/rsdw-bot
cd /home/dragonwilds/rsdw-bot
npm install --omit=dev
cp .env.example .env
nano .env
```

Fill in at least:

| Setting | Value |
| ------- | ----- |
| `DISCORD_TOKEN` | the bot token from step 1 |
| `API_TOKEN` | `BearerToken` from `settings.ini` |
| `SERVER_NAME` | your server's name, shown in `/status` and notices |
| `MAX_PLAYERS` | your server's max players |
| `CHAT_CHANNEL_ID` | channel ID for in-game chat |
| `DEATH_CHANNEL_ID` | channel ID for deaths, or leave empty to use the chat channel |
| `STATUS_CHANNEL_ID` | channel ID for online / offline / restart / backup notices, or empty for the chat channel |

Optional: `BRIDGE_ROLE_ID` to let only one role talk into the game. Everything else in
`.env.example` has sensible defaults.

Save with Ctrl+O, Enter, Ctrl+X.

## 8. Test run

```bash
npm start
```

Look for `logged in as ...`, `slash commands registered` and `server is online`. In Discord
type `/` and try `/status`, `/online`, `/levels`, `/level` and `/leaderboard` (names fill in as you type),
click the reactions, say something in game chat to check it shows up in Discord, and type in
the chat channel to check it shows up in game. Stop with Ctrl+C.

## 9. Run the bot permanently

```bash
which node
```

If that isn't `/usr/bin/node`, edit `ExecStart=` in `deploy/rsdw-bot.service` to match.
Then:

```bash
sudo cp deploy/rsdw-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rsdw-bot
systemctl status rsdw-bot
```

The bot now starts on boot, restarts itself if it ever exits, and keeps running whether the
game server is up or not - its status just turns red while the server is down.

Useful commands:

```bash
journalctl -u rsdw-bot -f              # live log
tail -f /home/dragonwilds/rsdw-bot/data/bot.log
sudo systemctl restart rsdw-bot        # after editing .env
```

## 10. Notices from your cron scripts

The bot sees by itself when the server goes offline, restarts and comes back. Backups and
planned restarts it can't see, so the cron scripts announce them. Updated copies of
`backup.sh` and `update-and-restart.sh` are in `/home/dragonwilds/rsdw-bot/deploy/scripts/`:

- `update-and-restart.sh` warns on Discord and in game 5 minutes before (and in game again 1
  minute before), then updates and restarts as before. Once the server is back the bot posts
  "🟢 Server is online - Restart complete". Set `WARN_MINUTES=0` at the top to skip the wait.
- `backup.sh` posts "💾 Backup complete" after each backup. Delete its last `if` block if
  hourly messages are too much.

```bash
cd /home/dragonwilds/scripts
cp backup.sh backup.sh.old && cp update-and-restart.sh update-and-restart.sh.old
cp /home/dragonwilds/rsdw-bot/deploy/scripts/*.sh .
chmod +x *.sh
```

The crontab stays as it is. Both scripts call `/usr/bin/node`; if `which node` says
otherwise, change `ANNOUNCE=` at the top of each. To test without waiting for cron:

```bash
/usr/bin/node /home/dragonwilds/rsdw-bot/src/announce.js say "Testing notices"
```

## Updating the bot

The bot is separate from the game server, so updating it never needs a server restart:
players stay connected, and only the bot is gone for a couple of seconds.

From PowerShell on your PC:

```powershell
cd C:\Users\parad\Desktop\rsdwapi
tar --exclude=node_modules --exclude=.git --exclude=bot/data --exclude=bot/.env -czf rsdw.tgz RSDWServerAPI
scp rsdw.tgz USER@VPS_IP:/tmp/
```

On the VPS:

```bash
cd ~ && rm -rf RSDWServerAPI && tar xzf /tmp/rsdw.tgz
rsync -a --delete --exclude=.env --exclude=data/ --exclude=node_modules/ ~/RSDWServerAPI/bot/ /home/dragonwilds/rsdw-bot/
cd /home/dragonwilds/rsdw-bot && npm install --omit=dev
sudo systemctl restart rsdw-bot
journalctl -u rsdw-bot -n 30 --no-pager
```

`rsync` replaces the code but leaves `.env` and `data/` (saved players, relay position, logs)
alone. Then check `.env.example` for settings your `.env` doesn't have yet:

```bash
diff <(grep -o '^[A-Z_]*=' .env.example | sort) <(grep -o '^[A-Z_]*=' .env | sort)
```

Lines starting with `<` are new settings. Missing ones use their defaults, so adding them is
only needed to change something.

## Updating the mod

Only needed when the mod itself changes. Copy the project over (step 2), `make -j"$(nproc)"`,
then at a quiet moment stop the server, copy `dist/librsdwapi.so` into place and start it
again (steps 4-6).

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Bot status stays 🔴 offline | `curl` from step 6 works? Same `API_URL` port and `API_TOKEN` as `settings.ini`? |
| `API rejected the bearer token` in the bot log | `API_TOKEN` doesn't match `BearerToken` |
| Nothing appears when typing `/` | re-invite with `applications.commands` (step 1), then reload Discord (Ctrl+R) |
| `/` commands answer "Commands work in ..." | `ALLOWED_CHANNELS` |
| Discord messages don't reach the game | Message Content Intent (step 1), `CHAT_CHANNEL_ID`, `BRIDGE_ROLE_ID`; 💤 on the message means nobody is online |
| No server notices | `STATUS_CHANNEL_ID` or `CHAT_CHANNEL_ID` set, `SERVER_NOTICES` not false |
| No reactions on replies | the bot needs *Add Reactions* and *Read Message History* |
| `Discord login failed` | `DISCORD_TOKEN` wrong or reset |
| No chat in Discord | `CHAT_CHANNEL_ID` set? `Chat: ... not found` in `api.log` means the game patch moved something |
| `Failed to bind on 0.0.0.0:8080` in `api.log` | step 4 - something else holds the port |
| Levels look wrong | compare with in-game; the table is in `bot/src/levels.js` |
