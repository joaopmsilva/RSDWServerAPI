import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { ADMIN_COMMANDS, adminCommands, isAdmin } from './admin.js';
import { Bridge } from './bridge.js';
import { commands } from './commands.js';
import { config } from './config.js';
import { errorEmbed } from './embeds.js';
import { initLogFile, logger } from './log.js';
import { attachMenu } from './menus.js';
import { Notices } from './notices.js';
import { Poller } from './poller.js';
import { Relay } from './relay.js';
import { ServerControl } from './server-control.js';
import { autocomplete, registerCommands } from './slash.js';
import { PlayerStore } from './store.js';

initLogFile(config.dataDir);

const log = logger('bot');
const COOLDOWN_MS = 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        // Needed to read what people type in the chat channel for the game.
        GatewayIntentBits.MessageContent,
    ],
});

log.info(`starting - API ${config.apiUrl}, data in ${config.dataDir}`);

const store = new PlayerStore(config.dataDir);
const poller = new Poller(client, store);
const bridge = new Bridge();
const relay = new Relay(client, bridge);
const notices = new Notices(client);
const control = new ServerControl(client);
const ctx = { store, poller, control };
const lastUse = new Map();

poller.onTick = state => notices.observe(state);

client.once(Events.ClientReady, async c => {
    log.info(`logged in as ${c.user.tag}, in ${c.guilds.cache.size} server(s), polling every ${config.pollSeconds}s`);
    for (const guild of c.guilds.cache.values()) await registerCommands(guild);
    notices.start();
    poller.start();
    relay.start();
    bridge.start();
});

client.on(Events.GuildCreate, guild => {
    log.info(`added to ${guild.name}`);
    registerCommands(guild);
});

// Everything typed in the chat channel goes to the game. A message starting
// with "/" is a slash command that wasn't picked from the list - leave it.
client.on(Events.MessageCreate, message => {
    if (message.author.bot || message.webhookId || message.system || !message.guild) return;
    if (message.content.startsWith('/')) return;
    if (bridge.handles(message)) bridge.send(message);
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isAutocomplete()) {
        await autocomplete(interaction, ctx).catch(err => log.debug(`autocomplete failed: ${err.message}`));
        return;
    }
    if (!interaction.isChatInputCommand()) return;

    const name = interaction.commandName;
    const admin = ADMIN_COMMANDS.has(name);
    const run = admin ? adminCommands[name] : commands[name];
    if (!run) return;

    // Subcommands (/admin kick ...) carry their own options one level down.
    const describe = list => list.map(o => (o.options ? [o.name, describe(o.options)].join(' ') : `${o.name}:${o.value}`)).join(' ');
    const options = describe(interaction.options.data);
    const what = `/${name}${options ? ' ' + options : ''}`;
    const who = `${interaction.user.tag} in #${interaction.channel?.name ?? interaction.channelId}`;
    const ephemeral = text => interaction.reply({ embeds: [errorEmbed(text)], flags: MessageFlags.Ephemeral }).catch(() => {});

    if (admin && !isAdmin(interaction.user)) {
        log.warn(`${who}: ${what} refused - not in ADMIN_USER_IDS`);
        return ephemeral(config.adminUserIds.length ? 'Only the server admins can use this.' : "No admins are set up - add your Discord user ID to ADMIN_USER_IDS in the bot's .env.");
    }

    if (!admin && config.allowedChannels.length && !config.allowedChannels.includes(interaction.channelId)) {
        const where = config.allowedChannels.map(id => `<#${id}>`).join(', ');
        return ephemeral(`Commands work in ${where}.`);
    }

    const now = Date.now();
    if (now - (lastUse.get(interaction.user.id) || 0) < COOLDOWN_MS) {
        log.debug(`cooldown: ${who} ${what}`);
        return ephemeral('Slow down a little - try again in a few seconds.');
    }
    lastUse.set(interaction.user.id, now);

    try {
        // Lookups can take a few seconds; Discord wants an answer within 3.
        // Admin replies are only shown to the admin.
        await interaction.deferReply(admin ? { flags: MessageFlags.Ephemeral } : {});
        const { reply, menu } = await run(interaction, ctx);
        const sent = await interaction.editReply(reply);
        log.info(`${who}: ${what} (${Date.now() - now} ms)`);
        if (menu) attachMenu(sent, menu).catch(err => log.error(`menu failed: ${err.message}`));
    } catch (err) {
        log.error(`${who}: ${what} failed:`, err);
        const failed = { embeds: [errorEmbed('Something went wrong running that command.')] };
        await (interaction.deferred ? interaction.editReply(failed) : interaction.reply(failed)).catch(() => {});
    }
});

// The bot runs independently of the game server: API failures are expected
// and handled, and nothing else should be able to take the process down.
client.on(Events.Error, err => log.error('discord client error:', err));
client.on(Events.Warn, msg => log.warn(`discord: ${msg}`));
client.on(Events.ShardDisconnect, () => log.warn('disconnected from Discord, reconnecting'));
client.on(Events.ShardResume, () => log.info('reconnected to Discord'));
process.on('unhandledRejection', err => log.error('unhandled rejection:', err));

function shutdown(signal) {
    log.info(`${signal} received, shutting down`);
    poller.stop();
    relay.stop();
    try {
        store.flush();
    } catch (err) {
        log.error('could not save player snapshots:', err);
    }
    client.destroy().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

client.login(config.discordToken).catch(err => {
    log.error(`Discord login failed: ${err.message} - check DISCORD_TOKEN and that Message Content Intent is on`);
    process.exit(1);
});
