# RSDWServerAPI

A server management API for **RuneScape: Dragonwilds** dedicated servers on Linux, plus a
Discord bot that uses it.

- **The mod** (`librsdwapi.so`) is preloaded into the server. It adds a REST API and an
  optional Source RCON listener, so you can see who is connected, read their live stats,
  kick, ban, give items and broadcast - and it records in-game chat and deaths for the bot.
- **The bot** ([bot/](bot/)) answers `!levels`, `!level`, `!status` and `!online` in Discord
  with navigable embeds, shows the server's state and player count as its status, and relays
  chat and deaths to channels of your choice.

**Setting it all up on a VPS: see [DEPLOY.md](DEPLOY.md).**

## Features

- **Live player data** - names, character names, SteamID64, character GUID, ping,
  position, rotation, velocity, health, sustenance, hydration, skills and every float
  attribute the character carries.
- **Remote kick** through the game's own kick function, persistent until the server
  restarts, exactly like an in-game kick.
- **Broadcast** to all players through the game's own chat.
- **Give items** through the game's own give function.
- **Bans** that survive restarts, with offline players bannable by SteamID64.
- **In-game admin commands** - `/kick`, `/ban`, `/unban`, `/give`, gated by the game's
  own owner and admin list.
- **Chat and death feed** at `/api/events`, which the Discord bot relays.
- **Two independent listeners** - REST and Source RCON, each switchable on its own.
- **Access control on both** - bearer token or RCON password, IP whitelisting, per-address
  rate limiting and automatic blocking after repeated failed logins.
- **Offsets validated at runtime.** Every discovery step is checked and cross-checked
  before anything is read, and a mismatch after a game patch degrades to a `503` and a log
  line rather than serving nonsense.

## Build

On the Linux machine that runs the server:

```bash
sudo apt install -y build-essential
make -j"$(nproc)"
```

Output: `dist/librsdwapi.so`. `libstdc++` and `libgcc` are linked statically, and building on
the server's own machine means the result never needs a newer glibc than it has.
`make clean` removes the build output.

## Install

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
starts inside the server itself. If it ever fails to recognise the server (no `loaded` line
in the log), add `RSDWAPI_FORCE=1` next to `LD_PRELOAD`.

## Configuration

On first run the mod writes `rsdwapi/settings.ini` beside the server binary. Set
`RSDWAPI_DIR` to put it somewhere else. The log prints the folder it uses
(`RSDWRestAPI: data directory ...`).

A bearer token and an RCON password are generated on that first run and never regenerated
afterwards, so an empty value stays empty.

**The REST API is on by default. RCON is off by default** - set `Enabled=true` under
`[RCON]` to use it; the password is already generated and waiting.

```ini
[General]
EnableLogging=true
VerboseLogging=true

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
```

When the Discord bot runs on the same machine, set `BindAddress=127.0.0.1` so the API is not
reachable from the internet at all.

Bans are kept in `rsdwapi/bans.json` beside the config and survive restarts.

`IPWhitelist` takes a comma separated list of addresses and CIDR blocks
(`127.0.0.1,10.0.0.0/8`). Empty allows everyone. It applies to both listeners
independently, and an unparseable entry is logged and ignored rather than silently locking
everyone out.

Clearing `BearerToken` disables REST authentication entirely. That is deliberate and it
sticks, but bind to `127.0.0.1` or set an `IPWhitelist` if you do it. A warning is logged
at startup either way.

An empty RCON `Password` keeps RCON from starting at all, by design.

### Logs

`<data dir>/logs/api.log`, rotated on each boot with ten kept, and mirrored to the server's
stdout. It records startup and engine discovery, kicks, bans, deaths, and with
`VerboseLogging=true` every API request and every chat line. The bot's frequent
`/api/events` polls are only logged when they fail.

## REST endpoints

Every request needs `Authorization: Bearer <token>` unless `BearerToken` is empty.

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/hello` | Load check |
| GET | `/api/health` | Mod status and uptime |
| GET | `/api/players` | Every connected player |
| GET | `/api/events` | Chat and death feed |
| POST | `/api/kick` | Disconnect a player |
| POST | `/api/broadcast` | Send a message to every player |
| POST | `/api/give` | Give an item to a player |
| GET | `/api/items` | List loaded items, `?search=` to filter |
| POST | `/api/ban` | Ban a player |
| POST | `/api/unban` | Remove a ban |
| GET | `/api/bans` | List bans |

### GET /api/players

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
    "pointers": { "playerState": "0x...", "pawn": "0x...", "controller": "0x..." }
  }]
}
```

Skills are reported as raw XP. The bot converts XP to levels with the Dragonwilds XP table.

Health and max health come from the character's attributes component, not from
`UHealthComponent`'s own fields - on a player those are always zero, because
`UPlayerHealthComponent` sources both from attributes.

### GET /api/events

In-game chat and player deaths, oldest first. Pass the last `id` you have seen as `?since=`
to get only newer events; `?limit=` caps the count (default 100, max 500). The last 500
events are kept in memory.

```json
{
  "bootId": 1793042710123,
  "latestId": 42,
  "events": [
    { "id": 41, "time": 1793042790000, "type": "chat", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "...", "playerId": 256, "message": "hello", "location": "" },
    { "id": 42, "time": 1793042795000, "type": "death", "name": "Adventurer", "netId": "7656...",
      "characterGuid": "", "playerId": 0, "message": "", "location": "10360, 186410, -3070" }
  ]
}
```

Ids restart at 1 when the server restarts; `bootId` changes at the same time, so a reader
knows to start over from `since=0`.

### POST /api/kick

`player` accepts a SteamID64, player id, character GUID, character name or display name.
They are matched in that order, most stable first.

```bash
curl -X POST http://localhost:8080/api/kick -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"reason\":\"Kicked by an administrator\"}"
```

A kick holds until the server restarts. The kicked player is remembered and removed again
if they reconnect.

### POST /api/broadcast

Sends a line to every connected player's chat box.

```bash
curl -X POST http://localhost:8080/api/broadcast -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"message\":\"Restarting in 5 minutes\"}"
```

`sender` is optional and defaults to `Server`, giving `[Server] Restarting in 5 minutes`.

The game has no server identity in chat, so a broadcast is delivered under the receiving
player's own name. Everyone sees the `[Server]` prefix, but it appears as though they sent
it themselves.

### POST /api/give

```bash
curl -X POST http://localhost:8080/api/give -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"item\":\"IronBar\",\"count\":10}"
```

`item` matches the full asset name (`ITEM_Resources_IronBar`), the name without the `ITEM_`
prefix, or a unique partial like `ironbar`. Only items currently loaded on the server can be
given; `GET /api/items` shows what is available right now. `count` defaults to 1.

### POST /api/ban

```bash
curl -X POST http://localhost:8080/api/ban -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d "{\"player\":\"76561190000000000\",\"reason\":\"Griefing\"}"
```

Kicks the player if online and adds them to `bans.json`. They are removed again whenever
they reconnect. Offline players can be banned by SteamID64. `POST /api/unban` takes the
same `player` field.

### GET /api/health

Deliberately minimal, because authentication can be turned off and this therefore has to be
safe to serve to anyone. No ports, no owner id, no server GUID, no memory addresses.

```json
{"status":"healthy","version":"0.2.0","uptimeSeconds":41.2,"engineReady":true}
```

`status` is `starting` until the world has loaded. Engine discovery detail goes to the log
at startup and to the authenticated RCON `status` command.

## RCON

Standard Valve Source RCON, so `mcrcon`, `rcon-cli` and panel consoles all work. Off by
default.

```bash
mcrcon -H 127.0.0.1 -P 27020 -p PASSWORD players
```

| Command | Description |
| ------- | ----------- |
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
`CommandBurst` is how much can be spent at once. Separately, `MaxFailedAuth` failed logins
inside `FailWindowSeconds` refuse that address for `BanSeconds`, enforced at `accept`
before the password is read.

## In-game commands

Admins can run these from chat. Admin status comes from the game's own owner and admin
list, so anyone who has entered the admin password in the Server Management screen
qualifies. Replies go only to the sender, and the command line itself is never shown to
other players.

| Command | Description |
| ------- | ----------- |
| `/kick <player> [reason]` | Disconnect a player |
| `/ban <player> [reason]` | Ban a player |
| `/unban <player or SteamID64>` | Remove a ban |
| `/give <player> <item> [count]` | Give an item to a player |
| `/help` | List commands |

## SDK

The engine layer is driven by a Dumper-7 dump of the server binary, which is not included
in this repository. Every offset the mod uses carries a `// Source:` comment naming the file
it came from, so they can be re-verified against a fresh dump after a game patch.

## License

Released under the MIT License. See [LICENSE](LICENSE) for the full text.

Based on [dkoz/RSDWServerAPI](https://github.com/dkoz/RSDWServerAPI). This software is
provided as is, without warranty of any kind. Use it at your own risk.
