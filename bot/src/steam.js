import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// Which build of the dedicated server is installed, which one Steam has, and
// updating to it with steamcmd - the same command update-and-restart.sh runs.

const manifest = () => path.join(config.serverDir, 'steamapps', `appmanifest_${config.steamAppId}.acf`);

// { buildId, updated } from steamcmd's app manifest, or null when there is none
// (the bot isn't on the server's machine, or SERVER_DIR is wrong).
export function installedBuild() {
    let text;
    try {
        text = fs.readFileSync(manifest(), 'utf8');
    } catch {
        return null;
    }
    const buildId = /"buildid"\s+"(\d+)"/.exec(text)?.[1];
    const updated = /"LastUpdated"\s+"(\d+)"/.exec(text)?.[1];
    return buildId ? { buildId, updated: updated ? Number(updated) * 1000 : null } : null;
}

function steamcmd(args, timeout) {
    return new Promise((resolve, reject) => {
        execFile(config.steamcmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            // steamcmd's exit codes aren't reliable, so callers check the result themselves.
            if (err && err.killed) return reject(new Error(`steamcmd took longer than ${Math.round(timeout / 60000)} minutes`));
            if (err && err.code === 'ENOENT') return reject(new Error(`steamcmd not found at ${config.steamcmd}`));
            resolve(`${stdout}${stderr}`);
        });
    });
}

// { buildId, released } of the public branch. Asks api.steamcmd.net (one quick
// request); if that's down, steamcmd itself, which takes longer.
export async function latestBuild() {
    try {
        const res = await fetch(`https://api.steamcmd.net/v1/info/${config.steamAppId}`, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`api.steamcmd.net answered ${res.status}`);
        const branch = (await res.json()).data?.[config.steamAppId]?.depots?.branches?.public;
        if (branch?.buildid) return { buildId: String(branch.buildid), released: branch.timeupdated ? Number(branch.timeupdated) * 1000 : null };
        throw new Error('api.steamcmd.net has no public build');
    } catch (err) {
        const out = await steamcmd(['+login', 'anonymous', '+app_info_update', '1', '+app_info_print', config.steamAppId, '+quit'], 3 * 60000);
        const m = /"branches"[\s\S]*?"public"\s*\{[^}]*?"buildid"\s+"(\d+)"(?:[^}]*?"timeupdated"\s+"(\d+)")?/.exec(out);
        if (!m) throw new Error(`could not read the latest build (${err.message}; steamcmd had no answer either)`);
        return { buildId: m[1], released: m[2] ? Number(m[2]) * 1000 : null };
    }
}

export const isNewer = (latest, installed) => Number(latest) > Number(installed);

// Downloads the update. The server has to be stopped first.
export async function updateServer() {
    const before = installedBuild()?.buildId;
    const out = await steamcmd(
        ['+force_install_dir', config.serverDir, '+login', 'anonymous', '+app_update', config.steamAppId, 'validate', '+quit'],
        45 * 60000,
    );
    // The start script loses its executable bit on some updates.
    try {
        fs.chmodSync(path.join(config.serverDir, 'RSDragonwildsServer.sh'), 0o755);
    } catch {
        // Not there under that name - nothing to fix.
    }
    const after = installedBuild()?.buildId;
    if (!/Success! App '\d+' fully installed|already up to date/i.test(out)) {
        const last = out.trim().split('\n').slice(-3).join(' · ');
        throw new Error(`steamcmd didn't finish the update: ${last}`);
    }
    return { from: before, to: after };
}
