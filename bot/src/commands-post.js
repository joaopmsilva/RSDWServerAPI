import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { helpEmbed } from './embeds.js';
import { logger } from './log.js';

const log = logger('commands-post');

// The command list, posted once in COMMANDS_CHANNEL_ID (default the chat
// channel) and pinned when the bot may. On later starts the same message is
// edited if the list changed. Deleting it is respected - it isn't posted again
// unless data/commands-post.json is removed or the channel changes.
export class CommandsPost {
    constructor(client) {
        this.client = client;
        this.file = path.join(config.dataDir, 'commands-post.json');
        this.saved = null;
        try {
            this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    async start() {
        const channelId = config.commandsChannelId;
        if (!config.commandsPost || !channelId) return;
        const embed = helpEmbed();
        const key = JSON.stringify(embed.toJSON());

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (this.saved?.channelId === channelId) {
                if (this.saved.key === key) return;
                const message = await channel.messages.fetch(this.saved.messageId).catch(() => null);
                if (!message) {
                    log.info(`the command list in #${channel.name} was deleted - delete ${this.file} to post it again`);
                    this.remember({ ...this.saved, key });
                    return;
                }
                await message.edit({ embeds: [embed] });
                this.remember({ ...this.saved, key });
                log.info(`updated the command list in #${channel.name}`);
                return;
            }

            const message = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
            this.remember({ channelId, messageId: message.id, key });
            log.info(`posted the command list in #${channel.name}`);
            // Pinning needs Manage Messages (Pin Messages); without it the post just isn't pinned.
            await message.pin().catch(err => log.info(`could not pin the command list (${err.message}) - pin it by hand if you like`));
        } catch (err) {
            log.warn(`could not post the command list: ${err.message} - the bot needs View Channel, Send Messages, Embed Links and Read Message History there`);
        }
    }

    remember(saved) {
        this.saved = saved;
        try {
            fs.mkdirSync(config.dataDir, { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(saved));
        } catch (err) {
            log.error(`could not save ${this.file}: ${err.message}`);
        }
    }
}
