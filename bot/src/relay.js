import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { logger } from './log.js';

const log = logger('relay');
const NO_MENTIONS = { parse: [] };

// Relays in-game chat and deaths from the mod's /api/events feed to Discord.
// The cursor is saved so a bot restart neither repeats nor skips events; a
// changed bootId means the server restarted and its event ids began again.
export class Relay {
    constructor(client) {
        this.client = client;
        this.file = path.join(config.dataDir, 'relay.json');
        this.cursor = null;
        this.timer = null;
        this.running = false;

        try {
            this.cursor = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    get enabled() {
        return Boolean(config.chatChannelId || config.deathChannelId);
    }

    start() {
        if (!this.enabled) {
            log.info('CHAT_CHANNEL_ID not set, chat and death relay is off');
            return;
        }
        log.info(`relaying chat to ${config.chatChannelId || '(off)'}, deaths to ${config.deathChannelId}, every ${config.relaySeconds}s`);
        this.timer = setInterval(() => this.tick(), config.relaySeconds * 1000);
    }

    stop() {
        clearInterval(this.timer);
    }

    save() {
        try {
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.cursor));
            fs.renameSync(tmp, this.file);
        } catch (err) {
            log.error(`could not save cursor: ${err.message}`);
        }
    }

    async tick() {
        if (this.running) return;
        this.running = true;
        try {
            await this.pull();
        } catch (err) {
            // Server offline or restarting - try again next tick.
            if (err.kind !== 'offline' && err.kind !== 'starting') log.warn(err.message);
        } finally {
            this.running = false;
        }
    }

    async pull() {
        let since = 0;
        if (this.cursor) since = this.cursor.lastId;

        let feed = await api.events(since);
        if (!this.cursor) {
            // First run ever: start from now rather than replaying old chat.
            this.cursor = { bootId: feed.bootId, lastId: feed.latestId };
            this.save();
            log.info(`first run, starting the feed at event ${feed.latestId}`);
            return;
        }
        if (feed.bootId !== this.cursor.bootId) {
            log.info('server restarted, following its new event feed');
            this.cursor = { bootId: feed.bootId, lastId: 0 };
            this.save();
            feed = await api.events(0);
        }
        if (!feed.events?.length) return;

        await this.post(feed.events);
        log.debug(`relayed events ${feed.events[0].id}-${feed.events[feed.events.length - 1].id}`);
        this.cursor.lastId = feed.events[feed.events.length - 1].id;
        this.save();
    }

    async channel(id) {
        if (!id) return null;
        try {
            return await this.client.channels.fetch(id);
        } catch (err) {
            log.warn(`cannot access channel ${id}: ${err.message}`);
            return null;
        }
    }

    async post(events) {
        const chat = events.filter(e => e.type === 'chat');
        const deaths = events.filter(e => e.type === 'death');

        if (chat.length) {
            const channel = await this.channel(config.chatChannelId);
            if (channel) {
                // Batch lines into as few messages as fit Discord's 2000 character limit.
                let batch = '';
                for (const e of chat) {
                    const line = `💬 **${escapeMarkdown(e.name || 'Unknown')}**: ${escapeMarkdown(e.message || '')}`.slice(0, 1900);
                    if (batch && batch.length + line.length + 1 > 1900) {
                        await channel.send({ content: batch, allowedMentions: NO_MENTIONS });
                        batch = '';
                    }
                    batch += (batch ? '\n' : '') + line;
                }
                if (batch) await channel.send({ content: batch, allowedMentions: NO_MENTIONS });
            }
        }

        if (deaths.length) {
            const channel = await this.channel(config.deathChannelId);
            if (channel) {
                const embeds = deaths.map(e => {
                    const embed = new EmbedBuilder()
                        .setColor(0x8b0000)
                        .setDescription(`💀 **${escapeMarkdown(e.name || 'Someone')}** has died`)
                        .setTimestamp(e.time ? new Date(e.time) : new Date());
                    if (e.location) embed.setFooter({ text: `📍 ${e.location}` });
                    return embed;
                });
                for (let i = 0; i < embeds.length; i += 10) {
                    await channel.send({ embeds: embeds.slice(i, i + 10), allowedMentions: NO_MENTIONS });
                }
                for (const e of deaths) log.info(`death: ${e.name}${e.location ? ` at ${e.location}` : ''}`);
            }
        }
    }
}
