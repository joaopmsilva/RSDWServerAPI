import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './api.js';
import { config } from './config.js';
import { alertButtons, alertsEmbed, linkedEmbed, welcomeEmbed } from './embeds.js';
import { logger } from './log.js';
import { PlayerStore } from './store.js';

const log = logger('links');
const CODE_MINUTES = 10;
// No 0/O or 1/I, so a code read off the screen can't be mistyped.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

// Discord accounts linked to in-game characters. /link gives a one-time code,
// the player types "/link CODE" in game chat, and the mod reports it as a
// "link" event with who sent it. Kept in data/links.json.
export class Links {
    constructor(dir, store, client = null) {
        this.store = store;
        this.client = client;
        this.file = path.join(dir, 'links.json');
        this.links = {}; // discord user id -> { key, netId, name, at }
        this.pending = new Map(); // code -> { userId, expires, interaction }
        try {
            this.links = JSON.parse(fs.readFileSync(this.file, 'utf8')).links || {};
            log.info(`loaded ${Object.keys(this.links).length} linked account(s)`);
        } catch (err) {
            if (err.code !== 'ENOENT') log.warn(`could not read ${this.file}: ${err.message}`);
        }
    }

    save() {
        try {
            const tmp = this.file + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify({ version: 1, links: this.links }, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (err) {
            log.error(`could not save ${this.file}: ${err.message}`);
        }
    }

    // A fresh code for this Discord user; any older one of theirs stops working.
    // interaction is kept so the reply can be updated once the code is used.
    createCode(userId, interaction) {
        for (const [code, p] of this.pending) if (p.userId === userId || p.expires < Date.now()) this.pending.delete(code);
        let code;
        do code = Array.from(crypto.randomBytes(CODE_LENGTH), b => ALPHABET[b % ALPHABET.length]).join('');
        while (this.pending.has(code));
        this.pending.set(code, { userId, expires: Date.now() + CODE_MINUTES * 60000, interaction });
        return { code, minutes: CODE_MINUTES };
    }

    of(userId) {
        return this.links[userId] || null;
    }

    unlink(userId) {
        const link = this.links[userId];
        if (!link) return null;
        delete this.links[userId];
        this.save();
        log.info(`${userId} unlinked from ${link.name}`);
        return link;
    }

    // Discord user ids linked to a character key, or to a net id. With alert
    // (raid or hunted), only those who turned that alert on.
    usersFor({ key, netId }, alert = null) {
        return Object.entries(this.links)
            .filter(([, l]) => (key && l.key === key) || (netId && l.netId === netId))
            .filter(([, l]) => !alert || l.alerts?.[alert])
            .map(([userId]) => userId);
    }

    // Raid and hunt DMs are off until the player turns them on. Returns the link.
    toggleAlert(userId, alert) {
        const link = this.links[userId];
        if (!link) return null;
        link.alerts = { ...link.alerts, [alert]: !link.alerts?.[alert] };
        this.save();
        log.info(`${userId} turned ${alert} alerts ${link.alerts[alert] ? 'on' : 'off'}`);
        return link;
    }

    // From the relay: someone typed "/link CODE" in game.
    async handle(event) {
        const code = String(event.message || '').trim().toUpperCase();
        const pending = this.pending.get(code);
        const tell = text => api.whisper(event.netId || event.name, text).catch(err => log.warn(`could not answer ${event.name} in game: ${err.message}`));

        if (!pending || pending.expires < Date.now()) {
            if (pending) this.pending.delete(code);
            log.info(`${event.name} sent an unknown or expired link code`);
            await tell("That code isn't valid or has expired - use /link in Discord to get a new one.");
            return;
        }
        this.pending.delete(code);

        const guidKey = event.characterGuid && !/^0+$/.test(event.characterGuid) ? `guid:${event.characterGuid}` : null;
        const key = guidKey || (event.netId && this.store.keyOfNetId(event.netId)) || PlayerStore.key({ name: event.name, uniqueNetId: event.netId });
        // One character per Discord account, one Discord account per character.
        for (const userId of this.usersFor({ key })) if (userId !== pending.userId) delete this.links[userId];
        const alerts = this.links[pending.userId]?.alerts || { raid: false, hunted: false };
        this.links[pending.userId] = { key, netId: event.netId || '', name: event.name, at: Date.now(), alerts };
        this.save();
        log.info(`linked Discord ${pending.userId} to ${event.name} (${key})`);

        let discordName = 'your Discord account';
        if (pending.interaction) {
            discordName = pending.interaction.user.username;
            const link = this.links[pending.userId];
            await pending.interaction
                .editReply({ embeds: [linkedEmbed(event.name), alertsEmbed(link)], components: alertButtons(link) })
                .catch(err => log.debug(`could not update the /link reply: ${err.message}`));
        }
        await tell(`Linked to ${discordName} on Discord.`);
        await this.welcome(pending.userId);
    }

    // A DM after linking: what the link does, and the alert switches, so the
    // player can manage alerts from their DMs from then on. Sent once per link.
    async welcome(userId) {
        const link = this.links[userId];
        if (!link || link.welcomed || !this.client) return;
        try {
            const user = await this.client.users.fetch(userId);
            await user.send({ embeds: [welcomeEmbed(link.name), alertsEmbed(link)], components: alertButtons(link) });
            log.info(`sent the welcome DM to ${link.name}'s Discord`);
        } catch (err) {
            log.info(`could not DM ${userId}: ${err.message} - they may have DMs from server members turned off`);
        }
        // Not retried either way: a closed DM stays closed, and /alerts works anywhere.
        link.welcomed = true;
        this.save();
    }

    // At start: links made before welcome DMs existed get theirs now.
    async welcomeAll() {
        for (const userId of Object.keys(this.links)) await this.welcome(userId);
    }
}

export const linkChannelHint = () => (config.linkChannelId ? ` in <#${config.linkChannelId}>` : '');
