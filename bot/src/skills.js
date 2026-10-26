import { levelInfo } from './levels.js';

// Skill list from https://dragonwilds.runescape.wiki/w/Skills. Ids from the game
// look like "SKILL_Woodcutting"; anything not listed here still shows, under Other.

export const CATEGORIES = [
    { id: 'combat', name: 'Combat', emoji: '⚔️', color: 0xc0392b },
    { id: 'gathering', name: 'Gathering', emoji: '⛏️', color: 0x27ae60 },
    { id: 'artisan', name: 'Artisan', emoji: '🔨', color: 0xd68910 },
    { id: 'support', name: 'Support', emoji: '🏃', color: 0x2e86c1 },
    { id: 'other', name: 'Other', emoji: '📘', color: 0x7f8c8d },
];

// unreleased skills are hidden until someone actually has XP in them
const CATALOG = [
    { key: 'attack', name: 'Attack', category: 'combat', emoji: '🗡️', icon: true, aliases: ['att', 'atk', 'melee'] },
    { key: 'magic', name: 'Magic', category: 'combat', emoji: '🔮', icon: true, aliases: ['mage'] },
    { key: 'ranged', name: 'Ranged', category: 'combat', emoji: '🏹', icon: true, aliases: ['range', 'ranging', 'archery'] },
    { key: 'prayer', name: 'Prayer', category: 'combat', emoji: '🙏', icon: true, aliases: ['pray'], unreleased: true },
    { key: 'mining', name: 'Mining', category: 'gathering', emoji: '⛏️', icon: true, aliases: ['mine'] },
    { key: 'woodcutting', name: 'Woodcutting', category: 'gathering', emoji: '🪓', icon: true, aliases: ['wc', 'woodcut', 'wood'] },
    { key: 'farming', name: 'Farming', category: 'gathering', emoji: '🌱', icon: true, aliases: ['farm'] },
    { key: 'fishing', name: 'Fishing', category: 'gathering', emoji: '🎣', icon: true, aliases: ['fish'] },
    { key: 'hunter', name: 'Hunter', category: 'gathering', emoji: '🦊', icon: false, aliases: ['hunt'], unreleased: true },
    { key: 'runecrafting', name: 'Runecrafting', category: 'artisan', emoji: '🌀', icon: true, aliases: ['rc', 'rune', 'runecraft'] },
    { key: 'construction', name: 'Construction', category: 'artisan', emoji: '🏠', icon: true, aliases: ['con', 'cons', 'build'] },
    { key: 'artisan', name: 'Artisan', category: 'artisan', emoji: '🧵', icon: true, aliases: ['art', 'craft', 'crafting', 'smithing'] },
    { key: 'cooking', name: 'Cooking', category: 'artisan', emoji: '🍳', icon: true, aliases: ['cook'] },
    { key: 'agility', name: 'Agility', category: 'support', emoji: '🤸', icon: true, aliases: ['agi', 'agil'] },
    { key: 'slayer', name: 'Slayer', category: 'support', emoji: '💀', icon: false, aliases: ['slay'], unreleased: true },
];

const normalize = s => s.replace(/^SKILL_/i, '').replace(/[^a-z0-9]/gi, '').toLowerCase();

function lookup(id) {
    const key = normalize(id);
    return CATALOG.find(d => d.key === key) || CATALOG.find(d => key.includes(d.key)) || null;
}

function prettify(id) {
    return id.replace(/^SKILL_/i, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// Turns the API's [{skill, currentXP}] into display entries, in wiki order.
export function describeSkills(raw = []) {
    const entries = [];
    for (const s of raw) {
        const def = lookup(s.skill);
        const xp = Math.max(0, s.currentXP | 0);
        if (def?.unreleased && xp <= 0) continue;

        entries.push({
            key: def?.key || normalize(s.skill),
            name: def?.name || prettify(s.skill),
            emoji: def?.emoji || '📘',
            icon: def?.icon ? `https://dragonwilds.runescape.wiki/images/${def.name}.png` : null,
            category: CATEGORIES.find(c => c.id === (def?.category || 'other')),
            aliases: def?.aliases || [],
            order: def ? CATALOG.indexOf(def) : CATALOG.length,
            xp,
            info: levelInfo(xp),
        });
    }
    return entries.sort((a, b) => a.order - b.order);
}

// Autocomplete for /level: released skills matching what's typed, aliases included.
export function skillChoices(query) {
    const q = query.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return CATALOG.filter(d => !d.unreleased)
        .filter(d => !q || d.key.startsWith(q) || d.aliases.some(a => a.startsWith(q)) || d.key.includes(q))
        .map(d => ({ name: `${d.emoji} ${d.name}`, value: d.key }));
}

// A skill by name or alias, whether or not anyone has XP in it (for /leaderboard).
export function catalogSkill(query) {
    const def = findSkill(CATALOG, query);
    if (!def) return null;
    return {
        key: def.key,
        name: def.name,
        emoji: def.emoji,
        icon: def.icon ? `https://dragonwilds.runescape.wiki/images/${def.name}.png` : null,
        category: CATEGORIES.find(c => c.id === def.category),
    };
}

export function findSkill(entries, query) {
    const q = query.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!q) return null;
    return (
        entries.find(e => e.key === q || e.aliases.includes(q)) ||
        entries.find(e => e.key.startsWith(q) || e.name.toLowerCase().startsWith(q)) ||
        null
    );
}
