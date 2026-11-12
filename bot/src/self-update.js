import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { api } from './api.js';
import { config } from './config.js';
import { contactButton } from './developer.js';
import { logger } from './log.js';

const log = logger('self-update');
const run = promisify(execFile);

const BOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BOT_VERSION = JSON.parse(fs.readFileSync(path.join(BOT_DIR, 'package.json'), 'utf8')).version;
const STATE_FILE = path.join(config.dataDir, 'self-update.json');
// What an update never touches in the bot's folder.
const KEEP = new Set(['.env', 'data', 'node_modules']);

// "0.10.1" vs "0.9.12": numeric, part by part. Negative when a is older.
export function compareVersions(a, b) {
    const pa = String(a || '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
}

// Releases are titled "Mod 0.10.1 · Bot 0.14.1" and tagged with the mod version.
function parseRelease(r) {
    const mod = /Mod\s+v?([\d.]+)/i.exec(r.name || '')?.[1] || String(r.tag_name || '').replace(/^v/, '');
    const bot = /Bot\s+v?([\d.]+)/i.exec(r.name || '')?.[1] || '';
    return {
        tag: r.tag_name,
        name: r.name || r.tag_name,
        url: r.html_url,
        body: r.body || '',
        publishedAt: r.published_at,
        mod,
        bot,
        tarball: r.tarball_url,
        library: (r.assets || []).find(a => a.name === 'librsdwapi.so')?.browser_download_url || '',
    };
}

async function download(url, file) {
    // Any type: the source archive refuses application/octet-stream (HTTP 415).
    const res = await fetch(url, { headers: { 'User-Agent': 'rsdw-bot-self-update', Accept: '*/*' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// Release notes as Discord shows them: the first few lines, minus images.
function notesExcerpt(body) {
    const lines = body
        .replace(/<img[^>]*>/g, '')
        .replace(/^> \[!(IMPORTANT|NOTE|WARNING)\]\s*$/gim, '')
        .split(/\r?\n/)
        .map(l => l.replace(/^> /, '').trimEnd())
        .filter(l => l.trim());
    let out = '';
    for (const l of lines) {
        const line = l.replace(/^## /, '**').replace(/^(\*\*[^*]+)$/, '$1**');
        if ((out + line + '\n').length > 900) {
            out += '…';
            break;
        }
        out += line + '\n';
    }
    return out.trim();
}

// Checks GitHub for a newer release of this bot and mod (BOT_UPDATE_REPO), tells
// the admins by DM with buttons to install it, and installs it when asked (or
// by itself with BOT_UPDATE_AUTO). The bot updates its own files and restarts
// (systemd brings it back up); the mod is built from source - or downloaded
// ready-made when the server can't build - and swapped in for the next restart.
export class SelfUpdate {
    constructor(client, alerts) {
        this.client = client;
        this.alerts = alerts;
        this.state = { notified: '', skipped: '', updatedFrom: null };
        try {
            Object.assign(this.state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
        } catch {}
        this.busy = false;
    }

    save() {
        try {
            fs.mkdirSync(config.dataDir, { recursive: true });
            fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 1));
        } catch (err) {
            log.warn(`could not save ${STATE_FILE}: ${err.message}`);
        }
    }

    start() {
        // Confirm an update the bot restarted itself for.
        if (this.state.updatedFrom) {
            const { from, to } = this.state.updatedFrom;
            this.state.updatedFrom = null;
            this.save();
            const ok = compareVersions(BOT_VERSION, from) > 0;
            setTimeout(() => this.alerts.dm(ok ? '✅ Bot updated' : '⚠️ Bot update', ok
                ? `The bot restarted on version **${BOT_VERSION}** (was ${from}).`
                : `The bot was meant to update to ${to} but is still on ${BOT_VERSION}. Check its log: \`journalctl -u rsdw-bot\`.`, ok ? 0x2ecc71 : 0xe67e22).catch(() => {}), 15 * 1000);
        }
        if (!config.selfUpdateCheck) {
            log.info('update checks are off (BOT_UPDATE_CHECK=false)');
            return;
        }
        log.info(`checking ${config.selfUpdateRepo} for updates every ${config.selfUpdateHours}h${config.selfUpdateAuto ? ', installing them automatically' : ''}`);
        setTimeout(() => this.check().catch(err => log.warn(`update check failed: ${err.message}`)), 2 * 60 * 1000);
        setInterval(() => this.check().catch(err => log.warn(`update check failed: ${err.message}`)), config.selfUpdateHours * 3600 * 1000);
    }

    async latest() {
        const res = await fetch(`https://api.github.com/repos/${config.selfUpdateRepo}/releases/latest`, {
            headers: { 'User-Agent': 'rsdw-bot-self-update', Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) throw new Error(`GitHub answered HTTP ${res.status}`);
        return parseRelease(await res.json());
    }

    // What's installed, what's out, and which of the two is behind.
    async status() {
        const release = await this.latest();
        let mod = '';
        try {
            mod = (await api.health()).version || '';
        } catch {}
        return {
            release,
            bot: BOT_VERSION,
            mod,
            botBehind: !!release.bot && compareVersions(release.bot, BOT_VERSION) > 0,
            modBehind: !!release.mod && !!mod && compareVersions(release.mod, mod) > 0,
        };
    }

    async check() {
        const s = await this.status();
        if (!s.botBehind && !s.modBehind) return s;
        if (this.state.skipped === s.release.tag) return s;
        if (config.selfUpdateAuto) {
            log.info(`installing ${s.release.name} by itself (BOT_UPDATE_AUTO)`);
            const result = await this.apply(s, 'automatic update');
            await this.alerts.send({ embeds: [this.resultEmbed(s, result)] });
            if (result.restartBot) this.restartSoon(s);
            return s;
        }
        if (this.state.notified !== s.release.tag) {
            this.state.notified = s.release.tag;
            this.save();
            log.info(`telling the admins about ${s.release.name}`);
            await this.alerts.send(this.message(s));
        }
        return s;
    }

    // The DM (and /admin update reply): what's new and the buttons to act on it.
    message(s) {
        const embed = new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`⬆️ Update available: ${s.release.name}`)
            .setURL(s.release.url)
            .addFields(
                { name: '🤖 Bot', value: s.botBehind ? `${s.bot} → **${s.release.bot}**` : `${s.bot} · up to date`, inline: true },
                { name: '🧩 Mod', value: !s.mod ? `unknown (server down) → ${s.release.mod}` : s.modBehind ? `${s.mod} → **${s.release.mod}**` : `${s.mod} · up to date`, inline: true },
            )
            .setFooter({ text: `${config.selfUpdateRepo} · ${config.serverName}` })
            .setTimestamp(s.release.publishedAt ? new Date(s.release.publishedAt) : new Date());
        const notes = notesExcerpt(s.release.body);
        if (notes) embed.setDescription(notes);
        embed.addFields({
            name: 'What "Update now" does',
            value: [
                s.botBehind && '• The bot installs the new version and restarts itself (a few seconds offline).',
                s.modBehind && '• The new mod is installed for the next server start. Use `/server restart` to load it sooner.',
                '• Your `.env`, saved data and the game server are left alone.',
            ].filter(Boolean).join('\n'),
        });
        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`selfupdate:apply:${s.release.tag}`).setLabel('Update now').setEmoji('⬆️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`selfupdate:skip:${s.release.tag}`).setLabel('Skip this version').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setURL(s.release.url).setLabel('Release notes').setStyle(ButtonStyle.Link),
            contactButton(),
        );
        return { embeds: [embed], components: [buttons] };
    }

    resultEmbed(s, result) {
        return new EmbedBuilder()
            .setColor(result.ok ? 0x2ecc71 : 0xe74c3c)
            .setTitle(result.ok ? `✅ ${s.release.name}` : `⚠️ ${s.release.name}: not fully installed`)
            .setDescription(result.lines.join('\n').slice(0, 4000))
            .setFooter({ text: config.serverName })
            .setTimestamp();
    }

    // /admin update: the same card, on demand.
    async command() {
        try {
            const s = await this.status();
            if (!s.botBehind && !s.modBehind) {
                return { reply: { embeds: [new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ Up to date')
                    .setDescription(`Bot **${s.bot}** · mod **${s.mod || 'unknown (server down)'}**\nLatest release: [${s.release.name}](${s.release.url})`)] } };
            }
            return { reply: this.message(s) };
        } catch (err) {
            return { reply: { embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(`Couldn't check for updates: ${err.message}`)] } };
        }
    }

    // The buttons on the DM and on /admin update.
    async button(interaction, isAdmin) {
        const [, action, tag] = interaction.customId.split(':');
        if (!isAdmin(interaction.user)) {
            return interaction.reply({ content: 'Only the server admins can update the bot.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        if (action === 'skip') {
            this.state.skipped = tag;
            this.save();
            log.info(`${interaction.user.tag} skipped ${tag}`);
            return interaction.update({ content: `Skipped ${tag}. You'll hear about the next release.`, components: [] }).catch(() => {});
        }
        if (this.busy) return interaction.reply({ content: 'An update is already being installed.', flags: MessageFlags.Ephemeral }).catch(() => {});
        // Private in a channel, like every admin reply; a DM is private anyway.
        await interaction.deferReply(interaction.inGuild() ? { flags: MessageFlags.Ephemeral } : {}).catch(() => {});
        try {
            const s = await this.status();
            if (s.release.tag !== tag) {
                return interaction.editReply({ content: `A newer release is out (${s.release.name}). Use \`/admin update\` to see it.` }).catch(() => {});
            }
            if (!s.botBehind && !s.modBehind) return interaction.editReply({ content: 'Already up to date.' }).catch(() => {});
            log.info(`${interaction.user.tag} is installing ${s.release.name}`);
            const result = await this.apply(s, interaction.user.tag);
            await interaction.editReply({ embeds: [this.resultEmbed(s, result)] }).catch(() => {});
            await interaction.message?.edit({ components: [] }).catch(() => {});
            if (result.restartBot) this.restartSoon(s);
        } catch (err) {
            log.error('update failed:', err);
            await interaction.editReply({ content: `The update failed: ${err.message}. Nothing was changed.` }).catch(() => {});
        }
    }

    restartSoon(s) {
        this.state.updatedFrom = { from: BOT_VERSION, to: s.release.bot, at: Date.now() };
        this.save();
        log.info(`restarting to load bot ${s.release.bot}`);
        // systemd (Restart=always) starts it again on the new code.
        setTimeout(() => process.exit(0), 2000);
    }

    // Downloads the release's source and installs whichever of the bot and the mod is behind.
    async apply(s, by) {
        this.busy = true;
        const lines = [];
        let ok = true;
        let restartBot = false;
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rsdw-update-'));
        try {
            const archive = path.join(work, 'source.tar.gz');
            await download(s.release.tarball, archive);
            await run('tar', ['-xzf', archive, '-C', work]);
            const root = fs.readdirSync(work).map(n => path.join(work, n)).find(p => fs.statSync(p).isDirectory());
            if (!root) throw new Error('the release archive was empty');

            if (s.modBehind) {
                try {
                    lines.push(await this.installMod(root, s, work));
                } catch (err) {
                    ok = false;
                    lines.push(`🧩 Mod not updated: ${err.message}`);
                }
            }
            if (s.botBehind) {
                try {
                    lines.push(await this.installBot(root, s));
                    restartBot = true;
                } catch (err) {
                    ok = false;
                    lines.push(`🤖 Bot not updated: ${err.message}. It keeps running ${BOT_VERSION}.`);
                }
            }
            log.info(`${s.release.name} (${by}): ${lines.join(' | ')}`);
            return { ok, lines, restartBot };
        } finally {
            fs.rmSync(work, { recursive: true, force: true });
            this.busy = false;
        }
    }

    async installMod(root, s, work) {
        const target = config.modFile;
        if (!fs.existsSync(target)) throw new Error(`there's no mod at ${target} (set MOD_FILE in .env to where it is)`);
        // Built here so it matches this server's system; the release's ready-made
        // copy when there are no build tools.
        let built = '';
        let how = '';
        try {
            await run('make', ['-j', String(Math.max(1, os.cpus().length))], { cwd: root, timeout: 15 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
            built = path.join(root, 'dist', 'librsdwapi.so');
            how = 'built on this server';
        } catch (err) {
            if (!s.release.library) throw new Error(`couldn't build it (${String(err.message).split('\n')[0]}) and the release has no ready-made copy`);
            built = path.join(work, 'librsdwapi.so');
            await download(s.release.library, built);
            how = 'downloaded ready-made (install build-essential to build it here instead)';
        }
        if (!fs.existsSync(built) || fs.statSync(built).size < 100000) throw new Error('the new mod file looks wrong');
        // Copy next to it, then rename over it: never write into the loaded file.
        fs.copyFileSync(target, target + '.old');
        fs.copyFileSync(built, target + '.new');
        fs.chmodSync(target + '.new', 0o755);
        fs.renameSync(target + '.new', target);
        return `🧩 Mod **${s.release.mod}** installed (${how}). It loads at the next server start; \`/server restart\` loads it now. The previous one is kept as \`${path.basename(target)}.old\`.`;
    }

    async installBot(root, s) {
        if (fs.existsSync(path.join(BOT_DIR, '.git'))) throw new Error('this bot runs from a git checkout - update it with `git pull` instead');
        const src = path.join(root, 'bot');
        if (!fs.existsSync(path.join(src, 'package.json'))) throw new Error("the release has no bot folder");
        // Refuse code that doesn't even parse, before touching anything.
        for (const file of fs.readdirSync(path.join(src, 'src')).filter(f => f.endsWith('.js'))) {
            await run(process.execPath, ['--check', path.join(src, 'src', file)]);
        }
        // The current version, for putting back by hand: data/previous-bot/.
        const backup = path.join(config.dataDir, 'previous-bot');
        fs.rmSync(backup, { recursive: true, force: true });
        fs.mkdirSync(backup, { recursive: true });
        for (const name of fs.readdirSync(BOT_DIR)) {
            if (KEEP.has(name)) continue;
            fs.cpSync(path.join(BOT_DIR, name), path.join(backup, name), { recursive: true });
        }
        const read = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
        const depsChanged = ['package.json', 'package-lock.json'].some(f => read(path.join(src, f)) !== read(path.join(BOT_DIR, f)));
        // Settings this release adds: in its .env.example but not the one being replaced.
        const keys = f => new Set(read(f).match(/^#?\s*[A-Z][A-Z0-9_]+(?==)/gm)?.map(k => k.replace(/^#?\s*/, '')) || []);
        const before = keys(path.join(BOT_DIR, '.env.example'));
        const added = [...keys(path.join(src, '.env.example'))].filter(k => !before.has(k));
        for (const name of fs.readdirSync(src)) {
            if (KEEP.has(name)) continue;
            fs.rmSync(path.join(BOT_DIR, name), { recursive: true, force: true });
            fs.cpSync(path.join(src, name), path.join(BOT_DIR, name), { recursive: true });
        }
        if (depsChanged) {
            await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: BOT_DIR, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 });
        }
        return `🤖 Bot **${s.release.bot}** installed${depsChanged ? ' (packages updated)' : ''}; restarting now. The previous version is kept in \`data/previous-bot/\`.` +
            (added.length ? `\nNew settings you can add to \`.env\` (their defaults apply until you do): ${added.map(k => `\`${k}\``).join(', ')}` : '');
    }
}
