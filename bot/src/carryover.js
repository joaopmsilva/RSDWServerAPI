import fs from 'node:fs';
import path from 'node:path';
import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { config } from './config.js';
import { formatDuration } from './embeds.js';
import { levelInfo } from './levels.js';
import { logger } from './log.js';
import { itemName, questName } from './progress.js';
import { catalogSkill } from './skills.js';
import { PlayerStore } from './store.js';

const log = logger('carryover');
const SAVE_EVERY_MS = 60 * 1000;
const KEEP_FLAGS = 100;

const fmt = n => Number(n).toLocaleString('en-US');
const skillName = id => catalogSkill(id)?.name || String(id).replace(/^SKILL_/i, '');

// Bag and personal chest added up: moving things between them isn't news.
// null when neither was read.
function itemsOf(data) {
    if (!data || (!data.inventory && !data.personalChest)) return null;
    const items = {};
    for (const part of [data.inventory, data.personalChest]) {
        for (const [id, count] of Object.entries(part || {})) items[id] = (items[id] || 0) + count;
    }
    return items;
}

// Completed quest ids, or null when the quest list wasn't read.
const questsOf = list => (Array.isArray(list) && list.length ? list.filter(q => q.complete).map(q => q.id) : null);

function skillsOf(list) {
    return Object.fromEntries((list || []).map(s => [s.skill, s.currentXP]));
}

// Characters live on players' PCs and travel between worlds, so one can leave,
// gather on another server, and come back richer. Mod 0.9.0+ sends what a
// character had when they left and what they came back with ("arrive", once
// they've loaded in); anything gained in between - more than lag explains -
// is DMed to the admins.
//
// Each character's snapshot (data/carryover.json) is replaced by the leave
// event, or while they play by the polls, so a server crash still leaves one -
// marked less certain, as it can be up to a poll old.
export class CarryOver {
    constructor(client, store) {
        this.client = client;
        this.store = store;
        this.file = path.join(config.dataDir, 'carryover.json');
        this.data = { snapshots: {}, flags: [] };
        this.dirty = false;
        this.savedAt = 0;
        try {
            this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    get enabled() {
        return config.carryoverAlerts;
    }

    // Characters offline now have their last skills on record already: they
    // become the baseline, so even a first return is checked (skills only - no
    // inventory was kept before this).
    start() {
        if (!this.enabled) return;
        let seeded = 0;
        const cutoff = Date.now() - 5 * 60 * 1000;
        for (const [key, p] of this.store.entries()) {
            if (this.data.snapshots[key] || !PlayerStore.isCharacterKey(key) || !(p.lastSeen < cutoff)) continue;
            this.data.snapshots[key] = { name: p.characterName || p.name, at: p.lastSeen, source: 'history', skills: skillsOf(p.skills), items: null, quests: questsOf(p.quests), online: false };
            seeded++;
        }
        if (seeded) {
            log.info(`baseline for ${seeded} offline character(s) from their last seen skills`);
            this.dirty = true;
            this.save(true);
        }
    }

    keyOf(event) {
        if (event.characterGuid && !/^0+$/.test(event.characterGuid)) return `guid:${event.characterGuid}`;
        return (event.netId && this.store.keyOfNetId(event.netId)) || PlayerStore.key({ uniqueNetId: event.netId, name: event.name });
    }

    // From the relay.
    leave(event) {
        if (!this.enabled) return;
        const key = this.keyOf(event);
        const before = this.data.snapshots[key];
        if (event.data) {
            this.data.snapshots[key] = { name: event.name, at: event.time || Date.now(), source: 'leave', skills: event.data.skills || {}, items: itemsOf(event.data), quests: event.data.questsDone || null, online: false };
        } else if (before) {
            before.online = false;
        }
        this.dirty = true;
        this.save(true);
    }

    async arrive(event) {
        if (!this.enabled || !event.data) return;
        const key = this.keyOf(event);
        const before = this.data.snapshots[key];
        const after = { name: event.name, at: event.time || Date.now(), source: 'arrive', skills: event.data.skills || {}, items: itemsOf(event.data), quests: event.data.questsDone || null, online: true };
        this.data.snapshots[key] = after;
        this.dirty = true;
        this.save(true);
        if (!before) {
            log.info(`${event.name}: first time seen, recorded what they carry`);
            return;
        }

        const found = this.compare(before, after);
        if (!found.items.length && !found.skills.length && !found.quests.length) {
            log.info(`${event.name}: back with nothing new`);
            return;
        }
        const flag = { key, name: event.name, at: after.at, awaySince: before.at, source: before.source, ...found };
        this.data.flags = [flag, ...(this.data.flags || [])].slice(0, KEEP_FLAGS);
        this.save(true);
        log.info(`${event.name}: came back with ${found.items.length} new item(s), ${found.skills.length} skill gain(s), ${found.quests.length} quest(s)`);
        await this.notify(flag, before);
    }

    // From each poll: keeps an online character's snapshot current, so a crash
    // still leaves something to compare with.
    observe(players) {
        if (!this.enabled) return;
        for (const p of players || []) {
            if (!p.inventory || !p.skills?.length) continue;
            const key = PlayerStore.key(p);
            const snapshot = this.data.snapshots[key];
            // Only after they've arrived: before that the snapshot is what they left with.
            if (!snapshot?.online) continue;
            this.data.snapshots[key] = {
                name: p.characterName || p.name,
                at: Date.now(),
                source: 'poll',
                skills: skillsOf(p.skills),
                items: itemsOf({ inventory: p.inventory, personalChest: p.personalChest }),
                quests: questsOf(p.quests) || snapshot.quests || null,
                online: true,
            };
            this.dirty = true;
        }
        this.save();
    }

    // Gains lag can't explain: an item they didn't have, or a stack up by
    // CARRYOVER_MIN_ITEMS; a skill up by CARRYOVER_MIN_XP or a whole level; any
    // quest finished while away.
    compare(before, after) {
        const items = [];
        if (before.items && after.items) {
            for (const [id, count] of Object.entries(after.items)) {
                const had = before.items[id] || 0;
                const gain = count - had;
                if (gain > 0 && (had === 0 || gain >= config.carryoverMinItems)) items.push({ id, had, now: count });
            }
            items.sort((a, b) => b.now - b.had - (a.now - a.had));
        }
        const skills = [];
        for (const [skill, xp] of Object.entries(after.skills || {})) {
            const was = before.skills?.[skill];
            if (typeof was !== 'number' || xp <= was) continue;
            const from = levelInfo(was).level;
            const to = levelInfo(xp).level;
            if (xp - was >= config.carryoverMinXp || to > from) skills.push({ skill, xpFrom: was, xpTo: xp, from, to });
        }
        skills.sort((a, b) => b.xpTo - b.xpFrom - (a.xpTo - a.xpFrom));
        const quests = before.quests && after.quests ? after.quests.filter(id => !before.quests.includes(id)) : [];
        return { items, skills, quests, itemsChecked: Boolean(before.items && after.items) };
    }

    async notify(flag, before) {
        const away = flag.at - flag.awaySince;
        const lines = list => {
            const shown = list.slice(0, 15);
            return shown.join('\n') + (list.length > shown.length ? `\n…and ${list.length - shown.length} more` : '');
        };
        const embed = new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle('🧳 Came back with more than they left with')
            .setDescription(`**${escapeMarkdown(flag.name)}** rejoined after ${away > 0 ? formatDuration(away / 1000) : 'a while'} away, with things they didn't gain here.`)
            .setFooter({ text: config.serverName })
            .setTimestamp(flag.at);
        if (flag.items.length) {
            embed.addFields({
                name: `🎒 Items (${flag.items.length})`,
                value: lines(flag.items.map(i => `**+${fmt(i.now - i.had)}** ${escapeMarkdown(itemName(i.id))}${i.had ? `  ·  had ${fmt(i.had)}` : '  ·  new'}`)),
            });
        }
        if (flag.skills.length) {
            embed.addFields({
                name: `📈 Skills (${flag.skills.length})`,
                value: lines(flag.skills.map(s => `**${escapeMarkdown(skillName(s.skill))}** ${s.from === s.to ? `level ${s.to}` : `${s.from} → **${s.to}**`}  ·  +${fmt(s.xpTo - s.xpFrom)} xp`)),
            });
        }
        if (flag.quests.length) {
            embed.addFields({ name: `📜 Quests completed (${flag.quests.length})`, value: lines(flag.quests.map(id => escapeMarkdown(questName({ id })))) });
        }
        const notes = [];
        if (before.source !== 'leave') {
            notes.push(
                before.source === 'history'
                    ? '⚠️ Compared with their skills as last recorded before this check existed, which can be up to a poll out of date.'
                    : '⚠️ Compared with a snapshot from up to a poll before they left (the server went down rather than them logging off), so a little of this may be ordinary play.',
            );
        }
        if (!flag.itemsChecked) notes.push('Items weren\'t recorded last time, so only skills were checked.');
        if (notes.length) embed.addFields({ name: 'Note', value: notes.join('\n') });

        for (const id of config.adminUserIds) {
            try {
                const user = await this.client.users.fetch(id);
                await user.send({ embeds: [embed] });
            } catch (err) {
                log.warn(`could not message admin ${id}: ${err.message}`);
            }
        }
    }

    save(now = false) {
        if (!this.dirty || (!now && Date.now() - this.savedAt < SAVE_EVERY_MS)) return;
        try {
            fs.mkdirSync(config.dataDir, { recursive: true });
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(this.data));
            fs.renameSync(tmp, this.file);
            this.dirty = false;
            this.savedAt = Date.now();
        } catch (err) {
            log.error(`could not save ${this.file}: ${err.message}`);
        }
    }
}
