import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { boardEmbed } from './embeds.js';
import { logger } from './log.js';
import { topGainers } from './stats.js';
import { systemStats } from './system.js';

const log = logger('board');

// One message in STATUS_BOARD_CHANNEL_ID that keeps itself up to date: how to
// join, whether the server is up, who's on, today's top gainers and the VPS's
// load. Edited after every poll when something changed; posted again if
// someone deletes it. Its id is kept in data/board.json.
export class StatusBoard {
    constructor(client, poller, ctx) {
        this.client = client;
        this.poller = poller;
        this.ctx = ctx;
        this.file = path.join(config.dataDir, 'board.json');
        this.saved = null;
        this.lastContent = '';
        this.lastError = '';
        this.busy = false;
        try {
            this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    get enabled() {
        return Boolean(config.statusBoardChannelId);
    }

    start() {
        if (!this.enabled) {
            log.info('no STATUS_BOARD_CHANNEL_ID, status board is off');
            return;
        }
        log.info(`keeping the status board in ${config.statusBoardChannelId} up to date`);
        this.update();
    }

    async update() {
        if (!this.enabled || this.busy) return;
        this.busy = true;
        try {
            const vps = config.boardShowVps && process.platform === 'linux' ? await systemStats().catch(() => null) : null;
            const embed = boardEmbed({ state: this.poller.state, gainers: topGainers(this.ctx, 'today').slice(0, 3), vps });

            // Compare without the timestamp, so an unchanged board isn't edited.
            const { timestamp, ...content } = embed.toJSON();
            const key = JSON.stringify(content);
            if (key === this.lastContent) return;

            const channel = await this.client.channels.fetch(config.statusBoardChannelId);
            const sameChannel = this.saved?.channelId === config.statusBoardChannelId;
            let message = sameChannel && this.saved.messageId ? await channel.messages.fetch(this.saved.messageId).catch(() => null) : null;
            if (message) {
                await message.edit({ embeds: [embed] });
            } else {
                message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
                this.saved = { channelId: channel.id, messageId: message.id };
                fs.writeFileSync(this.file, JSON.stringify(this.saved));
                log.info(`posted the status board in #${channel.name}`);
            }
            this.lastContent = key;
            this.lastError = '';
        } catch (err) {
            // Say it once, not every poll.
            if (err.message !== this.lastError) {
                log.warn(`could not update the status board: ${err.message} - the bot needs View Channel, Send Messages, Embed Links and Read Message History there`);
                this.lastError = err.message;
            }
        } finally {
            this.busy = false;
        }
    }
}
