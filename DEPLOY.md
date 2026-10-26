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
   the right permissions: **OAuth2 → URL Generator**, scope `bot`, tick those permissions,
   open the URL.
4. In Discord, **User Settings → Advanced → Developer Mode** on. Right-click the channel for
   in-game chat → **Copy Channel ID**, and the same for deaths if you want a separate one.

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

- `RSDWRestAPI 0.2.0 loaded`
- `RSDWRestAPI: engine ready, endpoints are live`
- `Events: chat and death feed live at /api/events`

and **no** `Failed to bind` or `... not found` lines.

Test the API (the token is `BearerToken` in `settings.ini`):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/health
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/players
```

`health` should say `"engineReady":true`.

If there is no `0.2.0 loaded` line at all, add `RSDWAPI_FORCE=1` before `LD_PRELOAD=` in the
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
| `SERVER_NAME` | your server's name, shown in `!status` |
| `MAX_PLAYERS` | your server's max players |
| `CHAT_CHANNEL_ID` | channel ID for in-game chat |
| `DEATH_CHANNEL_ID` | channel ID for deaths, or leave empty to use the chat channel |

Save with Ctrl+O, Enter, Ctrl+X.

## 8. Test run

```bash
npm start
```

Look for `logged in as ...` and `server is online`. In Discord try `!help`, `!status`,
`!online`, `!levels <name>` and `!level wc <name>`, click the reactions, and say something in
game chat to check the relay. Stop with Ctrl+C.

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

## Updating later

Mod: copy the project over again (step 2), `make -j"$(nproc)"`, stop the server, copy
`dist/librsdwapi.so` into place, start the server.

Bot: replace everything in `/home/dragonwilds/rsdw-bot` except `.env` and `data/`, then
`npm install --omit=dev` and `sudo systemctl restart rsdw-bot`.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Bot status stays 🔴 offline | `curl` from step 6 works? Same `API_URL` port and `API_TOKEN` as `settings.ini`? |
| `API rejected the bearer token` in the bot log | `API_TOKEN` doesn't match `BearerToken` |
| Bot online but ignores `!` commands | Message Content Intent (step 1), `ALLOWED_CHANNELS`, the bot can see the channel |
| No reactions on replies | the bot needs *Add Reactions* and *Read Message History* |
| `Discord login failed` | `DISCORD_TOKEN` wrong or reset |
| No chat in Discord | `CHAT_CHANNEL_ID` set? `Chat: ... not found` in `api.log` means the game patch moved something |
| `Failed to bind on 0.0.0.0:8080` in `api.log` | step 4 - something else holds the port |
| Levels look wrong | compare with in-game; the table is in `bot/src/levels.js` |
