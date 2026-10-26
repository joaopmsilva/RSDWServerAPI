import { api } from './api.js';
import { config } from './config.js';
import { logger } from './log.js';

const log = logger('bridge');
const MAX_QUEUE = 20;
const ECHO_MS = 60 * 1000;

// Plain text the game's chat box can show: no Discord markup, one line.
function toGameText(message) {
    let text = message.cleanContent
        .replace(/<a?:(\w+):\d+>/g, ':$1:')
        .replace(/\*\*|__|~~|\|\||`/g, '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const extras = [];
    const files = [...message.attachments.values()];
    if (files.some(f => f.contentType?.startsWith('image/'))) extras.push('[image]');
    if (files.some(f => !f.contentType?.startsWith('image/'))) extras.push('[file]');
    if (message.stickers.size) extras.push('[sticker]');
    text = [text, ...extras].filter(Boolean).join(' ');

    if (text.length > config.bridgeMaxLength) text = text.slice(0, config.bridgeMaxLength - 1) + '…';
    return text;
}

function senderName(message) {
    const name = message.member?.displayName || message.author.globalName || message.author.username;
    return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32) || 'Someone';
}

// Sends messages from the Discord chat channel into the game through the
// mod's /api/broadcast. Players see "[Discord] Name: message".
export class Bridge {
    constructor() {
        this.queue = Promise.resolve();
        this.pending = 0;
        this.recent = [];
    }

    get enabled() {
        return config.bridgeToGame && Boolean(config.chatChannelId);
    }

    start() {
        if (!this.enabled) {
            log.info(config.chatChannelId ? 'BRIDGE_TO_GAME is off, Discord messages stay in Discord' : 'no CHAT_CHANNEL_ID, Discord to game is off');
            return;
        }
        const who = config.bridgeRoleId ? `members with role ${config.bridgeRoleId}` : 'everyone';
        log.info(`sending messages from ${config.chatChannelId} into the game (${who})`);
    }

    handles(message) {
        if (!this.enabled || message.channelId !== config.chatChannelId) return false;
        if (config.bridgeRoleId && !message.member?.roles.cache.has(config.bridgeRoleId)) return false;
        return true;
    }

    // One at a time and in order; the mod blocks while the game thread delivers.
    send(message) {
        if (this.pending >= MAX_QUEUE) {
            log.warn(`queue full, dropped a message from ${message.author.tag}`);
            message.react('⚠️').catch(() => {});
            return;
        }
        this.pending++;
        this.queue = this.queue.then(() => this.deliver(message)).finally(() => this.pending--);
    }

    async deliver(message) {
        const text = toGameText(message);
        if (!text) return;
        const line = `${senderName(message)}: ${text}`;

        try {
            await api.broadcast(config.bridgePrefix, line);
            this.remember(line);
            log.info(`to game: ${line}`);
        } catch (err) {
            // Nobody to deliver to is normal; anything else is worth a look.
            const quiet = err.kind === 'offline' || err.kind === 'starting' || /no players/i.test(err.message);
            if (quiet) log.debug(`not delivered (${err.message}): ${line}`);
            else log.warn(`not delivered (${err.message}): ${line}`);
            await message.react(quiet ? '💤' : '⚠️').catch(() => {});
        }
    }

    remember(line) {
        const now = Date.now();
        this.recent = this.recent.filter(r => now - r.at < ECHO_MS);
        this.recent.push({ line, at: now });
    }

    // The broadcast goes straight to players' chat boxes, so the mod shouldn't
    // see it as chat - but if a game patch changes that, don't post it back.
    isEcho(event) {
        const now = Date.now();
        return this.recent.some(r => now - r.at < ECHO_MS && (event.message || '').endsWith(r.line));
    }
}
