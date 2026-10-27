import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { announce } from './announcer.js';
import { api } from './api.js';
import { findBackup, listBackups } from './backups.js';
import { resolvePlayer } from './commands.js';
import { config } from './config.js';
import {
    backupChoice,
    backupsEmbed,
    bansEmbed,
    diagnosticsEmbed,
    errorEmbed,
    okEmbed,
    restoreConfirmEmbed,
    saveCandidatesEmbed,
} from './embeds.js';
import { logger } from './log.js';
import { runBackupScript } from './server-control.js';
import { saveWorld } from './world-save.js';

const log = logger('admin');

// /server and /admin: only for the Discord users in ADMIN_USER_IDS. Replies are
// only visible to the admin who ran them.

export const ADMIN_COMMANDS = new Set(['server', 'admin']);

export const isAdmin = user => config.adminUserIds.includes(user.id);

const ok = text => ({ reply: { embeds: [okEmbed(text)] } });
const fail = text => ({ reply: { embeds: [errorEmbed(text)] } });
const tail = output => (output ? '\n```\n' + output.slice(-1500) + '\n```' : '');

async function backup(by) {
    log.info(`backup requested by ${by}`);
    try {
        const output = await runBackupScript();
        log.info('backup done');
        return ok(`Backup done.${tail(output)}`);
    } catch (err) {
        log.error(`backup failed: ${err.message}`);
        return fail(`The backup failed: ${err.message.split('\n')[0]}${tail(err.output)}`);
    }
}

async function server(i, ctx) {
    const action = i.options.getString('action', true);
    const by = i.user.tag;
    const { control, poller } = ctx;

    if (action === 'cancel') {
        try {
            const cancelled = await control.cancel(by);
            return cancelled ? ok(`The planned ${cancelled} is cancelled. Players have been told.`) : fail('Nothing is planned.');
        } catch (err) {
            return fail(err.message);
        }
    }

    if (action === 'backup') return backup(by);
    if (action === 'backups') return { reply: { embeds: [backupsEmbed(listBackups())] } };
    if (action === 'restore') return restore(i, ctx, by);
    if (action === 'update') return update(i, ctx, by);

    if (action === 'start') {
        const { status } = poller.state;
        if (status === 'online' || status === 'starting') return fail(`The server is already ${status}.`);
        await control.start(by);
        return ok('Start sent. It takes a minute or two to load - the status channel says when it is up.');
    }

    // Warn people who are online; an empty server can go straight away.
    const given = i.options.getInteger('minutes');
    const minutes = given ?? (poller.state.players.length ? 2 : 0);
    const notify = (text, success) =>
        i.followUp({ embeds: [success ? okEmbed(text) : errorEmbed(text)], flags: MessageFlags.Ephemeral }).catch(() => {});

    try {
        await control.schedule(action, minutes, by, notify);
    } catch (err) {
        return fail(`The ${action} failed: ${err.message}`);
    }
    if (!minutes) return ok(action === 'stop' ? 'Server stopped.' : 'Server restarting - the status channel says when it is back.');
    const what = action === 'stop' ? 'Shutdown' : 'Restart';
    return ok(`${what} in ${minutes} minute${minutes === 1 ? '' : 's'}. Players have been warned. \`/server cancel\` stops it.`);
}

// Back up, update with steamcmd and restart - the update watcher does the same
// by itself when Steam has a new build. Warns online players first.
function update(i, ctx, by) {
    const { control, poller, updates } = ctx;
    const given = i.options.getInteger('minutes');
    const minutes = given ?? (poller.state.players.length ? 5 : 0);
    try {
        control.update(minutes, by, { done: (result, err) => updates?.finished(result, err) });
    } catch (err) {
        return fail(`The update failed: ${err.message}`);
    }
    const when = minutes ? `in ${minutes} minute${minutes === 1 ? '' : 's'}` : 'now';
    return ok(`Backing up, updating and restarting ${when}. The status channel says when it's back.${minutes ? ' `/server cancel` stops it.' : ''}`);
}

// Asks first with buttons; index.js runs confirm() when the admin presses Restore.
function restore(i, ctx, by) {
    const id = i.options.getString('backup');
    if (!id) return fail('Pick a backup in the `backup` option - start typing and they show up.');
    const backup = findBackup(id);
    if (!backup) return fail(`No backup **${id}** in \`${config.backupDir}\`.`);

    const online = ctx.poller.state.players.length;
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm').setLabel('Restore').setEmoji('💾').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    );
    return {
        reply: { embeds: [restoreConfirmEmbed(backup, online)], components: [buttons] },
        working: online ? 'Warning players - the restore starts in a minute…' : 'Restoring…',
        confirm: async () => {
            try {
                const kept = await ctx.control.restore(backup, by, online);
                return ok(`Backup restored and the server is starting. The saves it replaced are kept as a backup (\`${kept[0] || 'none'}\`…).`);
            } catch (err) {
                log.error(`restore failed: ${err.message}`);
                return fail(`The restore failed: ${err.message}`);
            }
        },
    };
}

// No function given and none set: list what the mod found. Otherwise call it
// and say whether the save files really changed.
async function save(i) {
    const fn = i.options.getString('function') || config.saveFunction;
    if (!fn) {
        try {
            return { reply: { embeds: [saveCandidatesEmbed(await api.saveCandidates())] } };
        } catch (err) {
            if (err.status === 404) return fail('The running mod is older than 0.4.0, which added saving.');
            return fail(err.message);
        }
    }
    const result = await saveWorld(fn);
    if (result.changed) {
        const hint = fn === config.saveFunction ? '' : `\n\nTo save before every backup, put this in the bot's \`.env\`:\n\`SAVE_FUNCTION=${fn}\``;
        return ok(`**${fn}** saved the world - the save files were updated.${hint}`);
    }
    return fail(`${result.message}.${result.ok ? ' Try another one from `/admin save` with no function.' : ''}`);
}

async function admin(i, ctx) {
    const sub = i.options.getSubcommand();
    if (sub === 'save') return save(i);
    const player = i.options.getString('player');
    const reason = i.options.getString('reason') || '';

    try {
        if (sub === 'kick') return ok((await api.kick(player, reason)).message || `Kicked ${player}.`);
        if (sub === 'ban') return ok((await api.ban(player, reason)).message || `Banned ${player}.`);
        if (sub === 'unban') return ok((await api.unban(player)).message || `Unbanned ${player}.`);
        if (sub === 'give') {
            const item = i.options.getString('item', true);
            const count = i.options.getInteger('count') ?? 1;
            return ok((await api.give(player, item, count)).message || `Gave ${count} × ${item} to ${player}.`);
        }
        if (sub === 'remove') return removePlayer(ctx, player, i.user.tag);
        if (sub === 'restore') return restorePlayer(ctx, player, i.user.tag);
        if (sub === 'bans') return { reply: { embeds: [bansEmbed(await api.bans())] } };
        if (sub === 'diagnostics') {
            try {
                return { reply: { embeds: [diagnosticsEmbed(await api.diagnostics())] } };
            } catch (err) {
                if (err.status === 404) return fail('The running mod is older than 0.3.0, which added diagnostics.');
                throw err;
            }
        }
        if (sub === 'say') {
            const message = i.options.getString('message', true);
            await announce('say', { message, post: embed => ctx.control.post(embed) });
            return ok('Sent to players in game and posted in the status channel.');
        }
    } catch (err) {
        return fail(err.message);
    }
    return fail('Unknown admin command.');
}

// Off every leaderboard, gains / playtime / deaths board and the weekly recap,
// with their saved stats deleted. If they keep playing, /levels still works
// for them, but they stay off the boards until /admin restore.
async function removePlayer(ctx, query, by) {
    const result = await resolvePlayer(ctx, query);
    if (result.ambiguous) return fail(`Several players match **${query}**: ${result.ambiguous.map(p => p.characterName || p.name).join(', ')}. Use the full name.`);
    if (result.notFound) return fail(`No player found matching **${query}**.`);

    const { key, player } = result.profile;
    const name = player.characterName || player.name;
    ctx.history.name(key, name);
    ctx.history.forget(key);
    ctx.store.remove(key);
    ctx.history.flush();
    ctx.store.flush();
    log.info(`${by} removed ${name} (${key}) from the leaderboards`);
    return ok(`**${name}** is off the leaderboards and their saved stats are deleted. \`/admin restore\` lets them back.`);
}

async function restorePlayer(ctx, query, by) {
    const q = query.trim().toLowerCase();
    const key = ctx.history.data.hidden.find(k => ctx.history.displayName(k).toLowerCase() === q) ||
        ctx.history.data.hidden.find(k => ctx.history.displayName(k).toLowerCase().includes(q));
    if (!key) return fail(`**${query}** isn't removed from the leaderboards.`);

    const name = ctx.history.displayName(key);
    ctx.history.restore(key);
    ctx.history.flush();
    log.info(`${by} restored ${name} (${key}) to the leaderboards`);
    return ok(`**${name}** is back on the leaderboards. Their stats start fresh from now.`);
}

// For /server restore's auto-fill.
export function backupChoices(query) {
    const q = query.trim().toLowerCase();
    try {
        return listBackups()
            .map(backupChoice)
            .filter(c => !q || c.name.toLowerCase().includes(q));
    } catch {
        return [];
    }
}

// For /admin save's auto-fill, from the mod; kept for ten minutes.
let saveCache = { list: [], at: 0 };
export async function saveChoices(query) {
    if (Date.now() - saveCache.at > 10 * 60 * 1000) {
        try {
            saveCache = { list: await api.saveCandidates(), at: Date.now() };
        } catch {
            // the server is down or the mod is older - nothing to suggest
        }
    }
    const q = query.trim().toLowerCase();
    return saveCache.list.filter(c => !q || c.toLowerCase().includes(q)).map(c => ({ name: c.slice(0, 100), value: c.slice(0, 100) }));
}

// For /admin restore's auto-fill.
export function removedChoices(ctx, query) {
    const q = query.trim().toLowerCase();
    return ctx.history.data.hidden
        .map(k => ctx.history.displayName(k))
        .filter(name => !q || name.toLowerCase().includes(q))
        .map(name => ({ name: `🚫 ${name}`.slice(0, 100), value: name.slice(0, 100) }));
}

export const adminCommands = { server, admin };
