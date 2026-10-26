import fs from 'node:fs';
import path from 'node:path';
import { api } from './api.js';
import { config } from './config.js';
import { logger } from './log.js';

const log = logger('items');
const REFRESH_MS = 10 * 60 * 1000;
const file = path.join(config.dataDir, 'items.json');

// The game's items, from the mod's /api/items. Kept in data/items.json too, so
// /item still answers while the server is down.
let cache = { items: [], at: 0 };
try {
    cache = { items: JSON.parse(fs.readFileSync(file, 'utf8')).items || [], at: 0 };
} catch (err) {
    if (err.code !== 'ENOENT') log.warn(`could not read ${file}: ${err.message}`);
}

async function refresh() {
    if (Date.now() - cache.at < REFRESH_MS) return;
    try {
        const items = await api.items();
        cache = { items, at: Date.now() };
        if (items.length) {
            fs.mkdirSync(config.dataDir, { recursive: true });
            fs.writeFileSync(file, JSON.stringify({ items }));
        }
    } catch (err) {
        // Server down: keep what we had, and don't ask again for a minute.
        cache.at = Date.now() - REFRESH_MS + 60 * 1000;
        log.debug(`item list unavailable: ${err.message}`);
    }
}

const words = s => s.replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2').trim();

// "ITEM_Resources_IronBar" -> { name: "Iron Bar", category: "Resources" }
export function describeItem(item) {
    const parts = item.name.replace(/^ITEM_/i, '').split('_').filter(Boolean);
    const name = words(parts.pop() || item.name);
    return { id: item.name, name, category: parts.map(words).join(' · '), maxStackSize: item.maxStackSize };
}

export async function itemChoices(query) {
    await refresh();
    const q = query.trim().toLowerCase();
    return cache.items
        .map(describeItem)
        .filter(i => !q || i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(i => ({ name: `${i.name}${i.category ? ` (${i.category})` : ''}`.slice(0, 100), value: i.id.slice(0, 100) }));
}

// By asset id, or the closest name match.
export async function findItem(query) {
    await refresh();
    const q = query.trim().toLowerCase();
    const all = cache.items.map(describeItem);
    return (
        all.find(i => i.id.toLowerCase() === q) ||
        all.find(i => i.name.toLowerCase() === q) ||
        all.find(i => i.name.toLowerCase().startsWith(q)) ||
        all.find(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) ||
        null
    );
}

export const itemsKnown = () => cache.items.length;
