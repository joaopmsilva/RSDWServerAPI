<div align="center">

# 🔧 RSDWServerAPI · the mod

**The server side: `librsdwapi.so`, its settings, the REST API, RCON and the in-game commands.**

[**← Back to the README**](README.md) · [**Discord bot**](bot/README.md) · [**Setup guide**](DEPLOY.md) · [**For game hosts**](HOSTING.md)

</div>

> [!TIP]
> You don't need any of this to run a server: [`install.sh`](README.md#-quick-start) builds, installs
> and configures the mod for you. This page is for the curious, for other tools that want to use
> the API, and for game hosts.

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

No compiler? Every [release](https://github.com/joaopmsilva/RSDWServerAPI/releases/latest) has a
ready-made `librsdwapi.so`, built on glibc 2.28 (the same the game server needs), so it loads on
any Linux the game runs on.

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

