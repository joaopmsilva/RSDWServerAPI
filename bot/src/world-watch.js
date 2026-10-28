import { config } from './config.js';
import { eventEmbed } from './embeds.js';
import { logger } from './log.js';
import { PlayerStore } from './store.js';

const log = logger('events');
// Game units are centimetres. When the event doesn't say how far it reaches,
// players within this distance count as caught up in it.
const DEFAULT_RADIUS = 8000;

// Raids and "hunted" events, from the mod's /api/world after every poll.
// Each one gets a message in EVENTS_CHANNEL_ID that pings the linked Discord
// accounts it concerns, and is edited to say it's over when it ends.
export class WorldWatch {
    constructor(client, links) {
        this.client = client;
        this.links = links;
        this.active = new Map(); // event id -> { event, started, message, players }
    }

    // From the poller: world is null while the server isn't online. Runs one
    // at a time, so a slow Discord can't make two polls post the same alert.
    observe(world, players) {
        if (!config.raidAlerts) return Promise.resolve();
        this.queue = (this.queue || Promise.resolve()).then(() => this.check(world, players)).catch(err => log.error('event check failed:', err));
        return this.queue;
    }

    async check(world, players) {
        const events = world?.events || [];
        const seen = new Set();
        for (const event of events) {
            seen.add(event.id);
            if (this.active.has(event.id)) continue;
            const entry = { event, started: Date.now(), message: null, players: this.caughtUp(event, players), onlinePlayers: players };
            this.active.set(event.id, entry);
            log.info(`${event.type} started: ${event.name} - ${entry.players.map(p => p.characterName || p.name).join(', ') || 'nobody nearby'}`);
            entry.message = await this.post(entry);
        }
        // A missing world (server down) ends everything still open.
        for (const [id, entry] of this.active) {
            if (seen.has(id)) continue;
            this.active.delete(id);
            log.info(`${entry.event.type} over: ${entry.event.name}`);
            if (entry.message) {
                await entry.message
                    .edit({ content: entry.message.content, embeds: [eventEmbed(entry.event, entry.players, { over: true, startedAt: entry.started })], allowedMentions: { parse: [] } })
                    .catch(err => log.warn(`could not mark the ${entry.event.type} as over: ${err.message}`));
            }
        }
    }

    // Players near the event, nearest first. A hunted event is aimed at one
    // player: the nearest.
    caughtUp(event, players) {
        if (!event.location) return [];
        const radius = event.radius > 0 ? event.radius * 1.5 : DEFAULT_RADIUS;
        const near = players
            .filter(p => p.location)
            .map(p => ({ p, d: Math.hypot(p.location.x - event.location.x, p.location.y - event.location.y, p.location.z - event.location.z) }))
            .sort((a, b) => a.d - b.d);
        if (event.type === 'hunted') return near.slice(0, 1).map(n => n.p);
        return near.filter(n => n.d <= radius).map(n => n.p);
    }

    // Hunted: ping whoever is hunted. Raid: ping everyone linked who is in it,
    // or - if nobody is close - everyone linked who is online, to go and help.
    mentionsFor(entry, online) {
        const users = new Set();
        const add = player => {
            for (const id of this.links.usersFor({ key: PlayerStore.key(player), netId: player.uniqueNetId })) users.add(id);
        };
        entry.players.forEach(add);
        if (entry.event.type === 'raid' && !users.size) online.forEach(add);
        return [...users];
    }

    async post(entry) {
        if (!config.eventsChannelId) return null;
        try {
            const channel = await this.client.channels.fetch(config.eventsChannelId);
            const users = this.mentionsFor(entry, entry.onlinePlayers || []);
            return await channel.send({
                content: users.map(id => `<@${id}>`).join(' ') || undefined,
                embeds: [eventEmbed(entry.event, entry.players)],
                allowedMentions: { users },
            });
        } catch (err) {
            log.warn(`could not post the ${entry.event.type} alert: ${err.message}`);
            return null;
        }
    }
}
