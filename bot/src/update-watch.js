import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { updateDoneEmbed, updateFailedEmbed, updateOutdatedEmbed } from './embeds.js';
import { logger } from './log.js';
import { installedBuild, isNewer, latestBuild } from './steam.js';

const log = logger('updates');

// Checks Steam every UPDATE_CHECK_MINUTES for a newer build of the dedicated
// server. When there is one it warns in the status channel and, with
// AUTO_UPDATE, backs up, updates and restarts AUTO_UPDATE_MINUTES later (at once
// if nobody is on). Each build is announced and tried once - after a cancel or
// a failed update the daily update takes over. data/updates.json remembers.
export class UpdateWatcher {
    constructor(client, poller, control) {
        this.client = client;
        this.poller = poller;
        this.control = control;
        this.file = path.join(config.dataDir, 'updates.json');
        this.state = { notified: null, attempted: null };
        this.lastError = '';
        try {
            this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    start() {
        if (!config.updateWatch) return;
        if (!installedBuild()) {
            log.info(`no ${config.serverDir}/steamapps/appmanifest_${config.steamAppId}.acf - the update watcher is off (check SERVER_DIR)`);
            return;
        }
        log.info(`checking Steam for server updates every ${config.updateCheckMinutes} min${config.autoUpdate ? `, updating ${config.autoUpdateMinutes} min after one is out` : ''}`);
        // Give the poller a moment to learn whether the server is up.
        setTimeout(() => this.check(), 60 * 1000);
        setInterval(() => this.check(), config.updateCheckMinutes * 60 * 1000);
    }

    save() {
        try {
            fs.writeFileSync(this.file, JSON.stringify(this.state));
        } catch (err) {
            log.error(`could not save ${this.file}: ${err.message}`);
        }
    }

    async post(embed) {
        if (!config.statusChannelId) return;
        try {
            const channel = await this.client.channels.fetch(config.statusChannelId);
            await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
        } catch (err) {
            log.warn(`could not post the update notice: ${err.message}`);
        }
    }

    async check() {
        const installed = installedBuild();
        if (!installed) return;
        let latest;
        try {
            latest = await latestBuild();
            this.lastError = '';
        } catch (err) {
            if (err.message !== this.lastError) log.warn(`could not check for updates: ${err.message}`);
            this.lastError = err.message;
            return;
        }
        if (!isNewer(latest.buildId, installed.buildId)) return;
        if (this.state.notified === latest.buildId && this.state.attempted === latest.buildId) return;
        if (this.control.pending) return; // Something else is planned; look again next time.

        const { status, players } = this.poller.state;
        const up = status === 'online' || status === 'starting';
        let mode = 'manual';
        let minutes = 0;
        if (config.autoUpdate && this.state.attempted !== latest.buildId) {
            mode = up ? 'scheduled' : 'offline';
            minutes = players.length ? config.autoUpdateMinutes : 0;
        }

        log.info(`server is out of date: build ${installed.buildId}, Steam has ${latest.buildId} - ${mode}`);
        if (mode === 'scheduled') {
            try {
                this.control.update(minutes, 'update watcher', {
                    target: latest.buildId,
                    notice: false,
                    done: (result, err) => this.finished(result, err),
                });
            } catch (err) {
                log.warn(`could not schedule the update: ${err.message}`);
                return;
            }
            this.state.attempted = latest.buildId;
        }
        if (this.state.notified !== latest.buildId || mode === 'scheduled') {
            await this.post(updateOutdatedEmbed({ installed, latest, mode, minutes }));
        }
        this.state.notified = latest.buildId;
        this.save();
    }

    // Also called for /server update.
    finished(result, err) {
        if (err) return this.post(updateFailedEmbed(err.message));
        if (result && !result.skipped) return this.post(updateDoneEmbed(result));
    }
}
