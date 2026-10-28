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

    static isCharacterKey(key) {
        return key.startsWith('guid:');
    }

    // True once the mod has reported any character GUID. From then on a player
    // without one is still loading in, and is only counted once it shows up.
    get hasCharacters() {
        return Object.keys(this.players).some(PlayerStore.isCharacterKey);
    }

    get(player) {
        return this.players[PlayerStore.key(player)] || null;
    }

    update(player, now = Date.now()) {
        // A player still loading in reports no skills - keep their previous snapshot.
        if (!player.skills?.length) return;

        const key = PlayerStore.key(player);
        if (!PlayerStore.isCharacterKey(key) && this.hasCharacters) return;
        const previous = this.players[key];
        const maxHealth = player.health?.max > 0 ? player.health.max : previous?.maxHealth;
        // Quests, journal and perks come from mod 0.6.0+; an empty read keeps the last good one.
        const quests = player.quests?.length ? player.quests.map(({ id, name, kind, complete }) => ({ id, name, kind, complete })) : previous?.quests;
        const journal = player.journal?.total ? player.journal : previous?.journal;
        const perks = player.perks ? player.perks : previous?.perks;
        this.players[key] = {
            name: player.name,
            characterName: player.characterName,
            uniqueNetId: player.uniqueNetId,
            characterGuid: player.characterGuid,
            skills: player.skills.map(s => ({ skill: s.skill, currentXP: s.currentXP })),
            ...(maxHealth ? { maxHealth } : {}),
            ...(quests ? { quests } : {}),
            ...(journal ? { journal } : {}),
            ...(perks ? { perks } : {}),
            lastSeen: now,
        };
        this.dirty = true;
    }

    all() {
        return Object.values(this.players);
    }

    byKey(key) {
        return this.players[key] || null;
    }

    remove(key) {
        if (!this.players[key]) return;
        delete this.players[key];
        this.dirty = true;
    }

    // [key, record] pairs, for stats that need both.
    entries() {
        return Object.entries(this.players);
    }

    // The character last seen with this net id (one account can have several).
    keyOfNetId(netId) {
        let best = null;
        for (const [key, p] of Object.entries(this.players)) {
            if (!PlayerStore.isCharacterKey(key)) continue;
            if (p.uniqueNetId === netId && (!best || p.lastSeen > this.players[best].lastSeen)) best = key;
        }
        return best;
    }

    // The one character with this name (lower case), or null if none or several.
    keyOfName(name) {
        const keys = Object.entries(this.players)
            .filter(([key, p]) => PlayerStore.isCharacterKey(key) && [p.characterName, p.name].some(n => n?.toLowerCase() === name))
            .map(([key]) => key);
        return keys.length === 1 ? keys[0] : null;
    }

    flush() {
        if (!this.dirty) return;
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify({ version: 1, players: this.players }, null, 2));
        fs.renameSync(tmp, this.file);
        this.dirty = false;
    }
}
