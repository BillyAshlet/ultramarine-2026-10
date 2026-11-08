// Where along the fuselage is the gas hot, above and below the wing's level?
// node tools/where-hot.mjs name1 name2 ... (needs each run's saved volume)
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../results');
const CELL = 0.5, NX = 68, NY = 44, NZ = 56, NOSE = 1, TAIL = 31.5, CZ = 11, CY = 3.08, R = 1.88, WING_TOP = 2.5;
for (const name of process.argv.slice(2)) {
  const b = readFileSync(join(dir, `${name}.bin`));
  let n = 0, lowHot = 0, highHot = 0, lowGap = Infinity, highGap = Infinity;
  for (let k = 1; k <= NZ; k++) for (let j = 1; j <= NY; j++) for (let i = 1; i <= NX; i++, n++) {
    const T = (b[n] / 255) ** 2 * 1000;
    if (T < 300) continue;
    const x = (i - 0.5) * CELL, y = (j - 0.5) * CELL, z = (k - 0.5) * CELL;
    if (x < NOSE || x > TAIL) continue;
    const gap = Math.max(0, Math.hypot(y - CY, z - CZ) - R);
    if (y <= WING_TOP) { lowGap = Math.min(lowGap, gap); if (gap < CELL) lowHot++; }
    else { highGap = Math.min(highGap, gap); if (gap < CELL) highHot++; }
  }
  const f = (g) => (g === Infinity ? 'none' : g.toFixed(2));
  console.log(name.padEnd(14), 'at or below wing: gap', f(lowGap), 'cells', String(lowHot).padStart(4), '| above wing: gap', f(highGap), 'cells', String(highHot).padStart(4));
}
