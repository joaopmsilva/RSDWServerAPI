import { api } from './api.js';
import {
    LEADERBOARD_PAGE_SIZE,
    ONLINE_PAGE_SIZE,
    ambiguousEmbed,
    errorEmbed,
    helpEmbed,
    leaderboardEmbed,
    onlineEmbed,
    renderPlayerPage,
    statusEmbed,
} from './embeds.js';
import { logger } from './log.js';
import { normEmoji } from './menus.js';
import { catalogSkill, describeSkills, findSkill } from './skills.js';
import { PlayerStore } from './store.js';

// A command returns { reply }, plus menu: { emojis, onPress } for page arrows;
// index.js sends the reply and turns the menu into reactions.

const log = logger('commands');
const lower = s => (s || '').toLowerCase();

function matchPlayers(list, query) {
    const q = lower(query.trim());
    const exact = list.filter(p => lower(p.name) === q || lower(p.characterName) === q);
    if (exact.length) return exact;
    return list.filter(p => lower(p.name).includes(q) || lower(p.characterName).includes(q));
}

function flushStore(store) {
    try {
        store.flush();
    } catch (err) {
        log.error(`could not save player snapshots: ${err.message}`);
    }
}

// Live player list, also refreshing the snapshots. null if the server is down.
async function fetchLive(ctx) {
    try {
        const live = await api.players();
        for (const p of live) ctx.store.update(p);
        flushStore(ctx.store);
        return live;
    } catch (err) {
        if (err.kind === 'auth') log.error(err.message);
        else log.debug(`live player list unavailable: ${err.message}`);
        return null;
    }
}

// A player still loading in reports no skills; show their snapshot instead.
function withStoredSkills(ctx, player) {
    if (player.skills?.length) return player;
    const stored = ctx.store.get(player);
    return stored ? { ...player, skills: stored.skills } : player;
}

function buildProfile(player, online) {
    const skills = describeSkills(player.skills);
    return {
        player,
        key: PlayerStore.key(player),
        online,
        lastSeen: player.lastSeen || null,
        fetchedAt: online ? Date.now() : player.lastSeen || Date.now(),
        skills,
        totalLevel: skills.reduce((sum, s) => sum + s.info.level, 0),
        totalXP: skills.reduce((sum, s) => sum + s.xp, 0),
    };
}

// Online players come from a fresh API call so the numbers are live; anyone
// else falls back to their last snapshot.
async function resolvePlayer(ctx, query) {
    const live = await fetchLive(ctx);

    const onlineMatches = live ? matchPlayers(live, query) : [];
    if (onlineMatches.length > 1) return { ambiguous: onlineMatches };
    if (onlineMatches.length === 1) return { profile: buildProfile(withStoredSkills(ctx, onlineMatches[0]), true) };

    const liveKeys = new Set((live || []).map(PlayerStore.key));
    const stored = matchPlayers(ctx.store.all().filter(p => !liveKeys.has(PlayerStore.key(p))), query);
    if (stored.length > 1) return { ambiguous: stored };
    if (stored.length === 1) return { profile: buildProfile(stored[0], false) };

    return { notFound: true, serverDown: live === null };
}

function notFoundReply(query, result) {
    const extra = result.serverDown ? '\nThe server is unreachable right now, so only saved stats were searched.' : '';
    return { reply: { embeds: [errorEmbed(`No player found matching **${query}**.${extra}`)] } };
}

async function levels(ctx, query) {
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(query, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(query, result);
    return { reply: { embeds: [renderPlayerPage(result.profile, 'overview')] } };
}

async function level(ctx, skillQuery, playerQuery) {
    const result = await resolvePlayer(ctx, playerQuery);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(playerQuery, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(playerQuery, result);

    const skill = findSkill(result.profile.skills, skillQuery);
    if (skill) return { reply: { embeds: [renderPlayerPage(result.profile, `skill:${skill.key}`)] } };

    const known = result.profile.skills.map(s => s.name).join(', ') || 'none recorded yet';
    return { reply: { embeds: [errorEmbed(`Unknown skill **${skillQuery}**.\nSkills: ${known}`)] } };
}

async function status(ctx) {
    await ctx.poller.tick();
    return { reply: { embeds: [statusEmbed(ctx.poller.state)] } };
}

// ◀️ ▶️ only when there's more than one page.
function paged(count, pageSize, render) {
    const pages = Math.max(1, Math.ceil(count / pageSize));
    let page = 0;
    const reply = () => ({ embeds: [render(page)] });
    if (pages === 1) return { reply: reply() };

    return {
        reply: reply(),
        menu: {
            emojis: ['◀️', '▶️'],
            onPress: async emoji => {
                const next = emoji === normEmoji('◀️') ? page - 1 : page + 1;
                if (next < 0 || next >= pages) return null;
                page = next;
                return reply();
            },
        },
    };
}

async function online(ctx) {
    const players = await fetchLive(ctx);
    if (!players) {
        const text = ctx.poller.state.status === 'starting' ? 'The server is still starting.' : 'The server is offline or unreachable.';
        return { reply: { embeds: [errorEmbed(text)] } };
    }
    return paged(players.length, ONLINE_PAGE_SIZE, page => onlineEmbed(players, page));
}

// Everyone with saved stats, best first: by total level (then total XP), or by
// XP in one skill. The store has every online player's latest numbers, so
// offline players are ranked on what they had when last seen.
function rankings(ctx, skill) {
    const online = new Set(ctx.poller.state.players.map(PlayerStore.key));
    const rows = [];
    for (const player of ctx.store.all()) {
        const skills = describeSkills(player.skills);
        const row = { player, online: online.has(PlayerStore.key(player)) };
        if (skill) {
            const s = skills.find(entry => entry.key === skill.key);
            if (!s?.xp) continue;
            rows.push({ ...row, level: s.info.level, xp: s.xp });
        } else {
            if (!skills.length) continue;
            rows.push({ ...row, level: skills.reduce((n, s) => n + s.info.level, 0), xp: skills.reduce((n, s) => n + s.xp, 0) });
        }
    }
    return rows.sort((a, b) => b.level - a.level || b.xp - a.xp);
}

async function leaderboard(ctx, skillQuery) {
    const skill = skillQuery ? catalogSkill(skillQuery) : null;
    if (skillQuery && !skill) return { reply: { embeds: [errorEmbed(`Unknown skill **${skillQuery}**.`)] } };

    // Fold in the latest numbers for whoever is online right now.
    await fetchLive(ctx);
    const rows = rankings(ctx, skill);
    return paged(rows.length, LEADERBOARD_PAGE_SIZE, page => leaderboardEmbed(rows, skill, page));
}

// Keyed by slash command name; each gets the interaction and returns the reply.
export const commands = {
    levels: (i, ctx) => levels(ctx, i.options.getString('player', true)),
    level: (i, ctx) => level(ctx, i.options.getString('skill', true), i.options.getString('player', true)),
    leaderboard: (i, ctx) => leaderboard(ctx, i.options.getString('skill')),
    status: (i, ctx) => status(ctx),
    online: (i, ctx) => online(ctx),
    help: () => ({ reply: { embeds: [helpEmbed()] } }),
};
