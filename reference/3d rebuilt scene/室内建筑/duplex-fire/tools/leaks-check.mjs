// Checks for leaks.js (task F), in node:
//   node tools/leaks-check.mjs [seconds=180] [room=A102] [growth=medium] [shut=]
// shut: comma-separated door rooms to shut before the fire, e.g. A202,A205.
// 1. What leaks there are: zones, the units' leakage, back-to-back outlets.
// 2. One fire: each zone's pressure over time, the highest, the first
//    visible smoke in the other unit, against IFV 2020.
// 3. The books: soot made = soot in the air + soot that went outdoors.
// 4. What leaks.js costs per step.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import sources from '../src/sources.js';
import leaks from '../src/leaks.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const args = process.argv.slice(2);
const seconds = Number(args[0] ?? 180), roomCode = args[1] ?? 'A102', growth = args[2] ?? 'medium';
const shut = (args[3] ?? '').split(',').filter(Boolean);
const fan = args.includes('fan');

const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const room = meta.rooms.find((r) => r.code === roomCode);
const cx = (room.min[0] + room.max[0]) / 2, cz = (room.min[2] + room.max[2]) / 2;

const grid = buildGrid(building, 0.2);
const fire = new HouseFire({ grid, pool: poolAt(grid, cx, cz, room.min[1]), growth: GROWTH[growth] });
const objects = buildObjects(meta, grid, materials);
const rooms = meta.rooms.filter((r) => r.code !== 'R301');
const world = new World({ fire, grid, objects, rooms, materials, view: { meta } });
world.add('sources', sources(world));
world.add('leaks', leaks(world));
const events = [];
world.events.on((e) => events.push(e));
const L = world.leaks;

// Shut doors as doors.js does: the cells turn solid and hold nothing.
for (const code of shut) {
  const d = grid.doors.find((x) => (x.element.room ?? x.element.beside ?? '').startsWith(code) && !x.outside);
  if (!d) { console.log(`no inside door for ${code}`); continue; }
  d.open = false;
  for (const c of d.cells) { grid.solid[c] = 1; fire.dens[c] = fire.temp[c] = fire.fuel[c] = 0; }
}
if (shut.length) fire.updateTopology();
if (fan) world.sources.fan('A', true);

console.log('== leakage');
console.table(L.units());
console.log('back-to-back outlets:', L.outletPairs.length);
for (const p of L.outletPairs) console.log('  ' + p);
world.step();   // builds the zones with the doors as set
console.table(L.zones());
console.table(L.summary());

console.log(`\n== fire in ${roomCode}, ${growth}, doors shut: ${shut.join(' ') || 'none'}${fan ? ', fan A on' : ''}`);
const steps = Math.round(seconds / fire.dt);
const t0 = performance.now();
for (let n = 1; n <= steps; n++) {
  world.step();
  if (n % Math.round(15 / fire.dt) === 0) {
    const z = L.zones().map((x) => `${x.rooms.split(' ')[0]} ${x.pa.toFixed(0)} Pa (${x.growth.toFixed(2)} m³/s)`).join(' · ');
    console.log(`t ${fire.time.toFixed(0).padStart(4)} s  ${(fire.heatRelease() / 1000).toFixed(0).padStart(5)} kW  ${z}`);
  }
}
const wall = (performance.now() - t0) / 1000;
console.log('\nhighest pressure per zone (Pa):', L.peaks());
console.log('first visible smoke in the other unit:', L.firsts());
console.log('events:', events.map((e) => `${e.time.toFixed(1)} s ${e.type} ${JSON.stringify(e.data)}`));
console.log('leaks now:'); console.table(L.summary());

// Books: soot made by the fire = in the air + gone outdoors (+ in cells that turned solid: 0 here).
let inAir = 0;
for (const c of fire.fluid) inAir += fire.dens[c];
inAir *= fire.cell ** 3;
const b = L.books();
console.log(`\n== books: soot made ${fire.sootMade.toFixed(2)} g = in air ${inAir.toFixed(2)} + outdoors ${b.sootOut.toFixed(2)} ` +
  `→ off by ${(fire.sootMade - inAir - b.sootOut).toFixed(4)} g; crossed between units ${b.sootAcrossUnits.toFixed(3)} g; moved by kind ${JSON.stringify(Object.fromEntries(Object.entries(b.moved).map(([k, v]) => [k, +v.toFixed(3)])))}`);
console.log(`heat out to outdoors ${(b.heatOut / 1e6).toFixed(2)} MJ`);
console.log(`\n== cost: leaks ${JSON.stringify(L.cost())}; ${steps} steps in ${wall.toFixed(0)} s`);
