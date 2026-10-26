import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const botRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

const chatChannelId = (process.env.CHAT_CHANNEL_ID || '').trim();

export const config = {
    discordToken: required('DISCORD_TOKEN'),
    apiUrl: (process.env.API_URL || 'http://127.0.0.1:8080').replace(/\/+$/, ''),
    apiToken: process.env.API_TOKEN || '',
    prefix: process.env.PREFIX || '!',
    serverName: process.env.SERVER_NAME || 'Dragonwilds Server',
    maxPlayers: int('MAX_PLAYERS', 0),
    pollSeconds: Math.max(10, int('POLL_SECONDS', 30)),
    allowedChannels: (process.env.ALLOWED_CHANNELS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    chatChannelId,
    deathChannelId: (process.env.DEATH_CHANNEL_ID || '').trim() || chatChannelId,
    relaySeconds: Math.max(1, int('RELAY_SECONDS', 3)),
    dataDir: process.env.DATA_DIR || path.join(botRoot, 'data'),
};
