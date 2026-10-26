import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Backups as backup.sh writes them: BACKUP_DIR/<save name>_YYYYMMDD_HHMMSS.sav.
const NAME = /^(.+)_(\d{8})_(\d{6})\.sav$/;

const toDate = (d, t) => new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}`);
const pad = n => String(n).padStart(2, '0');
export const stampOf = (date = new Date()) =>
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

// Backup runs, newest first: [{ id, at, size, files: [{ file, save, size }] }].
// backup.sh stamps each file as it copies it, so one run can span a few
// seconds - files within a minute of each other with different saves are one run.
export function listBackups() {
    let names;
    try {
        names = fs.readdirSync(config.backupDir);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }

    const files = names
        .map(file => {
            const m = file.match(NAME);
            if (!m) return null;
            return { file, save: m[1], at: toDate(m[2], m[3]).getTime(), size: fs.statSync(path.join(config.backupDir, file)).size, stamp: `${m[2]}_${m[3]}` };
        })
        .filter(Boolean)
        .sort((a, b) => b.at - a.at);

    const runs = [];
    for (const f of files) {
        const run = runs.at(-1);
        if (run && run.at - f.at <= 60000 && !run.files.some(x => x.save === f.save)) {
            run.files.push(f);
            run.size += f.size;
        } else {
            runs.push({ id: f.stamp, at: f.at, size: f.size, files: [f] });
        }
    }
    return runs;
}

export const findBackup = id => listBackups().find(b => b.id === id) || null;

// Copies the current saves into BACKUP_DIR (a backup of their own), then the
// chosen backup over them. The server must be stopped.
export function restoreFiles(backup) {
    fs.mkdirSync(config.backupDir, { recursive: true });
    const stamp = stampOf();
    const kept = [];
    for (const file of fs.readdirSync(config.saveDir).filter(f => f.endsWith('.sav'))) {
        const copy = `${file.replace(/\.sav$/, '')}_${stamp}.sav`;
        fs.copyFileSync(path.join(config.saveDir, file), path.join(config.backupDir, copy));
        kept.push(copy);
    }
    for (const f of backup.files) {
        fs.copyFileSync(path.join(config.backupDir, f.file), path.join(config.saveDir, `${f.save}.sav`));
    }
    return kept;
}
