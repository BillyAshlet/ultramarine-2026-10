// Checks for radiation.js (task C), in node:
//   node tools/radiation-check.mjs [seconds=420]
// 1. The point source against Babrauskas 1981 (NBSIR 81-2271, table 2): how
//    far from a burning item 10, 20 and 40 kW/m² reach.
// 2. The smoke layer against the sum it stands for (CFAST's soot absorption).
// 3. In the Duplex: a burning sofa (fake: hrr set by hand, task B not needed)
//    and the flux on the furniture round it.
// 4. In the Duplex: the living room heated by a 2 MW fire; its upper layer,
//    floor flux and when it flashes over; what radiation.js costs per step.
//    seconds=0 skips this (it takes about 8 minutes for 420 s) and keeps the
//    last run's numbers in the json.
// 5. The flashover rule itself: the living room's upper air set to 600 °C by
//    hand; does it send 轰燃 and set every combustible in the room alight?
// Writes radiation-check.json next to 进度/C/C.md for the figures.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import radiation, { pointSource, faceFlux, layerFlux, PARAMS } from '../src/radiation.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const out = join(here, '../../进度/C/radiation-check.json');
const [seconds = 420] = process.argv.slice(2).map(Number);
const results = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : {};

// --- 1. Babrauskas 1981 -------------------------------------------------------------
// Table 2: peak mass loss rate (g/s), gauge side, and the farthest distance
// (m, from the item) at which 10 / 20 / 40 kW/m² were reached; gauges 0.41 m up.
// Specimen sizes are not given except F09 and F11; a sofa-sized box stands
// in for the couch and two-seater, an armchair-sized one for the chairs (假设).
const SOFA = [1.83, 0.81, 0.66], CHAIR = [0.8, 0.85, 0.8];
const TABLE2 = [
  ['F19 hospital couch', 47, 'front', SOFA, [1.38, 0.88, 0.40]],
  ['F05 two-seater', 36, 'side', SOFA, [0.93, 0.54, 0.44]],
  ['F04 armchair', 27, 'side', CHAIR, [0.50, 0.29, 0.14]],
  ['F16 easy chair', 22, 'side', CHAIR, [1.33, 0.79, 0.20]],
  ['F17 pedestal chair', 20, 'side', CHAIR, [1.37, 0.44, 0.20]],
  ['F17 pedestal chair', 18, 'front', CHAIR, [0.74, 0.43, 0.10]],
  ['F15 armchair', 12, 'side', CHAIR, [0.84, 0.29, 0.12]],
];
const HEAT = [15.6, 17, 18.5];   // MJ/kg, NIST TN 2303 sofas; 17 is the engine's value
const CHI = 0.4;                 // materials.json sofa

/** Farthest distance (m) from the item's face at which a gauge 0.41 m up, facing it, gets `level`. */
function reach(size, Q, gauge, level) {
  const [sx, sy, sz] = size;
  const s = pointSource([0, 0, 0], [sx, sy, sz], Q, CHI, 2.6);
  let best = 0;
  for (let d = 0.0; d <= 5; d += 0.005) {
    // A 1 cm gauge facing the item: front looks at the long face (+z), side at the end (+x).
    const min = gauge === 'front' ? [sx / 2 - 0.005, 0.405, sz + d] : [sx + d, 0.405, sz / 2 - 0.005];
    const max = gauge === 'front' ? [sx / 2 + 0.005, 0.415, sz + d + 0.01] : [sx + d + 0.01, 0.415, sz / 2 + 0.005];
    const f = gauge === 'front' ? 2 : 0;   // the gauge's face looking back at the item (low side)
    if (faceFlux(s, min, max, f) >= level) best = d;
  }
  return best;
}
console.log('== 1. Babrauskas 1981 table 2: distance (m) to 10 / 20 / 40 kW/m², measured vs model');
console.log(`   model: chi_r ${CHI}, Q = peak mass loss rate x ${HEAT.join(' / ')} MJ/kg`);
results.babrauskas = [];
for (const [name, mdot, gauge, size, measured] of TABLE2) {
  const model = HEAT.map((h) => [10, 20, 40].map((lvl) => reach(size, mdot * h * 1e3, gauge, lvl)));
  results.babrauskas.push({ name, mdot, gauge, measured, model, kW: HEAT.map((h) => mdot * h) });
  const mid = model[1];
  console.log(`   ${name.padEnd(20)} ${String(mdot).padStart(2)} g/s ${gauge.padEnd(5)} ~${(mdot * 17 / 1000).toFixed(2)} MW  ` +
    `measured ${measured.map((v) => v.toFixed(2)).join(' / ')}   model ${mid.map((v) => v.toFixed(2)).join(' / ')}` +
    `   (range ${[0, 1, 2].map((i) => `${model[0][i].toFixed(2)}–${model[2][i].toFixed(2)}`).join(', ')})`);
}
// The same model for the Duplex's own items at their measured peaks.
results.duplexItems = [];
for (const [name, Q, size] of [['sofa (NIST test 40)', 2217e3, SOFA], ['queen bed (test 38)', 4563e3, [2.01, 0.64, 1.52]], ['tall cabinet (NBS 61)', 1.9e6, [0.8, 2.0, 0.55]]]) {
  const d = [10, 20, 40].map((lvl) => reach(size, Q, 'front', lvl));
  results.duplexItems.push({ name, Q, d });
  console.log(`   ${name.padEnd(24)} ${(Q / 1e6).toFixed(1)} MW front: ${d.map((v) => v.toFixed(2)).join(' / ')} m`);
}
// Flux against distance, for the figure.
results.curves = {};
for (const [name, Q] of [['0.8 MW (F19)', 0.8e6], ['2.2 MW sofa', 2.217e6]]) {
  results.curves[name] = [];
  const s = pointSource([0, 0, 0], SOFA, Q, CHI, 2.6);
  for (let d = 0.02; d <= 3; d += 0.02) {
    results.curves[name].push([+d.toFixed(2), faceFlux(s, [SOFA[0] / 2 - 0.005, 0.405, SOFA[2] + d], [SOFA[0] / 2 + 0.005, 0.415, SOFA[2] + d + 0.01], 2)]);
  }
}

// --- 2. smoke layer ------------------------------------------------------------------
console.log('\n== 2. smoke layer: a uniform layer over a floor, 600 °C');
{
  const cell = 0.2, sigma = PARAMS.sigma.value;
  const temp = new Float32Array(30), dens = new Float32Array(30), cells = Int32Array.from({ length: 30 }, (_, i) => i);
  results.layer = [];
  for (const [soot, thick] of [[0.3, 1.0], [1, 0.4], [1, 1.0], [3, 1.0], [10, 2.0]]) {
    const n = Math.round(thick / cell);
    temp.fill(580); dens.fill(soot);
    const q = layerFlux(cells, n, temp, dens, cell);
    // The same by hand: emissivity of the whole layer times sigma (T^4 - T0^4).
    const kappa = PARAMS.sootKappa.value * (soot / 1000 / PARAMS.sootDensity.value) * 873;
    const eps = 1 - Math.exp(-kappa * thick * PARAMS.pathFactor.value);
    const byHand = (eps * sigma * (873 ** 4 - 293 ** 4)) / 1e3;
    results.layer.push({ soot, thick, q, byHand, eps });
    console.log(`   soot ${String(soot).padStart(4)} g/m³, ${thick} m thick: kappa ${kappa.toFixed(2)} /m, emissivity ${eps.toFixed(2)}, floor ${q.toFixed(1)} kW/m² (by hand ${byHand.toFixed(1)})`);
  }
  console.log(`   black body at 600 °C: ${(sigma * (873 ** 4 - 293 ** 4) / 1e3).toFixed(1)} kW/m²`);
}

// --- the Duplex ------------------------------------------------------------------------
const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const grid = buildGrid(building, 0.2);
const rooms = meta.rooms.filter((r) => r.code !== 'R301');
const gap = (a, b) => Math.sqrt([0, 1, 2].reduce((s, i) => s + Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i]) ** 2, 0));

// --- 3. a burning sofa ------------------------------------------------------------------
console.log('\n== 3. sofa e159 (A102) burning at 2.2 MW, cold air: flux on what is round it');
{
  const fire = new HouseFire({ grid, pool: new Int32Array(0) });
  const objects = buildObjects(meta, grid, materials);
  const world = new World({ fire, grid, objects, rooms, materials });
  world.add('radiation', radiation(world));
  world.events.on(() => {});
  const sofa = objects.byId.get('e159');
  sofa.hrr = 2217e3; sofa.state = '燃烧';
  world.run('transfer', fire.dt);
  const near = objects.list.filter((o) => o !== sofa && o.flux > 0.5).sort((a, b) => b.flux - a.flux);
  results.sofa = near.map((o) => ({ id: o.id, label: o.label, room: o.room, gap: gap(o, sofa), flux: o.flux, ignition: materials[o.material]?.criticalFlux?.value ?? null }));
  for (const r of results.sofa.slice(0, 14)) {
    console.log(`   ${r.id.padEnd(5)} ${String(r.label).padEnd(22)} ${String(r.room).padEnd(17)} gap ${r.gap.toFixed(2)} m  flux ${r.flux.toFixed(1).padStart(5)} kW/m²` +
      (r.ignition ? `  (critical ${r.ignition}: ${r.flux >= r.ignition ? 'above' : 'below'})` : ''));
  }
  const other = objects.list.filter((o) => o.flux > 0.5 && o.room && !o.room.startsWith('A102'));
  console.log(`   outside A102 with flux > 0.5 kW/m²: ${other.length ? other.map((o) => `${o.id} ${o.room} ${o.flux.toFixed(1)}`).join(', ') : 'none'}`);
}

// --- 4. a 2 MW fire in the living room: layer, floor, flashover, cost ------------------
if (seconds > 0) {
  console.log(`\n== 4. A102 living room, a 2 MW fast t² fire on the sofa's spot, ${seconds} s`);
  const sofaBox = meta.elements[159];
  const x = (sofaBox.min[0] + sofaBox.max[0]) / 2, z = (sofaBox.min[2] + sofaBox.max[2]) / 2;
  const fire = new HouseFire({ grid, pool: poolAt(grid, x, z, 0.02, 1.0), growth: 0.0469e3, peak: 2e6 });
  const objects = buildObjects(meta, grid, materials);
  const world = new World({ fire, grid, objects, rooms, materials });
  const rad = radiation(world);
  world.add('radiation', rad);
  const events = [];
  world.events.on((e) => events.push(e));
  const ms = [];
  results.room = [];
  const living = rad.rooms.find((r) => r.code === 'A102');
  const steps = Math.round(seconds / fire.dt);
  for (let s = 0; s < steps; s++) {
    world.step();
    const m = world.modules[0];
    ms.push(m.stepMs);
    if (s % 100 === 0 || (living.flashedAt != null && results.room.at(-1)?.flashed == null)) {
      const coffee = objects.byId.get('e162');
      results.room.push({ t: +fire.time.toFixed(1), Q: fire.heatRelease(), layerC: living.layerC, floorFlux: living.floorFlux, coffee: coffee.flux, coffeeSmoke: coffee.fluxSmoke, flashed: living.flashedAt });
    }
  }
  for (const r of results.room.filter((_, i) => i % 2 === 0)) {
    console.log(`   t ${String(r.t).padStart(5)} s  fire ${(r.Q / 1e3).toFixed(0).padStart(4)} kW  upper layer ${r.layerC.toFixed(0).padStart(4)} °C  floor ${r.floorFlux.toFixed(1).padStart(5)} kW/m²  coffee table ${r.coffee.toFixed(1)} (smoke ${r.coffeeSmoke.toFixed(1)})`);
  }
  const fo = events.filter((e) => e.type === '轰燃');
  console.log(`   flashover events: ${fo.length ? fo.map((e) => `${e.data.room} at ${e.time.toFixed(1)} s by ${e.data.by} (${e.data.layerC} °C, ${e.data.floorFlux} kW/m², ${e.data.items} items)`).join('; ') : 'none'}`);
  console.log(`   ignited by flashover: ${events.filter((e) => e.type === '点燃').length}`);
  results.flashover = fo;
  const sorted = [...ms].sort((a, b) => a - b);
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  results.ms = { mean, p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted.at(-1), solver: world.solverMs };
  console.log(`   radiation.js per step: mean ${mean.toFixed(2)} ms, 95% ${results.ms.p95.toFixed(2)} ms, max ${results.ms.max.toFixed(2)} ms (solver ${world.solverMs.toFixed(1)} ms)`);
}

// --- 5. the flashover rule ---------------------------------------------------------------
console.log('\n== 5. flashover rule: A102 upper third set to 600 °C by hand');
{
  const fire = new HouseFire({ grid, pool: new Int32Array(0) });
  const objects = buildObjects(meta, grid, materials);
  const world = new World({ fire, grid, objects, rooms, materials });
  const rad = radiation(world);
  world.add('radiation', rad);
  const events = [];
  world.events.on((e) => events.push(e));
  const living = rad.rooms.find((r) => r.code === 'A102');
  for (const c of living.upper) fire.temp[c] = 580;   // K over 293: 600 °C
  world.run('transfer', fire.dt);
  world.run('react', fire.dt);
  const fo = events.filter((e) => e.type === '轰燃');
  const lit = events.filter((e) => e.type === '点燃').map((e) => objects.byId.get(e.objectId));
  console.log(`   轰燃 events: ${fo.map((e) => `${e.data.room} by ${e.data.by}, ${e.data.layerC} °C, floor ${e.data.floorFlux} kW/m²`).join('; ') || 'none'}`);
  console.log(`   set alight: ${lit.length} of ${living.members.length} combustibles in A102: ${lit.map((o) => `${o.id} ${o.label}`).join(', ')}`);
  console.log(`   other rooms flashed: ${rad.status().filter((r) => r.flashedAt != null && !r.room.startsWith('A102')).map((r) => r.room).join(', ') || 'none'}`);
  results.rule = { events: fo, lit: lit.map((o) => o.id), members: living.members.map((o) => o.id) };
}

writeFileSync(out, JSON.stringify(results, null, 1));
console.log(`\nwrote ${out}`);
