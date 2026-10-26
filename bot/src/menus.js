import { PermissionFlagsBits } from 'discord.js';
import { logger } from './log.js';

const log = logger('menu');
const IDLE_MS = 10 * 60 * 1000;

// Discord sometimes drops the variation selector from emoji like ⚔️ and ⛏️.
export const normEmoji = e => (e || '').replace(/️/g, '');

// Adds reaction buttons to a message. onPress(emoji) returns new message
// content, or null to leave it as is. With Manage Messages the bot clears the
// user's reaction after each press; without it, removing a reaction counts as
// a press too, so clicking the same emoji again still works.
export async function attachMenu(message, { emojis, onPress }) {
    const me = message.client.user;
    const canManage = message.channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageMessages) ?? false;
    const wanted = new Set(emojis.map(normEmoji));

    const collector = message.createReactionCollector({
        filter: (reaction, user) => !user.bot && wanted.has(normEmoji(reaction.emoji.name)),
        idle: IDLE_MS,
        dispose: !canManage,
    });

    // Presses are handled one at a time so fast clicking can't interleave edits.
    let queue = Promise.resolve();
    const press = (reaction, user) => {
        queue = queue.then(async () => {
            try {
                log.debug(`${user.tag} pressed ${reaction.emoji.name} on ${message.id}`);
                const next = await onPress(normEmoji(reaction.emoji.name));
                if (next) await message.edit(next);
            } catch (err) {
                log.error(`press failed on ${message.id}: ${err.message}`);
            }
        });
    };

    collector.on('collect', (reaction, user) => {
        press(reaction, user);
        if (canManage) reaction.users.remove(user.id).catch(() => {});
    });
    if (!canManage) collector.on('remove', press);

    collector.on('end', async () => {
        if (canManage) {
            await message.reactions.removeAll().catch(() => {});
            return;
        }
        for (const reaction of message.reactions.cache.values()) {
            await reaction.users.remove(me.id).catch(() => {});
        }
    });

    for (const emoji of emojis) {
        if (collector.ended) break;
        try {
            await message.react(emoji);
        } catch (err) {
            log.warn(`could not add reactions in #${message.channel.name} (${err.message}) - give the bot Add Reactions`);
            break;
        }
    }
}
