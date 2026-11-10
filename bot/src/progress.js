// Quests, journal and skill perks, as reported by mod 0.6.0+, and names for
// creatures and deaths.

import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { questList } from './quest-list.js';

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

let wikiMonsters = new Map();
let wikiItems = new Map();

// Every page in a wiki category (500 a request), by squashed title.
async function wikiCategory(category) {
    const titles = [];
    let next = '';
    for (let page = 0; page < 20; page++) {
        const url = `https://dragonwilds.runescape.wiki/api.php?action=query&list=categorymembers&cmtitle=Category:${category}&cmlimit=500&cmnamespace=0&format=json${next}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'RSDWServerAPI-bot (Discord bot for a Dragonwilds server)' }, signal: AbortSignal.timeout(10000) });
        const body = await res.json();
        titles.push(...(body.query?.categorymembers?.map(m => m.title) || []));
        const more = body.continue?.cmcontinue;
        if (!more) break;
        next = `&cmcontinue=${encodeURIComponent(more)}`;
    }
    return new Map(titles.filter(t => !t.includes('/')).map(t => [squash(t), t]));
}

// Quest, monster and item titles from the wiki, refreshed daily by index.js.
export async function loadWikiNames() {
    try {
        wikiTitles = await wikiCategory('Quests');
        wikiMonsters = await wikiCategory('Monsters');
        wikiItems = await wikiCategory('Items');
    } catch {
        // No wiki: names fall back to the game's, or tidied-up ids.
    }
}

// "ITEM_Resources_Currency_Chit_Garou" -> "Garou Chit". Ids name the sort of
// item first and what it's made of last, so: drop the filing words (category,
// tier, quest codes), then try the last two or three parts in every order
// against the wiki's item titles (singular or plural). Failing that, the type
// goes last: "Arrows_Mithril_Bodkin" -> "Mithril Bodkin Arrows",
// "Fibres_Mystic" -> "Mystic Fibres".
const idWords = part => part.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim();
// Parts of an id that only file it: what sort of item, a tier, a quest code.
const ID_FILING = /^(resources?|consumables?|ammo|tools?|weapons?|armou?r|equipment|quest|misc|currency|masterworks|items?|T\d+|DR|FH|SW|UmS|FTUE|[A-Z]{1,3}Q\d+)$/i;
function orders(parts) {
    if (parts.length <= 1) return [parts];
    return parts.flatMap((p, i) => orders([...parts.slice(0, i), ...parts.slice(i + 1)]).map(rest => [p, ...rest]));
}
// The names the game shows for its items, each item's type and what each
// vestige teaches, read from the game's files (item-names.json, game 1.0.2).
// Ids often don't spell out the name ("Commemorative Coin" is
// DA_Consumable_Vestige_Trinket_Amulet_of_Glory), so this comes first.
export const gameItems = { names: {}, kinds: {}, teaches: {} };
try {
    Object.assign(gameItems, JSON.parse(fs.readFileSync(new URL('./item-names.json', import.meta.url), 'utf8')));
} catch (err) {
    console.warn(`item-names.json unreadable (${err.message}); item names come from their ids`);
}

// An item's in-game name, or one worked out from its id for items newer than item-names.json.
export function itemName(id) {
    return gameItems.names[id] || idItemName(id);
}

export function idItemName(id) {
    const all = String(id || '').replace(/^ITEM_/i, '').split('_').filter(Boolean);
    const kept = all.filter(p => !ID_FILING.test(p));
    const parts = (kept.length ? kept : all.slice(-1)).map(idWords);
    if (!parts.length) return String(id || '');
    const wiki = words => {
        const key = squash(words);
        return wikiItems.get(key) || wikiItems.get(key + 's') || wikiItems.get(key.replace(/s$/, ''));
    };
    // One word alone only when that's all the id has: "Meat" isn't "Double Meat Sandwich".
    for (let n = Math.min(3, parts.length); n >= (parts.length === 1 ? 1 : 2); n--) {
        for (const order of orders(parts.slice(-n))) {
            const hit = wiki(order.join(' '));
            if (hit) return hit;
        }
    }
    // One part whose words are backwards: "LogsOak" -> "Oak Logs".
    const last = parts.at(-1);
    const flipped = last.split(' ').reverse().join(' ');
    if (wiki(flipped)) return wiki(flipped);
    // The last part already says what it is: "FishingNet_MysticNet" -> "Mystic Net".
    if (parts.length === 1 || last.split(' ').at(-1) === parts.at(-2).split(' ').at(-1)) return last;
    const tail = parts.slice(-3);
    return [...tail.slice(1), tail[0]].join(' ');
}

// The game's name, else a wiki title the id matches, else the id tidied up.
export function questName(q) {
    if (q.name) return q.name;
    if (QUEST_IDS[q.id]) return QUEST_IDS[q.id];
    const pretty = prettify(q.id);
    // The wiki's quest list (built in, so it works before the wiki has loaded), then its Quests category.
    const listed = questList().find(t => squash(t.title) === squash(pretty));
    return listed?.title || wikiTitles.get(squash(pretty)) || wikiTitles.get(squash(String(q.id).replace(/^Quest_/i, ''))) || pretty;
}

// Game quest ids that don't spell out their wiki name. From the asset folders
// (FH = Fellhollow, DR = Dowdun Reach, SW = Scorned Wilderness, FTUE = the
// tutorial), the quest's kind and the wiki's regions and quest givers. The
// Fellhollow Wither/Collector ones and the Dowdun Reach SQ ones are the best
// match by region and giver rather than certain.
const QUEST_IDS = {
    Quest_FTUE_FS: 'First Steps',
    Quest_FTUE_GS: 'Getting Started',
    Quest_FTUE_RC: 'Ratcatcher',
    Quest_FTUE_RM: 'Rune Mysteries',
    Quest_FTUE_Farming: 'Growing Pains',
    Quest_DR_FTUE_Fishing: 'Shrimp Catcher',
    Quest_DeathQuestMain: 'Withering Heights',
    Quest_DR_MainQuest: "Black Knight's Fortress",
    Quest_SW_MainQuest: 'Regicide',
    Quest_UmS_MainQuest: "Icthlarin's Little Helper",
    Quest_UMS_MappingTheSands: 'Mapping The Sands I',
    Quest_UMS_MappingTheSands2: 'Mapping The Sands II',
    Quest_Ums_SQ_ReelDowner: 'A Reel Downer', // 1.0.2
    Quest_PenguinHunting: 'Penguin Hunting', // 1.0.2's penguin hunt - an activity, not on the wiki's quest list
    Quest_ElderGarou: 'A Room With A Garou',
    Quest_AMelodyRemebered: 'A Melody Remembered',
    Quest_GreatBodyRobbery: 'The Great Body Robbery',
    Quest_FH_GhostQuest: 'Even More Restless Ghosts',
    Quest_FH_NightoftheSpectralBoom: 'Things That Go Boom In The Night',
    Quest_FH_LettersForTheDead: 'Letters for the Dead',
    Quest_FH_WitherBeast: 'The Wild Hunt',
    Quest_FH_WitherWard: 'Seeking Salvation',
    Quest_FH_CollectorsCalling: "Doric's Quest",
    Quest_SQ1_ThinkingWithPortals: "What's Theirs is Mine!",
    Quest_SQ2_AnimalLover: 'Wanted!',
    Quest_SQ3_Nevermore: 'Biohazard',
    Quest_Contact: 'Contact!',
};

// The wiki quest list (quest-list.js) with each quest's state for this player:
// done, active (started) or todo. Quests the game has that the wiki doesn't
// list (tutorial steps, tasks) are left out.
export function questChecklist(player, list) {
    const state = new Map();
    for (const q of player?.quests || []) state.set(squash(questName(q)), q.complete ? 'done' : 'active');
    return list.map(q => ({ ...q, state: state.get(squash(q.title)) || 'todo' }));
}

// Quests done out of the wiki's quest list - the count /quests shows. The
// game's own total also counts tutorial steps, tribe tasks and activities.
export function wikiQuestCount(player) {
    const all = questChecklist(player, questList());
    const done = all.filter(q => q.state === 'done');
    return { done: done.length, total: all.length, main: done.filter(q => q.primary).length, side: done.filter(q => !q.primary).length };
}
// "BP_AI_Goblin_Melee_C" -> "Goblin Melee"
// A killed creature's name: the wiki's title for it when one matches - the
// game's own name first, then its class with variants dropped one word at a
// time ("Goblin Melee" -> "Goblin") - else the game's name, else the class tidied up.
export function creatureName(gameName, cls) {
    const pretty = prettify(String(cls || '').replace(/\s+boss$/, '').replace(/^BP_/, '').replace(/^(AI|NPC|Enemy|Creature|Character|Dom)_/i, '')).replace(/\s+Character$/, '');
    const tries = [gameName];
    const words = pretty.split(' ');
    for (let n = words.length; n > 0; n--) tries.push(words.slice(0, n).join(' '));
    for (const t of tries) {
        const hit = t && wikiMonsters.get(squash(t));
        if (hit) return hit;
    }
    return gameName || pretty || 'Something';
}

// What a death event (mod 0.9.0+) says killed them, as text after "has died":
// "killed by a Giant Rat", "killed by Tobin", "" when the game didn't say.
// Older mods sent the game's event tag instead, which says nothing useful.
export function deathCause(event) {
    switch (event?.cause) {
        case 'creature': {
            const name = creatureName('', event.message);
            const article = /\sboss$/.test(event.message || '') ? 'the boss' : /^[aeiou]/i.test(name) ? 'an' : 'a';
            return `killed by ${article} ${name}`;
        }
        case 'player':
            return event.message ? `killed by ${event.message}` : 'killed by another player';
        case 'self':
            return 'a fall or the elements';
        case 'other': {
            // KillZVolume: the engine's floor under the world - they fell out of it.
            if (/KillZ/i.test(event.message || '')) return 'fell out of the world';
            if (/PainCausing|Hazard|Water|Lava/i.test(event.message || '')) return `killed by the ${prettify(event.message).toLowerCase()}`;
            const what = prettify(event.message || '');
            return what ? `killed by ${what}` : '';
        }
        default:
            return '';
    }
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
