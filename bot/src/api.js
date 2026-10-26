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

async function get(path) {
    let res;
    try {
        res = await fetch(config.apiUrl + path, {
            headers: config.apiToken ? { Authorization: `Bearer ${config.apiToken}` } : {},
            signal: AbortSignal.timeout(5000),
        });
    } catch (err) {
        throw new ApiError('offline', `API unreachable (${err.cause?.code || err.name})`);
    }

    if (res.status === 401) throw new ApiError('auth', 'API rejected the bearer token - check API_TOKEN', 401);
    if (res.status === 503) throw new ApiError('starting', 'Server is still loading', 503);
    if (!res.ok) throw new ApiError('http', `API returned HTTP ${res.status}`, res.status);
    return res.json();
}

export const api = {
    health: () => get('/api/health'),
    players: async () => (await get('/api/players')).players || [],
    events: since => get(`/api/events?since=${since}&limit=200`),
};
