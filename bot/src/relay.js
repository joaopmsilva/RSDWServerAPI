import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { logger } from './log.js';

const log = logger('relay');
const NO_MENTIONS = { parse: [] };

// The game's death event tag (mod 0.3.0+), e.g. "Player.Death.Drowned" -> " · Drowned".
// Words that only say "a player died" are dropped; nothing left means no cause.
const GENERIC_TAG = /^(death|deaths|died|die|dead|player|players|event|events|gameplay|tag|chat|notification|message)$/i;
function causeText(tag) {
    const words = (tag || '').split('.').filter(w => w && !GENERIC_TAG.test(w));
    const last = words.at(-1);
    return last ? ` · ${last.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}` : '';
}

// Relays in-game chat and deaths from the mod's /api/events feed to Discord.
// The cursor is saved so a bot restart neither repeats nor skips events; a
// changed bootId means the server restarted and its event ids began again.
export class Relay {
    constructor(client, bridge = null, activity = null, links = null) {
        this.client = client;
        this.bridge = bridge;
        this.activity = activity;
        this.links = links;
        this.file = path.join(config.dataDir, 'relay.json');
        this.cursor = null;
        this.stopped = false;
        // Mod 0.4.0+ holds a request open until something happens; older ones are polled.
        this.longPoll = false;

        try {
            this.cursor = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    // Always runs: deaths, joins and leaves feed the stats even with no channels set.
    start() {
        log.info(`following the event feed - chat to ${config.chatChannelId || '(off)'}, deaths to ${config.deathChannelId || '(off)'}`);
        this.loop();
    }

    stop() {
        this.stopped = true;
    }

    async loop() {
        while (!this.stopped) {
            const waited = await this.tick();
            // A long poll already waited for news; otherwise pause between polls.
            if (!waited) await new Promise(r => setTimeout(r, config.relaySeconds * 1000));
        }
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

    // True when the request was a long poll, so the loop can ask again at once.
    async tick() {
        try {
            return await this.pull();
        } catch (err) {
            // Server offline or restarting - try again after a pause.
            if (err.kind !== 'offline' && err.kind !== 'starting') log.warn(err.message);
            return false;
        }
    }

    async pull() {
        let since = 0;
        if (this.cursor) since = this.cursor.lastId;

        const wait = this.longPoll && this.cursor ? 25 : 0;
        let feed = await api.events(since, wait);
        if (Boolean(feed.longPoll) !== this.longPoll) {
            this.longPoll = Boolean(feed.longPoll);
            log.info(this.longPoll ? 'the mod pushes events as they happen' : `polling for events every ${config.relaySeconds}s`);
        }
        if (!this.cursor) {
            // First run ever: start from now rather than replaying old chat.
            this.cursor = { bootId: feed.bootId, lastId: feed.latestId };
            this.save();
            log.info(`first run, starting the feed at event ${feed.latestId}`);
            return this.longPoll;
        }
        if (feed.bootId !== this.cursor.bootId) {
            log.info('server restarted, following its new event feed');
            this.cursor = { bootId: feed.bootId, lastId: 0 };
            this.save();
            feed = await api.events(0);
        }
        if (!feed.events?.length) return this.longPoll;

        await this.post(feed.events);
        log.debug(`relayed events ${feed.events[0].id}-${feed.events[feed.events.length - 1].id}`);
        this.cursor.lastId = feed.events[feed.events.length - 1].id;
        this.save();
        return this.longPoll;
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
        const chat = events.filter(e => e.type === 'chat' && !this.bridge?.isEcho(e));
        const deaths = events.filter(e => e.type === 'death');

        for (const e of events) {
            if (e.type === 'join' || e.type === 'leave') this.activity?.presence(e);
            if (e.type === 'death') this.activity?.death(e);
            if (e.type === 'kill') this.activity?.kill(e);
            if (e.type === 'afk') this.activity?.afk(e);
            // Mod 0.6.0+: someone typed /link CODE in game.
            if (e.type === 'link') this.links?.handle(e).catch(err => log.error('link failed:', err));
        }

        if (chat.length && config.chatChannelId) {
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

        for (const e of deaths) log.info(`death: ${e.name}${e.location ? ` at ${e.location}` : ''}${e.cause ? ` (${e.cause})` : ''}`);
        if (deaths.length && config.deathChannelId) {
            const channel = await this.channel(config.deathChannelId);
            if (channel) {
                const embeds = deaths.map(e => {
                    const embed = new EmbedBuilder()
                        .setColor(0x8b0000)
                        .setDescription(`💀 **${escapeMarkdown(e.name || 'Someone')}** has died${causeText(e.cause)}`)
                        .setTimestamp(e.time ? new Date(e.time) : new Date());
                    if (e.location) embed.setFooter({ text: `📍 ${e.location}` });
                    return embed;
                });
                for (let i = 0; i < embeds.length; i += 10) {
                    await channel.send({ embeds: embeds.slice(i, i + 10), allowedMentions: NO_MENTIONS });
                }
            }
        }
    }
}
