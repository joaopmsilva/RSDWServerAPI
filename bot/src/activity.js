import { config } from './config.js';
import { afkEmbed, joinEmbed, leaveEmbed, levelUpEmbed, maxedEmbed, summaryEmbed } from './embeds.js';
import { dayKey } from './history.js';
import { levelInfo, MAX_LEVEL } from './levels.js';
import { logger } from './log.js';
import { describeSkills } from './skills.js';
import { deathBoard, playtimeBoard, recentMilestones, topGainers } from './stats.js';
import { PlayerStore } from './store.js';

const log = logger('activity');
const NO_MENTIONS = { parse: [] };
// Without the mod's leave events, a poll notices the leave up to two polls later.
const AFK_LEAVE_WAIT_MS = 90 * 1000;

// Mod 0.3.0 reports joins and leaves itself, the moment they happen.
export function modReportsPresence(version) {
    const [major = 0, minor = 0] = String(version || '').split('.').map(Number);
    return major > 0 || minor >= 3;
}

// Everything that happens to players over time: level-ups, join / leave
// messages, playtime, deaths, and the weekly recap. Fed by the poller (every
// POLL_SECONDS) and by the relay (mod events).
export class Activity {
    constructor(client, store, history) {
        this.client = client;
        this.store = store;
        this.history = history;
        this.ctx = { store, history };
        this.lastXp = new Map(); // character key -> { skillId: xp }
        this.online = null; // net id -> name from the last poll; null right after start or while down
        this.sessions = new Map(); // net id -> when they came online
        this.lastObserved = 0;
        this.modPresence = false;
        this.timer = null;
        this.pending = new Map(); // net:/name: key -> seconds played before the character was known
        this.afkKicks = new Map(); // net id -> timer posting the kick alone if no leave follows
        this.mergeLooseKeys();
    }

    // A character just seen with its GUID takes over whatever was counted for
    // its account or name before the GUID could be read.
    adopt(key, player, loose) {
        const held = this.pending.get(loose);
        if (held) this.history.addPlaytime(key, held);
        this.pending.delete(loose);

        const name = (player.characterName || player.name || '').toLowerCase();
        for (const from of [loose, name && `name:${name}`]) {
            if (!from || !this.history.keys().has(from) && !this.store.byKey(from)) continue;
            log.info(`merging ${from} into ${key} (${player.characterName || player.name})`);
            this.history.merge(from, key);
            this.store.remove(from);
        }
    }

    // Older versions counted a player still loading in under their account
    // (net:) or name (name:), so they showed up twice on the boards. Fold those
    // into the character they belong to, where that's clear.
    mergeLooseKeys() {
        const loose = new Set([...this.history.keys(), ...this.store.entries().map(([key]) => key)]);
        let merged = 0;
        for (const from of loose) {
            if (PlayerStore.isCharacterKey(from)) continue;
            const [kind, id] = [from.slice(0, from.indexOf(':')), from.slice(from.indexOf(':') + 1)];
            const to = kind === 'net' ? this.store.keyOfNetId(id) : kind === 'name' ? this.store.keyOfName(id) : null;
            if (!to) continue;
            this.history.merge(from, to);
            this.store.remove(from);
            merged++;
        }
        if (!merged) return;
        log.info(`merged ${merged} duplicate player entr${merged === 1 ? 'y' : 'ies'} into their characters`);
        this.flush();
        try {
            this.store.flush();
        } catch (err) {
            log.error(`could not save players: ${err.message}`);
        }
    }

    start() {
        this.timer = setInterval(() => this.checkSummary().catch(err => log.error('weekly recap failed:', err)), 60000);
    }

    stop() {
        clearInterval(this.timer);
        this.flush();
    }

    flush() {
        try {
            this.history.flush();
        } catch (err) {
            log.error(`could not save history: ${err.message}`);
        }
    }

    async send(channelId, payload) {
        if (!channelId) return;
        try {
            const channel = await this.client.channels.fetch(channelId);
            await channel.send({ allowedMentions: NO_MENTIONS, ...payload });
        } catch (err) {
            log.warn(`could not post to ${channelId}: ${err.message}`);
        }
    }

    // From the poller: the online players before their snapshots are saved, or
    // null while the server isn't online.
    observe(players, health) {
        this.modPresence = modReportsPresence(health?.version);
        if (!players) {
            this.online = null;
            this.sessions.clear();
            this.pending.clear();
            this.lastObserved = 0;
            return;
        }

        const now = Date.now();
        // A gap longer than two polls means the bot or server was away - don't count it.
        const elapsed = this.lastObserved ? Math.min(now - this.lastObserved, config.pollSeconds * 2000) / 1000 : 0;
        this.lastObserved = now;

        const current = new Map();
        const levelUps = [];
        const hasCharacters = this.store.hasCharacters || players.some(p => PlayerStore.isCharacterKey(PlayerStore.key(p)));
        for (const p of players) {
            const key = PlayerStore.key(p);
            const name = p.characterName || p.name;
            if (p.uniqueNetId && name) {
                current.set(p.uniqueNetId, name);
                if (!this.sessions.has(p.uniqueNetId)) this.sessions.set(p.uniqueNetId, now);
            }

            // Still loading in: their character isn't known yet, so hold the
            // time and credit it to the character once it is.
            const loose = p.uniqueNetId ? `net:${p.uniqueNetId}` : `name:${(p.name || '').toLowerCase()}`;
            if (!PlayerStore.isCharacterKey(key) && hasCharacters) {
                this.pending.set(loose, (this.pending.get(loose) || 0) + elapsed);
                continue;
            }
            if (PlayerStore.isCharacterKey(key)) this.adopt(key, p, loose);

            this.history.name(key, name);
            if (elapsed) this.history.addPlaytime(key, elapsed);
            if (p.skills?.length) {
                this.history.recordXp(key, p.skills);
                levelUps.push(...this.findLevelUps(key, name, p.skills));
            }
        }

        // Older mods don't report joins and leaves, so compare polls instead.
        if (!this.modPresence && this.online) {
            for (const [id, name] of current) if (!this.online.has(id)) this.announce('join', id, name, current.size);
            for (const [id, name] of this.online) if (!current.has(id)) this.announce('leave', id, name, current.size);
        }
        for (const id of this.sessions.keys()) if (!current.has(id) && !this.modPresence) this.sessions.delete(id);
        this.online = current;

        if (levelUps.length) this.postLevelUps(levelUps);
        this.flush();
    }

    findLevelUps(key, name, skills) {
        const known = this.lastXp.get(key) || this.fromStore(key);
        this.lastXp.set(key, Object.fromEntries(skills.map(s => [s.skill, s.currentXP | 0])));
        if (!known) return [];

        const described = describeSkills(skills);
        const totalLevel = described.reduce((n, s) => n + s.info.level, 0);
        const ups = [];
        for (const s of described) {
            if (known[s.id] === undefined) continue;
            const from = levelInfo(known[s.id]).level;
            if (s.info.level > from && s.info.level >= config.levelUpMinLevel) ups.push({ key, name, skill: s, from, totalLevel });
        }
        return ups;
    }

    fromStore(key) {
        const stored = this.store.byKey(key);
        return stored?.skills?.length ? Object.fromEntries(stored.skills.map(s => [s.skill, s.currentXP | 0])) : null;
    }

    async postLevelUps(ups) {
        for (const u of ups) {
            log.info(`level up: ${u.name} ${u.skill.name} ${u.from} -> ${u.skill.info.level}`);
            if (u.skill.info.level >= MAX_LEVEL) this.history.addMilestone(u.key, u.skill.name, MAX_LEVEL);
        }
        if (!config.levelUpNotices) return;

        // 99s first, then the rest; Discord takes ten embeds per message.
        const embeds = [
            ...ups.filter(u => u.skill.info.level >= MAX_LEVEL).map(maxedEmbed),
            ...ups.filter(u => u.skill.info.level < MAX_LEVEL).map(levelUpEmbed),
        ];
        for (let i = 0; i < embeds.length; i += 10) {
            await this.send(config.levelUpChannelId, { embeds: embeds.slice(i, i + 10) });
        }
    }

    announce(type, netId, name, count) {
        const started = this.sessions.get(netId);
        if (type === 'join') this.sessions.set(netId, Date.now());
        else this.sessions.delete(netId);
        log.info(`player ${type === 'join' ? 'joined' : 'left'}: ${name}`);

        const afk = type === 'leave' && this.afkKicks.has(netId);
        if (afk) {
            clearTimeout(this.afkKicks.get(netId));
            this.afkKicks.delete(netId);
        }
        if (!config.joinLeaveNotices) return;

        const embed = type === 'join' ? joinEmbed(name, count) : leaveEmbed(name, count, started ? (Date.now() - started) / 1000 : 0, afk);
        this.queuePresence(embed);
    }

    // Joins and leaves that land together (a poll, a burst of events) share one message.
    queuePresence(embed) {
        (this.presenceQueue ||= []).push(embed);
        if (this.presenceTimer) return;
        this.presenceTimer = setTimeout(async () => {
            const embeds = this.presenceQueue.splice(0);
            this.presenceTimer = null;
            for (let i = 0; i < embeds.length; i += 10) await this.send(config.chatChannelId, { embeds: embeds.slice(i, i + 10) });
        }, 1000);
    }

    // From the relay (mod 0.3.0+): join / leave as they happen.
    presence(event) {
        if (!event.netId || !event.name) return;
        this.announce(event.type, event.netId, event.name, event.players ?? -1);
    }

    // From the relay (mod 0.4.0+): kicked for being AFK. The leave that follows
    // says so; only if it never comes is the kick posted on its own.
    afk(event) {
        log.info(`AFK kick: ${event.name}`);
        if (!event.netId) {
            if (config.joinLeaveNotices && event.name) this.queuePresence(afkEmbed(event.name));
            return;
        }
        clearTimeout(this.afkKicks.get(event.netId));
        this.afkKicks.set(
            event.netId,
            setTimeout(() => {
                this.afkKicks.delete(event.netId);
                if (config.joinLeaveNotices && event.name) this.queuePresence(afkEmbed(event.name));
            }, AFK_LEAVE_WAIT_MS),
        );
    }

    death(event) {
        const name = (event.name || '').toLowerCase();
        const key =
            (event.netId && this.store.keyOfNetId(event.netId)) ||
            this.store.keyOfName(name) ||
            (event.netId ? `net:${event.netId}` : `name:${name}`);
        this.history.name(key, event.name);
        this.history.addDeath(key);
        this.flush();
    }

    // Sundays from 20:00 VPS time, once.
    async checkSummary() {
        if (!config.weeklySummary || !config.summaryChannelId) return;
        const now = new Date();
        if (now.getDay() !== 0 || now.getHours() < 20) return;
        const today = dayKey();
        if (this.history.data.lastSummary === today) return;

        this.history.data.lastSummary = today;
        this.history.dirty = true;
        this.flush();

        const embed = summaryEmbed({
            gainers: topGainers(this.ctx, 'week'),
            milestones: recentMilestones(this.ctx),
            played: playtimeBoard(this.ctx),
            deaths: deathBoard(this.ctx),
        });
        log.info('posting the weekly recap');
        await this.send(config.summaryChannelId, { embeds: [embed] });
    }
}
