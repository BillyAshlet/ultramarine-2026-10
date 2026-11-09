// How fast the whole Duplex runs, and where the smoke gets to.
//   node tools/bench.mjs [cell=0.2] [seconds=60] [room=A102] [growth=medium]
// Prints the grid size, ms per step, and every 10 simulated seconds the
// rooms whose air at 1.5 m above their floor holds over 0.01 g/m3 of soot,
// and the share of the fire's heat the walls have taken.
// NO_WALLS=1 turns the walls' heat loss off, to compare.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH } from '../src/house.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const [cell = 0.2, seconds = 60, roomCode = 'A102', growth = 'medium'] = process.argv.slice(2).map((a, i) => (i < 2 ? Number(a) : a));

const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));

let t = Date.now();
const grid = buildGrid(building, cell);
const voxelMs = Date.now() - t;
const room = meta.rooms.find((r) => r.code === roomCode);
const cx = (room.min[0] + room.max[0]) / 2, cz = (room.min[2] + room.max[2]) / 2;
const pool = poolAt(grid, cx, cz, room.min[1]);
const fire = new HouseFire({ grid, pool, growth: GROWTH[growth] });
fire.walls.enabled = !process.env.NO_WALLS;
console.log(`grid ${grid.nx}x${grid.ny}x${grid.nz} = ${grid.nx * grid.ny * grid.nz} cells, ${fire.fluid.length} air, voxelize ${voxelMs} ms`);
console.log(`fire in ${room.code} ${room.name}, ${pool.length} cells; doors open ${grid.doors.filter((d) => d.open).length}/${grid.doors.length}`);

const { origin, index } = grid;
const smokeIn = (r) => {
  const j = Math.floor((r.min[1] + 1.5 - origin.y) / cell) + 1;
  let sum = 0, n = 0;
  for (let k = 1; k <= grid.nz; k++) for (let i = 1; i <= grid.nx; i++) {
    const x = origin.x + (i - 0.5) * cell, z = origin.z + (k - 0.5) * cell;
    if (x < r.min[0] || x > r.max[0] || z < r.min[2] || z > r.max[2]) continue;
    const c = index(i, j, k);
    if (grid.solid[c]) continue;
    sum += fire.dens[c]; n++;
  }
  return n ? sum / n : 0;
};

t = Date.now();
let steps = 0, next = 10;
while (fire.time < seconds) {
  fire.step(); steps++;
  if (fire.time >= next - 1e-6) {
    const ms = (Date.now() - t) / steps;
    let maxT = 0;
    for (let n = 0; n < fire.fluid.length; n++) maxT = Math.max(maxT, fire.temp[fire.fluid[n]]);
    if (!Number.isFinite(maxT)) { console.log('blew up'); process.exit(1); }
    const reached = meta.rooms.filter((r) => r.code !== 'R301').map((r) => [r.code, smokeIn(r)]).filter(([, s]) => s > 0.01);
    console.log(`t ${fire.time.toFixed(0)} s, ${(fire.heatRelease() / 1e3).toFixed(0)} kW, ${ms.toFixed(0)} ms/step, ${(ms / fire.dt / 1000).toFixed(2)} s of computing per simulated second, max ${maxT.toFixed(0)} K, walls took ${fire.heatMade ? (100 * fire.walls.absorbed / fire.heatMade).toFixed(0) : 0}% | ` +
      reached.map(([c, s]) => `${c} ${s.toFixed(2)}`).join(' '));
    next += 10;
  }
}
