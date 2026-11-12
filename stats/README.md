# 📊 Install counter

How we know how many servers run the bot. Each bot (0.17.0+) sends one ping a day
to this small service; it keeps the latest ping per install and a count per day.

## What a bot sends

```json
{ "id": "random uuid made on that machine", "bot": "0.17.0", "mod": "0.10.1",
  "game": "<steam build id>", "os": "ubuntu-24.04", "node": "22",
  "maxPlayers": 6, "autoUpdate": false }
```

That's all: nothing about the server's name, its Discord or its players, and no IP
addresses are stored. Server owners turn it off with `BOT_TELEMETRY=false` in the
bot's `.env` (see [bot/src/telemetry.js](../bot/src/telemetry.js)).

## Endpoints

| | |
| - | - |
| `POST /v1/ping` | From the bots. 2 KB max, 30 per hour per IP, unknown fields dropped. |
| `GET /v1/badge` | A [shields.io endpoint](https://shields.io/badges/endpoint-badge) badge: servers active in the last 7 days. |
| `GET /v1/stats` | Active in the last day, week and month, versions, OS, and the daily count. Needs `Authorization: Bearer <STATS_TOKEN>`. |

## Setting it up

On the VPS, from a checkout of this repo:

```bash
sudo bash stats/setup.sh your-name.duckdns.org
```

It runs `server.js` as the `rsdw-stats` user on `127.0.0.1:8090` (systemd unit
`rsdw-stats`), with Caddy in front for HTTPS, and opens 80 and 443 in ufw. The data is
in `/var/lib/rsdw-stats/installs.json` and the token in `/etc/rsdw-stats.env`.
Running it again updates `server.js` and keeps both.

Reading the numbers:

```bash
curl -s -H "Authorization: Bearer $(sudo sed -n 's/^STATS_TOKEN=//p' /etc/rsdw-stats.env)" http://127.0.0.1:8090/v1/stats
```
