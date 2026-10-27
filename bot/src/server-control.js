import { execFile } from 'node:child_process';
import { announce } from './announcer.js';
import { restoreFiles } from './backups.js';
import { config } from './config.js';
import { logger } from './log.js';
import { clearPlan } from './notices.js';
import { installedBuild, isNewer, updateServer } from './steam.js';

const log = logger('server');
const SYSTEMCTL = '/bin/systemctl';

// The bot runs as the server's user, which may run exactly these through sudo
// without a password (see DEPLOY.md, "Discord admin commands").
function systemctl(action) {
    return new Promise((resolve, reject) => {
        execFile('sudo', ['-n', SYSTEMCTL, action, config.serverService], { timeout: 180000 }, (err, stdout, stderr) => {
            if (!err) return resolve();
            const text = (stderr || err.message).trim();
            const hint = /password is required|not allowed|may not run/i.test(text)
                ? ' - add the sudoers line from DEPLOY.md ("Discord admin commands")'
                : '';
            reject(new Error(text + hint));
        });
    });
}

// Runs BACKUP_SCRIPT, as the bot's user. The script saves the world first and
// posts its own "Backup complete" notice. Resolves with its output.
export function runBackupScript() {
    return new Promise((resolve, reject) => {
        execFile('bash', [config.backupScript], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
            const output = `${stdout}${stderr}`.trim();
            if (err) return reject(Object.assign(err, { output }));
            resolve(output);
        });
    });
}

// Starts, stops and restarts the game server for /server. A stop or restart can
// wait a few minutes after warning players; only one can be pending at a time.
export class ServerControl {
    constructor(client) {
        this.client = client;
        this.pending = null;
    }

    async post(embed) {
        const channel = await this.client.channels.fetch(config.statusChannelId);
        await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    }

    async start(by) {
        log.info(`start requested by ${by}`);
        await systemctl('start');
    }

    // Stop (after warning players a minute ahead if anyone is online), swap the
    // backup in, start again. The server is always started again, even if the
    // copy fails. Returns the names of the copies kept of the replaced saves.
    async restore(backup, by, playersOnline) {
        if (this.pending) throw new Error(`a ${this.pending.action} is already planned - use cancel first`);
        log.info(`restore of backup ${backup.id} requested by ${by}`);
        const post = embed => this.post(embed);
        const message = 'Restoring a backup';

        this.pending = { action: 'restore', timers: [], by, running: true };
        try {
            if (playersOnline) {
                await announce('stop', { minutes: 1, message, post });
                await new Promise(r => setTimeout(r, 60000));
            } else {
                await announce('stop', { minutes: 0, message, post });
            }
            await systemctl('stop');
            try {
                const kept = restoreFiles(backup);
                log.info(`restored backup ${backup.id}; the replaced saves are kept as ${kept.join(', ')}`);
                return kept;
            } finally {
                await systemctl('start');
            }
        } finally {
            this.pending = null;
        }
    }

    // Without minutes it runs now and throws if systemctl fails. With minutes,
    // notify(text, ok) reports the outcome back to the admin later.
    async schedule(action, minutes, by, notify) {
        if (this.pending) {
            throw new Error(`a ${this.pending.action} is already planned - use cancel first`);
        }
        log.info(`${action} requested by ${by}${minutes ? ` in ${minutes} min` : ''}`);
        const post = embed => this.post(embed);
        await announce(action, { minutes, post });

        const execute = async () => {
            this.pending = null;
            try {
                await systemctl(action);
                log.info(`server ${action} done`);
            } catch (err) {
                clearPlan();
                log.error(`server ${action} failed: ${err.message}`);
                throw err;
            }
        };
        if (!minutes) return execute();

        const run = () =>
            execute().then(
                () => notify?.(`Server ${action === 'stop' ? 'stopped' : 'restarted'}.`, true),
                err => notify?.(`The ${action} failed: ${err.message}`, false),
            );

        const timers = [setTimeout(run, minutes * 60000)];
        if (minutes > 1) {
            timers.push(setTimeout(() => announce(action, { minutes: 1, gameOnly: true }), (minutes - 1) * 60000));
        }
        this.pending = { action, at: Date.now() + minutes * 60000, timers, by };
    }

    // Back up, stop, update with steamcmd, start - after warning players for
    // `minutes`. target is the build being updated to (from the update watcher):
    // if the server already has it by then (the daily update got there first),
    // nothing happens. done(result, err) is called when it's over. notice: false
    // leaves the Discord restart notice out, for when the caller posts its own.
    update(minutes, by, { reason = 'Game update', target = null, done, notice = true } = {}) {
        if (this.pending) throw new Error(`a ${this.pending.action} is already planned - use cancel first`);
        log.info(`update requested by ${by}${minutes ? ` in ${minutes} min` : ''}`);
        const post = embed => this.post(embed);

        const execute = async () => {
            this.pending.running = true;
            try {
                const installed = installedBuild()?.buildId;
                if (target && installed && !isNewer(target, installed)) {
                    log.info(`already on build ${installed}, nothing to update`);
                    clearPlan();
                    await announce('say', { message: 'The server is already up to date - no restart needed.', post });
                    return { from: installed, to: installed, skipped: true };
                }
                try {
                    await runBackupScript();
                    log.info('backup before the update done');
                } catch (err) {
                    // Better updated without a fresh backup than not at all - the hourly ones are still there.
                    log.error(`backup before the update failed: ${err.message}`);
                }
                await announce('restart', { minutes: 0, message: reason, gameOnly: true });
                await systemctl('stop');
                try {
                    const result = await updateServer();
                    log.info(`server updated: build ${result.from} -> ${result.to}`);
                    return result;
                } finally {
                    await systemctl('start');
                }
            } finally {
                this.pending = null;
            }
        };
        const run = () =>
            execute().then(
                result => done?.(result, null),
                err => {
                    log.error(`update failed: ${err.message}`);
                    done?.(null, err);
                },
            );

        const timers = [];
        this.pending = { action: 'update', at: Date.now() + minutes * 60000, timers, by };
        announce('restart', { minutes, message: reason, post: notice ? post : undefined })
            .catch(err => log.warn(`could not announce the update: ${err.message}`))
            .then(() => {
                if (!this.pending || this.pending.timers !== timers) return;
                timers.push(setTimeout(run, minutes * 60000));
                if (minutes > 1) {
                    timers.push(setTimeout(() => announce('restart', { minutes: 1, message: reason, gameOnly: true }), (minutes - 1) * 60000));
                }
            });
    }

    async cancel(by) {
        if (!this.pending) return null;
        if (this.pending.running) throw new Error(`the ${this.pending.action} is already under way and can't be cancelled`);
        const { action, timers } = this.pending;
        for (const timer of timers) clearTimeout(timer);
        this.pending = null;
        clearPlan();
        log.info(`${action} cancelled by ${by}`);

        const text = `The planned ${action === 'stop' ? 'shutdown' : action === 'update' ? 'update and restart' : 'restart'} is cancelled.`;
        this.onCancel?.(action);
        await announce('say', { message: text, post: embed => this.post(embed) });
        return action;
    }
}
