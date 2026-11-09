// Build the object table in node and print what is in it, to check it
// against 架构.md: 8 upholstered, 37 cabinets, 10 tables, 6 countertops.
//   node tools/objects-check.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid } from '../src/house.js';
import { buildObjects } from '../src/objects.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const grid = buildGrid(readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)));
const objects = buildObjects(meta, grid, materials);

const by = (f) => objects.list.reduce((m, o) => m.set(f(o), [...(m.get(f(o)) ?? []), o]), new Map());
console.log(`${objects.list.length} objects`);
for (const [cls, os] of by((o) => o.class)) {
  const mats = [...by.call(null, (o) => o.material)].filter(([, l]) => l[0].class === cls).map(([k, l]) => `${k} ${l.length}`);
  const noAir = os.filter((o) => o.cells.length === 0).length, inWall = os.filter((o) => o.wallAir).length;
  console.log(`${cls.padEnd(4)} ${String(os.length).padStart(4)}  (${mats.join(', ')})${noAir ? `  ${noAir} with no air cell within 1.5 cells` : ''}${inWall ? `  (${inWall} in a wall or floor)` : ''}`);
}
console.log('\nfurniture:');
for (const o of objects.list.filter((o) => o.layer === 'furniture')) {
  console.log(`  ${o.id.padEnd(6)} ${o.material.padEnd(13)} ${(o.room ?? '?').padEnd(22)} ${o.size.map((s) => s.toFixed(2)).join('×').padEnd(16)} ` +
    `${o.fuelMJ == null ? '   —' : o.fuelMJ.toFixed(0).padStart(5) + ' MJ'}  ${o.cells.length} cells  ${o.area.toFixed(1)} m²`);
}
