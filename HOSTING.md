<div align="center">

# 🏢 RSDWServerAPI for game hosts

**Offer your _RuneScape: Dragonwilds_ customers a server that's alive in Discord.**

[**← README**](README.md) · [**The mod & API**](MOD.md) · [**The bot**](bot/README.md) · [**Contact**](#-lets-work-together)

</div>

---

## What it is

Two parts, both MIT licensed:

| Part | What it is | Footprint |
| ---- | ---------- | --------- |
| **The mod** · `librsdwapi.so` | A shared library loaded into the Linux dedicated server with `LD_PRELOAD`. It reads players, skills, quests, kills, chat and more from the game's memory and serves them on a small REST API with an event feed. It adds admin features too: bans that persist, an AFK kick and item give. | About 3% of one core, a few MB of RAM. Nothing is hooked on the game thread. |
| **The Discord bot** · `bot/` | A Node.js 20+ app that talks to that API. It gives the customer's Discord live leaderboards, two-way chat, a status board, death and level-up feeds, raid alerts and admin commands. | About 110 MB of RAM, next to nothing in CPU. |

Players install nothing. Customers get a feature their own Discord shows off every day, which is
the kind of thing people tell their friends about.

## Fitting it into a panel (Pterodactyl, Pelican and similar)

### The mod: three lines in the egg

1. **Install script**: download the ready-made build from the latest release. It's built on glibc
   2.28, the same as the game server needs, so it runs in any image the game runs in:

   ```bash
   curl -fsSL -o /mnt/server/librsdwapi.so \
     https://github.com/joaopmsilva/RSDWServerAPI/releases/latest/download/librsdwapi.so
   ```

2. **Startup command**: preload it (it stays inert in every process except the game server itself):

   ```bash
   LD_PRELOAD=/home/container/librsdwapi.so RSDWAPI_DIR=/home/container/rsdwapi \
     ./RSDragonwildsServer.sh -log -port={{SERVER_PORT}}
   ```

3. **Settings**: the mod writes `rsdwapi/settings.ini` on first start, with a random API token. To
   set it from the panel instead, write the file in the install script:

   ```ini
   [API]
   Enabled=true
   BindAddress=0.0.0.0
   Port={{API_PORT}}
   BearerToken={{API_TOKEN}}
   IPWhitelist=
   ```

   When the bot runs in the same container, use `BindAddress=127.0.0.1` and no allocation is needed.
   Otherwise give it its own allocation and an `IPWhitelist` of your internal network. Every
   request needs the bearer token either way.

A toggle variable ("Enable RSDWServerAPI") that leaves `LD_PRELOAD` empty turns it all off.

### The bot: pick what suits your platform

| Option | How | Good for |
| ------ | --- | -------- |
| **A. Same container** | Ship `bot/` in the install script (`npm install --omit=dev`) and start it in the background from the startup command, before the server. Settings come from environment variables. | The simplest product: one server, one toggle |
| **B. Its own server** | A second, small "Node.js" server in the panel with `API_URL=http://<game ip>:<api port>` and the same token. | Keeping the game container untouched |
| **C. Add-on** | B, sold or bundled as an add-on to the game server. | Upselling |

The bot only needs a few settings from the customer, all as environment variables (every one is
in [CONFIG.md](bot/CONFIG.md)):

| Variable | |
| -------- | - |
| `DISCORD_TOKEN` | Their bot's token |
| `ADMIN_USER_IDS` | Their Discord user ID |
| `API_URL`, `API_TOKEN` | Where the mod's API is, and its token (you fill these in) |
| `SERVER_NAME`, `CONNECT_ADDRESS`, `WORLD_NAME` | Shown on the status board (you can fill these in) |

With no channel IDs set, the bot **makes its own channels** in the customer's Discord the moment
it's invited, so there's nothing else for them to configure. Its data lives in `bot/data/`.

### What works differently on a panel

Some admin features drive the machine directly, which on a panel is your job:

| Feature | On a VPS (`install.sh`) | On a panel today | Planned |
| ------- | ----------------------- | ---------------- | ------- |
| `/server start / stop / restart` | systemd | not available | through the panel's client API |
| Backups, `/server backup` | cron + script | the panel's own backups | through the panel's client API |
| Game updates | steamcmd, by the bot | the panel (update on restart) | no change needed |
| Crash reports | systemd journal | the game's own log only | panel console log |
| Bot and mod updates | DM with an **Update now** button | the bot updates itself; the mod on the next reinstall | an install-script variable to pin a version |

Everything players see (leaderboards, chat, feeds, the status board, alerts) works the same.

## Roadmap for hosts

What I plan to add to make this a drop-in for hosts. Your input decides the order:

1. **A ready-made egg** for Pterodactyl and Pelican with the mod and bot built in, and variables for
   everything above.
2. **Panel control**: `/server` and backups through the Pterodactyl / Pelican client API, with a
   per-server API key, so customers keep full control from Discord.
3. **Settings from environment variables** for the mod too (`RSDWAPI_TOKEN`, `RSDWAPI_PORT`), so no
   file needs writing.
4. **A container image for the bot**, for platforms that prefer one.
5. **Pinned versions**: a variable to stay on a tested release until you roll out the next.

## 🤝 Let's work together

I'm happy to help you set it up, adapt it to your platform, or build any of the above with you.
Feedback from real deployments is the most useful thing there is.

- **Discord**: [joaosilvajs](https://discord.com/users/169180385501118485) (DMs open)
- **GitHub**: [issues](https://github.com/joaopmsilva/RSDWServerAPI/issues) and pull requests

The license is MIT: you can use and ship it commercially. A link back to the project in your
docs or control panel is appreciated.

<sub>Not affiliated with Jagex. <i>RuneScape: Dragonwilds</i> is a trademark of Jagex Ltd.</sub>
