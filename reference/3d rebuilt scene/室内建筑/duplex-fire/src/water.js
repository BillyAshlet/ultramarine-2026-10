// Water (task E of 开工顺序.md): supply pipes that open in the heat, sprinklers
// added by hand, and the spray falling, evaporating and landing on things.
//
// Every number is in materials.json (water_supply, water_spray, water_pipe,
// sprinkler) with its source or marked 假设; this file only reads them.
//
// The pipes. Both units' cold water comes in through the west wall, about
// 0.46 m under the ground floor, one pipe each (e421 Unit B, e455 Unit A).
// The model has no meter and no main valve, so each unit gets one at that
// pipe (假设 where it stands). Behind it is the town's mains: always there,
// at a fixed pressure; the only thing you can do to it is shut the valve.
// The pipe network of each unit comes from the IFC's MEP file, which has no
// record of which pipe joins which; two pieces count as joined when their
// boxes come within 2 cm. Each unit's cold and its hot water come out as one
// connected piece each. The hot water's own source (a heater) is not in the
// model; it is taken to be fed from the cold at the same pressure (假设), and
// joins it where their boxes touch.
//
// How much comes out. Every open outlet (a broken pipe or a sprinkler) is fed
// along the cheapest path from the unit's entry. The pressure lost is
//   P_mains = R_service Q_total^2 + rho g dy + R_path q^2 + R_outlet q^2
// with R in Pa/(m^3/s)^2: friction f L / D for each straight piece, K for each
// fitting, the meter, and the outlet itself (an orifice for a break, the
// K-factor for a sprinkler). Outlets share the service line and meter, so
// opening a second one lowers the first; behind the meter they are taken to be
// independent (假设: they rarely share more than the riser here).
//
// What the water does. The spray is a field (kg of water per m^3 of air),
// registered with fire.addScalar('water'), so the solver carries it with the
// air and keeps its total. Drops also fall through the air at their own
// speed, which is done here: each step a share of each cell's water moves one
// cell down, lands on the floor if the cell below is solid, or on a piece of
// furniture if the cell is at its top. In gas over 100 C drops evaporate at
// the rate convection brings them heat (Ranz-Marshall), and each kg takes
// about 2.6 MJ out of that cell's air: from 15 C to 100 C and then boiling.
// Water has no temperature of its own here; the whole 2.6 MJ is taken when
// it evaporates (so drops that land without boiling cool nothing: 假设).
//
// What reaches furniture is written to the object table: o.wet (kg, all of
// it so far) and o.wetRate (kg per m^2 of top per second, i.e. mm/s, eased
// over a second). Combustion (task B) reads them; this file never changes a
// fire's heat release. Evans 1993 (NISTIR 5254) gives the decay that goes with
// a spray density: tau = 3.0 * (mm/s)^-1.85 seconds.
import * as THREE from 'three';

const RHO_WATER = 1000;     // kg/m3
const RHO_AIR_CP = 1.2 * 1005;  // J/(m3 K): as house.js counts heat in the air
const G = 9.81;
const T_AMBIENT = 293;      // K: the solver's zero (mac3d.js T0)
const BOIL = 373 - T_AMBIENT;   // 100 C, in the solver's kelvin above ambient
const TOUCH = 0.02;         // m: two pipe boxes this close are joined
const GPM_PSI = 6.30902e-5 / Math.sqrt(6894.76);  // gpm/psi^0.5 -> m3/s/Pa^0.5

const v = (m, key) => {
  const f = m?.[key];
  if (!f || typeof f !== 'object' || typeof f.value !== 'number') throw new Error(`[water] materials.json is missing ${key}`);
  return f.value;
};

export default function water(world) {
  const { fire, grid, objects } = world;
  const mat = world.materials;
  const supply = mat.water_supply, spray = mat.water_spray, pipeM = mat.water_pipe, headM = mat.sprinkler;
  const P = {
    mains: v(supply, 'mainsPressure'),
    serviceLength: v(supply, 'serviceLength'),
    serviceDiameter: v(supply, 'serviceDiameter'),
    meterLoss: v(supply, 'meterLoss'),
    meterFlow: v(supply, 'meterFlow'),
    friction: v(supply, 'frictionFactor'),
    fittingK: v(supply, 'fittingLoss'),
    innerRatio: v(supply, 'innerToOuter'),
    drop: v(spray, 'dropDiameter'),
    fall: v(spray, 'fallSpeed'),
    heat: v(spray, 'evaporationHeat'),
    failC: v(pipeM, 'jointFailTemp'),
    lagOpen: v(pipeM, 'jointLag'),
    lagWall: v(pipeM, 'jointLagInWall'),
    jointOpen: v(pipeM, 'jointOpening'),
    cd: v(pipeM, 'dischargeCoefficient'),
    headC: v(headM, 'activationTemp'),
    rti: v(headM, 'rti'),
    kHead: v(headM, 'kFactor') * GPM_PSI,
    coverage: v(headM, 'coverage'),
    branchD: v(headM, 'branchDiameter'),
  };

  const water = fire.addScalar('water');
  const { cell, origin, index } = grid;
  const V = cell ** 3;
  const { sy, sz, W, H } = fire;

  // --- the network ---------------------------------------------------------------
  const area = (d) => Math.PI * d * d / 4;
  const rPipe = (len, d) => P.friction * len / d * RHO_WATER / (2 * area(d) ** 2);
  const rFitting = (d) => P.fittingK * RHO_WATER / (2 * area(d) ** 2);
  const centre = (o) => [0, 1, 2].map((a) => (o.min[a] + o.max[a]) / 2);
  const touch = (a, b) => [0, 1, 2].every((k) => a.min[k] - TOUCH <= b.max[k] && b.min[k] - TOUCH <= a.max[k]);

  const units = {};
  const nodes = [];
  for (const o of objects.list) {
    if (o.class !== '水管') continue;
    const m = /^Unit (A|B) Domestic (Cold|Hot) Water$/.exec(o.element.system ?? '');
    if (!m) continue;   // the four backflow preventers belong to the heating
    const dims = [...o.size].sort((a, b) => b - a);
    const node = {
      o, unit: m[1], hot: m[2] === 'Hot', fitting: o.type !== 'IfcFlowSegment',
      length: dims[0], d: Math.min(0.05, Math.max(0.01, dims[1])) * P.innerRatio,
      y: centre(o)[1], next: [], r: 0, path: Infinity, tj: 0, broken: null,
    };
    nodes.push(node);
    (units[m[1]] ??= { name: m[1], nodes: [], open: true, entry: null, pm: 0 }).nodes.push(node);
  }
  for (const u of Object.values(units)) {
    const list = u.nodes;
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      if (touch(list[a].o, list[b].o)) { list[a].next.push(list[b]); list[b].next.push(list[a]); }
    }
    // A fitting is as wide as the narrowest pipe it joins.
    for (const n of list) {
      if (!n.fitting) { n.r = rPipe(n.length, n.d); continue; }
      const ds = n.next.filter((m) => !m.fitting).map((m) => m.d);
      if (ds.length) n.d = Math.min(...ds);
      n.r = rFitting(n.d);
    }
    // The entry: the cold pipe that reaches outside the west wall.
    u.entry = list.filter((n) => !n.hot).sort((a, b) => a.o.min[0] - b.o.min[0])[0];
    u.y = u.entry.y;
    // Cheapest path from the entry to every piece (Dijkstra; a few hundred nodes).
    const paths = () => {
      const todo = new Set(list);
      while (todo.size) {
        let best = null;
        for (const n of todo) if (!best || n.path < best.path) best = n;
        todo.delete(best);
        if (best.path === Infinity) break;
        for (const m of best.next) if (best.path + m.r < m.path) m.path = best.path + m.r;
      }
    };
    u.entry.path = u.entry.r;
    paths();
    // Unit A's hot water touches none of its cold pipes (the heater that joins
    // them is not in the model). Join each piece left over at its point
    // nearest to one already fed, through a pipe as long as the gap (假设).
    u.joins = [];
    for (;;) {
      const left = list.filter((n) => n.path === Infinity);
      if (!left.length) break;
      let pair = null;
      for (const a of left) for (const b of list) {
        if (b.path === Infinity) continue;
        const gap = Math.hypot(...[0, 1, 2].map((k) => Math.max(a.o.min[k] - b.o.max[k], 0, b.o.min[k] - a.o.max[k])));
        if (!pair || gap < pair.gap) pair = { a, b, gap };
      }
      pair.a.path = pair.b.path + pair.a.r + rPipe(Math.max(pair.gap, cell), pair.a.d);
      u.joins.push({ from: pair.b.o.id, to: pair.a.o.id, gap: +pair.gap.toFixed(2) });
      paths();
    }
    const svcD = P.serviceDiameter;
    u.rService = rPipe(P.serviceLength, svcD) + P.meterLoss / P.meterFlow ** 2;
  }
  const byObject = new Map(nodes.map((n) => [n.o, n]));
  const failing = nodes.filter((n) => n.fitting && n.o.cells.length > 0);

  // --- outlets ---------------------------------------------------------------------
  const outlets = new Set();   // open breaks and sprinklers that have gone off
  let dirty = true;

  /** Share the mains among a unit's open outlets: bisection on the pressure just past the meter. */
  function solveFlows() {
    for (const u of Object.values(units)) {
      const mine = [...outlets].filter((x) => x.unit === u);
      for (const x of mine) x.q = 0;
      u.flow = 0;
      if (!u.open || mine.length === 0) { u.pm = u.open ? P.mains : 0; continue; }
      const out = (pm) => {
        let s = 0;
        for (const x of mine) s += Math.sqrt(Math.max(0, pm - RHO_WATER * G * (x.y - u.y)) / x.r);
        return s;
      };
      let lo = 0, hi = P.mains;
      for (let it = 0; it < 60; it++) {
        const pm = (lo + hi) / 2;
        if (Math.sqrt((P.mains - pm) / u.rService) > out(pm)) lo = pm; else hi = pm;
      }
      u.pm = (lo + hi) / 2;
      for (const x of mine) {
        x.q = Math.sqrt(Math.max(0, u.pm - RHO_WATER * G * (x.y - u.y)) / x.r);
        u.flow += x.q;
      }
    }
    dirty = false;
  }

  /** Open a pipe: share = the part of its bore that is open (1 when cut through). */
  function breakPipe(node, share, why) {
    if (node.broken) return node.broken;
    const open = area(node.d) * share;
    const x = {
      kind: 'break', id: node.o.id, unit: units[node.unit], node, why,
      r: node.path + RHO_WATER / (2 * (P.cd * open) ** 2),
      y: node.y, cells: node.o.cells, q: 0, since: world.time,
    };
    node.broken = x;
    node.o.state = '失效';
    outlets.add(x);
    dirty = true;
    world.events.emit({
      type: why === 'cut' ? '水管剪断' : '水管失效', objectId: node.o.id, pos: centre(node.o),
      data: { unit: node.unit, hot: node.hot, jointTempC: why === 'cut' ? undefined : +(node.tj + T_AMBIENT - 273).toFixed(0) },
    });
    draw.dirty = true;
    return x;
  }

  // --- sprinklers --------------------------------------------------------------------
  const heads = [];
  let headCount = 0;

  const cellOf = (x, y, z) => {
    const i = Math.floor((x - origin.x) / cell) + 1, j = Math.floor((y - origin.y) / cell) + 1, k = Math.floor((z - origin.z) / cell) + 1;
    if (i < 1 || j < 1 || k < 1 || i > grid.nx || j > grid.ny || k > grid.nz) return -1;
    return index(i, j, k);
  };
  const cellCentre = (c) => {
    const i = c % W, j = Math.floor(c / W) % H, k = Math.floor(c / (W * H));
    return [origin.x + (i - 0.5) * cell, origin.y + (j - 0.5) * cell, origin.z + (k - 0.5) * cell];
  };

  /**
   * Put a sprinkler head under the ceiling above (x, y, z), fed from the
   * nearest cold-water pipe. Returns its id.
   */
  function addSprinkler(x, y, z) {
    let c = cellOf(x, y, z);
    if (c < 0) throw new Error('[water] that point is outside the grid');
    while (grid.solid[c] && c - sy > 0) c -= sy;           // inside a slab: come down into the room
    if (grid.solid[c]) throw new Error('[water] no air there');
    while (!grid.solid[c + sy]) c += sy;                   // up to the last air cell under the ceiling
    const pos = cellCentre(c);
    // The nearest cold pipe that has a path from the entry.
    let feed = null, gap = Infinity;
    for (const n of nodes) {
      if (n.hot || n.path === Infinity) continue;
      const d = Math.hypot(...[0, 1, 2].map((a) => Math.max(n.o.min[a] - pos[a], 0, pos[a] - n.o.max[a])));
      if (d < gap) { gap = d; feed = n; }
    }
    // The square it covers, in its own layer, reached without crossing a wall.
    const half = P.coverage / 2;
    const reach = [c], seen = new Set([c]);
    for (let q = 0; q < reach.length; q++) {
      const a = reach[q];
      for (const [b, open] of [[a - 1, fire.openX[a]], [a + 1, fire.openX[a + 1]], [a - sz, fire.openZ[a]], [a + sz, fire.openZ[a + sz]]]) {
        if (!open || seen.has(b)) continue;
        const p = cellCentre(b);
        if (Math.abs(p[0] - pos[0]) > half || Math.abs(p[2] - pos[2]) > half) continue;
        seen.add(b); reach.push(b);
      }
    }
    const id = `s${++headCount}`;
    const o = {
      id, element: null, name: 'Sprinkler (added)', type: 'Sprinkler', layer: 'water', class: '喷淋头', material: 'sprinkler',
      label: headM.label, combustible: false, room: world.view?.roomAt?.(pos[0], pos[2], pos[1] > 3 ? 2 : 1)?.code ?? null,
      min: pos.map((p) => p - 0.05), max: pos.map((p) => p + 0.05), size: [0.1, 0.1, 0.1],
      cells: Int32Array.of(c), wallAir: false, area: 0, fuelMJ: null,
      state: '完好', flux: 0, dose: 0, hrr: 0, burnedMJ: 0, ignitedAt: null, wet: 0, wetRate: 0,
    };
    objects.list.push(o);
    objects.byId.set(id, o);
    const head = {
      kind: 'sprinkler', id, o, cell: c, pos, feed, gap, unit: units[feed.unit], spray: Int32Array.from(reach),
      r: feed.path + rPipe(gap, P.branchD) + 1 / P.kHead ** 2, y: pos[1], te: 0, on: false, q: 0,
    };
    heads.push(head);
    draw.dirty = true;
    return id;
  }

  function removeSprinkler(id) {
    const h = heads.find((x) => x.id === id);
    if (!h) return false;
    heads.splice(heads.indexOf(h), 1);
    outlets.delete(h);
    objects.list.splice(objects.list.indexOf(h.o), 1);
    objects.byId.delete(id);
    dirty = true; draw.dirty = true;
    return true;
  }

  // --- what reaches furniture -----------------------------------------------------
  // The air cells at the top of each piece of furniture: water falling out of
  // them lands on it.
  const catcher = new Int32Array(fire.size).fill(-1);
  const catchers = [];
  for (const o of objects.list) {
    o.wetRate = 0;
    if (o.layer !== 'furniture') continue;
    // The layer of cells its top is in, over its footprint (cell centres
    // inside it). Not cellsInBox on a thin slab: that takes cells whose
    // centres are inside the box, and a slab at the top holds none, which
    // once left each piece one cell and caught 3% of the spray on it.
    const jTop = Math.min(grid.ny, Math.floor((o.max[1] - origin.y) / cell) + 1);
    const n = catchers.length;
    let count = 0;
    const i0 = Math.max(1, Math.ceil((o.min[0] - origin.x) / cell + 0.5)), i1 = Math.min(grid.nx, Math.floor((o.max[0] - origin.x) / cell + 0.5));
    const k0 = Math.max(1, Math.ceil((o.min[2] - origin.z) / cell + 0.5)), k1 = Math.min(grid.nz, Math.floor((o.max[2] - origin.z) / cell + 0.5));
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const c = index(i, jTop, k);
      if (grid.solid[c] || catcher[c] >= 0) continue;
      catcher[c] = n; count++;
    }
    if (count === 0) {   // smaller than a cell: the cell over its middle
      const c = cellOf(...centre(o).map((p, a) => (a === 1 ? o.max[1] - 1e-3 : p)));
      if (c >= 0 && !grid.solid[c] && catcher[c] < 0) catcher[c] = n;
    }
    catchers.push({ o, top: Math.max(o.size[0] * o.size[2], 1e-3), step: 0 });
  }

  // --- the books ---------------------------------------------------------------------
  const books = { released: 0, evaporated: 0, heatTaken: 0, onFloor: 0, onFurniture: 0 };
  // Is any water in the air? By the books, so it costs nothing to ask.
  const airborne = () => books.released - books.evaporated - books.onFloor - books.onFurniture > 1e-9 || outlets.size > 0;
  const cost = { act: 0, source: 0, transfer: 0, react: 0, report: 0, steps: 0 };
  const timed = (phase, fn) => (w, dt) => {
    const t = performance.now();
    fn(w, dt);
    cost[phase] += performance.now() - t;
  };

  // --- drawing (page only) ------------------------------------------------------------
  const draw = { dirty: true, group: null, points: null, every: 3, show: true };
  const view = world.view;
  if (view?.scene) {
    const clip = view.cut ? [view.cut] : [];
    draw.group = new THREE.Group();
    draw.group.name = 'water';
    const MAX = 8000;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    geom.setDrawRange(0, 0);
    draw.points = new THREE.Points(geom, new THREE.PointsMaterial({
      color: 0x2f8cff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false, clippingPlanes: clip,
    }));
    draw.points.frustumCulled = false;
    draw.max = MAX;
    draw.markers = new THREE.Group();
    draw.group.add(draw.points, draw.markers);
    draw.headGeom = new THREE.CylinderGeometry(0.07, 0.07, 0.04, 16);
    draw.breakGeom = new THREE.SphereGeometry(0.09, 12, 8);
    draw.mat = {
      head: new THREE.MeshBasicMaterial({ color: 0xd23c3c, clippingPlanes: clip }),
      headOn: new THREE.MeshBasicMaterial({ color: 0x3ca0ff, clippingPlanes: clip }),
      break: new THREE.MeshBasicMaterial({ color: 0x3ca0ff, clippingPlanes: clip }),
    };
    view.scene.add(draw.group);
  }

  function redrawMarkers() {
    if (!draw.markers) return;
    draw.markers.clear();
    for (const h of heads) {
      const m = new THREE.Mesh(draw.headGeom, h.on ? draw.mat.headOn : draw.mat.head);
      // At the head cell's centre, not at the ceiling: a storey is shown cut
      // a little under its ceiling, which would hide it.
      m.position.set(...h.pos);
      draw.markers.add(m);
    }
    for (const x of outlets) {
      if (x.kind !== 'break') continue;
      const m = new THREE.Mesh(draw.breakGeom, draw.mat.break);
      m.position.set(...centre(x.node.o));
      draw.markers.add(m);
    }
    draw.dirty = false;
  }

  function redrawSpray() {
    if (!draw.points) return;
    draw.points.visible = draw.show;
    if (!draw.show) return;
    if (!airborne()) { draw.points.geometry.setDrawRange(0, 0); return; }
    const pos = draw.points.geometry.attributes.position.array;
    const { fluid, fi, fj, fk } = fire;
    let n = 0;
    for (let s = 0; s < fluid.length && n < draw.max; s++) {
      if (water[fluid[s]] < 2e-3) continue;   // kg/m3: about a tenth of what a sprinkler puts in the air
      pos[3 * n] = origin.x + (fi[s] - 0.5) * cell;
      pos[3 * n + 1] = origin.y + (fj[s] - 0.5) * cell;
      pos[3 * n + 2] = origin.z + (fk[s] - 0.5) * cell;
      n++;
    }
    draw.points.geometry.setDrawRange(0, n);
    draw.points.geometry.attributes.position.needsUpdate = true;
  }

  // --- each step ---------------------------------------------------------------------

  /** 1. Flows follow the valves and the outlets that are open. */
  function act() {
    cost.steps++;
    if (dirty) solveFlows();
  }

  /** 2. Every open outlet puts its water into the air around it. */
  function source(w, dt) {
    for (const x of outlets) {
      if (!x.q) continue;
      const cells = x.kind === 'break' ? x.cells : x.spray;
      if (!cells.length) continue;   // a pipe in the crawl space: outside the grid
      const kg = x.q * RHO_WATER * dt;
      const add = kg / (cells.length * V);
      for (const c of cells) if (!grid.solid[c]) water[c] += add;
      books.released += kg;
    }
  }

  /**
   * 4. Drops evaporate in hot gas and fall a share of a cell. Cells are visited
   * bottom to top within each column, so water that has just come down one
   * cell is not moved again this step.
   */
  function transfer(w, dt) {
    if (!airborne()) return;   // nothing has sprayed yet: skip the sweep over the house
    const { fluid } = fire;
    const temp = fire.temp, openY = fire.openY;
    const fallShare = Math.min(1, P.fall * dt / cell);
    const d = P.drop, L = P.heat;
    const pr3 = Math.cbrt(0.7);
    for (const k of catchers) k.step = 0;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      let wc = water[c];
      if (wc <= 0) continue;
      const t = temp[c];
      if (t > BOIL) {
        // Convection to a falling drop (Ranz-Marshall), air properties at the
        // film temperature from power-law fits to air tables.
        const tg = t + T_AMBIENT, tf = (tg + 373) / 2;
        const kAir = 0.0241 * (tf / 273) ** 0.81, nu = 1.33e-5 * (tf / 273) ** 1.75;
        const nusselt = 2 + 0.6 * Math.sqrt(P.fall * d / nu) * pr3;
        const rate = 6 * (nusselt * kAir / d) * (tg - 373) / (RHO_WATER * d * L);   // per second
        let kg = wc * V * (1 - Math.exp(-rate * dt));
        kg = Math.min(kg, RHO_AIR_CP * V * (t - BOIL) / L);   // the gas cannot be cooled past 100 C by boiling
        wc -= kg / V;
        temp[c] = t - kg * L / (RHO_AIR_CP * V);
        books.evaporated += kg;
        books.heatTaken += kg * L;
      }
      const down = wc * fallShare;
      water[c] = wc - down;
      const owner = catcher[c];
      if (owner >= 0) { const k = catchers[owner]; k.step += down * V; k.o.wet += down * V; books.onFurniture += down * V; }
      else if (openY[c]) water[c - sy] += down;
      else books.onFloor += down * V;
    }
    const ease = 1 - Math.exp(-dt / 1);
    for (const k of catchers) k.o.wetRate += (k.step / (k.top * dt) - k.o.wetRate) * ease;
  }

  /** 5. Joints heat up and may open; sprinkler bulbs heat up and may break. */
  function react(w, dt) {
    const temp = fire.temp;
    const fail = P.failC + 273 - T_AMBIENT;
    for (const n of failing) {
      if (n.broken) continue;
      let tg = 0;
      for (const c of n.o.cells) tg += temp[c];
      tg /= n.o.cells.length;
      n.tj += (tg - n.tj) * (1 - Math.exp(-dt / (n.o.wallAir ? P.lagWall : P.lagOpen)));
      if (n.tj >= fail) breakPipe(n, P.jointOpen, 'heat');
    }
    const fire_ = P.headC + 273 - T_AMBIENT;
    for (const h of heads) {
      if (h.on) continue;
      const c = h.cell;
      const u = Math.hypot(fire.u[c], fire.v[c], fire.w[c]) * cell;   // m/s
      h.te += (temp[c] - h.te) * (1 - Math.exp(-dt * Math.sqrt(u) / P.rti));
      if (h.te >= fire_) goOff(h, temp[c]);
    }
  }

  function goOff(h, gas) {
    h.on = true;
    h.o.state = '失效';   // a sprinkler's 'failure' is going off
    outlets.add(h);
    solveFlows();
    world.events.emit({
      type: '喷淋头动作', objectId: h.id, pos: h.pos,
      data: { gasC: +(gas + T_AMBIENT - 273).toFixed(0), litresPerMinute: +(h.q * 60000).toFixed(0) },
    });
    draw.dirty = true;
  }

  /** 6. Drawing, and the console handle once main.js has set up window.duplexFire. */
  function report() {
    if (draw.dirty) redrawMarkers();
    if (cost.steps % draw.every === 0) redrawSpray();
    if (typeof window !== 'undefined' && window.duplexFire && !window.duplexFire.water) window.duplexFire.water = api;
  }

  function reset() {
    for (const n of nodes) { n.tj = 0; n.broken = null; }
    for (const x of [...outlets]) if (x.kind === 'break') outlets.delete(x);
    for (const h of heads) { h.on = false; h.te = 0; h.q = 0; outlets.delete(h); h.o.state = '完好'; }
    for (const o of objects.list) { o.wetRate = 0; }
    for (const key of Object.keys(books)) books[key] = 0;
    for (const key of Object.keys(cost)) cost[key] = 0;
    dirty = true; draw.dirty = true;
  }

  // --- console -------------------------------------------------------------------------
  const pipeOf = (id) => {
    const o = typeof id === 'string' ? objects.byId.get(id) : id;
    const n = byObject.get(o);
    if (!n) throw new Error(`[water] ${id} is not a supply pipe of either unit`);
    return n;
  };
  const inField = () => { let s = 0; for (const c of fire.fluid) s += water[c]; return s * V; };

  const api = {
    /** Cut a supply pipe through: it sprays from the full bore. */
    cut(id) {
      const n = pipeOf(id);
      if (!n.o.cells.length) console.warn(`[water] ${n.o.id} is in the crawl space, outside the grid: it will flow, but nowhere you can see`);
      const x = breakPipe(n, 1, 'cut');
      if (dirty) solveFlows();
      return { id: x.id, unit: n.unit, litresPerMinute: +(x.q * 60000).toFixed(1) };
    },
    /** valve('A', false) shuts Unit A's main; valve('A') toggles; valve() lists both. */
    valve(unit, open) {
      if (unit == null) return Object.fromEntries(Object.values(units).map((u) => [u.name, u.open]));
      const u = units[unit];
      if (!u) throw new Error(`[water] no unit ${unit}; there are ${Object.keys(units).join(', ')}`);
      u.open = open ?? !u.open;
      solveFlows();
      world.events.emit({ type: u.open ? '开阀' : '关阀', pos: centre(u.entry.o), data: { unit, what: 'water' } });
      return u.open;
    },
    addSprinkler,
    removeSprinkler,
    clearSprinklers() { for (const h of [...heads]) removeSprinkler(h.id); },
    /** For testing only: set a head off now, whatever the gas around it. */
    trigger(id) { const h = heads.find((x) => x.id === id); if (h && !h.on) goOff(h, fire.temp[h.cell]); return !!h; },
    get sprinklers() { return heads.map((h) => ({ id: h.id, pos: h.pos.map((p) => +p.toFixed(2)), room: h.o.room, on: h.on, linkC: +(h.te + T_AMBIENT - 273).toFixed(1), fedFrom: h.feed.o.id, litresPerMinute: +(h.q * 60000).toFixed(1) })); },
    /** Every open outlet, with its flow. */
    status() {
      if (dirty) solveFlows();
      return {
        units: Object.values(units).map((u) => ({ unit: u.name, open: u.open, kPaAfterMeter: +(u.pm / 1000).toFixed(0), litresPerMinute: +((u.flow ?? 0) * 60000).toFixed(1) })),
        outlets: [...outlets].map((x) => ({ kind: x.kind, id: x.id, unit: x.unit.name, litresPerMinute: +(x.q * 60000).toFixed(1) })),
      };
    },
    /** Where every kg went, and the heat evaporation took (J). */
    books() {
      const field = inField();
      const accounted = field + books.evaporated + books.onFloor + books.onFurniture;
      return { ...books, inAir: field, unaccounted: books.released - accounted };
    },
    /** Supply pipes near a point, nearest first. */
    pipesNear(x, y, z, count = 5) {
      return nodes.map((n) => ({ id: n.o.id, unit: n.unit, hot: n.hot, fitting: n.fitting, wall: n.o.wallAir, inGrid: n.o.cells.length > 0,
        d: Math.hypot(...[0, 1, 2].map((a) => Math.max(n.o.min[a] - [x, y, z][a], 0, [x, y, z][a] - n.o.max[a]))) }))
        .sort((a, b) => a.d - b.d).slice(0, count);
    },
    /** Joint temperatures, hottest first. */
    joints(count = 10) {
      return failing.map((n) => ({ id: n.o.id, unit: n.unit, c: +(n.tj + T_AMBIENT - 273).toFixed(1), broken: !!n.broken }))
        .sort((a, b) => b.c - a.c).slice(0, count);
    },
    show(on = !draw.show) { draw.show = on; if (draw.points) { draw.points.visible = on; if (on) redrawSpray(); } return on; },
    /** Milliseconds this module spends per step, by phase. */
    cost() {
      const s = Math.max(1, cost.steps);
      return Object.fromEntries(['act', 'source', 'transfer', 'react', 'report'].map((p) => [p, +(cost[p] / s).toFixed(3)]));
    },
    field: water,
    units,
    nodes,
    params: P,
  };
  world.water = api;

  return {
    act: timed('act', act),
    source: timed('source', source),
    transfer: timed('transfer', transfer),
    react: timed('react', react),
    report: timed('report', report),
    reset,
  };
}
