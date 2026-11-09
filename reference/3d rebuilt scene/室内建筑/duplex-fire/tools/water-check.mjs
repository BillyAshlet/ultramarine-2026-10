// Checks for water.js (task E), in node:
//   node tools/water-check.mjs [seconds=120] [room=A102] [growth=fast]
// 1. The pipe network: pieces per unit, the entries, flows from a cut pipe.
// 2. The same fire twice, without and with a sprinkler over it.
// 3. The books: every kg released is in the air, evaporated, on the floor or
//    on furniture; the heat evaporation took out of the air equals the water
//    evaporated times its heat, measured on the field itself.
// 4. What water.js costs per step.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import water from '../src/water.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const [seconds = 120, roomCode = 'A102', growth = 'fast'] = process.argv.slice(2).map((a, i) => (i < 1 ? Number(a) : a));

const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const room = meta.rooms.find((r) => r.code === roomCode);
const cx = (room.min[0] + room.max[0]) / 2, cz = (room.min[2] + room.max[2]) / 2;

function setup() {
  const grid = buildGrid(building, 0.2);
  const fire = new HouseFire({ grid, pool: poolAt(grid, cx, cz, room.min[1]), growth: GROWTH[growth] });
  const objects = buildObjects(meta, grid, materials);
  const world = new World({ fire, grid, objects, rooms: meta.rooms, materials });
  world.add('water', water(world));
  world.events.on(() => {});   // quiet: events are counted below, not printed
  return { grid, fire, objects, world, w: world.water };
}

const heatInAir = (fire) => { let s = 0; for (const c of fire.fluid) s += fire.temp[c]; return s * 1.2 * 1005 * fire.cell ** 3; };

// --- 1. network -------------------------------------------------------------------------
{
  const { w, world } = setup();
  console.log('== network');
  for (const u of Object.values(w.units)) {
    const cold = u.nodes.filter((n) => !n.hot), hot = u.nodes.filter((n) => n.hot);
    const unreached = u.nodes.filter((n) => n.path === Infinity).length;
    console.log(`Unit ${u.name}: ${cold.length} cold + ${hot.length} hot pieces, entry ${u.entry.o.id} at y ${u.entry.y.toFixed(2)} m, ${unreached} not reached from it; joined: ${JSON.stringify(u.joins)}`);
  }
  const inGrid = w.nodes.filter((n) => n.o.cells.length).length;
  const fittings = w.nodes.filter((n) => n.fitting && n.o.cells.length).length;
  console.log(`${w.nodes.length} supply pieces, ${inGrid} touch air in the grid; ${fittings} joints can fail`);
  // Cut the nearest pipe to the room's centre, then a second one in the same unit.
  const near = w.pipesNear(cx, room.min[1] + 1, cz, 40).filter((p) => p.inGrid && !p.hot);
  const first = w.cut(near[0].id);
  console.log(`cut ${near[0].id} (Unit ${first.unit}, ${near[0].d.toFixed(2)} m away): ${first.litresPerMinute} L/min`);
  const second = near.find((p) => p.unit === first.unit && p.id !== near[0].id);
  w.cut(second.id);
  console.log('after a second cut in the same unit:', JSON.stringify(w.status()));
  w.valve(first.unit, false);
  console.log(`valve ${first.unit} shut:`, JSON.stringify(w.status().units));
  world.reset();
}

// --- 2 and 3. the same fire, with and without a sprinkler -----------------------------------
function run(sprinkler) {
  const { fire, world, w } = setup();
  const events = [];
  world.events.on((e) => events.push(e));
  if (sprinkler) w.addSprinkler(cx, room.min[1] + 2, cz);
  let energyGap = 0, heatTakenSeen = 0;
  // Ceiling-layer temperature in the room: the hottest air cell 0.3 m under the ceiling.
  const { origin, cell, index } = fire === null ? {} : { origin: world.grid.origin, cell: fire.cell, index: world.grid.index };
  const ceilingJ = Math.floor((room.max[1] - 0.3 - origin.y) / cell) + 1;
  const layer = [];
  for (let k = 1; k <= world.grid.nz; k++) for (let i = 1; i <= world.grid.nx; i++) {
    const x = origin.x + (i - 0.5) * cell, z = origin.z + (k - 0.5) * cell;
    if (x > room.min[0] && x < room.max[0] && z > room.min[2] && z < room.max[2]) {
      const c = index(i, ceilingJ, k);
      if (!world.grid.solid[c]) layer.push(c);
    }
  }
  const rows = [];
  let next = 10;
  const t0 = performance.now();
  while (fire.time < seconds - 1e-6) {
    // world.step(), with the heat in the air measured around water's transfer phase.
    const dt = fire.dt;
    world.run('act', dt); world.run('source', dt);
    fire.step();
    const before = heatInAir(fire), taken = w.books().heatTaken;
    world.run('transfer', dt);
    const after = heatInAir(fire), takenNow = w.books().heatTaken;
    energyGap += (before - after) - (takenNow - taken);
    heatTakenSeen += before - after;
    world.run('react', dt); world.run('report', dt);
    if (fire.time >= next - 1e-6) {
      let mean = 0, max = 0;
      for (const c of layer) { mean += fire.temp[c]; max = Math.max(max, fire.temp[c]); }
      rows.push({ t: Math.round(fire.time), meanC: Math.round(mean / layer.length + 20), maxC: Math.round(max + 20), airMJ: +(heatInAir(fire) / 1e6).toFixed(1) });
      next += 10;
    }
  }
  const ms = (performance.now() - t0) / (seconds / fire.dt);
  const wetted = world.objects.list.filter((o) => o.wet > 0).sort((x, y) => y.wet - x.wet)
    .map((o) => `${o.id} ${o.name.slice(0, 28)} ${o.wet.toFixed(3)} kg, now ${o.wetRate.toFixed(4)} mm/s`);
  return { rows, books: w.books(), events, energyGap, heatTakenSeen, cost: w.cost(), ms, heads: w.sprinklers, wetted, joints: w.joints(3) };
}

console.log(`\n== ${roomCode} ${room.name}, ${growth} t² fire, ${seconds} s, without and with a sprinkler over it`);
const a = run(false), b = run(true);
console.log('t s | no sprinkler: ceiling mean / max °C, heat in air MJ | sprinkler: same');
for (let i = 0; i < a.rows.length; i++) {
  const x = a.rows[i], y = b.rows[i];
  console.log(`${String(x.t).padStart(4)} | ${String(x.meanC).padStart(4)} / ${String(x.maxC).padStart(4)}  ${String(x.airMJ).padStart(5)} | ${String(y.meanC).padStart(4)} / ${String(y.maxC).padStart(4)}  ${String(y.airMJ).padStart(5)}`);
}
const fmt = (e) => `${e.time.toFixed(1)} s ${e.type} ${e.objectId ?? ''} ${JSON.stringify(e.data ?? {})}`;
console.log('events with the sprinkler:\n  ' + (b.events.map(fmt).join('\n  ') || 'none'));
console.log('events without:\n  ' + (a.events.map(fmt).join('\n  ') || 'none'));
console.log('sprinkler:', JSON.stringify(b.heads));
console.log('hottest joints without the sprinkler:', JSON.stringify(a.joints));
console.log('furniture that got wet:\n  ' + (b.wetted.join('\n  ') || 'none'));

const k = b.books;
console.log('\n== books (with the sprinkler)');
console.log(`released ${k.released.toFixed(2)} kg = in air ${k.inAir.toFixed(2)} + evaporated ${k.evaporated.toFixed(3)} + floor ${k.onFloor.toFixed(2)} + furniture ${k.onFurniture.toFixed(3)}; unaccounted ${k.unaccounted.toExponential(2)} kg (${(100 * k.unaccounted / Math.max(k.released, 1e-9)).toFixed(4)}%)`);
console.log(`evaporation took ${(k.heatTaken / 1e6).toFixed(3)} MJ = ${k.evaporated.toFixed(4)} kg × ${(k.heatTaken / Math.max(k.evaporated, 1e-12) / 1e6).toFixed(3)} MJ/kg`);
console.log(`the air's own heat fell by ${(b.heatTakenSeen / 1e6).toFixed(3)} MJ in the transfer phase; gap ${(b.energyGap / 1e3).toFixed(3)} kJ (${(100 * b.energyGap / Math.max(b.heatTakenSeen, 1)).toFixed(4)}%)`);

console.log('\n== cost');
console.log(`water.js ms per step, with a sprinkler: ${JSON.stringify(b.cost)}; whole step ${b.ms.toFixed(1)} ms (without sprinkler ${a.ms.toFixed(1)} ms)`);
