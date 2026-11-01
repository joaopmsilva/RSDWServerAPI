// The game's quests as the wiki lists them (https://dragonwilds.runescape.wiki/w/Quests):
// primary and secondary, by region, with where each one starts. Refreshed daily
// from the wiki by loadQuestList(); the copy below is used until then, or if
// the wiki can't be reached.

import { logger } from './log.js';

const log = logger('quest-list');
const PAGE = 'https://dragonwilds.runescape.wiki/api.php?action=parse&page=Quests&prop=wikitext&format=json&formatversion=2';

// [title, primary?, tutorial?, region, where to start] - the wiki page on 2026-11-01.
const BUILT_IN = [
    ['First Steps', true, true, 'Temple Woods', 'Automatically started with new character.'],
    ['Getting Started', true, true, 'Temple Woods', 'Speak to Doric just outside of the temple.'],
    ['Ratcatcher', true, true, 'Temple Woods', 'Speak to Vannaka near the old windmill.'],
    ['Rune Mysteries', true, true, 'Temple Woods', 'Speak to Zanik on the path leading to Bramblemead Valley.'],
    ['Dragon Slayer', true, false, 'Brynmoor/Ghornfell', 'Speak to the Wise Old Man in Bramblemead Village.'],
    ['Withering Heights', true, false, 'Fellhollow', "Speak to the Wise Old Man near Ashien's Watch."],
    ["Black Knight's Fortress", true, false, 'Dowdun Reach', 'Speak to Death in the Forgotten Temple.'],
    ["Icthlarin's Little Helper", true, false, 'Umbral Sands', 'Interact with the door to the Umbral Sands.'],
    ['Regicide', true, false, 'Scorned Wilderness', "Interact with the Dragon Gate north-west of Velgar's Rise."],
    ['Growing Pains', false, true, 'Brynmoor', 'Speak to the Wise Old Man in Bramblemead Village.'],
    ['Shrimp Catcher', false, true, 'Brynmoor', 'Speak to the Wise Old Man in Bramblemead Village.'],
    ['Restless Ghosts', false, false, 'Brynmoor', 'Interact with the crumbling well in Bramblemead Village.'],
    ['Goblin Diplomacy', false, false, 'Brynmoor', 'Speak to Zanik in Bramblemead Valley.'],
    ['Highlighting the Problem', false, false, 'Brynmoor', 'Interact with the statue of a wizard in the Runecrafting Guild in Bramblemead Valley.'],
    ['Granite Mauled', false, false, 'Ghornfell', 'Speak to Doric in the Fractured Plains.'],
    ['Heartstrings', false, false, 'Ghornfell', 'Interact with the memorial on top of the hill in the Fractured Plains.'],
    ['Dog Days', false, false, 'Ghornfell', 'Speak to Vannaka at the centre of the Stormtouched Highlands.'],
    ["Cook's Assistant", false, false, 'Ghornfell', 'Speak with Slopfinger at the southern border between Stormtouched Highlands and Fractured Plains.'],
    ['Animal Magnetism', false, false, 'Ghornfell', 'Speak to Manktongue at the southern border between Stormtouched Highlands and Fractured Plains.'],
    ['A Room With A Garou', false, false, 'Ghornfell', 'Speak to Caratacus in the Fractured Plains.'],
    ['A Melody Remembered', false, false, 'Ghornfell', 'Repair a broken music box found in a desk within the Stormtouched Highlands.'],
    ['The Great Body Robbery', false, false, 'Ghornfell', 'Speak to Doctor Fenkenstrain in the Bloodblight Swamp.'],
    ['Even More Restless Ghosts', false, false, 'Fellhollow', 'Speak to Zanik in Fellhollow.'],
    ['The Wild Hunt', false, false, 'Fellhollow', 'Speak to Vannaka in Bleaksfield Valley.'],
    ['Things That Go Boom In The Night', false, false, 'Fellhollow', 'Speak to Vannaka in Bleaksfield Valley.'],
    ['Seeking Salvation', false, false, 'Fellhollow', 'Speak to Doric east of the Lake of Lost Souls, inside a cave.'],
    ["Doric's Quest", false, false, 'Fellhollow', 'Speak to Doric east of the Lake of Lost Souls, inside a cave.'],
    ['Letters for the Dead', false, false, 'Fellhollow', 'Speak to Postie Pete in the Forgotten Temple.'],
    ['What Remains is Written', false, false, 'Fellhollow', 'Speak to Abraxus The Eternal in Coalridge Pass.'],
    ['Mirror Mirror', false, false, 'Fellhollow', 'Interact with the mirror west of the Guthix shrine near Emberwood.'],
    ['Biohazard', false, false, 'Dowdun Reach', 'Attack and pick up the lootdrop of the corrupted raven in The Courtyard.'],
    ['Wanted!', false, false, 'Dowdun Reach', 'Speak to Vannaka in The Courtyard.'],
    ["What's Theirs is Mine!", false, false, 'Dowdun Reach', 'Speak to Doric next to the Dreaming Stone in The Nexus.'],
    ['Contact!', false, false, 'Umbral Sands', 'Speak to Avisk Crystal in Dunes of Uzzer.'],
    ['Brink of Extinction', false, false, 'Umbral Sands', 'Speak to Zi at The Burning Spire, south of the Sinking Pyramid.'],
    ['Mapping The Sands I', false, false, 'Umbral Sands', 'Speak to Anamcara in Alcarrid Camp.'],
    ['Mapping The Sands II', false, false, 'Umbral Sands', 'Speak to Anamcara in Alcarrid Camp.'],
].map(([title, primary, tutorial, region, start]) => ({ title, primary, tutorial, region, start }));

let quests = BUILT_IN;

export const questList = () => quests;

const linkLabel = text => text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
const plain = text => linkLabel(text).replace(/''+/g, '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
// "[[Brynmoor]]/[[Ghornfell]]": a cell that's only links is a region.
const isRegion = text => /^\s*(\[\[[^\]]+\]\]\s*\/?\s*)+$/.test(text);

// The primary and secondary tables of the wiki page, row by row. Cells that
// span several rows (type, region, where to start) carry down.
export function parseQuestTables(wikitext) {
    const section = String(wikitext || '').split(/==\s*List of quests\s*==/i)[1]?.split(/\n==[^=]/)[0];
    if (!section) return [];
    const out = [];
    for (const part of section.split(/\n===\s*/).slice(1)) {
        const heading = part.split('\n')[0].replace(/=+\s*$/, '').trim().toLowerCase();
        if (heading !== 'primary' && heading !== 'secondary') continue;
        let tutorial = false;
        let region = '';
        let start = '';
        for (const row of part.split(/\n\|-/).slice(1)) {
            const cells = row
                .split('\n')
                .filter(l => l.startsWith('|') && !l.startsWith('|}') && !l.startsWith('|-'))
                .map(l => l.slice(1).replace(/^\s*(rowspan|colspan)="?\d+"?\s*\|/i, '').trim());
            const at = cells.findIndex(c => c.includes('[['));
            if (at < 0) continue;
            if (at > 0) tutorial = /tutorial/i.test(cells[at - 1]);
            let rest = cells.slice(at + 1);
            if (rest[0] && isRegion(rest[0])) {
                region = plain(rest[0]);
                rest = rest.slice(1);
            }
            if (rest[0]) start = plain(rest[0]);
            const title = plain(cells[at]);
            if (title) out.push({ title, primary: heading === 'primary', tutorial, region, start });
        }
    }
    return out;
}

export async function loadQuestList() {
    try {
        const res = await fetch(PAGE, { headers: { 'User-Agent': 'RSDWServerAPI-bot (Discord bot for a Dragonwilds server)' }, signal: AbortSignal.timeout(10000) });
        const parsed = parseQuestTables((await res.json()).parse?.wikitext);
        // A page that parses to much less than before was probably reworked: keep what we had.
        if (parsed.length >= Math.min(20, quests.length * 0.7)) {
            if (parsed.length !== quests.length) log.info(`quest list from the wiki: ${parsed.length} quests`);
            quests = parsed;
        } else {
            log.warn(`the wiki's quest list parsed to ${parsed.length} quests - keeping the ${quests.length} known`);
        }
    } catch (err) {
        log.debug(`quest list unavailable: ${err.message}`);
    }
}
