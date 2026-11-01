import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { api } from './api.js';
import { config } from './config.js';

// /admin performance: how the game server is coping, measured on the spot.
//   - CPU per thread over a few seconds, from /proc: the game's main thread
//     (the one that has to finish each tick in time), the mod's thread, the
//     game's workers; and the VPS's load, steal time and memory.
//   - The server's real tick rate and its stalls, from the frame counter on
//     every line of the game's log: lines say [time][frame], so a stretch where
//     the frames don't keep up with the clock is the server falling behind.
// Linux only: it reads the game's /proc entries, so the bot must run on the
// same machine, as the same user as the server.

const TICKS_PER_SECOND = 100; // USER_HZ, what /proc counts CPU time in
const TARGET_TICK_RATE = 30; // the server's "max tick rate", from its log
const SAMPLE_MS = 5000;
const LOG_WINDOW_MS = 30 * 60 * 1000;
const LOG_TAIL_BYTES = 16 * 1024 * 1024;
const STALL_SECONDS = 0.1;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function gamePid() {
    for (const entry of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
            if (fs.readlinkSync(`/proc/${entry}/exe`).includes('RSDragonwildsServer-Linux-Shipping')) return Number(entry);
        } catch {
            // Another user's process, or gone.
        }
    }
    return null;
}

// tid -> { name, ticks } (user + system CPU time so far).
function threadTimes(pid) {
    const out = new Map();
    for (const tid of fs.readdirSync(`/proc/${pid}/task`)) {
        try {
            const stat = fs.readFileSync(`/proc/${pid}/task/${tid}/stat`, 'utf8');
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const name = fs.readFileSync(`/proc/${pid}/task/${tid}/comm`, 'utf8').trim();
            out.set(Number(tid), { name, ticks: Number(fields[11]) + Number(fields[12]) });
        } catch {
            // The thread ended between listing and reading.
        }
    }
    return out;
}

// The machine's CPU counters: total and steal (time the host gave to others).
function machineTimes() {
    const [, ...values] = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/);
    const n = values.map(Number);
    return { total: n.reduce((a, b) => a + b, 0), idle: n[3] + (n[4] || 0), steal: n[7] || 0 };
}

async function sampleCpu(pid) {
    const threads0 = threadTimes(pid);
    const machine0 = machineTimes();
    await sleep(SAMPLE_MS);
    const threads1 = threadTimes(pid);
    const machine1 = machineTimes();

    const seconds = SAMPLE_MS / 1000;
    const percent = ticks => (ticks / TICKS_PER_SECOND / seconds) * 100;
    const groups = { main: 0, mod: 0, workers: 0, other: 0 };
    for (const [tid, now] of threads1) {
        const before = threads0.get(tid);
        const used = percent(now.ticks - (before ? before.ticks : now.ticks));
        if (tid === pid) groups.main += used;
        // The mod names its thread (0.9.1+); before that it's the first thread after main.
        else if (now.name === 'rsdwapi' || (tid === pid + 1 && ![...threads1.values()].some(t => t.name === 'rsdwapi'))) groups.mod += used;
        else if (/^(Backgro|Foregro|FAsync|TaskGraph)/.test(now.name)) groups.workers += used;
        else groups.other += used;
    }
    const total = machine1.total - machine0.total || 1;
    return {
        ...groups,
        threads: threads1.size,
        machineBusy: ((total - (machine1.idle - machine0.idle)) / total) * 100,
        steal: ((machine1.steal - machine0.steal) / total) * 100,
    };
}

function residentMb(pid) {
    const line = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^VmRSS:\s+(\d+)/m);
    return line ? Math.round(Number(line[1]) / 1024) : null;
}

function availableMb() {
    const line = fs.readFileSync('/proc/meminfo', 'utf8').match(/^MemAvailable:\s+(\d+)/m);
    return line ? Math.round(Number(line[1]) / 1024) : Math.round(os.freemem() / 1048576);
}

// What a stall was most likely about, from the line logged right after it.
function stallCause(text) {
    if (/Save to slot/i.test(text)) return 'world autosave';
    if (/Teleport/i.test(text)) return 'a teleport or respawn';
    if (/Clothing Actors|Possess|PostLogin|Join/i.test(text)) return 'a player loading in';
    if (/LoadMap|Bringing World|FlushAsyncLoading/i.test(text)) return 'map loading';
    if (/Attack|AI_|Combat|Spell/i.test(text)) return 'a fight';
    return text.replace(/^\s*\w+:\s*(Verbose:|Display:|Warning:|Error:)?\s*(\[DedicatedServer\])?\s*/, '').slice(0, 50) || 'unknown';
}

const LINE = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]\[\s*(\d+)\](.*)/;

function tickStats() {
    const file = path.join(config.serverDir, 'RSDragonwilds', 'Saved', 'Logs', 'RSDragonwilds.log');
    const size = fs.statSync(file).size;
    const length = Math.min(size, LOG_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
        fs.readSync(fd, buffer, 0, length, size - length);
    } finally {
        fs.closeSync(fd);
    }

    const lines = [];
    for (const raw of buffer.toString('utf8').split('\n')) {
        const m = LINE.exec(raw);
        if (!m) continue;
        const time = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
        lines.push({ time, frame: Number(m[8]), text: m[9] });
    }
    if (lines.length < 2) return null;

    const end = lines.at(-1).time;
    const start = Math.max(lines[0].time, end - LOG_WINDOW_MS);
    let seconds = 0;
    let frames = 0;
    const stalls = [];
    for (let i = 1; i < lines.length; i++) {
        const a = lines[i - 1];
        const b = lines[i];
        if (a.time < start) continue;
        const dt = (b.time - a.time) / 1000;
        if (dt <= 0 || dt > 5) continue; // a quiet log, not a stall
        // The frame counter in the log wraps at 1000.
        const df = (b.frame - a.frame + 1000) % 1000;
        seconds += dt;
        frames += df;
        if (dt >= STALL_SECONDS && df < dt * TARGET_TICK_RATE * 0.5) stalls.push({ at: a.time, seconds: dt, cause: stallCause(b.text) });
    }
    if (!seconds) return null;
    stalls.sort((x, y) => y.seconds - x.seconds);
    return {
        minutes: (end - start) / 60000,
        tickRate: frames / seconds,
        stalls: stalls.length,
        longest: stalls.slice(0, 3),
        causes: stalls.reduce((acc, s) => ((acc[s.cause] = (acc[s.cause] || 0) + 1), acc), {}),
    };
}

export async function measurePerformance() {
    if (process.platform !== 'linux') throw new Error('this measures the server through /proc, so the bot has to run on the Linux server itself');
    const pid = gamePid();
    if (!pid) throw new Error("the game server isn't running (or runs as another user than the bot)");

    const [cpu, players, health] = await Promise.all([
        sampleCpu(pid),
        api.players().catch(() => null),
        api.health().catch(() => null),
    ]);
    let ticks = null;
    try {
        ticks = tickStats();
    } catch {
        // No readable log: the rest still shows.
    }
    return {
        cpu,
        ticks,
        players: (players || []).map(p => ({ name: p.characterName || p.name, ping: p.pingMs })),
        modVersion: health?.version || null,
        residentMb: residentMb(pid),
        availableMb: availableMb(),
        cores: os.cpus().length,
        load: os.loadavg(),
        sampleSeconds: SAMPLE_MS / 1000,
        targetTickRate: TARGET_TICK_RATE,
    };
}
