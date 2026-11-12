// Counts running installs of the bot. Each bot sends one small ping a day (see
// bot/src/telemetry.js); this keeps the latest one per install id and how many
// distinct installs pinged each day. IP addresses are used only for the rate
// limit, in memory, and never written down.
//
//   POST /v1/ping    from the bots
//   GET  /v1/badge   shields.io endpoint badge: servers active in the last 7 days
//   GET  /v1/stats   totals and versions (Authorization: Bearer STATS_TOKEN)
//
// No dependencies. Listens on 127.0.0.1 only; Caddy puts HTTPS in front.
//   PORT (8090), DATA_FILE (./installs.json), STATS_TOKEN (required for /v1/stats)

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 8090;
const DATA_FILE = path.resolve(process.env.DATA_FILE || 'installs.json');
const STATS_TOKEN = process.env.STATS_TOKEN || '';
const MAX_BODY = 2048;
const KEEP_DAYS = 400;
const PER_IP_PER_HOUR = 30;
const DAY = 24 * 3600 * 1000;

let data = { installs: {}, daily: {} };
try {
    data = { installs: {}, daily: {}, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} catch (err) {
    if (err.code !== 'ENOENT') {
        console.error(`cannot read ${DATA_FILE}: ${err.message}`);
        process.exit(1);
    }
}

// Written at most every 10 seconds, through a temp file so a crash can't leave half a file.
let dirty = false;
function save() {
    if (!dirty) return;
    dirty = false;
    const tmp = DATA_FILE + '.tmp';
    try {
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, DATA_FILE);
    } catch (err) {
        console.error(`cannot save ${DATA_FILE}: ${err.message}`);
        dirty = true;
    }
}
setInterval(save, 10 * 1000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => (save(), process.exit(0)));

const today = () => new Date().toISOString().slice(0, 10);

function prune() {
    const cutoff = new Date(Date.now() - KEEP_DAYS * DAY).toISOString().slice(0, 10);
    for (const day of Object.keys(data.daily)) if (day < cutoff) delete data.daily[day];
    for (const [id, i] of Object.entries(data.installs)) if (i.last < Date.now() - KEEP_DAYS * DAY) delete data.installs[id];
    dirty = true;
}
setInterval(prune, DAY);

// Only what we expect, in the shape we expect; anything else is dropped.
const VERSION = /^[0-9][0-9.]{0,19}$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const text = (v, re) => (typeof v === 'string' && re.test(v) ? v : '');
function clean(body) {
    if (!body || typeof body !== 'object' || !ID.test(body.id)) return null;
    return {
        bot: text(body.bot, VERSION),
        mod: text(body.mod, VERSION),
        game: text(body.game, /^[0-9]{1,12}$/),
        os: text(body.os, /^[a-z0-9._-]{1,32}$/i),
        node: text(body.node, /^[0-9]{1,3}$/),
        maxPlayers: Number.isInteger(body.maxPlayers) && body.maxPlayers >= 0 && body.maxPlayers <= 1000 ? body.maxPlayers : 0,
        autoUpdate: body.autoUpdate === true,
    };
}

function record(id, fields) {
    const now = Date.now();
    const prev = data.installs[id];
    data.installs[id] = { first: prev?.first || now, ...fields, last: now };
    const day = today();
    const seen = (data.daily[day] ||= []);
    if (!seen.includes(id)) seen.push(id);
    dirty = true;
}

// In memory only: ip -> { hour, count }.
const hits = new Map();
function limited(ip) {
    const hour = Math.floor(Date.now() / 3600000);
    const h = hits.get(ip);
    if (!h || h.hour !== hour) {
        if (hits.size > 50000) hits.clear();
        hits.set(ip, { hour, count: 1 });
        return false;
    }
    return ++h.count > PER_IP_PER_HOUR;
}

const activeSince = ms => Object.values(data.installs).filter(i => i.last >= Date.now() - ms);
function tally(list, key) {
    const out = {};
    for (const i of list) {
        const k = i[key] === '' || i[key] == null ? 'unknown' : String(i[key]);
        out[k] = (out[k] || 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

function stats() {
    const week = activeSince(7 * DAY);
    return {
        active: { day: activeSince(DAY).length, week: week.length, month: activeSince(30 * DAY).length },
        everSeen: Object.keys(data.installs).length,
        newThisWeek: week.filter(i => i.first >= Date.now() - 7 * DAY).length,
        lastWeek: {
            bot: tally(week, 'bot'),
            mod: tally(week, 'mod'),
            game: tally(week, 'game'),
            os: tally(week, 'os'),
            node: tally(week, 'node'),
            maxPlayers: tally(week, 'maxPlayers'),
            autoUpdate: tally(week, 'autoUpdate'),
        },
        daily: Object.fromEntries(Object.entries(data.daily).sort().slice(-60).map(([d, ids]) => [d, ids.length])),
    };
}

function send(res, status, body, headers = {}) {
    const json = typeof body === 'string' ? body : JSON.stringify(body, null, 1);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json', ...headers });
    res.end(json);
}

const ABOUT = `RSDWServerAPI install counter.
The Discord bot sends one anonymous ping a day: a random id, its versions, the OS and two settings.
No IP addresses are stored. Turn it off with BOT_TELEMETRY=false in the bot's .env.
Source: https://github.com/joaopmsilva/RSDWServerAPI/tree/main/stats
`;

http.createServer((req, res) => {
    // Caddy, on this machine, sets X-Forwarded-For; nothing else can reach us.
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
    const url = new URL(req.url, 'http://x');

    if (req.method === 'POST' && url.pathname === '/v1/ping') {
        if (limited(ip)) return send(res, 429, { error: 'slow down' });
        let size = 0;
        const chunks = [];
        req.on('data', c => {
            size += c.length;
            if (size > MAX_BODY) {
                send(res, 413, { error: 'too large' });
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => {
            if (size > MAX_BODY) return;
            let body;
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                return send(res, 400, { error: 'bad json' });
            }
            const fields = clean(body);
            if (!fields) return send(res, 400, { error: 'bad ping' });
            record(body.id, fields);
            send(res, 204, '');
        });
        return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/badge') {
        const n = activeSince(7 * DAY).length;
        return send(res, 200, { schemaVersion: 1, label: 'servers', message: String(n), color: '5865F2', namedLogo: 'discord', logoColor: 'white' }, { 'Cache-Control': 'max-age=3600' });
    }
    if (req.method === 'GET' && url.pathname === '/v1/stats') {
        if (!STATS_TOKEN || req.headers.authorization !== `Bearer ${STATS_TOKEN}`) return send(res, 401, { error: 'unauthorized' });
        return send(res, 200, stats());
    }
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, ABOUT);
    send(res, 404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => console.log(`rsdw-stats on 127.0.0.1:${PORT}, data in ${DATA_FILE}`));
