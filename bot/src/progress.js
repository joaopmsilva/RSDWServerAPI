// Quests, journal, skill perks and the in-game clock, as reported by mod 0.6.0+.

// "Quest_CooksAssistant" -> "Cooks Assistant", for when the game's own name
// couldn't be read.
function prettify(id) {
    return String(id || '')
        .replace(/^(Quest|DA_Perk|DA_SkillPerk|Perk|BP)_/i, '')
        .replace(/_C$/, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

export const questName = q => q.name || prettify(q.id);
// "PerkV2_Attack_Parry" -> "Parry"
export const perkName = p => p.name || prettify(String(p.id || '').replace(/^PerkV2_[A-Za-z]+_/, ''));
// "Obj_TalkToTheWiseOldMan" -> "Talk To The Wise Old Man"
export const objectiveName = o => prettify(String(o || '').replace(/^(Obj|Objective)_?/i, ''));

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
