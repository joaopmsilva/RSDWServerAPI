<div align="center">

# 🤖 RSDW Discord Bot

**Your Dragonwilds server, inside Discord.**

Stats, leaderboards and two-way chat for players · server control and alerts for admins.

![Version](https://img.shields.io/badge/version-0.8.0-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge)
![Node](https://img.shields.io/badge/node-18.17%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)

[**Commands**](#-commands) · [**Status board**](#-status-board) · [**Chat**](#-two-way-chat) · [**Activity**](#-player-activity) · [**Notices**](#-server-notices) · [**Admins**](#%EF%B8%8F-for-admins) · [**Setup**](../DEPLOY.md)

</div>

---

Runs on its own next to the game server and talks to the [RSDWServerAPI mod](../README.md). It
keeps going while the server is down - the status turns red, saved stats still answer, and it
announces when the server is back. Installing and updating are step by step in
**[DEPLOY.md](../DEPLOY.md)**.

## 🎮 Commands

Type **`/`** in Discord and pick one. Player and skill names fill in as you type - online
players first 🟢, then everyone seen before ⚫. Short skill names work too: `wc`, `rc`, `mage`,
`agi`, `con`, `cook`…

| Command | |
| ------- | - |
| 📊 **`/levels`** `player` | Every skill by category, total level and max health |
| 🪓 **`/level`** `skill` `player` | One skill in detail, with a progress bar to the next level |
| 🏆 **`/leaderboard`** `[skill]` | Top players by total level (with quests done), by XP in one skill, or `quests` for the most quests |
| 📜 **`/quests`** `[player]` | Quests done (main, side, tasks) and in progress with the current step - your own when linked |
| ✨ **`/perks`** `player` | Their active skill perks, by skill |
| 🙋 **`/me`** | Everything about your linked character: skills, quests done and in progress, journal, playtime, deaths |
| 🔗 **`/link`** 🔒 · **`/unlink`** 🔒 | Link your Discord to your character - see [Account linking](#-account-linking) |
| 📈 **`/gains`** `[player]` `[period]` | Who gained the most XP, or one player skill by skill |
| ⏱️ **`/playtime`** `[player]` | Most played this week, or one player's time |
| 💀 **`/deaths`** `[player]` | Most deaths, or one player's |
| 🐉 **`/status`** | Online / starting / offline, players, uptime |
| 👥 **`/online`** | Everyone connected, with ping |
| 🎒 **`/item`** `item` 🔒 | Any item: what it is and does (from the wiki), type, stack size, weight |
| 🖥️ **`/system`** 🔒 | The VPS's CPU, RAM, disk and network right now |
| ❓ **`/help`** 🔒 | All of the above |

The bot also posts this list once and pins it, so new players can find it (`COMMANDS_POST`,
`COMMANDS_CHANNEL_ID` - a channel of its own for commands works well). It's edited in place when
the commands change, and moved when the channel does.

`/levels` also shows quests done and journal entries, and `/status` and the status board show the
world (name, host, difficulty) and the in-game clock - all from mod 0.6.0.

## 🔗 Account linking

Players link their Discord account to their character once, so the bot can ping them when they're
being hunted or a raid starts, and `/me` knows who they are.

1. They press **🔗 Link my character** on the card the bot pins in `LINK_CHANNEL_ID` (or use `/link`
   anywhere) and get a 5-character code only they can see.
2. They type **`/link CODE`** in the game chat. The mod keeps it out of chat and hands it to the bot.
3. The bot confirms in game and updates their private Discord message. Codes work once, for 10 minutes.

One Discord account links to one character, and the other way round; linking again moves the
link. Links are kept in `data/links.json`. To make the channel, with everyone allowed to use
commands but not post:

```bash
cd /home/dragonwilds/rsdw-bot && sudo -u dragonwilds node src/setup-link-channel.js
```

It prints the `LINK_CHANNEL_ID` to add to `.env`. The bot needs *Manage Channels* and *Manage Roles*
for that one step.

## ⚔️ Raid and hunt alerts

When a raid or a hunted event starts, the bot posts in `EVENTS_CHANNEL_ID` (default the chat
channel). A hunt pings the hunted player's linked account; a raid pings the linked players near it,
or everyone linked and online when nobody is close. The message is edited to *Raid over · lasted
4m* when it ends. Who's affected is worked out from where players are, since the game doesn't say.
`RAID_ALERTS=false` turns them off.

🔒 Only the person who used the command sees the answer, so lookups don't clutter the channel.
The list is `PRIVATE_COMMANDS` at the top of [`src/index.js`](src/index.js).

```text
📊 Skills · Mira (MiraPlays)
🟢 Online now
❤️ Max health 120

Total level 178  ·  Total XP 1,200,050

⛏️ Gathering
`99` ⛏️ Mining ⭐
`77` 🪓 Woodcutting · 12%
` 2` 🎣 Fishing · 45%
```

`/item` reads the [Dragonwilds wiki](https://dragonwilds.runescape.wiki) for its card (cached for a day):

```text
🎒 Tools
Bronze Logging Axe                                         [picture]
> A woodcutter's tool, forged from bronze.
The bronze logging axe is a power level 3 logging axe that can be crafted at a blacksmith's bench…

🏷️ Type Tool   📦 Stacks to Doesn't stack   ⚖️ Weight 5.0   🔧 Repair cost 1 bronze bar
📖 Read more on the wiki
```

Items the wiki has no page for still show their type and stack size, with a link to search it.

Offline players are answered from the last time the bot saw them, marked *"Offline · last seen
2 hours ago"*. `/online` and `/leaderboard` page with ◀️ ▶️ when there are more than ten.

<details>
<summary><b>How levels, gains and playtime are worked out</b></summary>

<br/>

- **Levels** - the API reports raw XP; [`src/levels.js`](src/levels.js) converts it with the
  [Dragonwilds XP table](https://dragonwilds.runescape.wiki/w/Experience) (99 at 1,000,000 XP).
  Skills and categories follow the [wiki's skill list](https://dragonwilds.runescape.wiki/w/Skills)
  in [`src/skills.js`](src/skills.js). Unreleased skills (Prayer, Hunter, Slayer) stay hidden until
  someone has XP in them.
- **Leaderboard** - total level, with total XP breaking ties; online players use live numbers,
  everyone else what they had when last seen.
- **Gains** - each player's XP now, compared with the first time the bot saw them in the period:
  since midnight for *today*, the last 7 days for *this week* (the default), 30 for *this month*.
  Someone first seen on Wednesday counts from Wednesday, and the footer says so.
- **Playtime** - counted while the bot runs and the player is online.
- **Deaths** - from the mod's death events.

Snapshots live in `data/players.json`, history in `data/history.json` (five weeks of days).

</details>

## 📌 Status board

Point `STATUS_BOARD_CHANNEL_ID` at a channel (read-only for members works best) and the bot keeps
one message there up to date by itself:

```text
🐉 The Hut
🟢 Online · 3/16 players

🎮 How to join
🌐 Direct connect  203.0.113.10:7777
…or find Ashenvale by HostName in the server list
🔑 Password  ▒▒▒▒▒▒   ← a spoiler, click to see

👥 Playing now        ⏱️ Uptime 2h 1m   🧩 Mod v0.5.0   🔄 Daily restart 05:00
📈 Top XP today       🖥️ Server load  CPU 23% · RAM 37%
```

The join details come from `CONNECT_ADDRESS`, `WORLD_NAME`, `WORLD_CREATOR` and `SERVER_PASSWORD`
in `.env` - leave out anything you don't want shown. If the message gets deleted, the bot posts a
new one.

## 💬 Two-way chat

Set `CHAT_CHANNEL_ID` and the channel becomes the game's chat:

| | |
| - | - |
| **Game → Discord** | `💬 **Mira**: anyone got iron?` - and deaths as a small embed |
| **Discord → game** | Players see `[Discord] Sam: on my way!` |

- Mentions are never turned into pings, custom emoji become `:name:`, pictures `[image]`, and
  long messages are cut at `BRIDGE_MAX_LENGTH`.
- If a message can't reach the game the bot reacts on it: 💤 server down or nobody online,
  ⚠️ anything else. After a server restart, messages get through once the first player has joined.
- `BRIDGE_ROLE_ID` limits who can talk into the game; `BRIDGE_TO_GAME=false` keeps it one way.
- The game has no "server" sender, so a Discord line shows in each player's chat under their own
  name, with `[Discord]` in front.

## 🎉 Player activity

Posted as small cards the moment they happen - in the chat channel, or level-ups in their own
channel with `LEVELUP_CHANNEL_ID`:

| Card | Looks like |
| ---- | ---------- |
| 🎉 **Level up** | In the skill's colour with its icon: **Mira** reached **Woodcutting 43** · `40 → 43 · +3 levels` · *Total level 178* |
| ⭐ **Level 99** | Gold, with the skill icon: **Mira mastered Mining!** |
| ➡️ **Join** | Green: **Tobin** joined the server · *👥 3/16 online* |
| ⬅️ **Leave** | Grey: **Tobin** left · played 1h 20m · *👥 2/16 online* |
| 💀 **Death** | Dark red: **Mira** has died · Drowned · *📍 location* |
| 💤 **AFK kick** | Orange: **Mira** was kicked for being AFK (mod 0.4.0+, when AFK kick is on) |

Several at once (a few level-ups, people joining together) share one message.

- Level-ups start at `LEVELUP_MIN_LEVEL` (10) - the first levels come every few seconds.
- With mod 0.4.0+ everything arrives the moment it happens; with older mods within a few seconds.
- A death shows its cause when the game sends one.

**📅 Weekly recap** - every Sunday from 20:00 (VPS time): top XP gainers, new 99s, most played and
deaths. In the chat channel, or its own with `SUMMARY_CHANNEL_ID`.

## 📣 Server notices

In `STATUS_CHANNEL_ID` (or the chat channel), and on the bot's own status:

| Notice | When |
| ------ | ---- |
| 🟢 **Server is online** | It's up again - with how long it was down |
| 🔴 **Server is offline** | The API stopped answering for two polls in a row |
| 🔄 **Server is restarting** | It went straight from online to loading |
| 🔄 **Server restarted** | Its uptime went backwards between two polls |
| 🔄 **Restart in 5 minutes** | Announced by `/server` or a script |
| 💾 **Backup complete** | From the backup script (`BACKUP_NOTICES=false` to hide) |

The bot's status reads `🟢 3/16 players online`, `🟡 Server starting` or `🔴 Server offline`.

<details>
<summary><b>Announcing from scripts</b></summary>

<br/>

[`src/announce.js`](src/announce.js) posts notices the bot can't see for itself - cron jobs use it:

```bash
node src/announce.js restart 5 "Daily update"   # Discord + in game: restarting in 5 minutes
node src/announce.js restart 1 --game-only      # in game only
node src/announce.js stop 10                    # shutting down in 10 minutes
node src/announce.js backup-done "Saved 1 world file(s)."
node src/announce.js say "Event tonight at 8!"  # Discord + in game
```

After an announced restart or stop the bot skips its own "offline" notice, and the "online" one
says the restart is complete. [`deploy/scripts/`](deploy/scripts/) has the VPS's cron scripts
with these calls in.

</details>

### 🆕 Game updates

The bot checks Steam every 15 minutes. When a new build of the server is out, the status channel
gets a **⚠️ Server is out of date** notice with the installed and latest builds, and 20 minutes later
(players in game are warned) the bot backs up, updates with steamcmd and restarts - straight away if
nobody's on. `/server cancel` leaves it for the daily update instead. Then *🆕 Server updated*, and
the usual online notice once it's up. `AUTO_UPDATE=false` only warns.

## 🛡️ For admins

Only the Discord users in `ADMIN_USER_IDS` can use these, they're hidden from members without
Administrator, and the replies are only visible to you.

| Command | |
| ------- | - |
| 🔄 **`/server restart`** · **`stop`** `[minutes]` | Warns players in game and on Discord, then goes. 2 minutes by default with people online |
| ▶️ **`/server start`** | Starts a stopped server |
| ✋ **`/server cancel`** | Calls off a planned restart or stop |
| 💾 **`/server backup`** | Runs the backup script now |
| 🗂️ **`/server backups`** | Every backup with its age and size |
| ⏪ **`/server restore`** `backup` | Puts a backup back after you confirm - warns players, stops the server, keeps a copy of the current world, starts it again |
| 🆕 **`/server update`** `[minutes]` | Back up, update the game server with steamcmd and start it again |
| 👢 **`/admin kick`** · **`ban`** · **`unban`** · **`bans`** | Moderation |
| 🎁 **`/admin give`** `player` `item` `[count]` | Item names fill in as you type |
| 📢 **`/admin say`** `message` | In game and in the status channel |
| 💾 **`/admin save`** `[function]` | Save the world now - the first time, it finds which game function does it |
| 🧹 **`/admin remove`** · **`restore`** | Take a player off every leaderboard and delete their stats - or let them back |
| 🩺 **`/admin diagnostics`** | The mod's self-check |
| 💥 **`/admin crashes`** | Every unplanned restart with its likely cause, and the newest full report |

### 🔔 Private alerts

You get a DM when:

- 🔴 the server goes down or restarts **without** a planned restart - and when it's back;
- 💥 a minute later, **why**: crash (and whether the mod was involved), out of memory, killed,
  stopped by hand or a VPS reboot - with a report attached that holds the systemd exit, the mod's
  crash backtrace, the end of the game and mod logs and the game's own crash report. Reports are
  kept in `data/crashes/` (the last 30). Setup: "Crash reports" in [DEPLOY.md](../DEPLOY.md);
- 🩺 the mod's self-check finds a problem (usually right after a game update) - and when it's fixed;
- 🔥 CPU stays over 90% for 5 minutes, RAM for 3, or the disk fills past 90% - and when it settles.

Limits are `ALERT_CPU`, `ALERT_RAM` and `ALERT_DISK` (0 turns one off); `ADMIN_ALERTS=false` turns
them all off. Discord has to allow DMs from server members.

## ⚙️ Configuration

Everything lives in `.env` - **[CONFIG.md](CONFIG.md) explains every setting**, with defaults and a
full example. Only these are needed to start:

| Setting | |
| ------- | - |
| `DISCORD_TOKEN` | The bot's token |
| `API_TOKEN` | `BearerToken` from the mod's `settings.ini` |
| `CHAT_CHANNEL_ID` | Where game chat, deaths and activity go |
| `ADMIN_USER_IDS` | Your Discord user ID, for the admin commands and alerts |

<details>
<summary><b>Logs</b></summary>

<br/>

Everything goes to stdout (`journalctl -u rsdw-bot`) and to `data/bot.log`, rotated at 5MB:
startup, slash command registration, Discord disconnects, server state and notices, joins,
leaves, level-ups and deaths, every command with who ran it and how long it took, every message
sent into the game, admin actions, alerts and all errors. `DEBUG=true` adds reaction presses,
presence updates, relay batches and undelivered chat.

</details>

<details>
<summary><b>Files</b></summary>

<br/>

| Path | |
| ---- | - |
| `src/index.js` | Startup, slash command and message routing, error handling |
| `src/slash.js` | Slash command definitions, registration, auto-fill |
| `src/commands.js` | The commands and player lookup |
| `src/embeds.js` | Every embed the bot sends |
| `src/menus.js` | ◀️ ▶️ page reactions |
| `src/poller.js` | Server status, presence, player snapshots |
| `src/activity.js` | Level-ups, joins and leaves, playtime, deaths, weekly recap |
| `src/history.js`, `src/stats.js` | Saved history and the gains / playtime / death numbers |
| `src/relay.js` | Game → Discord: chat, deaths and the event feed |
| `src/bridge.js` | Discord → game chat |
| `src/notices.js` | Online / offline / restart notices |
| `src/announce.js`, `src/announcer.js` | Notices for scripts and `/server` |
| `src/admin.js`, `src/server-control.js` | Admin commands, server start / stop / restart / backup |
| `src/alerts.js` | Private alerts to the admins |
| `src/system.js` | VPS CPU, RAM, disk and network |
| `src/board.js` | The live status board |
| `src/commands-post.js` | The pinned command list |
| `src/update-watch.js`, `src/steam.js` | Watching Steam for game updates, updating with steamcmd |
| `src/backups.js`, `src/world-save.js`, `src/save-world.js` | Backups, restoring, saving the world before a backup |
| `src/items.js`, `src/wiki.js` | Item list and lookup, wiki summaries |
| `src/skills.js`, `src/levels.js` | Skill list and XP table |
| `src/store.js` | Saved player snapshots |
| `src/api.js`, `src/config.js`, `src/log.js` | API client, settings, logging |
| `deploy/rsdw-bot.service` | systemd unit |
| `deploy/scripts/` | Backup and daily update scripts with notices |

</details>
