import fs from 'node:fs';
import path from 'node:path';

// Timestamped logging to stdout (journald under systemd) and to a log file,
// rotated at 5MB with the previous file kept as bot.log.1.

const MAX_BYTES = 5 * 1024 * 1024;
const debugEnabled = /^(1|true|yes)$/i.test(process.env.DEBUG || '');

let file = null;

export function initLogFile(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
        file = path.join(dir, 'bot.log');
    } catch (err) {
        console.error(`Log: cannot write to ${dir}: ${err.message}`);
    }
}

function rotate() {
    try {
        if (fs.statSync(file).size < MAX_BYTES) return;
        fs.renameSync(file, file + '.1');
    } catch {
        // missing file is fine
    }
}

function write(level, scope, args) {
    const text = args
        .map(a => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
        .join(' ');
    const line = `${new Date().toISOString()} ${level.padEnd(5)} [${scope}] ${text}`;

    (level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log)(line);

    if (!file) return;
    try {
        rotate();
        fs.appendFileSync(file, line + '\n');
    } catch {
        // never let logging take the bot down
    }
}

export function logger(scope) {
    return {
        debug: (...args) => debugEnabled && write('DEBUG', scope, args),
        info: (...args) => write('INFO', scope, args),
        warn: (...args) => write('WARN', scope, args),
        error: (...args) => write('ERROR', scope, args),
    };
}
