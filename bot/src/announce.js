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
import { api } from './api.js';
import { config } from './config.js';
import { noticeEmbed } from './embeds.js';
import { initLogFile, logger } from './log.js';
import { writePlan } from './notices.js';

initLogFile(config.dataDir);
const log = logger('announce');

const IN_GAME = {
    restart: m => (m ? `Server restarting in ${m} minute${m === 1 ? '' : 's'}` : 'Server restarting now'),
    stop: m => (m ? `Server shutting down in ${m} minute${m === 1 ? '' : 's'}` : 'Server shutting down now'),
    say: () => '',
};
const KINDS = ['restart', 'stop', 'backup', 'backup-done', 'say'];

const args = process.argv.slice(2);
const gameOnly = args.includes('--game-only');
const [kind, ...words] = args.filter(a => a !== '--game-only');
const minutes = /^\d+$/.test(words[0] || '') ? parseInt(words.shift(), 10) : 0;
const message = words.join(' ').trim();

if (!KINDS.includes(kind) || (kind === 'say' && !message)) {
    console.error(`Usage: node src/announce.js <${KINDS.join('|')}> [minutes] [message] [--game-only]`);
    process.exit(2);
}

// Tell the bot a restart or stop is coming, so it doesn't also post "offline".
if (kind === 'restart' || kind === 'stop') {
    try {
        writePlan(kind, minutes);
    } catch (err) {
        log.warn(`could not save the planned ${kind}: ${err.message}`);
    }
}

if (kind in IN_GAME) {
    const text = [IN_GAME[kind](minutes), message].filter(Boolean).join(' - ');
    try {
        await api.broadcast('Server', text);
        log.info(`in game: ${text}`);
    } catch (err) {
        // Nobody online, or the server is already down - that's fine.
        log.info(`in game: not sent (${err.message})`);
    }
}

if (!gameOnly && config.serverNotices && config.statusChannelId) {
    try {
        const rest = new REST().setToken(config.discordToken);
        await rest.post(Routes.channelMessages(config.statusChannelId), {
            body: { embeds: [noticeEmbed(kind, { minutes, message }).toJSON()], allowed_mentions: { parse: [] } },
        });
        log.info(`posted ${kind} notice${message ? `: ${message}` : ''}`);
    } catch (err) {
        log.error(`could not post the ${kind} notice: ${err.message}`);
    }
}
