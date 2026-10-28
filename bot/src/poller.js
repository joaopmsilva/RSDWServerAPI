import { ActivityType } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { logger } from './log.js';
import { PlayerStore } from './store.js';

const log = logger('poller');

// Polls the API on a timer: keeps the bot's presence in sync with the server
// and snapshots every online player's skills into the store.
export class Poller {
    constructor(client, store) {
        this.client = client;
        this.store = store;
        this.state = { status: 'unknown', health: null, players: [], world: null, error: null, updatedAt: 0 };
        this.lastPresence = '';
        this.lastError = '';
        this.lastStatus = 'unknown';
        this.knownPlayers = null;
        this.timer = null;
        this.onTick = null;
        // (players, health) before snapshots are saved; players is null while not online.
        this.onPlayers = null;
    }

    start() {
        this.tick();
        this.timer = setInterval(() => this.tick(), config.pollSeconds * 1000);
    }

    stop() {
        clearInterval(this.timer);
    }

    async tick() {
        const state = this.state;
        try {
            state.health = await api.health();
            if (state.health.engineReady) {
                state.players = await api.players();
                state.world = await this.fetchWorld();
                state.status = 'online';
                this.emitPlayers(state.players, state.health);
                const now = Date.now();
                for (const player of state.players) this.store.update(player, now);
                try {
                    this.store.flush();
                } catch (err) {
                    log.error(`could not save player snapshots: ${err.message}`);
                }
            } else {
                state.status = 'starting';
                state.players = [];
                state.world = null;
                this.emitPlayers(null, state.health);
            }
            state.error = null;
        } catch (err) {
            state.status = err.kind === 'starting' ? 'starting' : 'offline';
            state.players = [];
            state.world = null;
            state.error = err.message;
            if (err.kind !== 'starting') state.health = null;
            this.emitPlayers(null, state.health);
        }
        state.updatedAt = Date.now();

        this.logChanges();
        this.updatePresence();
        this.onTick?.(state);
    }

    // World info and running events; null on mods before 0.6.0 or while it can't be read.
    async fetchWorld() {
        try {
            return await api.world();
        } catch (err) {
            if (err.status !== 404 && err.message !== this.lastWorldError) log.debug(`world info unavailable: ${err.message}`);
            this.lastWorldError = err.message;
            return null;
        }
    }

    emitPlayers(players, health) {
        try {
            this.onPlayers?.(players, health);
        } catch (err) {
            log.error('player tracking failed:', err);
        }
    }

    logChanges() {
        const { state } = this;

        if (state.status !== this.lastStatus) {
            const version = state.health?.version ? ` (mod v${state.health.version})` : '';
            log.info(`server is ${state.status}${version}`);
            this.lastStatus = state.status;
        }

        if (state.error !== (this.lastError || null)) {
            if (state.error) log.warn(state.error);
            this.lastError = state.error || '';
        }

        if (state.status !== 'online') {
            this.knownPlayers = null;
            return;
        }

        const current = new Map(state.players.map(p => [PlayerStore.key(p), p.characterName || p.name]));
        if (this.knownPlayers) {
            for (const [key, name] of current) if (!this.knownPlayers.has(key)) log.info(`player joined: ${name}`);
            for (const [key, name] of this.knownPlayers) if (!current.has(key)) log.info(`player left: ${name}`);
        } else {
            log.info(`${current.size} player(s) online`);
        }
        this.knownPlayers = current;
    }

    updatePresence() {
        if (!this.client.user) return;

        const count = this.state.players.length;
        const max = config.maxPlayers ? `/${config.maxPlayers}` : '';
        const [status, text] = {
            online: ['online', `🟢 ${count}${max} player${count === 1 && !max ? '' : 's'} online`],
            starting: ['idle', '🟡 Server starting'],
            offline: ['dnd', '🔴 Server offline'],
            unknown: ['idle', 'Checking server...'],
        }[this.state.status];

        // Only send when it changes - Discord rate limits presence updates.
        const key = status + text;
        if (key === this.lastPresence) return;
        this.lastPresence = key;

        log.debug(`presence: ${status} "${text}"`);
        this.client.user.setPresence({
            status,
            activities: [{ type: ActivityType.Custom, name: 'status', state: text }],
        });
    }
}
