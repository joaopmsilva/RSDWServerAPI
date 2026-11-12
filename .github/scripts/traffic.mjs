// Saves the repo's traffic once a day, because GitHub only keeps 14 days of it.
// Runs from .github/workflows/traffic.yml and writes into a checkout of the
// `traffic` branch (the folder given as the first argument):
//   daily.csv      one row per day: views, visitors, clones, stars, downloads
//   referrers.csv  where people came from (14-day totals, one snapshot a day)
//   pages.csv      which pages they read (same)
//   README.md      a chart and tables, regenerated every run
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] || '.';
const repo = process.env.REPO;
const trafficToken = process.env.TRAFFIC_TOKEN;
const repoToken = process.env.GITHUB_TOKEN || trafficToken;

if (!trafficToken) {
  console.error('The TRAFFIC_TOKEN secret is missing. GitHub only shows traffic to a token with');
  console.error('"Administration: read" on this repo: make a fine-grained token with that and add it');
  console.error('under Settings > Secrets and variables > Actions as TRAFFIC_TOKEN.');
  process.exit(1);
}

async function api(path, token) {
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'traffic-archive',
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

const today = new Date().toISOString().slice(0, 10);
const [views, clones, referrers, pages, info, releases] = await Promise.all([
  api('/traffic/views', trafficToken),
  api('/traffic/clones', trafficToken),
  api('/traffic/popular/referrers', trafficToken),
  api('/traffic/popular/paths', trafficToken),
  api('', repoToken),
  api('/releases?per_page=100', repoToken),
]);
const downloads = releases.reduce((n, r) => n + r.assets.reduce((m, a) => m + a.download_count, 0), 0);

// daily.csv: GitHub's newest figures win for the days it still has (today's
// keep growing until tomorrow's run); older days stay as they were saved.
const COLS = ['date', 'views', 'visitors', 'clones', 'cloners', 'stars', 'downloads'];
const dailyFile = join(dir, 'daily.csv');
const days = new Map();
if (existsSync(dailyFile)) {
  for (const line of readFileSync(dailyFile, 'utf8').trim().split('\n').slice(1)) {
    const cells = line.split(',');
    days.set(cells[0], Object.fromEntries(COLS.map((c, i) => [c, cells[i] ?? ''])));
  }
}
const day = date => {
  if (!days.has(date)) days.set(date, Object.fromEntries(COLS.map(c => [c, c === 'date' ? date : ''])));
  return days.get(date);
};
for (const v of views.views) Object.assign(day(v.timestamp.slice(0, 10)), { views: v.count, visitors: v.uniques });
for (const c of clones.clones) Object.assign(day(c.timestamp.slice(0, 10)), { clones: c.count, cloners: c.uniques });
Object.assign(day(today), { stars: info.stargazers_count, downloads });
for (const d of days.values()) for (const c of ['views', 'visitors', 'clones', 'cloners']) if (d[c] === '') d[c] = 0;
const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
writeFileSync(dailyFile, [COLS.join(','), ...rows.map(r => COLS.map(c => r[c]).join(','))].join('\n') + '\n');

// referrers.csv / pages.csv: today's snapshot replaces any earlier one from today.
const csvCell = s => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
function snapshot(file, header, list) {
  const path = join(dir, file);
  const old = existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').slice(1) : [];
  const kept = old.filter(l => l && !l.startsWith(today + ','));
  const fresh = list.map(x => [today, ...x].map(csvCell).join(','));
  writeFileSync(path, [header, ...kept, ...fresh].join('\n') + '\n');
}
snapshot('referrers.csv', 'date,referrer,views,visitors', referrers.map(r => [r.referrer, r.count, r.uniques]));
snapshot('pages.csv', 'date,page,views,visitors', pages.map(p => [p.path, p.count, p.uniques]));

// README.md
const DAY = 86400000;
const dateAt = (base, offset) => new Date(Date.parse(base) + offset * DAY).toISOString().slice(0, 10);
const last = n => Array.from({ length: n }, (_, i) => {
  const date = dateAt(today, i - n + 1);
  return days.get(date) || { date, views: 0, visitors: 0, clones: 0, cloners: 0 };
});
const sum = (list, c) => list.reduce((n, r) => n + Number(r[c] || 0), 0);
const month = last(30);
const chart = month.filter(r => r.date >= rows[0].date);
const md = s => String(s).replace(/\|/g, '\\|');

const readme = `# Traffic for ${repo}

GitHub only keeps 14 days of traffic, so a [workflow](https://github.com/${repo}/blob/main/.github/workflows/traffic.yml) saves it here every day.
Last updated ${today}. Raw numbers: [daily.csv](daily.csv), [referrers.csv](referrers.csv), [pages.csv](pages.csv).

| | Last 7 days | Last 30 days | Since ${rows[0].date} |
|---|---:|---:|---:|
| Page views | ${sum(last(7), 'views')} | ${sum(month, 'views')} | ${sum(rows, 'views')} |
| Visitors (unique per day, added up) | ${sum(last(7), 'visitors')} | ${sum(month, 'visitors')} | ${sum(rows, 'visitors')} |
| Clones | ${sum(last(7), 'clones')} | ${sum(month, 'clones')} | ${sum(rows, 'clones')} |

⭐ ${info.stargazers_count} stars · 🍴 ${info.forks_count} forks · ⬇️ ${downloads} release downloads

## Visitors per day, last 30 days

\`\`\`mermaid
xychart-beta
  x-axis [${chart.map(r => `"${r.date.slice(5)}"`).join(', ')}]
  y-axis "Visitors"
  bar [${chart.map(r => Number(r.visitors)).join(', ')}]
\`\`\`

| Day | Views | Visitors | Clones |
|---|---:|---:|---:|
${last(14).reverse().map(r => `| ${r.date} | ${r.views} | ${r.visitors} | ${r.clones} |`).join('\n')}

## Where they came from (last 14 days)

| Site | Views | Visitors |
|---|---:|---:|
${referrers.map(r => `| ${md(r.referrer)} | ${r.count} | ${r.uniques} |`).join('\n') || '| (none yet) | | |'}

## What they read (last 14 days)

| Page | Views | Visitors |
|---|---:|---:|
${pages.map(p => `| [${md(p.title || p.path)}](https://github.com${p.path}) | ${p.count} | ${p.uniques} |`).join('\n') || '| (none yet) | | |'}
`;
writeFileSync(join(dir, 'README.md'), readme);
console.log(`Saved ${rows.length} days; today: ${JSON.stringify(day(today))}`);
