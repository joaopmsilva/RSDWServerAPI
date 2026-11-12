import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// What the game logs when it opens its online session: the invite (join) code
// and whether crossplay is on. Both are written once, near the start of each
// run's RSDragonwilds.log, so only its first few megabytes are read, and the
// answer is kept for a minute.
const READ_BYTES = 4 * 1024 * 1024;
const CACHE_MS = 60 * 1000;
let cached = { at: 0, info: { joinCode: '', crossplay: null } };

export function sessionInfo() {
    if (Date.now() - cached.at < CACHE_MS) return cached.info;
    const info = { joinCode: '', crossplay: null };
    try {
        const file = path.join(config.serverDir, 'RSDragonwilds', 'Saved', 'Logs', 'RSDragonwilds.log');
        const fd = fs.openSync(file, 'r');
        const buffer = Buffer.alloc(Math.min(READ_BYTES, fs.fstatSync(fd).size));
        fs.readSync(fd, buffer, 0, buffer.length, 0);
        fs.closeSync(fd);
        const text = buffer.toString('utf8');
        const codes = [...text.matchAll(/Setting \["JoinCode"\] written with key\[\w+\] value\[([^\]\s]+)\]/g)];
        if (codes.length) info.joinCode = codes[codes.length - 1][1];
        const crossplay = [...text.matchAll(/CrossplayEnabled\[(true|false)\]/gi)];
        if (crossplay.length) info.crossplay = crossplay[crossplay.length - 1][1].toLowerCase() === 'true';
    } catch {
        // No log (the bot on another machine, or the server not started yet).
    }
    cached = { at: Date.now(), info };
    return info;
}
