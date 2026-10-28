import { displayName } from './embeds.js';
import { History } from './history.js';
import { levelInfo } from './levels.js';
import { describeSkills } from './skills.js';

// Gains, playtime and death numbers, shared by the commands and the weekly recap.
// ctx is { store, history }.

export function nameOf(ctx, key) {
    const player = ctx.store.byKey(key);
    return player ? displayName(player) : ctx.history.displayName(key);
}

// XP gained in a period: { since, total, levels, skills: [{ ...skill, gained, fromLevel }] }
// with the skills that moved, biggest first. null if there's no baseline yet.
export function gainsFor(ctx, key, period) {
    const base = ctx.history.baseline(key, period);
    const now = ctx.store.byKey(key);
    if (!base || !now) return null;

    const skills = [];
    for (const s of describeSkills(now.skills)) {
        const before = base.xp[s.id] ?? 0;
        const gained = s.xp - before;
        if (gained <= 0) continue;
        skills.push({ ...s, gained, fromLevel: levelInfo(before).level });
    }
    skills.sort((a, b) => b.gained - a.gained);
    return {
        since: base.since,
        total: skills.reduce((n, s) => n + s.gained, 0),
        levels: skills.reduce((n, s) => n + s.info.level - s.fromLevel, 0),
        skills,
    };
}

// Players taken off the boards with /admin remove.
const shown = ctx => ([key]) => !ctx.history.isHidden(key);

export function topGainers(ctx, period) {
    const rows = [];
    for (const [key] of ctx.store.entries().filter(shown(ctx))) {
        const g = gainsFor(ctx, key, period);
        if (g?.total > 0) rows.push({ key, name: nameOf(ctx, key), ...g });
    }
    return rows.sort((a, b) => b.total - a.total);
}

export function playtimeBoard(ctx, days = 7) {
    return Object.entries(ctx.history.data.playtime)
        .filter(shown(ctx))
        .map(([key, e]) => ({ key, name: nameOf(ctx, key), recent: History.within(e, days), total: e.total }))
        .filter(r => r.recent > 0)
        .sort((a, b) => b.recent - a.recent);
}

export function deathBoard(ctx, days = 7) {
    return Object.entries(ctx.history.data.deaths)
        .filter(shown(ctx))
        .map(([key, e]) => ({ key, name: nameOf(ctx, key), recent: History.within(e, days), total: e.total }))
        .filter(r => r.total > 0)
        .sort((a, b) => b.recent - a.recent || b.total - a.total);
}

// Most kills of all time first.
export function killBoard(ctx, days = 7) {
    return Object.entries(ctx.history.data.kills || {})
        .filter(shown(ctx))
        .map(([key, e]) => ({ key, name: nameOf(ctx, key), recent: History.within(e, days), total: e.total }))
        .filter(r => r.total > 0)
        .sort((a, b) => b.total - a.total || b.recent - a.recent);
}

export function recentMilestones(ctx, days = 7) {
    const cutoff = Date.now() - days * 86400000;
    return ctx.history.data.milestones.filter(m => m.at >= cutoff && !ctx.history.isHidden(m.key)).map(m => ({ ...m, name: nameOf(ctx, m.key) }));
}
