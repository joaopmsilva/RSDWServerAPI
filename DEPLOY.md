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
   *Manage Messages* is optional but makes the ◀️ ▶️ page arrows smoother. To re-invite with
   the right permissions: **OAuth2 → URL Generator**, scopes `bot` **and**
   `applications.commands` (needed for the slash commands), tick those permissions, open the
   URL. Re-inviting over the existing bot keeps its roles.
4. In Discord, **User Settings → Advanced → Developer Mode** on. Right-click the channel for
   in-game chat → **Copy Channel ID**, and the same for deaths and server notices if you want
   them in separate channels.

## 2. Copy the project to the VPS

From PowerShell on your PC, in the folder that contains `RSDWServerAPI` (replace `USER` and
`VPS_IP`). After the first time, `deploy\upload.ps1` does this for you - see [Updating](#updating).

```powershell
cd path\to\folder-containing-RSDWServerAPI
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

- `RSDWRestAPI 0.4.0 loaded`
- `RSDWRestAPI: engine ready, endpoints are live`
- `Events: chat and death feed live at /api/events`

and **no** `Failed to bind` or `... not found` lines.

Test the API (the token is `BearerToken` in `settings.ini`):

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/health
curl -H "Authorization: Bearer YOUR_TOKEN" http://127.0.0.1:8080/api/players
```

`health` should say `"engineReady":true`.

If there is no `0.4.0 loaded` line at all, add `RSDWAPI_FORCE=1` before `LD_PRELOAD=` in the
start command and restart.

**Run it as a service.** `/server` in Discord and the cron scripts start and stop the server
through a systemd service called `dragonwilds`. If you don't have one yet,
[`deploy/dragonwilds.service`](deploy/dragonwilds.service) is ready to use - check the paths,
then:

```bash
sudo cp ~/RSDWServerAPI/deploy/dragonwilds.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dragonwilds
```

From then on use `sudo systemctl start|stop|restart dragonwilds`, and `journalctl -u dragonwilds`
for the server's own output.

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
say something in game chat to check it shows up in Discord, and type in
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

## 10. Optional: backups and a daily update from cron

The bot sees by itself when the server goes offline, restarts and comes back. Backups and
planned restarts it can't see, so scripts announce them. Two ready-made scripts are in
[`bot/deploy/scripts/`](bot/deploy/scripts/) - check the paths at the top of each:

- `backup.sh` copies the world saves with a timestamp, keeps the newest 10, and posts
  "💾 Backup complete" (`BACKUP_NOTICES=false` in the bot's `.env` keeps that quiet).
- `update-and-restart.sh` warns on Discord and in game 5 minutes before (and in game again 1
  minute before), stops the server, updates it with steamcmd and starts it again. Once it's
  back the bot posts "🟢 Server is online - Restart complete". `WARN_MINUTES=0` skips the
  wait. It stops and starts the `dragonwilds` service with `sudo`, so it needs the sudoers line
  from step 11.

```bash
mkdir -p /home/dragonwilds/scripts && cd /home/dragonwilds/scripts
cp /home/dragonwilds/rsdw-bot/deploy/scripts/*.sh .
chmod +x *.sh
crontab -e
```

and add, for an hourly backup and an update at 05:00 every day:

```cron
0 * * * * /home/dragonwilds/scripts/backup.sh
0 5 * * * /home/dragonwilds/scripts/update-and-restart.sh
```

Both scripts call `/usr/bin/node`; if `which node` says otherwise, change `ANNOUNCE=` at the
top of each. To test the notices without waiting for cron:

```bash
/usr/bin/node /home/dragonwilds/rsdw-bot/src/announce.js say "Testing notices"
```

## 11. Admin commands

### In game

The mod's `/kick`, `/ban`, `/unban`, `/give` and `/help` chat commands work for whoever the
game itself treats as an admin: open **Server Management** in game and enter the server's
admin password. Replies only reach you once mod 0.2.1 or newer is loaded.

### On Discord

`/server` (start, stop, restart, cancel) and `/admin` (kick, ban, unban, say) only work for
the Discord users listed in `ADMIN_USER_IDS`, and are hidden from members without the
Administrator permission. Replies are only visible to you.

1. In Discord, with Developer Mode on, right-click your own name → **Copy User ID**.
2. Put it in the bot's `.env` (several IDs: separate them with commas):

   ```bash
   sudo nano /home/dragonwilds/rsdw-bot/.env
   ```

   ```
   ADMIN_USER_IDS=123456789012345678
   ```

3. Let the bot's user start, stop and restart the game server, and nothing else:

   ```bash
   echo 'dragonwilds ALL=(root) NOPASSWD: /bin/systemctl start dragonwilds, /bin/systemctl stop dragonwilds, /bin/systemctl restart dragonwilds' | sudo tee /etc/sudoers.d/rsdw-bot
   sudo chmod 440 /etc/sudoers.d/rsdw-bot
   sudo visudo -c
   ```

   `visudo -c` must say the files are parsed OK. If the server's service isn't called
   `dragonwilds`, change it in that line and set `SERVER_SERVICE=` in `.env`.

4. `sudo systemctl restart rsdw-bot`

`/server restart` and `/server stop` warn players in game and in the status channel first:
by default 2 minutes ahead when someone is online and straight away when nobody is, or pick
`minutes` (0-10). In game there's a second warning a minute before. `/server cancel` calls a
planned one off. A planned restart or stop is forgotten if the bot itself restarts.

`/server backup` runs `BACKUP_SCRIPT` (your `backup.sh`) straight away. With `ADMIN_USER_IDS` set
you also get private alerts for crashes, a failing mod self-check and a VPS running hot - make
sure your Discord privacy settings allow messages from server members.

## 12. Optional: status board, saving before backups, AFK kick

**Status board.** Make a channel (read-only for members works best), give the bot *View Channel*,
*Send Messages*, *Embed Links* and *Read Message History* there, and add to the bot's `.env`:

```
STATUS_BOARD_CHANNEL_ID=123456789012345678
CONNECT_ADDRESS=your.ip.address:7777
WORLD_NAME=YourWorld
WORLD_CREATOR=YourName
SERVER_PASSWORD=yourpassword
DAILY_RESTART=05:00
```

The password shows behind a spoiler; leave any line out to hide it. Restart the bot.

**Save before backups** (mod 0.4.0+). Once someone has been in game since the server started, run
`/admin save` in Discord. It lists the game functions that might save the world; try them with
`/admin save function:…` - the bot tells you which one really updated the save files. Put that one in
the bot's `.env` as `SAVE_FUNCTION=`, restart the bot, and from then on `backup.sh` (the updated one
from step 10) and `/server backup` save the world first.

**AFK kick** (mod 0.4.0+). With the server stopped, set `KickMinutes` under `[AFK]` in
`rsdwapi/settings.ini` (the section appears after the first start with 0.4.0), then start it.

## Updating

Three scripts do the work:

| Script | Runs on | Does |
| ------ | ------- | ---- |
| `deploy\upload.ps1` | your PC | packs the project, uploads it, unpacks it into `~/RSDWServerAPI` on the VPS, and with `-Bot` / `-Mod` runs the two below |
| `deploy/update-bot.sh` | VPS | copies the bot into `/home/dragonwilds/rsdw-bot` (keeping `.env` and `data/`), installs packages, restarts it, lists new `.env` settings |
| `deploy/update-mod.sh` | VPS | builds the mod and swaps it in for the next server start |

The bot is separate from the game server, so updating it never needs a server restart.
The mod is loaded when the server starts, so a new build takes effect at the next restart -
a daily one from cron (step 10), `/server restart`, or straight away with `-Restart`.

### One-time: log in with a key instead of a password

So the scripts don't ask for your password (twice) every time. In PowerShell:

```powershell
ssh-keygen -t ed25519
```

Press Enter at every question. Then copy the key to the VPS (this asks for the password one
last time):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh USER@VPS_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

`ssh USER@VPS_IP` should now log in without asking. Windows may block running downloaded
scripts; allow your own with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, once.

### Every update

Tell the script where your server is, once - one line, git ignores the file:

```powershell
"USER@VPS_IP" | Set-Content deploy\vps.txt
```

Then from PowerShell, in the project folder:

```powershell
cd path\to\RSDWServerAPI
.\deploy\upload.ps1 -Bot          # bot changes: live in a few seconds
.\deploy\upload.ps1 -Mod          # mod changes: built now, loaded at the next server restart
.\deploy\upload.ps1 -Bot -Mod     # both
.\deploy\upload.ps1 -Mod -Restart # mod now: build, warn players, restart in 2 minutes
```

A new mod only loads when the server starts. Without `-Restart` that's your next restart; you
can also restart any time with `/server restart` in Discord. `-Target USER@VPS_IP` overrides
`vps.txt` for one run.

The scripts assume the layout at the top of this guide and that your SSH user can `sudo`. If
your paths differ, change the variables at the top of `deploy/update-bot.sh` and
`deploy/update-mod.sh`.

On the VPS, after uploading, the mod script also takes:

```bash
~/RSDWServerAPI/deploy/update-mod.sh --restart    # build, warn players, restart in 2 minutes
~/RSDWServerAPI/deploy/update-mod.sh --rollback   # put the previous mod back for the next start
```

`update-mod.sh` never overwrites the mod the server is running: it copies the new build next
to it and renames it over, and keeps the previous one as `librsdwapi.so.old`. Don't `cp` a
new build straight onto `librsdwapi.so` while the server runs - that can crash it.

If `update-bot.sh` says the cron scripts differ, copy them over as in step 10.

## Troubleshooting

| Symptom | Check |
| ------- | ----- |
| Bot status stays 🔴 offline | `curl` from step 6 works? Same `API_URL` port and `API_TOKEN` as `settings.ini`? |
| `API rejected the bearer token` in the bot log | `API_TOKEN` doesn't match `BearerToken` |
| Nothing appears when typing `/` | re-invite with `applications.commands` (step 1), then reload Discord (Ctrl+R) |
| `/` commands answer "Commands work in ..." | `ALLOWED_CHANNELS` |
| Discord messages don't reach the game | Message Content Intent (step 1), `CHAT_CHANNEL_ID`, `BRIDGE_ROLE_ID`; 💤 on the message means nobody is online |
| `/server` says "a password is required" | the sudoers line in step 11 |
| `/server` and `/admin` not in the list | they only show for members with Administrator; your ID must be in `ADMIN_USER_IDS` to use them |
| No server notices | `STATUS_CHANNEL_ID` or `CHAT_CHANNEL_ID` set, `SERVER_NOTICES` not false |
| No ◀️ ▶️ on long lists | the bot needs *Add Reactions* and *Read Message History* |
| `Discord login failed` | `DISCORD_TOKEN` wrong or reset |
| No chat in Discord | `CHAT_CHANNEL_ID` set? `Chat: ... not found` in `api.log` means the game patch moved something |
| `Failed to bind on 0.0.0.0:8080` in `api.log` | step 4 - something else holds the port |
| Levels look wrong | compare with in-game; the table is in `bot/src/levels.js` |
