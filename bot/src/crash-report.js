import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.js';
import { formatDuration } from './embeds.js';
import { logger } from './log.js';

const log = logger('crash');

// When the server goes down or restarts without a plan, this gathers everything
// that says why into one text file in data/crashes/ and works out the most
// likely cause. Sources, all optional:
//   rsdwapi/exits.log      how each run ended (ExecStopPost in dragonwilds.service)
//   rsdwapi/logs/crash.log the mod's backtrace when the process crashes
//   rsdwapi/logs/api*.log  the mod's log of the run that died
//   Saved/Logs, Saved/Crashes  the game's own log and crash report
//   journalctl             the service and the kernel (out-of-memory kills)

const REPORT_DIR = path.join(config.dataDir, 'crashes');
const INDEX_FILE = path.join(REPORT_DIR, 'index.json');
const KEEP = 30;
const MOD_DIR = path.join(config.serverDir, 'rsdwapi');
const SAVED_DIR = path.join(config.serverDir, 'RSDragonwilds', 'Saved');
// Exit statuses of a shell whose child died of a signal are 128 + the signal.
const SIGNAL_NUMBERS = { 129: 'HUP', 130: 'INT', 132: 'ILL', 134: 'ABRT', 135: 'BUS', 136: 'FPE', 137: 'KILL', 139: 'SEGV', 143: 'TERM' };
const CRASH_LINE = /caught signal|fatal error|assertion failed|critical error|unhandled exception|segmentation fault|sigsegv|out of memory|ran out of memory/i;

function run(cmd, args) {
    return new Promise(resolve => {
        execFile(cmd, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
            resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') }),
        );
    });
}

function readText(file) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return null;
    }
}

function tail(text, lines) {
    return text.split('\n').filter((l, i, all) => l || i < all.length - 1).slice(-lines).join('\n');
}

// The log file a run that ended at `at` wrote to: the newest one written by
// then. A restart renames the old log, keeping its time, so once the server is
// back the active log (`active`) belongs to the new run and is skipped.
function logOfRun(dir, test, at, active) {
    let best = null;
    try {
        for (const name of fs.readdirSync(dir)) {
            if (!test(name) || name === active) continue;
            const file = path.join(dir, name);
            const mtime = fs.statSync(file).mtimeMs;
            if (mtime > at + 10000) continue;
            if (!best || mtime > best.mtime) best = { file, mtime };
        }
    } catch {
        // folder missing
    }
    return best;
}

// The last line of exits.log, if it's about this outage: "<unix> <result> <code> <status>".
function lastExit(detectedAt) {
    const text = readText(path.join(MOD_DIR, 'exits.log'));
    if (text === null) return { missing: true };
    const line = text.trim().split('\n').pop() || '';
    const [time, result, code, status] = line.trim().split(/\s+/);
    const at = Number(time) * 1000;
    if (!at || Math.abs(detectedAt - at) > 20 * 60 * 1000) return null;
    let signal = code === 'killed' || code === 'dumped' ? status : null;
    if (!signal && code === 'exited' && SIGNAL_NUMBERS[status]) signal = SIGNAL_NUMBERS[status];
    return { at, result, code, status, signal, line };
}

function modCrash(at) {
    const text = readText(path.join(MOD_DIR, 'logs', 'crash.log'));
    if (!text) return null;
    const blocks = text.split('=== server crashed ===').slice(1);
    for (const block of blocks.reverse()) {
        const time = Number(block.match(/time: (\d+)/)?.[1]) * 1000;
        if (!time || time > at + 2 * 60000 || time < at - 20 * 60000) continue;
        return {
            text: ('=== server crashed ===' + block.split('=== end ===')[0]).trim(),
            signal: block.match(/signal: \d+ ([^\n]+)/)?.[1] || '',
            where: block.match(/crashed in: ([^\n]+)/)?.[1] || '',
        };
    }
    return null;
}

function gameCrashReport(at) {
    const dir = path.join(SAVED_DIR, 'Crashes');
    let newest = null;
    try {
        for (const name of fs.readdirSync(dir)) {
            const full = path.join(dir, name);
            const mtime = fs.statSync(full).mtimeMs;
            if (Math.abs(mtime - at) > 20 * 60000) continue;
            if (!newest || mtime > newest.mtime) newest = { full, mtime, name };
        }
    } catch {
        return null;
    }
    if (!newest) return null;
    const xml = readText(path.join(newest.full, 'CrashContext.runtime-xml')) || '';
    const tag = name => {
        const value = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || '';
        return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
    };
    return { folder: newest.full, error: tag('ErrorMessage'), stack: tail(tag('CallStack'), 25) };
}

function gameLog(at, active) {
    const found = logOfRun(path.join(SAVED_DIR, 'Logs'), name => name.endsWith('.log'), at, active && 'RSDragonwilds.log');
    if (!found) return null;
    const lines = (readText(found.file) || '').split('\n');
    let from = -1;
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3000); i--) {
        if (CRASH_LINE.test(lines[i])) from = i;
    }
    const crash = from >= 0 ? lines.slice(Math.max(0, from - 5), from + 60).join('\n') : '';
    return { file: found.file, crash, firstCrashLine: from >= 0 ? lines[from].trim() : '', tail: tail(lines.join('\n'), 40) };
}

function modLog(at, active) {
    const found = logOfRun(path.join(MOD_DIR, 'logs'), name => /^api(-.*)?\.log$/.test(name), at, active && 'api.log');
    if (!found) return null;
    const text = readText(found.file) || '';
    const heartbeats = text.split('\n').filter(l => l.includes('Heartbeat:'));
    return {
        file: found.file,
        clean: text.includes('server is shutting down normally'),
        heartbeat: heartbeats.pop() || '',
        tail: tail(text, 30),
    };
}

const PERMISSION_HINT = /insufficient permissions|not seeing messages|no journal files/i;

async function journal(at) {
    const since = `@${Math.floor((at - 15 * 60000) / 1000)}`;
    const until = `@${Math.floor((at + 2 * 60000) / 1000)}`;
    const service = await run('journalctl', ['-u', config.serverService, '--since', since, '--until', until, '-n', '80', '--no-pager', '-o', 'short-iso']);
    const kernel = await run('journalctl', ['-k', '--since', since, '--until', until, '--no-pager', '-o', 'short-iso']);
    const oom = kernel.out.split('\n').filter(l => /out of memory|oom-kill|killed process|oom_reaper/i.test(l));
    const denied = PERMISSION_HINT.test(service.err + service.out) || PERMISSION_HINT.test(kernel.err + kernel.out);
    return { service: tail(service.out, 80), oom, denied };
}

function signalText(signal) {
    return (
        {
            SEGV: 'a crash (SIGSEGV, bad memory access)',
            ABRT: 'a crash (SIGABRT, usually a failed check in the game)',
            BUS: 'a crash (SIGBUS)',
            ILL: 'a crash (SIGILL)',
            FPE: 'a crash (SIGFPE)',
            KILL: 'a hard kill (SIGKILL)',
            TERM: 'a stop request (SIGTERM)',
            INT: 'a stop request (SIGINT)',
            HUP: 'a hang-up (SIGHUP)',
        }[signal] || `signal ${signal}`
    );
}

// The most likely cause, from the strongest evidence down.
function verdict(r) {
    if (r.journal?.oom.some(l => /rsdragon|unrealserver|dragonwild/i.test(l)) || r.exit?.result === 'oom-kill') {
        return { cause: 'oom', text: 'The VPS ran out of memory and Linux killed the game server (out-of-memory killer).' };
    }
    if (r.kind === 'reboot' && !r.modCrash) {
        return { cause: 'reboot', text: `The whole VPS restarted (it has only been up ${formatDuration(r.systemUptimeSeconds)}). If nobody rebooted it, check your VPS provider's panel for maintenance.` };
    }
    if (r.modCrash) {
        const where = r.modCrash.where;
        const inMod = /^the mod/.test(where);
        const fromMod = /called from the mod/.test(where);
        return {
            cause: inMod ? 'mod-crash' : 'crash',
            text: `The server crashed: ${r.modCrash.signal || 'fatal signal'}.\n` +
                (inMod
                    ? '**The crash was inside the mod (librsdwapi.so).** Send this report to whoever maintains the mod.'
                    : fromMod
                      ? 'It crashed in the game while the mod was calling into it - the mod may be involved.'
                      : /no mod code/.test(where)
                        ? "It crashed in the game's own code, with no mod code involved."
                        : 'Where in the code is unknown - see the backtrace in the report.'),
        };
    }
    if (r.exit?.signal && !['TERM', 'INT', 'KILL', 'HUP'].includes(r.exit.signal)) {
        return { cause: 'crash', text: `The server process died of ${signalText(r.exit.signal)}.` };
    }
    if (r.gameCrash?.error || r.game?.firstCrashLine) {
        return { cause: 'crash', text: `The game reported a crash: \`${(r.gameCrash?.error || r.game.firstCrashLine).slice(0, 300)}\`` };
    }
    if (r.exit?.signal === 'KILL') {
        return { cause: 'killed', text: 'The server was killed outright (SIGKILL). That is usually the out-of-memory killer, a `kill -9`, or systemd giving up on a stop that took over 60s.' };
    }
    if (r.exit?.signal === 'TERM' || r.exit?.signal === 'INT') {
        return { cause: 'stopped', text: `It was asked to stop (${r.exit.signal}) by something other than the bot: \`systemctl stop/restart\` by hand, a cron script, or the VPS shutting down.` };
    }
    if (r.exit?.code === 'exited') {
        return r.exit.status === '0'
            ? { cause: 'exited', text: 'The game shut itself down normally (exit code 0) without anyone asking - check the end of the game log below.' }
            : { cause: 'exited', text: `The game quit with error code ${r.exit.status} - check the end of the game log below.` };
    }
    if (r.mod && !r.mod.clean) {
        return { cause: 'unknown', text: "The server process ended abruptly (the mod's log has no shutdown line), but nothing recorded why. Most often that's a hard kill or the VPS rebooting." };
    }
    return { cause: 'unknown', text: 'Nothing recorded why it went down.' };
}

function section(title, body) {
    return body ? `\n\n===== ${title} =====\n${body.trim()}` : '';
}

function formatReport(r) {
    const when = new Date(r.downAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
    const lines = [
        `${config.serverName} - unplanned ${{ offline: 'shutdown', reboot: 'VPS reboot' }[r.kind] || 'restart'}`,
        `Noticed:   ${when}`,
        `Verdict:   ${r.verdict.text.replace(/\*\*|`/g, '')}`,
        r.uptimeSeconds != null ? `Had been up: ${formatDuration(r.uptimeSeconds)}` : '',
        r.exit?.at ? `systemd:   result=${r.exit.result} ${r.exit.code}=${r.exit.status} (${new Date(r.exit.at).toISOString()})` : '',
        r.mod?.heartbeat ? `Last heartbeat: ${r.mod.heartbeat}` : '',
        `VPS:       up ${formatDuration(r.systemUptimeSeconds)}, ${Math.round((os.totalmem() - os.freemem()) / 2 ** 20)} of ${Math.round(os.totalmem() / 2 ** 20)} MB RAM in use now`,
        r.mod ? `Mod log:   ${r.mod.clean ? 'ended with a normal shutdown' : 'ends without a shutdown line (crash or kill)'}` : '',
    ].filter(Boolean);
    const notes = [];
    if (r.exit?.missing) notes.push(`${path.join(MOD_DIR, 'exits.log')} doesn't exist - install the updated dragonwilds.service (DEPLOY.md) so systemd records how each run ends.`);
    if (r.journal?.denied) notes.push(`journalctl isn't readable by the bot - run: sudo usermod -aG systemd-journal ${os.userInfo().username} && sudo systemctl restart rsdw-bot`);

    return (
        lines.join('\n') +
        section('Notes', notes.join('\n')) +
        section('Kernel out-of-memory messages', r.journal?.oom.join('\n')) +
        section('Mod crash log (rsdwapi/logs/crash.log)', r.modCrash?.text) +
        section(`Game crash report (${r.gameCrash?.folder || ''})`, r.gameCrash ? [r.gameCrash.error, r.gameCrash.stack].filter(Boolean).join('\n\n') : '') +
        section(`Game log around the crash (${r.game?.file || ''})`, r.game?.crash) +
        section(`End of the game log (${r.game?.file || ''})`, r.game?.tail) +
        section(`End of the mod log (${r.mod?.file || ''})`, r.mod?.tail) +
        section(`journalctl -u ${config.serverService}`, r.journal?.service) +
        '\n'
    );
}

function readIndex() {
    try {
        return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
    } catch {
        return [];
    }
}

// The newest reports first: { at, kind, cause, verdict, file }.
export function listCrashReports() {
    return readIndex()
        .filter(e => fs.existsSync(path.join(REPORT_DIR, e.file)))
        .reverse();
}

export function crashReportPath(entry) {
    return path.join(REPORT_DIR, entry.file);
}

// kind is the notice (offline / restarting / restarted), or reboot when the bot
// starts on a VPS that has just booted; downAt is when it was noticed.
export async function buildCrashReport({ kind, downAt, uptimeSeconds }) {
    const exit = lastExit(downAt);
    const at = exit && !exit.missing ? exit.at : downAt;
    // The server is running again (it restarted, or the VPS booted), so its
    // active logs belong to the new run.
    const restarted = kind !== 'offline';
    const r = {
        kind,
        downAt,
        uptimeSeconds,
        exit,
        systemUptimeSeconds: os.uptime(),
        modCrash: modCrash(at),
        gameCrash: gameCrashReport(at),
        game: gameLog(at, restarted),
        mod: modLog(at, restarted),
        journal: process.platform === 'linux' ? await journal(at) : null,
    };
    r.verdict = verdict(r);
    const text = formatReport(r);

    const stamp = new Date(downAt).toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const file = `crash-${stamp}.txt`;
    try {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
        fs.writeFileSync(path.join(REPORT_DIR, file), text);
        const index = readIndex();
        index.push({ at: downAt, kind, cause: r.verdict.cause, verdict: r.verdict.text, file });
        for (const old of index.splice(0, Math.max(0, index.length - KEEP))) {
            fs.rm(path.join(REPORT_DIR, old.file), { force: true }, () => {});
        }
        fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 1));
    } catch (err) {
        log.error(`could not save the crash report: ${err.message}`);
    }
    log.warn(`unplanned ${kind}: ${r.verdict.text.replace(/\*\*|`/g, '').split('\n').join(' ')} (data/crashes/${file})`);
    return { file: path.join(REPORT_DIR, file), name: file, verdict: r.verdict, uptimeSeconds, exit: r.exit, mod: r.mod };
}
