// Does the solver keep heat? node tools/budget.mjs '{"solver":"old","wind":0,...}'
//
// Two checks, both on the still or windy plume with no aircraft:
//  - running total: heat the fire has released (after radiation) against
//    heat in the domain (hot gas plus fuel not yet burned) plus heat carried
//    out across the open sides and top;
//  - steady state: the heat carried up through horizontal planes, averaged
//    over the settled part of the run. Above the flame, with nothing taking
//    heat out of the gas, every plane should carry what the fire releases
//    (38 MW less 30% radiated = 26.6 MW), minus whatever has already left
//    through the sides.
// "old" is fluid3d.js + windy.js (a collocated grid); its outflow is estimated
// from the wind and gas at the boundary layer. "mac" is windmac.js, which
// counts what it carries out exactly. Results: budget-log.txt.
import { WindyFire, buildScene } from '../src/windy.js';

const RHO = 1.2, CP = 1005;
const o = {
  solver: 'old', cell: 0.5, size: { x: 34, y: 22, z: 28 }, wind: 0, yaw: 90,
  heatRelease: 38e6, radiantFraction: 0.3, smagorinsky: 0.4,
  dt: 0.04, seconds: 30, averageFrom: 15, iterations: 30, vorticity: 0, planes: [2, 6, 10, 14, 18],
  ...JSON.parse(process.argv[2] || '{}'),
};
// Each solver's own frozen fire setting unless given: 3 s for the old, 0.5 s for the new.
o.burnTime ??= o.solver === 'mac' ? 0.5 : 3;
const scene = buildScene({ ...o, aircraft: false });
const a = o.yaw * Math.PI / 180;
const wind = { x: o.wind * Math.cos(a), z: -o.wind * Math.sin(a) };
const Fire = o.solver === 'mac' ? (await import('../src/windmac.js')).WindyMacFire : WindyFire;
const f = new Fire({ ...scene, wind, heatRelease: o.heatRelease, radiantFraction: o.radiantFraction, burnTime: o.burnTime, smagorinsky: o.smagorinsky });
f.dt = o.dt; f.iterations = o.iterations;
if (o.solver === 'old') f.vorticity = o.vorticity;

const { nx, ny, nz, cell, W, H } = scene;
const sy = W, sz = W * H;
const J = RHO * CP * cell ** 3;          // joules per kelvin-cell
const toW = RHO * CP * cell ** 2;        // watts per (m/s * K) over one cell face

let released = 0, left = 0;
const content = () => {
  let s = 0;
  for (let n = 0; n < f.fluid.length; n++) { const c = f.fluid[n]; s += f.temp[c] + f.fuel[c]; }
  return s * J;
};

// Heat through each open side of the domain this step, in joules, using the
// wind at the boundary face and the gas on its upwind side (outside counts as
// cold). For the old solver the wind sits at cell centres, so the face takes
// the boundary layer's own (the open cell beyond copies it).
const outflow = () => {
  let s = 0;
  const q = (c) => f.temp[c] + f.fuel[c];
  const face = (vel, inside) => (vel > 0 ? vel * q(inside) : 0);   // vel: outward, m/s; inflow brings ambient
  for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
    const lo = 1 + sy * j + sz * k, hi = nx + sy * j + sz * k;
    if (o.solver === 'mac') { s += face(-f.uf[lo], lo) + face(f.uf[hi + 1], hi); }
    else { s += face(-f.u[lo] * cell, lo) + face(f.u[hi] * cell, hi); }
  }
  for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
    const lo = i + sy * j + sz, hi = i + sy * j + sz * nz;
    if (o.solver === 'mac') { s += face(-f.wf[lo], lo) + face(f.wf[hi + sz], hi); }
    else { s += face(-f.w[lo] * cell, lo) + face(f.w[hi] * cell, hi); }
  }
  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const top = i + sy * ny + sz * k;
    if (o.solver === 'mac') s += face(f.vf[top + sy], top);
    else s += face(f.v[top] * cell, top);
  }
  return s * toW * f.dt;
};

// Upward heat flux through the plane between layers j and j+1 (cell faces).
const planeFlux = (y) => {
  const j = Math.round(y / cell);   // face between cell j (centre (j-0.5)cell) and j+1
  let s = 0;
  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const c = i + sy * j + sz * k, up = c + sy;
    const qd = f.temp[c] + f.fuel[c], qu = f.temp[up] + f.fuel[up];
    const v = o.solver === 'mac' ? f.vf[up] : 0.5 * (f.v[c] + f.v[up]) * cell;
    s += v * (v > 0 ? qd : qu);
  }
  return s * toW;
};

// Fuel released: replay the pool's own random numbers (same generator as
// step() in windy.js) to count exactly what it adds this step.
const released1 = () => {
  let seed = f.seed, sum = 0;
  for (let p = 0; p < f.pool.length; p++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    sum += f.dt * f.fuelRate * (0.6 + 0.8 * seed / 0x7fffffff);
  }
  return sum * J;
};
const flux = new Float64Array(o.planes.length);
let samples = 0;
const steps = Math.round(o.seconds / o.dt);
const t0 = Date.now();
for (let s = 0; s < steps; s++) {
  released += released1();
  f.step();
  // The new solver counts what it carries out exactly; the old one is estimated.
  if (o.solver === 'mac') { left = f.heatOut * J; } else left += outflow();
  if (f.time >= o.averageFrom) {
    o.planes.forEach((y, n) => { flux[n] += planeFlux(y); });
    samples++;
  }
  if ((s + 1) % Math.round(5 / o.dt) === 0) {
    const inside = content();
    console.log(`t ${f.time.toFixed(0)} s: released ${(released / 1e6).toFixed(0)} MJ, in domain ${(inside / 1e6).toFixed(0)} MJ, left ${(left / 1e6).toFixed(0)} MJ, accounted ${(100 * (inside + left) / released).toFixed(1)}%`);
  }
}
console.log(`${o.solver} wind ${o.wind}: heat carried up through planes, ${o.averageFrom}-${o.seconds} s average (fire releases ${(o.heatRelease * (1 - o.radiantFraction) / 1e6).toFixed(1)} MW after radiation):`);
console.log('  ' + o.planes.map((y, n) => `${y} m: ${(flux[n] / samples / 1e6).toFixed(1)} MW`).join('  '));
console.log(`  ${Math.round((Date.now() - t0) / 1000)} s`);
