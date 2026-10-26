<div align="center">

# 🤖 RSDW Discord Bot

**Your Dragonwilds server, inside Discord.**

Stats, leaderboards and two-way chat for players · server control and alerts for admins.

![Version](https://img.shields.io/badge/version-0.4.0-5865F2?style=for-the-badge&logo=discord&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=for-the-badge)
![Node](https://img.shields.io/badge/node-18.17%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)

[**Commands**](#-commands) · [**Chat**](#-two-way-chat) · [**Activity**](#-player-activity) · [**Notices**](#-server-notices) · [**Admins**](#%EF%B8%8F-for-admins) · [**Setup**](../DEPLOY.md)

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
| 🏆 **`/leaderboard`** `[skill]` | Top players by total level, or by XP in one skill |
| 📈 **`/gains`** `[player]` `[period]` | Who gained the most XP, or one player skill by skill |
| ⏱️ **`/playtime`** `[player]` | Most played this week, or one player's time |
| 💀 **`/deaths`** `[player]` | Most deaths, or one player's |
| 🐉 **`/status`** | Online / starting / offline, players, uptime |
| 👥 **`/online`** | Everyone connected, with ping |
| 🖥️ **`/system`** | The VPS's CPU, RAM, disk and network right now |
| ❓ **`/help`** | All of the above |

```text
📊 Skills · Smurfy (Paradox)
🟢 Online now
❤️ Max health 120

Total level 178  ·  Total XP 1,200,050

⛏️ Gathering
`99` ⛏️ Mining ⭐
`77` 🪓 Woodcutting · 12%
` 2` 🎣 Fishing · 45%
```

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

## 💬 Two-way chat

Set `CHAT_CHANNEL_ID` and the channel becomes the game's chat:

| | |
| - | - |
| **Game → Discord** | `💬 **Smurfy**: anyone got iron?` - and deaths as a small embed |
| **Discord → game** | Players see `[Discord] Paradox: on my way!` |

- Mentions are never turned into pings, custom emoji become `:name:`, pictures `[image]`, and
  long messages are cut at `BRIDGE_MAX_LENGTH`.
- If a message can't reach the game the bot reacts on it: 💤 server down or nobody online,
  ⚠️ anything else. After a server restart, messages get through once the first player has joined.
- `BRIDGE_ROLE_ID` limits who can talk into the game; `BRIDGE_TO_GAME=false` keeps it one way.
- The game has no "server" sender, so a Discord line shows in each player's chat under their own
  name, with `[Discord]` in front.

## 🎉 Player activity

Posted in the chat channel as small cards, the moment they happen:

| Card | Looks like |
| ---- | ---------- |
| 🎉 **Level up** | In the skill's colour with its icon: **Smurfy** reached **Woodcutting 43** · `40 → 43 · +3 levels` · `▰▱▱▱▱` 6% to 44 · *Total level 178* |
| ⭐ **Level 99** | Gold, with the skill icon: **Smurfy mastered Mining!** |
| ➡️ **Join** | Green: **Bobby** joined the server · *👥 3/16 online* |
| ⬅️ **Leave** | Grey: **Bobby** left · played 1h 20m · *👥 2/16 online* |
| 💀 **Death** | Dark red: **Smurfy** has died · Drowned · *📍 location* |

Several at once (a few level-ups, people joining together) share one message.

- Level-ups start at `LEVELUP_MIN_LEVEL` (10) - the first levels come every few seconds.
- With mod 0.3.0+, joins and leaves are instant; with older mods they arrive at the next poll.
- A death shows its cause when the game sends one.

**📅 Weekly recap** - every Sunday from 20:00 (VPS time): top XP gainers, new 99s, most played and
deaths. Move these with `LEVELUP_CHANNEL_ID` / `SUMMARY_CHANNEL_ID`.

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

## 🛡️ For admins

Only the Discord users in `ADMIN_USER_IDS` can use these, they're hidden from members without
Administrator, and the replies are only visible to you.

| Command | |
| ------- | - |
| 🔄 **`/server restart`** · **`stop`** `[minutes]` | Warns players in game and on Discord, then goes. 2 minutes by default with people online |
| ▶️ **`/server start`** | Starts a stopped server |
| ✋ **`/server cancel`** | Calls off a planned restart or stop |
| 💾 **`/server backup`** | Runs the backup script now |
| 👢 **`/admin kick`** · **`ban`** · **`unban`** · **`bans`** | Moderation |
| 🎁 **`/admin give`** `player` `item` `[count]` | Item names fill in as you type |
| 📢 **`/admin say`** `message` | In game and in the status channel |
| 🧹 **`/admin remove`** · **`restore`** | Take a player off every leaderboard and delete their stats - or let them back |
| 🩺 **`/admin diagnostics`** | The mod's self-check |

### 🔔 Private alerts

You get a DM when:

- 🔴 the server goes down or restarts **without** a planned restart - and when it's back;
- 🩺 the mod's self-check finds a problem (usually right after a game update) - and when it's fixed;
- 🔥 CPU stays over 90% for 5 minutes, RAM for 3, or the disk fills past 90% - and when it settles.

Limits are `ALERT_CPU`, `ALERT_RAM` and `ALERT_DISK` (0 turns one off); `ADMIN_ALERTS=false` turns
them all off. Discord has to allow DMs from server members.

## ⚙️ Configuration

Everything lives in `.env` - [`.env.example`](.env.example) explains each option. Only these are
needed to start:

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
| `src/skills.js`, `src/levels.js` | Skill list and XP table |
| `src/store.js` | Saved player snapshots |
| `src/api.js`, `src/config.js`, `src/log.js` | API client, settings, logging |
| `deploy/rsdw-bot.service` | systemd unit |
| `deploy/scripts/` | Backup and daily update scripts with notices |

</details>
