// Posts a server notice from a script or cron job, separately from the running
// bot. Restart, stop and say are also shown to players in game.
//
//   node src/announce.js restart [minutes] [message]
//   node src/announce.js stop [minutes] [message]
//   node src/announce.js backup [message]
//   node src/announce.js backup-done [message]
//   node src/announce.js say <message>
//
// --game-only skips Discord, e.g. for a last warning a minute before.

import { REST, Routes } from 'discord.js';
import { ANNOUNCE_KINDS, announce } from './announcer.js';
import { config } from './config.js';
import { initLogFile } from './log.js';

initLogFile(config.dataDir);

const args = process.argv.slice(2);
const gameOnly = args.includes('--game-only');
const [kind, ...words] = args.filter(a => a !== '--game-only');
const minutes = /^\d+$/.test(words[0] || '') ? parseInt(words.shift(), 10) : 0;
const message = words.join(' ').trim();

if (!ANNOUNCE_KINDS.includes(kind) || (kind === 'say' && !message)) {
    console.error(`Usage: node src/announce.js <${ANNOUNCE_KINDS.join('|')}> [minutes] [message] [--game-only]`);
    process.exit(2);
}

const rest = new REST().setToken(config.discordToken);
await announce(kind, {
    minutes,
    message,
    gameOnly,
    post: embed =>
        rest.post(Routes.channelMessages(config.statusChannelId), {
            body: { embeds: [embed.toJSON()], allowed_mentions: { parse: [] } },
        }),
});
