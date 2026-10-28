import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { noticeEmbed } from './embeds.js';
import { logger } from './log.js';

const log = logger('notices');
const PLAN_FILE = path.join(config.dataDir, 'planned.json');

// A planned restart, stop or backup, written by announce.js. While it lasts,
// the bot doesn't also post "offline", and the "online" notice says why it was down.
export function readPlan() {
    try {
        const plan = JSON.parse(fs.readFileSync(PLAN_FILE, 'utf8'));
        return Date.now() < plan.until ? plan : null;
    } catch {
        return null;
    }
}

export function writePlan(kind, minutes) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    // steamcmd validate can take a while, so allow plenty of downtime.
    const plan = { kind, at: Date.now(), until: Date.now() + (minutes + 45) * 60000 };
    fs.writeFileSync(PLAN_FILE, JSON.stringify(plan));
}

export function clearPlan() {
    fs.rm(PLAN_FILE, { force: true }, () => {});
}

// Posts "online", "offline" and "restarting" to STATUS_CHANNEL_ID by watching
// the poller's state. One missed poll isn't enough to call the server offline.
export class Notices {
    constructor(client) {
        this.client = client;
        this.shown = null;
        this.downSince = null;
        this.downTicks = 0;
        this.lastUptime = null;
        this.queue = Promise.resolve();
        // (kind, details) for every notice, posted or not - the admin alerts use it.
        this.onNotice = null;
    }

    get enabled() {
        return config.serverNotices && Boolean(config.statusChannelId);
    }

    start() {
        if (this.enabled) log.info(`posting server notices to ${config.statusChannelId}`);
        else log.info('server notices are off');
    }

    // Called after every poll. Checks run one at a time so a /status refresh
    // racing the timer can't post the same notice twice.
    observe(state) {
        const snapshot = { status: state.status, health: state.health };
        this.queue = this.queue.then(() => this.check(snapshot)).catch(err => log.error('notice check failed:', err));
        return this.queue;
    }

    async check(state) {
        if (state.status === 'unknown') return;

        const prev = this.shown;
        const uptime = state.health?.uptimeSeconds ?? null;

        if (state.status === 'online') {
            this.downTicks = 0;
            // Online on both polls but uptime went backwards: it restarted in between.
            const restartedQuietly = prev === 'online' && uptime !== null && this.lastUptime !== null && uptime < this.lastUptime;
            const uptimeBefore = this.lastUptime;
            this.lastUptime = uptime;
            this.shown = 'online';

            if (prev === null) return;
            if (prev === 'online') {
                // A single missed poll, never announced.
                const downtimeMs = this.downSince ? Date.now() - this.downSince : 0;
                this.downSince = null;
                if (!restartedQuietly) return;
                // A planned restart can be over before two polls miss it.
                const plan = readPlan();
                if (plan) {
                    await this.post('online', { downtimeMs, after: plan.kind });
                    clearPlan();
                } else {
                    await this.post('restarted', { uptimeSeconds: uptimeBefore });
                }
            } else {
                const plan = readPlan();
                await this.post('online', { downtimeMs: this.downSince ? Date.now() - this.downSince : 0, after: plan?.kind });
                clearPlan();
                this.downSince = null;
            }
            return;
        }

        // Every state below means the server isn't playable right now.
        if (prev === null) {
            this.shown = state.status;
            return;
        }
        if (prev === 'online' && !this.downSince) this.downSince = Date.now();

        if (state.status === 'starting') {
            // The engine never goes back to loading, so this is a new server process.
            this.downTicks = 0;
            this.shown = 'starting';
            if (prev === 'online' && !readPlan()) await this.post('restarting', { uptimeSeconds: this.lastUptime });
            return;
        }

        // offline
        if (prev === 'offline') return;
        if (++this.downTicks < 2) return;
        this.shown = 'offline';
        if (prev === 'online' && !readPlan()) await this.post('offline', { uptimeSeconds: this.lastUptime });
    }

    async post(kind, details) {
        log.info(`server notice: ${kind}`);
        try {
            this.onNotice?.(kind, details);
        } catch (err) {
            log.error('notice hook failed:', err);
        }
        if (!this.enabled) return;
        try {
            const channel = await this.client.channels.fetch(config.statusChannelId);
            await channel.send({ embeds: [noticeEmbed(kind, details)], allowedMentions: { parse: [] } });
        } catch (err) {
            log.warn(`could not post the ${kind} notice: ${err.message}`);
        }
    }
}
