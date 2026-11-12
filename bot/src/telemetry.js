import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './api.js';
import { config } from './config.js';
import { BOT_VERSION } from './self-update.js';
import { installedBuild } from './steam.js';
import { logger } from './log.js';

const log = logger('telemetry');

// Once a day the bot tells the project it's still running, so we know how many
// servers use it and which versions they're on. What's sent is the payload below
// and nothing else: a random id made on this machine (not tied to the server,
// Discord or anyone), the versions, the OS and two settings. The collector keeps
// no IP addresses. BOT_TELEMETRY=false turns it off.
const STATE_FILE = path.join(config.dataDir, 'telemetry.json');
const FIRST_DELAY = 5 * 60 * 1000;
const EVERY = 24 * 3600 * 1000;

function installId() {
    try {
        const id = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).id;
        if (/^[0-9a-f-]{36}$/.test(id)) return id;
    } catch {}
    const id = randomUUID();
    try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify({ id }, null, 1));
    } catch (err) {
        log.debug(`could not save ${STATE_FILE}: ${err.message}`);
    }
    return id;
}

// "ubuntu-24.04", "debian-12"
function osName() {
    try {
        const text = fs.readFileSync('/etc/os-release', 'utf8');
        const field = name => new RegExp(`^${name}="?([^"\\n]*)"?`, 'm').exec(text)?.[1] || '';
        return [field('ID'), field('VERSION_ID')].filter(Boolean).join('-') || process.platform;
    } catch {
        return process.platform;
    }
}

async function payload(id) {
    let mod = '';
    try {
        mod = (await api.health()).version || '';
    } catch {}
    return {
        id,
        bot: BOT_VERSION,
        mod,
        game: installedBuild()?.buildId || '',
        os: osName(),
        node: process.versions.node.split('.')[0],
        maxPlayers: config.maxPlayers || 0,
        autoUpdate: config.selfUpdateAuto,
    };
}

async function ping(id) {
    const body = await payload(id);
    const res = await fetch(config.telemetryUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': `rsdw-bot/${BOT_VERSION}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
    });
    log.debug(`ping: HTTP ${res.status}`);
}

export function startTelemetry() {
    if (!config.telemetry || !config.telemetryUrl) {
        log.info('the daily install count ping is off (BOT_TELEMETRY=false)');
        return;
    }
    const id = installId();
    const send = () => ping(id).catch(err => log.debug(`ping failed: ${err.cause?.code || err.message}`));
    setTimeout(send, FIRST_DELAY).unref();
    setInterval(send, EVERY).unref();
}
