import { MessageFlags } from 'discord.js';
import { announce } from './announcer.js';
import { api } from './api.js';
import { config } from './config.js';
import { errorEmbed, okEmbed } from './embeds.js';

// /server and /admin: only for the Discord users in ADMIN_USER_IDS. Replies are
// only visible to the admin who ran them.

export const ADMIN_COMMANDS = new Set(['server', 'admin']);

export const isAdmin = user => config.adminUserIds.includes(user.id);

const ok = text => ({ reply: { embeds: [okEmbed(text)] } });
const fail = text => ({ reply: { embeds: [errorEmbed(text)] } });

async function server(i, ctx) {
    const action = i.options.getString('action', true);
    const by = i.user.tag;
    const { control, poller } = ctx;

    if (action === 'cancel') {
        const cancelled = await control.cancel(by);
        return cancelled ? ok(`The planned ${cancelled} is cancelled. Players have been told.`) : fail('Nothing is planned.');
    }

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

export const adminCommands = { server, admin };
