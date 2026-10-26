import { execFile } from 'node:child_process';
import { MessageFlags } from 'discord.js';
import { announce } from './announcer.js';
import { api } from './api.js';
import { resolvePlayer } from './commands.js';
import { config } from './config.js';
import { bansEmbed, diagnosticsEmbed, errorEmbed, okEmbed } from './embeds.js';
import { logger } from './log.js';

const log = logger('admin');

// /server and /admin: only for the Discord users in ADMIN_USER_IDS. Replies are
// only visible to the admin who ran them.

export const ADMIN_COMMANDS = new Set(['server', 'admin']);

export const isAdmin = user => config.adminUserIds.includes(user.id);

const ok = text => ({ reply: { embeds: [okEmbed(text)] } });
const fail = text => ({ reply: { embeds: [errorEmbed(text)] } });
const tail = output => (output ? '\n```\n' + output.slice(-1500) + '\n```' : '');

// Runs BACKUP_SCRIPT now, as the bot's user. The script posts its own
// "Backup complete" notice.
function backup(by) {
    log.info(`backup requested by ${by}`);
    return new Promise(resolve => {
        execFile('bash', [config.backupScript], { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
            const output = `${stdout}${stderr}`.trim();
            if (err) {
                log.error(`backup failed: ${err.message}`);
                resolve(fail(`The backup failed: ${err.message.split('\n')[0]}${tail(output)}`));
            } else {
                log.info('backup done');
                resolve(ok(`Backup done.${tail(output)}`));
            }
        });
    });
}

async function server(i, ctx) {
    const action = i.options.getString('action', true);
    const by = i.user.tag;
    const { control, poller } = ctx;

    if (action === 'cancel') {
        const cancelled = await control.cancel(by);
        return cancelled ? ok(`The planned ${cancelled} is cancelled. Players have been told.`) : fail('Nothing is planned.');
    }

    if (action === 'backup') return backup(by);

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

async function admin(i, ctx) {
    const sub = i.options.getSubcommand();
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

// For /admin restore's auto-fill.
export function removedChoices(ctx, query) {
    const q = query.trim().toLowerCase();
    return ctx.history.data.hidden
        .map(k => ctx.history.displayName(k))
        .filter(name => !q || name.toLowerCase().includes(q))
        .map(name => ({ name: `🚫 ${name}`.slice(0, 100), value: name.slice(0, 100) }));
}

export const adminCommands = { server, admin };
