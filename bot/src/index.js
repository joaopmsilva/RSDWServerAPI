import { Client, Events, GatewayIntentBits } from 'discord.js';
import { commands } from './commands.js';
import { config } from './config.js';
import { errorEmbed } from './embeds.js';
import { initLogFile, logger } from './log.js';
import { attachMenu } from './menus.js';
import { Poller } from './poller.js';
import { Relay } from './relay.js';
import { PlayerStore } from './store.js';

initLogFile(config.dataDir);

const log = logger('bot');
const COOLDOWN_MS = 3000;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

log.info(`starting - API ${config.apiUrl}, prefix "${config.prefix}", data in ${config.dataDir}`);

const store = new PlayerStore(config.dataDir);
const poller = new Poller(client, store);
const relay = new Relay(client);
const ctx = { store, poller };
const lastUse = new Map();

client.once(Events.ClientReady, c => {
    log.info(`logged in as ${c.user.tag}, in ${c.guilds.cache.size} server(s), polling every ${config.pollSeconds}s`);
    poller.start();
    relay.start();
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild || !message.content.startsWith(config.prefix)) return;
    if (config.allowedChannels.length && !config.allowedChannels.includes(message.channelId)) return;

    const [name, ...args] = message.content.slice(config.prefix.length).trim().split(/\s+/);
    const run = commands.get((name || '').toLowerCase());
    if (!run) return;

    const who = `${message.author.tag} in #${message.channel.name}`;
    const now = Date.now();
    if (now - (lastUse.get(message.author.id) || 0) < COOLDOWN_MS) {
        log.debug(`cooldown: ${who} ${message.content}`);
        return;
    }
    lastUse.set(message.author.id, now);

    try {
        await message.channel.sendTyping().catch(() => {});
        const { reply, menu } = await run(args, ctx);
        const sent = await message.reply({ ...reply, allowedMentions: { repliedUser: false } });
        log.info(`${who}: ${message.content} (${Date.now() - now} ms)`);
        if (menu) attachMenu(sent, menu).catch(err => log.error(`menu failed: ${err.message}`));
    } catch (err) {
        log.error(`${who}: ${message.content} failed:`, err);
        await message.reply({ embeds: [errorEmbed('Something went wrong running that command.')] }).catch(() => {});
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
