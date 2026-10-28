import fs from 'node:fs';
import path from 'node:path';
import { logger } from './log.js';

const log = logger('history');
const KEEP_DAYS = 35;

// Local date, e.g. "2026-10-26". Days follow the VPS's clock.
export const dayKey = (ms = Date.now()) => new Date(ms).toLocaleDateString('en-CA');
const daysAgo = n => dayKey(Date.now() - n * 86400000);

export const PERIODS = {
    today: { days: 1, label: 'today' },
    week: { days: 7, label: 'this week' },
    month: { days: 30, label: 'this month' },
};

// What happened over time, per character (the same keys as PlayerStore):
//   xp        { day: { key: { skill: xp } } }  - each player's XP when first seen that day
//   playtime  { key: { total, days: { day: seconds } } }
//   deaths    { key: { total, days: { day: count } } }
//   kills     { key: { total, days: { day: count }, creatures: { name: count } } }
//   milestones [{ key, skill, level, at }]      - 99s, for the weekly recap
//   names     { key: display name }
// Kept in data/history.json; day entries older than five weeks are dropped.
export class History {
    constructor(dir) {
        this.file = path.join(dir, 'history.json');
        this.data = { version: 1, xp: {}, playtime: {}, deaths: {}, kills: {}, milestones: [], names: {}, hidden: [], lastSummary: '' };
        this.dirty = false;
        try {
            Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    name(key, name) {
        if (name && this.data.names[key] !== name) {
            this.data.names[key] = name;
            this.dirty = true;
        }
    }

    displayName(key) {
        return this.data.names[key] || key.replace(/^\w+:/, '');
    }

    // The first snapshot of the day is the baseline for "gained today / this week".
    recordXp(key, skills) {
        const day = dayKey();
        const today = (this.data.xp[day] ||= {});
        if (today[key] || !skills?.length) return;
        today[key] = Object.fromEntries(skills.map(s => [s.skill, s.currentXP | 0]));
        this.dirty = true;
    }

    // Oldest baseline inside the period: { xp, since } or null.
    baseline(key, period) {
        for (let n = PERIODS[period].days - 1; n >= 0; n--) {
            const day = daysAgo(n);
            const xp = this.data.xp[day]?.[key];
            if (xp) return { xp, since: day };
        }
        return null;
    }

    addPlaytime(key, seconds) {
        const entry = (this.data.playtime[key] ||= { total: 0, days: {} });
        const day = dayKey();
        entry.total += seconds;
        entry.days[day] = (entry.days[day] || 0) + seconds;
        this.dirty = true;
    }

    addDeath(key) {
        const entry = (this.data.deaths[key] ||= { total: 0, days: {} });
        const day = dayKey();
        entry.total += 1;
        entry.days[day] = (entry.days[day] || 0) + 1;
        this.dirty = true;
    }

    // creature: its display name ("Goblin"), counted per kind as well.
    addKill(key, creature) {
        const entry = (this.data.kills[key] ||= { total: 0, days: {}, creatures: {} });
        const day = dayKey();
        entry.total += 1;
        entry.days[day] = (entry.days[day] || 0) + 1;
        if (creature) entry.creatures[creature] = (entry.creatures[creature] || 0) + 1;
        this.dirty = true;
    }

    addMilestone(key, skill, level) {
        this.data.milestones.push({ key, skill, level, at: Date.now() });
        this.dirty = true;
    }

    // Sum of a { total, days } entry over the last n days.
    static within(entry, days) {
        if (!entry) return 0;
        let sum = 0;
        for (let n = 0; n < days; n++) sum += entry.days[daysAgo(n)] || 0;
        return sum;
    }

    playtime(key) {
        const e = this.data.playtime[key];
        return { today: History.within(e, 1), week: History.within(e, 7), total: e?.total || 0 };
    }

    deaths(key) {
        const e = this.data.deaths[key];
        return { week: History.within(e, 7), total: e?.total || 0 };
    }

    // creatures: [[name, count]] most killed first.
    kills(key) {
        const e = this.data.kills[key];
        const creatures = Object.entries(e?.creatures || {}).sort((a, b) => b[1] - a[1]);
        return { today: History.within(e, 1), week: History.within(e, 7), total: e?.total || 0, creatures };
    }

    // Moves everything kept under `from` onto `to`, adding up playtime, deaths and kills.
    merge(from, to) {
        const d = this.data;
        for (const group of [d.playtime, d.deaths, d.kills]) {
            const src = group[from];
            if (!src) continue;
            const dst = (group[to] ||= { total: 0, days: {} });
            dst.total += src.total;
            for (const [day, n] of Object.entries(src.days)) dst.days[day] = (dst.days[day] || 0) + n;
            if (src.creatures) {
                dst.creatures ||= {};
                for (const [name, n] of Object.entries(src.creatures)) dst.creatures[name] = (dst.creatures[name] || 0) + n;
            }
            delete group[from];
        }
        for (const day of Object.values(d.xp)) {
            if (day[from] && !day[to]) day[to] = day[from];
            delete day[from];
        }
        for (const m of d.milestones) if (m.key === from) m.key = to;
        if (d.names[from] && !d.names[to]) d.names[to] = d.names[from];
        delete d.names[from];
        if (d.hidden.includes(from)) {
            d.hidden = d.hidden.filter(k => k !== from);
            if (!d.hidden.includes(to)) d.hidden.push(to);
        }
        this.dirty = true;
    }

    // Every key anything is kept under.
    keys() {
        const d = this.data;
        return new Set([
            ...Object.keys(d.playtime),
            ...Object.keys(d.deaths),
            ...Object.keys(d.kills),
            ...Object.keys(d.names),
            ...Object.values(d.xp).flatMap(Object.keys),
            ...d.milestones.map(m => m.key),
            ...d.hidden,
        ]);
    }

    // /admin remove: drop everything kept about a character and keep them off
    // the leaderboards from now on. /admin restore lets them back.
    forget(key) {
        for (const day of Object.values(this.data.xp)) delete day[key];
        delete this.data.playtime[key];
        delete this.data.deaths[key];
        delete this.data.kills[key];
        this.data.milestones = this.data.milestones.filter(m => m.key !== key);
        if (!this.data.hidden.includes(key)) this.data.hidden.push(key);
        this.dirty = true;
    }

    restore(key) {
        this.data.hidden = this.data.hidden.filter(k => k !== key);
        this.dirty = true;
    }

    isHidden(key) {
        return this.data.hidden.includes(key);
    }

    prune() {
        const oldest = daysAgo(KEEP_DAYS);
        for (const day of Object.keys(this.data.xp)) if (day < oldest) delete this.data.xp[day];
        for (const group of [this.data.playtime, this.data.deaths, this.data.kills]) {
            for (const entry of Object.values(group)) {
                for (const day of Object.keys(entry.days)) if (day < oldest) delete entry.days[day];
            }
        }
        const cutoff = Date.now() - KEEP_DAYS * 86400000;
        this.data.milestones = this.data.milestones.filter(m => m.at >= cutoff);
    }

    flush() {
        if (!this.dirty) return;
        this.prune();
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data));
        fs.renameSync(tmp, this.file);
        this.dirty = false;
    }
}
