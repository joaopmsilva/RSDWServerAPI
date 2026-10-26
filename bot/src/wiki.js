import { logger } from './log.js';

const log = logger('wiki');
const WIKI = 'https://dragonwilds.runescape.wiki';
const HEADERS = { 'User-Agent': 'RSDWServerAPI-bot (https://github.com/joaopmsilva/RSDWServerAPI)' };
const TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const SUMMARY_MAX = 350;

// Wiki answers by name, kept for a day (a miss for an hour) so repeated
// lookups don't ask the wiki again.
const cache = new Map();

export const wikiSearchUrl = name => `${WIKI}/w/Special:Search?search=${encodeURIComponent(name)}`;
const pageUrl = title => `${WIKI}/w/${encodeURIComponent(title.replace(/ /g, '_'))}`;

async function query(params) {
    const url = `${WIKI}/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;
    const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`wiki answered ${res.status}`);
    return res.json();
}

// Wiki markup to plain text: [[a|b]] -> b, [[a]] -> a, templates, refs and tags dropped.
function plain(text) {
    return text
        .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '')
        .replace(/\{\{[^{}]*\}\}/g, '')
        .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/'{2,}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// The "| key = value" lines of the page's {{Infobox Item}}.
function infobox(wikitext) {
    const box = /\{\{\s*Infobox Item([\s\S]*?)\n\}\}/i.exec(wikitext || '');
    const fields = {};
    for (const line of (box?.[1] || '').split('\n')) {
        const m = /^\s*\|\s*([\w ]+?)\s*=\s*(.*)$/.exec(line);
        if (m && m[2].trim()) fields[m[1].toLowerCase()] = plain(m[2]);
    }
    return fields;
}

// The first sentences of the intro, up to SUMMARY_MAX characters.
function shorten(text) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= SUMMARY_MAX) return clean;
    const cut = clean.slice(0, SUMMARY_MAX);
    const end = cut.lastIndexOf('. ');
    return end > 80 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}

async function page(title) {
    const data = await query({
        action: 'query',
        titles: title,
        redirects: '1',
        prop: 'extracts|pageimages|revisions',
        exintro: '1',
        explaintext: '1',
        piprop: 'thumbnail',
        pithumbsize: '256',
        rvprop: 'content',
        rvslots: 'main',
        rvsection: '0',
    });
    const p = data.query?.pages?.[0];
    if (!p || p.missing) return null;
    const box = infobox(p.revisions?.[0]?.slots?.main?.content);
    return {
        title: p.title,
        url: pageUrl(p.title),
        summary: shorten(p.extract),
        description: box.description || null,
        type: box.item_type || null,
        weight: box.weight || null,
        repair: box.repaircost || null,
        image: p.thumbnail?.source || null,
    };
}

// What the wiki says about an item, or null when it has no page or can't be reached.
export async function wikiInfo(name) {
    const key = name.toLowerCase();
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < (hit.info ? TTL_MS : MISS_TTL_MS)) return hit.info;

    let info = null;
    try {
        info = await page(name);
        if (!info) {
            // The game's name and the wiki's can differ ("Bronze Axe" / "Bronze Logging Axe").
            // Only a title with every word of the name counts - search alone finds loosely related pages.
            const found = await query({ action: 'query', list: 'search', srsearch: name, srlimit: '5', srnamespace: '0' });
            const words = key.split(/\s+/).filter(Boolean);
            const title = found.query?.search?.map(r => r.title).find(t => words.every(w => t.toLowerCase().includes(w)));
            if (title) info = await page(title);
        }
    } catch (err) {
        // Wiki unreachable: don't remember that, try again next time.
        log.debug(`wiki lookup for ${name} failed: ${err.message}`);
        return null;
    }
    cache.set(key, { info, at: Date.now() });
    return info;
}
