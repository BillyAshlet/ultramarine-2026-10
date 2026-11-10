// Combustion (task B of 开工顺序.md): what ignites, how each item burns, when
// it goes out, and how it looks while it does.
//
// Every number used here is in materials.json with its source, or in PARAMS
// below with its source or marked 假设. The research behind the rules is in
// 进度/B/燃烧蔓延与材料损坏.md.
//
// IGNITION. An item's surface heats under the flux it receives. The thermally
// thick ignition time under a steady flux q is
//     t_ig = (pi/4) k rho c (T_ig - T0)^2 / q^2      (NUREG-1805 ch. 2)
// so q^2 t is what has to add up. Each step the item adds q^2 dt to its dose
// while q is above its critical flux, and it ignites when the dose reaches
// (pi/4) k rho c (T_ig - T0)^2. Below the critical flux it can never ignite
// (NUREG-1805 tables), and the dose falls by (q_cr^2 - q^2) dt: the surface
// loses more than it gets (假设). Checked against Babrauskas 1981 (NBSIR
// 81-2271 table 3): fabric over PU foam ignited in 18–43 s at 20 kW/m²; this
// gives 27 s with the sofa's k rho c 0.1. A dose that adds q^2 - q_cr^2 instead,
// as B-RISK's flux-time product can, gave 75 s, outside that range.
// Every ignition here counts as piloted (假设): NIST TN 1446 saw targets that
// should have ignited only brown without a pilot flame, and no number was found
// for unpiloted ignition of furniture.
//
// The flux q is the largest of three (the largest, not the sum, so nothing is
// counted twice; 假设):
//   - object.flux, written by radiation.js (task C): radiation from burning
//     items, the igniter and the smoke layer;
//   - flame contact: 30 kW/m² (NIST TN 1446) when the item is inside another
//     fire's flame, taken as that fire's plan grown 0.2 m sideways (TN 1446:
//     bed flames reached 20–39 cm sideways), up to its Heskestad height. This
//     is how the igniter lights things, as the NBS burner did by touching
//     them: as a point source a 50 kW burner gives a target beside it about
//     12 kW/m² at most (radiation.js keeps R above the fire's radius), and
//     nothing if the target is over it; and on 20 cm cells its flame is only
//     about 200 K above ambient (house.js: the grid makes flames too cool);
//   - the gas touching it: h dT + sigma ((T0+dT)^4 - T0^4), dT the hottest of
//     its own cells: what a hot smoke layer does to the top of a tall item.
// Being in a flame also counts as the pilot.
//
// BURNING. An ignited item follows its material's heat release curve from
// the moment it ignites:
//   - measured curves (sofa: NIST FCD test040; queen bed: test038), looked up;
//     the king bed is the queen's scaled by area;
//   - otherwise t^2 to the peak at timeToPeak, then an exponential decay whose
//     time constant makes the total heat come out right: growth gives
//     peak * tp / 3, the decay the rest (shape 假设).
// The measured curves start at a 128 W flame on a pillow (TN 2303 table 5);
// an item lit by radiation may skip part of that slow start (no data). Heat
// and soot go into the item's own cells as house.js writes its fire:
//   fuel += dt q (1 - chi_r) / (rho cp V),   soot += dt q / dHc * Y * 1000 / V
// The radiated share chi_r q is left to radiation.js.
//
// GOING OUT. Wood stops flaming when the heat it gets from outside falls too
// low: the char insulates it and its own flame cannot keep the fuel coming
// (Emberley 2017; NBSIR 83-2787 bookcase: out 60 s after the burner left).
// An item whose material has extinctionFlux goes out when object.flux (which
// leaves out its own fire) stays under it for extinctionDelay, its heat release
// falling to nothing over that time (假设: linearly). Open wood (the
// coffee tables) can go out any time; closed boxes (cabinets) only before
// their peak, while the fire is still on their outside (假设: the NBS
// wardrobes, closed boxes with clothing, burned out once going). Foam does
// not go out: TN 2303's sofas kept going from a 128 W flame.
// Water: once spray lands on a burning item (object.wetRate, mm/s, from
// water.js) its heat release decays as exp(-t/tau), tau = 3.0 w^-1.85 s
// (Evans 1993, NISTIR 5254 eq. 4: the conservative bound; an exposed sofa
// measured tau = 9.1 s at 0.07 mm/s, this gives 410 s).
//
// FOR THE CARD (task A). Each item with a burning model carries object.burn:
// phase, the dose so far and the dose that ignites it, an estimated surface
// temperature (exact for a steady flux above the critical one, 估算 otherwise),
// time on its curve, the curve itself, and one sample a second of
// [time, flux, surface °C, kW] in history. Plain data; nothing to call.
//
// LOOK. Burning items glow (dull red to orange with their heat release),
// pyrolysing ones brown, burnt-out ones go charcoal. These are tinted copies
// of the furniture meshes, as radiation.js tints by flux: no volume pass, and
// dressing.js is untouched.
import * as THREE from 'three';

export const PARAMS = {
  ambientC: { value: 20, unit: '°C', source: 'the solver\'s ambient (mac3d.js T0 = 293 K)' },
  sigma: { value: 5.67e-11, unit: 'kW/m²K⁴', source: 'Stefan–Boltzmann constant' },
  contactH: { value: 0.02, unit: 'kW/m²K', source: '假设: convection from hot gas or flame touching a surface, 20 W/m²K' },
  heatedFlux: { value: 1, unit: 'kW/m²', source: '假设: an item counts as 受热 from 1 kW/m² (radiation.js tints from 1)' },
  historyEvery: { value: 1, unit: 's', source: '假设: one card sample a second' },
  historyLength: { value: 3600, unit: 'samples', source: '假设: an hour at one a second' },
  endFraction: { value: 0.01, unit: 'of peak', source: '假设: an item is burnt out when its curve falls under 1% of its peak after the peak' },
  wetOut: { value: 0.02, unit: 'of the dry heat release', source: '假设: under 2% left after water, the fire is out' },
  contactFlux: { value: 30, unit: 'kW/m²', source: 'NIST TN 1446 (Ohlemiller & Gann 2003) p. 11: "flame contact fluxes are of the order of 30 kW/m² or more"; the low end' },
  flameReach: { value: 0.2, unit: 'm', source: 'NIST TN 1446 p. 19: flames reached 20 cm (bedclothes fire) to 39 cm (twin bed) sideways from a burning bed; the low end, used for every flame (假设)' },
  flameHeight: { value: [0.235, 1.02], unit: 'L = a Q^(2/5) − b D (kW, m)', source: 'Heskestad flame height, as radiation.js' },
  airRhoCp: { value: 1.2 * 1005, unit: 'J/m³K', source: 'air, as house.js counts heat' },
};
const P = (k) => PARAMS[k].value;
const T0K = 293;

const val = (m, key) => (m && m[key] && typeof m[key] === 'object' ? m[key].value : undefined);

/**
 * How one material burns: hrr(t) in W from ignition, the time it is burnt
 * out, its peak, its total (J), and a sampled curve [[s, kW]] for the card.
 * Null if the material has no burning numbers.
 */
export function burnModel(materials, key, o) {
  let m = materials[key];
  if (!m || val(m, 'combustible') === false) return null;
  let factor = 1;
  if (m.scaleFrom) { factor = m.scaleFrom.factor; m = { ...materials[m.scaleFrom.value], ...m }; }
  const curve = val(m, 'curve') ?? (m.scaleFrom ? val(materials[m.scaleFrom.value], 'curve') : undefined);
  if (curve) {
    const pts = curve.map(([t, kW]) => [t, kW * 1e3 * factor]);
    let total = 0, peak = 0, tPeak = 0;
    for (let i = 1; i < pts.length; i++) total += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
    for (const [t, q] of pts) if (q > peak) { peak = q; tPeak = t; }
    const end = pts[pts.length - 1][0];
    const hrr = (t) => {
      if (t <= 0 || t >= end) return 0;
      let i = 1;
      while (pts[i][0] < t) i++;
      const [ta, qa] = pts[i - 1], [tb, qb] = pts[i];
      return qa + (qb - qa) * (t - ta) / (tb - ta);
    };
    return { kind: 'measured', hrr, end, peak, tPeak, total, curve: pts.map(([t, q]) => [t, q / 1e3]) };
  }
  // t^2 to the peak, then exponential decay to the total.
  const length = Math.max(o.size[0], o.size[2]);
  const plan = o.size[0] * o.size[2];
  let peak = val(m, 'peakHRR');
  if (peak == null && val(m, 'peakHRRPerMetre') != null) peak = val(m, 'peakHRRPerMetre') * length;
  if (peak == null && val(m, 'peakHRRPerArea') != null) peak = val(m, 'peakHRRPerArea') * plan;
  const total = (o.fuelMJ ?? 0) * 1e6;
  let tp = val(m, 'timeToPeak');
  if (!(peak > 0) || !(total > 0) || !(tp > 0)) return null;
  // A peak that would release more than the total while growing: grow faster.
  if (peak * tp / 3 > 0.5 * total) tp = 1.5 * total / peak;
  const tau = (total - peak * tp / 3) / peak;
  const end = tp + tau * Math.log(1 / P('endFraction'));
  const hrr = (t) => (t <= 0 || t >= end ? 0 : t < tp ? peak * (t / tp) ** 2 : peak * Math.exp(-(t - tp) / tau));
  const pts = [];
  for (let t = 0; t <= end; t += Math.max(5, end / 200)) pts.push([Math.round(t), hrr(t) / 1e3]);
  return { kind: 'assumed', hrr, end, peak, tPeak: tp, tau, total, curve: pts };
}

export default function combustion(world) {
  const { fire, grid, objects, materials } = world;
  const cellV = grid.cell ** 3;
  const SIG = P('sigma'), H = P('contactH');

  // The igniter is the drag-placed fire in house.js; its numbers live in materials.json.
  if (materials.igniter && typeof fire.setIgniter === 'function') fire.setIgniter(materials.igniter);

  // --- every item that can burn ------------------------------------------------------
  const items = [];
  for (const o of objects.list) {
    if (!o.combustible) continue;
    const model = burnModel(materials, o.material, o);
    if (!model) continue;
    const m = materials[o.material];
    const mm = m.scaleFrom ? { ...materials[m.scaleFrom.value], ...m } : m;
    const tig = val(mm, 'ignitionTemp'), krc = val(mm, 'krc'), qcr = val(mm, 'criticalFlux');
    if (tig == null || krc == null || qcr == null) continue;
    const it = {
      o, model,
      chi: val(mm, 'radiantFraction') ?? 0.35,
      hc: val(mm, 'heatOfCombustion') ?? 17e6,
      soot: val(mm, 'sootYield') ?? 0.015,
      tig, krc, qcr,
      need: (Math.PI / 4) * krc * (tig - P('ambientC')) ** 2,   // (kW/m²)² s
      pyro: val(mm, 'pyrolysisTemp') ?? null,
      outFlux: val(mm, 'extinctionFlux') ?? null,
      outDelay: val(mm, 'extinctionDelay') ?? 60,
      outUntil: val(mm, 'extinctionUntil') ?? 'always',
      volume: Math.max(1, o.cells.length) * cellV,
      history: null,
    };
    items.push(it);
    fresh(it);
  }
  const byObject = new Map(items.map((it) => [it.o, it]));

  function fresh(it) {
    it.dose = 0; it.t = 0; it.below = 0; it.wetMul = 1; it.lastWet = 0;
    it.sampleAt = 0; it.n = 0; it.burning = false; it.qIn = 0;
    if (it.history) it.history.fill(0);
    const o = it.o;
    o.burn = {
      phase: 'cold', kind: it.model.kind, curve: it.model.curve, peakW: it.model.peak, totalMJ: it.model.total / 1e6,
      dose: 0, doseToIgnite: it.need, criticalFlux: it.qcr, ignitionTemp: it.tig, surfaceC: P('ambientC'),
      extinctionFlux: it.outFlux, t: 0, heatIn: 0, history: it.history, samples: 0,
    };
  }

  /** The flux from the gas touching it (kW/m²): its hottest own cell. */
  const contactFlux = (o) => {
    const temp = fire.temp;
    let dT = 0;
    for (const c of o.cells) if (temp[c] > dT) dT = temp[c];
    if (dT <= 0) return 0;
    const T = T0K + dT;
    return H * dT + SIG * (T ** 4 - T0K ** 4);
  };

  // --- world.ignite: C's flashover and D's deflagration call this -----------------------
  world.ignite = (o, why = 'ignite') => {
    const it = byObject.get(o);
    if (!it || o.state === '燃烧' || o.state === '烧尽') return false;
    it.burning = true;
    it.below = 0;
    it.dose = Math.max(it.dose, it.need);
    o.state = '燃烧';
    if (o.ignitedAt == null) o.ignitedAt = world.time;
    o.burn.phase = 'burning';
    world.events.emit({
      type: '点燃', objectId: o.id, pos: centre(o),
      data: { flux: +it.qIn.toFixed(1), by: why, material: o.material, resumedAt: it.t > 0 ? Math.round(it.t) : undefined },
    });
    return true;
  };

  function out(it, why) {
    const o = it.o;
    it.burning = false;
    // To flame again its surface has to heat up again, now under char (假设:
    // from nothing, as a fresh item).
    it.dose = 0;
    o.hrr = 0;
    o.state = '熄灭';
    o.burn.phase = 'out';
    world.events.emit({ type: '熄灭', objectId: o.id, pos: centre(o), data: { why, burnedMJ: +o.burnedMJ.toFixed(1), flux: +o.flux.toFixed(1) } });
  }

  // --- 2. source: burning items write heat and soot -----------------------------------
  function source(w, dt) {
    const { fuel, dens } = fire;
    for (const it of items) {
      if (!it.burning) continue;
      const o = it.o;
      // Water landing on it (water.js): Evans 1993.
      const wr = o.wetRate ?? 0;
      if (wr > 0) it.wetMul *= Math.exp(-dt / (3.0 * Math.pow(wr, -1.85)));
      it.t += dt;
      // Going out takes extinctionDelay; meanwhile the flame dies down (假设: linearly).
      const dying = it.below > 0 ? Math.max(0, 1 - it.below / it.outDelay) : 1;
      const q = it.model.hrr(it.t) * it.wetMul * dying;
      o.hrr = q;
      o.burnedMJ += q * dt / 1e6;
      o.burn.t = it.t;
      if (q > 0) {
        const heat = dt * q * (1 - it.chi) / (P('airRhoCp') * it.volume);
        const soot = dt * q / it.hc * it.soot * 1000 / it.volume;
        for (const c of o.cells) { fuel[c] += heat; dens[c] += soot; }
        sootMadeG += soot * it.volume;
        heatMadeJ += dt * q * (1 - it.chi);
      }
      if (it.t >= it.model.end) {
        it.burning = false;
        o.hrr = 0;
        o.state = '烧尽';
        o.burn.phase = 'burnt';
        world.events.emit({ type: '烧尽', objectId: o.id, pos: centre(o), data: { burnedMJ: +o.burnedMJ.toFixed(0), afterS: Math.round(it.t) } });
      } else if (it.wetMul < P('wetOut')) {
        out(it, 'water');
      }
    }
  }

  // --- flames: the volume where an item is in flame contact ------------------------------
  // Each flame is a box: the burning item's (or the igniter's) plan grown by the
  // sideways reach, from its bottom up to its Heskestad flame height. Up to
  // 128 at once, kept in one preallocated array.
  const FL = new Float64Array(128 * 7);   // x0, x1, z0, z1, y0, y1, owner index (-1 igniter)
  let nFlames = 0;
  let igniterBox = null, igniterPool = null;
  const flameHeight = (Q, D) => {
    const [a, b] = P('flameHeight');
    return Math.max(0, a * Math.pow(Q / 1e3, 0.4) - b * D);
  };
  function addFlame(min, max, Q, owner) {
    if (nFlames >= 128 || !(Q > 0)) return;
    const r = P('flameReach');
    const D = Math.sqrt((4 * (max[0] - min[0]) * (max[2] - min[2])) / Math.PI);
    const k = 7 * nFlames++;
    FL[k] = min[0] - r; FL[k + 1] = max[0] + r; FL[k + 2] = min[2] - r; FL[k + 3] = max[2] + r;
    FL[k + 4] = min[1]; FL[k + 5] = min[1] + Math.max(max[1] - min[1], flameHeight(Q, D)); FL[k + 6] = owner;
  }
  function gatherFlames() {
    nFlames = 0;
    // The igniter: its patch of floor.
    const pool = fire.firePool, q = pool && pool.length ? fire.heatRelease() : 0;
    if (q > 0) {
      if (pool !== igniterPool) {
        igniterPool = pool;
        const { origin, cell, nx, ny } = grid;
        const W = nx + 2, H = ny + 2;
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const c of pool) {
          const i = c % W, j = Math.floor(c / W) % H, kk = Math.floor(c / (W * H));
          const p = [origin.x + (i - 1) * cell, origin.y + (j - 1) * cell, origin.z + (kk - 1) * cell];
          for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a] + cell); }
        }
        igniterBox = [lo, [hi[0], lo[1] + cell, hi[2]]];
      }
      addFlame(igniterBox[0], igniterBox[1], q, -1);
    }
    for (let n = 0; n < items.length; n++) {
      const o = items[n].o;
      if (o.hrr > 0) addFlame(o.min, o.max, o.hrr, n);
    }
  }
  /** True if the item's box is inside some other fire's flame. */
  function inFlame(o, self) {
    for (let f = 0; f < nFlames; f++) {
      const k = 7 * f;
      if (FL[k + 6] === self) continue;
      if (o.max[0] > FL[k] && o.min[0] < FL[k + 1] && o.max[2] > FL[k + 2] && o.min[2] < FL[k + 3] && o.max[1] > FL[k + 4] && o.min[1] < FL[k + 5]) return true;
    }
    return false;
  }

  // --- 5. react: what heats up, ignites, goes out ---------------------------------------
  const haveRadiation = () => !!world.radiation && !world.radiation.off;
  function react(w, dt) {
    const radiation = haveRadiation();
    const T0 = P('ambientC');
    gatherFlames();
    for (let n = 0; n < items.length; n++) {
      const it = items[n];
      const o = it.o;
      if (o.state === '烧尽') continue;
      // What reaches it from outside: radiation (C), and flame contact from
      // another fire or the igniter. Its own fire is in neither.
      let radiant = radiation ? o.flux : 0;
      const touched = nFlames > 0 && inFlame(o, n);
      if (touched) radiant = Math.max(radiant, P('contactFlux'));
      if (it.burning) {
        // Wood goes out when what reaches it from outside is too little; an
        // item still in another fire's flame keeps going.
        if (it.outFlux != null && (it.outUntil === 'always' || it.t < it.model.tPeak)) {
          it.below = radiant < it.outFlux && !touched ? it.below + dt : 0;
          if (it.below >= it.outDelay) out(it, 'flux');
        }
        it.qIn = radiant;
      } else {
        const q = Math.max(radiant, contactFlux(o));
        it.qIn = q;
        if (q >= it.qcr) it.dose += q * q * dt;
        else it.dose = Math.max(0, it.dose - (it.qcr * it.qcr - q * q) * dt);
        const f = Math.min(1, it.dose / it.need);
        o.burn.surfaceC = T0 + (it.tig - T0) * Math.sqrt(f);
        if (o.state === '完好' && q >= P('heatedFlux')) o.state = '受热';
        if (o.state === '受热' && it.pyro != null && o.burn.surfaceC >= it.pyro) o.state = '热分解';
        if (o.state !== '熄灭' && o.state !== '完好') o.burn.phase = o.state === '热分解' ? 'pyrolysing' : 'heating';
        if (it.dose >= it.need) world.ignite(o, 'flux');
      }
      o.dose = it.dose;
      o.burn.dose = it.dose;
      o.burn.heatIn = it.qIn;
      if (it.burning) o.burn.surfaceC = it.tig;
      // One sample a second for the card's chart, only for items something is happening to.
      if (o.state !== '完好' && w.time >= it.sampleAt) {
        if (!it.history) { it.history = new Float32Array(4 * P('historyLength')); o.burn.history = it.history; }
        if (it.n < P('historyLength')) {
          const k = 4 * it.n++;
          it.history[k] = w.time; it.history[k + 1] = it.qIn; it.history[k + 2] = o.burn.surfaceC; it.history[k + 3] = o.hrr / 1e3;
          o.burn.samples = it.n;
        }
        it.sampleAt = w.time + P('historyEvery');
      }
    }
  }

  // --- 6. report: the look ---------------------------------------------------------------
  let look = null, reports = 0;
  function buildLook() {
    const view = world.view;
    const furniture = view?.extras?.furniture;
    if (!furniture || typeof document === 'undefined') return null;
    const group = new THREE.Group();
    const tints = [];
    for (const m of furniture.elements) {
      const it = byObject.get(objects.byElement.get(m.userData.element));
      if (!it) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: view.cut ? [view.cut] : [], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      });
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.renderOrder = 2;   // under radiation.js's flux tint (3) when that is on
      mesh.visible = false;
      group.add(mesh);
      tints.push({ it, mesh, mat });
    }
    view.scene.add(group);
    return { group, tints };
  }
  const EMBER = new THREE.Color(0.55, 0.06, 0.02), FLAME = new THREE.Color(1.0, 0.62, 0.12);
  const BROWN = new THREE.Color(0.36, 0.2, 0.08), CHAR = new THREE.Color(0.07, 0.06, 0.055);
  function paint() {
    if (!look) return;
    look.group.visible = world.view?.extraMeshes?.furniture?.visible !== false;
    const flicker = 0.9 + 0.1 * Math.sin(world.time * 7.3);
    for (const { it, mesh, mat } of look.tints) {
      const o = it.o;
      const burnt = Math.min(1, o.burnedMJ * 1e6 / it.model.total);
      if (o.state === '燃烧') {
        const s = Math.min(1, Math.sqrt(o.hrr / it.model.peak));
        mat.color.copy(EMBER).lerp(FLAME, s);
        mat.opacity = (0.55 + 0.35 * s) * flicker;
        // Under the glow, what has burned is already charred.
        if (burnt > 0.5) mat.color.lerp(CHAR, (burnt - 0.5));
      } else if (o.state === '烧尽') {
        mat.color.copy(CHAR); mat.opacity = 0.93;
      } else if (o.state === '熄灭') {
        mat.color.copy(CHAR); mat.opacity = 0.5 + 0.4 * burnt;
      } else if (o.state === '热分解' || o.state === '受热') {
        const f = Math.min(1, it.dose / it.need);
        mat.color.copy(BROWN); mat.opacity = 0.55 * f * f;
      } else {
        mat.opacity = 0;
      }
      mesh.visible = mat.opacity > 0.02;
    }
  }
  function report() {
    if (!look && world.view && reports === 0) look = buildLook();
    if (reports++ % 3 === 0) paint();
  }

  let sootMadeG = 0, heatMadeJ = 0;
  const mod = {
    source,
    react,
    report,
    reset() {
      for (const it of items) fresh(it);
      sootMadeG = 0; heatMadeJ = 0;
      paint();
    },
    // For the console and tools/combustion-check.mjs.
    PARAMS,
    items,
    /** Grams of soot and joules of heat the burning items have put into the air. */
    made() { return { sootG: sootMadeG, heatJ: heatMadeJ }; },
    /** Every item that is not cold: state, kW, dose share, surface °C, flux in. */
    status() {
      return items.filter((it) => it.o.state !== '完好').map((it) => ({
        id: it.o.id, label: it.o.label, room: it.o.room, state: it.o.state, kW: Math.round(it.o.hrr / 1e3),
        dose: +(it.dose / it.need).toFixed(2), surfaceC: Math.round(it.o.burn.surfaceC), fluxIn: +it.qIn.toFixed(1), burnedMJ: +it.o.burnedMJ.toFixed(1),
      }));
    },
  };
  world.combustion = mod;
  return mod;
}

const centre = (o) => [0, 1, 2].map((a) => (o.min[a] + o.max[a]) / 2);
