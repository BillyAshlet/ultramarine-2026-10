// How much do the answers depend on what we do not know?
//  - where the pool's inner edge was: 1, 2 or 3 m further out than the first guess
//    would be 2.1, 3.1 m from the fuselage instead of 1.1 m;
//  - the grid: the same fire on a finer one.
// Fire settings stay frozen, as in sweep.mjs.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const base = { smagorinsky: 0.4, burnTime: 3, seconds: 40, averageFrom: 20, saveVolume: false, aircraft: true };
const jobs = [];
for (const poolOffset of [1, 2]) for (const wind of [0, 1, 1.5, 2, 2.5, 3, 3.5]) {
  jobs.push({ name: `off${poolOffset}-w${wind}`, wind, yaw: 90, poolOffset, ...base });
}
for (const wind of [0, 2]) jobs.push({ name: `fine-w${wind}`, wind, yaw: 90, cell: 0.35, dt: 0.03, ...base });

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
console.log('SENSITIVITY DONE');
