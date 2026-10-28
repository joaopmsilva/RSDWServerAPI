import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from 'discord.js';
import { config } from './config.js';
import { MAX_LEVEL } from './levels.js';
import { clock, eventName, journalKinds, outOf, perkName, questName, questStats } from './progress.js';
import { CATEGORIES, catalogSkill } from './skills.js';
import { wikiSearchUrl } from './wiki.js';

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
    const quests = questStats(profile.player);
    const journal = profile.player.journal;
    const extra = [];
    if (quests) extra.push(`📜 **Quests** \`${quests.done}${outOf(quests.done, 'quests')}\``);
    if (journal?.total) extra.push(`📖 **Journal** \`${fmt(journal.total)}${outOf(journal.total, 'journal')}\``);
    if (extra.length) lines.push(extra.join('  ·  '));
    embed.setDescription(lines.join('\n'));
    embed.setFooter({ text: `✨ /perks shows ${profile.player.characterName || profile.player.name || 'their'}'s skill perks` });

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

// /status: the status board without the banner and today's top XP.
export function statusEmbed(state) {
    return boardEmbed({ state, gainers: [], vps: null, compact: true }).setTimestamp(state.updatedAt ? new Date(state.updatedAt) : null);
}

// ---- leaderboard --------------------------------------------------------

export const LEADERBOARD_PAGE_SIZE = 10;
// 🥇🥈🥉 then keycaps to 🔟, so a board reads as one column; bold numbers after that.
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const rankBadge = i => MEDALS[i] || `**${i + 1}.**`;

// rows: [{ player, online, level, xp }] sorted best first. skill: null for total level.
export function leaderboardEmbed(rows, skill, page) {
    const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);

    const lines = rows.slice(page * LEADERBOARD_PAGE_SIZE, (page + 1) * LEADERBOARD_PAGE_SIZE).map((r, i) => {
        const rank = page * LEADERBOARD_PAGE_SIZE + i;
        const place = rankBadge(rank);
        const level = skill ? `Level **${r.level}**${r.level >= MAX_LEVEL ? ' ⭐' : ''}` : `Total **${fmt(r.level)}**`;
        const quests = !skill && r.quests !== undefined ? ` · 📜 ${r.quests}` : '';
        return `${place} **${displayName(r.player)}**${r.online ? ' 🟢' : ''}\n　${level} · ${fmt(r.xp)} xp${quests}`;
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

// rows: [{ player, online, done, main }] sorted best first.
export function questLeaderboardEmbed(rows, page) {
    const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);
    const lines = rows.slice(page * LEADERBOARD_PAGE_SIZE, (page + 1) * LEADERBOARD_PAGE_SIZE).map((r, i) => {
        const rank = page * LEADERBOARD_PAGE_SIZE + i;
        const place = rankBadge(rank);
        const main = r.main ? ` · ${r.main} main` : '';
        return `${place} **${displayName(r.player)}**${r.online ? ' 🟢' : ''}\n　**${r.done}** quest${r.done === 1 ? '' : 's'}${main}`;
    });
    return new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle('📜 Quest leaderboard')
        .setDescription(lines.join('\n') || 'No quests recorded yet - they show up once players have been online with mod 0.6.0.')
        .setFooter({
            text: (pages > 1 ? `Page ${page + 1}/${pages}  ·  ◀️ ▶️ to change page  ·  ` : '') + '🟢 online now, others as last seen',
        })
        .setTimestamp();
}

// ---- perks and /me --------------------------------------------------------

const skillOf = id => catalogSkill(String(id || '').replace(/^SKILL_/i, ''));

export function perksEmbed(profile) {
    const perks = profile.player.perks;
    const embed = playerEmbed(profile, 0xf39c12).setTitle('✨ Skill perks');
    if (!perks) return embed.setDescription('No perk data yet - perks show up once they have been online with mod 0.6.0.');
    if (!perks.active?.length) return embed.setDescription('No skill perks active.');

    const bySkill = new Map();
    for (const perk of perks.active) {
        if (!bySkill.has(perk.skill)) bySkill.set(perk.skill, []);
        bySkill.get(perk.skill).push(perk);
    }
    for (const [id, list] of bySkill) {
        const skill = skillOf(id);
        embed.addFields({
            name: skill ? `${skill.emoji} ${skill.name}` : '📘 Other',
            value: list.map(p => `**${perkName(p)}**${p.description ? `\n-# ${p.description}` : ''}`).join('\n').slice(0, 1024),
        });
    }
    // The game reports 99 when there's no real limit.
    const max = perks.max > 0 && perks.max < 50 ? ` of ${perks.max} slots` : '';
    return embed.setFooter({ text: `${perks.active.length} active${max}` });
}

// /quests player: everything done, by kind, and what's in progress.
export function questsEmbed(profile) {
    const embed = playerEmbed(profile, 0x9b59b6).setTitle('📜 Quests');
    const quests = questStats(profile.player);
    if (!quests) return embed.setDescription('No quest data yet - quests show up once they have been online with mod 0.6.0.');
    if (!quests.done && !quests.active.length) return embed.setDescription('No quests started yet.');

    const list = (items, max = 15) => {
        const names = items.slice(0, max).map(q => `• ${questName(q)}`);
        if (items.length > max) names.push(`…and ${items.length - max} more`);
        return names.join('\n').slice(0, 1024);
    };
    const split = [quests.main && `${quests.main} main`, quests.side && `${quests.side} side`, quests.tasks && `${quests.tasks} tasks`].filter(Boolean);
    embed.setDescription(`### ${quests.done}${outOf(quests.done, 'quests')} done${split.length ? `\n${split.join(' · ')}` : ''}`);
    if (quests.active.length) embed.addFields({ name: `🧭 In progress · ${quests.active.length}`, value: list(quests.active, 10) });
    for (const [kind, title] of [['main', '⭐ Main quests'], ['side', '📜 Side quests'], ['task', '📋 Tasks']]) {
        const done = quests.completed.filter(q => q.kind === kind);
        if (done.length) embed.addFields({ name: `${title} · ${done.length}`, value: list(done), inline: true });
    }
    return embed.setFooter({ text: '/leaderboard quests ranks everyone by quests done' });
}

// The second card of /me: quests, journal, playtime and deaths.
export function progressEmbed(profile, { playtime, deaths, kills }) {
    const embed = playerEmbed(profile, 0x9b59b6).setTitle('📜 Progress');
    const quests = questStats(profile.player);
    if (quests) {
        const split = [quests.main && `${quests.main} main`, quests.side && `${quests.side} side`, quests.tasks && `${quests.tasks} tasks`].filter(Boolean);
        embed.addFields({ name: '📜 Quests done', value: `**${quests.done}${outOf(quests.done, 'quests')}**${split.length ? `\n${split.join(' · ')}` : ''}`, inline: true });
        if (quests.active.length) {
            const names = quests.active.slice(0, 6).map(q => `• ${questName(q)}`);
            if (quests.active.length > 6) names.push(`…and ${quests.active.length - 6} more · \`/quests\``);
            embed.addFields({ name: `🧭 In progress · ${quests.active.length}`, value: names.join('\n').slice(0, 1024), inline: true });
        }
    }
    const kinds = journalKinds(profile.player.journal);
    if (kinds.length) {
        embed.addFields({ name: `📖 Journal · ${fmt(profile.player.journal.total)}${outOf(profile.player.journal.total, 'journal')}`, value: kinds.map(k => `${k.emoji} ${k.name} **${k.count}**`).join('  ·  ') });
    }
    if (playtime) {
        embed.addFields({ name: '⏱️ Played', value: `${duration(playtime.week)} this week\n${duration(playtime.total)} in total`, inline: true });
    }
    if (kills?.total) embed.addFields({ name: '⚔️ Kills', value: `${fmt(kills.week)} this week\n${fmt(kills.total)} in total`, inline: true });
    if (deaths) embed.addFields({ name: '💀 Deaths', value: `${deaths.week} this week\n${deaths.total} in total`, inline: true });
    if (!embed.data.fields?.length) embed.setDescription('Nothing recorded yet.');
    return embed;
}

// ---- account links ----------------------------------------------------------

export function linkCodeEmbed(code, minutes, current) {
    const now = current ? `\n\nYou're linked to **${escapeMarkdown(current.name)}** now - using a code moves the link to that character.` : '';
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle('🔗 Link your character')
        .setDescription(
            `In game, open chat and type:\n## \`/link ${code}\`\n` +
                `The code works once, for ${minutes} minutes. This message updates when it's done.${now}`,
        );
}

// The card pinned in LINK_CHANNEL_ID.
export function linkHowToEmbed() {
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle('🔗 Link your Discord to your character')
        .setDescription(
            'Linking lets `/me` and `/quests` show your own character, and the bot can **DM you when you’re being hunted** or **a raid starts** - if you want it to.',
        )
        .addFields(
            { name: '1️⃣ Press the button', value: 'Press **🔗 Link my character** below. You get a short code only you can see.' },
            { name: '2️⃣ Type it in game', value: 'In the game chat, type **`/link CODE`**. Nobody else sees it.' },
            { name: '3️⃣ Done', value: 'The bot confirms in game and here. **👤 My character** shows your stats.' },
            { name: '🔔 Raid and hunt alerts', value: 'Off until you turn them on with **🔔 Alerts**. They come by DM, and you can turn them off right from the DM.' },
        )
        .setFooter({ text: 'Codes work once, for 10 minutes · /link, /me, /alerts and /unlink work anywhere too' });
}

// The buttons on that card; index.js handles the presses.
export function linkButtons() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('link:start').setLabel('Link my character').setEmoji('🔗').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('link:me').setLabel('My character').setEmoji('👤').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('link:alerts').setLabel('Alerts').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('link:unlink').setLabel('Unlink').setStyle(ButtonStyle.Danger),
        ),
    ];
}

export function linkedEmbed(name) {
    return new EmbedBuilder()
        .setColor(COLOR.online)
        .setTitle(`✅ Linked to ${name}`)
        .setDescription('Try `/me` and `/quests`.');
}

// The DM sent once after linking, above alertsEmbed().
export function welcomeEmbed(name) {
    return new EmbedBuilder()
        .setColor(COLOR.online)
        .setTitle(`👋 You're linked to ${name}`)
        .setDescription(
            [
                '`/me` and `/quests` now show your own character, wherever you use them.',
                '',
                'I can also message you here when a **raid** starts or something is **hunting** you. Both are **off** - turn them on below. Every alert comes with these buttons, so you can switch it off from the alert itself.',
            ].join('\n'),
        );
}

// Which raid / hunt DMs a linked player gets; shown with alertButtons().
export function alertsEmbed(link) {
    const on = kind => (link?.alerts?.[kind] ? '🟢 **On**' : '⚫ **Off**');
    return new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🔔 Alerts by DM')
        .setDescription('The bot can message you when something happens to your character. Press a button to turn one on or off - you can always change it here, with `/alerts`, or from the alert itself.')
        .addFields(
            { name: '⚔️ Raids', value: `${on('raid')}\nA raid starts near you - or anywhere, while you're online and nobody is close.`, inline: true },
            { name: '🎯 Hunts', value: `${on('hunted')}\nSomething is hunting you.`, inline: true },
        );
}

export function alertButtons(link) {
    const button = (kind, label, emoji) => {
        const on = Boolean(link?.alerts?.[kind]);
        return new ButtonBuilder()
            .setCustomId(`alerts:${kind}`)
            .setLabel(`${label}: ${on ? 'On' : 'Off'}`)
            .setEmoji(emoji)
            .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
    };
    return [new ActionRowBuilder().addComponents(button('raid', 'Raid alerts', '⚔️'), button('hunted', 'Hunt alerts', '🎯'))];
}

export function linkInfoEmbed(link) {
    if (!link) return new EmbedBuilder().setColor(COLOR.offline).setDescription("🔗 You haven't linked a character yet - use `/link`.");
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setDescription(`🔗 Linked to **${escapeMarkdown(link.name)}** since ${relative(link.at)}.`);
}

// ---- world events ------------------------------------------------------------

const names = players => players.map(p => `**${escapeMarkdown(p.characterName || p.name)}**`).join(', ');

// event: from /api/world. players: who it concerns. over: it has ended.
export function eventEmbed(event, players, { over = false, startedAt = 0 } = {}) {
    const hunted = event.type === 'hunted';
    const what = eventName(event.name);
    const embed = new EmbedBuilder().setTimestamp();
    if (over) {
        const lasted = startedAt ? ` · lasted ${formatDuration((Date.now() - startedAt) / 1000)}` : '';
        return embed
            .setColor(COLOR.offline)
            .setTitle(hunted ? '✅ The hunt is over' : `✅ Raid over${what ? ` · ${what}` : ''}`)
            .setDescription(`${players.length ? `${names(players)} made it through.` : 'It has ended.'}${lasted}`);
    }
    if (hunted) {
        return embed
            .setColor(0x8e44ad)
            .setTitle(`🎯 Hunted!${what ? ` · ${what}` : ''}`)
            .setDescription(players.length ? `${names(players)} is being hunted - watch your back!` : 'Someone is being hunted!');
    }
    return embed
        .setColor(COLOR.error)
        .setTitle(`⚔️ Raid!${what ? ` · ${what}` : ''}`)
        .setDescription(players.length ? `${names(players)} ${players.length === 1 ? 'is' : 'are'} under attack - go help!` : 'A base is under attack - anyone online, go help!');
}

// ---- live activity -------------------------------------------------------

const onlineCount = count => (count >= 0 ? `👥 ${count}${config.maxPlayers ? `/${config.maxPlayers}` : ''} online` : null);

// u: { name, skill, from, totalLevel } from the activity tracker.
export function levelUpEmbed(u) {
    const s = u.skill;
    const lines = [`**${escapeMarkdown(u.name)}** reached **${s.name} ${s.info.level}**`];
    if (s.info.level - u.from > 1) lines.push(`${u.from} → ${s.info.level} · +${s.info.level - u.from} levels`);

    const embed = new EmbedBuilder()
        .setColor(s.category.color)
        .setAuthor({ name: `${s.emoji} Level up!` })
        .setDescription(lines.join('\n'))
        .setFooter({ text: `Total level ${fmt(u.totalLevel)}` })
        .setTimestamp();
    if (s.icon) embed.setThumbnail(s.icon);
    return embed;
}

export function maxedEmbed(u) {
    const s = u.skill;
    const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setAuthor({ name: '⭐ Level 99' })
        .setTitle(`${u.name} mastered ${s.name}!`)
        .setDescription(`${s.emoji} The highest level there is - congratulations!\n\`${progressBar(1, 14)}\` **MAX**`)
        .setFooter({ text: `Total level ${fmt(u.totalLevel)}` })
        .setTimestamp();
    if (s.icon) embed.setThumbnail(s.icon);
    return embed;
}

export function joinEmbed(name, count) {
    const embed = new EmbedBuilder().setColor(COLOR.online).setDescription(`➡️ **${escapeMarkdown(name)}** joined the server`).setTimestamp();
    const footer = onlineCount(count);
    if (footer) embed.setFooter({ text: footer });
    return embed;
}

// afk: they left because the mod kicked them for being AFK.
export function leaveEmbed(name, count, playedSeconds, afk = false) {
    const played = playedSeconds >= 60 ? ` · played ${formatDuration(playedSeconds)}` : '';
    const text = afk ? `💤 **${escapeMarkdown(name)}** was kicked for being AFK${played}` : `⬅️ **${escapeMarkdown(name)}** left${played}`;
    const embed = new EmbedBuilder().setColor(afk ? 0xe67e22 : COLOR.offline).setDescription(text).setTimestamp();
    const footer = onlineCount(count);
    if (footer) embed.setFooter({ text: footer });
    return embed;
}

export function afkEmbed(name) {
    return new EmbedBuilder().setColor(0xe67e22).setDescription(`💤 **${escapeMarkdown(name)}** was kicked for being AFK`).setTimestamp();
}

// ---- gains, playtime, deaths, weekly recap -------------------------------

const place = rankBadge;
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

export function killsEmbed(name, k, creatureTypes) {
    const embed = new EmbedBuilder()
        .setColor(0xc0392b)
        .setAuthor({ name })
        .setTitle('⚔️ Kills')
        .addFields(
            { name: 'Today', value: fmt(k.today), inline: true },
            { name: 'This week', value: fmt(k.week), inline: true },
            { name: 'Total', value: fmt(k.total), inline: true },
        )
        .setTimestamp();
    if (k.creatures.length) {
        embed.addFields({
            name: '🐾 Most killed',
            value: k.creatures.slice(0, 8).map(([c, n], i) => `${place(i)} **${escapeMarkdown(c)}** ${fmt(n)}`).join('\n'),
        });
    }
    if (creatureTypes >= 0) embed.setFooter({ text: `${creatureTypes} kinds of creature defeated in all` });
    if (!k.total) embed.setDescription('No kills counted yet - they count from mod 0.7.0 on.');
    return embed;
}

export function killBoardEmbed(rows, page = 0) {
    const pages = Math.max(1, Math.ceil(rows.length / LEADERBOARD_PAGE_SIZE));
    page = Math.min(Math.max(0, page), pages - 1);
    const lines = rows
        .slice(page * LEADERBOARD_PAGE_SIZE, (page + 1) * LEADERBOARD_PAGE_SIZE)
        .map((r, i) => `${place(page * LEADERBOARD_PAGE_SIZE + i)} **${r.name}** ${fmt(r.total)} kill${r.total === 1 ? "" : "s"}${r.recent ? ` · ${fmt(r.recent)} this week` : ''}`);
    return new EmbedBuilder()
        .setColor(0xc0392b)
        .setTitle('⚔️ Kill leaderboard')
        .setDescription(lines.join('\n') || 'No kills counted yet - they count from mod 0.7.0 on.')
        .setFooter({ text: (pages > 1 ? `Page ${page + 1}/${pages}  ·  ◀️ ▶️ to change page  ·  ` : '') + 'Creatures killed, all time' })
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

// ---- status board -------------------------------------------------------

// The game's icon, from the wiki, next to the server name.
const ICON_URL = 'https://dragonwilds.runescape.wiki/images/RuneScape_Dragonwilds_%28Steam_edition%29_icon.jpg';

// The status board and /status (compact: without today's top XP).
export function boardEmbed({ state, gainers, vps, compact = false }) {
    const count = state.players.length;
    const online = state.status === 'online';
    const headline = {
        online: '🟢 Online',
        starting: '🟡 Starting up',
        offline: '🔴 Offline',
        unknown: '⚪ Checking…',
    }[state.status];
    const summary = {
        online: `**${count}**${config.maxPlayers ? ` of ${config.maxPlayers}` : ''} player${count === 1 && !config.maxPlayers ? '' : 's'} on right now`,
        starting: 'Loading the world - ready in a minute or two.',
        offline: "Down right now - it's usually back within a few minutes.",
    }[state.status];

    const embed = new EmbedBuilder()
        .setColor(COLOR[state.status] || COLOR.info)
        .setAuthor({ name: config.serverName, iconURL: ICON_URL })
        .setDescription(`## ${headline}${summary ? `\n${summary}` : ''}`)
        .setFooter({ text: `${state.health ? `Mod v${state.health.version || '?'} · ` : ''}/help for commands` })
        .setTimestamp();

    const join = [];
    if (config.connectAddress) join.push(`🌐 **Direct connect**  \`${config.connectAddress}\``);
    const worldName = config.worldName || state.world?.worldName;
    if (worldName) {
        const creator = config.worldCreator || state.world?.host;
        join.push(`🗺️ **Server list**  ${worldName}${creator ? ` by ${creator}` : ''}`);
    }
    if (config.serverPassword) join.push(`🔑 **Password**  ||${config.serverPassword}||`);
    // A blank line under each section, so the board isn't crowded.
    const gap = '\n\u200b';
    if (join.length) embed.addFields({ name: '🎮 How to join', value: join.join('\n') + gap });

    if (online) {
        const c = clock(state.world);
        if (c) embed.addFields({ name: '🕰️ In game', value: `${c.emoji} **${c.time}**  ·  Day ${c.day}\n${c.next}` + gap });
        const names = state.players.slice(0, 20).map(p => escapeMarkdown(p.characterName || p.name));
        if (count > 20) names.push(`and ${count - 20} more`);
        embed.addFields({ name: '👥 Playing now', value: (names.length ? names.join('  ·  ') : '*Nobody yet - be the first!*') + gap });
    }

    if (!compact && gainers.length) {
        embed.addFields({ name: '📈 Top XP today', value: gainers.map((r, i) => `${place(i)} **${r.name}**  +${fmt(r.total)} xp`).join('\n') + gap });
    }

    const facts = [];
    if (state.health) facts.push({ name: '⏱️ Uptime', value: formatDuration(state.health.uptimeSeconds || 0), inline: true });
    if (config.dailyRestart) facts.push({ name: '🔄 Daily restart', value: config.dailyRestart, inline: true });
    if (vps) facts.push({ name: '🖥️ Load', value: `CPU ${pct(vps.cpu.usage)}%  ·  RAM ${pct(vps.memory.used / vps.memory.total)}%`, inline: true });
    if (facts.length) embed.addFields(facts);
    return embed;
}

// ---- admin --------------------------------------------------------------

const backupLabel = b => new Date(b.at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function backupsEmbed(backups) {
    const lines = backups.slice(0, 15).map((b, i) => {
        const files = b.files.length === 1 ? b.files[0].save : `${b.files.length} files`;
        return `\`${String(i + 1).padStart(2)}\` 💾 **${backupLabel(b)}** · ${relative(b.at)} · ${files} · ${bytes(b.size)}`;
    });
    if (backups.length > 15) lines.push(`…and ${backups.length - 15} older`);
    const total = backups.reduce((n, b) => n + b.size, 0);
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`💾 Backups — ${backups.length}`)
        .setDescription(lines.join('\n') || 'No backups yet. `/server backup` makes one now.')
        .setFooter({ text: `${bytes(total)} in total · /server restore to put one back` });
}

export const backupChoice = b => ({
    name: `💾 ${backupLabel(b)} · ${b.files.length} file${b.files.length === 1 ? '' : 's'} · ${bytes(b.size)}`.slice(0, 100),
    value: b.id,
});

export function restoreConfirmEmbed(backup, playersOnline) {
    const files = backup.files.map(f => `• \`${f.save}.sav\``).join('\n');
    const warning = playersOnline
        ? `**${playersOnline} player${playersOnline === 1 ? ' is' : 's are'} online** - they get a minute's warning, then the server stops.`
        : 'Nobody is online, so the server stops straight away.';
    return new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`⚠️ Restore the backup from ${backupLabel(backup)}?`)
        .setDescription(
            `${warning}\n\nThese saves are replaced by the backup's:\n${files}\n\n` +
                'The current saves are copied into the backups first, so this can be undone. The server starts again afterwards.',
        );
}

export function saveCandidatesEmbed(candidates) {
    const lines = candidates.slice(0, 30).map(c => `• \`${c}\``);
    if (candidates.length > 30) lines.push(`…and ${candidates.length - 30} more (type to search in the \`function\` option)`);
    return new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle('💾 Which function saves the world?')
        .setDescription(
            'The game\'s save function differs between versions, so it\'s picked once. Try one with ' +
                '`/admin save function:…` - the bot checks whether the save files actually change. Put the one ' +
                'that works in the bot\'s `.env` as `SAVE_FUNCTION=`, and backups save the world first from then on.\n\n' +
                (lines.join('\n') || 'No candidates found - the mod lists them once the world has loaded.'),
        );
}

// `wiki` is what wikiInfo() found, or null - the card then shows what the game knows.
export function itemEmbed(item, wiki = null) {
    const lines = [];
    if (wiki?.description) lines.push(`> *${wiki.description}*`);
    if (wiki?.summary) lines.push(wiki.summary);
    if (!lines.length) lines.push('*The wiki has nothing on this item yet.*');

    const fields = [
        { name: '🏷️ Type', value: wiki?.type || item.category || '—', inline: true },
        { name: '📦 Stacks to', value: item.maxStackSize > 1 ? fmt(item.maxStackSize) : 'Doesn\'t stack', inline: true },
    ];
    if (wiki?.weight) fields.push({ name: '⚖️ Weight', value: wiki.weight, inline: true });
    if (wiki?.repair) fields.push({ name: '🔧 Repair cost', value: wiki.repair, inline: true });
    const link = wiki?.url || wikiSearchUrl(item.name);
    fields.push({ name: '​', value: `📖 **[${wiki ? 'Read more on the wiki' : 'Search the wiki'}](${link})**` });

    const embed = new EmbedBuilder()
        .setColor(0xc8a24a)
        .setAuthor({ name: item.category ? `🎒 ${item.category}` : '🎒 Item' })
        .setTitle(wiki?.title || item.name)
        .setDescription(lines.join('\n\n'))
        .addFields(fields);
    if (wiki?.image) embed.setThumbnail(wiki.image);
    if (wiki) embed.setFooter({ text: 'From the RuneScape: Dragonwilds wiki' });
    return embed;
}

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

// ---- crash reports ------------------------------------------------------

const CAUSE_ICON = { oom: '🧠', 'mod-crash': '🧩', crash: '💥', killed: '🔪', stopped: '⏹️', reboot: '🔁', exited: '🚪', unknown: '❓' };

export function crashReportEmbed({ verdict, uptimeSeconds, exit, mod, name }) {
    const fields = [];
    if (uptimeSeconds != null) fields.push({ name: 'Had been up', value: formatDuration(uptimeSeconds), inline: true });
    if (exit?.at) fields.push({ name: 'How it ended', value: `\`${exit.result} · ${exit.code} ${exit.status}\``, inline: true });
    const memory = mod?.heartbeat.match(/using (\d+) MB/)?.[1];
    if (memory) fields.push({ name: 'Server memory (last check)', value: `${fmt(memory)} MB`, inline: true });
    return new EmbedBuilder()
        .setColor(COLOR.error)
        .setTitle(`${CAUSE_ICON[verdict.cause] || '❓'} Why the server went down`)
        .setDescription(verdict.text)
        .addFields(fields)
        .setFooter({ text: `Full report: ${name} · /admin crashes lists past ones` })
        .setTimestamp();
}

export function crashesEmbed(entries) {
    const lines = entries.slice(0, 10).map(e => `${CAUSE_ICON[e.cause] || '❓'} <t:${Math.floor(e.at / 1000)}:f> · ${e.verdict.replace(/\*\*/g, '').split('\n')[0].slice(0, 180)}`);
    return new EmbedBuilder()
        .setColor(entries.length ? COLOR.error : COLOR.online)
        .setTitle('💥 Unplanned restarts')
        .setDescription(lines.join('\n') || 'None recorded - the server has not gone down unexpectedly since the bot started keeping reports.')
        .setFooter({ text: entries.length ? 'The newest full report is attached' : config.serverName })
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

// /help, and the card COMMANDS_POST puts in the chat channel.
export function helpEmbed() {
    const embed = new EmbedBuilder()
        .setColor(COLOR.info)
        .setTitle(`🐉 ${config.serverName} · Commands`)
        .setDescription(
            'Type **`/`** and pick one - player, skill and item names fill in as you type. ' +
                'Players can be looked up by character or account name, even while offline.',
        )
        .addFields(
            {
                name: '📊 Skills',
                value: [
                    '`/levels player` · every skill, total level and max health',
                    '`/perks player` · their active skill perks',
                    '`/quests [player]` · quests done and in progress',
                    '`/kills [player]` · creatures killed, and which',
                ].join('\n'),
            },
            {
                name: '🏆 Leaderboards',
                value: [
                    '`/leaderboard total` · total level, with quests done',
                    '`/leaderboard skill mining` · any one skill',
                    '`/leaderboard quests` · most quests done',
                    '`/leaderboard kills` · most creatures killed',
                    '`/playtime` · `/deaths` · `/gains` · most played, most deaths, most XP',
                ].join('\n'),
            },
            {
                name: '🔗 You',
                value: [
                    '`/link` · link your Discord to your character',
                    '`/me` · everything about your character',
                    '`/alerts` · DMs when a raid starts or you’re hunted (off until you turn them on)',
                    '`/unlink` · remove the link',
                ].join('\n'),
            },
            {
                name: '📈 Activity',
                value: [
                    '`/gains [player] [period]` · XP gained today, this week or this month',
                    '`/playtime [player]` · time played',
                    '`/deaths [player]` · deaths',
                ].join('\n'),
            },
            {
                name: '🐉 Server & more',
                value: [
                    '`/status` · is it up, who is on, the world and the time in game',
                    '`/item item` · what an item is and does, from the wiki',
                    '`/help` · this list',
                ].join('\n'),
            },
        )
        .setFooter({ text: '[ ] = optional' });

    if (config.bridgeToGame && config.chatChannelId) {
        embed.addFields({ name: '💬 Talk to players', value: `Messages in <#${config.chatChannelId}> show up in game chat.` });
    }
    if (config.adminUserIds.length) {
        embed.addFields({
            name: '🛡️ Admins only',
            value:
                '`/server` start, stop, restart, cancel, update, back up, list and restore backups\n' +
                '`/admin` kick, ban, unban, bans, give, say, save, remove / restore on leaderboards, diagnostics, crashes',
        });
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

// ---- game updates -------------------------------------------------------

const ago = ms => (ms ? ` · ${relative(ms)}` : '');

// mode: scheduled (backing up and updating in `minutes`), offline (server is
// stopped), manual (AUTO_UPDATE is off, or this build's update already ran).
export function updateOutdatedEmbed({ installed, latest, mode, minutes }) {
    const next = {
        scheduled: minutes
            ? `🔄 **Backing up, updating and restarting ${minutes > 1 ? `in ${minutes} minutes` : 'in a minute'}** · ${relative(Date.now() + minutes * 60000)}\n` +
              'Players in game have been warned. Admins can wait for the daily update instead with `/server cancel`.'
            : '🔄 **Backing up, updating and restarting now** · nobody is online.',
        offline: 'The server is stopped. An admin can update it with `/server update` - it starts again afterwards.',
        manual: 'It updates at the next daily restart, or right away with `/server update`.',
    }[mode];
    return new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('⚠️ Server is out of date')
        .setDescription(`A game update is out on Steam. Until the server has it, players on the new version may not be able to join.\n\n${next}`)
        .addFields(
            { name: '📦 Installed', value: `Build \`${installed.buildId}\`${ago(installed.updated)}`, inline: true },
            { name: '🆕 Latest', value: `Build \`${latest.buildId}\`${ago(latest.released)}`, inline: true },
        )
        .setTimestamp();
}

export function updateDoneEmbed({ from, to }) {
    return new EmbedBuilder()
        .setColor(COLOR.online)
        .setTitle('🆕 Server updated')
        .setDescription(`${from && to && from !== to ? `Build \`${from}\` → \`${to}\`. ` : ''}It's starting up - the online notice follows once it's ready.`)
        .setTimestamp();
}

export function updateFailedEmbed(reason) {
    return new EmbedBuilder()
        .setColor(COLOR.error)
        .setTitle('❌ Server update failed')
        .setDescription(`${reason.slice(0, 1500)}\n\nThe server is back on the old build. The daily update tries again, or use \`/server update\`.`)
        .setTimestamp();
}
