import fs from 'node:fs';
import path from 'node:path';
import { api } from './api.js';
import { config } from './config.js';

// The newest modification time among the world's .sav files, or 0.
export function newestSave() {
    try {
        const times = fs
            .readdirSync(config.saveDir)
            .filter(f => f.endsWith('.sav'))
            .map(f => fs.statSync(path.join(config.saveDir, f)).mtimeMs);
        return times.length ? Math.max(...times) : 0;
    } catch {
        return 0;
    }
}

// Asks the game to save (mod 0.4.0+) and waits for the save files to change,
// which is the only real proof it worked. Never throws.
//   { ok, changed, message }
export async function saveWorld(fn = config.saveFunction, waitMs = 20000) {
    if (!fn) return { ok: false, changed: false, message: 'no save function set (SAVE_FUNCTION in .env)' };

    const before = newestSave();
    const started = Date.now();
    try {
        await api.save(fn);
    } catch (err) {
        return { ok: false, changed: false, message: err.status === 404 ? 'the running mod is older than 0.4.0' : err.message };
    }

    while (Date.now() - started < waitMs) {
        if (newestSave() > before) return { ok: true, changed: true, message: `${fn} saved the world` };
        await new Promise(r => setTimeout(r, 500));
    }
    return { ok: true, changed: false, message: `${fn} ran, but the save files in ${config.saveDir} didn't change` };
}
