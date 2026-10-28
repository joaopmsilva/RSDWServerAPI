// Quests, journal, skill perks and the in-game clock, as reported by mod 0.6.0+.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// "Quest_FH_MirrorMirror" -> "Mirror Mirror", for when the game's own name
// couldn't be read (mod 0.6.0 read only a few; 0.6.1 asks the game).
function prettify(id) {
    return String(id || '')
        .replace(/^(Quest|BP)_/i, '')
        .replace(/^((DR|FH|SW|UmS|FTUE)_)+/, '')
        .replace(/_C$/, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

// Quest titles from the wiki, matched on letters only ("CooksAssistant" ->
// "Cook's Assistant"), for when the game's own name isn't available.
const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let wikiTitles = new Map();

export async function loadQuestTitles() {
    try {
        const url = 'https://dragonwilds.runescape.wiki/api.php?action=query&list=categorymembers&cmtitle=Category:Quests&cmlimit=500&cmnamespace=0&format=json';
        const res = await fetch(url, { headers: { 'User-Agent': 'RSDWServerAPI-bot (Discord bot for a Dragonwilds server)' }, signal: AbortSignal.timeout(10000) });
        const titles = (await res.json()).query?.categorymembers?.map(m => m.title) || [];
        wikiTitles = new Map(titles.filter(t => !t.includes('/')).map(t => [squash(t), t]));
    } catch {
        // No wiki: names fall back to tidied-up ids.
    }
}

// The game's name, else a wiki title the id matches, else the id tidied up.
export function questName(q) {
    if (q.name) return q.name;
    const pretty = prettify(q.id);
    return wikiTitles.get(squash(pretty)) || wikiTitles.get(squash(String(q.id).replace(/^Quest_/i, ''))) || pretty;
}
// "PerkV2_Attack_Parry" -> "Parry"
export const perkName = p => p.name || prettify(String(p.id || '').replace(/^PerkV2_[A-Za-z]+_/, ''));

// How many quests and journal entries the game has (mod 0.6.1+), from the last
// world read; kept in data/totals.json so lookups have it while the server is down.
const TOTALS_FILE = path.join(config.dataDir, 'totals.json');
let totals = {};
try {
    totals = JSON.parse(fs.readFileSync(TOTALS_FILE, 'utf8'));
} catch {
    totals = {};
}

export function rememberTotals(world) {
    const next = world?.totals;
    if (!next || (!next.quests && !next.journal)) return;
    if (next.quests === totals.quests && next.journal === totals.journal) return;
    totals = { quests: next.quests || 0, journal: next.journal || 0 };
    try {
        fs.writeFileSync(TOTALS_FILE, JSON.stringify(totals));
    } catch {
        // Only a nicety - the counts still show without the total.
    }
}

// " / 60" when the total is known and not below what the player has.
export const outOf = (count, kind) => (totals[kind] >= count && totals[kind] > 0 ? ` / ${totals[kind]}` : '');

// null when the player's quests have never been read (an older mod, or they
// haven't been online since).
export function questStats(player) {
    const quests = player?.quests;
    if (!Array.isArray(quests)) return null;
    const done = quests.filter(q => q.complete);
    return {
        done: done.length,
        main: done.filter(q => q.kind === 'main').length,
        side: done.filter(q => q.kind === 'side').length,
        tasks: done.filter(q => q.kind === 'task').length,
        active: quests.filter(q => !q.complete),
        completed: done,
    };
}

const JOURNAL_KINDS = [
    ['lore', '📜', 'Lore'],
    ['people', '🧑', 'People'],
    ['places', '🗺️', 'Places'],
    ['treasure', '💰', 'Treasure'],
    ['recipes', '🍲', 'Recipes'],
    ['items', '🎒', 'Items'],
    ['world', '🌍', 'World'],
    ['other', '📘', 'Other'],
];

// [{ emoji, name, count }] in a fixed order, only kinds with entries.
export function journalKinds(journal) {
    if (!journal?.kinds) return [];
    return JOURNAL_KINDS.filter(([kind]) => journal.kinds[kind] > 0).map(([kind, emoji, name]) => ({ emoji, name, count: journal.kinds[kind] }));
}

// ---- in-game clock --------------------------------------------------------

const hhmm = hour => {
    const total = Math.floor((((hour % 24) + 24) % 24) * 60);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// { emoji, time, day, next } or null. next says when day or night starts, in
// game time and - when the day length is known - real minutes.
export function clock(world) {
    const t = world?.time;
    if (!t) return null;
    const until = (t.isDay ? t.dusk : t.dawn) - t.hour;
    const hoursUntil = until < 0 ? until + 24 : until;
    const realMinutes = t.minutesPerDay > 0 ? Math.round((hoursUntil / 24) * t.minutesPerDay) : null;
    const when = realMinutes === null ? '' : realMinutes < 1 ? ' · any moment' : ` · in ${realMinutes} min`;
    return {
        emoji: t.isDay ? '☀️' : '🌙',
        time: hhmm(t.hour),
        day: t.day,
        paused: t.paused,
        next: `${t.isDay ? '🌙 Night' : '☀️ Dawn'} at ${hhmm(t.isDay ? t.dusk : t.dawn)}${when}`,
    };
}

const DIFFICULTY = { normal: '🟢 Normal', hard: '🔴 Hard', creative: '🎨 Creative', custom: '⚙️ Custom' };
const HARDCORE = { active: '💀 Hardcore', failed: '💀 Hardcore (failed)', succeeded: '🏅 Hardcore (survived)' };

export const difficultyLabel = world => DIFFICULTY[world?.difficulty] || null;
export const hardcoreLabel = world => HARDCORE[world?.hardcore] || null;

// "BP_RaidEvent_Goblins_C" -> "Goblins"; "" when nothing but the event type is left.
export function eventName(name) {
    return prettify(name)
        .replace(/\b(Raid|Hunted|World|Base)\s*(Event)?\b/gi, '')
        .replace(/\bEvent\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}
