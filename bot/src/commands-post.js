import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { helpEmbed } from './embeds.js';
import { logger } from './log.js';

const log = logger('commands-post');

// A card posted once in a channel and pinned when the bot may: by default the
// command list in COMMANDS_CHANNEL_ID (default the chat channel). On later
// starts the same message is edited if the card changed. Deleting it is
// respected - it isn't posted again unless data/<id>.json is removed or the
// channel changes.
export class CommandsPost {
    constructor(client, { id = 'commands-post', channelId = config.commandsChannelId, enabled = config.commandsPost, embed = helpEmbed, components = () => [], what = 'the command list' } = {}) {
        this.client = client;
        this.channelId = channelId;
        this.enabled = enabled;
        this.embed = embed;
        this.components = components;
        this.what = what;
        this.file = path.join(config.dataDir, `${id}.json`);
        this.saved = null;
        try {
            this.saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    async start() {
        const { channelId, what } = this;
        if (!this.enabled || !channelId) return;
        const embed = this.embed();
        const components = this.components();
        const key = JSON.stringify([embed.toJSON(), components.map(c => c.toJSON())]);

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (this.saved?.channelId === channelId) {
                if (this.saved.key === key) return;
                const message = await channel.messages.fetch(this.saved.messageId).catch(() => null);
                if (!message) {
                    log.info(`${what} in #${channel.name} was deleted - delete ${this.file} to post it again`);
                    this.remember({ ...this.saved, key });
                    return;
                }
                await message.edit({ embeds: [embed], components });
                this.remember({ ...this.saved, key });
                log.info(`updated ${what} in #${channel.name}`);
                return;
            }

            // Moved to another channel: take the old card down.
            if (this.saved?.channelId && this.saved.messageId) {
                const old = await this.client.channels.fetch(this.saved.channelId).catch(() => null);
                const oldMessage = old ? await old.messages.fetch(this.saved.messageId).catch(() => null) : null;
                if (oldMessage) {
                    await oldMessage.delete().then(
                        () => log.info(`removed the old copy of ${what} from #${old.name}`),
                        err => log.info(`could not remove the old copy of ${what} from #${old.name}: ${err.message}`),
                    );
                }
            }
            const message = await channel.send({ embeds: [embed], components, allowedMentions: { parse: [] } });
            this.remember({ channelId, messageId: message.id, key });
            log.info(`posted ${what} in #${channel.name}`);
            // Pinning needs Manage Messages (Pin Messages); without it the post just isn't pinned.
            await message.pin().catch(err => log.info(`could not pin ${what} (${err.message}) - pin it by hand if you like`));
        } catch (err) {
            log.warn(`could not post ${what}: ${err.message} - the bot needs View Channel, Send Messages, Embed Links and Read Message History there`);
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
