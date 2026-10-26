# RSDW Discord bot

A Discord bot for a RuneScape: Dragonwilds server running the RSDWServerAPI mod. It runs on
its own, whether the game server is up or not.

Installation and updating are covered step by step in [../DEPLOY.md](../DEPLOY.md).

## Commands

Type `/` in Discord and pick one. Player and skill names fill in as you type: online players
first (🟢), then everyone the bot has seen before (⚫).

| Command | |
| ------- | - |
| `/levels player` | Every skill grouped by category, total level and max health |
| `/level skill player` | One skill in detail, with a progress bar |
| `/leaderboard [skill]` | Top players by total level, or by XP in one skill |
| `/status` | Online / starting / offline, players, uptime |
| `/online` | Everyone connected, with ping |
| `/system` | The VPS's CPU, RAM, swap, disk and network use right now |
| `/help` | Command list |
| `/server action [minutes]` | Admins: start, stop, restart, or cancel a planned one |
| `/admin kick` · `ban` · `unban` · `say` | Admins: moderation and announcements |

Players are found by character name or account name, case-insensitively, and partial names
work. Skills accept short forms too: `wc`, `rc`, `mage`, `agi`, `con`, `cook` and so on.

The commands are registered to each Discord server the bot is in every time it starts, so
they appear straight away. If they don't show up, re-invite the bot with the
`applications.commands` scope (see DEPLOY.md step 1).

Replies are plain embeds. Run a command again to see newer numbers.

### Pages

`/online` and `/leaderboard` show ten entries per page. When there are more, they get ◀️ ▶️
reactions to change page, which work for ten minutes after the last press and stop when the
bot restarts.

If the bot has **Manage Messages** in the channel it removes your reaction after each press,
so you can click the same one again. Without it, clicking a reaction a second time (removing
it) also counts as a press.

## Admin commands

`/server` and `/admin` only work for the Discord users in `ADMIN_USER_IDS` and are hidden
from members without Administrator. Their replies are only shown to the admin.

- `/server restart` / `stop` warn players in game and in the status channel, then run
  `systemctl` on `SERVER_SERVICE` through sudo (DEPLOY.md step 11 has the sudoers line).
  The warning is 2 minutes by default when someone is online, none when nobody is, or set
  `minutes`. `/server cancel` calls it off. `/server start` starts a stopped server.
- `/admin kick` / `ban` / `unban` use the mod's API; `/admin say` tells players in game and
  posts in the status channel.

## Levels

The API reports raw XP; [src/levels.js](src/levels.js) converts it with the
[Dragonwilds XP table](https://dragonwilds.runescape.wiki/w/Experience) (level 99 at
1,000,000 XP). Skills and categories follow the
[wiki's skill list](https://dragonwilds.runescape.wiki/w/Skills) in
[src/skills.js](src/skills.js). Unreleased skills (Prayer, Hunter, Slayer) stay hidden until
someone has XP in them, and any skill the game reports that isn't listed shows under "Other".

## Leaderboard

`/leaderboard` ranks everyone the bot has saved stats for by total level (total XP breaks
ties). Pick a skill to rank by XP in that skill instead; players with none are left out.
Online players (🟢) are ranked on live numbers, everyone else on what they had when last
seen.

## Offline lookups

Every poll saves each online player's skills to `data/players.json`. Offline players are
answered from that snapshot, marked "Offline · last seen ...". Only players seen while the
bot was running are known.

## Status

The bot's own status shows the server's state:

- 🟢 `3/16 players online` (green) - the server is up
- 🟡 `Server starting` (yellow) - running, world still loading
- 🔴 `Server offline` (red) - the API doesn't answer

## Two-way chat

With `CHAT_CHANNEL_ID` set:

- **Game → Discord:** in-game chat is posted there as `💬 **Name**: message`, and deaths as
  a small embed in `DEATH_CHANNEL_ID` (or the chat channel). Mentions are never turned into
  pings. The read position is saved in `data/relay.json`, so restarting the bot doesn't
  repeat or skip messages.
- **Discord → game:** anything typed in the channel is shown to players as
  `[Discord] Name: message`, using the member's server nickname. Mentions become plain
  `@names`, custom emoji `:name:`, pictures `[image]`, and long messages are cut at
  `BRIDGE_MAX_LENGTH`. If a message can't be delivered the bot reacts on it: 💤 when the
  server is down or nobody is online, ⚠️ for anything else (see the log).

After a server restart the mod can only send into the game once the first player has
joined (it learns how to call the game from that player's traffic), so until then messages
get 💤.

Set `BRIDGE_ROLE_ID` to let only one role talk into the game, or `BRIDGE_TO_GAME=false` to
keep chat one way. The game has no "server" sender, so a Discord line shows in each player's
chat box under that player's own name, with the `[Discord]` prefix in front.

## Server notices

Posted to `STATUS_CHANNEL_ID` (or the chat channel):

| Notice | When |
| ------ | ---- |
| 🔴 Server is offline | The API stopped answering for two polls in a row |
| 🔄 Server is restarting | It went straight from online to loading again |
| 🔄 Server restarted | Its uptime went backwards between two polls |
| 🟢 Server is online | It's back up, with how long it was down |

Nothing is posted for the state the server is in when the bot itself starts.

Scripts can announce things the bot can't see, with [src/announce.js](src/announce.js):

```bash
node src/announce.js restart 5 "Daily update"   # Discord + in game: restarting in 5 minutes
node src/announce.js restart 1 --game-only      # in game only
node src/announce.js stop 10                    # shutting down in 10 minutes
node src/announce.js backup-done "Saved 1 world file(s)."
node src/announce.js say "Event tonight at 8!"  # Discord + in game
```

After an announced restart or stop, the bot skips its own "offline" notice and the
"online" one says the restart is complete.
[deploy/scripts/](deploy/scripts/) has the VPS's cron scripts with these calls added.

## Configuration

All in `.env` - see [.env.example](.env.example) for every option.

## Logs

Everything goes to stdout (so `journalctl -u rsdw-bot` shows it) and to `data/bot.log`,
rotated at 5MB. Logged: startup, slash command registration, Discord connection drops and
reconnects, server state changes and notices, players joining and leaving, every command
with who ran it and how long it took, every message sent into the game, deaths relayed,
announcements, and all errors. Set `DEBUG=true` in `.env` for reaction presses, presence
updates, relay batches and undelivered chat too.

## Files

| Path | |
| ---- | - |
| `src/index.js` | Startup, slash command and message routing, error handling |
| `src/slash.js` | Slash command definitions, registration, auto-fill |
| `src/commands.js` | The commands and player lookup |
| `src/embeds.js` | Every embed the bot sends |
| `src/menus.js` | Reaction navigation |
| `src/poller.js` | Server status, presence, player snapshots |
| `src/system.js` | VPS CPU, RAM, disk and network for /system |
| `src/relay.js` | Game → Discord chat and deaths |
| `src/bridge.js` | Discord → game chat |
| `src/notices.js` | Online / offline / restart notices |
| `src/announce.js`, `src/announcer.js` | Notices for scripts and /server |
| `src/admin.js`, `src/server-control.js` | Admin commands, server start / stop / restart |
| `src/skills.js`, `src/levels.js` | Skill list and XP table |
| `src/store.js` | Saved player snapshots |
| `src/api.js`, `src/config.js`, `src/log.js` | API client, settings, logging |
| `deploy/rsdw-bot.service` | systemd unit |
| `deploy/scripts/` | Backup and daily update scripts with notices |
