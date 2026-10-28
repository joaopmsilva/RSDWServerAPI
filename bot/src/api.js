import { config } from './config.js';

// kind is one of: offline (no answer), starting (503 - loading, or offsets
// failed validation), auth (bad bearer token), http (anything else)
export class ApiError extends Error {
    constructor(kind, message, status = 0) {
        super(message);
        this.kind = kind;
        this.status = status;
    }
}

async function request(path, { method = 'GET', body, timeout = 5000 } = {}) {
    const headers = config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {};
    if (body) headers['Content-Type'] = 'application/json';

    let res;
    try {
        res = await fetch(config.apiUrl + path, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeout),
        });
    } catch (err) {
        throw new ApiError('offline', `API unreachable (${err.cause?.code || err.name})`);
    }

    if (res.status === 401) throw new ApiError('auth', 'API rejected the bearer token - check API_TOKEN', 401);
    if (res.status === 503) throw new ApiError('starting', 'Server is still loading', 503);
    if (!res.ok) {
        // The mod answers errors as {"error": "..."}.
        const detail = await res.json().then(j => j.error).catch(() => '');
        throw new ApiError('http', `API returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
    return res.json();
}

export const api = {
    health: () => request('/api/health'),
    players: async () => (await request('/api/players')).players || [],
    // With wait, mod 0.4.0+ holds the request until something happens (up to wait seconds).
    events: (since, wait = 0) =>
        request(`/api/events?since=${since}&limit=200${wait ? `&wait=${wait}` : ''}`, { timeout: (wait + 10) * 1000 }),
    save: fn => request('/api/save', { method: 'POST', body: { function: fn }, timeout: 20000 }),
    saveCandidates: async () => (await request('/api/save/candidates', { timeout: 15000 })).candidates || [],
    // The mod shows it in game as "[sender] message". It waits up to 10s for
    // the game thread, so allow longer than a normal request.
    broadcast: (sender, message) =>
        request('/api/broadcast', { method: 'POST', body: { sender, message }, timeout: 15000 }),
    // A private line to one player (net id, character GUID or name). Mod 0.6.0+.
    whisper: (to, message, sender = 'Server') =>
        request('/api/broadcast', { method: 'POST', body: { sender, message, to }, timeout: 15000 }),
    // World name and settings, the in-game clock, running raids. Mod 0.6.0+; older mods answer 404.
    world: () => request('/api/world'),
    // player: name, character name or net id (SteamID64 for unban / offline bans)
    kick: (player, reason) => request('/api/kick', { method: 'POST', body: reason ? { player, reason } : { player }, timeout: 15000 }),
    ban: (player, reason) => request('/api/ban', { method: 'POST', body: reason ? { player, reason } : { player }, timeout: 15000 }),
    unban: player => request('/api/unban', { method: 'POST', body: { player } }),
    give: (player, item, count) => request('/api/give', { method: 'POST', body: { player, item, count }, timeout: 15000 }),
    items: async () => (await request('/api/items')).items || [],
    bans: async () => (await request('/api/bans')).bans || [],
    // Mod 0.3.0+; older mods answer 404.
    diagnostics: () => request('/api/diagnostics'),
};
