// What a coarser solver grid does to the things the mechanisms hang on, before
// any fire: the igniter's cells, each object's `cells`, which objects become
// wallAir, the doors, each room's air, the ceiling a flame is cut at, and the
// leak zones (leaks.js finds them as connected air). Static: no time steps.
//   node 进度/耦合/grid-check.mjs [cells=0.2,0.4]
// Writes 进度/耦合/grid-check.json next to this file.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '../../duplex-fire/src');
const { readLayer, buildGrid, HouseFire, poolAt } = await import(join(src, 'house.js'));
const { buildObjects } = await import(join(src, 'objects.js'));
const { World } = await import(join(src, 'world.js'));
const data = join(here, '../../duplex-overlay/data');
const sizes = (process.argv[2] ?? '0.2,0.4').split(',').map(Number);
const AT = [2.6, 14.6];   // the coupling run's igniter, in front of sofa e159

const materials = JSON.parse(readFileSync(join(src, 'materials.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));

const out = {};
for (const cell of sizes) {
  const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const t0 = Date.now();
  const grid = buildGrid(building, cell);
  const objects = buildObjects(meta, grid, materials);
  const pool = poolAt(grid, AT[0], AT[1], 0.0);
  const fire = new HouseFire({ grid, pool });
  const world = new World({ fire, grid, objects, rooms: meta.rooms, materials });
  world.events.on(() => {});
  await world.load();
  const { origin, index, solid } = grid;
  const centre = (c) => {
    const i = c % (grid.nx + 2), j = Math.floor(c / (grid.nx + 2)) % (grid.ny + 2), k = Math.floor(c / ((grid.nx + 2) * (grid.ny + 2)));
    return [origin.x + (i - 0.5) * cell, origin.y + (j - 0.5) * cell, origin.z + (k - 0.5) * cell].map((v) => +v.toFixed(2));
  };
  // As combustion.js ceilingOver: the bottom of the first solid cell above y.
  const ceilingOver = (x, y, z) => {
    const i = Math.floor((x - origin.x) / cell) + 1, k = Math.floor((z - origin.z) / cell) + 1;
    let j = Math.floor((y + 1e-3 - origin.y) / cell) + 1;
    if (i < 1 || i > grid.nx || k < 1 || k > grid.nz || j < 1 || j > grid.ny) return null;
    if (solid[index(i, j, k)]) j++;
    for (; j <= grid.ny; j++) if (solid[index(i, j, k)]) return +(origin.y + (j - 1) * cell).toFixed(2);
    return null;
  };
  // A door's clear width: air columns across its box at 1 m above its sill.
  const doorWidth = (d) => {
    const e = d.element, y = e.min[1] + 1.0;
    const j = Math.floor((y - origin.y) / cell) + 1;
    const along = (e.max[0] - e.min[0]) > (e.max[2] - e.min[2]) ? 0 : 2;
    const cols = new Set();
    for (const c of d.cells) {
      const p = centre(c);
      if (Math.abs(p[1] - (origin.y + (j - 0.5) * cell)) > 1e-6 || solid[c]) continue;
      cols.add(p[along]);
    }
    return { leafM: +(e.max[along] - e.min[along]).toFixed(2), airCols: cols.size, airM: +(cols.size * cell).toFixed(2) };
  };

  const r = {
    dims: [grid.nx, grid.ny, grid.nz], air: fire.fluid.length, buildMs: Date.now() - t0,
    igniter: { cells: pool.length, at: Array.from(pool, centre), areaM2: +(pool.length * cell * cell).toFixed(2) },
    doors: grid.doors.map((d) => ({ name: d.element.name, room: d.element.room ?? d.element.beside ?? null, outside: d.outside, open: d.open, cells: d.cells.length, ...doorWidth(d) })),
    objects: Object.fromEntries(objects.list.map((o) => [o.id, {
      class: o.class, room: o.room, combustible: o.combustible, cells: o.cells.length, wallAir: o.wallAir,
      ceilY: o.combustible && !o.wallAir ? ceilingOver((o.min[0] + o.max[0]) / 2, o.max[1], (o.min[2] + o.max[2]) / 2) : undefined,
    }])),
    rooms: Object.fromEntries(meta.rooms.filter((m) => m.code !== 'R301').map((m) => {
      const cs = grid.cellsInBox({ min: { x: m.min[0], y: m.min[1], z: m.min[2] }, max: { x: m.max[0], y: m.max[1], z: m.max[2] } }).filter((c) => !solid[c]);
      return [m.code, cs.length];
    })),
    zones: world.leaks ? world.leaks.zones().map((z) => ({ rooms: z.rooms, unit: z.unit, m3: z.m3, leaks: z.leaks })) : null,
    modules: world.modules.map((m) => m.name),
  };
  out[cell] = r;
  const comb = Object.values(r.objects).filter((o) => o.combustible);
  console.log(`cell ${cell}: ${r.dims.join('x')}, ${r.air} air, built ${r.buildMs} ms; igniter ${r.igniter.cells} cells (${r.igniter.areaM2} m²); ` +
    `objects ${objects.list.length}, wallAir ${objects.list.filter((o) => o.wallAir).length}, combustible with <=2 cells ${comb.filter((o) => o.cells <= 2).length}; zones ${r.zones?.length}`);
}
writeFileSync(join(here, 'grid-check.json'), JSON.stringify(out, null, 1));
