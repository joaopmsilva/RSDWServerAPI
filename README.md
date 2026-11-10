<div align="center">

# 🐉 RSDWServerAPI

### Your _RuneScape: Dragonwilds_ server, alive in Discord.

**A server mod and a Discord bot for Dragonwilds dedicated servers on Linux.**<br>
Live skills and leaderboards, two-way chat, death and quest feeds, a 🐧 **penguin hunt leaderboard**,
raid alerts, anti-cheese checks and full server control, all from your Discord.

![Mod](https://img.shields.io/badge/mod-v0.10.0-8b5cf6?style=for-the-badge)
![Bot](https://img.shields.io/badge/bot-v0.14.0-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![Game](https://img.shields.io/badge/Dragonwilds-1.0.2-c9a227?style=for-the-badge)
![Linux](https://img.shields.io/badge/Linux-server-FCC624?style=for-the-badge&logo=linux&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)

[**🐧 Penguins**](#-new-in-102-the-penguin-hunt-leaderboard) · [**Features**](#-features) · [**Screenshots**](#-screenshots) · [**How it works**](#-how-it-works) · [**Quick start**](#-quick-start) · [**Discord bot**](bot/README.md) · [**Setup guide**](DEPLOY.md) · [**API**](#-rest-api)

<br>

<img src="bot/docs/screenshots/status-board.png" width="49%" alt="The live status board: online, how to join, who's playing, top XP today">
<img src="bot/docs/screenshots/me.png" width="49%" alt="/me: skills, quests, journal, playtime, kills, deaths and penguins">

</div>

> [!NOTE]
> **No client mod needed.** Everything runs on the server. Players join as usual and the bot does
> the rest. (The optional longer chest range is the one exception, and it ships with a one-click installer.)

---

## 🐧 New in 1.0.2: the penguin hunt leaderboard

<table>
<tr>
<td width="52%" valign="top">

Patch 1.0.2 let **over 200 Killer Gentoo Penguins** loose across Ashenfall. Spot one and interact
with it, and it flees and leaves you a **Penguin Coin** for the new shop in Bramblemead. They come
back in fresh spots every **7 in-game days**.

**Now your server can see who's the best penguin hunter.**

- 🏆 **`/leaderboard penguins`**: everyone ranked by penguins found, with this week's haul
- 🙋 **`/me`**: your own penguin count next to your kills, deaths and playtime
- 🔁 **Fair counting**: each penguin counts **once per character**, so re-reporting after a
  restart or the same penguin twice never inflates a score
- 🕰️ **Catches up**: after the mod loads, it credits penguins already found this cycle

</td>
<td width="48%" valign="top">

<img src="bot/docs/screenshots/penguins.png" alt="/leaderboard penguins: the top penguin hunters with medals and this week's count">

</td>
</tr>
</table>

<details>
<summary><b>🔍 How the penguin tracking works</b></summary>

<br>

The game keeps the hunt on the server. Every penguin is an actor that remembers its **spawn slot**
and a list of the **characters that have collected it** (`CollectedByPlayerIds`). The penguin
system also keeps the time the current cycle ends.

1. Every **10 seconds** while someone is online, the mod walks the penguins on the map and reads
   who has collected each one. It only reads memory: nothing is hooked or called on the game thread.
2. Each new *(penguin, character)* pair goes out on the event feed as a `penguin` event. The
   penguin's id is its **spawn slot plus the cycle**, so it stays the same across restarts and
   changes when the penguins respawn.
3. The bot credits the character, keeping each penguin id once per character. Repeats are ignored.
   Counts live in the bot's history next to kills and deaths, and survive server restarts.

Every field is looked up **by name** in the game's own type information, so game updates that
move things around don't break it. `/api/diagnostics` shows how many penguins are out and how
often they've been collected.

</details>

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🎮 In Discord

- **`/levels`**: any player's skills, live or from when they were last seen
- **`/leaderboard`**: total level, any skill, quests, kills or 🐧 penguins, with 🥇🥈🥉
- **`/me`**: your character's skills, quests, journal, playtime, kills, deaths and penguins
- **`/quests`**: what's **left** on the wiki's quest list, by region, plus your next main quest
- **`/kills`**: creatures killed, and which ones most · **`/perks`**: active skill perks
- **`/gains`**: who gained the most XP today, this week or this month
- **`/playtime`, `/deaths`**: most played, most deaths
- **`/status`**: is it up, who's on, and the world
- **`/item`**: any item with its wiki summary, picture and stats
- **🔗 One-click account linking**: press a button, type a short code in game
- Player and skill names **auto-fill** as you type

</td>
<td width="50%" valign="top">

### 💬 Live in your channels

- **Two-way chat**: game chat in Discord, Discord messages in game
- **Deaths with the cause**: *"killed by the boss Elder Garou"*, *"fell out of the world"*
- **Level-ups** 🎉, ⭐ **99 celebrations** and 📜 **completed quests**
- **Joins and leaves**, with how long they played
- **Raid and hunt alerts** ⚔️, sent by DM to linked players who turn them on
- **Weekly recap** every Sunday: top gainers, new 99s, most played, most deaths
- **Live status board**: one self-updating message with how to join, who's on and top XP today
- **Server notices**: restart warnings, back online, backups
- **Game update watcher**: spots a new Steam build, then backs up, updates and restarts by itself
- The bot's status shows `🟢 3/16 players online`

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🛡️ For admins

- **🧳 Carry-over alerts**: a private DM when a character comes back from another world with
  items, XP or quests it didn't get here, past thresholds lag can't explain
- **📈 `/admin performance`**: tick rate, stalls and their causes, CPU per thread, memory and
  pings, measured on the spot
- **`/server`**: start, stop, restart (with player warnings), back up, list and restore backups
- **`/admin`**: kick, ban, unban, give items, announce, remove a player from the boards
- **Private alerts** for crashes, high CPU, RAM or disk, and anything a game update broke
- **📦 Longer linked-chest range** (3× by default), plus a one-click Windows installer for the
  matching client mod, pinned in Discord
- **AFK kick** with a warning first, optionally only when the server is full
- In-game `/kick`, `/ban`, `/give` for the game's own admins

</td>
<td width="50%" valign="top">

### ⚙️ Under the hood

- **Update-resistant**: fields are found by name in the game's own type information, with
  scanning fallbacks, so a patch that moves things around rarely needs a new build
- **Self-checking**: `/api/diagnostics` says exactly what a game update broke instead of
  serving nonsense, and the bot DMs admins about it
- **Light on the server**: the mod uses about **3% of one core**, and reads memory instead of
  running code on the game thread
- **Events the moment they happen**: chat, joins, deaths, kills and penguins reach Discord instantly
- **REST API** and optional **Source RCON**, each with its own auth, IP whitelist and rate limits
- **Saves the world before every backup**, so a backup is never half-written
- **Bans that survive restarts**, offline players by SteamID64
- **One-command updates** from your PC; the bot updates without touching the server

</td>
</tr>
</table>

---

## 📸 Screenshots

<table>
<tr>
<td width="50%" valign="top">

**🏆 Leaderboards**: total level, any skill, quests, kills, penguins

<img src="bot/docs/screenshots/leaderboard.png" alt="/leaderboard: top players by total level with medals">

</td>
<td width="50%" valign="top">

**📊 `/levels`**: every skill by category, with progress to the next level

<img src="bot/docs/screenshots/levels.png" alt="/levels: a player's skills by category with total level and XP">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**💀 Deaths and 📜 quests**: what killed them, and every quest finished

<img src="bot/docs/screenshots/deaths-quests.png" alt="Death messages with their cause, and quest-complete messages">

</td>
<td width="50%" valign="top">

**🎉 Live activity**: joins, leaves, AFK kicks, level-ups and 99s as they happen

<img src="bot/docs/screenshots/activity.png" alt="Join, level-up, level 99, leave and AFK kick messages">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**📜 `/quests`**: what's left, by region, and where to start next

<img src="bot/docs/screenshots/quests.png" alt="/quests: quests left by region and the next main quest">

</td>
<td width="50%" valign="top">

**⚔️ Kills**: the kill board, and each player's favourite prey

<img src="bot/docs/screenshots/kills.png" alt="/leaderboard kills and /kills">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🧳 Carry-over alert** (admins only): who came back from another world richer

<img src="bot/docs/screenshots/carry-over.png" alt="A carry-over DM: items, skills and quests gained on another server">

</td>
<td width="50%" valign="top">

**📈 `/admin performance`**: is the server keeping up, and if not, why

<img src="bot/docs/screenshots/performance.png" alt="/admin performance: ticks, stalls, CPU, VPS and players">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**⚔️ Raid and hunt alerts**: by DM, for players who turn them on

<img src="bot/docs/screenshots/raid-alerts.png" alt="Raid and hunted alerts with pings, and the raid-over update">

</td>
<td width="50%" valign="top">

**🔗 One-click linking**: a button, a short code typed in game, done

<img src="bot/docs/screenshots/link.png" alt="The link card with buttons, the private code and the confirmation">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**⏱️ Playtime and gains**: who played most, who gained most

<img src="bot/docs/screenshots/stats.png" alt="/playtime and /gains">

</td>
<td width="50%" valign="top">

**📅 Weekly recap**: every Sunday evening

<img src="bot/docs/screenshots/weekly-recap.png" alt="The weekly recap: top XP gainers, new 99s, most played, deaths">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**📦 Longer chest range**: the how-to card, with the installer attached

<img src="bot/docs/screenshots/chest-range.png" alt="The chest range card: download, install, play, remove">

</td>
<td width="50%" valign="top">

**🐉 `/status`** and **🎒 `/item`**: who's on, and any item from the wiki

<img src="bot/docs/screenshots/status.png" alt="/status: online, players and the world">
<img src="bot/docs/screenshots/item.png" alt="/item: an item's wiki summary, picture and stats">

</td>
</tr>
<tr>
<td width="50%" valign="top">

**🏅 Quest board** and **✨ `/perks`**

<img src="bot/docs/screenshots/quest-leaderboard.png" alt="/leaderboard quests">
<img src="bot/docs/screenshots/perks.png" alt="/perks">

</td>
<td width="50%" valign="top">

**🔄 Server notices** and **📖 `/help`**

<img src="bot/docs/screenshots/notices.png" alt="Restart warning and back-online notices">
<img src="bot/docs/screenshots/help.png" alt="/help: the command list">

</td>
</tr>
</table>

<sub>Sample players. Rendered from the bot's own embed code by <a href="bot/docs/screenshots/generate.mjs"><code>bot/docs/screenshots/generate.mjs</code></a>, so they match what the bot posts.</sub>

---

## 🧭 How it works

```mermaid
flowchart LR
    subgraph VPS["🖥️ Your Linux VPS"]
        direction LR
        Game["🐉 Dragonwilds server<br/><sub>+ librsdwapi.so</sub>"]
        API[("REST API<br/><sub>127.0.0.1:8080</sub>")]
        Bot["🤖 Discord bot<br/><sub>Node.js · systemd</sub>"]
        Game --- API
        Bot -- "players, events,<br/>broadcast, kick" --> API
    end
    Bot <-- "slash commands,<br/>chat, notices" --> Discord(["💬 Discord"])
    Players(["🧑‍🤝‍🧑 Players"]) <--> Game
```

| Part | What it is |
| ---- | ---------- |
| **The mod** · `librsdwapi.so` | Loaded into the game server with `LD_PRELOAD`. Reads players, quests, kills and penguins straight from the game's memory and serves them over a local REST API, plus a live event feed (chat, joins, leaves, deaths, kills, penguins). |
| **The bot** · [`bot/`](bot/) | Runs next to the server as its own service and talks to the API. Keeps running while the server is down, and remembers everyone's last known stats. |

Updating the bot never needs a server restart. A new mod build loads at the next server start.

---

## 🚀 Quick start

> [!TIP]
> The step-by-step guide for a plain Steam install on a VPS - Discord setup, building,
> installing, systemd, cron and updating - is in **[DEPLOY.md](DEPLOY.md)**.

#### 📋 You need

| | |
| - | - |
| 🐧 **A Linux server** running the Dragonwilds dedicated server (a manual Steam install is fine; tested on Ubuntu) | 🛠️ `build-essential` to build the mod |
| 🟢 **Node.js 18.17+** for the bot | 🤖 **A Discord application** with a bot token and *Message Content Intent* on |

**1. Build the mod** on the server's machine:

```bash
sudo apt install -y build-essential
make -j"$(nproc)"          # → dist/librsdwapi.so
```

**2. Start the server with it:**

```bash
LD_PRELOAD=/home/dragonwilds/rs_server/librsdwapi.so ./RSDragonwildsServer.sh -log -port=7777
```

**3. Run the bot:**

```bash
cd bot && npm install --omit=dev
cp .env.example .env && nano .env   # Discord token, API token, channel IDs
npm start
```

**4. Update later** with one command from a Windows PC (put `user@your-vps` in `deploy\vps.txt` first):

```powershell
.\deploy\upload.ps1 -Bot -Mod      # add -Restart to load the new mod straight away
```

---

## 🧪 Compatibility

Built against the Dragonwilds **Patch 1.0.2** Linux dedicated server (and working since 1.0). The mod reads the game's
memory, so a game update can move things it depends on. When that happens it says so instead of
guessing: affected endpoints answer `503`, the log names what failed, `/api/diagnostics` (and the
bot's private alert to admins) lists the broken checks, and some lookups fall back to scanning
for where things moved. The bot keeps working with saved data either way.

## 🔐 Security

- Keep the API on `BindAddress=127.0.0.1` when the bot runs on the same machine - nothing else
  needs to reach it.
- Never commit `bot/.env` or `rsdwapi/settings.ini`: they hold the Discord token, the API bearer
  token and the RCON password. Both are git-ignored or outside the repository.
- Admin commands only answer the Discord user IDs in `ADMIN_USER_IDS`, and the bot can only
  start, stop and restart the game service through the narrow sudoers rule in DEPLOY.md.
- If a token leaks, replace it: reset the Discord token in the Developer Portal; for the API, put
  a new long random `BearerToken` (and `Password` for RCON) in `settings.ini` while the server is
  stopped, and the same token in the bot's `API_TOKEN`. Clearing `BearerToken` turns authentication
  off rather than making a new one.

---

## 🔧 Mod details

<details>
<summary><b>Build</b></summary>

<br/>

On the Linux machine that runs the server:

```bash
sudo apt install -y build-essential
make -j"$(nproc)"
```

Output: `dist/librsdwapi.so`. `libstdc++` and `libgcc` are linked statically, and building on the
server's own machine means the result never needs a newer glibc than it has. `make clean`
removes the build output.

</details>

<details>
<summary><b>Install</b></summary>

<br/>

Put `librsdwapi.so` beside the server and prefix whatever starts it with `LD_PRELOAD`:

```bash
LD_PRELOAD=/home/dragonwilds/rs_server/librsdwapi.so ./RSDragonwildsServer.sh -log -port=7777
```

or, starting the binary directly:

```bash
LD_PRELOAD=./librsdwapi.so ./RSDragonwilds/Binaries/Linux/RSDragonwildsServer-Linux-Shipping -log -port=7777
```

`LD_PRELOAD` is inherited by every process the launch command starts, including a wrapper
script's shell and the small commands it runs. The mod stays inert in all of them and only
starts inside the server itself. If it ever fails to recognise the server (no `loaded` line in
the log), add `RSDWAPI_FORCE=1` next to `LD_PRELOAD`.

> [!WARNING]
> Never copy a new build straight over the `librsdwapi.so` a running server has loaded - that
> can crash it. Copy it beside it and rename it over, which is what `deploy/update-mod.sh` does.

</details>

<details>
<summary><b>Configuration</b> · <code>rsdwapi/settings.ini</code></summary>

<br/>

On first run the mod writes `rsdwapi/settings.ini` beside the server binary. Set `RSDWAPI_DIR`
to put it somewhere else. The log prints the folder it uses (`RSDWRestAPI: data directory ...`).

A bearer token and an RCON password are generated on that first run and never regenerated
afterwards, so an empty value stays empty.

**The REST API is on by default. RCON is off by default** - set `Enabled=true` under `[RCON]` to
use it; the password is already generated and waiting.

```ini
[General]
EnableLogging=true
VerboseLogging=true
TickSeconds=3

[API]
Enabled=true
BindAddress=0.0.0.0
Port=8080
BearerToken=<generated>
IPWhitelist=

[RCON]
Enabled=false
BindAddress=0.0.0.0
Port=27020
Password=<generated>
IPWhitelist=
CommandsPerMinute=60
CommandBurst=15
MaxFailedAuth=5
FailWindowSeconds=60
BanSeconds=300
MaxConnections=16

[AFK]
KickMinutes=0
WarnMinutes=1
OnlyWhenFull=false
MaxPlayers=0
ExemptAdmins=true

[Game]
LinkedStorageRadius=0
```

> [!IMPORTANT]
> When the bot runs on the same machine, set `BindAddress=127.0.0.1` so the API isn't
> reachable from the internet at all.

- Bans are kept in `rsdwapi/bans.json` beside the config and survive restarts.
- `IPWhitelist` takes a comma separated list of addresses and CIDR blocks
  (`127.0.0.1,10.0.0.0/8`). Empty allows everyone. It applies to both listeners independently,
  and an unparseable entry is logged and ignored rather than silently locking everyone out.
- Clearing `BearerToken` disables REST authentication entirely. That is deliberate and it
  sticks, but bind to `127.0.0.1` or set an `IPWhitelist` if you do it. A warning is logged at
  startup either way.
- An empty RCON `Password` keeps RCON from starting at all, by design.
- **`TickSeconds`** (mod 0.9.0+) is how often the players are checked - joins, leaves, deaths,
  kills, AFK. Each check reads every object in the game (a few milliseconds), so higher is lighter;
  1 to 30.
- **AFK kick** is off until `KickMinutes` is set. Players who haven't moved or looked around get a
  private warning `WarnMinutes` before, and can rejoin straight away after the kick.
  `OnlyWhenFull=true` (with `MaxPlayers`) only kicks when someone else could use the slot, and the
  game's own admins are never kicked unless `ExemptAdmins=false`.
- **`LinkedStorageRadius`** (mod 0.8.0+) is how far **Linked** chests reach for building and
  crafting, in centimetres. `0` keeps the game's 3000 (30 m). The range is worked out on each
  player's PC, so players need a client mod with the **same** radius, such as
  [ChestLink](https://www.nexusmods.com/runescapedragonwilds/mods/838). The server checks the
  chests a client sends against its own radius and refuses the whole build if one is too far, so
  a client set higher than the server breaks building. The game's own `UserGame.ini` override
  isn't read by the Linux server, which is why the mod writes the value itself. Players without
  the client mod keep 30 m and build normally.

</details>

<details>
<summary><b>Logs</b></summary>

<br/>

`<data dir>/logs/api.log`, rotated on each boot with ten kept, and mirrored to the server's
stdout. It records startup and engine discovery, kicks, bans, joins, leaves and deaths, and with
`VerboseLogging=true` every API request and every chat line. The bot's frequent `/api/events`
polls are only logged when they fail.

</details>

---

## 📡 REST API

Every request needs `Authorization: Bearer <token>` unless `BearerToken` is empty.

| Method | Path | |
| :----: | ---- | - |
| `GET` | `/api/health` | Mod status and uptime |
| `GET` | `/api/players` | Every connected player, with stats, quests, journal and perks |
| `GET` | `/api/world` | World name and settings, running raids and hunts |
| `GET` | `/api/events` | Chat, death, kill, join, leave, AFK and link feed - `?wait=` to be told the moment something happens |
| `GET` | `/api/diagnostics` | Self-check of everything the mod reads |
| `POST` | `/api/save` | Make the game save the world |
| `GET` | `/api/save/candidates` | Functions that might be the game's world save |
| `POST` | `/api/kick` | Disconnect a player |
| `POST` | `/api/broadcast` | Message every player, or one with `to` |
| `POST` | `/api/give` | Give an item to a player |
| `GET` | `/api/items` | Loaded items, `?search=` to filter |
| `POST` | `/api/ban` · `/api/unban` | Ban or unban a player |
| `GET` | `/api/bans` | List bans |
| `GET` | `/api/hello` | Load check |

<details>
<summary><code>GET /api/players</code></summary>

<br/>

Accepts `?name=`, `?characterName=`, `?netId=` and `?characterGuid=` to narrow the list.

```bash
curl -H "Authorization: Bearer TOKEN" http://localhost:8080/api/players
```

```json
{
  "count": 1,
  "players": [{
    "name": "ExamplePlayer",
    "characterName": "Adventurer",
    "playerId": 256,
    "uniqueNetId": "76561190000000000",
    "uniqueNetIdSource": "net-id-string",
    "characterGuid": "00000000000000000000000000000000",
    "platform": "WIN",
    "pingMs": 60,
    "score": 0.0,
    "startTime": 80,
    "isSpectator": false, "isBot": false, "isInactive": false,
    "spawned": true,
    "pawnClass": "BP_PlayerCharacter_C",
    "color": { "hex": "D47247FF", "r": 0.658, "g": 0.168, "b": 0.063, "a": 1.0 },
    "location": { "x": 10360.0, "y": 186410.0, "z": -3070.0 },
    "rotation": { "pitch": 0.0, "yaw": 128.2, "roll": 0.0 },
    "velocity": { "x": 0.0, "y": 0.0, "z": 0.0 },
    "movementMode": 1,
    "health":     { "current": 100.0, "max": 100.0, "canDie": true, "isDead": false },
    "sustenance": { "current": 72.0, "max": 100.0 },
    "hydration":  { "current": 65.0, "max": 100.0 },
    "attributes": [{ "name": "Health", "value": 100.0, "baseValue": 100.0, "shared": false }],
    "skills":     [{ "skill": "SKILL_Woodcutting", "currentXP": 4210 }],
    "quests":     [{ "id": "Quest_CooksAssistant", "name": "Cook's Assistant", "kind": "side", "complete": true, "objective": "" }],
    "journal":    { "total": 142, "kinds": { "lore": 38, "people": 21, "places": 34 } },
    "creatureTypes": 41,
    "perks":      { "max": 6, "active": [{ "id": "PerkV2_Attack_Parry", "name": "Parry", "description": "...", "skill": "SKILL_Attack" }] },
    "pointers": { "playerState": "0x...", "pawn": "0x...", "controller": "0x..." }
  }]
}
```

Skills are reported as raw XP; the bot converts XP to levels with the Dragonwilds XP table.
`quests` lists every quest started or done (`kind` is `main`, `side` or `task`), `journal`
counts unlocked journal entries by kind, `creatureTypes` is how many kinds of creature they have
killed, and `perks` lists the active skill perks. Each is
`null` until the player has fully loaded in.
Health and max health come from the character's attributes component, not from
`UHealthComponent`'s own fields - on a player those are always zero, because
`UPlayerHealthComponent` sources both from attributes.

</details>

<details>
<summary><code>GET /api/events</code></summary>

<br/>

In-game chat, player deaths, joins, leaves, AFK kicks, creature kills and penguins collected, oldest first. Pass the last `id` you have
seen as `?since=` to get only newer events; `?limit=` caps the count (default 100, max 500). The
last 500 events are kept in memory. With `?wait=N` (up to 25) the request is held open until an
event arrives or N seconds pass, so a reader hears about it at once instead of polling.

```json
{
  "bootId": 1793042710123,
  "latestId": 43,
  "events": [
    { "id": 41, "time": 1793042790000, "type": "chat", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "...", "playerId": 256, "message": "hello", "location": "" },
    { "id": 42, "time": 1793042795000, "type": "death", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "", "playerId": 0, "message": "", "location": "10360, 186410, -3070",
      "cause": "", "players": -1 },
    { "id": 43, "time": 1793042799000, "type": "join", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "", "playerId": 0, "message": "", "location": "", "cause": "", "players": 3 },
    { "id": 44, "time": 1793042860000, "type": "penguin", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "52AA01E4...", "playerId": 256, "message": "9F3C21A0...-638991360000000000",
      "location": "", "cause": "BP_Penguin_C", "players": -1 }
  ]
}
```

`cause` on a death says what killed them (`creature`, `player`, `self` or `other`, with the
creature's class or the player's name in `message`). A `kill` has the creature's class in `cause`.
A `penguin` (mod 0.10.0+) is one character collecting one penguin: `characterGuid` is the
character, `message` the penguin's id (its spawn slot and the cycle, the same across restarts) and
`cause` its class. The first scan after a start reports every collection still on the map, so
count each penguin id once per character. `players` on a join or leave is how many are online after it.
Ids restart at 1 when the server restarts; `bootId` changes at the same time, so a reader knows
to start over from `since=0`.

</details>

<details>
<summary><code>GET /api/diagnostics</code></summary>

<br/>

A self-check of what the mod reads from the game, so a game update that moves something shows up
here instead of a feature quietly doing nothing. Each check has `ok` `true`, `false`, or `null`
when it can't be checked yet (most need someone online). The bot messages its admins when a
check starts failing.

```json
{
  "version": "0.3.0",
  "checks": [
    { "name": "engine", "ok": true, "detail": "141532 objects" },
    { "name": "chatComponent", "ok": true, "detail": "at controller +0x12A0 (moved from the SDK's +0x1288, found by scanning)" },
    { "name": "playerSkills", "ok": null, "detail": "checked once someone is online" }
  ]
}
```

</details>

<details>
<summary><code>POST /api/save</code> · <code>GET /api/save/candidates</code></summary>

<br/>

Makes the game save the world - the bot calls it before every backup, so the copy is a finished
save rather than one the game is halfway through writing.

The game's save function has no fixed name, so it's chosen once per game version.
`GET /api/save/candidates` lists every zero-argument function with "save" in its name on a
world-level class; `POST /api/save` calls one on the live object, on the game thread:

```bash
curl -X POST http://localhost:8080/api/save -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"function\":\"SomeGameMode.SaveWorld\"}"
```

Only functions without parameters are called. A successful call only proves the function ran -
the bot's `/admin save` also checks that the `.sav` files changed, which is how you find the right one.

</details>

<details>
<summary><code>POST /api/kick</code></summary>

<br/>

`player` accepts a SteamID64, player id, character GUID, character name or display name, matched
in that order, most stable first.

```bash
curl -X POST http://localhost:8080/api/kick -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"reason\":\"Kicked by an administrator\"}"
```

A kick holds until the server restarts. The kicked player is remembered and removed again if
they reconnect.

</details>

<details>
<summary><code>POST /api/broadcast</code></summary>

<br/>

Sends a line to every connected player's chat box.

```bash
curl -X POST http://localhost:8080/api/broadcast -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"message\":\"Restarting in 5 minutes\"}"
```

`sender` is optional and defaults to `Server`, giving `[Server] Restarting in 5 minutes`. The
game has no server identity in chat, so a broadcast is delivered under the receiving player's
own name: everyone sees the `[Server]` prefix, but it looks as though they sent it themselves.
After a server restart, broadcasts work once the first player has joined.

With `"to"` (a net id, character GUID or name) the line goes to that one player only, and
answers 404 if they aren't connected.

</details>

<details>
<summary><code>GET /api/world</code></summary>

<br/>

```json
{
  "worldName": "WorldOne", "host": "", "difficulty": "normal", "hardcore": "off",
  "time": { "day": 37, "hour": 14.33, "dawn": 6.0, "dusk": 20.0, "isDay": true, "paused": false, "minutesPerDay": 60 },
  "events": [{ "id": "81234-7f...", "type": "raid", "name": "BP_RaidEvent_Goblins_C",
              "location": { "x": 10360.0, "y": 186410.0, "z": -3070.0 }, "radius": 3000.0 }]
}
```

`difficulty` is `normal`, `hard`, `creative` or `custom`; `hardcore` is `off`, `active`,
`failed` or `succeeded`. `time` is `null` until a player has joined since the server started.
`events` lists raids and hunted events while they run; `id` stays the same for as long as one does.

</details>

<details>
<summary><code>POST /api/give</code></summary>

<br/>

```bash
curl -X POST http://localhost:8080/api/give -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"item\":\"IronBar\",\"count\":10}"
```

`item` matches the full asset name (`ITEM_Resources_IronBar`), the name without the `ITEM_`
prefix, or a unique partial like `ironbar`. Only items currently loaded on the server can be
given; `GET /api/items` shows what is available right now. `count` defaults to 1.

</details>

<details>
<summary><code>POST /api/ban</code> · <code>POST /api/unban</code></summary>

<br/>

```bash
curl -X POST http://localhost:8080/api/ban -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"reason\":\"Griefing\"}"
```

Kicks the player if online and adds them to `bans.json`. They are removed again whenever they
reconnect. Offline players can be banned by SteamID64. `POST /api/unban` takes the same `player`
field.

</details>

<details>
<summary><code>GET /api/health</code></summary>

<br/>

Deliberately minimal, because authentication can be turned off and this therefore has to be safe
to serve to anyone. No ports, no owner id, no server GUID, no memory addresses.

```json
{"status":"healthy","version":"0.5.0","uptimeSeconds":41.2,"engineReady":true}
```

`status` is `starting` until the world has loaded. Engine discovery detail goes to the log at
startup and to the authenticated RCON `status` command.

</details>

---

## 🖥️ RCON

Standard Valve Source RCON, so `mcrcon`, `rcon-cli` and panel consoles all work. Off by default.

```bash
mcrcon -H 127.0.0.1 -P 27020 -p PASSWORD players
```

<details>
<summary><b>Commands and rate limits</b></summary>

<br/>

| Command | |
| ------- | - |
| `help` | List commands |
| `health` | Mod and engine readiness in one line |
| `status` | Server identity, world and engine discovery |
| `players [json]` | Player table, or the API payload |
| `playercount` | Number of connected players |
| `player <name>` | Everything known about one player, as JSON |
| `kick <player> [reason]` | Disconnect a player |
| `broadcast <message>` | Send a message to every player |
| `give <player> <item> [count]` | Give an item to a player |
| `items [search]` | List loaded items |
| `ban <player> [reason]` | Ban a player, offline players by SteamID64 |
| `unban <player or SteamID64>` | Remove a ban |
| `bans` | List bans |

Rate limiting is a per-address token bucket: `CommandsPerMinute` is the sustained rate,
`CommandBurst` is how much can be spent at once. Separately, `MaxFailedAuth` failed logins inside
`FailWindowSeconds` refuse that address for `BanSeconds`, enforced at `accept` before the
password is read.

</details>

---

## ⌨️ In-game commands

For the game's own admins - anyone who has entered the admin password in the **Server
Management** screen. Replies go only to the sender, and the command itself is never shown to
other players.

| Command | |
| ------- | - |
| `/kick <player> [reason]` | Disconnect a player |
| `/ban <player> [reason]` | Ban a player |
| `/unban <player or SteamID64>` | Remove a ban |
| `/give <player> <item> [count]` | Give an item to a player |
| `/help` | List commands |

For everyone:

| Command | |
| ------- | - |
| `/link <code>` | Link to a Discord account, with the code from the bot's `/link`. Never shown in chat |

---

## 📚 SDK

The engine layer is driven by a Dumper-7 dump of the server binary, which is not included in this
repository. Every offset the mod uses carries a `// Source:` comment naming the file it came from,
so they can be re-verified against a fresh dump after a game patch - and `/api/diagnostics`
tells you when that's needed.

## 🤝 Contributing

Issues and pull requests are welcome - especially after a game patch. If something stops
working, include the output of `/api/diagnostics` and the start of `rsdwapi/logs/api.log` (the
engine discovery lines), with tokens removed.

## 📄 License

Released under the MIT License - see [LICENSE](LICENSE).

The mod is based on [dkoz/RSDWServerAPI](https://github.com/dkoz/RSDWServerAPI) by Kozejin;
the Discord bot, event feed and the rest were added on top. Not affiliated with Jagex.
*RuneScape: Dragonwilds* is a trademark of Jagex Ltd. Provided as is, without warranty of any
kind - use it at your own risk.
