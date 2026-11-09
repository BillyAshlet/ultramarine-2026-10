// One run: node tools/run.mjs '{"name":"...","wind":2,"yaw":40,"aircraft":true,...}'
// Averages temperature once the fire has settled, measures it, and writes the
// numbers and an 8-bit copy of the averaged temperature to results/mac/ (the
// heat-keeping solver, windmac.js, the default) or, with "solver":"old", to
// results/ (fluid3d.js + windy.js, which makes heat; kept to compare).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WindyFire, buildScene } from '../src/windy.js';
import { WindyMacFire } from '../src/windmac.js';

const here = dirname(fileURLToPath(import.meta.url));
const o = {
  solver: 'mac', cell: 0.5, size: { x: 34, y: 22, z: 28 }, wind: 0, yaw: 90, aircraft: false,
  heatRelease: 38e6, radiantFraction: 0.3, burnTime: 1.5,
  dt: 0.04, seconds: 40, averageFrom: 20, iterations: 30, vorticity: 0, smagorinsky: 0.2,
  ...JSON.parse(process.argv[2]),
};

const scene = buildScene(o);
// Yaw is the angle off the nose the wind comes from, on the left side.
const a = o.yaw * Math.PI / 180;
const wind = { x: o.wind * Math.cos(a), z: -o.wind * Math.sin(a) };
const Fire = o.solver === 'old' ? WindyFire : WindyMacFire;
const out = join(here, o.solver === 'old' ? '../results' : '../results/mac');
const f = new Fire({ ...scene, wind, heatRelease: o.heatRelease, radiantFraction: o.radiantFraction, burnTime: o.burnTime, smagorinsky: o.smagorinsky });
f.dt = o.dt; f.iterations = o.iterations;
if (o.solver === 'old') f.vorticity = o.vorticity;

const mean = new Float64Array(f.size);
let samples = 0, peakSpeed = 0;
const t0 = Date.now();
const steps = Math.round(o.seconds / o.dt);
for (let s = 0; s < steps; s++) {
  f.step();
  if (f.time >= o.averageFrom) {
    for (let n = 0; n < f.fluid.length; n++) { const c = f.fluid[n]; mean[c] += f.temp[c]; }
    samples++;
  }
  if (s % 50 === 0) {
    let bad = false;
    for (let n = 0; n < f.fluid.length; n += 7) {
      const c = f.fluid[n];
      if (!Number.isFinite(f.temp[c]) || !Number.isFinite(f.v[c])) { bad = true; break; }
      peakSpeed = Math.max(peakSpeed, Math.hypot(f.u[c], f.v[c], f.w[c]) * o.cell);
    }
    if (bad) { console.error(o.name, 'blew up at', f.time); process.exit(1); }
  }
}
for (let i = 0; i < mean.length; i++) mean[i] /= samples;

const { nx, ny, nz, cell, W, H, solid, centre, fuselage } = scene;
const idx = (i, j, k) => i + W * j + W * H * k;
const at = (i) => (i - 0.5) * cell;

// The fire's lean: where the heat is, height by height, against the pool centre.
// Only slices the heat has clearly reached count, and the fit goes through the
// pool, so the answer is one angle for the whole lower plume.
const slices = [];
for (let j = 2; j <= ny; j++) {
  let sum = 0, sx = 0, sz = 0, peak = 0;
  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const T = mean[idx(i, j, k)];
    if (T < 20) continue;
    sum += T; sx += T * at(i); sz += T * at(k); peak = Math.max(peak, T);
  }
  if (sum > 0) slices.push({ y: at(j), x: sx / sum, z: sz / sum, peak });
}
const drift = slices.filter((s) => s.y >= 3 && s.y <= 12);
const lean = drift.length
  ? Math.atan2(drift.reduce((t, s) => t + Math.hypot(s.x - centre.x, s.z - centre.z) * s.y, 0) / drift.reduce((t, s) => t + s.y * s.y, 0), 1) * 180 / Math.PI
  : null;

// Against the aeroplane: how hot is the air touching the near side of the
// fuselage, and how far is the hot gas from it.
let touching = 0, hot300 = 0, hot150 = 0, peakAtSkin = 0, gap = null;
if (o.aircraft) {
  const skin = [];
  const offsets = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const { NOSE, TAIL, CZ, CY, R } = fuselage;
  const isHull = (i, j, k) => {
    const x = at(i), y = at(j), z = at(k);
    return x > NOSE && x < TAIL && Math.hypot(y - CY, z - CZ) < R + 0.01;
  };
  for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    const c = idx(i, j, k);
    if (solid[c]) continue;
    if (offsets.some(([a, b, d]) => solid[idx(i + a, j + b, k + d)] && isHull(i + a, j + b, k + d))) skin.push([i, j, k, c]);
  }
  for (const [, , , c] of skin) {
    touching++;
    if (mean[c] > 300) hot300++;
    if (mean[c] > 150) hot150++;
    peakAtSkin = Math.max(peakAtSkin, mean[c]);
  }
  // Distance from any gas above 300 degrees to the skin, over the rear half.
  let best = Infinity;
  for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    if (mean[idx(i, j, k)] < 300) continue;
    for (const [a, b, d] of skin) {
      const dist = Math.hypot(a - i, b - j, d - k) * cell;
      if (dist < best) best = dist;
    }
  }
  gap = best === Infinity ? null : best;
}

// Centreline temperature for comparing a still plume with the textbook.
const centreline = slices.map((s) => ({ y: s.y, peak: Math.round(s.peak), x: +s.x.toFixed(2), z: +s.z.toFixed(2) }));

const result = {
  name: o.name, solver: o.solver, wind: o.wind, yaw: o.yaw, aircraft: o.aircraft, cell: o.cell, burnTime: o.burnTime, dt: o.dt,
  iterations: o.iterations, vorticity: o.vorticity, smagorinsky: o.smagorinsky, size: { nx, ny, nz },
  leanDegrees: lean === null ? null : +lean.toFixed(1), peakSpeed: +peakSpeed.toFixed(1),
  skin: o.aircraft ? { touching, hot300, hot150, peak: Math.round(peakAtSkin), gapMetres: gap === null ? null : +gap.toFixed(2) } : undefined,
  centreline, seconds: o.seconds, wallSeconds: Math.round((Date.now() - t0) / 1000),
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${o.name}.json`), JSON.stringify(result));
if (o.saveVolume !== false) {
  const bytes = new Uint8Array(nx * ny * nz);
  let n = 0;
  for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++, n++) {
    // Square root, so the plume's cool edge keeps its precision: 255 is 1000 degrees.
    bytes[n] = Math.min(255, Math.sqrt(Math.max(0, mean[idx(i, j, k)]) / 1000) * 255);
  }
  writeFileSync(join(out, `${o.name}.bin`), bytes);
}
console.log(o.name, 'lean', result.leanDegrees, 'peak', result.peakSpeed, 'skin', JSON.stringify(result.skin), `${result.wallSeconds}s`);
