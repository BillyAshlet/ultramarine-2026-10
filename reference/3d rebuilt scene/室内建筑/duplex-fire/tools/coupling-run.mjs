// The coupling run: every mechanism loaded together on one fire, to see which
// feedback loops turn and where the others stall.
//   node tools/coupling-run.mjs <rule|norule> [seconds=900] [cell=0.2]
// cell    the solver's cell size in metres. 0.2 writes coupling-<mode>.json as
//         before; any other size writes coupling-<mode>-<cm>.json, so the 20 cm
//         run is not overwritten (40 cm check: 进度/耦合/40cm.md).
//         COUPLING_TAG=<name> overrides the file name: coupling-<name>.json.
//         CLOSE=A202,A203 shuts the inside doors of those rooms from the start,
//         as house.js shuts the outside doors (default: every inside door open).
//         PRESSURE_ITER=<n> sets mac3d.js's pressure sweeps per step (default:
//         whatever mac3d.js has, 40), to test fewer sweeps without editing it.
//         TOGGLE=A202@300,A202@420 opens or shuts those rooms' inside doors at
//         those simulated seconds, the way doors.js setCells does it.
// rule    radiation.js's flashover rule as it is (600 °C upper layer or
//         20 kW/m² on the floor sets every combustible in the room alight).
// norule  the same, with both thresholds set to Infinity in this script only
//         (radiation.js is not edited): does the loop flash over on its own?
//         When 600 °C / 20 kW/m² would have been crossed is still recorded.
// The fire: the 50 kW / 200 s igniter in front of the A102 living-room sofa
// e159, at the point combustion-check.mjs uses. Every item keeps its own
// combustible flag (combustion-check.mjs turned all others off).
// Writes 进度/耦合/coupling-<mode>.json: one row a second, the events, and
// for each loop how far along its chain anything moved.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import { PARAMS as RAD } from '../src/radiation.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const outDir = join(here, '../../进度/耦合');
mkdirSync(outDir, { recursive: true });
const [mode = 'rule', secondsArg, cellArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 900);
const CELL = Number(cellArg ?? 0.2);
if (!(CELL > 0)) { console.error('cell: a size in metres, e.g. 0.4'); process.exit(1); }
const tag = process.env.COUPLING_TAG || (Math.abs(CELL - 0.2) < 1e-9 ? mode : `${mode}-${Math.round(CELL * 100)}`);
if (mode !== 'rule' && mode !== 'norule') { console.error('mode: rule | norule'); process.exit(1); }
if (mode === 'norule') { RAD.flashoverLayer.value = Infinity; RAD.flashoverFloorFlux.value = Infinity; }

const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const grid = buildGrid(building, CELL);
// Each inside door's cells as built, so opening restores the doorway (doors.js).
for (const d of grid.doors) if (!d.outside) d.asBuilt = Uint8Array.from(d.cells, (c) => grid.solid[c]);
const roomOf = (d) => d.element.room ?? d.element.beside ?? '';
const CLOSE = (process.env.CLOSE ?? '').split(',').filter(Boolean);
const closed = [];
for (const d of grid.doors) {
  const room = roomOf(d);
  if (d.outside || !CLOSE.some((code) => room.startsWith(code))) continue;
  d.open = false;
  for (const c of d.cells) grid.solid[c] = 1;
  closed.push(room);
}
const objects = buildObjects(meta, grid, materials);
const AT = [2.6, 14.6];   // in front of e159, as combustion-check.mjs sofa
const pool = poolAt(grid, AT[0], AT[1], 0.0);
const fire = new HouseFire({ grid, pool });
if (process.env.PRESSURE_ITER) fire.iterations = Number(process.env.PRESSURE_ITER);
const world = new World({ fire, grid, objects, rooms: meta.rooms, materials });
const events = [];
world.events.on((e) => events.push({ type: e.type, t: +e.time.toFixed(1), objectId: e.objectId, data: e.data }));
await world.load();
const { combustion: comb, radiation: rad, gas, water, leaks } = world;
console.log(`mode ${mode}, ${seconds} s, cell ${CELL} m (${fire.fluid.length} air cells); modules: ${world.modules.map((m) => m.name).join(', ')}; igniter ${pool.length} cells at ${AT}; closed [${closed.join(', ')}]; pressure sweeps ${fire.iterations}`);

// Where the smoke is: each room's air cells, all of them and the layer at
// 1.5 m above its floor (head height, as bench.mjs). Rows keep a room once
// its mean soot passes 0.001 g/m³.
const roomCells = meta.rooms.filter((r) => r.code !== 'R301').map((r) => {
  const box = (y0, y1) => Int32Array.from(grid.cellsInBox({ min: { x: r.min[0], y: y0, z: r.min[2] }, max: { x: r.max[0], y: y1, z: r.max[2] } }).filter((c) => !grid.solid[c]));
  const y = r.min[1] + 1.5;
  return { code: r.code, all: box(r.min[1], r.max[1]), head: box(y - CELL / 2, y + CELL / 2) };
});
const meanOf = (cells) => { let s = 0; for (const c of cells) s += fire.dens[c]; return cells.length ? s / cells.length : 0; };

// Each room's own crossing of the two flashover numbers, whatever the rule does.
const crossed = new Map();   // room -> { layer600At, floor20At }
const rows = [];
const max = {
  fluxOnCold: { kW: 0, id: null, t: 0 },          // ① flux on an item that is not burning
  totalKW: { kW: 0, t: 0 },
  layerC: { c: 0, room: null, t: 0 },
  floorFlux: { q: 0, room: null, t: 0 },
  zonePa: { pa: 0, zone: null, t: 0 },             // ②
  valveC: { c: 0, unit: null, t: 0 },              // ③
  jointC: { c: 0, id: null, t: 0 },                // ④
  wetRate: { v: 0, id: null, t: 0 },
};
const toggles = (process.env.TOGGLE ?? '').split(',').filter(Boolean).map((s) => { const [code, at] = s.split('@'); return { code, at: Number(at), done: false }; });
function toggleDoors(code) {
  for (const d of grid.doors) {
    if (d.outside || !roomOf(d).startsWith(code)) continue;
    d.open = !d.open;
    d.cells.forEach((c, n) => {
      grid.solid[c] = d.open ? (d.asBuilt?.[n] ?? 0) : 1;
      if (!d.open) fire.dens[c] = fire.temp[c] = fire.fuel[c] = 0;
    });
    fire.updateTopology();
    world.events.emit({ type: '门', data: { room: roomOf(d), open: d.open } });
  }
}
const T_START = Date.now();
let next = 0, steps = 0;
const msBy = {};
while (fire.time < seconds) {
  for (const g of toggles) if (!g.done && fire.time >= g.at - 1e-9) { g.done = true; toggleDoors(g.code); }
  world.step();
  steps++;
  for (const m of world.modules) msBy[m.name] = (msBy[m.name] ?? 0) + (m.stepMs ?? 0);
  msBy.solver = (msBy.solver ?? 0) + world.solverMs;
  if (fire.time < next - 1e-9) continue;
  next += 1;
  const t = +fire.time.toFixed(1);

  let totalKW = 0;
  const items = [];
  for (const it of comb.items) {
    const o = it.o;
    totalKW += o.hrr / 1e3;
    if (o.state === '完好' && !(o.flux > 0.5)) continue;
    items.push({ id: o.id, room: o.room, mat: o.material, state: o.state, kW: +(o.hrr / 1e3).toFixed(1), flux: +o.flux.toFixed(1), flame: +(o.fluxFlame ?? 0).toFixed(1), smoke: +(o.fluxSmoke ?? 0).toFixed(1), qIn: +it.qIn.toFixed(1), dose: +(it.dose / it.need).toFixed(3) });
    if (o.state !== '燃烧' && o.flux > max.fluxOnCold.kW) max.fluxOnCold = { kW: +o.flux.toFixed(1), id: o.id, t };
  }
  if (totalKW > max.totalKW.kW) max.totalKW = { kW: Math.round(totalKW), t };
  const rooms = rad.status().filter((r) => r.layerC > 25 || r.floorFlux > 0.5);
  for (const r of rooms) {
    const c = crossed.get(r.room) ?? {};
    if (r.layerC >= 600 && c.layer600At == null) c.layer600At = t;
    if (r.floorFlux >= 20 && c.floor20At == null) c.floor20At = t;
    crossed.set(r.room, c);
    if (r.layerC > max.layerC.c) max.layerC = { c: r.layerC, room: r.room, t };
    if (r.floorFlux > max.floorFlux.q) max.floorFlux = { q: r.floorFlux, room: r.room, t };
  }
  const zones = leaks ? leaks.zones() : [];
  for (const z of zones) if (Math.abs(z.pa) > Math.abs(max.zonePa.pa)) max.zonePa = { pa: z.pa, zone: z.rooms, t };
  const valves = gas ? gas.parts() : [];
  for (const v of valves) if (v.c > max.valveC.c) max.valveC = { c: v.c, unit: v.unit, t };
  const joints = water ? water.joints(3) : [];
  if (joints[0] && joints[0].c > max.jointC.c) max.jointC = { c: joints[0].c, id: joints[0].id, t };
  for (const o of objects.list) if ((o.wetRate ?? 0) > max.wetRate.v) max.wetRate = { v: o.wetRate, id: o.id, t };

  rows.push({
    t, igniterKW: +(fire.heatRelease() / 1e3).toFixed(1), totalKW: Math.round(totalKW), items, rooms,
    zones: zones.map((z) => ({ rooms: z.rooms, pa: z.pa })), valves, joints,
    soot: Object.fromEntries(roomCells.map((r) => [r.code, [+meanOf(r.all).toFixed(4), +meanOf(r.head).toFixed(4)]]).filter(([, v]) => v[0] > 0.001)),
    gas: gas ? { released: +gas.books().released.toFixed(4), peak: gas.peak() } : null,
    water: water ? { outlets: water.status().outlets.length, onFurniture: +(water.books().onFurniture ?? 0).toFixed(3) } : null,
  });
  if (Math.round(t) % 30 === 0) {
    const burning = items.filter((i) => i.state === '燃烧').map((i) => `${i.id}:${i.kW}`).join(' ');
    const hot = rooms.slice().sort((a, b) => b.layerC - a.layerC)[0];
    console.log(`t ${String(Math.round(t)).padStart(4)}  total ${String(Math.round(totalKW)).padStart(5)} kW  burning [${burning}]  ` +
      `hottest ${hot ? `${hot.room} ${hot.layerC}°C ${hot.floorFlux} kW/m²` : '-'}  maxPa ${max.zonePa.pa}  valve ${valves.map((v) => v.c).join('/')}°C  joint ${joints[0]?.c ?? '-'}°C  ` +
      `${((Date.now() - T_START) / steps).toFixed(0)} ms/step`);
  }
}

const ign = events.filter((e) => e.type === '点燃');
const result = {
  mode, seconds, cell: CELL, airCells: fire.fluid.length, igniterCells: pool.length, closed, pressureIterations: fire.iterations, toggles: toggles.map((g) => `${g.code}@${g.at}`), steps, wallS: Math.round((Date.now() - T_START) / 1000),
  msPerStep: Object.fromEntries(Object.entries(msBy).map(([k, v]) => [k, +(v / steps).toFixed(3)])),
  ignitions: ign.map((e) => ({ t: e.t, id: e.objectId, by: e.data?.by, flux: e.data?.flux, mat: e.data?.material })),
  flashover: events.filter((e) => e.type === '轰燃').map((e) => ({ t: e.t, ...e.data })),
  crossed: Object.fromEntries(crossed),
  max,
  thresholds: {
    gasValveLeakC: gas?.params?.leakC, gasValveMeltC: gas?.params?.meltC, waterJointFailC: water?.params?.failC,
  },
  events, rows,
};
writeFileSync(join(outDir, `coupling-${tag}.json`), JSON.stringify(result));
console.log(JSON.stringify({ ...result, events: undefined, rows: undefined }, null, 1));
