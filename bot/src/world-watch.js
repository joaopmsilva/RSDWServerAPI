import { config } from './config.js';
import { alertButtons, eventEmbed } from './embeds.js';
import { logger } from './log.js';
import { PlayerStore } from './store.js';

const log = logger('events');
// Game units are centimetres. When the event doesn't say how far it reaches,
// players within this distance count as caught up in it.
const DEFAULT_RADIUS = 8000;

// Raids and "hunted" events, from the mod's /api/world after every poll. Each
// one is a private DM to the linked players it concerns who turned that alert
// on (/alerts), edited to say it's over when it ends. Nothing is posted in a
// channel.
export class WorldWatch {
    constructor(client, links) {
        this.client = client;
        this.links = links;
        this.active = new Map(); // event id -> { event, started, players, dms }
    }

    // From the poller: world is null while the server isn't online. Runs one
    // at a time, so a slow Discord can't make two polls send the same alert.
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
            const entry = { event, started: Date.now(), players: this.caughtUp(event, players), dms: [] };
            this.active.set(event.id, entry);
            const users = this.recipientsFor(entry, players);
            log.info(`${event.type} started: ${event.name} - ${entry.players.map(p => p.characterName || p.name).join(', ') || 'nobody nearby'} - ${users.length} DM(s)`);
            entry.dms = await this.send(users, eventEmbed(event, entry.players));
        }
        // A missing world (server down) ends everything still open.
        for (const [id, entry] of this.active) {
            if (seen.has(id)) continue;
            this.active.delete(id);
            log.info(`${entry.event.type} over: ${entry.event.name}`);
            const over = eventEmbed(entry.event, entry.players, { over: true, startedAt: entry.started });
            for (const { message, userId } of entry.dms) {
                await message
                    .edit({ embeds: [over], components: alertButtons(this.links.of(userId)) })
                    .catch(err => log.info(`could not mark the ${entry.event.type} as over for ${userId}: ${err.message}`));
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

    // Only players who turned that alert on. Hunted: whoever is hunted. Raid:
    // the linked players in it, or - if nobody is close - those who are online,
    // to go and help.
    recipientsFor(entry, online) {
        const alert = entry.event.type;
        const users = new Set();
        const add = player => {
            for (const id of this.links.usersFor({ key: PlayerStore.key(player), netId: player.uniqueNetId }, alert)) users.add(id);
        };
        entry.players.forEach(add);
        if (alert === 'raid' && !entry.players.length) online.forEach(add);
        return [...users];
    }

    // DMs with the alert switches under them, so it can be turned off from there.
    async send(users, embed) {
        const sent = [];
        for (const userId of users) {
            try {
                const user = await this.client.users.fetch(userId);
                const message = await user.send({ embeds: [embed], components: alertButtons(this.links.of(userId)) });
                sent.push({ message, userId });
            } catch (err) {
                log.info(`could not DM ${userId}: ${err.message} - they may have DMs from server members turned off`);
            }
        }
        return sent;
    }
}
