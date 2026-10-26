// Dragonwilds XP table, from https://dragonwilds.runescape.wiki/w/Experience
// XP_TABLE[level - 1] is the total XP needed to reach that level.
const XP_TABLE = [
    0, 33, 70, 111, 156, 206, 261, 322, 389, 463,
    545, 636, 736, 847, 969, 1104, 1253, 1417, 1598, 1798,
    2018, 2261, 2529, 2825, 3152, 3512, 3910, 4349, 4833, 5367,
    5957, 6608, 7326, 8118, 8993, 9958, 11023, 12199, 13496, 14929,
    16510, 18255, 20181, 22307, 24654, 27245, 30105, 33262, 36747, 40594,
    44581, 48717, 52997, 57421, 61990, 66702, 71560, 76562, 81708, 86998,
    92433, 98012, 103735, 109603, 115616, 121772, 128073, 134518, 141108, 147842,
    154721, 161743, 168910, 176222, 183678, 191278, 199022, 206911, 214944, 223122,
    231444, 239910, 248521, 257276, 266176, 275219, 284407, 293740, 303217, 312838,
    322604, 332514, 342568, 395129, 447689, 543044, 666881, 819200, 1000000,
];

export const MAX_LEVEL = XP_TABLE.length;

export function levelInfo(xp) {
    xp = Math.max(0, xp | 0);
    let level = 1;
    while (level < MAX_LEVEL && xp >= XP_TABLE[level]) level++;

    const floor = XP_TABLE[level - 1];
    if (level >= MAX_LEVEL) {
        return { level, xp, maxed: true, floor, next: null, remaining: 0, progress: 1 };
    }

    const next = XP_TABLE[level];
    return { level, xp, maxed: false, floor, next, remaining: next - xp, progress: (xp - floor) / (next - floor) };
}
