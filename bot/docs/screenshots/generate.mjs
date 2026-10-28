// Renders the bot's embeds as Discord-style screenshots for the README, using
// the real embed code with made-up players. Needs Edge or Chrome:
//
//   node docs/screenshots/generate.mjs

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
Object.assign(process.env, {
    DISCORD_TOKEN: 'x',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'rsdw-shots-')),
    SERVER_NAME: 'Dragonwilds Server',
    MAX_PLAYERS: '6',
    WORLD_NAME: 'Ashfall',
    WORLD_CREATOR: 'Mira',
    CONNECT_ADDRESS: '203.0.113.7:7777',
    SERVER_PASSWORD: 'goblins',
    DAILY_RESTART: '05:00 UTC',
    CHAT_CHANNEL_ID: '100000000000000001',
    ADMIN_USER_IDS: '100000000000000002',
});

const E = await import('../../src/embeds.js');
const { describeSkills } = await import('../../src/skills.js');
const { levelInfo } = await import('../../src/levels.js');
const { wikiInfo } = await import('../../src/wiki.js');

// ---- sample data ----------------------------------------------------------

// Total XP for a level plus a fraction of the way to the next.
function xpFor(level, frac = 0) {
    let lo = 0;
    let hi = 1000000;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (levelInfo(mid).level >= level) hi = mid;
        else lo = mid + 1;
    }
    const info = levelInfo(lo);
    return info.maxed ? lo : Math.floor(lo + (info.next - lo) * frac);
}

const SKILLS = ['Attack', 'Magic', 'Ranged', 'Mining', 'Woodcutting', 'Farming', 'Fishing', 'Runecrafting', 'Construction', 'Artisan', 'Cooking', 'Agility'];
const raw = levels => SKILLS.map((s, i) => ({ skill: `SKILL_${s}`, currentXP: xpFor(levels[i], ((i * 37) % 90) / 100) }));
const PLAYERS = {
    Mira: [72, 64, 58, 81, 99, 47, 55, 60, 70, 66, 52, 49],
    Thorne: [88, 41, 77, 63, 70, 38, 44, 35, 52, 58, 61, 57],
    Elske: [45, 79, 40, 52, 61, 66, 73, 71, 49, 55, 68, 42],
    Rowan: [60, 35, 62, 70, 58, 41, 39, 30, 44, 50, 47, 53],
    Kit: [38, 30, 44, 41, 52, 49, 28, 22, 35, 40, 37, 31],
    Bram: [29, 22, 25, 33, 40, 26, 31, 18, 27, 30, 24, 21],
};
// Quests done per player (the first `n` of this list, main ones marked), and journal entries.
const QUESTS = [
    ['Cook’s Assistant', 'side'], ['Dragon Slayer', 'main'], ['Goblin Diplomacy', 'side'], ['Animal Magnetism', 'side'],
    ['Restless Ghosts', 'side'], ['A Melody Remembered', 'side'], ['Elder Garou', 'main'], ['Dog Days', 'task'],
    ['Heartstrings', 'side'], ['Granite Mauled', 'main'], ['Brink of Extinction', 'side'], ['Scarecrow Scavenging', 'task'],
    ['The Great Body Robbery', 'side'], ['Letters for the Dead', 'side'], ['Mirror Mirror', 'side'], ['Wither Ward', 'main'],
    ['Collector’s Calling', 'side'], ['Highlighting the Problem', 'side'],
];
const QUEST_COUNT = { Mira: 16, Thorne: 11, Elske: 14, Rowan: 9, Kit: 5, Bram: 2 };
const quests = name => [
    ...QUESTS.slice(0, QUEST_COUNT[name]).map(([n, kind]) => ({ id: n, name: n, kind, complete: true })),
    { id: 'q1', name: 'Highlighting the Problem', kind: 'side', complete: false, objective: 'Obj_LightTheBeacons' },
    { id: 'q2', name: 'Collector’s Calling', kind: 'side', complete: false, objective: 'Obj_FindTheMissingPages' },
].filter((q, i, all) => all.findIndex(o => o.name === q.name) === i);
const journal = { total: 142, kinds: { lore: 38, people: 21, places: 34, treasure: 9, recipes: 40 } };
const player = name => ({ name: name.toLowerCase(), characterName: name, skills: raw(PLAYERS[name]), quests: quests(name), journal });
const rowsFor = skillName =>
    Object.keys(PLAYERS)
        .map(name => {
            const skills = describeSkills(raw(PLAYERS[name]));
            const s = skillName ? skills.find(x => x.name === skillName) : null;
            return {
                player: player(name),
                online: ['Mira', 'Elske', 'Kit'].includes(name),
                level: s ? s.info.level : skills.reduce((n, x) => n + x.info.level, 0),
                xp: s ? s.xp : skills.reduce((n, x) => n + x.xp, 0),
                ...(s ? {} : { quests: QUEST_COUNT[name] }),
            };
        })
        .sort((a, b) => b.level - a.level || b.xp - a.xp);

const profile = name => {
    const skills = describeSkills(raw(PLAYERS[name]));
    return {
        player: { ...player(name), maxHealth: 420 },
        online: true,
        fetchedAt: Date.now(),
        skills,
        totalLevel: skills.reduce((n, s) => n + s.info.level, 0),
        totalXP: skills.reduce((n, s) => n + s.xp, 0),
    };
};
const skillOf = (name, skill) => describeSkills(raw(PLAYERS[name])).find(s => s.name === skill);
const online = ['Mira', 'Elske', 'Kit'].map(player);
const health = { uptimeSeconds: 6 * 3600 + 23 * 60, version: '0.6.0' };
const world = { worldName: 'Ashfall', host: 'Mira', difficulty: 'normal', hardcore: 'off', time: { day: 37, hour: 14.34, dawn: 6, dusk: 20, isDay: true, paused: false, minutesPerDay: 60 }, events: [] };
const located = [{ ...player('Mira'), uniqueNetId: 'm' }, { ...player('Elske'), uniqueNetId: 'e' }, { ...player('Kit'), uniqueNetId: 'k' }];
const perks = { max: 6, active: [
    { id: 'PerkV2_Attack_Parry', name: 'Parry', description: 'Block just as an attack lands to stagger the attacker.', skill: 'SKILL_Attack' },
    { id: 'PerkV2_Attack_JumpAttack', name: 'Jump Attack', description: 'Attack while jumping for a heavy overhead strike.', skill: 'SKILL_Attack' },
    { id: 'PerkV2_Mining_DoubleOre', name: 'Rich Veins', description: 'A chance to mine twice the ore.', skill: 'SKILL_Mining' },
    { id: 'PerkV2_Artisan_MagicalMending', name: 'Magical Mending', description: 'Repair gear for less at a workbench.', skill: 'SKILL_Artisan' },
] };
const questRows = Object.keys(PLAYERS).map(name => ({ player: player(name), online: ['Mira', 'Elske', 'Kit'].includes(name), done: QUEST_COUNT[name], main: QUESTS.slice(0, QUEST_COUNT[name]).filter(q => q[1] === 'main').length })).sort((a, b) => b.done - a.done);
const linkUser = { username: 'mira' };
const H = 3600;

// Each screenshot: a file name and the messages in it. A message is the
// command that produced it (or null for one the bot posts by itself) and its embeds.
const shots = [
    ['status-board', [[null, [E.boardEmbed({ state: { status: 'online', players: online, health, world }, gainers: [{ name: 'Mira', total: 18420 }, { name: 'Elske', total: 9310 }, { name: 'Kit', total: 4120 }], vps: { cpu: { usage: 0.23 }, memory: { used: 5.1, total: 16 } } })]]]],
    ['levels', [['/levels player:Mira', [E.renderPlayerPage(profile('Mira'), 'overview')]]]],
    ['level', [['/level skill:Woodcutting player:Thorne', [E.renderPlayerPage(profile('Thorne'), 'skill:woodcutting')]]]],
    ['leaderboard', [['/leaderboard', [E.leaderboardEmbed(rowsFor(null), null, 0)]]]],
    [
        'activity',
        [
            [null, [E.joinEmbed('Kit', 3)]],
            [null, [E.levelUpEmbed({ name: 'Elske', skill: skillOf('Elske', 'Magic'), from: 78, totalLevel: profile('Elske').totalLevel })]],
            [null, [E.maxedEmbed({ name: 'Mira', skill: skillOf('Mira', 'Woodcutting'), totalLevel: profile('Mira').totalLevel })]],
            [null, [E.leaveEmbed('Rowan', 2, 2 * H + 41 * 60)]],
            [null, [E.leaveEmbed('Bram', 1, 47 * 60, true)]],
        ],
    ],
    [
        'stats',
        [
            ['/playtime', [E.playtimeBoardEmbed([['Mira', 21.5], ['Thorne', 17.2], ['Elske', 12.8], ['Rowan', 9.1], ['Kit', 4.6]].map(([name, h], i) => ({ name, recent: h * H, total: h * H * (6 - i) })))]],
            ['/gains player:Elske period:week', [E.gainsEmbed('Elske', 'week', gainsSample())]],
        ],
    ],
    [
        'weekly-recap',
        [
            [
                null,
                [
                    E.summaryEmbed({
                        gainers: [['Mira', 61200], ['Elske', 44870], ['Thorne', 30115], ['Rowan', 12040], ['Kit', 8800]].map(([name, total]) => ({ name, total })),
                        milestones: [{ name: 'Mira', skill: 'Woodcutting' }],
                        played: [['Mira', 21.5], ['Thorne', 17.2], ['Elske', 12.8]].map(([name, h]) => ({ name, recent: h * H })),
                        deaths: [{ name: 'Thorne', recent: 9 }, { name: 'Kit', recent: 4 }, { name: 'Mira', recent: 2 }],
                    }),
                ],
            ],
        ],
    ],
    [
        'notices',
        [
            [null, [E.noticeEmbed('restart', { minutes: 5, message: 'Daily update' })]],
            [null, [E.noticeEmbed('online', { after: 'restart', downtimeMs: 3 * 60000 })]],
        ],
    ],
    ['help', [['/help', [E.helpEmbed()]]]],
    ['quest-leaderboard', [['/leaderboard skill:quests', [E.questLeaderboardEmbed(questRows, 0)]]]],
    ['perks', [['/perks player:Mira', [E.perksEmbed({ ...profile('Mira'), player: { ...player('Mira'), perks } })]]]],
    ['me', [['/me', [E.renderPlayerPage(profile('Mira'), 'overview'), E.progressEmbed(profile('Mira'), { playtime: { week: 21.5 * H, total: 129 * H }, deaths: { week: 2, total: 31 } })]]]],
    ['link', [[null, [E.linkHowToEmbed()], E.linkButtons()], ['🔗 Link my character', [E.linkCodeEmbed('K7Q2M', 10)], null, true], ['🔗 Link my character', [E.linkedEmbed('Mira')], null, true]]],
    [
        'raid-alerts',
        [
            [null, [E.eventEmbed({ type: 'raid', name: 'BP_RaidEvent_Goblins_C' }, [located[0], located[1]])], null, false, '@Mira @Elske'],
            [null, [E.eventEmbed({ type: 'hunted', name: 'BP_HuntedEvent_Wolves_C' }, [located[2]])], null, false, '@Kit'],
            [null, [E.eventEmbed({ type: 'raid', name: 'BP_RaidEvent_Goblins_C' }, [located[0], located[1]], { over: true, startedAt: Date.now() - 4 * 60000 })]],
        ],
    ],
    ['status', [['/status', [E.statusEmbed({ status: 'online', players: online, health, world })]]]],
];

function gainsSample() {
    const skills = describeSkills(raw(PLAYERS.Elske));
    const pick = [['Magic', 21400, 77], ['Cooking', 12300, 66], ['Fishing', 8150, 72], ['Farming', 3020, 66]];
    const out = pick.map(([n, gained, fromLevel]) => ({ ...skills.find(s => s.name === n), gained, fromLevel }));
    return { total: out.reduce((n, s) => n + s.gained, 0), levels: 4, skills: out, since: new Date(Date.now() - 6 * 86400000).toLocaleDateString('en-CA') };
}

const item = await wikiInfo('Bronze Pickaxe');
shots.push(['item', [['/item item:Bronze Pickaxe', [E.itemEmbed({ name: 'Bronze Pickaxe', category: 'Tool', maxStackSize: 1 }, item)]]]]);

// ---- rendering --------------------------------------------------------------

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hex = n => `#${(n ?? 0x1e1f22).toString(16).padStart(6, '0')}`;

// The bits of Discord markdown the bot uses.
function inline(text) {
    let s = esc(text);
    s = s.replace(/&lt;t:(\d+):R&gt;/g, (_, t) => {
        const min = Math.round((t * 1000 - Date.now()) / 60000);
        return `<span class="ts">${min > 0 ? `in ${min} minutes` : `${-min} minutes ago`}</span>`;
    });
    s = s.replace(/&lt;#\d+&gt;/g, '<span class="mention"># chat</span>');
    s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a>$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/\*([^*]+)\*/g, '<i>$1</i>');
    s = s.replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler">$1</span>');
    return s;
}
function markdown(text) {
    return (text || '')
        .split('\n')
        .map(line => {
            const h = line.match(/^(#{1,3}) (.*)$/);
            if (h) return `<div class="h${h[1].length}">${inline(h[2])}</div>`;
            if (line.startsWith('-# ')) return `<div class="sub">${inline(line.slice(3))}</div>`;
            if (line.startsWith('> ')) return `<div class="quote">${inline(line.slice(2))}</div>`;
            return `<div>${inline(line) || '&nbsp;'}</div>`;
        })
        .join('');
}

function embedHtml(e) {
    const d = e.toJSON();
    const fields = (d.fields || []).map(f => `<div class="field${f.inline ? ' inline' : ''}"><div class="fname">${inline(f.name)}</div><div class="fvalue">${markdown(f.value)}</div></div>`).join('');
    return `<div class="embed" style="border-color:${hex(d.color)}">
      <div class="ebody">
        ${d.author ? `<div class="author">${inline(d.author.name)}</div>` : ''}
        ${d.title ? `<div class="title">${inline(d.title)}</div>` : ''}
        ${d.description ? `<div class="desc">${markdown(d.description)}</div>` : ''}
        ${fields ? `<div class="fields">${fields}</div>` : ''}
        ${d.footer || d.timestamp ? `<div class="footer">${[d.footer && inline(d.footer.text), d.timestamp && 'Today at 20:14'].filter(Boolean).join(' • ')}</div>` : ''}
      </div>
      ${d.thumbnail ? `<img class="thumb" src="${d.thumbnail.url}">` : ''}
    </div>`;
}

// A message: [command or button label (null if the bot posted it by itself),
// embeds, button rows, only-you-can-see-this, text before the embeds].
function messageHtml([command, embeds, components, ephemeral, content], first) {
    const how = command && command.startsWith('/') ? 'used' : 'pressed';
    const label = command && command.startsWith('/') ? command.split(' ')[0] : command;
    const used = command ? `<div class="reply"><span class="ravatar"></span><b>Mira</b> ${how} <span class="cmd">${esc(label)}</span></div>` : '';
    const head = first || command ? `<div class="head"><span class="name">Dragonwilds Bot</span><span class="tag">APP</span><span class="time">Today at 20:14</span></div>` : '';
    const text = content ? `<div class="text">${content.split(' ').map(m => `<span class="mention">${esc(m)}</span>`).join(' ')}</div>` : '';
    const buttons = (components || [])
        .map(row => '<div class="buttons">' + row.toJSON().components.map(b => `<span class="button s${b.style}">${b.emoji?.name ? b.emoji.name + ' ' : ''}${esc(b.label)}</span>`).join('') + '</div>')
        .join('');
    const only = ephemeral ? '<div class="only">👁️ Only you can see this message</div>' : '';
    return `<div class="msg${first || command ? ' first' : ''}">${used}<div class="row"><div class="avatar">${first || command ? '🐉' : ''}</div><div class="content">${head}${text}${embeds.map(embedHtml).join('')}${buttons}${only}</div></div></div>`;
}

const CSS = `
body { margin:0; background:#313338; font-family:'Noto Sans','Segoe UI',sans-serif; color:#dbdee1; font-size:15px; line-height:1.375; }
#shot { display:inline-block; padding:12px 16px 16px 0; width:640px; }
.msg { padding:2px 0 2px 16px; } .msg.first { margin-top:10px; }
.reply { margin-left:56px; font-size:13px; color:#b5bac1; display:flex; align-items:center; gap:4px; }
.ravatar { width:16px; height:16px; border-radius:50%; background:#5865f2; display:inline-block; }
.cmd { color:#00a8fc; }
.row { display:flex; gap:16px; }
.avatar { width:40px; height:40px; flex:none; border-radius:50%; font-size:22px; display:flex; align-items:center; justify-content:center; }
.first .avatar { background:#1e1f22; }
.head { display:flex; align-items:center; gap:6px; margin-bottom:2px; }
.name { color:#f2f3f5; font-weight:600; } .time { color:#949ba4; font-size:12px; }
.tag { background:#5865f2; color:#fff; font-size:10px; font-weight:600; padding:0 4px; border-radius:3px; line-height:15px; }
.content { min-width:0; flex:1; }
.embed { display:flex; max-width:520px; background:#2b2d31; border-left:4px solid; border-radius:4px; padding:8px 16px 16px 12px; margin-top:4px; gap:16px; }
.ebody { flex:1; min-width:0; font-size:14px; }
.author { font-weight:600; font-size:14px; margin-top:8px; color:#f2f3f5; }
.title { font-weight:600; font-size:16px; margin-top:8px; color:#f2f3f5; }
.desc { margin-top:8px; }
.h1 { font-size:24px; font-weight:700; margin:8px 0 4px; } .h2 { font-size:20px; font-weight:700; margin:8px 0 4px; color:#f2f3f5; } .h3 { font-size:16px; font-weight:700; margin:8px 0 4px; color:#f2f3f5; }
.quote { border-left:4px solid #4e5058; padding-left:12px; }
.fields { display:flex; flex-wrap:wrap; column-gap:8px; margin-top:8px; }
.field { flex:1 1 100%; margin-top:8px; min-width:0; } .field.inline { flex:1 1 30%; }
.fname { font-weight:600; color:#f2f3f5; margin-bottom:2px; }
.footer { margin-top:8px; font-size:12px; color:#b5bac1; }
.thumb { width:80px; height:80px; object-fit:contain; border-radius:4px; margin-top:8px; flex:none; }
code { background:#1e1f22; border-radius:3px; padding:0 3px; font-family:Consolas,monospace; font-size:85%; }
a { color:#00a8fc; } b { color:#f2f3f5; font-weight:600; }
.ts { background:#3a3c42; border-radius:3px; padding:0 2px; }
.mention { background:rgba(88,101,242,.3); color:#c9cdfb; border-radius:3px; padding:0 2px; }
.spoiler { background:#1e1f22; color:#1e1f22; border-radius:3px; padding:0 2px; }
.sub { font-size:12px; color:#949ba4; }
.text { margin-bottom:2px; }
.buttons { display:flex; gap:8px; margin-top:8px; }
.button { padding:2px 16px; border-radius:8px; color:#fff; font-size:14px; font-weight:500; line-height:30px; }
.button.s1 { background:#5865f2; } .button.s2 { background:#4e5058; } .button.s4 { background:#da373c; }
.only { font-size:12px; color:#949ba4; margin-top:4px; }
img.emoji { height:1.2em; width:1.2em; vertical-align:-0.25em; margin:0 .05em; }
.h2 img.emoji, .h3 img.emoji { height:1.1em; width:1.1em; }
.avatar img.emoji { height:24px; width:24px; }
`;

const browser = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
if (!browser) throw new Error('needs Edge or Chrome');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rsdw-html-'));

for (const [name, messages] of shots) {
    const html = `<!doctype html><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700&display=swap" rel="stylesheet"><style>${CSS}</style>
<div id="shot">${messages.map((m, i) => messageHtml(m, i === 0)).join('')}</div>
<script src="https://cdn.jsdelivr.net/npm/@twemoji/api@15.1.0/dist/twemoji.min.js"></script>
<script>
twemoji.parse(document.body, { folder: 'svg', ext: '.svg', base: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/' });
const h = document.getElementById('shot').getBoundingClientRect().height;
document.title = Math.ceil(h);
</script>`;
    const file = path.join(work, `${name}.html`);
    fs.writeFileSync(file, html);
    const out = path.join(here, `${name}.png`);
    // First pass measures the height, the second takes the picture at that size.
    const dump = execFileSync(browser, ['--headless=new', '--disable-gpu', '--virtual-time-budget=8000', '--dump-dom', `file:///${file.replace(/\\/g, '/')}`], { encoding: 'utf8' });
    const height = Number(dump.match(/<title>(\d+)<\/title>/)?.[1] || 600) + 4;
    execFileSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=8000', '--force-device-scale-factor=2', `--window-size=656,${height}`, `--screenshot=${out}`, `file:///${file.replace(/\\/g, '/')}`], { stdio: 'ignore' });
    console.log(`${name}.png`);
}
fs.rmSync(work, { recursive: true, force: true });
