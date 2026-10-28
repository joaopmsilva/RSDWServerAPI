// Creates the #link-account channel, next to the chat channel: everyone can
// read it and use slash commands there, but not post, so it stays a clean
// place for /link. Prints the id to put in .env as LINK_CHANNEL_ID.
//
//   node src/setup-link-channel.js [name]
//
// Needs the bot to have Manage Channels and Manage Roles in the server.

import { ChannelType, Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { config } from './config.js';

const name = process.argv[2] || 'link-account';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async c => {
    try {
        const chat = config.chatChannelId ? await c.channels.fetch(config.chatChannelId).catch(() => null) : null;
        const guild = chat?.guild || c.guilds.cache.first();
        const existing = guild.channels.cache.find(ch => ch.name === name && ch.type === ChannelType.GuildText);
        if (existing) {
            console.log(`#${name} already exists: LINK_CHANNEL_ID=${existing.id}`);
            return;
        }
        const channel = await guild.channels.create({
            name,
            type: ChannelType.GuildText,
            parent: chat?.parentId || null,
            topic: 'Link your Discord to your in-game character: type /link here, then /link CODE in game chat.',
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.UseApplicationCommands],
                    deny: [
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.AddReactions,
                        PermissionFlagsBits.CreatePublicThreads,
                        PermissionFlagsBits.CreatePrivateThreads,
                        PermissionFlagsBits.SendMessagesInThreads,
                    ],
                },
                {
                    id: c.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageMessages,
                    ],
                },
            ],
        });
        console.log(`created #${channel.name}: LINK_CHANNEL_ID=${channel.id}`);
    } catch (err) {
        console.error(`could not create the channel: ${err.message} - the bot needs Manage Channels and Manage Roles`);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

client.login(config.discordToken);
