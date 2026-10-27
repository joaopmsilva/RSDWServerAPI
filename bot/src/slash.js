import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { backupChoices, removedChoices, saveChoices } from './admin.js';
import { itemChoices } from './items.js';
import { logger } from './log.js';
import { skillChoices } from './skills.js';

const log = logger('slash');
const MAX_CHOICES = 25;

const playerOption = o =>
    o.setName('player').setDescription('Character or account name').setRequired(true).setAutocomplete(true);

export const definitions = [
    new SlashCommandBuilder()
        .setName('levels')
        .setDescription('Skill overview for a player')
        .addStringOption(playerOption),
    new SlashCommandBuilder()
        .setName('level')
        .setDescription('One skill in detail for a player')
        .addStringOption(o =>
            o.setName('skill').setDescription('Skill, e.g. woodcutting or wc').setRequired(true).setAutocomplete(true),
        )
        .addStringOption(playerOption),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Top players by total level, or by one skill')
        .addStringOption(o =>
            o.setName('skill').setDescription('Leave empty for total level').setRequired(false).setAutocomplete(true),
        ),
    new SlashCommandBuilder().setName('status').setDescription('Is the server up, and who is on it'),
    new SlashCommandBuilder().setName('online').setDescription('Everyone connected right now, with ping'),
    new SlashCommandBuilder()
        .setName('gains')
        .setDescription('XP gained - top gainers, or one player skill by skill')
        .addStringOption(o => o.setName('player').setDescription('Leave empty for the top gainers').setAutocomplete(true))
        .addStringOption(o =>
            o
                .setName('period')
                .setDescription('Default: this week')
                .addChoices(
                    { name: 'today', value: 'today' },
                    { name: 'this week', value: 'week' },
                    { name: 'this month', value: 'month' },
                ),
        ),
    new SlashCommandBuilder()
        .setName('playtime')
        .setDescription('Time played - most played this week, or one player')
        .addStringOption(o => o.setName('player').setDescription('Leave empty for the most played').setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('deaths')
        .setDescription('Deaths - who died most, or one player')
        .addStringOption(o => o.setName('player').setDescription('Leave empty for everyone').setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('item')
        .setDescription('Look up an item')
        .addStringOption(o => o.setName('item').setDescription('Start typing to search').setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName('system').setDescription("The VPS's CPU, RAM, disk and network use"),
    new SlashCommandBuilder().setName('help').setDescription('What the bot can do'),

    // Admin only. Hidden from members without Administrator; the bot also checks
    // ADMIN_USER_IDS, so a Discord admin who isn't listed still can't use them.
    new SlashCommandBuilder()
        .setName('server')
        .setDescription('Start, stop, restart or back up the game server (admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(o =>
            o
                .setName('action')
                .setDescription('What to do')
                .setRequired(true)
                .addChoices(
                    { name: 'restart', value: 'restart' },
                    { name: 'stop', value: 'stop' },
                    { name: 'start', value: 'start' },
                    { name: 'cancel a planned restart or stop', value: 'cancel' },
                    { name: 'backup now', value: 'backup' },
                    { name: 'list backups', value: 'backups' },
                    { name: 'restore a backup', value: 'restore' },
                    { name: 'update the game server', value: 'update' },
                ),
        )
        .addIntegerOption(o =>
            o
                .setName('minutes')
                .setDescription('Warn players this long before (default: 2 if anyone is online, else now)')
                .setMinValue(0)
                .setMaxValue(10),
        )
        .addStringOption(o => o.setName('backup').setDescription('For restore: which backup').setAutocomplete(true)),
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Moderation (admins)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(s =>
            s
                .setName('kick')
                .setDescription('Disconnect a player')
                .addStringOption(playerOption)
                .addStringOption(o => o.setName('reason').setDescription('Shown to the player')),
        )
        .addSubcommand(s =>
            s
                .setName('ban')
                .setDescription('Ban a player (name, or SteamID64 if offline)')
                .addStringOption(playerOption)
                .addStringOption(o => o.setName('reason').setDescription('Shown to the player')),
        )
        .addSubcommand(s =>
            s
                .setName('unban')
                .setDescription('Remove a ban')
                .addStringOption(o => o.setName('player').setDescription('Name or SteamID64').setRequired(true)),
        )
        .addSubcommand(s =>
            s
                .setName('say')
                .setDescription('Announce to players in game and in the status channel')
                .addStringOption(o => o.setName('message').setDescription('What to say').setRequired(true).setMaxLength(200)),
        )
        .addSubcommand(s =>
            s
                .setName('give')
                .setDescription('Give an item to an online player')
                .addStringOption(playerOption)
                .addStringOption(o => o.setName('item').setDescription('Start typing to search').setRequired(true).setAutocomplete(true))
                .addIntegerOption(o => o.setName('count').setDescription('Default 1').setMinValue(1).setMaxValue(9999)),
        )
        .addSubcommand(s =>
            s
                .setName('remove')
                .setDescription('Take a player off the leaderboards and delete their saved stats')
                .addStringOption(playerOption),
        )
        .addSubcommand(s =>
            s
                .setName('restore')
                .setDescription('Let a removed player back on the leaderboards')
                .addStringOption(o => o.setName('player').setDescription('A removed player').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand(s =>
            s
                .setName('save')
                .setDescription('Save the world now - or, the first time, find which game function does it')
                .addStringOption(o => o.setName('function').setDescription('Default: SAVE_FUNCTION from .env').setAutocomplete(true)),
        )
        .addSubcommand(s => s.setName('bans').setDescription('Everyone who is banned'))
        .addSubcommand(s => s.setName('diagnostics').setDescription("The mod's self-check of what it reads from the game"))
        .addSubcommand(s => s.setName('crashes').setDescription('Why the server went down or restarted by itself, with the full report')),
].map(c => c.setContexts(InteractionContextType.Guild).toJSON());

// Registered per server rather than globally: guild commands show up at once,
// global ones can take an hour to appear.
export async function registerCommands(guild) {
    try {
        await guild.commands.set(definitions);
        log.info(`slash commands registered in ${guild.name}`);
    } catch (err) {
        const hint = err.code === 50001 ? ' - re-invite the bot with the applications.commands scope' : '';
        log.error(`could not register slash commands in ${guild.name}: ${err.message}${hint}`);
    }
}

// Online players first, then everyone with saved stats. Autocomplete must
// answer within 3 seconds, so this only reads what the bot already has.
function playerChoices(ctx, query) {
    const q = query.trim().toLowerCase();
    const seen = new Set();
    const choices = [];

    const add = (player, online) => {
        const name = player.characterName || player.name;
        if (!name || seen.has(name.toLowerCase())) return;
        const haystack = `${player.characterName || ''} ${player.name || ''}`.toLowerCase();
        if (q && !haystack.includes(q)) return;
        seen.add(name.toLowerCase());
        choices.push({ name: `${online ? '🟢' : '⚫'} ${name}`.slice(0, 100), value: name.slice(0, 100) });
    };

    for (const p of ctx.poller.state.players) add(p, true);
    const offline = ctx.store.all().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    for (const p of offline) add(p, false);
    return choices;
}


export async function autocomplete(interaction, ctx) {
    const focused = interaction.options.getFocused(true);
    let choices;
    if (focused.name === 'skill') choices = skillChoices(focused.value);
    else if (focused.name === 'item') choices = await itemChoices(focused.value);
    else if (focused.name === 'backup') choices = backupChoices(focused.value);
    else if (focused.name === 'function') choices = await saveChoices(focused.value);
    else if (interaction.commandName === 'admin' && interaction.options.getSubcommand(false) === 'restore') choices = removedChoices(ctx, focused.value);
    else choices = playerChoices(ctx, focused.value);
    await interaction.respond(choices.slice(0, MAX_CHOICES));
}
