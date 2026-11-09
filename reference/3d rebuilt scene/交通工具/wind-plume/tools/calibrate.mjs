// Fix the fire's two free settings against a textbook still plume, before any
// wind run, for the heat-keeping solver (windmac.js).
//
// The old solver's pair (smagorinsky 0.4, burnTime 3) was chosen on a solver
// that made heat, so it is checked again here, along with the Duplex's pair
// (0.2, 0.5, chosen on mac3d.js against Heskestad at 150 kW) and their
// neighbours. The rule, written before any of these ran: take the pair whose
// centreline temperature is closest to Heskestad's above the flame tip (12 to
// 20 m), by the mean of |log(solver / Heskestad)|. Then freeze it in sweep.mjs
// and sensitivity.mjs, and never retune it against the wind results or the paper.
//
// node tools/calibrate.mjs        runs the six, then prints the comparison
// node tools/calibrate.mjs show   only prints it
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jobs = [];
for (const smagorinsky of [0.2, 0.4]) for (const burnTime of [0.5, 1.5, 3]) {
  jobs.push({ name: `cal-cs${Math.round(smagorinsky * 100)}-tau${burnTime}`, wind: 0, aircraft: false, saveVolume: false, smagorinsky, burnTime, seconds: 40, averageFrom: 20 });
}
if (process.argv[2] !== 'show') {
  let next = 0;
  const worker = () => new Promise((done) => {
    const go = () => {
      if (next >= jobs.length) return done();
      const p = spawn('node', [join(here, 'run.mjs'), JSON.stringify(jobs[next++])], { stdio: 'inherit' });
      p.on('exit', go);
    };
    go();
  });
  await Promise.all(Array.from({ length: 8 }, worker));
}

// Heskestad (SFPE Handbook): flame height L = 0.235 Q^0.4 - 1.02 D, virtual origin
// z0 = 0.083 Q^0.4 - 1.02 D, centreline excess temperature 9.1 (T/(g cp^2 rho^2))^(1/3) Qc^(2/3) (z - z0)^(-5/3)
// = 24.9 Qc^(2/3) (z - z0)^(-5/3) at ambient 293 K, and centreline velocity
// 3.4 (g / (cp rho T))^(1/3) Qc^(1/3) (z - z0)^(-1/3) = 1.03 Qc^(1/3) (z - z0)^(-1/3); Q, Qc in kW.
const Q = 38000, Qc = 26600, D = Math.sqrt(16 * 4 / Math.PI);
const z0 = -1.02 * D + 0.083 * Q ** 0.4, L = 0.235 * Q ** 0.4 - 1.02 * D;
const hT = (z) => 24.9 * Qc ** (2 / 3) * (z - z0) ** (-5 / 3);
const HEIGHTS = [12.25, 14.25, 16.25, 18.25, 20.25];
console.log(`Heskestad: flame height ${L.toFixed(1)} m, virtual origin ${z0.toFixed(2)} m, centreline velocity at the flame tip ${(1.03 * Qc ** (1 / 3) * (L - z0) ** (-1 / 3)).toFixed(1)} m/s`);
console.log('name | ' + HEIGHTS.map((y) => `${y} m solver/Heskestad`).join(' | ') + ' | mean |log| | peak speed');
const rows = [];
for (const { name } of jobs) {
  const file = join(here, '../results/mac', `${name}.json`);
  if (!existsSync(file)) continue;
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const at = HEIGHTS.map((y) => r.centreline.find((s) => s.y === y)?.peak ?? NaN);
  const score = at.reduce((t, T, n) => t + Math.abs(Math.log(T / hT(HEIGHTS[n]))), 0) / at.length;
  rows.push({ name, score });
  console.log(`${name} | ` + at.map((T, n) => `${T}/${Math.round(hT(HEIGHTS[n]))}`).join(' | ') + ` | ${score.toFixed(3)} | ${r.peakSpeed}`);
}
rows.sort((a, b) => a.score - b.score);
if (rows.length) console.log('closest:', rows[0].name);
