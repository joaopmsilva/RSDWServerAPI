import { api } from './api.js';
import {
    LEADERBOARD_PAGE_SIZE,
    ONLINE_PAGE_SIZE,
    PLAYER_NAV,
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

// A command returns { reply } or { reply, menu: { emojis, onPress } }; index.js
// sends the reply and turns the menu into reaction buttons.

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

async function reloadProfile(ctx, profile) {
    const live = await fetchLive(ctx);
    const player = live?.find(p => PlayerStore.key(p) === profile.key);
    if (player) return buildProfile(withStoredSkills(ctx, player), true);

    const stored = ctx.store.all().find(p => PlayerStore.key(p) === profile.key);
    return stored ? buildProfile(stored, false) : profile;
}

function playerView(ctx, profile, startPage) {
    let page = startPage;
    const render = () => ({ embeds: [renderPlayerPage(profile, page)] });

    return {
        reply: render(),
        menu: {
            emojis: PLAYER_NAV.map(n => n.emoji),
            onPress: async emoji => {
                const nav = PLAYER_NAV.find(n => normEmoji(n.emoji) === emoji);
                if (!nav) return null;
                if (nav.page === 'refresh') {
                    profile = await reloadProfile(ctx, profile);
                } else {
                    if (nav.page === page) return null;
                    page = nav.page;
                }
                return render();
            },
        },
    };
}

function notFoundReply(query, result) {
    const extra = result.serverDown ? '\nThe server is unreachable right now, so only saved stats were searched.' : '';
    return { reply: { embeds: [errorEmbed(`No player found matching **${query}**.${extra}`)] } };
}

async function levels(ctx, query) {
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(query, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(query, result);
    return playerView(ctx, result.profile, 'overview');
}

async function level(ctx, skillQuery, playerQuery) {
    const result = await resolvePlayer(ctx, playerQuery);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(playerQuery, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(playerQuery, result);

    const skill = findSkill(result.profile.skills, skillQuery);
    if (skill) return playerView(ctx, result.profile, `skill:${skill.key}`);

    const known = result.profile.skills.map(s => s.name).join(', ') || 'none recorded yet';
    return { reply: { embeds: [errorEmbed(`Unknown skill **${skillQuery}**.\nSkills: ${known}`)] } };
}

async function status(ctx) {
    await ctx.poller.tick();
    const render = () => ({ embeds: [statusEmbed(ctx.poller.state)] });
    return {
        reply: render(),
        menu: {
            emojis: ['🔄'],
            onPress: async () => {
                await ctx.poller.tick();
                return render();
            },
        },
    };
}

async function online(ctx) {
    let players = await fetchLive(ctx);
    if (!players) {
        const text = ctx.poller.state.status === 'starting' ? 'The server is still starting.' : 'The server is offline or unreachable.';
        return { reply: { embeds: [errorEmbed(text)] } };
    }

    let page = 0;
    const pages = () => Math.max(1, Math.ceil(players.length / ONLINE_PAGE_SIZE));
    const render = () => ({ embeds: [onlineEmbed(players, page)] });

    return {
        reply: render(),
        menu: {
            emojis: players.length > ONLINE_PAGE_SIZE ? ['◀️', '▶️', '🔄'] : ['🔄'],
            onPress: async emoji => {
                if (emoji === normEmoji('◀️')) {
                    if (page === 0) return null;
                    page--;
                } else if (emoji === normEmoji('▶️')) {
                    if (page >= pages() - 1) return null;
                    page++;
                } else {
                    const fresh = await fetchLive(ctx);
                    if (!fresh) return { embeds: [errorEmbed('The server is offline or unreachable.')] };
                    players = fresh;
                    page = Math.min(page, pages() - 1);
                }
                return render();
            },
        },
    };
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
    let rows = rankings(ctx, skill);
    let page = 0;
    const pages = () => Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    const render = () => ({ embeds: [leaderboardEmbed(rows, skill, page)] });

    return {
        reply: render(),
        menu: {
            emojis: rows.length > LEADERBOARD_PAGE_SIZE ? ['◀️', '▶️', '🔄'] : ['🔄'],
            onPress: async emoji => {
                if (emoji === normEmoji('◀️')) {
                    if (page === 0) return null;
                    page--;
                } else if (emoji === normEmoji('▶️')) {
                    if (page >= pages() - 1) return null;
                    page++;
                } else {
                    await fetchLive(ctx);
                    rows = rankings(ctx, skill);
                    page = Math.min(page, pages() - 1);
                }
                return render();
            },
        },
    };
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
