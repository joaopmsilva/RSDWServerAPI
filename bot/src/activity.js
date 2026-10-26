import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { config } from './config.js';
import { formatDuration, summaryEmbed } from './embeds.js';
import { dayKey } from './history.js';
import { levelInfo, MAX_LEVEL } from './levels.js';
import { logger } from './log.js';
import { describeSkills } from './skills.js';
import { deathBoard, playtimeBoard, recentMilestones, topGainers } from './stats.js';
import { PlayerStore } from './store.js';

const log = logger('activity');
const NO_MENTIONS = { parse: [] };

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
            this.lastObserved = 0;
            return;
        }

        const now = Date.now();
        // A gap longer than two polls means the bot or server was away - don't count it.
        const elapsed = this.lastObserved ? Math.min(now - this.lastObserved, config.pollSeconds * 2000) / 1000 : 0;
        this.lastObserved = now;

        const current = new Map();
        const levelUps = [];
        for (const p of players) {
            const key = PlayerStore.key(p);
            const name = p.characterName || p.name;
            this.history.name(key, name);
            if (elapsed) this.history.addPlaytime(key, elapsed);
            if (p.uniqueNetId && name) {
                current.set(p.uniqueNetId, name);
                if (!this.sessions.has(p.uniqueNetId)) this.sessions.set(p.uniqueNetId, now);
            }
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

        const ups = [];
        for (const s of describeSkills(skills)) {
            if (known[s.id] === undefined) continue;
            const from = levelInfo(known[s.id]).level;
            if (s.info.level > from && s.info.level >= config.levelUpMinLevel) ups.push({ key, name, skill: s, from });
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

        const maxed = ups.filter(u => u.skill.info.level >= MAX_LEVEL);
        for (const u of maxed) {
            const embed = new EmbedBuilder()
                .setColor(0xf1c40f)
                .setTitle(`⭐ ${u.name} reached 99 ${u.skill.name}!`)
                .setDescription(`${u.skill.emoji} The highest level there is. Congratulations!`);
            if (u.skill.icon) embed.setThumbnail(u.skill.icon);
            await this.send(config.levelUpChannelId, { embeds: [embed] });
        }

        const lines = ups
            .filter(u => u.skill.info.level < MAX_LEVEL)
            .map(u => {
                const jump = u.skill.info.level - u.from > 1 ? ` (from ${u.from})` : '';
                return `🎉 **${escapeMarkdown(u.name)}** reached **${u.skill.emoji} ${u.skill.name} ${u.skill.info.level}**${jump}`;
            });
        if (lines.length) await this.send(config.levelUpChannelId, { content: lines.join('\n').slice(0, 2000) });
    }

    announce(type, netId, name, count) {
        const started = this.sessions.get(netId);
        if (type === 'join') this.sessions.set(netId, Date.now());
        else this.sessions.delete(netId);
        log.info(`player ${type === 'join' ? 'joined' : 'left'}: ${name}`);
        if (!config.joinLeaveNotices) return;

        const max = config.maxPlayers ? `/${config.maxPlayers}` : '';
        const online = count >= 0 ? ` · ${count}${max} online` : '';
        const who = `**${escapeMarkdown(name)}**`;
        const text =
            type === 'join'
                ? `➡️ ${who} joined${online}`
                : `⬅️ ${who} left${started && Date.now() - started >= 60000 ? ` after ${formatDuration((Date.now() - started) / 1000)}` : ''}${online}`;
        this.send(config.chatChannelId, { content: text });
    }

    // From the relay (mod 0.3.0+): join / leave as they happen.
    presence(event) {
        if (!event.netId || !event.name) return;
        this.announce(event.type, event.netId, event.name, event.players ?? -1);
    }

    death(event) {
        const key = (event.netId && this.store.keyOfNetId(event.netId)) || `name:${(event.name || '').toLowerCase()}`;
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
