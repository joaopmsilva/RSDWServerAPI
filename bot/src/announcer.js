import { api } from './api.js';
import { config } from './config.js';
import { noticeEmbed } from './embeds.js';
import { logger } from './log.js';
import { writePlan } from './notices.js';

const log = logger('announce');

const IN_GAME = {
    restart: m => (m ? `Server restarting in ${m} minute${m === 1 ? '' : 's'}` : 'Server restarting now'),
    stop: m => (m ? `Server shutting down in ${m} minute${m === 1 ? '' : 's'}` : 'Server shutting down now'),
    say: () => '',
};

export const ANNOUNCE_KINDS = ['restart', 'stop', 'backup', 'backup-done', 'say'];

// Posts a notice to STATUS_CHANNEL_ID and, for restart / stop / say, tells players
// in game. post(embed) does the Discord side: the bot sends through its client,
// announce.js through the REST API. Used by /server and by the cron scripts.
export async function announce(kind, { minutes = 0, message = '', gameOnly = false, post }) {
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

    if (gameOnly || !config.serverNotices || !config.statusChannelId || !post) return;
    if (kind.startsWith('backup') && !config.backupNotices) {
        log.info(`${kind} notice skipped (BACKUP_NOTICES=false)`);
        return;
    }
    try {
        await post(noticeEmbed(kind, { minutes, message }));
        log.info(`posted ${kind} notice${message ? `: ${message}` : ''}`);
    } catch (err) {
        log.error(`could not post the ${kind} notice: ${err.message}`);
    }
}
