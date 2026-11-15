// Radiation and flashover (task C of 开工顺序.md).
//
// Every step this writes object.flux: the heat flux, in kW/m², reaching the
// most exposed face of each object. Combustion (task B) reads it to decide
// what ignites. Two things radiate:
//
//  1. Burning objects (and the igniter), each as a point source (Modak's
//     model, as CFAST and NUREG-1805 ch. 5 use it):
//        q = chi_r * Q * cos(theta) / (4 pi R^2)
//     chi_r * Q is the share of the fire's heat that leaves as radiation (the
//     rest goes into the air, which combustion writes into the field). The
//     point sits on the burning item's vertical centre line, a third of the
//     way up its flame (CFAST). The flame's base is the bottom of the item:
//     burning foam melts and burns in a pool under the item (NIST TN 2303).
//     The flame's height is Heskestad's, L = 0.235 Q^(2/5) - 1.02 D (kW, m),
//     cut off at the ceiling.
//     Why the base is the item's bottom and not its top: with the base on top
//     the point sits more than a metre over a seat-height target, which then
//     sees the fire almost edge-on, and a fire the size of Babrauskas' largest
//     (about 0.8 MW) could not ignite anything beyond 0.05 m. With the base at
//     the bottom the model reaches 40 / 20 / 10 kW/m² at 0.37 / 0.73 / 1.22 m
//     from the item; Babrauskas measured 0.40 / 0.88 / 1.38 m (see
//     tools/radiation-check.mjs and 进度/C/C.md).
//     The point model is only good beyond about 2.5 fire diameters (NUREG-1805
//     §5.5); closer in it grows without bound. R is not allowed under the
//     fire's own radius D/2 (假设): a target cannot be nearer the flame's
//     centre than its edge. Furniture does not shade other furniture; walls,
//     floors and closed doors do (one ray through the grid per source and
//     target).
//
//  2. The hot smoke under the ceiling, as CFAST does it: straight up from the
//     object's top through the air cells to the ceiling. Each cell emits
//     sigma (T^4 - T0^4) times its emissivity 1 - exp(-kappa ds), and the
//     cells below it let through exp(-kappa ds) each. The soot absorption is
//     CFAST's kappa = 1195.5 f_v T (1/m), with f_v = soot (kg/m³) / 1800. The
//     path through each cell is 1.8 times the cell, which is how CFAST makes a
//     single vertical line stand for the whole layer. A side face sees half of
//     what a top face does: the view factor from a vertical surface to a
//     plane over it is 1/2.
//     Missing: the hot ceiling and walls themselves (their temperature is not
//     kept, walls.js), and the gas (CO2, H2O) absorbing and emitting besides
//     soot. Both make the flux from the layer too low, most when the smoke is
//     thin.
//
// Objects buried in a wall or floor (wallAir) get no radiation: the wall
// shades them.
//
// Flashover. A room flashes over when the mean temperature of its upper third
// reaches 600 °C, or the mean flux on its floor reaches 20 kW/m² (NIST's
// usual criteria; 41 CFR 102-80.145 defines flashover as both together). Then
// every combustible in the room is set alight through world.ignite, and a
// 轰燃 event is sent. Babrauskas 1981: "Once flashover is reached, most
// combustibles can be presumed to ignite and burn regardless of where they
// are in the room."
//
// Drawing: a "Flux 热流" switch beside the Heat button tints each piece of
// furniture by the flux on it (a mesh tint, no volume pass).
//
// Every number below is in PARAMS with its source or marked 假设.
import * as THREE from 'three';
import { fadeForZone } from './firezone.js';

export const PARAMS = {
  sigma: { value: 5.67e-8, unit: 'W/m²K⁴', source: 'Stefan–Boltzmann constant' },
  ambient: { value: 293, unit: 'K', source: 'the solver\'s ambient (mac3d.js T0)' },
  defaultRadiantFraction: { value: 0.35, unit: '', source: '假设: for a material without its own value; the engine\'s old default (house.js)' },
  flameHeight: { value: [0.235, 1.02], unit: 'L = a Q^(2/5) − b D (kW, m)', source: 'Heskestad flame height (SFPE Handbook; NUREG-1805 ch. 3)' },
  pointHeight: { value: 1 / 3, unit: 'of flame height', source: 'CFAST 7 technical reference: point source at 1/3 of the flame height' },
  minDistance: { value: 0.5, unit: '× fire diameter', source: '假设: R not below the fire\'s radius; the point model overestimates within 2.5 D (NUREG-1805 §5.5)' },
  sootKappa: { value: 1195.5, unit: 'κ = c f_v T (1/m)', source: 'CFAST 7.7.7 radiation.f90 (absorb), "typical fuels"; uncertain up to about 2× (Widmann 2003)' },
  sootDensity: { value: 1800, unit: 'kg/m³', source: 'CFAST and FDS soot density' },
  pathFactor: { value: 1.8, unit: '× cell', source: 'CFAST: a vertical line through the layer, times 1.8, stands for the whole layer (about 6% error, 家具着火数据.md)' },
  sideFaceShare: { value: 0.5, unit: '', source: 'view factor from a vertical surface to an infinite plane above it' },
  flashoverLayer: { value: 600, unit: '°C', source: 'NIST; 41 CFR 102-80.145: upper layer 600 °C' },
  flashoverFloorFlux: { value: 20, unit: 'kW/m²', source: 'NIST; 41 CFR 102-80.145: 20 kW/m² at the floor' },
  upperLayer: { value: 1 / 3, unit: 'of room height', source: '假设: the top third of the room counts as the upper layer' },
  smokeEvery: { value: 4, unit: 'steps', source: '假设: the smoke layer is updated every 0.2 s to save time' },
  flashoverEvery: { value: 10, unit: 'steps', source: '假设: rooms are checked every 0.5 s' },
};

const P = (k) => PARAMS[k].value;
const SIGMA = P('sigma');
const T0 = P('ambient');

/** Heskestad flame height in metres for Q in W over a fire D metres across, not above `room` metres. */
export function flameHeight(Q, D, room = Infinity) {
  const [a, b] = P('flameHeight');
  return Math.min(room, Math.max(0, a * Math.pow(Q / 1e3, 0.4) - b * D));
}

/**
 * A burning box as a point source.
 * @param {number[]} min @param {number[]} max  the burning item's box (m)
 * @param {number} Q  heat release (W) @param {number} chi  radiant fraction
 * @param {number} ceilY  height of the ceiling over it (m)
 * @returns {{x:number,y:number,z:number, qr:number, rmin2:number}}  qr in kW
 */
export function pointSource(min, max, Q, chi, ceilY = Infinity) {
  const sx = Math.max(max[0] - min[0], 0.05), sz = Math.max(max[2] - min[2], 0.05);
  const D = Math.sqrt((4 * sx * sz) / Math.PI);
  const base = min[1];
  const L = flameHeight(Q, D, ceilY - base);
  const rmin = P('minDistance') * D;
  return {
    x: (min[0] + max[0]) / 2, y: base + L * P('pointHeight'), z: (min[2] + max[2]) / 2,
    qr: (chi * Q) / 1e3, rmin2: rmin * rmin, D, L,
  };
}

// The faces radiation can reach: all but the underside. [axis, side (0 min, 1 max)].
const FACES = [[0, 0], [0, 1], [2, 0], [2, 1], [1, 1]];

/** Flux (kW/m²) from one point source on face f (an index into FACES) of a box. */
export function faceFlux(s, min, max, f) {
  const [a, side] = FACES[f];
  // The face's point nearest the source.
  const px = a === 0 ? (side ? max[0] : min[0]) : Math.min(max[0], Math.max(min[0], s.x));
  const py = a === 1 ? max[1] : Math.min(max[1], Math.max(min[1], s.y));
  const pz = a === 2 ? (side ? max[2] : min[2]) : Math.min(max[2], Math.max(min[2], s.z));
  const dx = s.x - px, dy = s.y - py, dz = s.z - pz;
  const r2 = dx * dx + dy * dy + dz * dz;
  const along = a === 0 ? dx : a === 1 ? dy : dz;
  const cos = r2 > 1e-12 ? (side ? along : -along) / Math.sqrt(r2) : 1;
  return cos > 0 ? (s.qr * cos) / (4 * Math.PI * Math.max(r2, s.rmin2)) : 0;
}

/**
 * Flux (kW/m²) down a column of cells onto a face looking up at it, from the
 * gas in those cells. cells run upward from the face. temp is K above
 * ambient, dens is soot in g/m³.
 */
export function layerFlux(cells, n, temp, dens, cell) {
  const ds = cell * P('pathFactor');
  const c = P('sootKappa') / 1000 / P('sootDensity');   // g/m³ -> f_v, folded into kappa
  const T04 = T0 ** 4;
  let q = 0, through = 1;
  for (let i = 0; i < n; i++) {
    const k = cells[i];
    const T = T0 + Math.max(0, temp[k]);
    const kappa = c * Math.max(0, dens[k]) * T;
    const tau = Math.exp(-kappa * ds);
    q += through * (1 - tau) * SIGMA * (T ** 4 - T04);
    through *= tau;
    if (through < 1e-3) break;
  }
  return q / 1e3;
}

export default function radiation(world) {
  const { grid, objects } = world;
  const { origin, cell, index, nx, ny, nz, solid } = grid;
  const fire = world.fire;
  const W = nx + 2, H = ny + 2;

  const cellOf = (x, y, z) => {
    const i = Math.floor((x - origin.x) / cell) + 1, j = Math.floor((y - origin.y) / cell) + 1, k = Math.floor((z - origin.z) / cell) + 1;
    if (i < 1 || j < 1 || k < 1 || i > nx || j > ny || k > nz) return -1;
    return index(i, j, k);
  };
  const centreOfCell = (c) => {
    const i = c % W, j = Math.floor(c / W) % H, k = Math.floor(c / (W * H));
    return [origin.x + (i - 0.5) * cell, origin.y + (j - 0.5) * cell, origin.z + (k - 0.5) * cell];
  };

  /** Air cells straight up from (x, y, z) to the first solid one, and that ceiling's height. */
  const column = (x, y, z) => {
    const out = [];
    let c = cellOf(x, y + 1e-3, z);
    if (c < 0) return { cells: Int32Array.from(out), ceilY: y };
    let j = Math.floor(c / W) % H;
    // A top that ends inside a solid cell (a floor slab's edge) starts one cell up.
    if (solid[c]) { c += W; j++; }
    for (; j <= ny && !solid[c]; j++, c += W) out.push(c);
    return { cells: Int32Array.from(out), ceilY: origin.y + (j - 1) * cell };
  };

  /** True if a wall, floor or closed door lies between a and b (the last 0.15 m at b is not looked at). */
  const blocked = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const step = cell * 0.5, n = Math.floor((len - 0.15) / step);
    for (let s = 1; s <= n; s++) {
      const t = (s * step) / len;
      const c = cellOf(ax + dx * t, ay + dy * t, az + dz * t);
      if (c >= 0 && solid[c]) return true;
    }
    return false;
  };

  // --- what gets radiation -----------------------------------------------------
  const targets = objects.list.filter((o) => !o.wallAir);
  const tops = targets.map((o) => column((o.min[0] + o.max[0]) / 2, o.max[1], (o.min[2] + o.max[2]) / 2));
  const smoke = new Float32Array(targets.length);   // kW/m² from the layer on each top face

  // --- rooms, for flashover ------------------------------------------------------
  const rooms = world.rooms.filter((r) => r.code !== 'R301').map((r) => {
    const key = `${r.code} ${r.name}`;
    const floor = r.min[1], height = r.max[1] - r.min[1];
    const upper = grid.cellsInBox({
      min: { x: r.min[0], y: r.max[1] - height * P('upperLayer'), z: r.min[2] },
      max: { x: r.max[0], y: r.max[1], z: r.max[2] },
    }).filter((c) => !solid[c]);
    const samples = [];
    for (const fx of [1 / 6, 1 / 2, 5 / 6]) for (const fz of [1 / 6, 1 / 2, 5 / 6]) {
      const x = r.min[0] + (r.max[0] - r.min[0]) * fx, z = r.min[2] + (r.max[2] - r.min[2]) * fz;
      const col = column(x, floor, z);
      if (col.cells.length) samples.push({ x, y: floor + 0.02, z, cells: col.cells });
    }
    const members = objects.list.filter((o) => o.room === key && o.combustible && !o.wallAir);
    return { code: r.code, name: r.name, key, r, upper: Int32Array.from(upper), samples, members, layerC: 20, floorFlux: 0, flashedAt: null, by: null };
  });

  // --- the sources this step -------------------------------------------------------
  const sources = [];
  const chiOf = (o) => world.materials[o.material]?.radiantFraction?.value ?? P('defaultRadiantFraction');
  const ceilingOver = (x, y, z) => column(x, y, z).ceilY;
  function gatherSources() {
    sources.length = 0;
    for (const o of objects.list) {
      if (!(o.hrr > 0)) continue;
      const s = pointSource(o.min, o.max, o.hrr, chiOf(o), ceilingOver((o.min[0] + o.max[0]) / 2, o.max[1], (o.min[2] + o.max[2]) / 2));
      s.object = o;
      sources.push(s);
    }
    // The igniter (house.js HouseFire's patch of floor), if it is burning.
    const pool = fire.firePool;
    const q = pool && pool.length && typeof fire.heatRelease === 'function' ? fire.heatRelease() : 0;
    if (q > 0) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity;
      for (const c of pool) {
        const [x, y, z] = centreOfCell(c);
        x0 = Math.min(x0, x - cell / 2); x1 = Math.max(x1, x + cell / 2);
        z0 = Math.min(z0, z - cell / 2); z1 = Math.max(z1, z + cell / 2);
        y0 = Math.min(y0, y - cell / 2);
      }
      const chi = fire.radiantFraction ?? P('defaultRadiantFraction');
      const s = pointSource([x0, y0, z0], [x1, y0 + cell, z1], q, chi, ceilingOver((x0 + x1) / 2, y0, (z0 + z1) / 2));
      s.object = null;
      sources.push(s);
    }
  }

  /** Flux (kW/m²) from all sources on each exposed face of an object, into out. */
  function flameOn(o, out) {
    out.fill(0);
    for (const s of sources) {
      if (s.object === o) continue;
      // A cheap bound first: skip sources too far to matter.
      const cx = Math.min(o.max[0], Math.max(o.min[0], s.x)), cy = Math.min(o.max[1], Math.max(o.min[1], s.y)), cz = Math.min(o.max[2], Math.max(o.min[2], s.z));
      const r2 = (s.x - cx) ** 2 + (s.y - cy) ** 2 + (s.z - cz) ** 2;
      if (s.qr / (4 * Math.PI * Math.max(r2, s.rmin2)) < 0.05) continue;
      if (blocked(s.x, s.y, s.z, cx, cy, cz)) continue;
      for (let f = 0; f < 5; f++) out[f] += faceFlux(s, o.min, o.max, f);
    }
    return out;
  }
  /** Flux from the sources on an upward-facing point (the floor). */
  function flameOnPoint(x, y, z) {
    let q = 0;
    for (const s of sources) {
      const dx = s.x - x, dy = s.y - y, dz = s.z - z;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (dy <= 0) continue;
      const v = (s.qr * dy) / Math.sqrt(r2) / (4 * Math.PI * Math.max(r2, s.rmin2));
      if (v < 0.05 || blocked(s.x, s.y, s.z, x, y, z)) continue;
      q += v;
    }
    return q;
  }

  let steps = 0;
  const perFace = new Float32Array(5);
  const side = P('sideFaceShare');

  function transfer() {
    const { temp, dens } = fire;
    gatherSources();
    const doSmoke = steps % P('smokeEvery') === 0;
    for (let n = 0; n < targets.length; n++) {
      const o = targets[n];
      if (doSmoke) {
        const col = tops[n].cells;
        // Nothing hot over it: skip the march (the cell under the ceiling is the hottest).
        smoke[n] = col.length && temp[col[col.length - 1]] > 5 ? layerFlux(col, col.length, temp, dens, cell) : 0;
      }
      if (sources.length) flameOn(o, perFace); else perFace.fill(0);
      let best = 0, bestFlame = 0, bestSmoke = 0;
      for (let f = 0; f < 5; f++) {
        const s = f === 4 ? smoke[n] : smoke[n] * side;
        const q = perFace[f] + s;
        if (q > best) { best = q; bestFlame = perFace[f]; bestSmoke = s; }
      }
      o.flux = best;
      o.fluxFlame = bestFlame;
      o.fluxSmoke = bestSmoke;
    }
    steps++;
  }

  function react() {
    if ((steps - 1) % P('flashoverEvery') !== 0) return;
    const { temp, dens } = fire;
    for (const room of rooms) {
      let sum = 0;
      for (const c of room.upper) sum += temp[c];
      room.layerC = 20 + (room.upper.length ? sum / room.upper.length : 0);
      let q = 0;
      for (const sm of room.samples) q += layerFlux(sm.cells, sm.cells.length, temp, dens, cell) + flameOnPoint(sm.x, sm.y, sm.z);
      room.floorFlux = room.samples.length ? q / room.samples.length : 0;
      if (room.flashedAt != null) continue;
      const byLayer = room.layerC >= P('flashoverLayer'), byFloor = room.floorFlux >= P('flashoverFloorFlux');
      if (!byLayer && !byFloor) continue;
      room.flashedAt = world.time;
      room.by = byLayer && byFloor ? 'both' : byLayer ? 'layer' : 'floor';
      const r = room.r;
      world.events.emit({
        type: '轰燃',
        pos: [(r.min[0] + r.max[0]) / 2, r.min[1], (r.min[2] + r.max[2]) / 2],
        data: { room: room.key, layerC: Math.round(room.layerC), floorFlux: +room.floorFlux.toFixed(1), by: room.by, items: room.members.length },
      });
      for (const o of room.members) {
        if (o.state !== '燃烧' && o.state !== '烧尽') world.ignite(o);
      }
    }
  }

  // --- drawing: tint furniture by flux --------------------------------------------
  const STOPS = [[1, [0.23, 0.42, 1.0]], [10, [1.0, 0.82, 0.23]], [20, [1.0, 0.48, 0.1]], [40, [1.0, 0.1, 0.1]]];
  function fluxColour(q, out) {
    if (q <= STOPS[0][0]) return out.setRGB(...STOPS[0][1]);
    for (let i = 1; i < STOPS.length; i++) {
      if (q <= STOPS[i][0]) {
        const [q0, c0] = STOPS[i - 1], [q1, c1] = STOPS[i];
        const t = Math.log(q / q0) / Math.log(q1 / q0);
        return out.setRGB(c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t);
      }
    }
    return out.setRGB(...STOPS[STOPS.length - 1][1]);
  }
  let tint = null;
  function buildTint() {
    const view = world.view;
    const furniture = view?.extras?.furniture;
    if (!furniture || typeof document === 'undefined') return null;
    const group = new THREE.Group();
    group.visible = false;
    const items = [];
    for (const m of furniture.elements) {
      const o = objects.byElement.get(m.userData.element);
      if (!o || o.wallAir) continue;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: view.cut ? [view.cut] : [], polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      });
      if (view.smoke?.zone) fadeForZone(mat, view.smoke.zone, { mode: 2 });
      const mesh = new THREE.Mesh(m.geometry, mat);
      mesh.renderOrder = 3;
      mesh.visible = false;
      group.add(mesh);
      items.push({ o, mesh, mat });
    }
    view.scene.add(group);
    // The switch, beside the Heat button.
    const heat = document.querySelector('[data-mode="heat"]');
    const label = document.createElement('label');
    label.title = 'Colour furniture by the radiant heat flux on it 按表面受到的热流给家具上色';
    label.innerHTML = '<input type="checkbox" id="fluxTint"> Flux 热流 <span id="fluxLegend" hidden style="font-size:11px">' +
      '<span style="color:#3b6bff">■</span>1 <span style="color:#ffd13b">■</span>10 <span style="color:#ff7a1a">■</span>20 ' +
      '<span style="color:#ff1a1a">■</span>40 kW/m² · <span style="color:#fff">■</span>burning 在烧</span>';
    if (heat?.parentNode) heat.parentNode.insertBefore(label, heat.nextSibling);
    else document.body.appendChild(label);
    const box = label.querySelector('input');
    const legend = label.querySelector('#fluxLegend');
    box.addEventListener('change', () => { legend.hidden = !box.checked; paint(); });
    return { group, items, box };
  }
  const colour = new THREE.Color();
  function paint() {
    if (!tint) return;
    const fOpacity = world.view?.furnitureOpacity ?? 1;
    const furnitureShown = world.view?.extraMeshes?.furniture?.visible !== false && fOpacity > 0.01;
    tint.group.visible = tint.box.checked && furnitureShown;
    if (!tint.group.visible) return;
    for (const { o, mesh, mat } of tint.items) {
      const burning = o.state === '燃烧';
      mesh.visible = burning || o.flux >= 1;
      if (!mesh.visible) continue;
      mat.opacity = 0.85 * fOpacity;
      if (burning) mat.color.setRGB(1, 1, 1); else mat.color.copy(fluxColour(o.flux, colour));
    }
  }
  let reports = 0;
  function report() {
    if (!tint && world.view && reports === 0) tint = buildTint();
    if (reports++ % 5 === 0) paint();
  }

  const mod = {
    transfer,
    react,
    report,
    paint,
    reset() {
      steps = 0;
      smoke.fill(0);
      for (const o of objects.list) { o.flux = 0; o.fluxFlame = 0; o.fluxSmoke = 0; }
      for (const r of rooms) { r.flashedAt = null; r.by = null; r.layerC = 20; r.floorFlux = 0; }
      paint();
    },
    // For the console and tools/radiation-check.mjs.
    rooms,
    sources,
    PARAMS,
    /** Each room's upper-layer temperature, floor flux and whether it has flashed over. */
    status() {
      return rooms.map((r) => ({ room: r.key, layerC: Math.round(r.layerC), floorFlux: +r.floorFlux.toFixed(1), flashedAt: r.flashedAt, by: r.by }));
    },
  };
  world.radiation = mod;
  return mod;
}
