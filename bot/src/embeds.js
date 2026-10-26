import { EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { MAX_LEVEL } from './levels.js';
import { CATEGORIES } from './skills.js';

const COLOR = {
    online: 0x2ecc71,
    offline: 0x95a5a6,
    starting: 0xf1c40f,
    error: 0xe74c3c,
    info: 0x3498db,
    unknown: 0x95a5a6,
};

const fmt = n => Math.round(n).toLocaleString('en-US');
const pct = p => Math.floor(Math.min(1, Math.max(0, p)) * 100);
const relative = ms => `<t:${Math.floor(ms / 1000)}:R>`;

export function progressBar(fraction, width = 14) {
    const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
    return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function displayName(player) {
    const { name, characterName } = player;
    if (characterName && name && characterName.toLowerCase() !== name.toLowerCase()) {
        return `${characterName} (${name})`;
    }
    return characterName || name || 'Unknown';
}

// ---- player pages -------------------------------------------------------

function statusLine(profile) {
    if (profile.online) return '🟢 **Online now**';
    return profile.lastSeen ? `⚫ **Offline** · last seen ${relative(profile.lastSeen)}` : '⚫ **Offline**';
}

// Live for online players, from the saved snapshot otherwise.
function healthLine(profile) {
    const max = profile.player.health?.max > 0 ? profile.player.health.max : profile.player.maxHealth;
    return max > 0 ? `❤️ **Max health** \`${fmt(max)}\`` : null;
}

function playerEmbed(profile, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: displayName(profile.player) })
        .setTimestamp(new Date(profile.fetchedAt));
}

function overviewPage(profile) {
    const embed = playerEmbed(profile, profile.online ? COLOR.online : COLOR.offline).setTitle('📊 Skills');

    const lines = [statusLine(profile)];
    const health = healthLine(profile);
    if (health) lines.push(health);
    lines.push('');
    if (profile.skills.length) {
        lines.push(`**Total level** \`${fmt(profile.totalLevel)}\`  ·  **Total XP** \`${fmt(profile.totalXP)}\``);
    } else {
        lines.push('No skill data yet - they may still be loading in.');
    }
    embed.setDescription(lines.join('\n'));

    for (const category of CATEGORIES) {
        const skills = profile.skills.filter(s => s.category.id === category.id);
        if (!skills.length) continue;
        embed.addFields({
            name: `${category.emoji} ${category.name}`,
            value: skills
                .map(s => {
                    const progress = s.info.maxed ? '⭐' : `· ${pct(s.info.progress)}%`;
                    return `\`${String(s.info.level).padStart(2)}\` ${s.emoji} ${s.name} ${progress}`;
                })
                .join('\n'),
            inline: true,
        });
    }
    return embed;
}

function skillPage(profile, key) {
    const s = profile.skills.find(entry => entry.key === key);
    if (!s) return overviewPage(profile);

    const { info } = s;
    const embed = playerEmbed(profile, s.category.color).setTitle(`${s.emoji} ${s.name}`);
    if (s.icon) embed.setThumbnail(s.icon);

    if (info.maxed) {
        embed
            .setDescription(`${statusLine(profile)}\n\n### Level ${info.level} / ${MAX_LEVEL} ⭐\n\`${progressBar(1, 18)}\` **MAX**`)
            .addFields({ name: 'Total XP', value: fmt(info.xp), inline: true });
        return embed;
    }

    embed
        .setDescription(
            `${statusLine(profile)}\n\n### Level ${info.level} / ${MAX_LEVEL}\n` +
                `\`${progressBar(info.progress, 18)}\` **${pct(info.progress)}%** to level ${info.level + 1}`,
        )
        .addFields(
            { name: 'Total XP', value: fmt(info.xp), inline: true },
            { name: 'This level', value: `${fmt(info.xp - info.floor)} / ${fmt(info.next - info.floor)}`, inline: true },
            { name: 'Remaining', value: `${fmt(info.remaining)} xp`, inline: true },
        );
    return embed;
}

// page: 'overview' or 'skill:<key>'
export function renderPlayerPage(profile, page) {
    if (page.startsWith('skill:')) return skillPage(profile, page.slice(6));
    return overviewPage(profile);
}

export function formatDuration(seconds) {
    seconds = Math.floor(seconds);
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d) return `${d}d ${h}h ${m}m`;
    if (h) return `${h}h ${m}m`;
    return `${m}m`;
}

const STATUS_LABEL = {
    online: '🟢 Online',
    starting: '🟡 Starting up',
    offline: '🔴 Offline',
    unknown: '⚪ Checking…',
};

export function statusEmbed(state) {
    const count = state.players.length;
    const embed = new EmbedBuilder()
        .setColor(COLOR[state.status] || COLOR.info)
        .setTitle(`🐉 ${config.serverName}`)
        .setDescription(`### ${STATUS_LABEL[state.status]}`)
        .setTimestamp(state.updatedAt ? new Date(state.updatedAt) : null);

    if (state.status === 'online') {
        embed.addFields({
            name: '👥 Players',
            value: config.maxPlayers ? `**${count}** / ${config.maxPlayers}` : `**${count}**`,
            inline: true,
        });
    }
    if (state.health) {
        // The mod starts with the server process, so its uptime is the server's.
        embed.addFields(
            { name: '⏱️ Uptime', value: formatDuration(state.health.uptimeSeconds || 0), inline: true },
            { name: '🧩 Mod', value: `v${state.health.version || '?'}`, inline: true },
        );
    }
    if (count) {
        const names = state.players.slice(0, 10).map(p => `• ${displayName(p)}`);
        if (count > 10) names.push(`…and ${count - 10} more`);
        embed.addFields({ name: 'Online now', value: names.join('\n') });
    }
    if (state.status === 'offline') {
        embed.addFields({ name: '​', value: 'Levels of players seen before are still available with `/levels`.' });
    }
    return embed;
}

export const ONLINE_PAGE_SIZE = 10;

export function onlineEmbed(players, page) {
    const pages = Math.max(1, Math.ceil(players.length / ONLINE_PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);
    const max = config.maxPlayers ? ` / ${config.maxPlayers}` : '';

    const slice = players.slice(page * ONLINE_PAGE_SIZE, (page + 1) * ONLINE_PAGE_SIZE);
    const lines = slice.map((p, i) => {
        const n = page * ONLINE_PAGE_SIZE + i + 1;
        return `\`${String(n).padStart(2)}\` **${displayName(p)}** · ${p.pingMs ?? '?'} ms`;
    });

    const embed = new EmbedBuilder()
        .setColor(players.length ? COLOR.online : COLOR.offline)
        .setTitle(`👥 Online players — ${players.length}${max}`)
        .setDescription(lines.join('\n') || 'Nobody is online right now.')
        .setTimestamp();
    if (pages > 1) embed.setFooter({ text: `Page ${page + 1}/${pages}  ·  ◀️ ▶️ to change page` });
    return embed;
}

// ---- leaderboard --------------------------------------------------------

export const LEADERBOARD_PAGE_SIZE = 10;
const MEDALS = ['🥇', '🥈', '🥉'];

// rows: [{ player, online, level, xp }] sorted best first. skill: null for total level.
export function leaderboardEmbed(rows, skill, page) {
    const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);

    const lines = rows.slice(page * LEADERBOARD_PAGE_SIZE, (page + 1) * LEADERBOARD_PAGE_SIZE).map((r, i) => {
        const rank = page * LEADERBOARD_PAGE_SIZE + i;
        const place = MEDALS[rank] || `\`${String(rank + 1).padStart(2)}.\``;
        const level = skill ? `Level **${r.level}**${r.level >= MAX_LEVEL ? ' ⭐' : ''}` : `Total **${fmt(r.level)}**`;
        return `${place} **${displayName(r.player)}**${r.online ? ' 🟢' : ''}\n　${level} · ${fmt(r.xp)} xp`;
    });

    const embed = new EmbedBuilder()
        .setColor(skill ? skill.category.color : 0xf1c40f)
        .setTitle(skill ? `${skill.emoji} ${skill.name} leaderboard` : '🏆 Total level leaderboard')
        .setDescription(lines.join('\n') || (skill ? `Nobody has ${skill.name} XP yet.` : 'No player stats saved yet.'))
        .setFooter({
            text:
                (pages > 1 ? `Page ${page + 1}/${pages}  ·  ◀️ ▶️ to change page  ·  ` : '') +
                '🟢 online now, others as last seen',
        })
        .setTimestamp();
    if (skill?.icon) embed.setThumbnail(skill.icon);
    return embed;
}

// ---- gains, playtime, deaths, weekly recap -------------------------------

const place = i => MEDALS[i] || `\`${String(i + 1).padStart(2)}.\``;
const prettyDay = day => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const duration = seconds => (seconds < 60 ? `${Math.round(seconds)}s` : formatDuration(seconds));
const PERIOD_LABEL = { today: 'today', week: 'this week', month: 'this month' };

export function gainsEmbed(name, period, g) {
    const label = PERIOD_LABEL[period];
    const embed = new EmbedBuilder().setColor(COLOR.online).setAuthor({ name }).setTitle(`📈 XP gained ${label}`).setTimestamp();
    if (!g?.total) return embed.setColor(COLOR.offline).setDescription(`No XP gained ${label}.`);

    const lines = g.skills.map(
        s => `${s.emoji} **${s.name}** +${fmt(s.gained)} xp${s.info.level > s.fromLevel ? ` · ${s.fromLevel} → **${s.info.level}**` : ''}`,
    );
    const levels = g.levels ? ` · +${g.levels} level${g.levels === 1 ? '' : 's'}` : '';
    return embed.setDescription(`### +${fmt(g.total)} xp${levels}\n${lines.join('\n')}`).setFooter({ text: `Since ${prettyDay(g.since)}` });
}

export function gainersEmbed(rows, period) {
    const label = PERIOD_LABEL[period];
    const lines = rows.slice(0, 10).map((r, i) => `${place(i)} **${r.name}** +${fmt(r.total)} xp · best ${r.skills[0].emoji} ${r.skills[0].name}`);
    return new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(`📈 Top XP gainers ${label}`)
        .setDescription(lines.join('\n') || `Nobody has gained XP ${label} yet.`)
        .setFooter({ text: '/gains player shows one player skill by skill' })
        .setTimestamp();
}

export function playtimeEmbed(name, pt) {
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setAuthor({ name })
        .setTitle('⏱️ Playtime')
        .addFields(
            { name: 'Today', value: duration(pt.today), inline: true },
            { name: 'This week', value: duration(pt.week), inline: true },
            { name: 'Total', value: duration(pt.total), inline: true },
        )
        .setFooter({ text: 'Counted while the bot is running' })
        .setTimestamp();
}

export function playtimeBoardEmbed(rows) {
    const lines = rows.slice(0, 10).map((r, i) => `${place(i)} **${r.name}** ${duration(r.recent)} · ${duration(r.total)} total`);
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle('⏱️ Most played this week')
        .setDescription(lines.join('\n') || 'Nobody has played this week yet.')
        .setTimestamp();
}

export function deathsEmbed(name, d) {
    return new EmbedBuilder()
        .setColor(0x8b0000)
        .setAuthor({ name })
        .setTitle('💀 Deaths')
        .addFields({ name: 'This week', value: String(d.week), inline: true }, { name: 'Total', value: String(d.total), inline: true })
        .setTimestamp();
}

export function deathBoardEmbed(rows) {
    const lines = rows.slice(0, 10).map((r, i) => `${place(i)} **${r.name}** ${r.recent} this week · ${r.total} total`);
    return new EmbedBuilder()
        .setColor(0x8b0000)
        .setTitle('💀 Deaths')
        .setDescription(lines.join('\n') || 'Nobody has died yet. Impressive.')
        .setTimestamp();
}

export function summaryEmbed({ gainers, milestones, played, deaths }) {
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`📅 Weekly recap · ${config.serverName}`).setTimestamp();
    const top = gainers.slice(0, 5).map((r, i) => `${place(i)} **${r.name}** +${fmt(r.total)} xp`);
    embed.addFields({ name: '📈 Top XP gainers', value: top.join('\n') || 'Nobody gained XP this week.' });
    if (milestones.length) {
        embed.addFields({ name: '⭐ New 99s', value: milestones.map(m => `**${m.name}** · ${m.skill}`).join('\n').slice(0, 1024) });
    }
    if (played.length) {
        embed.addFields({ name: '⏱️ Most played', value: played.slice(0, 3).map((r, i) => `${place(i)} **${r.name}** ${duration(r.recent)}`).join('\n'), inline: true });
    }
    const died = deaths.filter(r => r.recent > 0);
    if (died.length) {
        const total = died.reduce((n, r) => n + r.recent, 0);
        embed.addFields({ name: '💀 Deaths', value: `${total} this week\nMost: **${died[0].name}** (${died[0].recent})`, inline: true });
    }
    return embed;
}

// ---- admin --------------------------------------------------------------

export function bansEmbed(bans) {
    const lines = bans.slice(0, 25).map(b => `• **${b.name || 'unknown'}** \`${b.netId}\`${b.reason ? ` · ${b.reason}` : ''}`);
    if (bans.length > 25) lines.push(`…and ${bans.length - 25} more`);
    return new EmbedBuilder().setColor(COLOR.error).setTitle(`🔨 Bans — ${bans.length}`).setDescription(lines.join('\n') || 'Nobody is banned.');
}

export function diagnosticsEmbed(diag) {
    const icon = ok => (ok === true ? '✅' : ok === false ? '❌' : '⏳');
    const lines = diag.checks.map(c => `${icon(c.ok)} **${c.name}** · ${c.detail}`);
    const failing = diag.checks.filter(c => c.ok === false).length;
    return new EmbedBuilder()
        .setColor(failing ? COLOR.error : COLOR.online)
        .setTitle(`🩺 Mod diagnostics · v${diag.version}`)
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: failing ? `${failing} problem(s) · ⏳ = checked once someone is online` : '⏳ = checked once someone is online' })
        .setTimestamp();
}

// ---- system -------------------------------------------------------------

function bytes(n) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(i && n < 10 ? 1 : 0)} ${units[i]}`;
}

function bitrate(bytesPerSecond) {
    const bits = bytesPerSecond * 8;
    if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbit/s`;
    if (bits >= 1e6) return `${(bits / 1e6).toFixed(1)} Mbit/s`;
    return `${Math.round(bits / 1e3)} kbit/s`;
}

const usageLine = (used, total) =>
    `\`${progressBar(used / total, 12)}\` **${pct(used / total)}%**\n${bytes(used)} / ${bytes(total)}`;

export function systemEmbed(s) {
    const { cpu, memory, disk, network } = s;
    const embed = new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🖥️ VPS · ${s.hostname}`)
        .addFields(
            {
                name: '⚙️ CPU',
                value: `\`${progressBar(cpu.usage, 12)}\` **${pct(cpu.usage)}%**\n${cpu.cores} cores · load ${cpu.load.map(l => l.toFixed(2)).join(' / ')}`,
                inline: true,
            },
            { name: '🧠 RAM', value: usageLine(memory.used, memory.total), inline: true },
        )
        .setFooter({ text: `VPS up ${formatDuration(s.uptimeSeconds)}` })
        .setTimestamp();

    if (memory.swapTotal) embed.addFields({ name: '🔁 Swap', value: usageLine(memory.swapUsed, memory.swapTotal), inline: true });
    if (disk) embed.addFields({ name: '💾 Disk', value: usageLine(disk.used, disk.total), inline: true });
    embed.addFields({
        name: '🌐 Network',
        value:
            `⬇️ **${bitrate(network.rxRate)}** · ⬆️ **${bitrate(network.txRate)}**\n` +
            `Since boot: ⬇️ ${bytes(network.rxTotal)} · ⬆️ ${bytes(network.txTotal)}`,
        inline: true,
    });
    return embed;
}

// ---- misc ---------------------------------------------------------------

export function ambiguousEmbed(query, players) {
    const names = players.slice(0, 15).map(p => `• ${displayName(p)}`).join('\n');
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🔎 Several players match "${query}"`)
        .setDescription(`${names}\n\nTry the full name.`);
}

export function okEmbed(text) {
    return new EmbedBuilder().setColor(COLOR.online).setDescription(`✅ ${text}`);
}

export function errorEmbed(text) {
    return new EmbedBuilder().setColor(COLOR.error).setDescription(`❌ ${text}`);
}

export function helpEmbed() {
    const embed = new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🐉 ${config.serverName} — Commands`)
        .setDescription('Type `/` and pick a command. Player and skill names fill in as you type.')
        .addFields(
            { name: '/levels', value: 'Every skill for a player, total level and max health.' },
            { name: '/level', value: 'One skill in detail for a player, with a progress bar.' },
            { name: '/leaderboard', value: 'Top players by total level, or by one skill if you pick it.' },
            { name: '/status', value: 'Is the server up, and who is on it.' },
            { name: '/online', value: 'Everyone connected right now, with ping.' },
            { name: '/gains', value: 'Who gained the most XP, or one player skill by skill. Today, this week or this month.' },
            { name: '/playtime · /deaths', value: 'Most played and most deaths, or one player.' },
            { name: '/system', value: "The VPS's CPU, RAM, disk and network use right now." },
        )
        .setFooter({ text: 'Players can be looked up by character or account name, even while offline.' });

    if (config.bridgeToGame && config.chatChannelId) {
        embed.addFields({ name: '💬 Talk to players', value: `Messages in <#${config.chatChannelId}> are shown in game chat.` });
    }
    if (config.adminUserIds.length) {
        embed.addFields({ name: '🛡️ Admins', value: '`/server` start, stop, restart, back up · `/admin` kick, ban, give, say, remove from leaderboards, diagnostics' });
    }
    return embed;
}

// ---- server notices -----------------------------------------------------

const NOTICE = {
    online: [COLOR.online, '🟢 Server is online'],
    offline: [COLOR.error, '🔴 Server is offline'],
    restarting: [0xe67e22, '🔄 Server is restarting'],
    restarted: [0xe67e22, '🔄 Server restarted'],
    restart: [0xe67e22, '🔄 Server restart'],
    stop: [COLOR.error, '⛔ Server shutting down'],
    backup: [COLOR.info, '💾 Backup in progress'],
    'backup-done': [COLOR.info, '💾 Backup complete'],
    say: [COLOR.info, '📢 Announcement'],
};

export const NOTICE_KINDS = Object.keys(NOTICE);

// after: the kind of the planned notice this follows, if any (restart, stop, backup).
export function noticeEmbed(kind, { minutes = 0, message = '', downtimeMs = 0, after = '' } = {}) {
    const [color, title] = NOTICE[kind];
    const lines = [];

    if (kind === 'restart' || kind === 'stop') {
        lines.push(minutes ? `In **${minutes} minute${minutes === 1 ? '' : 's'}** · ${relative(Date.now() + minutes * 60000)}` : '**Now**');
    }
    if (kind === 'online') {
        lines.push(after === 'restart' ? 'Restart complete, come on back in!' : 'Ready to join.');
        if (downtimeMs >= 60000) lines.push(`Down for ${formatDuration(downtimeMs / 1000)}.`);
    }
    if (kind === 'offline') lines.push('The server stopped responding.');
    if (kind === 'restarting') lines.push('It should be back in a few minutes.');
    if (kind === 'restarted') lines.push('The server restarted and is back online.');
    if (message) lines.push(message);

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(lines.join('\n') || null)
        .setFooter({ text: config.serverName })
        .setTimestamp();
}
