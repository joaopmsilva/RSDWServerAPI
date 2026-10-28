import os from 'node:os';
import { EmbedBuilder } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { buildCrashReport } from './crash-report.js';
import { crashReportEmbed, formatDuration } from './embeds.js';
import { logger } from './log.js';
import { systemStats } from './system.js';

const log = logger('alerts');
const RESOURCE_EVERY_MS = 60 * 1000;
const DIAGNOSTICS_EVERY_MS = 5 * 60 * 1000;
// Long enough for systemd to log the exit and the new run to rotate the old logs.
const REPORT_DELAY_MS = 45 * 1000;
// A bot starting on a VPS up for less than this means the VPS rebooted.
const REBOOT_WINDOW_S = 15 * 60;
// Consecutive minutes over the limit before alerting, so a short spike stays quiet.
const SUSTAINED = { cpu: 5, ram: 3, disk: 1 };
const RESOURCE_NAMES = { cpu: 'CPU', ram: 'RAM', disk: 'Disk' };

// Private messages to everyone in ADMIN_USER_IDS: the server going down without
// a planned restart, the VPS running hot, and the mod's self-check failing
// (usually right after a game update).
export class Alerts {
    constructor(client, poller) {
        this.client = client;
        this.poller = poller;
        this.timers = [];
        this.crashedAt = 0;
        this.over = { cpu: 0, ram: 0, disk: 0 };
        this.alerted = { cpu: false, ram: false, disk: false };
        this.lastProblems = null;
        this.previousResult = null;
    }

    get enabled() {
        return config.adminAlerts && config.adminUserIds.length > 0;
    }

    start() {
        // A reboot restarts the bot too, so no notice ever sees it go down.
        if (process.platform === 'linux' && os.uptime() < REBOOT_WINDOW_S) {
            const downAt = Date.now() - os.uptime() * 1000;
            setTimeout(() => this.report('reboot', downAt, null), 2 * 60 * 1000);
        }
        if (!this.enabled) {
            log.info(config.adminUserIds.length ? 'admin alerts are off' : 'no ADMIN_USER_IDS, admin alerts are off');
            return;
        }
        log.info(`sending alerts to ${config.adminUserIds.length} admin(s)`);
        if (process.platform === 'linux') {
            this.timers.push(setInterval(() => this.checkResources().catch(err => log.warn(`resource check failed: ${err.message}`)), RESOURCE_EVERY_MS));
        }
        this.timers.push(setInterval(() => this.checkDiagnostics(), DIAGNOSTICS_EVERY_MS));
    }

    stop() {
        for (const t of this.timers) clearInterval(t);
    }

    async dm(title, text, color) {
        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(text).setFooter({ text: config.serverName }).setTimestamp();
        await this.send({ embeds: [embed] });
        log.info(`alert: ${title}`);
    }

    async send(message) {
        for (const id of config.adminUserIds) {
            try {
                const user = await this.client.users.fetch(id);
                await user.send(message);
            } catch (err) {
                log.warn(`could not message admin ${id}: ${err.message} - they need to share a server with the bot and allow DMs`);
            }
        }
    }

    // Saved to data/crashes/ whether or not admin alerts are on; /admin crashes lists them.
    async report(kind, downAt, uptimeSeconds) {
        let report;
        try {
            report = await buildCrashReport({ kind, downAt, uptimeSeconds });
        } catch (err) {
            log.error('crash report failed:', err);
            return;
        }
        if (!this.enabled) return;
        await this.send({ embeds: [crashReportEmbed(report)], files: [{ attachment: report.file, name: report.name }] });
        log.info(`alert: crash report ${report.name}`);
    }

    // From the server notices. Offline / restarting / restarted are only
    // posted when nothing was planned, so each one is a crash or a manual stop.
    notice(kind, details) {
        if (kind === 'offline' || kind === 'restarting' || kind === 'restarted') {
            const downAt = Date.now();
            setTimeout(() => this.report(kind, downAt, details?.uptimeSeconds ?? null), REPORT_DELAY_MS);
        }
        if (!this.enabled) return;
        if (kind === 'offline' || kind === 'restarting' || kind === 'restarted') {
            if (kind !== 'restarted') this.crashedAt = Date.now();
            const what = { offline: 'went offline', restarting: 'restarted by itself', restarted: 'restarted by itself' }[kind];
            this.dm(`⚠️ Server ${what}`, 'There was no planned restart or stop. Working out why - a report follows in about a minute.', 0xe74c3c);
        } else if (kind === 'online' && this.crashedAt) {
            const down = formatDuration((details?.downtimeMs ?? Date.now() - this.crashedAt) / 1000);
            this.crashedAt = 0;
            this.dm('✅ Server is back online', `It was down for ${down}.`, 0x2ecc71);
            // A fresh start is when a game update shows up - check the mod soon.
            setTimeout(() => this.checkDiagnostics(), 90 * 1000);
        } else if (kind === 'online') {
            setTimeout(() => this.checkDiagnostics(), 90 * 1000);
        }
    }

    async checkResources() {
        const s = await systemStats();
        const usage = {
            cpu: s.cpu.usage * 100,
            ram: (s.memory.used / s.memory.total) * 100,
            disk: s.disk ? (s.disk.used / s.disk.total) * 100 : 0,
        };
        const limits = { cpu: config.alertCpu, ram: config.alertRam, disk: config.alertDisk };

        for (const what of Object.keys(usage)) {
            const limit = limits[what];
            if (!limit) continue;
            if (usage[what] >= limit) {
                this.over[what]++;
                if (!this.alerted[what] && this.over[what] >= SUSTAINED[what]) {
                    this.alerted[what] = true;
                    const how = SUSTAINED[what] > 1 ? ` for ${SUSTAINED[what]} minutes` : '';
                    this.dm(`🔥 ${RESOURCE_NAMES[what]} at ${Math.round(usage[what])}%`, `Over ${limit}%${how}. The status board's footer shows the current load.`, 0xe67e22);
                }
            } else {
                this.over[what] = 0;
                // Settle a little below the limit before calling it fixed.
                if (this.alerted[what] && usage[what] < limit - 5) {
                    this.alerted[what] = false;
                    this.dm(`✅ ${RESOURCE_NAMES[what]} back to ${Math.round(usage[what])}%`, `Below ${limit}% again.`, 0x2ecc71);
                }
            }
        }
    }

    // Messages only when the set of failing checks changes.
    async checkDiagnostics() {
        if (!this.enabled || this.poller.state.status !== 'online') return;
        let diag;
        try {
            diag = await api.diagnostics();
        } catch (err) {
            if (err.status !== 404) log.debug(`diagnostics unavailable: ${err.message}`);
            return;
        }

        const problems = diag.checks.filter(c => c.ok === false);
        const key = problems.map(c => c.name).join(',');
        // Only act on a result seen twice in a row: a player still loading in has
        // no skills or health for a moment, which isn't worth a message.
        const stable = key === this.previousResult;
        this.previousResult = key;
        if (!stable || key === this.lastProblems) return;
        const first = this.lastProblems === null;
        this.lastProblems = key;

        if (problems.length) {
            const lines = problems.map(c => `❌ **${c.name}** · ${c.detail}`).join('\n');
            this.dm('🩺 The mod found a problem', `${lines}\n\nOften caused by a game update. \`/admin diagnostics\` shows every check.`, 0xe74c3c);
        } else if (!first) {
            this.dm('🩺 The mod is healthy again', 'Every check passes.', 0x2ecc71);
        }
    }
}
