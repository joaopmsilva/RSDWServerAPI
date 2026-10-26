import { execFile } from 'node:child_process';
import { announce } from './announcer.js';
import { config } from './config.js';
import { logger } from './log.js';
import { clearPlan } from './notices.js';

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

    async cancel(by) {
        if (!this.pending) return null;
        const { action, timers } = this.pending;
        for (const timer of timers) clearTimeout(timer);
        this.pending = null;
        clearPlan();
        log.info(`${action} cancelled by ${by}`);

        const text = `The planned ${action === 'stop' ? 'shutdown' : 'restart'} is cancelled.`;
        await announce('say', { message: text, post: embed => this.post(embed) });
        return action;
    }
}
