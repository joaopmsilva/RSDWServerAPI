# RSDW Discord bot

A Discord bot for a RuneScape: Dragonwilds server running the RSDWServerAPI mod. It runs on
its own, whether the game server is up or not.

Installation is covered step by step in [../DEPLOY.md](../DEPLOY.md).

## Commands

| Command | Aliases | |
| ------- | ------- | - |
| `!levels <player>` | `!stats` | Skill overview, with reactions to open each category |
| `!level <skill> <player>` | `!lvl` | One skill in detail, with a progress bar |
| `!status` | `!server` | Online / starting / offline, players, uptime |
| `!online` | `!players` | Everyone connected, with ping |
| `!help` | | Command list |

Players are found by character name or account name, case-insensitively, and partial names
work. Skills accept short forms: `wc`, `rc`, `mage`, `agi`, `con`, `cook` and so on.

### Navigating with reactions

Replies to `!levels` and `!level` carry reactions:

| Reaction | Opens |
| -------- | ----- |
| 📊 | Overview - every skill's level, total level and total XP |
| ⚔️ | Combat - Attack, Magic, Ranged |
| ⛏️ | Gathering - Mining, Woodcutting, Farming, Fishing |
| 🔨 | Artisan - Runecrafting, Construction, Artisan, Cooking |
| 🏃 | Support - Agility |
| 🔄 | Reload the player's stats |

`!status` and `!online` have 🔄, and `!online` adds ◀️ ▶️ when there are more than ten
players. Reactions stay active for ten minutes after the last use.

If the bot has **Manage Messages** in the channel it removes your reaction after each press,
so you can click the same one again. Without it, clicking a reaction a second time (removing
it) also counts as a press.

## Levels

The API reports raw XP; [src/levels.js](src/levels.js) converts it with the
[Dragonwilds XP table](https://dragonwilds.runescape.wiki/w/Experience) (level 99 at
1,000,000 XP). Skills and categories follow the
[wiki's skill list](https://dragonwilds.runescape.wiki/w/Skills) in
[src/skills.js](src/skills.js). Unreleased skills (Prayer, Hunter, Slayer) stay hidden until
someone has XP in them, and any skill the game reports that isn't listed shows under "Other".

## Offline lookups

Every poll saves each online player's skills to `data/players.json`. Offline players are
answered from that snapshot, marked "Offline · last seen ...". Only players seen while the
bot was running are known.

## Status

The bot's own status shows the server's state:

- 🟢 `3/16 players online` (green) - the server is up
- 🟡 `Server starting` (yellow) - running, world still loading
- 🔴 `Server offline` (red) - the API doesn't answer

## Chat and death relay

With `CHAT_CHANNEL_ID` set, in-game chat is posted there as `💬 **Name**: message`, and
deaths as a small embed in `DEATH_CHANNEL_ID` (or the chat channel). Mentions in chat are
never turned into pings. The read position is saved in `data/relay.json`, so restarting the
bot doesn't repeat or skip messages.

## Configuration

All in `.env` - see [.env.example](.env.example) for every option.

## Logs

Everything goes to stdout (so `journalctl -u rsdw-bot` shows it) and to `data/bot.log`,
rotated at 5MB. Logged: startup, Discord connection drops and reconnects, server state
changes, players joining and leaving, every command with who ran it and how long it took,
deaths relayed, and all errors. Set `DEBUG=true` in `.env` for reaction presses, presence
updates and relay batches too.

## Files

| Path | |
| ---- | - |
| `src/index.js` | Startup, command routing, error handling |
| `src/commands.js` | The commands and player lookup |
| `src/embeds.js` | Every embed the bot sends |
| `src/menus.js` | Reaction navigation |
| `src/poller.js` | Server status, presence, player snapshots |
| `src/relay.js` | Chat and death relay |
| `src/skills.js`, `src/levels.js` | Skill list and XP table |
| `src/store.js` | Saved player snapshots |
| `src/api.js`, `src/config.js`, `src/log.js` | API client, settings, logging |
| `deploy/rsdw-bot.service` | systemd unit |
