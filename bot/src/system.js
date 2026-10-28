import fs from 'node:fs/promises';
import os from 'node:os';

// VPS usage for the status board and admin alerts, read from /proc. CPU and network are rates, so they're
// sampled twice a second apart.

const SAMPLE_MS = 1000;
// Loopback and container bridges would count the same traffic twice.
const VIRTUAL_IFACE = /^(lo|veth|docker|br-|virbr|tun|tap)/;

export function parseCpu(stat) {
    const line = stat.split('\n').find(l => l.startsWith('cpu '));
    // user nice system idle iowait irq softirq steal
    const v = line.trim().split(/\s+/).slice(1, 9).map(Number);
    return { idle: v[3] + v[4], total: v.reduce((a, b) => a + b, 0) };
}

export function parseMem(meminfo) {
    const kb = {};
    for (const line of meminfo.split('\n')) {
        const m = line.match(/^(\w+):\s+(\d+)/);
        if (m) kb[m[1]] = Number(m[2]) * 1024;
    }
    return {
        total: kb.MemTotal,
        used: kb.MemTotal - (kb.MemAvailable ?? kb.MemFree),
        swapTotal: kb.SwapTotal || 0,
        swapUsed: (kb.SwapTotal || 0) - (kb.SwapFree || 0),
    };
}

export function parseNet(dev) {
    let rx = 0;
    let tx = 0;
    for (const line of dev.split('\n').slice(2)) {
        const [iface, rest] = line.split(':');
        if (!rest || VIRTUAL_IFACE.test(iface.trim())) continue;
        const v = rest.trim().split(/\s+/).map(Number);
        rx += v[0];
        tx += v[8];
    }
    return { rx, tx };
}

const read = file => fs.readFile(file, 'utf8');

export async function systemStats() {
    if (process.platform !== 'linux') throw new Error('system stats are only available when the bot runs on Linux');

    const [stat1, net1] = await Promise.all([read('/proc/stat'), read('/proc/net/dev')]);
    const started = Date.now();
    await new Promise(r => setTimeout(r, SAMPLE_MS));
    const [stat2, net2, meminfo] = await Promise.all([read('/proc/stat'), read('/proc/net/dev'), read('/proc/meminfo')]);
    const seconds = (Date.now() - started) / 1000;

    const a = parseCpu(stat1);
    const b = parseCpu(stat2);
    const busy = b.total - a.total ? 1 - (b.idle - a.idle) / (b.total - a.total) : 0;

    const n1 = parseNet(net1);
    const n2 = parseNet(net2);

    let disk = null;
    try {
        const s = await fs.statfs('/');
        disk = { total: s.blocks * s.bsize, used: (s.blocks - s.bavail) * s.bsize };
    } catch {
        // statfs needs Node 18.15+; leave the disk out rather than fail
    }

    return {
        cpu: { usage: Math.max(0, Math.min(1, busy)), cores: os.cpus().length, load: os.loadavg() },
        memory: parseMem(meminfo),
        disk,
        network: { rxRate: (n2.rx - n1.rx) / seconds, txRate: (n2.tx - n1.tx) / seconds, rxTotal: n2.rx, txTotal: n2.tx },
        uptimeSeconds: os.uptime(),
        hostname: os.hostname(),
    };
}
