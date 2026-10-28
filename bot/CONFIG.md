# ⚙️ Bot settings

Every setting the bot reads from `bot/.env`. Copy [`.env.example`](.env.example) to `.env` to
start; only the four marked **required** are needed, and everything else has a sensible default.

After changing `.env`, restart the bot: `sudo systemctl restart rsdw-bot`.

> [!WARNING]
> `.env` holds your bot token, API token and server password. Keep it on the VPS only - it is
> gitignored, so it never ends up in the repo.

**Getting IDs:** in Discord, *Settings → Advanced → Developer Mode*, then right-click a channel,
role or user and pick *Copy ID*.

**On/off settings** take `true` or `false` (`1`/`0`, `yes`/`no`, `on`/`off` work too).

[**Connection**](#-connection) · [**General**](#-general) · [**Channels**](#-channels) ·
[**Chat**](#-chat) · [**Notices & activity**](#-notices--activity) · [**Status board**](#-status-board) ·
[**Admin**](#%EF%B8%8F-admin) · [**Game updates**](#-game-updates) · [**Misc**](#-misc) · [**Example**](#-a-full-example)

---

## 🔌 Connection

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `DISCORD_TOKEN` | **required** | The bot's login. Discord developer portal → your application → *Bot* → *Reset Token*. Anyone with it controls the bot - if it leaks, reset it. |
| `API_URL` | `http://127.0.0.1:8080` | Where the mod's REST API listens. The bot runs on the same machine as the game server, so this is localhost; change the port if you changed `Port` in the mod's `settings.ini`. |
| `API_TOKEN` | **required** | `BearerToken` from `rsdwapi/settings.ini`. The mod refuses requests without it. |

## 🧭 General

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `SERVER_NAME` | `Dragonwilds Server` | Your server's name in `/status`, `/help`, server notices and the status board. |
| `MAX_PLAYERS` | `0` | Your server's player limit, shown as *3/16 players*. `0` shows just the count. |
| `POLL_SECONDS` | `30` | How often the bot checks the server and records everyone's stats. Lower means fresher numbers and level-ups sooner; minimum `10`. |
| `ALLOWED_CHANNELS` | *(empty)* | Comma-separated channel IDs where the player commands work. Empty allows every channel. Admin commands work everywhere. |

## 📺 Channels

Anything left empty falls back to `CHAT_CHANNEL_ID`.

| Setting | Default | What goes there |
| ------- | ------- | --------------- |
| `CHAT_CHANNEL_ID` | **required**\* | The game's chat both ways, plus joins, leaves and AFK kicks. Empty turns chat off in both directions. |
| `DEATH_CHANNEL_ID` | chat channel | 💀 Player deaths. |
| `LEVELUP_CHANNEL_ID` | chat channel | 🎉 Level-ups and ⭐ 99s - nothing else. |
| `STATUS_CHANNEL_ID` | chat channel | 🟢🔴 Server online / offline / restarting, planned restarts and backups. |
| `SUMMARY_CHANNEL_ID` | chat channel | 📅 The Sunday weekly recap. |
| `COMMANDS_CHANNEL_ID` | chat channel | 📋 The pinned list of commands - see `COMMANDS_POST`. Changing it moves the list and removes the old copy. |
| `LINK_CHANNEL_ID` | *(off)* | 🔗 The pinned card with the **Link my character** button. `node src/setup-link-channel.js` makes the channel. `/link` works everywhere either way. |
| `STATUS_BOARD_CHANNEL_ID` | *(off)* | The live status board - see [Status board](#-status-board). This one has no fallback: empty turns the board off. |

\* Not strictly needed to start, but almost everything is posted there.

The bot needs *View Channel*, *Send Messages*, *Embed Links* and *Read Message History* in each one.

## 💬 Chat

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `RELAY_SECONDS` | `3` | How often to check for new chat and deaths. Only used with mods older than 0.4.0 - newer ones push events the moment they happen. |
| `BRIDGE_TO_GAME` | `true` | Send messages typed in the chat channel into the game. `false` makes chat one way, game → Discord. |
| `BRIDGE_ROLE_ID` | *(empty)* | Only members with this role can talk into the game. Empty lets everyone. |
| `BRIDGE_PREFIX` | `Discord` | The tag in front of Discord messages in game: players see `[Discord] Sam: on my way!`. |
| `BRIDGE_MAX_LENGTH` | `200` | Longer Discord messages are cut to this many characters in game (minimum `20`). |

## 📣 Notices & activity

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `SERVER_NOTICES` | `true` | Online / offline / restarting, planned restart and backup notices in the status channel. The bot's own Discord status (🟢 3/16 online) shows either way. |
| `BACKUP_NOTICES` | `true` | The *Backup complete* notice after each backup. `false` keeps the hourly ones quiet - backups still run. |
| `LEVELUP_NOTICES` | `true` | Post level-ups and 99s. |
| `LEVELUP_MIN_LEVEL` | `10` | Level-ups below this are quiet - the first levels come every few seconds. 99s are always posted. Minimum `2`. |
| `JOIN_LEAVE_NOTICES` | `true` | *Tobin joined the server* and *Tobin left · played 1h 20m* in the chat channel. |
| `WEEKLY_SUMMARY` | `true` | The recap every Sunday from 20:00 (VPS time): top gainers, new 99s, most played, deaths. |
| `RAID_ALERTS` | `true` | Raid and hunt DMs for linked players who turn them on (mod 0.6.0+). `false` turns them off for everyone. |
| `COMMANDS_CLEANUP_MINUTES` | `5` | When the command list has a channel of its own, delete everything else there this often (messages from the last minute wait a round). `0` turns it off. Needs *Manage Messages*. |
| `CLIENT_MOD_ZIP` | `RSDW-ChestLink-3x-Installer.zip` | A players' installer in `data/` (or a path). When the file is there, it's pinned in the commands channel with install steps, and the command list points to it. Replacing the file updates the pinned copy on the next bot start. Pairs with the mod's `[Game] LinkedStorageRadius`. |
| `COMMANDS_POST` | `true` | Post the list of every command once, and pin it if the bot has *Pin Messages*. When the commands change in an update, the same message is edited. If you delete it, it stays gone - delete `data/commands-post.json` and restart the bot to post it again. |

## 📌 Status board

One message in `STATUS_BOARD_CHANNEL_ID` that keeps itself up to date. Leave any of these empty
to keep it off the board.

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `CONNECT_ADDRESS` | *(empty)* | Direct connect address, e.g. `203.0.113.10:7777`. |
| `WORLD_NAME` | *(empty)* | The world's name in the server list. |
| `WORLD_CREATOR` | *(empty)* | Who created it, shown as *find Ashenvale by HostName*. |
| `SERVER_PASSWORD` | *(empty)* | The join password, hidden behind a spoiler. Anyone in the channel can click it, so only set it if they should know it. |
| `DAILY_RESTART` | *(empty)* | When the server restarts each day, shown as written - e.g. `05:00` or `05:00 (UTC+1)`. |
| `BOARD_SHOW_VPS` | `true` | Show the VPS's CPU and RAM on the board. |

## 🛡️ Admin

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `ADMIN_USER_IDS` | *(nobody)* | Comma-separated Discord user IDs allowed to use `/server` and `/admin`, and who get private alerts. Empty means nobody can. |
| `SERVER_SERVICE` | `dragonwilds` | The game server's systemd service, for `/server start`, `stop`, `restart`, `restore` and `update`. |
| `BACKUP_SCRIPT` | `/home/dragonwilds/scripts/backup.sh` | What `/server backup` runs. |
| `BACKUP_DIR` | `/home/dragonwilds/backups` | Where the backups are, for `/server backups` and `/server restore`. |
| `SAVE_DIR` | `/home/dragonwilds/rs_server/RSDragonwilds/Saved/SaveGames` | Where the world's `.sav` files are - what `/server restore` replaces and `/admin save` checks. |
| `SAVE_FUNCTION` | *(empty)* | The game function that saves the world, called before every backup (mod 0.4.0+). Find it with `/admin save`: it lists the candidates and tells you which one really updates the save files. Empty skips saving first. |
| `ADMIN_ALERTS` | `true` | Private messages to the admins when the server crashes (not planned restarts), the mod's self-check fails (usually after a game update), or the VPS runs hot. |
| `ALERT_CPU` | `90` | CPU % that triggers an alert. `0` turns this one off. |
| `ALERT_RAM` | `90` | RAM % that triggers an alert. `0` turns this one off. |
| `ALERT_DISK` | `90` | Disk % that triggers an alert. `0` turns this one off. |

## 🆕 Game updates

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `UPDATE_WATCH` | `true` | Check Steam for a new build of the dedicated server. When the installed one is out of date, a *⚠️ Server is out of date* notice goes to the status channel, once per build. |
| `UPDATE_CHECK_MINUTES` | `15` | How often to check (minimum `5`). |
| `AUTO_UPDATE` | `true` | After the notice, update by itself: back up (saving the world first), stop, update with steamcmd, start. Players in game get a warning, and `/server cancel` stops it - the daily update then takes care of it. Each build is tried once, so a failed or cancelled update isn't retried in a loop. A stopped server isn't started for this; the notice says to use `/server update`. `false` only warns. |
| `AUTO_UPDATE_MINUTES` | `20` | How long players get before the update. With nobody online it goes after a minute. |
| `STEAM_APP_ID` | `4019830` | The dedicated server's Steam app. |
| `SERVER_DIR` | `/home/dragonwilds/rs_server` | Where the server is installed. The installed build is read from `steamapps/appmanifest_<app>.acf` there; without it the watcher stays off. |
| `STEAMCMD` | `/home/dragonwilds/steamcmd/steamcmd.sh` | steamcmd, run as the bot's user. |

The latest build comes from [api.steamcmd.net](https://api.steamcmd.net), or from steamcmd itself if
that's down.

## 🧰 Misc

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `DATA_DIR` | `bot/data` | Where player stats, history, the chat position, the status board and command list messages, the update watcher's state, the item list and `bot.log` are kept. A relative path is relative to `bot/`. |
| `DEBUG` | `false` | Log extra detail: presence updates, relay batches, undelivered chat. |

---

## 📝 A full example

Placeholders throughout - put your own values in.

```ini
# --- Connection ---
DISCORD_TOKEN=your-bot-token
API_URL=http://127.0.0.1:8080
API_TOKEN=bearer-token-from-settings.ini

# --- General ---
SERVER_NAME=The Hut
MAX_PLAYERS=16
POLL_SECONDS=15
ALLOWED_CHANNELS=

# --- Channels ---
CHAT_CHANNEL_ID=111111111111111111
DEATH_CHANNEL_ID=
LEVELUP_CHANNEL_ID=222222222222222222
STATUS_CHANNEL_ID=
SUMMARY_CHANNEL_ID=
COMMANDS_CHANNEL_ID=
LINK_CHANNEL_ID=
STATUS_BOARD_CHANNEL_ID=333333333333333333

# --- Chat ---
RELAY_SECONDS=3
BRIDGE_TO_GAME=true
BRIDGE_ROLE_ID=
BRIDGE_PREFIX=Discord
BRIDGE_MAX_LENGTH=200

# --- Notices & activity ---
SERVER_NOTICES=true
BACKUP_NOTICES=false
LEVELUP_NOTICES=true
LEVELUP_MIN_LEVEL=10
JOIN_LEAVE_NOTICES=true
WEEKLY_SUMMARY=true
RAID_ALERTS=true
COMMANDS_POST=true

# --- Status board ---
CONNECT_ADDRESS=203.0.113.10:7777
WORLD_NAME=Ashenvale
WORLD_CREATOR=HostName
SERVER_PASSWORD=
DAILY_RESTART=05:00
BOARD_SHOW_VPS=true

# --- Admin ---
ADMIN_USER_IDS=444444444444444444
SERVER_SERVICE=dragonwilds
BACKUP_SCRIPT=/home/dragonwilds/scripts/backup.sh
BACKUP_DIR=/home/dragonwilds/backups
SAVE_DIR=/home/dragonwilds/rs_server/RSDragonwilds/Saved/SaveGames
SAVE_FUNCTION=
ADMIN_ALERTS=true
ALERT_CPU=90
ALERT_RAM=90
ALERT_DISK=90

# --- Game updates ---
UPDATE_WATCH=true
UPDATE_CHECK_MINUTES=15
AUTO_UPDATE=true
AUTO_UPDATE_MINUTES=20
STEAM_APP_ID=4019830
SERVER_DIR=/home/dragonwilds/rs_server
STEAMCMD=/home/dragonwilds/steamcmd/steamcmd.sh

# --- Misc ---
DATA_DIR=
DEBUG=false
```
