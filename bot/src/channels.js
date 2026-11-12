import fs from 'node:fs';
import { ChannelType, OAuth2Scopes, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { AUTO_CHANNELS, channelsFile, config, useChannels } from './config.js';
import { logger } from './log.js';

const log = logger('channels');

// What the bot needs in the server: its own channels (Manage Channels, Manage
// Roles for the read-only ones), posting cards and cleaning up (Manage
// Messages), and the usual reading and writing.
export const BOT_PERMISSIONS = new PermissionsBitField([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.SendMessagesInThreads,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
]);

export function inviteUrl(client) {
    return client.generateInvite({ scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: BOT_PERMISSIONS });
}

// In order, as they appear under the category. readOnly: only the bot posts
// there; slash commands still work in every channel.
const CHANNELS = [
    { key: 'info', name: 'server-info', readOnly: true, topic: 'How to join, who is online and how the server is doing - kept up to date by the bot.' },
    { key: 'status', name: 'server-status', readOnly: true, topic: 'Server up, down, restarting, updates and backups.' },
    { key: 'chat', name: 'game-chat', readOnly: false, topic: 'In-game chat. Anything you type here shows up in the game.' },
    { key: 'activity', name: 'activity', readOnly: true, topic: 'Level-ups, quests and the weekly summary.' },
    { key: 'deaths', name: 'deaths', readOnly: true, topic: 'Who died, and to what.' },
    { key: 'commands', name: 'bot-commands', readOnly: false, topic: 'Use the bot here: type / to see the commands. Cleared every few minutes.' },
    { key: 'link', name: 'link-your-character', readOnly: true, topic: 'Link your Discord to your in-game character: press the button or type /link here.' },
];

function readSaved() {
    try {
        return JSON.parse(fs.readFileSync(channelsFile, 'utf8'));
    } catch {
        return {};
    }
}

function overwrites(guild, me, readOnly) {
    if (!readOnly) return [];
    return [
        {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands],
            deny: [
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.CreatePublicThreads,
                PermissionFlagsBits.CreatePrivateThreads,
                PermissionFlagsBits.SendMessagesInThreads,
            ],
        },
        {
            id: me.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageMessages,
            ],
        },
    ];
}

// With no channels set in .env, the bot makes a category named after the
// server with a channel for each kind of post, remembers them in
// data/channels.json, and makes any that were deleted again on its next start.
// Returns false when it isn't in a Discord server yet.
export async function setupChannels(client) {
    if (!config.autoChannels) return true;
    const saved = readSaved();
    const guild =
        client.guilds.cache.get(config.guildId) ||
        (!config.guildId && (client.guilds.cache.get(saved.guildId) || (client.guilds.cache.size === 1 ? client.guilds.cache.first() : null)));
    if (!guild) {
        if (client.guilds.cache.size > 1 && !config.guildId) log.warn('the bot is in more than one Discord server: set GUILD_ID in .env to the one to use');
        else log.warn(`not in a Discord server yet - invite the bot with ${inviteUrl(client)}`);
        return false;
    }

    const same = saved.guildId === guild.id;
    const ids = same ? { ...saved.channels } : {};
    let categoryId = same ? saved.category : undefined;
    // Saved after every channel made, so a failure halfway never leads to
    // duplicates on the next start.
    const remember = () => {
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.writeFileSync(channelsFile, JSON.stringify({ guildId: guild.id, category: categoryId, channels: ids }, null, 2));
    };
    try {
        const channels = await guild.channels.fetch();
        const me = guild.members.me;
        let category = channels.get(categoryId);
        const missing = CHANNELS.filter(c => !channels.get(ids[c.key]));
        if (missing.length && !category) {
            category = await guild.channels.create({ name: config.serverName.slice(0, 100), type: ChannelType.GuildCategory });
            categoryId = category.id;
            remember();
            log.info(`made the category "${category.name}"`);
        }
        for (const c of missing) {
            const channel = await guild.channels.create({
                name: c.name,
                type: ChannelType.GuildText,
                parent: category,
                topic: c.topic,
                permissionOverwrites: overwrites(guild, me, c.readOnly),
            });
            ids[c.key] = channel.id;
            remember();
            log.info(`made #${channel.name}`);
        }
        if (!same) remember();
    } catch (err) {
        log.error(`could not make the bot's channels in ${guild.name}: ${err.message} - it needs Manage Channels and Manage Roles. Invite it again with ${inviteUrl(client)}, or set CHAT_CHANNEL_ID and the other channels in .env`);
    }
    useChannels(ids);
    const made = Object.keys(AUTO_CHANNELS).filter(k => ids[k]);
    if (made.length) log.info(`using the bot's own channels in ${guild.name}: ${made.map(k => `${k} <#${ids[k]}>`).join(', ')}`);
    return true;
}
