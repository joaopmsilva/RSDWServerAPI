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
    events: since => request(`/api/events?since=${since}&limit=200`),
    // The mod shows it in game as "[sender] message". It waits up to 10s for
    // the game thread, so allow longer than a normal request.
    broadcast: (sender, message) =>
        request('/api/broadcast', { method: 'POST', body: { sender, message }, timeout: 15000 }),
};
