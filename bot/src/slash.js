import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
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
    new SlashCommandBuilder().setName('status').setDescription('Is the server up, and who is on it'),
    new SlashCommandBuilder().setName('online').setDescription('Everyone connected right now, with ping'),
    new SlashCommandBuilder().setName('help').setDescription('What the bot can do'),
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
    const choices = focused.name === 'skill' ? skillChoices(focused.value) : playerChoices(ctx, focused.value);
    await interaction.respond(choices.slice(0, MAX_CHOICES));
}
