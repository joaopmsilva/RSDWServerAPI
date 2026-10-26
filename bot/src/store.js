import fs from 'node:fs';
import path from 'node:path';
import { logger } from './log.js';

const log = logger('store');

// Last known stats per character, so lookups still work after someone logs off.
export class PlayerStore {
    constructor(dir) {
        fs.mkdirSync(dir, { recursive: true });
        this.file = path.join(dir, 'players.json');
        this.players = {};
        this.dirty = false;

        try {
            this.players = JSON.parse(fs.readFileSync(this.file, 'utf8')).players || {};
            log.info(`loaded ${Object.keys(this.players).length} saved player(s) from ${this.file}`);
        } catch (err) {
            if (err.code === 'ENOENT') log.info(`no saved players yet, will create ${this.file}`);
            else log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    // One SteamID can own several characters, and skills are per character.
    static key(player) {
        if (player.characterGuid && !/^0+$/.test(player.characterGuid)) return `guid:${player.characterGuid}`;
        if (player.uniqueNetId) return `net:${player.uniqueNetId}`;
        return `name:${(player.name || '').toLowerCase()}`;
    }

    get(player) {
        return this.players[PlayerStore.key(player)] || null;
    }

    update(player, now = Date.now()) {
        // A player still loading in reports no skills - keep their previous snapshot.
        if (!player.skills?.length) return;

        this.players[PlayerStore.key(player)] = {
            name: player.name,
            characterName: player.characterName,
            uniqueNetId: player.uniqueNetId,
            characterGuid: player.characterGuid,
            skills: player.skills.map(s => ({ skill: s.skill, currentXP: s.currentXP })),
            lastSeen: now,
        };
        this.dirty = true;
    }

    all() {
        return Object.values(this.players);
    }

    flush() {
        if (!this.dirty) return;
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, players: this.players }, null, 2));
        fs.renameSync(tmp, this.file);
        this.dirty = false;
    }
}
