// Smoke leaking through small gaps (task F of 开工顺序.md): under and around
// shut doors, through back-to-back electrical outlets, around pipes through
// walls, and through the walls themselves; and the pressure that drives it.
//
// Why a pressure of our own. The solver (mac3d.js) is incompressible and the
// house in it is sealed: heated air cannot expand, so a shut room never pushes
// anything out. Real dwellings do: IFV 2020 measured 60–170 Pa in a shut fire
// room and 340–1010 Pa in an airtight one, and smoke came through a socket in
// the party wall 2.5–3 minutes after ignition. So each sealed body of air (a
// "zone": the air cells connected to each other, worked out again whenever a
// door opens or shuts) gets one pressure, from how fast its air is trying to
// grow and how much leakage it has to grow through.
//
// How fast a zone grows. Air heated at constant pressure takes up more room:
// for an ideal gas the volume made per joule is 1 / (rho cp T), the same at
// any temperature (CFAST, NIST TN 1889v1, eq. 2.5, with the pressure held
// steady). The solver counts heat in the air as rho cp V times its kelvin
// above ambient (house.js), so a zone grows at
//   Vdot = V_cell * d(sum of temp over its cells)/dt / T0.
// That is read from the field itself, after the solver, the walls and every
// other mechanism have had their say, and before this module moves anything:
// the fire's heat, less what the walls took, less what water evaporation took.
// A cooling zone shrinks and draws air in.
//
// How much leaks. Every leak is an effective leakage area at 4 Pa with flow
// exponent 0.65, the ASHRAE / NIST CONTAM convention its numbers come in:
//   q = ELA * sqrt(2 * 4 / rho) * (dP / 4)^0.65.
// Each step the pressures are found that make every zone's leaks (and its
// exhaust fan) carry away exactly its growth, the outdoors staying at 0.
// Quasi-steady: the air's own springiness (dP/dt in CFAST) is left out; at
// these leak sizes it settles within a fraction of a second (假设).
//
// What the leaks are, all from the grid and the IFC:
//  - wall: two air cells either side of a wall (one to six solid cells
//    across), 2 cm² per m² of wall (CONTAM). The party wall between the two
//    units ('party') leaks whatever makes it, with the outlets in it, 46% of
//    a unit's total (Bohac et al. 2020); 2 cm²/m² would have made it 66%.
//  - door: a shut door between two zones, 250 cm² (CONTAM: shut interior door
//    with frame and undercut). Outside doors are part of the envelope.
//  - outlet: two outlets back to back across a wall, 2.5 cm² each, in series.
//  - penetration: a service pipe or conduit from the IFC passing through a
//    wall or floor between two zones, 6 cm² (ASHRAE, uncaulked).
//  - envelope: each unit's leakage to outdoors, so that the unit as a whole
//    meets 3 ACH at 50 Pa (IECC), less what it leaks to the other unit; spread
//    over the cells along its outer walls and top ceiling.
//  - fan: a running rooftop exhaust fan draws from its duct's lower end
//    (sources.js says whether it runs).
// Sizes are in materials.json under leakage and exhaust_fan.
//
// What moves. A leak carrying q m³/s from side a to side b takes q dt of each
// cell's contents on side a (heat, soot, unburnt fuel, and anything registered
// with fire.addScalar, such as gas and water) and puts it in the paired cell
// on side b; so all totals are kept. Air coming in from outdoors brings
// nothing. What goes outdoors is booked in books(), so totals still add up.
// Leaks are spread over their cells evenly in height: there is no stack
// effect within a zone yet, so smoke does not prefer the top of a door gap
// (假设, a simplification).
//
// Budget: one pass over the air cells to sum heat per zone, then only the
// leak cells. Zones are found again only when the solver's cell list changes
// (doors.js calls updateTopology), not every step.

import * as THREE from 'three';

const T0 = 293;              // K: the solver's zero (mac3d.js)
const G = 9.81;
const RHO = 1.2;             // kg/m³, as house.js counts heat
const CP = 1005;             // J/(kg K)
const P_REF = 4;             // Pa: the leakage areas are quoted at this
const MAX_ACROSS = 6;        // cells: thickest wall a wall leak crosses (1.2 m)
const MAX_SHARE = 0.3;
const ENV_EVERY = 3;         // keep one envelope cell in three (cost)       // at most this share of a cell moves in one step (stability)
const P_LIMIT = 5e4;         // Pa: bracket for the pressure search
const SWEEPS = 4, NEWTON = 16;

export default function leaks(world) {
  const { fire, grid, objects } = world;
  const M = world.materials.leakage, FAN = world.materials.exhaust_fan, WM = world.materials.window;
  const val = (m, key) => {
    const f = m?.[key];
    if (!f || typeof f !== 'object' || typeof f.value !== 'number') throw new Error(`[leaks] materials.json is missing ${key}`);
    return f.value;
  };
  const N = val(M, 'flowExponent');
  const C = Math.sqrt((2 * P_REF) / RHO) / Math.pow(P_REF, N);   // q = C * ELA * dP^N
  const CM2 = 1e-4;
  const AREA = {
    outlet: (val(M, 'outlet') * CM2) / Math.SQRT2,   // two in series
    penetration: val(M, 'penetration') * CM2,
    door: val(M, 'doorClosed') * CM2,
    wallPerM2: val(M, 'interiorWall') * CM2,
  };
  const ACH50 = val(M, 'envelopeACH50');
  const PARTY_SHARE = val(M, 'partyShare');
  const SMOOTH = val(M, 'pressureSmoothing');
  const STUCK = val(M, 'doorStuckPressure');
  const VISIBLE = val(M, 'smokeVisible');
  const FAN_Q = val(FAN, 'flow'), FAN_SHUT = val(FAN, 'shutoffPressure');
  const WIN = {
    breakK: (WM?.breakTemp?.value ?? 260) + 273 - T0,
    breakPa: WM?.breakPressure?.value ?? 3000,
    lag: WM?.thermalLag?.value ?? 35,
    openFrac: WM?.openFraction?.value ?? 0.5,
    cd: WM?.dischargeCoefficient?.value ?? 0.68,
    alpha: WM?.absorptivity?.value ?? 0.78,
    h: WM?.surfaceH?.value ?? 18,
  };

  const { W, H, D, sy, sz, size, cell, solid } = fire;
  const Vc = cell ** 3;
  const FACE = cell * cell;
  const { origin } = grid;
  const ci = (c) => c % W, cj = (c) => Math.floor(c / sy) % H, ck = (c) => Math.floor(c / sz);
  const at = (c) => [origin.x + (ci(c) - 0.5) * cell, origin.y + (cj(c) - 0.5) * cell, origin.z + (ck(c) - 0.5) * cell];
  const border = (c) => { const i = ci(c), j = cj(c), k = ck(c); return i === 0 || j === 0 || k === 0 || i === W - 1 || j === H - 1 || k === D - 1; };
  const cellAt = (x, y, z) => {
    const i = Math.floor((x - origin.x) / cell) + 1, j = Math.floor((y - origin.y) / cell) + 1, k = Math.floor((z - origin.z) / cell) + 1;
    return i < 1 || j < 1 || k < 1 || i > W - 2 || j > H - 2 || k > D - 2 ? -1 : i + sy * j + sz * k;
  };
  const meta = world.view?.meta;

  // --- what never changes: rooms, units, and where the gaps are ----------------------

  // The room each air cell is in (index into world.rooms, 255 none) and its
  // unit (1 A, 2 B, 0 neither: the roof space, gaps in the stairs).
  const rooms = world.rooms;
  const roomOf = new Uint8Array(size).fill(255);
  const unitOf = new Uint8Array(size);
  for (const c of fire.fluid) {
    const [x, y, z] = at(c);
    const r = rooms.findIndex((rm) => x >= rm.min[0] && x <= rm.max[0] && z >= rm.min[2] && z <= rm.max[2] && y >= rm.min[1] - 0.25 && y <= rm.max[1] + 0.25);
    if (r < 0) continue;
    roomOf[c] = r;
    unitOf[c] = rooms[r].code[0] === 'A' ? 1 : rooms[r].code[0] === 'B' ? 2 : 0;
  }
  const UNIT = ['', 'A', 'B'];

  // Wall pairs: from each air cell, +x and +z, through one to six solid
  // cells to the next air cell. Envelope faces: any of ±x, ±z, +y that runs
  // through solid to the edge of the grid, or up into the roof space.
  // Envelope faces are thinned to one cell in ENV_EVERY, spread evenly
  // ((i + j + k) mod ENV_EVERY): the unit's leakage outdoors is the same, it
  // just leaves through fewer, larger holes, which costs a third as much.
  const wallA = [], wallB = [], envCells = [];
  const envKept = (c) => (ci(c) + cj(c) + ck(c)) % ENV_EVERY === 0;
  for (const c of fire.fluid) {
    for (const d of [1, -1, sz, -sz, sy]) {
      for (let s = 1; s <= MAX_ACROSS; s++) {
        const c2 = c + d * s;
        if (border(c2)) { if (s > 1 && envKept(c)) envCells.push(c); break; }
        if (solid[c2]) continue;
        if (s > 1) {
          if (d === sy && unitOf[c2] === 0 && envKept(c)) envCells.push(c);           // up into the roof space
          else if ((d === 1 || d === sz) && unitOf[c] && unitOf[c2]) { wallA.push(c); wallB.push(c2); }
        }
        break;
      }
    }
  }

  // Doors: the air on each side of a door's cells, across its thin direction.
  const doorLeaks = [];
  for (const door of grid.doors ?? []) {
    if (door.outside) continue;
    const e = door.element;
    const step = e.max[0] - e.min[0] < e.max[2] - e.min[2] ? 1 : sz;
    const mine = new Set(door.cells);
    const side = [new Set(), new Set()];
    for (const c of door.cells) {
      [step, -step].forEach((d, n) => {
        for (let s = 1; s <= 3; s++) {
          const c2 = c + d * s;
          if (mine.has(c2)) continue;
          if (!solid[c2]) side[n].add(c2);
          break;
        }
      });
    }
    if (side[0].size && side[1].size) doorLeaks.push({ door, a: [...side[0]], b: [...side[1]] });
  }

  // Outlets back to back: two outlets (receptacles, switches, phone jacks)
  // facing opposite ways through one wall, level and in line.
  const outletObjects = objects.list.filter((o) => o.layer === 'electrical' && /Receptacle|Lighting Switches|Telephone Outlet/.test(o.name));
  const centre = (o) => [0, 1, 2].map((a) => (o.min[a] + o.max[a]) / 2);
  const thinAxis = (o) => (o.size[0] < o.size[2] ? 0 : 2);
  const outletPairs = [];
  for (let p = 0; p < outletObjects.length; p++) for (let q = p + 1; q < outletObjects.length; q++) {
    const o1 = outletObjects[p], o2 = outletObjects[q];
    const t = thinAxis(o1);
    if (thinAxis(o2) !== t) continue;
    const c1 = centre(o1), c2 = centre(o2), along = 2 - t;
    const across = Math.abs(c1[t] - c2[t]);
    if (across < 0.08 || across > 0.9 || Math.abs(c1[along] - c2[along]) > 0.3 || Math.abs(c1[1] - c2[1]) > 0.25) continue;
    // Each side's air: the cell next to the outlet, on its own side of the wall.
    const mid = (c1[t] + c2[t]) / 2;
    const near = (o, c0) => {
      let best = -1, bd = Infinity;
      const own = Math.sign(c0[t] - mid);
      for (const c of o.cells) {
        const x = at(c);
        if (Math.sign(x[t] - mid) !== own || solid[c]) continue;
        const dd = Math.hypot(x[0] - c0[0], x[1] - c0[1], x[2] - c0[2]);
        if (dd < bd) { bd = dd; best = c; }
      }
      return best;
    };
    const a = near(o1, c1), b = near(o2, c2);
    if (a >= 0 && b >= 0 && a !== b) outletPairs.push({ o: [o1, o2], a, b });
  }

  // Pipes and conduits through a wall or floor: walk each straight run's
  // centre line; air, one to five solid cells, air again is a hole.
  const penPairs = new Map();
  const runs = (meta?.elements ?? objects.list.map((o) => o.element))
    .filter((e) => e.type === 'IfcFlowSegment' && ['water', 'gas', 'heating', 'electrical'].includes(e.layer));
  for (const e of runs) {
    const sizeE = [0, 1, 2].map((a) => e.max[a] - e.min[a]);
    const axis = sizeE.indexOf(Math.max(...sizeE));
    const others = sizeE.filter((_, a) => a !== axis);
    if (sizeE[axis] < 2 * Math.max(...others) || sizeE[axis] < cell) continue;
    const mid = [0, 1, 2].map((a) => (e.min[a] + e.max[a]) / 2);
    let lastAir = -1, solidRun = 0;
    for (let s = e.min[axis]; s <= e.max[axis]; s += cell / 2) {
      const p = [...mid]; p[axis] = s;
      const c = cellAt(...p);
      if (c < 0) { lastAir = -1; continue; }
      if (solid[c]) { solidRun++; continue; }
      if (lastAir >= 0 && lastAir !== c && solidRun > 0 && solidRun <= 10) {
        const key = Math.min(lastAir, c) + ':' + Math.max(lastAir, c);
        if (!penPairs.has(key)) penPairs.set(key, { a: lastAir, b: c, id: e });
      }
      lastAir = c; solidRun = 0;
    }
  }

  // Exhaust fans: draw from the lower end of their duct (same system name).
  const fans = objects.list.filter((o) => /Rooftop/.test(o.name) && /Fan/.test(o.name)).map((o) => {
    const sys = o.element.system;
    const duct = (meta?.elements ?? []).filter((e) => e.system === sys && e.kind === 'exhaust').sort((x, y) => x.min[1] - y.min[1])[0];
    let intake = [];
    if (duct) {
      const pad = cell * 1.5;
      intake = grid.cellsInBox({
        min: { x: duct.min[0] - pad, y: duct.min[1] - pad, z: duct.min[2] - pad },
        max: { x: duct.max[0] + pad, y: duct.min[1] + pad, z: duct.max[2] + pad },
      }).filter((c) => !solid[c]);
    }
    return { o, duct, intake: Int32Array.from(intake) };
  });

  // Exterior windows (Pagni & Joshi 1991 / Babrauskas 1998 thermal breakage; Kiwa 2021 pressure breakage).
  const winDrawGroup = world.view?.scene ? new THREE.Group() : null;
  if (winDrawGroup) {
    winDrawGroup.name = 'broken-windows';
    world.view.scene.add(winDrawGroup);
  }
  const winLineMat = winDrawGroup ? new THREE.LineBasicMaterial({
    color: 0xffa43b, transparent: true, opacity: 0.92, depthTest: false,
    clippingPlanes: world.view.cut ? [world.view.cut] : [],
  }) : null;
  const winPaneMat = winDrawGroup ? new THREE.MeshBasicMaterial({
    color: 0xff8c2a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    clippingPlanes: world.view.cut ? [world.view.cut] : [],
  }) : null;

  const windows = objects.list.filter((o) => o.class === '窗' && o.cells.length > 0).map((o) => {
    const spanX = o.max[0] - o.min[0], spanY = o.max[1] - o.min[1], spanZ = o.max[2] - o.min[2];
    const width = Math.max(spanX, spanZ);
    const paneArea = width * spanY;
    const yMid = o.min[1] + spanY * 0.5;
    const yTopThird = o.min[1] + spanY * 0.65;
    const airCells = [...o.cells].filter((c) => !solid[c]);
    const upper = airCells.filter((c) => at(c)[1] >= yMid);
    const hotSample = airCells.filter((c) => at(c)[1] >= yTopThird);
    let marker = null;
    if (winDrawGroup) {
      marker = new THREE.Group();
      const thinX = spanX < spanZ;
      const cx = (o.min[0] + o.max[0]) / 2, cy = (o.min[1] + o.max[1]) / 2, cz = (o.min[2] + o.max[2]) / 2;
      const x0 = thinX ? cx : o.min[0] + 0.04, x1 = thinX ? cx : o.max[0] - 0.04;
      const z0 = thinX ? o.min[2] + 0.04 : cz, z1 = thinX ? o.max[2] - 0.04 : cz;
      const y0 = o.min[1] + 0.04, y1 = o.max[1] - 0.04;
      const xm = (x0 + x1) * 0.5 + (thinX ? 0 : 0.06), zm = (z0 + z1) * 0.5 + (thinX ? 0.06 : 0), ym = cy - 0.08;
      const pts = new Float32Array([
        x0, y0, z0, x1, y0, z1,  x1, y0, z1, x1, y1, z1,  x1, y1, z1, x0, y1, z0,  x0, y1, z0, x0, y0, z0,
        x0, y0, z0, xm, ym, zm,  x1, y0, z1, xm, ym, zm,  x1, y1, z1, xm, ym, zm,  x0, y1, z0, xm, ym, zm,
      ]);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const lines = new THREE.LineSegments(lg, winLineMat);
      lines.renderOrder = 8;
      const pg = new THREE.PlaneGeometry(width - 0.08, Math.max(0.1, spanY - 0.08));
      const pane = new THREE.Mesh(pg, winPaneMat);
      pane.position.set(cx, cy, cz);
      if (thinX) pane.rotation.y = Math.PI / 2;
      pane.renderOrder = 7;
      marker.add(pane, lines);
      marker.visible = false;
      winDrawGroup.add(marker);
    }
    return {
      o, width, height: spanY, paneArea,
      openArea: paneArea * WIN.openFrac,
      ela: paneArea * WIN.openFrac * WIN.cd,
      cells: Int32Array.from(airCells),
      upper: Int32Array.from(upper.length ? upper : airCells),
      hotSample: Int32Array.from(hotSample.length ? hotSample : airCells),
      tg: 0, brokenBy: null, marker,
    };
  });
  let brokenWinMask = '';
  const currentWinMask = () => windows.map((w) => (w.o.state === '失效' ? '1' : '0')).join('');
  const syncWindowMarkers = () => {
    for (const w of windows) if (w.marker) w.marker.visible = w.o.state === '失效';
  };

  // A unit's leakage outdoors: its total (3 ACH50 over its volume) less what
  // goes to the other unit through the party wall and back-to-back outlets.
  const unitVolume = [0, 0, 0];
  for (const c of fire.fluid) unitVolume[unitOf[c]] += Vc;
  const toELA = (q50) => q50 / (C * Math.pow(50, N));
  const unitTotal = [0, 1, 2].map((u) => toELA((ACH50 * unitVolume[u]) / 3600));
  // The party wall: CONTAM's 2 cm²/m² for an interior wall would send two
  // thirds of a unit's leakage next door; Bohac et al. 2020 measured about
  // 46% in separate-entry units. So the party wall's own leakage is whatever,
  // with the back-to-back outlets, makes that share.
  let partyFaces = 0, partyOutlets = 0;
  for (let p = 0; p < wallA.length; p++) if (unitOf[wallA[p]] !== unitOf[wallB[p]]) partyFaces++;
  for (const op of outletPairs) if (unitOf[op.a] && unitOf[op.b] && unitOf[op.a] !== unitOf[op.b]) partyOutlets += AREA.outlet;
  const partyTarget = PARTY_SHARE * (unitTotal[1] + unitTotal[2]) / 2;
  AREA.partyPerFace = Math.max(0, partyTarget - partyOutlets) / Math.max(1, partyFaces);
  const partyELA = [0, partyTarget, partyTarget];
  const envFaces = [0, 0, 0];
  for (const c of envCells) envFaces[unitOf[c]]++;
  const envELA = [0, 1, 2].map((u) => {
    const out = unitTotal[u] - partyELA[u];
    if (u && out < 0.3 * unitTotal[u]) console.warn(`[leaks] unit ${UNIT[u]}: party-wall leakage is ${(100 * partyELA[u] / unitTotal[u]).toFixed(0)}% of its total; outdoors kept at 30%`);
    return Math.max(out, 0.3 * unitTotal[u]);
  });

  // --- what changes with the doors: zones and the leaks between them ---------------

  const zoneOf = new Int32Array(size).fill(-1);
  let zones = [], groups = [], adj = [], fluidRef = null;
  let S = new Float64Array(0), Sprev = new Float64Array(0), vexp = new Float64Array(0), P = new Float64Array(0);
  let primed = false;
  const stack = new Int32Array(size);

  function rebuild() {
    zoneOf.fill(-1);
    zones = [];
    for (const c0 of fire.fluid) {
      if (zoneOf[c0] >= 0) continue;
      const id = zones.length;
      const z = { id, cells: 0, units: [0, 0, 0], rooms: new Map() };
      let top = 0;
      stack[top++] = c0; zoneOf[c0] = id;
      while (top) {
        const c = stack[--top];
        z.cells++;
        z.units[unitOf[c]]++;
        if (roomOf[c] !== 255) z.rooms.set(roomOf[c], (z.rooms.get(roomOf[c]) ?? 0) + 1);
        for (const d of [1, -1, sy, -sy, sz, -sz]) {
          const n = c + d;
          if (!solid[n] && zoneOf[n] < 0) { zoneOf[n] = id; stack[top++] = n; }
        }
      }
      z.unit = z.units[1] >= z.units[2] ? (z.units[1] ? 1 : 0) : 2;
      z.void = z.unit === 0;   // the roof space and sealed scraps outside any room: as good as outdoors
      z.volume = z.cells * Vc;
      z.label = [...z.rooms].sort((p, q) => q[1] - p[1]).slice(0, 3).map(([r]) => rooms[r].code).join(' ') || '—';
      zones.push(z);
    }
    // Closets have no door in the IFC, so each is a sealed pocket named after its room.
    for (const z of zones) if (z.volume < 6 && zones.some((x) => x !== z && x.label === z.label)) z.label += ' closet';

    const shared = new Map();
    groups = [];
    const group = (kind, za, zb, extra = {}) => {
      const g = { kind, za, zb, ela: 0, a: [], b: [], q: 0, ...extra };
      groups.push(g);
      return g;
    };
    const pooled = (kind, za, zb) => {
      if (zb >= 0 && zb < za) [za, zb] = [zb, za];
      const key = `${kind}:${za}:${zb}`;
      return shared.get(key) ?? shared.set(key, group(kind, za, zb)).get(key);
    };
    const real = (z) => z >= 0 && !zones[z].void;

    for (let p = 0; p < wallA.length; p++) {
      const a = wallA[p], b = wallB[p];
      if (solid[a] || solid[b]) continue;
      const za = zoneOf[a], zb = zoneOf[b];
      if (za === zb || !real(za) || !real(zb)) continue;
      const party = unitOf[a] !== unitOf[b];
      const g = pooled(party ? 'party' : 'wall', za, zb);
      const flip = g.za !== za;
      g.a.push(flip ? b : a); g.b.push(flip ? a : b);
      g.ela += party ? AREA.partyPerFace : AREA.wallPerM2 * FACE;
    }
    for (const c of envCells) {
      if (solid[c]) continue;
      const z = zoneOf[c], u = unitOf[c];
      if (!real(z) || !u) continue;
      const g = pooled('envelope', z, -1);
      g.a.push(c); g.b.push(-1);
      g.ela += envELA[u] / envFaces[u];
    }
    for (const dl of doorLeaks) {
      const a = dl.a.filter((c) => !solid[c]), b = dl.b.filter((c) => !solid[c]);
      if (!a.length || !b.length) continue;
      const za = zoneOf[a[0]], zb = zoneOf[b[0]];
      if (za === zb || !real(za) || !real(zb)) continue;
      const g = group('door', za, zb, { door: dl.door, label: dl.door.element.room ?? dl.door.element.beside });
      g.ela = AREA.door;
      const n = Math.max(a.length, b.length);
      for (let i = 0; i < n; i++) { g.a.push(a[i % a.length]); g.b.push(b[i % b.length]); }
    }
    for (const op of outletPairs) {
      const za = zoneOf[op.a], zb = zoneOf[op.b];
      if (za === zb || !real(za) || !real(zb)) continue;
      const g = group('outlet', za, zb, { outlets: op.o, label: op.o.map((o) => o.id).join('↔') });
      g.ela = AREA.outlet;
      g.a.push(op.a); g.b.push(op.b);
    }
    for (const pp of penPairs.values()) {
      if (solid[pp.a] || solid[pp.b]) continue;
      const za = zoneOf[pp.a], zb = zoneOf[pp.b];
      if (za === zb || !real(za) || !real(zb)) continue;
      const g = pooled('penetration', za, zb);
      const flip = g.za !== za;
      g.a.push(flip ? pp.b : pp.a); g.b.push(flip ? pp.a : pp.b);
      g.ela += AREA.penetration;
    }
    for (const f of fans) {
      const intake = [...f.intake].filter((c) => !solid[c]);
      if (!intake.length) continue;
      const g = group('fan', zoneOf[intake[0]], -1, { fan: f.o, label: f.o.id });
      g.a = intake; g.b = intake.map(() => -1);
    }
    for (const w of windows) {
      if (w.o.state !== '失效' || !w.cells.length) continue;
      const z0 = zoneOf[w.cells[0]];
      if (!real(z0)) continue;
      const g = group('window', z0, -1, { window: w, label: `${w.o.id} ${w.o.room ?? ''}`.trim() });
      g.ela = w.ela;
      g.a = [...w.cells];
      g.b = g.a.map(() => -1);
    }
    for (const g of groups) {
      g.a = Int32Array.from(g.a); g.b = Int32Array.from(g.b);
      g.K = C * g.ela;
      g.crossUnit = g.zb >= 0 && zones[g.za].unit !== zones[g.zb].unit;
    }

    adj = zones.map(() => []);
    for (const g of groups) { adj[g.za].push(g); if (g.zb >= 0) adj[g.zb].push(g); }
    const Z = zones.length;
    const oldP = P;
    S = new Float64Array(Z); Sprev = new Float64Array(Z); vexp = new Float64Array(Z); P = new Float64Array(Z);
    // Keep the pressures roughly where they were, as a starting guess.
    if (oldP.length) for (let z = 0; z < Z; z++) P[z] = 0;
    primed = false;
    fluidRef = fire.fluid;
    brokenWinMask = currentWinMask();
    syncWindowMarkers();
  }

  // --- each step ---------------------------------------------------------------------

  const pw = (d) => (d >= 0 ? Math.pow(d, N) : -Math.pow(-d, N));
  const fanFlow = (g, pz) => (g.fan.running ? Math.max(0, FAN_Q * (1 + pz / FAN_SHUT)) : 0);

  /** Volume flow out of zone z through group g if z is at pressure pz (m³/s), and its slope (m³/s per Pa). */
  let slope = 0;
  function outflow(g, z, pz) {
    if (g.kind === 'fan') {
      const q = fanFlow(g, pz);
      slope = q > 0 ? FAN_Q / FAN_SHUT : 0;
      return q;
    }
    const other = g.za === z ? g.zb : g.za;
    const d = pz - (other < 0 ? 0 : P[other]);
    const a = Math.max(Math.abs(d), 0.01);   // the slope is infinite at 0
    const q = g.K * Math.pow(a, N);
    slope = (N * q) / a;
    return d >= 0 ? q : -q;
  }

  // Each zone in turn, the others held (Gauss-Seidel), a few sweeps. Within a
  // zone: Newton's step from last step's pressure, kept inside a shrinking
  // bracket (bisection when Newton would leave it). Outflow only grows with
  // pressure, so there is one answer.
  function solve() {
    for (let sweep = 0; sweep < SWEEPS; sweep++) {
      for (let z = 0; z < zones.length; z++) {
        const list = adj[z];
        if (!list.length) { P[z] = 0; continue; }
        let lo = -P_LIMIT, hi = P_LIMIT, p = P[z];
        for (let it = 0; it < NEWTON; it++) {
          let out = 0, d = 0;
          for (const g of list) { out += outflow(g, z, p); d += slope; }
          const f = out - vexp[z];
          if (f > 0) hi = p; else lo = p;
          if (Math.abs(f) < 1e-7) break;
          const next = d > 0 ? p - f / d : NaN;
          p = next > lo && next < hi ? next : (lo + hi) / 2;
        }
        P[z] = p;
      }
    }
  }

  const books = { sootOut: 0, heatOut: 0, sootAcrossUnits: 0, scalarsOut: {}, moved: {} };
  const firsts = [];          // first visible smoke into the other unit, per route
  const firstSeen = new Set();
  const peaks = new Map();    // zone label -> highest pressure (Pa)
  const stuck = new Set();
  const cost = { steps: 0, ms: 0, solveMs: 0, moveMs: 0, rebuildMs: 0, rebuilds: 0 };
  let fields = [], fieldNames = [], scalarCount = -1;

  function refreshFields() {
    const extra = Object.entries(fire.scalars ?? {});
    if (extra.length === scalarCount) return;
    scalarCount = extra.length;
    fields = [fire.temp, fire.dens, fire.fuel, ...extra.map(([, f]) => f)];
    fieldNames = ['temp', 'dens', 'fuel', ...extra.map(([k]) => k)];
  }

  function move(dt) {
    refreshFields();
    const { temp, dens } = fire;
    for (const g of groups) {
      let q;
      if (g.kind === 'fan') q = fanFlow(g, P[g.za]);
      else q = g.K * pw(P[g.za] - (g.zb < 0 ? 0 : P[g.zb]));
      g.q = q;
      if (q === 0) continue;
      const fwd = q > 0;
      if (!fwd && g.zb < 0) continue;   // outdoor air coming in brings nothing
      const from = fwd ? g.a : g.b, to = fwd ? g.b : g.a;
      const zFrom = fwd ? g.za : g.zb, zTo = fwd ? g.zb : g.za;
      const f = Math.min((Math.abs(q) * dt) / (from.length * Vc), MAX_SHARE);
      let heat = 0, soot = 0;
      for (let p = 0; p < from.length; p++) {
        const d = from[p], r = to[p];
        for (let k = 0; k < fields.length; k++) {
          const F = fields[k];
          const amt = f * F[d];
          if (amt === 0) continue;
          F[d] -= amt;
          if (r >= 0) F[r] += amt;
          else if (k > 2) books.scalarsOut[fieldNames[k]] = (books.scalarsOut[fieldNames[k]] ?? 0) + amt * Vc;
          if (F === temp) heat += amt;
          else if (F === dens) soot += amt;
        }
      }
      S[zFrom] -= heat;
      if (zTo >= 0) S[zTo] += heat;
      books.moved[g.kind] = (books.moved[g.kind] ?? 0) + soot * Vc;
      if (zTo < 0) { books.sootOut += soot * Vc; books.heatOut += heat * Vc * RHO * CP; }
      else if (g.crossUnit) {
        books.sootAcrossUnits += soot * Vc;
        // The first time smoke shows on the other side, per route.
        const key = g.kind === 'outlet' ? g.label : `${g.kind}:${zones[zTo].unit}`;
        if (!firstSeen.has(key)) {
          let seen = false;
          for (let p = 0; p < to.length && !seen; p++) if (dens[to[p]] > VISIBLE) seen = true;
          if (seen) {
            firstSeen.add(key);
            const at0 = at(to[0]);
            const e = { kind: g.kind, route: g.label ?? g.kind, from: UNIT[zones[zFrom].unit], to: UNIT[zones[zTo].unit], time: world.time, pa: Math.round(P[zFrom] - P[zTo]) };
            firsts.push(e);
            world.events.emit({ type: '漏烟', objectId: g.outlets?.[fwd ? 1 : 0]?.id, pos: at0, data: e });
          }
        }
      }
    }
    // Natural bidirectional buoyancy venting through broken windows (Prahl & Emmons 1975):
    // hot upper smoke pours out the top half while fresh cool air enters below.
    for (const w of windows) {
      if (w.o.state !== '失效' || !w.upper.length) continue;
      const z0 = zoneOf[w.upper[0]];
      if (z0 < 0 || zones[z0]?.void) continue;
      let dT = 0;
      for (let i = 0; i < w.upper.length; i++) dT += Math.max(0, temp[w.upper[i]]);
      dT /= w.upper.length;
      if (dT <= 1) continue;
      const qBuoy = (1 / 3) * WIN.cd * w.openArea * Math.sqrt((G * dT * w.height) / (T0 + dT));
      const f = Math.min((qBuoy * dt) / (w.upper.length * Vc), MAX_SHARE);
      let heat = 0, soot = 0;
      for (let i = 0; i < w.upper.length; i++) {
        const d = w.upper[i];
        for (let k = 0; k < fields.length; k++) {
          const F = fields[k];
          const amt = f * F[d];
          if (amt === 0) continue;
          F[d] -= amt;
          if (k > 2) books.scalarsOut[fieldNames[k]] = (books.scalarsOut[fieldNames[k]] ?? 0) + amt * Vc;
          if (F === temp) heat += amt;
          else if (F === dens) soot += amt;
        }
      }
      S[z0] -= heat;
      books.moved.window = (books.moved.window ?? 0) + soot * Vc;
      books.sootOut += soot * Vc;
      books.heatOut += heat * Vc * RHO * CP;
    }
  }

  function updateWindows(dt) {
    const { temp } = fire;
    const ease = 1 - Math.exp(-dt / WIN.lag);
    for (const w of windows) {
      if (w.o.state === '失效') continue;
      let tAir = 0;
      for (let i = 0; i < w.hotSample.length; i++) tAir += temp[w.hotSample[i]];
      tAir /= w.hotSample.length;
      const tRad = !w.o.wallAir && w.o.flux > 0 ? (WIN.alpha * w.o.flux * 1000) / WIN.h : 0;
      w.tg += (tAir + tRad - w.tg) * ease;
      const z0 = zoneOf[w.cells[0]];
      const pa = z0 >= 0 ? P[z0] : 0;
      if (w.tg >= WIN.breakK || pa >= WIN.breakPa) {
        const by = w.tg >= WIN.breakK ? 'heat' : 'pressure';
        w.o.state = '失效';
        w.brokenBy = by;
        const pos = [0, 1, 2].map((a) => +((w.o.min[a] + w.o.max[a]) / 2).toFixed(2));
        world.events.emit({
          type: '窗户破裂', objectId: w.o.id, pos,
          data: { by, room: w.o.room, glassC: Math.round(w.tg + T0 - 273), pa: Math.round(pa) },
        });
      }
    }
  }

  function transfer(_world, dt) {
    const t = performance.now();
    if (fire.fluid !== fluidRef || currentWinMask() !== brokenWinMask) {
      const r = performance.now();
      rebuild();
      cost.rebuildMs = performance.now() - r;
      cost.rebuilds++;
    }
    S.fill(0);
    const { temp, fluid } = fire;
    for (let i = 0; i < fluid.length; i++) { const c = fluid[i], z = zoneOf[c]; if (z >= 0) S[z] += temp[c]; }
    if (primed) {
      const k = Math.min(1, dt / SMOOTH);
      for (let z = 0; z < zones.length; z++) {
        const raw = ((S[z] - Sprev[z]) * Vc) / (T0 * dt);
        vexp[z] += (raw - vexp[z]) * k;
      }
      const t1 = performance.now();
      solve();
      const t2 = performance.now();
      move(dt);
      cost.solveMs += t2 - t1;
      cost.moveMs += performance.now() - t2;
      for (let z = 0; z < zones.length; z++) {
        if (zones[z].void || !adj[z].length) continue;
        const label = zones[z].label;
        if (P[z] > (peaks.get(label) ?? -Infinity)) peaks.set(label, P[z]);
        if (P[z] > STUCK && !stuck.has(label)) {
          stuck.add(label);
          world.events.emit({ type: '超压', pos: at(fire.fluid.find((c) => zoneOf[c] === z) ?? 0), data: { pa: Math.round(P[z]), zone: label } });
        }
      }
      updateWindows(dt);
      if (currentWinMask() !== brokenWinMask) syncWindowMarkers();
    }
    Sprev.set(S);
    primed = true;
    cost.ms += performance.now() - t;
    cost.steps++;
  }

  function reset() {
    primed = false;
    vexp.fill(0); P.fill(0);
    for (const g of groups) g.q = 0;
    for (const w of windows) { w.tg = 0; w.brokenBy = null; }
    books.sootOut = books.heatOut = books.sootAcrossUnits = 0;
    books.scalarsOut = {}; books.moved = {};
    firsts.length = 0; firstSeen.clear(); peaks.clear(); stuck.clear();
    cost.steps = cost.ms = cost.solveMs = cost.moveMs = 0;
    rebuild();
  }

  // --- console ------------------------------------------------------------------------

  const cm2 = (a) => +(a / CM2).toFixed(1);
  const api = {
    /** Every zone with leaks: rooms, volume, pressure (Pa), growth (m³/s). */
    zones() {
      return zones.map((z, i) => ({ zone: i, unit: UNIT[z.unit] || '—', rooms: z.label, m3: +z.volume.toFixed(1), pa: +P[i].toFixed(1), growth: +vexp[i].toFixed(3), leaks: adj[i].length }))
        .filter((z) => z.leaks);
    },
    /** Leaks by kind: how many, total area, total flow now. */
    summary() {
      const out = {};
      for (const g of groups) {
        const s = (out[g.kind] ??= { groups: 0, cells: 0, cm2: 0, m3s: 0 });
        s.groups++; s.cells += g.a.length; s.cm2 += g.ela / CM2; s.m3s += Math.abs(g.q);
      }
      for (const s of Object.values(out)) { s.cm2 = +s.cm2.toFixed(1); s.m3s = +s.m3s.toFixed(4); }
      return out;
    },
    /** Each leak: kind, the two zones, area (cm²), flow (m³/s, + from a to b). */
    list(kind) {
      return groups.filter((g) => !kind || g.kind === kind).map((g) => ({ kind: g.kind, label: g.label ?? '', from: zones[g.za].label, to: g.zb < 0 ? 'outdoors' : zones[g.zb].label, cm2: cm2(g.ela), m3s: +g.q.toFixed(4) }));
    },
    /** Each unit's leakage: total from 3 ACH50, to the other unit, outdoors (cm²). */
    units() {
      return [1, 2].map((u) => ({ unit: UNIT[u], m3: +unitVolume[u].toFixed(0), totalCm2: cm2(unitTotal[u]), partyCm2: cm2(partyELA[u]), outdoorsCm2: cm2(envELA[u]), outdoorsShare: +(envELA[u] / (envELA[u] + partyELA[u])).toFixed(2) }));
    },
    /** Soot (g) and heat (J) that left the house, soot that crossed between units. */
    books() { return { ...books, scalarsOut: { ...books.scalarsOut }, moved: { ...books.moved } }; },
    /** First visible smoke in the other unit, per route; highest pressure per zone. */
    firsts() { return firsts.slice(); },
    peaks() { return Object.fromEntries([...peaks].map(([k, v]) => [k, Math.round(v)])); },
    pressure(z) { return P[z]; },
    outletPairs: outletPairs.map((p) => p.o.map((o) => `${o.id} ${o.room ?? ''}`).join(' ↔ ')),
    windows: () => windows.map((w) => ({ id: w.o.id, room: w.o.room, state: w.o.state, by: w.brokenBy, glassC: +(w.tg + T0 - 273).toFixed(1) })),
    fans,
    cost() { const n = Math.max(1, cost.steps); return { msPerStep: +(cost.ms / n).toFixed(3), solve: +(cost.solveMs / n).toFixed(3), move: +(cost.moveMs / n).toFixed(3), rebuildMs: +cost.rebuildMs.toFixed(1), rebuilds: cost.rebuilds }; },
    get zoneOf() { return zoneOf; },
    get groups() { return groups; },
  };
  world.leaks = api;
  rebuild();

  return {
    transfer,
    report() { if (typeof window !== 'undefined' && window.duplexFire && !window.duplexFire.leaks) window.duplexFire.leaks = api; },
    reset,
  };
}
