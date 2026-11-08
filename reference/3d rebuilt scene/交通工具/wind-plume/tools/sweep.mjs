// The whole wind sweep, eight runs at a time.
//
// Frozen before any wind run: smagorinsky 0.4, burnTime 3, chosen so a still
// plume matches Heskestad's correlation near the flame tip. Do not retune these
// against the wind results or the paper; that would make the comparison circular.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = { smagorinsky: 0.4, burnTime: 3, seconds: 40, averageFrom: 20 };
const jobs = [];
for (const wind of [0, 1, 2, 3, 4]) jobs.push({ name: `free-w${wind}`, wind, yaw: 90, aircraft: false, saveVolume: false, ...base });
for (const yaw of [90, 40]) for (const wind of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) jobs.push({ name: `ac-y${yaw}-w${wind}`, wind, yaw, aircraft: true, ...base });

let next = 0;
const worker = () => new Promise((done) => {
  const go = () => {
    if (next >= jobs.length) return done();
    const job = jobs[next++];
    const p = spawn('node', [join(here, 'run.mjs'), JSON.stringify(job)], { stdio: 'inherit' });
    p.on('exit', go);
  };
  go();
});
await Promise.all(Array.from({ length: 8 }, worker));
console.log('SWEEP DONE');
