import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const botRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load bot/.env wherever we're started from, so scripts run from cron find it too.
dotenv.config({ path: path.join(botRoot, '.env') });

function required(name) {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing ${name} in .env`);
        process.exit(1);
    }
    return value;
}

function int(name, fallback) {
    const value = parseInt(process.env[name] ?? '', 10);
    return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback) {
    const value = (process.env[name] || '').trim().toLowerCase();
    if (!value) return fallback;
    return !['false', '0', 'no', 'off'].includes(value);
}

const id = name => (process.env[name] || '').trim();
const chatChannelId = id('CHAT_CHANNEL_ID');

export const config = {
    discordToken: required('DISCORD_TOKEN'),
    apiUrl: (process.env.API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    apiToken: process.env.API_TOKEN || '',
    serverName: process.env.SERVER_NAME || 'Dragonwilds Server',
    maxPlayers: int('MAX_PLAYERS', 0),
    pollSeconds: Math.max(10, int('POLL_SECONDS', 30)),
    allowedChannels: (process.env.ALLOWED_CHANNELS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    chatChannelId,
    deathChannelId: id('DEATH_CHANNEL_ID') || chatChannelId,
    statusChannelId: id('STATUS_CHANNEL_ID') || chatChannelId,
    relaySeconds: Math.max(1, int('RELAY_SECONDS', 3)),
    bridgeToGame: bool('BRIDGE_TO_GAME', true),
    bridgeRoleId: id('BRIDGE_ROLE_ID'),
    bridgePrefix: (process.env.BRIDGE_PREFIX ?? 'Discord').trim(),
    bridgeMaxLength: Math.max(20, int('BRIDGE_MAX_LENGTH', 200)),
    serverNotices: bool('SERVER_NOTICES', true),
    adminUserIds: (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    serverService: (process.env.SERVER_SERVICE || 'dragonwilds').trim(),
    dataDir: path.resolve(botRoot, process.env.DATA_DIR || 'data'),
};
