// One run of a NIST two-storey test:
//   node tools/run.mjs '{"name":"base","test":"sdc25"}'
// Writes the temperature and smoke at every instrument station, every 2 s, to
// results/<name>.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HouseFire } from '../src/house-fire.js';
import { buildHouse, STATIONS, CEILING } from '../src/house.js';

const here = dirname(fileURLToPath(import.meta.url));
const o = {
  test: 'sdc25', cell: 0.2, dt: 0.05, iterations: 30,
  // Not in the report, so taken as typical for upholstered furniture: see README.
  heatOfCombustion: 20e6, radiantFraction: 0.3, sootYield: 0.1, wallH: 15,
  smagorinsky: 0.4, burnTime: 3,
  ...JSON.parse(process.argv[2]),
};

const burning = JSON.parse(readFileSync(join(here, '../results/mass-loss.json'), 'utf8'))[o.test];
const rateAt = (t) => {
  const table = burning.mdot;
  if (t <= table[0][0]) return table[0][1];
  for (let n = 1; n < table.length; n++) {
    if (t <= table[n][0]) {
      const [t0, r0] = table[n - 1], [t1, r1] = table[n];
      return r0 + (r1 - r0) * (t - t0) / (t1 - t0);
    }
  }
  return table[table.length - 1][1];
};

// Test 20 burned a mattress in bedroom 3 with its door shut; 25 and 26 a chair downstairs.
const DEFAULTS = { sdc20: { fire: 'mattress', bedroom3Door: 'leaky' } };
const scene = { fire: 'chair', bedroom3Door: 'open', ...DEFAULTS[o.test], ...(o.fire && { fire: o.fire }), ...(o.bedroom3Door && { bedroom3Door: o.bedroom3Door }) };
o.scene = scene;
const house = buildHouse(o.cell, scene);
const f = new HouseFire({ ...house, smagorinsky: o.smagorinsky, burnTime: o.burnTime, radiantFraction: o.radiantFraction, wallH: o.wallH });
f.dt = o.dt; f.iterations = o.iterations; f.vorticity = 0;

const DEPTHS = [0.025, 0.3, 0.61, 0.9, 1.22];   // thermocouples below the ceiling
const SMOKE_DEPTHS = [0.025, 0.3];               // smoke meters below the ceiling
const KM = 8700;                                 // m2/kg, flaming smoke
const series = { t: [], hrr: [] };
for (const name of Object.keys(STATIONS)) series[name] = { temp: DEPTHS.map(() => []), od: SMOKE_DEPTHS.map(() => []) };

const t0 = Date.now();
const end = Math.min(burning.end, o.seconds ?? Infinity);
let nextSample = 0;
while (f.time <= end + 1e-9) {
  const rate = rateAt(f.time);
  f.setFire(rate, o.heatOfCombustion, o.sootYield);
  if (f.time >= nextSample - 1e-9) {
    series.t.push(+f.time.toFixed(2));
    series.hrr.push(Math.round(rate * o.heatOfCombustion / 1000));
    for (const [name, s] of Object.entries(STATIONS)) {
      const top = CEILING[s.floor];
      DEPTHS.forEach((d, n) => series[name].temp[n].push(+(20 + f.sample(f.temp, s.x, top - d, s.z)).toFixed(1)));
      // Optical density per metre, base 10, as the report's smoke meters give it.
      SMOKE_DEPTHS.forEach((d, n) => series[name].od[n].push(+(KM * f.sample(f.dens, s.x, top - d, s.z) / Math.LN10).toFixed(4)));
    }
    nextSample += 2;
  }
  f.step();
  if (!Number.isFinite(f.temp[f.source[0]])) { console.error(o.name, 'blew up at', f.time); process.exit(1); }
}

mkdirSync(join(here, '../results'), { recursive: true });
writeFileSync(join(here, `../results/${o.name}.json`), JSON.stringify({ options: o, cells: f.fluid.length, depths: DEPTHS, smokeDepths: SMOKE_DEPTHS, series }));
console.log(o.name, 'fluid cells', f.fluid.length, `${Math.round((Date.now() - t0) / 1000)}s`);
