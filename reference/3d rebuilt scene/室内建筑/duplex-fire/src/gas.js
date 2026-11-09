// Natural gas (task D of 开工顺序.md): a cut or leaking gas line, gas rising
// and gathering under the ceiling, deflagration where it meets fire inside
// its flammable range, the boiler's gas valve failing in the heat and then
// feeding a steady gas fire, and the valve that stops it all.
//
// Every number is in materials.json (gas_pipe, gas_supply, gas_mixture,
// gas_appliance_valve) with its source or marked 假设; this file only reads them.
//
// The lines. Each unit's gas comes in through the west wall about 0.67 m under
// the ground floor (e573 Unit A, e566 Unit B), runs through the crawl space
// (outside the grid), up a riser in the wall beside the other unit's kitchen,
// and ends at the boiler in A205 / B205 Utility. The model has no meter,
// regulator or valve: the meter and the shut-off valve are put at the outer
// end of each line, and the boiler's own gas valve and regulator at the last
// piece of the line (假设 where both stand). As in water.js, two pieces count
// as joined when their boxes come within 2 cm.
//
// How much comes out. The service regulator holds a set pressure in front of
// the meter, whatever the flow (假设: no droop). Every open outlet (a cut, a
// leak, the failed boiler valve) is fed through the meter and along the line:
//   P = R_meter Q_total^2 + (R_path + R_outlet) q^2
// R_path from friction f L / D and a K per elbow, R_outlet an orifice. The
// gas's own buoyant head (about 20 Pa over the riser, 1 % of P) is left out.
//
// The field is the volume fraction of gas in the air, registered with
// fire.addScalar('gas'): the solver carries and mixes it and keeps its total.
// Gas is lighter than air, so this file pushes its cells up at
// g (1 - relative density) X, the same way mac3d.js lifts hot air at g dT/T0.
//
// Burning, two ways:
//  - Deflagration. A cell whose gas is between the lower and upper limits
//    (5-15 %) and that has flame in it or next to it (fire.fuel above a
//    threshold, or air above methane's autoignition temperature) lights. The
//    flame runs through every connected cell that is also between the limits,
//    and all their gas burns at once: its heat goes into fire.fuel, and the
//    solver turns that into heat no hotter than a flame (mac3d.js FLAME_DT),
//    carrying what cannot burn yet. Gas below 5 % does not burn; gas above
//    15 % waits until mixing brings its edge into range, and then that edge
//    burns (假设: no diffusion flame on a rich pocket). The pressure is not
//    simulated (the solver is incompressible); it is estimated as
//    closedPressure x cloud volume / the volume of air connected to it, an
//    upper bound, and windows and closed inside doors in reach of it fail
//    past their pressures (materials.json gas_mixture).
//  - A steady gas fire. An outlet whose gas meets flame (the same test, on its
//    own cells) lights and stays lit while gas flows: what flows out burns
//    where it comes out, and never enters the field. Shutting the valve puts
//    it out.
//
// The books, in m³ of gas at 20 C: released = in the air + burned in
// deflagrations + burned at the outlets + lost when cells turned solid (a
// door closing on gas: the solver empties cells that become solid) + let out
// off the grid (a cut in the crawl space) + carried outdoors by leaks.js.
//
// Cost: buoyancy and the deflagration test visit only cells that hold gas;
// that list is rebuilt from the whole grid every few steps, and only once
// gas has been released.
import * as THREE from 'three';

const G = 9.81;
const T_AMBIENT = 293;              // K: the solver's zero (mac3d.js T0)
const RHO_CP = 1.2 * 1005;          // J/(m3 K): as house.js counts heat in the air
const RHO_AIR = 1.2;
const TOUCH = 0.02;                 // m: two pipe boxes this close are joined
const TRACE = 1e-6;                 // volume fraction: a cell with less holds "no gas"
const REBUILD = 4;                  // steps between full rebuilds of the gas-cell list
const DRAW_EVERY = 3;               // steps between redraws of the gas cloud
const DRAW_MIN = 0.005;             // volume fraction drawn as a point
const DRAW_MAX = 30000;             // points at most (开工顺序.md 预算)
const BURST = 1;                    // s: burns closer together than this are one deflagration (假设)

const v = (m, key) => {
  const f = m?.[key];
  if (!f || typeof f !== 'object' || typeof f.value !== 'number') throw new Error(`[gas] materials.json is missing ${key}`);
  return f.value;
};

export default function gas(world) {
  const { fire, grid, objects } = world;
  const mat = world.materials;
  const pipeM = mat.gas_pipe, supply = mat.gas_supply, mix = mat.gas_mixture, valveM = mat.gas_appliance_valve;
  const P = {
    pressure: v(supply, 'deliveryPressure'),
    rMeter: v(supply, 'meterResistance'),
    sg: v(supply, 'relativeDensity'),
    lhv: v(supply, 'heatOfCombustion'),
    d: v(pipeM, 'innerDiameter'),
    friction: v(pipeM, 'frictionFactor'),
    fittingK: v(pipeM, 'fittingLoss'),
    cd: v(pipeM, 'dischargeCoefficient'),
    lfl: v(mix, 'lowerLimit'),
    ufl: v(mix, 'upperLimit'),
    aitC: v(mix, 'autoignitionTemp'),
    flameFuel: v(mix, 'flameFuel'),
    closedPressure: v(mix, 'closedPressure'),
    windowPa: v(mix, 'windowFailure'),
    doorPa: v(mix, 'doorFailure'),
    eventM3: v(mix, 'eventVolume'),
    chiR: v(pipeM, 'radiantFraction'),
    leakC: v(valveM, 'leakTemp'),
    leakFlow: v(valveM, 'leakFlow') / 3600,
    meltC: v(valveM, 'meltTemp'),
    lag: v(valveM, 'lag'),
  };
  const rhoGas = RHO_AIR * P.sg;
  const AIT = P.aitC + 273 - T_AMBIENT;          // in the solver's kelvin above ambient
  const lift = G * (1 - P.sg);                    // m/s2 per unit volume fraction
  const heatPerFraction = P.lhv / RHO_CP;         // K of fire.fuel per unit volume fraction burned

  const X = fire.addScalar('gas');
  const { cell, origin, index } = grid;
  const V = cell ** 3;
  const { sy, sz, W, H } = fire;

  // --- the lines ---------------------------------------------------------------------
  const bore = Math.PI * P.d * P.d / 4;
  const dyn = rhoGas / (2 * bore * bore);         // Pa per (m3/s)^2 per unit K
  const centre = (o) => [0, 1, 2].map((a) => (o.min[a] + o.max[a]) / 2);
  const touch = (a, b) => [0, 1, 2].every((k) => a.min[k] - TOUCH <= b.max[k] && b.min[k] - TOUCH <= a.max[k]);
  const orifice = (area) => rhoGas / (2 * (P.cd * area) ** 2);

  const units = {};
  const nodes = [];
  for (const o of objects.list) {
    if (o.class !== '燃气管') continue;
    const m = /^Unit (A|B) Natural Gas$/.exec(o.element?.system ?? '');
    if (!m) continue;
    const fitting = o.type !== 'IfcFlowSegment';
    const length = Math.max(...o.size);
    const node = { o, unit: m[1], fitting, length, next: [], r: fitting ? P.fittingK * dyn : P.friction * length / P.d * dyn, path: Infinity, outlet: null };
    nodes.push(node);
    (units[m[1]] ??= { name: m[1], nodes: [], open: true, flow: 0, pm: P.pressure }).nodes.push(node);
  }
  for (const u of Object.values(units)) {
    const list = u.nodes;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (touch(list[a].o, list[b].o)) { list[a].next.push(list[b]); list[b].next.push(list[a]); }
    }
    // The entry: the piece reaching furthest west, out through the wall.
    u.entry = [...list].sort((a, b) => a.o.min[0] - b.o.min[0])[0];
    const e = centre(u.entry.o);
    u.meterPos = [u.entry.o.min[0], e[1], e[2]];
    // Resistance from the meter to every piece (Dijkstra; a handful of nodes).
    u.entry.path = u.entry.r;
    const todo = new Set(list);
    while (todo.size) {
      let best = null;
      for (const n of todo) if (!best || n.path < best.path) best = n;
      todo.delete(best);
      if (best.path === Infinity) break;
      for (const m of best.next) if (best.path + m.r < m.path) m.path = best.path + m.r;
    }
    // The boiler's gas valve: on the last piece of the line that touches air.
    const reached = list.filter((n) => n.path < Infinity && n.o.cells.length > 0);
    u.end = reached.sort((a, b) => b.path - a.path)[0] ?? null;
    u.part = u.end ? { unit: u, node: u.end, tp: 0, stage: 0, outlet: null } : null;
  }
  const byObject = new Map(nodes.map((n) => [n.o, n]));
  const parts = Object.values(units).map((u) => u.part).filter(Boolean);

  // --- outlets ---------------------------------------------------------------------
  // kind: 'cut' (full bore), 'leak' (a share of the bore), 'valve' (the boiler's
  // gas valve, failed). lit: a steady gas fire is burning at it.
  const outlets = new Set();
  let dirty = true;

  function solveFlows() {
    for (const u of Object.values(units)) {
      const mine = [...outlets].filter((x) => x.unit === u);
      for (const x of mine) x.q = 0;
      u.flow = 0;
      if (!u.open || mine.length === 0) { u.pm = u.open ? P.pressure : 0; continue; }
      // Bisection on the pressure just past the meter.
      const out = (pm) => { let s = 0; for (const x of mine) s += Math.sqrt(pm / x.r); return s; };
      let lo = 0, hi = P.pressure;
      for (let it = 0; it < 60; it++) {
        const pm = (lo + hi) / 2;
        if (Math.sqrt((P.pressure - pm) / P.rMeter) > out(pm)) lo = pm; else hi = pm;
      }
      u.pm = (lo + hi) / 2;
      for (const x of mine) { x.q = Math.sqrt(u.pm / x.r); u.flow += x.q; }
    }
    dirty = false;
  }

  function open(node, kind, share, data = {}) {
    let x = node.outlet;
    const rOut = kind === 'valve' && share == null
      // The leaking valve: sized so that, alone on the line, it lets out leakFlow.
      ? Math.max(P.pressure / P.leakFlow ** 2 - P.rMeter - node.path, 0)
      : orifice(bore * share);
    if (!x) {
      x = { kind, unit: units[node.unit], node, id: node.o.id, cells: node.o.cells, q: 0, lit: false, since: world.time, released: 0, burned: 0 };
      node.outlet = x;
      outlets.add(x);
    }
    x.kind = kind;
    x.share = share;
    x.r = node.path + rOut;
    if (node.o.state !== '失效') node.o.state = '失效';
    solveFlows();
    if (!x.cells.length) console.warn(`[gas] ${node.o.id} is in the crawl space or outside, off the grid: gas will flow there, but nowhere the house can see`);
    draw.dirty = true;
    return x;
  }

  // --- the books and the gas-cell list -------------------------------------------------
  const books = { released: 0, burnedDeflagration: 0, burnedAtOutlets: 0, lostToSolid: 0, offGrid: 0, deflagrations: 0 };
  const active = new Int32Array(fire.size);
  const listed = new Uint8Array(fire.size);   // 1 for the cells in active[], so none is listed twice
  const seedList = new Int32Array(fire.size);
  let activeCount = 0;
  let stepCount = 0;
  let lastFluid = fire.fluid;
  let lastTotal = 0;
  const any = () => books.released > 0;

  const fieldTotal = () => { let s = 0; const f = fire.fluid; for (let n = 0; n < f.length; n++) s += X[f[n]]; return s * V; };

  function rebuildActive() {
    for (let s = 0; s < activeCount; s++) listed[active[s]] = 0;
    const f = fire.fluid;
    let n = 0;
    for (let s = 0; s < f.length; s++) { const c = f[s]; if (X[c] > TRACE) { active[n++] = c; listed[c] = 1; } }
    activeCount = n;
  }

  // --- flame, deflagration, pressure -------------------------------------------------------
  const temp = fire.temp, fuel = fire.fuel;
  // Cells inside a lit outlet's flame (see markFlames).
  const inFlame = new Uint8Array(fire.size);
  const flameCells = [];
  const flameAt = (c) => inFlame[c] === 1 || fuel[c] >= P.flameFuel || temp[c] >= AIT;
  const lightsAt = (c) => flameAt(c) || flameAt(c - 1) || flameAt(c + 1) || flameAt(c - sy) || flameAt(c + sy) || flameAt(c - sz) || flameAt(c + sz);
  const flammable = (x) => x >= P.lfl && x <= P.ufl;

  let burst = null;                               // the deflagration being added up
  const mark = new Uint8Array(fire.size);         // flood fills; always cleared after use
  const queue = new Int32Array(fire.size);

  /** Cells reachable from `seeds` through open faces, where keep(c). Returns how many are in queue[0..n). */
  function flood(seeds, count, keep) {
    let n = 0;
    for (let s = 0; s < count; s++) { const c = seeds[s]; if (!mark[c]) { mark[c] = 1; queue[n++] = c; } }
    const { openX, openY, openZ } = fire;
    for (let h = 0; h < n; h++) {
      const c = queue[h];
      const step = (m, isOpen) => { if (isOpen && !mark[m] && keep(m)) { mark[m] = 1; queue[n++] = m; } };
      step(c - 1, openX[c]); step(c + 1, openX[c + 1]);
      step(c - sy, openY[c]); step(c + sy, openY[c + sy]);
      step(c - sz, openZ[c]); step(c + sz, openZ[c + sz]);
    }
    return n;
  }
  const unmark = (n) => { for (let h = 0; h < n; h++) mark[queue[h]] = 0; };

  const cellCentre = (c) => {
    const i = c % W, j = Math.floor(c / W) % H, k = Math.floor(c / (W * H));
    return [origin.x + (i - 0.5) * cell, origin.y + (j - 0.5) * cell, origin.z + (k - 0.5) * cell];
  };

  /**
   * A gas flame is taller than the cells it burns in: 200 kW out of a 1 in
   * pipe stands about 2 m (Heskestad, L = 0.235 Q^0.4 - 1.02 D, Q in kW),
   * enough to reach the ceiling, but on a 20 cm grid the solver puts all its
   * heat in the outlet's two cells and the gas layer under the ceiling never
   * met it: the first time this ran in the page, a 197 kW gas fire burned for
   * 20 s under a layer at 5-15 % that did not light. So the cells straight
   * above each lit outlet, up to its flame height, count as flame.
   */
  function markFlames() {
    for (const c of flameCells) inFlame[c] = 0;
    flameCells.length = 0;
    for (const o of outlets) {
      if (!o.lit || !(o.q > 0)) continue;
      const kW = o.q * P.lhv / 1000;
      const L = Math.max(0, 0.235 * kW ** 0.4 - 1.02 * P.d);
      const n = Math.ceil(L / cell);
      for (const c0 of o.cells) {
        let c = c0;
        for (let h = 0; h <= n; h++) {
          if (grid.solid[c]) break;
          if (!inFlame[c]) { inFlame[c] = 1; flameCells.push(c); }
          if (!fire.openY[c + sy]) break;
          c += sy;
        }
      }
    }
  }

  /** Burn every connected cell between the limits, starting from the seeds. */
  function deflagrate(seeds, count) {
    const n = flood(seeds, count, (m) => flammable(X[m]));
    let gasM3 = 0, peak = 0, low = Infinity;
    for (let h = 0; h < n; h++) {
      const c = queue[h], x = X[c];
      gasM3 += x * V;
      if (x > peak) peak = x;
      if (x < low) low = x;
      fuel[c] += x * heatPerFraction;
      X[c] = 0;
    }
    // Outlets the flame reached light, and stay lit while gas flows.
    for (const o of outlets) if (!o.lit && o.q > 0) for (const c of o.cells) if (mark[c]) { light(o, 'deflagration'); break; }
    books.lowestBurned = Math.min(books.lowestBurned ?? Infinity, low);
    books.highestBurned = Math.max(books.highestBurned ?? 0, peak);
    books.burnedDeflagration += gasM3;
    // Burns less than BURST apart count as one deflagration: an igniter on the
    // floor reaches a layer under the ceiling a few cells at a time, and each
    // bite alone was under eventVolume, so none was reported the first time
    // this ran in the page (假设: within BURST they add up to one push).
    if (!burst || world.time - burst.last > BURST) {
      burst = { cells: 0, cloudM3: 0, gasM3: 0, peak: 0, low: Infinity, rooms: new Set(), lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], since: world.time };
    }
    burst.last = world.time;
    burst.cells += n; burst.cloudM3 += n * V; burst.gasM3 += gasM3;
    burst.peak = Math.max(burst.peak, peak); burst.low = Math.min(burst.low, low);
    for (let h = 0; h < n; h++) {
      const p = cellCentre(queue[h]);
      for (let a = 0; a < 3; a++) { burst.lo[a] = Math.min(burst.lo[a], p[a]); burst.hi[a] = Math.max(burst.hi[a], p[a]); }
      for (const r of world.rooms ?? []) if (!burst.rooms.has(r) && [0, 1, 2].every((a) => p[a] >= r.min[a] && p[a] <= r.max[a])) burst.rooms.add(r);
    }
    unmark(n);
    if (burst.gasM3 >= P.eventM3) {
      burst.pos = burst.lo.map((l, a) => +((l + burst.hi[a]) / 2).toFixed(2));
      blast(burst, seeds, count);
      burst = null;
    }
  }

  /**
   * The pressure of a cloud that burned: an upper bound for a closed space
   * (materials.json gas_mixture pressureModel), over all the air the cloud's
   * cells connect to. Past their pressures, the windows and closed inside
   * doors of the rooms the cloud was in fail. Only those: the first openings
   * to go let the pressure out, so taking every window of the connected air
   * (11 across both storeys of Unit A, the first time this ran) overstated it
   * (假设: the cloud's own rooms are the ones that vent).
   */
  function blast(cloud, seeds, count) {
    const zone = flood(seeds, count, () => true);
    const zoneM3 = zone * V;
    const pa = P.closedPressure * cloud.cloudM3 / zoneM3;
    const windows = [], doorsOpened = [], doorsHeld = [];
    // Within a wall's thickness of one of the cloud's rooms.
    const NEAR = 0.4;
    const nearRoom = (min, max) => [...cloud.rooms].some((r) => [0, 1, 2].every((a) => min[a] <= r.max[a] + NEAR && max[a] >= r.min[a] - NEAR));
    if (pa >= Math.min(P.windowPa, P.doorPa)) {
      if (pa >= P.windowPa) {
        for (const o of objects.list) {
          if (o.class !== '窗' || o.state === '失效' || !nearRoom(o.min, o.max)) continue;
          for (const c of o.cells) if (mark[c]) { o.state = '失效'; windows.push(o.id); break; }
        }
      }
      if (pa >= P.doorPa) {
        // A closed door's cells are solid; it borders the zone when a cell next to one is in it.
        for (const d of grid.doors) {
          if (d.open || !nearRoom(d.element.min, d.element.max)) continue;
          const touches = d.cells.some((c) => mark[c - 1] || mark[c + 1] || mark[c - sy] || mark[c + sy] || mark[c - sz] || mark[c + sz]);
          if (!touches) continue;
          if (d.outside) { doorsHeld.push(d.element.name); continue; }   // no outdoors in the solver yet (doors.js)
          const door = world.view?.doors?.doors?.find((x) => x.state === d);
          if (door) { world.view.doors.toggle(door); doorsOpened.push(d.element.name); } else doorsHeld.push(d.element.name);
        }
      }
    }
    unmark(zone);
    books.deflagrations++;
    world.events.emit({
      type: '燃气爆燃', pos: cloud.pos,
      data: {
        gasM3: +cloud.gasM3.toFixed(3), MJ: +(cloud.gasM3 * P.lhv / 1e6).toFixed(1), cloudM3: +cloud.cloudM3.toFixed(2),
        peakPercent: +(cloud.peak * 100).toFixed(1), lowestPercent: +(cloud.low * 100).toFixed(1), connectedAirM3: +zoneM3.toFixed(1), kPaUpperBound: +(pa / 1000).toFixed(2),
        rooms: [...cloud.rooms].map((r) => `${r.code} ${r.name}`), windowsFailed: windows, doorsOpened, doorsThatWouldGo: doorsHeld,
      },
    });
    if (windows.length || doorsOpened.length) {
      world.events.emit({ type: '门窗被冲开', pos: cloud.pos, data: { kPaUpperBound: +(pa / 1000).toFixed(2), windows, doors: doorsOpened } });
    }
  }

  function light(o, why) {
    o.lit = true;
    world.events.emit({
      type: '燃气点燃', objectId: o.id, pos: centre(o.node.o),
      data: { unit: o.unit.name, kind: o.kind, by: why, kW: +(o.q * P.lhv / 1000).toFixed(0), m3PerHour: +(o.q * 3600).toFixed(2) },
    });
    draw.dirty = true;
  }

  // --- drawing (page only) ------------------------------------------------------------
  const draw = { dirty: true, points: null, markers: null, show: true };
  const view = world.view;
  if (view?.scene) {
    const clip = view.cut ? [view.cut] : [];
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DRAW_MAX * 3), 3));
    geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(DRAW_MAX * 3), 3));
    geom.setDrawRange(0, 0);
    draw.points = new THREE.Points(geom, new THREE.PointsMaterial({
      // Drawn through the see-through walls, as the services are: the gas is
      // usually in a room the camera looks into from outside.
      size: 0.16, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, clippingPlanes: clip,
    }));
    draw.points.renderOrder = 10;
    draw.points.frustumCulled = false;
    draw.markers = new THREE.Group();
    draw.group = new THREE.Group();
    draw.group.name = 'gas';
    draw.group.add(draw.points, draw.markers);
    draw.geom = { meter: new THREE.BoxGeometry(0.14, 0.14, 0.14), part: new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), outlet: new THREE.SphereGeometry(0.08, 12, 8), flame: new THREE.ConeGeometry(0.1, 0.35, 12) };
    draw.mat = {
      meter: new THREE.MeshBasicMaterial({ color: 0xffc400, clippingPlanes: clip }),
      shut: new THREE.MeshBasicMaterial({ color: 0x777777, clippingPlanes: clip }),
      part: new THREE.MeshBasicMaterial({ color: 0xffc400, clippingPlanes: clip }),
      outlet: new THREE.MeshBasicMaterial({ color: 0xffe066, clippingPlanes: clip }),
      flame: new THREE.MeshBasicMaterial({ color: 0xff6a1a, clippingPlanes: clip }),
    };
    view.scene.add(draw.group);
  }
  // Below the lower limit: pale yellow; in range: orange; above: magenta.
  const COLOUR = { lean: [1.0, 0.9, 0.45], burnable: [1.0, 0.5, 0.08], rich: [0.85, 0.2, 0.55] };

  function redrawMarkers() {
    if (!draw.markers) return;
    draw.markers.clear();
    const add = (geom, m, pos) => { const mesh = new THREE.Mesh(geom, m); mesh.position.set(...pos); draw.markers.add(mesh); };
    for (const u of Object.values(units)) {
      add(draw.geom.meter, u.open ? draw.mat.meter : draw.mat.shut, u.meterPos);
      if (u.part && !u.part.outlet) add(draw.geom.part, draw.mat.part, centre(u.part.node.o));
    }
    for (const o of outlets) {
      const p = centre(o.node.o);
      if (o.lit && o.q > 0) add(draw.geom.flame, draw.mat.flame, [p[0], p[1] + 0.15, p[2]]);
      else add(draw.geom.outlet, draw.mat.outlet, p);
    }
    draw.dirty = false;
  }

  function redrawCloud() {
    if (!draw.points) return;
    draw.points.visible = draw.show;
    if (!draw.show) return;
    const g = draw.points.geometry;
    if (!any()) { g.setDrawRange(0, 0); return; }
    const pos = g.attributes.position.array, col = g.attributes.color.array;
    let n = 0;
    for (let s = 0; s < activeCount && n < DRAW_MAX; s++) {
      const c = active[s], x = X[c];
      if (x < DRAW_MIN) continue;
      const p = cellCentre(c);
      pos[3 * n] = p[0]; pos[3 * n + 1] = p[1]; pos[3 * n + 2] = p[2];
      const k = x < P.lfl ? COLOUR.lean : x <= P.ufl ? COLOUR.burnable : COLOUR.rich;
      col[3 * n] = k[0]; col[3 * n + 1] = k[1]; col[3 * n + 2] = k[2];
      n++;
    }
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
  }

  // --- each step ---------------------------------------------------------------------

  /** 1. Flows follow the valves and the outlets; gas that vanished with a closing door is booked. */
  function act() {
    stepCount++;
    if (dirty) solveFlows();
    if (fire.fluid !== lastFluid) {
      lastFluid = fire.fluid;
      if (any()) { books.lostToSolid += Math.max(0, lastTotal - fieldTotal()); rebuildActive(); }
    }
  }

  /** 2. Outlets put gas into the air (or burn it, when lit); gas cells are pushed up. */
  function source(w, dt) {
    for (const o of outlets) {
      const lit = o.lit && o.q > 0;
      o.node.o.hrr = lit ? o.q * P.lhv : 0;
      if (!(o.q > 0)) { if (o.lit) { o.lit = false; draw.dirty = true; } continue; }
      const m3 = o.q * dt;
      books.released += m3;
      o.released += m3;
      const cells = o.cells;
      if (!cells.length) continue;   // off the grid: booked as released and as lost below
      if (lit) {
        const add = m3 * P.lhv * (1 - P.chiR) / (RHO_CP * cells.length * V);
        for (const c of cells) fuel[c] += add;
        books.burnedAtOutlets += m3;
        o.burned += m3;
      } else {
        const add = m3 / (cells.length * V);
        for (const c of cells) {
          if (grid.solid[c]) { books.lostToSolid += add * V; continue; }
          if (!listed[c]) { listed[c] = 1; active[activeCount++] = c; }
          X[c] += add;
        }
      }
    }
    // Off-grid outlets (the crawl space): what they let out never reaches the house.
    for (const o of outlets) if (!o.cells.length && o.q > 0) books.offGrid += o.q * dt;
    if (!any()) return;
    if (stepCount % REBUILD === 0) rebuildActive();
    // Buoyancy, half of each cell's lift on its lower face and half on its upper.
    const k = 0.5 * dt * lift;
    const { vf, openY } = fire;
    for (let s = 0; s < activeCount; s++) {
      const c = active[s], x = X[c];
      if (x <= 0) continue;
      if (openY[c]) vf[c] += k * x;
      if (openY[c + sy]) vf[c + sy] += k * x;
    }
  }

  /** 5. Deflagration and lit outlets; the boiler valves heat up and fail. */
  function react(w, dt) {
    if (any()) {
      markFlames();
      // Seeds: cells in range with flame in or beside them.
      let seeds = 0;
      for (let s = 0; s < activeCount; s++) {
        const c = active[s], x = X[c];
        if (flammable(x) && lightsAt(c)) seedList[seeds++] = c;
      }
      if (seeds) deflagrate(seedList, seeds);
      for (const o of outlets) {
        if (o.lit || !(o.q > 0)) continue;
        for (const c of o.cells) if (lightsAt(c)) { light(o, 'flame or hot gas'); break; }
      }
    }
    // The boiler valves.
    const leak = P.leakC + 273 - T_AMBIENT, melt = P.meltC + 273 - T_AMBIENT;
    const ease = 1 - Math.exp(-dt / P.lag);
    for (const p of parts) {
      const cells = p.node.o.cells;
      let tg = 0;
      for (const c of cells) tg += temp[c];
      tg /= cells.length;
      p.tp += (tg - p.tp) * ease;
      if (p.stage === 0 && p.tp >= leak) fail(p, 1);
      if (p.stage === 1 && p.tp >= melt) fail(p, 2);
    }
    if (any()) lastTotal = fieldTotal();
  }

  function fail(p, stage) {
    p.stage = stage;
    p.outlet = open(p.node, 'valve', stage === 2 ? 1 : null);
    world.events.emit({
      type: stage === 1 ? '燃气阀失效' : '燃气阀烧穿', objectId: p.node.o.id, pos: centre(p.node.o),
      data: { unit: p.unit.name, partC: +(p.tp + T_AMBIENT - 273).toFixed(0), m3PerHour: +(p.outlet.q * 3600).toFixed(2), kWIfLit: +(p.outlet.q * P.lhv / 1000).toFixed(1) },
    });
  }

  /** 6. Drawing, and the console handle once main.js has set up window.duplexFire. */
  function report() {
    if (draw.dirty) redrawMarkers();
    if (stepCount % DRAW_EVERY === 0) redrawCloud();
    if (typeof window !== 'undefined' && window.duplexFire && !window.duplexFire.gas) window.duplexFire.gas = api;
  }

  function reset() {
    X.fill(0);
    for (const o of outlets) { o.node.outlet = null; o.node.o.hrr = 0; }
    for (const c of flameCells) inFlame[c] = 0;
    flameCells.length = 0;
    outlets.clear();
    for (const p of parts) { p.tp = 0; p.stage = 0; p.outlet = null; }
    for (const u of Object.values(units)) u.open = true;
    for (const key of Object.keys(books)) books[key] = 0;
    delete books.lowestBurned; delete books.highestBurned;
    listed.fill(0);
    activeCount = 0; stepCount = 0; burst = null; lastTotal = 0; lastFluid = fire.fluid;
    dirty = true; draw.dirty = true;
    redrawCloud();
  }

  // --- console -------------------------------------------------------------------------
  const pipeOf = (id) => {
    const o = typeof id === 'string' ? objects.byId.get(id) : id;
    const n = byObject.get(o);
    if (!n) throw new Error(`[gas] ${id} is not a gas pipe; duplexFire.gas.pipes() lists them`);
    return n;
  };
  const flowOf = (x) => ({ id: x.id, unit: x.unit.name, kind: x.kind, lit: x.lit, m3PerHour: +(x.q * 3600).toFixed(2), kW: +(x.q * P.lhv / 1000).toFixed(0) });

  const api = {
    /** Cut a gas pipe through: gas comes out of the full bore. */
    cut(id) {
      const n = pipeOf(id);
      const x = open(n, 'cut', 1);
      world.events.emit({ type: '燃气管剪断', objectId: n.o.id, pos: centre(n.o), data: flowOf(x) });
      return flowOf(x);
    },
    /** Open a leak: share = the part of the bore that is open (a loose joint is a few percent). */
    leak(id, share = 0.05) {
      const n = pipeOf(id);
      const x = open(n, 'leak', share);
      world.events.emit({ type: '燃气泄漏', objectId: n.o.id, pos: centre(n.o), data: { ...flowOf(x), share } });
      return flowOf(x);
    },
    /** valve(false) shuts both units' gas; valve('A', false) one; valve('A') toggles; valve() lists them. */
    valve(unit, open) {
      if (unit == null) return Object.fromEntries(Object.values(units).map((u) => [u.name, u.open]));
      const list = typeof unit === 'boolean' ? Object.values(units) : [units[unit]];
      if (typeof unit === 'boolean') open = unit;
      if (!list[0]) throw new Error(`[gas] no unit ${unit}; there are ${Object.keys(units).join(', ')}`);
      for (const u of list) {
        u.open = open ?? !u.open;
        world.events.emit({ type: u.open ? '开阀' : '关阀', pos: u.meterPos, data: { unit: u.name, what: 'gas' } });
      }
      solveFlows();
      draw.dirty = true;
      return Object.fromEntries(Object.values(units).map((u) => [u.name, u.open]));
    },
    /** For testing only: make a unit's boiler valve fail now (stage 1 leaks, 2 is burnt through). */
    fail(unit, stage = 2) {
      const p = units[unit]?.part;
      if (!p) throw new Error(`[gas] no boiler valve for unit ${unit}`);
      if (stage > p.stage) { if (stage === 2 && p.stage === 0) fail(p, 1); fail(p, stage); }
      return flowOf(p.outlet);
    },
    /** Every open outlet with its flow; each unit's valve and flow. */
    status() {
      if (dirty) solveFlows();
      return {
        units: Object.values(units).map((u) => ({ unit: u.name, open: u.open, m3PerHour: +(u.flow * 3600).toFixed(2), PaAfterMeter: +u.pm.toFixed(0) })),
        outlets: [...outlets].map(flowOf),
      };
    },
    /** Where every m³ of gas went. unaccounted should be ~0. */
    books() {
      const inAir = fieldTotal();
      // leaks.js (task F) carries gas out of the house through gaps and books it there.
      const leakedOutside = world.leaks?.books?.().scalarsOut?.gas ?? 0;
      const accounted = inAir + books.burnedDeflagration + books.burnedAtOutlets + books.lostToSolid + books.offGrid + leakedOutside;
      return { ...books, inAir, leakedOutside, unaccounted: books.released - accounted };
    },
    /** The boiler valves' temperatures and stages. */
    parts() {
      return parts.map((p) => ({ unit: p.unit.name, id: p.node.o.id, room: p.node.o.room, c: +(p.tp + T_AMBIENT - 273).toFixed(1), stage: ['intact', 'leaking', 'burnt through'][p.stage] }));
    },
    /** The gas pipes, entry first in each unit; inGrid false = in the crawl space, off the grid. */
    pipes() {
      return nodes.map((n) => ({ id: n.o.id, unit: n.unit, fitting: n.fitting, inGrid: n.o.cells.length > 0, wall: n.o.wallAir, room: n.o.room ?? n.o.element.beside ?? null,
        entry: n === units[n.unit].entry, boilerValve: n === units[n.unit].end, open: !!n.outlet }))
        .sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : byObject.get(objects.byId.get(a.id)).path - byObject.get(objects.byId.get(b.id)).path));
    },
    /** Highest gas fraction in the air, and how much air is between the limits (m³). */
    peak() {
      let peak = 0, burnable = 0;
      for (let s = 0; s < activeCount; s++) { const x = X[active[s]]; if (x > peak) peak = x; if (flammable(x)) burnable++; }
      return { peakPercent: +(peak * 100).toFixed(2), burnableM3: +(burnable * V).toFixed(2) };
    },
    show(on = !draw.show) { draw.show = on; if (draw.points) { draw.points.visible = on; if (on) redrawCloud(); } return on; },
    field: X,
    units,
    nodes,
    params: P,
  };
  world.gas = api;
  // main.js sets up window.duplexFire after the modules load; hang the console handle on it then.
  if (typeof window !== 'undefined') {
    const hang = (tries) => { if (window.duplexFire) window.duplexFire.gas ??= api; else if (tries > 0) setTimeout(() => hang(tries - 1), 250); };
    hang(240);
  }

  return { act, source, react, report, reset };
}
