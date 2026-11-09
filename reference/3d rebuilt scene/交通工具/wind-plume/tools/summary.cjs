// The sweep's numbers, against a pool-fire tilt correlation that knows nothing
// of this accident: cos(theta) = 1 / sqrt(u*) for u* >= 1 (American Gas Association),
// u* = wind / (g m'' D / rho)^(1/3), m'' = 38 MW / 44 MJ/kg / 16 m2.
// node tools/summary.cjs [old]: the heat-keeping solver's results, or the old solver's.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, process.argv[2] === 'old' ? '../results' : '../results/mac');
const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n + '.json'))); } catch { return null; } };
const uc = Math.cbrt(9.81 * (38e6 / 44e6 / 16) * Math.sqrt(16 * 4 / Math.PI) / 1.2);
const aga = (u) => { const s = u / uc; return s <= 1 ? 0 : Math.acos(1 / Math.sqrt(s)) * 180 / Math.PI; };
console.log('u_c', uc.toFixed(2), 'm/s');
console.log('free plume, no aircraft: wind | lean | correlation | peak speed');
for (const w of [0, 1, 2, 3, 4]) { const r = read(`free-w${w}`); if (r) console.log(' ', w, '|', r.leanDegrees, '|', aga(w).toFixed(1), '|', r.peakSpeed); }
for (const y of [90, 40]) {
  console.log(`aircraft, wind ${y} deg off the nose: wind | lean | gap m | skin >300 | skin >150 | skin peak | peak speed | wall s`);
  for (const w of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) { const r = read(`ac-y${y}-w${w}`); if (r) console.log(' ', w, '|', r.leanDegrees, '|', r.skin.gapMetres, '|', r.skin.hot300, '|', r.skin.hot150, '|', r.skin.peak, '|', r.peakSpeed, '|', r.wallSeconds); }
}
