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

export const PLAYER_NAV = [
    { emoji: '📊', page: 'overview', label: 'Overview' },
    ...CATEGORIES.filter(c => c.id !== 'other').map(c => ({ emoji: c.emoji, page: c.id, label: c.name })),
    { emoji: '🔄', page: 'refresh', label: 'Refresh' },
];
const NAV_HINT = PLAYER_NAV.map(n => `${n.emoji} ${n.label}`).join('  ');

function statusLine(profile) {
    if (profile.online) return '🟢 **Online now**';
    return profile.lastSeen ? `⚫ **Offline** · last seen ${relative(profile.lastSeen)}` : '⚫ **Offline**';
}

function playerEmbed(profile, color) {
    return new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: displayName(profile.player) })
        .setFooter({ text: NAV_HINT })
        .setTimestamp(new Date(profile.fetchedAt));
}

function progressText(s) {
    if (s.info.maxed) return `\`${progressBar(1)}\` **MAX** ⭐\n${fmt(s.xp)} xp`;
    return (
        `\`${progressBar(s.info.progress)}\` **${pct(s.info.progress)}%**\n` +
        `${fmt(s.xp)} xp · ${fmt(s.info.remaining)} to level ${s.info.level + 1}`
    );
}

function overviewPage(profile) {
    const embed = playerEmbed(profile, profile.online ? COLOR.online : COLOR.offline).setTitle('📊 Skills overview');

    const lines = [statusLine(profile), ''];
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
            value: skills.map(s => `\`${String(s.info.level).padStart(2)}\` ${s.emoji} ${s.name}`).join('\n'),
            inline: true,
        });
    }
    return embed;
}

function categoryPage(profile, categoryId) {
    const category = CATEGORIES.find(c => c.id === categoryId);
    const skills = profile.skills.filter(s => s.category.id === categoryId);
    const embed = playerEmbed(profile, category.color).setTitle(`${category.emoji} ${category.name}`);

    if (!skills.length) return embed.setDescription(`${statusLine(profile)}\n\nNo ${category.name.toLowerCase()} skills yet.`);

    const levels = skills.reduce((sum, s) => sum + s.info.level, 0);
    embed.setDescription(`${statusLine(profile)}\n\n**${category.name} levels** \`${levels}\``);
    if (skills[0].icon) embed.setThumbnail(skills[0].icon);

    for (const s of skills) {
        embed.addFields({ name: `${s.emoji} ${s.name} — Level ${s.info.level}`, value: progressText(s) });
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

export function renderPlayerPage(profile, page) {
    if (page === 'overview') return overviewPage(profile);
    if (page.startsWith('skill:')) return skillPage(profile, page.slice(6));
    return categoryPage(profile, page);
}

// ---- server pages -------------------------------------------------------

function formatDuration(seconds) {
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
        .setFooter({ text: '🔄 Refresh' })
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
        embed.addFields({ name: '​', value: 'Levels of players seen before are still available with `' + config.prefix + 'levels`.' });
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

    return new EmbedBuilder()
        .setColor(players.length ? COLOR.online : COLOR.offline)
        .setTitle(`👥 Online players — ${players.length}${max}`)
        .setDescription(lines.join('\n') || 'Nobody is online right now.')
        .setFooter({ text: pages > 1 ? `Page ${page + 1}/${pages}  ·  ◀️ ▶️ Page  🔄 Refresh` : '🔄 Refresh' })
        .setTimestamp();
}

// ---- misc ---------------------------------------------------------------

export function ambiguousEmbed(query, players) {
    const names = players.slice(0, 15).map(p => `• ${displayName(p)}`).join('\n');
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🔎 Several players match "${query}"`)
        .setDescription(`${names}\n\nTry the full name.`);
}

export function errorEmbed(text) {
    return new EmbedBuilder().setColor(COLOR.error).setDescription(`❌ ${text}`);
}

export function helpEmbed(prefix) {
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🐉 ${config.serverName} — Commands`)
        .addFields(
            { name: `${prefix}levels <player>`, value: 'Skill overview, with reactions to open each category.' },
            { name: `${prefix}level <skill> <player>`, value: `One skill in detail. Short names work: \`wc\`, \`rc\`, \`mage\`, \`agi\`…` },
            { name: `${prefix}status`, value: 'Is the server up, and who is on it.' },
            { name: `${prefix}online`, value: 'Everyone connected right now, with ping.' },
        )
        .setFooter({ text: 'Players can be looked up by character or account name, even while offline.' });
}
