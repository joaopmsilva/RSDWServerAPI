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
    backupNotices: bool('BACKUP_NOTICES', true),
    levelUpNotices: bool('LEVELUP_NOTICES', true),
    levelUpMinLevel: Math.max(2, int('LEVELUP_MIN_LEVEL', 10)),
    levelUpChannelId: id('LEVELUP_CHANNEL_ID') || chatChannelId,
    joinLeaveNotices: bool('JOIN_LEAVE_NOTICES', true),
    weeklySummary: bool('WEEKLY_SUMMARY', true),
    summaryChannelId: id('SUMMARY_CHANNEL_ID') || chatChannelId,
    adminAlerts: bool('ADMIN_ALERTS', true),
    alertCpu: int('ALERT_CPU', 90),
    alertRam: int('ALERT_RAM', 90),
    alertDisk: int('ALERT_DISK', 90),
    backupScript: (process.env.BACKUP_SCRIPT || '/home/dragonwilds/scripts/backup.sh').trim(),
    backupDir: (process.env.BACKUP_DIR || '/home/dragonwilds/backups').trim(),
    saveDir: (process.env.SAVE_DIR || '/home/dragonwilds/rs_server/RSDragonwilds/Saved/SaveGames').trim(),
    saveFunction: (process.env.SAVE_FUNCTION || '').trim(),
    statusBoardChannelId: id('STATUS_BOARD_CHANNEL_ID'),
    connectAddress: (process.env.CONNECT_ADDRESS || '').trim(),
    worldName: (process.env.WORLD_NAME || '').trim(),
    worldCreator: (process.env.WORLD_CREATOR || '').trim(),
    serverPassword: (process.env.SERVER_PASSWORD || '').trim(),
    dailyRestart: (process.env.DAILY_RESTART || '').trim(),
    boardShowVps: bool('BOARD_SHOW_VPS', true),
    commandsPost: bool('COMMANDS_POST', true),
    commandsChannelId: id('COMMANDS_CHANNEL_ID') || chatChannelId,
    adminUserIds: (process.env.ADMIN_USER_IDS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean),
    serverService: (process.env.SERVER_SERVICE || 'dragonwilds').trim(),
    updateWatch: bool('UPDATE_WATCH', true),
    updateCheckMinutes: Math.max(5, int('UPDATE_CHECK_MINUTES', 15)),
    autoUpdate: bool('AUTO_UPDATE', true),
    autoUpdateMinutes: Math.max(1, int('AUTO_UPDATE_MINUTES', 20)),
    steamAppId: (process.env.STEAM_APP_ID || '4019830').trim(),
    serverDir: (process.env.SERVER_DIR || '/home/dragonwilds/rs_server').trim(),
    steamcmd: (process.env.STEAMCMD || '/home/dragonwilds/steamcmd/steamcmd.sh').trim(),
    dataDir: path.resolve(botRoot, process.env.DATA_DIR || 'data'),
};
