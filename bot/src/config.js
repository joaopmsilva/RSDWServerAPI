import fs from 'node:fs';
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
const CHANNEL_SETTINGS = ['CHAT_CHANNEL_ID', 'DEATH_CHANNEL_ID', 'STATUS_CHANNEL_ID', 'LEVELUP_CHANNEL_ID', 'SUMMARY_CHANNEL_ID', 'STATUS_BOARD_CHANNEL_ID', 'COMMANDS_CHANNEL_ID', 'LINK_CHANNEL_ID'];

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
    // Main and side quests finished, posted with the level-ups (mod 0.6.0+).
    questNotices: bool('QUEST_NOTICES', true),
    // Admin DMs when a character comes back with items, XP or quests it didn't
    // get here (mod 0.9.0+), past these thresholds - a new item always counts.
    carryoverAlerts: bool('CARRYOVER_ALERTS', true),
    carryoverMinXp: Math.max(1, int('CARRYOVER_MIN_XP', 2000)),
    carryoverMinItems: Math.max(1, int('CARRYOVER_MIN_ITEMS', 5)),
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
    // Clear COMMANDS_CHANNEL_ID (all but the pinned list) this often; 0 = never.
    commandsCleanupMinutes: Math.max(0, int('COMMANDS_CLEANUP_MINUTES', 5)),
    raidAlerts: bool('RAID_ALERTS', true),
    linkChannelId: id('LINK_CHANNEL_ID'),
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
    // New releases of this bot and mod: checked on GitHub, admins told by DM with
    // an "Update now" button, or installed by themselves with BOT_UPDATE_AUTO.
    selfUpdateCheck: bool('BOT_UPDATE_CHECK', true),
    selfUpdateRepo: (process.env.BOT_UPDATE_REPO || 'joaopmsilva/RSDWServerAPI').trim(),
    selfUpdateHours: Math.max(1, int('BOT_UPDATE_HOURS', 6)),
    selfUpdateAuto: bool('BOT_UPDATE_AUTO', false),
    // A daily anonymous "still running" ping so the project knows how many
    // servers use it (telemetry.js says exactly what's sent).
    telemetry: bool('BOT_TELEMETRY', true),
    telemetryUrl: (process.env.BOT_TELEMETRY_URL || 'https://rsdw.duckdns.org/v1/ping').trim(),
    steamcmd: (process.env.STEAMCMD || '/home/dragonwilds/steamcmd/steamcmd.sh').trim(),
    dataDir: path.resolve(botRoot, process.env.DATA_DIR || 'data'),
    // With no channel set in .env at all, the bot makes its own (channels.js)
    // in GUILD_ID, or the only server it's in. Setting any channel yourself
    // means you're choosing them, and none are made.
    autoChannels: bool('AUTO_CHANNELS', true) && !CHANNEL_SETTINGS.some(id),
    guildId: id('GUILD_ID'),
};

// The channels the bot makes, and the settings each one stands in for.
export const AUTO_CHANNELS = {
    info: [['STATUS_BOARD_CHANNEL_ID', 'statusBoardChannelId']],
    status: [['STATUS_CHANNEL_ID', 'statusChannelId']],
    chat: [['CHAT_CHANNEL_ID', 'chatChannelId']],
    activity: [['LEVELUP_CHANNEL_ID', 'levelUpChannelId'], ['SUMMARY_CHANNEL_ID', 'summaryChannelId']],
    deaths: [['DEATH_CHANNEL_ID', 'deathChannelId']],
    commands: [['COMMANDS_CHANNEL_ID', 'commandsChannelId']],
    link: [['LINK_CHANNEL_ID', 'linkChannelId']],
};
export const channelsFile = path.join(config.dataDir, 'channels.json');

// Point the settings at the bot's own channels (ids: { info: '123', ... }).
export function useChannels(ids) {
    for (const [key, settings] of Object.entries(AUTO_CHANNELS)) {
        if (!ids?.[key]) continue;
        for (const [, setting] of settings) config[setting] = ids[key];
    }
}

// Read here as well as by the bot, so the scripts (announce.js) find them too.
if (config.autoChannels) {
    try {
        useChannels(JSON.parse(fs.readFileSync(channelsFile, 'utf8')).channels);
    } catch {
        // Not made yet: the bot makes them when it connects.
    }
}

// The players' installer for the longer chest range (UE4SS + ChestLink), pinned
// in the commands channel when the file is there. Not in git: put it in data/.
config.clientModZip = path.resolve(config.dataDir, (process.env.CLIENT_MOD_ZIP || 'RSDW-ChestLink-3x-Installer.zip').trim());
config.hasClientMod = fs.existsSync(config.clientModZip);
// The mod the server preloads, which an update replaces.
config.modFile = path.resolve(config.serverDir, (process.env.MOD_FILE || 'librsdwapi.so').trim());
