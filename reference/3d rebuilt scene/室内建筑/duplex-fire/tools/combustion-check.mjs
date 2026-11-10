// Checks for combustion.js (task B), in node:
//   node tools/combustion-check.mjs <case> [seconds]
// Cases:
//   ignition  the ignition rule alone (no solver): time to ignite each
//             material under a steady 20 and 40 kW/m², against Babrauskas 1981
//             (NBSIR 81-2271 table 3).
//   sofa      the A102 sofa e159 alone, lit by the 50 kW / 200 s igniter in
//             front of it; every other item is made non-combustible. Its heat
//             release against NIST TN 2303 sofa A; the soot in the air against
//             mass burned × yield. Default 1900 s (about half an hour to run).
//   table     the big A102 coffee table e162 alone, lit by the igniter: does
//             it keep burning once the burner is gone (NBSIR 83-2787 bookcase:
//             out 60 s after)? Default 600 s.
//   cabinet   an A103 kitchen base cabinet alone, lit by the igniter. Default 600 s.
// Writes 进度/B/combustion-<case>.json for the figures.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLayer, buildGrid, HouseFire, poolAt } from '../src/house.js';
import { buildObjects } from '../src/objects.js';
import { World } from '../src/world.js';
import combustion, { burnModel } from '../src/combustion.js';
import radiation from '../src/radiation.js';

const here = dirname(fileURLToPath(import.meta.url));
const data = join(here, '../../duplex-overlay/data');
const outDir = join(here, '../../进度/B');
const materials = JSON.parse(readFileSync(join(here, '../src/materials.json'), 'utf8'));
const [which = 'ignition', secondsArg] = process.argv.slice(2);

if (which === 'ignition') {
  // Steady flux q: the dose q^2 t reaches (pi/4) k rho c (Tig - T0)^2.
  const rows = [];
  for (const key of ['sofa', 'bed_queen', 'cabinet_run', 'wardrobe', 'coffee_table']) {
    const m = materials[key];
    const need = (Math.PI / 4) * m.krc.value * (m.ignitionTemp.value - 20) ** 2;
    const t = (q) => (q < m.criticalFlux.value ? null : need / q ** 2);
    rows.push({ key, criticalFlux: m.criticalFlux.value, at20: t(20), at40: t(40) });
    console.log(`${key.padEnd(13)} critical ${m.criticalFlux.value} kW/m²  ignites at 20 kW/m² after ${t(20)?.toFixed(0) ?? 'never'} s, at 40 after ${t(40)?.toFixed(0) ?? 'never'} s`);
  }
  console.log('Babrauskas 1981 table 3: fabric/PU items 18–43 s at 20, 9–24 s at 40; case goods none at 20, 110–236 s at 40 (desk F09 110 s, cabinets F10 236 s, F11 191 s).');
  writeFileSync(join(outDir, 'combustion-ignition.json'), JSON.stringify(rows, null, 1));
  process.exit(0);
}

const CASES = {
  sofa: { id: 'e159', at: [2.6, 14.6], seconds: 1900 },
  table: { id: 'e162', at: [2.6, 15.45], seconds: 600 },
  cabinet: { id: 'e151', at: [3.73, 11.75], seconds: 600 },
};
const C = CASES[which];
if (!C) { console.error('case: ignition | sofa | table | cabinet'); process.exit(1); }
const seconds = Number(secondsArg ?? C.seconds);

const meta = JSON.parse(readFileSync(join(data, 'meta.json'), 'utf8'));
const bytes = readFileSync(join(data, 'building.bin'));
const building = readLayer(meta, 'building', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
const grid = buildGrid(building, 0.2);
const objects = buildObjects(meta, grid, materials);
const target = objects.byId.get(C.id);
// Only the item under test can burn.
for (const o of objects.list) if (o !== target) o.combustible = false;
const pool = poolAt(grid, C.at[0], C.at[1], 0.0);
const fire = new HouseFire({ grid, pool });
const world = new World({ fire, grid, objects, rooms: meta.rooms, materials });
const quiet = [];
world.events.on((e) => quiet.push(e));
world.add('combustion', combustion(world));
world.add('radiation', radiation(world));
console.log(`${which}: ${target.id} ${target.label} in ${target.room}, ${target.cells.length} cells, ${target.fuelMJ?.toFixed(0)} MJ; igniter ${pool.length} cells at ${C.at}, ${fire.igniter.power / 1e3} kW for ${fire.igniter.duration} s`);

const { fluid } = fire;
const V = grid.cell ** 3;
const sootInAir = () => { let s = 0; for (let n = 0; n < fluid.length; n++) s += fire.dens[fluid[n]]; return s * V; };
const series = [];
const comb = world.combustion;
let next = 0, msSum = 0, steps = 0;
const t0 = Date.now();
while (fire.time < seconds) {
  world.step();
  steps++;
  msSum += world.modules.find((m) => m.name === 'combustion').stepMs;
  if (fire.time >= next - 1e-9) {
    const it = comb.items.find((i) => i.o === target);
    series.push({
      t: +fire.time.toFixed(1), kW: +(target.hrr / 1e3).toFixed(2), state: target.state, fluxC: +target.flux.toFixed(2),
      fluxIn: +it.qIn.toFixed(2), dose: +(it.dose / it.need).toFixed(3), surfaceC: Math.round(target.burn.surfaceC),
      burnedMJ: +target.burnedMJ.toFixed(2), igniterKW: fire.heatRelease() / 1e3,
    });
    if (Math.round(fire.time) % 30 === 0) {
      const s = series.at(-1);
      console.log(`t ${s.t.toFixed(0).padStart(5)} s  ${target.state}  ${s.kW.toFixed(0).padStart(5)} kW  in ${s.fluxIn.toFixed(1)} kW/m² (C ${s.fluxC.toFixed(1)})  dose ${s.dose}  ${s.surfaceC} °C  burned ${s.burnedMJ.toFixed(1)} MJ  ` +
        `${((Date.now() - t0) / steps).toFixed(0)} ms/step, combustion ${(msSum / steps).toFixed(3)} ms`);
    }
    next += 1;
  }
}
const it = comb.items.find((i) => i.o === target);
const made = comb.made();
const m = materials[target.material];
const hc = (m.heatOfCombustion ?? materials[m.scaleFrom?.value]?.heatOfCombustion).value;
const y = (m.sootYield ?? materials[m.scaleFrom?.value]?.sootYield).value;
const expectG = target.burnedMJ * 1e6 / hc * y * 1000;
const peak = series.reduce((a, s) => (s.kW > a.kW ? s : a), { kW: 0 });
const result = {
  case: which, id: target.id, label: target.label, ignitedAt: target.ignitedAt, peakKW: peak.kW, peakAt: peak.t,
  peakAfterIgnitionS: target.ignitedAt != null ? peak.t - target.ignitedAt : null,
  burnedMJ: target.burnedMJ, modelTotalMJ: it.model.total / 1e6, state: target.state,
  soot: { madeG: made.sootG, inAirG: sootInAir(), expectedG: expectG, igniterG: fire.sootMade },
  heatIntoAirJ: made.heatJ, combustionMsPerStep: msSum / steps, events: quiet.map((e) => ({ type: e.type, t: +e.time.toFixed(1), objectId: e.objectId, data: e.data })),
  series,
};
console.log(JSON.stringify({ ...result, series: undefined }, null, 1));
writeFileSync(join(outDir, `combustion-${which}.json`), JSON.stringify(result));
