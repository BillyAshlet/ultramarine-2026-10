// Checks for gas.js (task D), in node:
//   node tools/gas-check.mjs [part=all] [seconds=180]
//   part: lines | lag | run | all
// lines: each unit's line, the boiler valve, flows from a cut, a leak, the failed valve.
// lag:   the boiler valve's temperature under the ISO 834 fire curve (the TU München point).
// run:   cut the gas line in A205 Utility with no fire; watch the gas rise and gather;
//        then light the igniter in the room: deflagration, the steady gas fire, the valve.
//        The books (released = in the air + burned + lost) at every report, the range
//        of concentrations that burned, and what gas.js costs per step.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import gas from '../src/gas.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const [part = 'all', seconds = 180] = process.argv.slice(2).map((a, i) => (i === 1 ? Number(a) : a));
const outJson = process.env.GAS_CHECK_OUT;   // where to write the run's time series, if set

const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));

function setup() {
  const grid = buildGrid(building, 0.2);
  const fire = new HouseFire({ grid, pool: new Int32Array(0), growth: GROWTH.medium });
  const objects = buildObjects(meta, grid, materials);
  const world = new World({ fire, grid, objects, rooms: meta.rooms, materials });
  world.add('gas', gas(world));
  const events = [];
  world.events.on((e) => events.push(e));
  return { grid, fire, objects, world, g: world.gas, events };
}
const C = (k) => +(k + 293 - 273).toFixed(0);

// --- lines ---------------------------------------------------------------------------
if (part === 'lines' || part === 'all') {
  const { g, world } = setup();
  console.log('== lines');
  for (const u of Object.values(g.units)) {
    const len = u.nodes.filter((n) => !n.fitting).reduce((s, n) => s + n.length, 0);
    console.log(`Unit ${u.name}: ${u.nodes.length} pieces, ${len.toFixed(1)} m of pipe; entry ${u.entry.o.id}, meter at ${u.meterPos.map((p) => p.toFixed(2))}; boiler valve on ${u.end.o.id} (${u.end.o.room}, ${u.end.o.cells.length} air cells)`);
  }
  console.table(g.pipes());
  for (const p of g.pipes()) {
    const r = g.cut(p.id);
    console.log(`cut ${p.id}${p.inGrid ? '' : ' (off grid)'}: ${r.m3PerHour} m³/h, ${r.kW} kW if lit`);
    world.reset();
  }
  console.log('5 % leak on e569:', g.leak('e569', 0.05)); world.reset();
  console.log('boiler valve A leaking:', g.fail('A', 1)); console.log('then burnt through:', g.fail('A', 2)); world.reset();
  g.cut('e569'); g.cut('e565');
  console.log('two cuts, one per unit:', JSON.stringify(g.status()));
  g.cut('e1035');
  console.log('a second cut in unit A:', JSON.stringify(g.status()));
  console.log('valve(false):', g.valve(false), JSON.stringify(g.status().units));
}

// --- lag -----------------------------------------------------------------------------
if (part === 'lag' || part === 'all') {
  const { g, world, fire, events } = setup();
  console.log('== boiler valve under ISO 834');
  const iso = (t) => 345 * Math.log10(8 * t / 60 + 1) + 20;   // °C, t in s
  const p = g.units.A.end;
  const dt = 0.5;
  let t = 0;
  const marks = [];
  for (; t <= 3600; t += dt) {
    for (const c of p.o.cells) fire.temp[c] = iso(t) + 273 - 293;
    world.run('react', dt);
    if (Math.abs(t - 1500) < dt / 2) marks.push(`25 min: air ${iso(t).toFixed(0)} °C, valve ${g.parts().find((q) => q.unit === 'A').c} °C (test: room 819, part 692)`);
  }
  for (const e of events) console.log(e.type, JSON.stringify(e.data));
  console.log(marks.join('\n'));
  // When each stage was reached (react is driven by hand here, so read the part's own clock).
  world.reset();
  let stage = 0;
  for (t = 0; t <= 3600; t += dt) {
    for (const c of p.o.cells) fire.temp[c] = iso(t) + 273 - 293;
    world.run('react', dt);
    const s = g.parts().find((q) => q.unit === 'A').stage;
    if (s !== ['intact', 'leaking', 'burnt through'][stage]) { console.log(`${s} at ${(t / 60).toFixed(1)} min, air ${iso(t).toFixed(0)} °C`); stage++; }
  }
}

// --- run -----------------------------------------------------------------------------
if (part === 'run' || part === 'all') {
  const { g, world, fire, grid, events } = setup();
  console.log('== run: cut e569 in A205 Utility, no fire');
  const room = meta.rooms.find((r) => r.code === 'A205');
  const { origin, cell, index } = grid;
  // The room's air cells, by height.
  const layers = new Map();
  for (let k = 1; k <= grid.nz; k++) for (let i = 1; i <= grid.nx; i++) for (let j = 1; j <= grid.ny; j++) {
    const x = origin.x + (i - 0.5) * cell, y = origin.y + (j - 0.5) * cell, z = origin.z + (k - 0.5) * cell;
    if (x < room.min[0] || x > room.max[0] || z < room.min[2] || z > room.max[2] || y < room.min[1] || y > room.max[1]) continue;
    const c = index(i, j, k);
    if (grid.solid[c]) continue;
    if (!layers.has(j)) layers.set(j, { y, cells: [] });
    layers.get(j).cells.push(c);
  }
  const profile = () => [...layers.values()].sort((a, b) => b.y - a.y)
    .map((l) => ({ y: +l.y.toFixed(1), pct: +(100 * l.cells.reduce((s, c) => s + g.field[c], 0) / l.cells.length).toFixed(2) }));
  const series = [];
  const cut = g.cut('e569');
  console.log('cut:', cut);
  const steps = Math.round(seconds / fire.dt);
  let ms = 0, msSteps = 0, worstGap = 0;
  for (let s = 1; s <= steps; s++) {
    const t0 = performance.now();
    world.step();
    const t1 = performance.now();
    ms += world.modules[0].ms ?? 0;
    msSteps++;
    if (s % Math.round(10 / fire.dt) === 0) {
      const b = g.books();
      worstGap = Math.max(worstGap, Math.abs(b.unaccounted) / Math.max(b.released, 1e-12));
      const pk = g.peak();
      const prof = profile();
      series.push({ t: +fire.time.toFixed(1), phase: 'leak', released: b.released, inAir: b.inAir, burned: b.burnedDeflagration + b.burnedAtOutlets, peak: pk.peakPercent, burnableM3: pk.burnableM3, profile: prof });
      if (s % Math.round(30 / fire.dt) === 0) console.log(`t ${fire.time.toFixed(0)} s: released ${b.released.toFixed(3)} m³, in air ${b.inAir.toFixed(3)}, unaccounted ${b.unaccounted.toExponential(2)}; peak ${pk.peakPercent} %, burnable ${pk.burnableM3} m³; room top→bottom ${prof.slice(0, 6).map((l) => l.pct).join(' ')} … ${prof.at(-1).pct} %; step ${(t1 - t0).toFixed(0)} ms`);
    }
  }
  console.log(`gas.js: ${(ms / msSteps).toFixed(2)} ms per step (world.timings, smoothed) while leaking`);

  console.log('== light the igniter in A205, 1 m from the break');
  const pos = [(room.min[0] + room.max[0]) / 2, room.min[1], (room.min[2] + room.max[2]) / 2];
  fire.setPool(poolAt(grid, pos[0], pos[2], room.min[1], 0.4));
  const before = events.length;
  let worstMs = 0;
  for (let s = 1; s <= Math.round(60 / fire.dt); s++) {
    world.step();
    worstMs = Math.max(worstMs, world.modules[0].stepMs ?? 0);
    if (s % Math.round(5 / fire.dt) === 0) {
      const b = g.books();
      worstGap = Math.max(worstGap, Math.abs(b.unaccounted) / b.released);
      series.push({ t: +fire.time.toFixed(1), phase: 'fire', released: b.released, inAir: b.inAir, burned: b.burnedDeflagration + b.burnedAtOutlets, peak: g.peak().peakPercent, burnableM3: g.peak().burnableM3, profile: profile(), hrr: g.status().outlets[0]?.lit ? g.status().outlets[0].kW : 0 });
    }
  }
  for (const e of events.slice(before)) console.log(`  ${e.time.toFixed(1)} s ${e.type}`, JSON.stringify(e.data));
  console.log(`gas.js with the fire: ${(world.modules[0].ms ?? 0).toFixed(2)} ms per step at the end, worst single step ${worstMs.toFixed(2)} ms`);
  const b = g.books();
  console.log('books:', JSON.stringify(b, (k, v) => (typeof v === 'number' ? +v.toPrecision(5) : v)));
  console.log(`burned concentrations: ${(100 * (b.lowestBurned ?? NaN)).toFixed(2)} – ${(100 * (b.highestBurned ?? NaN)).toFixed(2)} % (limits ${100 * g.params.lfl}–${100 * g.params.ufl} %)`);
  console.log('status:', JSON.stringify(g.status()));
  g.valve('A', false);
  for (let s = 0; s < Math.round(10 / fire.dt); s++) world.step();
  const b2 = g.books();
  console.log(`valve A shut: released ${b2.released.toFixed(4)} m³ (was ${b.released.toFixed(4)} 10 s earlier: +${(b2.released - b.released).toFixed(4)}), outlet ${JSON.stringify(g.status().outlets)}, hrr on e569 ${world.objects.byId.get('e569').hrr} W`);
  console.log(`worst unaccounted share over the run: ${worstGap.toExponential(2)}`);
  if (outJson) writeFileSync(outJson, JSON.stringify({ cut, series, events: events.map((e) => ({ t: e.time, type: e.type, data: e.data })) }));
}
