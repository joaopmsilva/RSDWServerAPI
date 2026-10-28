import { api } from './api.js';
import {
    LEADERBOARD_PAGE_SIZE,
    ambiguousEmbed,
    deathBoardEmbed,
    deathsEmbed,
    displayName,
    gainersEmbed,
    gainsEmbed,
    playtimeBoardEmbed,
    playtimeEmbed,
    errorEmbed,
    helpEmbed,
    leaderboardEmbed,
    renderPlayerPage,
    statusEmbed,
    itemEmbed,
    alertButtons,
    alertsEmbed,
    linkCodeEmbed,
    linkInfoEmbed,
    okEmbed,
    perksEmbed,
    progressEmbed,
    questLeaderboardEmbed,
    killBoardEmbed,
    killsEmbed,
    questsEmbed,
} from './embeds.js';
import { questStats } from './progress.js';
import { logger } from './log.js';
import { normEmoji } from './menus.js';
import { catalogSkill, describeSkills, findSkill } from './skills.js';
import { deathBoard, gainsFor, killBoard, playtimeBoard, topGainers } from './stats.js';
import { PlayerStore } from './store.js';
import { findItem, itemsKnown } from './items.js';
import { wikiInfo } from './wiki.js';

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
    const stored = ctx.store.get(player);
    if (!stored) return player;
    return { ...player, skills: player.skills?.length ? player.skills : stored.skills, maxHealth: stored.maxHealth };
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
export async function resolvePlayer(ctx, query) {
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

// Everyone with saved stats, best first: by total level (then total XP), or by
// XP in one skill. The store has every online player's latest numbers, so
// offline players are ranked on what they had when last seen.
function rankings(ctx, skill) {
    const online = new Set(ctx.poller.state.players.map(PlayerStore.key));
    const rows = [];
    for (const player of ctx.store.all()) {
        if (ctx.history?.isHidden(PlayerStore.key(player))) continue;
        const skills = describeSkills(player.skills);
        const row = { player, online: online.has(PlayerStore.key(player)) };
        if (skill) {
            const s = skills.find(entry => entry.key === skill.key);
            if (!s?.xp) continue;
            rows.push({ ...row, level: s.info.level, xp: s.xp });
        } else {
            if (!skills.length) continue;
            const quests = questStats(player);
            rows.push({
                ...row,
                level: skills.reduce((n, s) => n + s.info.level, 0),
                xp: skills.reduce((n, s) => n + s.xp, 0),
                ...(quests ? { quests: quests.done } : {}),
            });
        }
    }
    return rows.sort((a, b) => b.level - a.level || b.xp - a.xp);
}

// Most quests done first, then most main quests.
function questRankings(ctx) {
    const online = new Set(ctx.poller.state.players.map(PlayerStore.key));
    const rows = [];
    for (const player of ctx.store.all()) {
        if (ctx.history?.isHidden(PlayerStore.key(player))) continue;
        const quests = questStats(player);
        if (!quests?.done) continue;
        rows.push({ player, online: online.has(PlayerStore.key(player)), done: quests.done, main: quests.main });
    }
    return rows.sort((a, b) => b.done - a.done || b.main - a.main);
}

export const QUESTS_BOARD = 'quests';

// board: total, skill (with skillQuery), quests or kills.
async function leaderboard(ctx, board, skillQuery) {
    if (board === 'kills') {
        const rows = killBoard(ctx);
        return paged(rows.length, LEADERBOARD_PAGE_SIZE, page => killBoardEmbed(rows, page));
    }
    // Fold in the latest numbers for whoever is online right now.
    if (board === QUESTS_BOARD) {
        await fetchLive(ctx);
        const rows = questRankings(ctx);
        return paged(rows.length, LEADERBOARD_PAGE_SIZE, page => questLeaderboardEmbed(rows, page));
    }

    const skill = board === 'skill' && skillQuery ? catalogSkill(skillQuery) : null;
    if (board === 'skill' && !skill) return { reply: { embeds: [errorEmbed(`Unknown skill **${skillQuery}**.`)] } };

    await fetchLive(ctx);
    const rows = rankings(ctx, skill);
    return paged(rows.length, LEADERBOARD_PAGE_SIZE, page => leaderboardEmbed(rows, skill, page));
}

async function perks(ctx, query) {
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(query, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(query, result);
    return { reply: { embeds: [perksEmbed(result.profile)] } };
}

// A player's quests; without a name, your own linked character's, or the
// quest leaderboard if you haven't linked one.
async function quests(ctx, query, user) {
    if (!query) {
        const link = ctx.links.of(user.id);
        if (!link) return leaderboard(ctx, QUESTS_BOARD);
        query = link.name;
    }
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return { reply: { embeds: [ambiguousEmbed(query, result.ambiguous)] } };
    if (result.notFound) return notFoundReply(query, result);
    return { reply: { embeds: [questsEmbed(result.profile)] } };
}

// The linked character: online it's live, otherwise its last snapshot.
async function me(ctx, user) {
    const link = ctx.links.of(user.id);
    if (!link) return { reply: { embeds: [errorEmbed("You haven't linked a character yet - use `/link` first.")] } };

    const live = await fetchLive(ctx);
    const onlineNow = (live || []).find(p => PlayerStore.key(p) === link.key || (link.netId && p.uniqueNetId === link.netId && !PlayerStore.isCharacterKey(link.key)));
    const stored = ctx.store.byKey(link.key);
    if (!onlineNow && !stored) {
        return { reply: { embeds: [errorEmbed(`No stats saved for **${link.name}** yet - they show up after you've been online.`)] } };
    }
    const profile = onlineNow ? buildProfile(withStoredSkills(ctx, onlineNow), true) : buildProfile(stored, false);
    const player = onlineNow ? { ...stored, ...onlineNow, quests: onlineNow.quests || stored?.quests, journal: onlineNow.journal || stored?.journal } : stored;
    profile.player = player;
    const key = PlayerStore.key(player);
    return {
        reply: {
            embeds: [
                renderPlayerPage(profile, 'overview'),
                progressEmbed(profile, { playtime: ctx.history.playtime(key), deaths: ctx.history.deaths(key), kills: ctx.history.kills(key) }),
            ],
        },
    };
}

function link(ctx, interaction) {
    const { code, minutes } = ctx.links.createCode(interaction.user.id, interaction);
    return { reply: { embeds: [linkCodeEmbed(code, minutes, ctx.links.of(interaction.user.id))] } };
}

function alerts(ctx, user) {
    const current = ctx.links.of(user.id);
    if (!current) return { reply: { embeds: [errorEmbed('Link your character first with `/link` - alerts are about what happens to it.')] } };
    return { reply: { embeds: [alertsEmbed(current)], components: alertButtons(current) } };
}

function unlink(ctx, user) {
    const removed = ctx.links.unlink(user.id);
    if (!removed) return { reply: { embeds: [linkInfoEmbed(null)] } };
    return { reply: { embeds: [okEmbed(`🔗 Unlinked from **${removed.name}**. You won't be pinged for raids or hunts any more.`)] } };
}

// One player by name, or null with a reply to send instead.
async function findOne(ctx, query) {
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return { reply: { reply: { embeds: [ambiguousEmbed(query, result.ambiguous)] } } };
    if (result.notFound) return { reply: notFoundReply(query, result) };
    return { profile: result.profile, name: displayName(result.profile.player) };
}

// No player: who gained the most. A player: what they gained, skill by skill.
async function gains(ctx, query, period) {
    if (!query) return { reply: { embeds: [gainersEmbed(topGainers(ctx, period), period)] } };
    const found = await findOne(ctx, query);
    if (found.reply) return found.reply;
    return { reply: { embeds: [gainsEmbed(found.name, period, gainsFor(ctx, found.profile.key, period))] } };
}

async function playtime(ctx, query) {
    if (!query) return { reply: { embeds: [playtimeBoardEmbed(playtimeBoard(ctx))] } };
    const found = await findOne(ctx, query);
    if (found.reply) return found.reply;
    return { reply: { embeds: [playtimeEmbed(found.name, ctx.history.playtime(found.profile.key))] } };
}

// No player: the kill leaderboard. A player: their kills, and which creatures.
async function kills(ctx, query) {
    if (!query) return leaderboard(ctx, 'kills');
    const found = await findOne(ctx, query);
    if (found.reply) return found.reply;
    const stored = ctx.store.byKey(found.profile.key);
    const types = found.profile.player.creatureTypes ?? stored?.creatureTypes ?? -1;
    return { reply: { embeds: [killsEmbed(found.name, ctx.history.kills(found.profile.key), types)] } };
}

async function deaths(ctx, query) {
    if (!query) return { reply: { embeds: [deathBoardEmbed(deathBoard(ctx))] } };
    const found = await findOne(ctx, query);
    if (found.reply) return found.reply;
    return { reply: { embeds: [deathsEmbed(found.name, ctx.history.deaths(found.profile.key))] } };
}

// Keyed by slash command name; each gets the interaction and returns the reply.
export const commands = {
    levels: (i, ctx) => levels(ctx, i.options.getString('player', true)),
    leaderboard: (i, ctx) => leaderboard(ctx, i.options.getSubcommand(false) || 'total', i.options.getString('skill')),
    kills: (i, ctx) => kills(ctx, i.options.getString('player')),
    perks: (i, ctx) => perks(ctx, i.options.getString('player', true)),
    quests: (i, ctx) => quests(ctx, i.options.getString('player'), i.user),
    me: (i, ctx) => me(ctx, i.user),
    link: (i, ctx) => link(ctx, i),
    unlink: (i, ctx) => unlink(ctx, i.user),
    alerts: (i, ctx) => alerts(ctx, i.user),
    gains: (i, ctx) => gains(ctx, i.options.getString('player'), i.options.getString('period') || 'week'),
    playtime: (i, ctx) => playtime(ctx, i.options.getString('player')),
    deaths: (i, ctx) => deaths(ctx, i.options.getString('player')),
    status: (i, ctx) => status(ctx),
    item: async i => {
        const query = i.options.getString('item', true);
        const item = await findItem(query);
        if (item) return { reply: { embeds: [itemEmbed(item, await wikiInfo(item.name))] } };
        const why = itemsKnown() ? '' : '\nThe item list loads from the server the first time it is online.';
        return { reply: { embeds: [errorEmbed(`No item found matching **${query}**.${why}`)] } };
    },
    help: () => ({ reply: { embeds: [helpEmbed()] } }),
};
