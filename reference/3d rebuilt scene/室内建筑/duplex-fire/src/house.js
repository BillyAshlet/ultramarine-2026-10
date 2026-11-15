// The NIBS Duplex as a smoke grid, and a fire that grows the way a design
// fire does.
//
// The geometry comes from ../duplex-overlay/data, already converted from IFC,
// so nothing here needs web-ifc. The same code runs in the browser and in
// tools/bench.mjs under node.
import * as THREE from 'three';
import { voxelize } from './voxelize.js';
import { MacFire } from './mac3d.js';
import { WallLoss } from './walls.js';

export const CELL = 0.2;

// Inside faces of the outer walls, from the architect's rooms: a door whose
// box reaches past them is an outside door.
const INSIDE = { x0: 0.42, x1: 8.38, z0: 0.42, z1: 17.38 };

/**
 * One converted layer: a merged geometry to draw, and one mesh per element
 * (sharing the merged vertices) for ray tests, since voxelize pairs ray hits
 * element by element.
 */
export function readLayer(meta, name, buffer) {
  const info = meta.layers[name];
  const pad = (n) => Math.ceil(n / 4) * 4;
  const pos = new Float32Array(buffer, 0, info.vertices * 3);
  const col = new Uint8Array(buffer, pos.byteLength, info.vertices * 3);
  const Index = info.wideIndex ? Uint32Array : Uint16Array;
  const idx = new Index(buffer, pos.byteLength + pad(col.byteLength), info.indices);
  const position = new THREE.BufferAttribute(pos, 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  geometry.setIndex(new THREE.BufferAttribute(idx, 1));
  geometry.computeVertexNormals();
  // Both sides: a ray leaving a wall hits its back faces, and the in/out
  // pairing needs that hit.
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const elements = meta.elements.filter((e) => e.layer === name).map((e) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setIndex(new THREE.BufferAttribute(idx.subarray(e.t0 * 3, e.t1 * 3), 1));
    // The shared vertices span the whole house; bound each element by its own box.
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, material);
    mesh.userData.element = e;
    return mesh;
  });
  return { geometry, elements };
}

const boxOf = (e) => new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));

/** A thin element's box, widened across its thin direction to at least `across` metres. */
function widened(e, across) {
  const box = boxOf(e);
  const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const thin = size.x < size.y && size.x < size.z ? 'x' : size.y < size.z ? 'y' : 'z';
  const half = Math.max(size[thin], across) / 2;
  box.min[thin] = centre[thin] - half;
  box.max[thin] = centre[thin] + half;
  return box;
}

/**
 * Ceilings are a few centimetres of plasterboard, so a cell centre almost
 * never falls inside one and voxelize would leave them out. Here each pair
 * of ray hits through a ceiling marks the one cell it passes through.
 * Ray pairs, not boxes: a ceiling has holes over the stairs.
 */
function addThinLayers(grid, meshes) {
  const { nx, nz, origin, cell, index, solid } = grid;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const x = origin.x + (i - 0.5) * cell + 1e-3, z = origin.z + (k - 0.5) * cell + 1e-3;
    ray.set(new THREE.Vector3(x, 100, z), down);
    const byObject = new Map();
    for (const hit of ray.intersectObjects(meshes, false)) {
      const list = byObject.get(hit.object) ?? [];
      if (list.length === 0 || Math.abs(list[list.length - 1] - hit.point.y) > 1e-4) list.push(hit.point.y);
      byObject.set(hit.object, list);
    }
    for (const ys of byObject.values()) {
      for (let h = 0; h + 1 < ys.length; h += 2) {
        const j = Math.floor(((ys[h] + ys[h + 1]) / 2 - origin.y) / cell) + 1;
        if (j >= 1 && j <= grid.ny) solid[index(i, j, k)] = 1;
      }
    }
  }
}

/**
 * The 92 mm stud partitions are about 12 cm thick, thinner than a cell. The
 * column rays in voxelize sample cell centres, 20 cm apart, so a partition
 * lying between two rows of centres was missed entirely: four upstairs walls
 * (bedrooms to hallway, bathroom and utility) did not exist, and smoke went
 * round a closed door through them. Here each such wall gets its own column
 * rays along its centre line, marking the one row of cells it runs through.
 * Ray pairs, not boxes, for the same reason as voxelize: a wall's door
 * openings are holes in it, and a box would brick them up.
 */
function addThinWalls(grid, walls) {
  const { nx, ny, nz, origin, cell, index, solid } = grid;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const NUDGE = 1e-3;
  for (const m of walls) {
    const e = m.userData.element;
    const dx = e.max[0] - e.min[0], dz = e.max[2] - e.min[2];
    if (Math.min(dx, dz) >= cell) continue;
    const alongX = dx > dz;
    // The row of cells the wall's centre line runs through.
    const mid = alongX ? (e.min[2] + e.max[2]) / 2 : (e.min[0] + e.max[0]) / 2;
    const row = Math.floor((mid - (alongX ? origin.z : origin.x)) / cell) + 1;
    const [lo, hi] = alongX ? [e.min[0], e.max[0]] : [e.min[2], e.max[2]];
    const o = alongX ? origin.x : origin.z;
    const n = alongX ? nx : nz;
    const first = Math.max(1, Math.ceil((lo - o) / cell + 0.5));
    const last = Math.min(n, Math.floor((hi - o) / cell + 0.5));
    for (let s = first; s <= last; s++) {
      const along = o + (s - 0.5) * cell + NUDGE;
      ray.set(alongX ? new THREE.Vector3(along, 100, mid) : new THREE.Vector3(mid, 100, along), down);
      const ys = [];
      for (const hit of ray.intersectObject(m, false)) {
        if (ys.length === 0 || Math.abs(ys[ys.length - 1] - hit.point.y) > 1e-4) ys.push(hit.point.y);
      }
      const [i, k] = alongX ? [s, row] : [row, s];
      for (let h = 0; h + 1 < ys.length; h += 2) {
        for (let j = 1; j <= ny; j++) {
          const y = origin.y + (j - 0.5) * cell;
          if (y <= ys[h] && y >= ys[h + 1]) solid[index(i, j, k)] = 1;
        }
      }
    }
  }
}

/**
 * Walls, floors, ceilings and closed windows become solid cells. Inside doors
 * start open and outside doors shut, as in ../../fliud3d. Stairs, railings and
 * furniture are left out: thinner than a cell, they would plug the stairwell.
 */
export function buildGrid(building, cell = CELL) {
  const by = (pattern) => building.elements.filter((m) => pattern.test(m.userData.element.type));
  const walls = by(/^IfcWall/);
  const bounds = new THREE.Box3();
  for (const m of walls) bounds.union(m.geometry.boundingBox);
  // The ground slab's underside to just above the top ceiling; the roof deck
  // over it holds only a void, and below ground is the crawl space.
  bounds.min.y = -0.2;
  bounds.max.y = 6.2;
  // The walls' box is 8.8 m plus a rounding error, which made a whole extra
  // column of cells outside the house. Snap each side to whole cells.
  for (const a of ['x', 'y', 'z']) {
    bounds.max[a] = bounds.min[a] + Math.round((bounds.max[a] - bounds.min[a]) / cell) * cell - 1e-6;
  }

  const grid = voxelize({ bounds, cell, solids: [...walls, ...by(/^IfcSlab$/), ...by(/^IfcBeam$/)] });
  addThinLayers(grid, by(/^IfcCovering$/));
  addThinWalls(grid, walls);

  const fill = (box, value) => { for (const c of grid.cellsInBox(box)) grid.solid[c] = value; };
  for (const m of by(/^IfcWindow$/)) fill(widened(m.userData.element, cell * 2), 1);
  const doors = [];
  for (const m of by(/^IfcDoor$/)) {
    const e = m.userData.element;
    const outside = e.min[0] < INSIDE.x0 - 0.01 || e.max[0] > INSIDE.x1 + 0.01 || e.min[2] < INSIDE.z0 - 0.01 || e.max[2] > INSIDE.z1 + 0.01;
    const door = { element: e, cells: grid.cellsInBox(widened(e, cell * 2)), open: !outside, outside };
    if (!door.open) for (const c of door.cells) grid.solid[c] = 1;
    doors.push(door);
  }
  return { ...grid, doors, bounds };
}

/**
 * The fire you drag into place is an igniter, not a design fire: a 50 kW gas
 * burner that burns for 200 s and goes out, as NBS lit chairs, sofas and a
 * bookcase (NBSIR 83-2787 §3.2.2: "designed to simulate the peak burning rate
 * of a wastebasket"). What burns after that is furniture it has set alight
 * (combustion.js), each on its own measured or estimated curve. The numbers,
 * with their sources, are materials.json `igniter`; combustion.js hands them
 * over with setIgniter, and the defaults below are the same so tools that run
 * the solver alone (bench.mjs) get the same burner.
 *
 * It used to be a t-squared design fire growing to 1 MW and holding: that is
 * how fire engineering stands in for a fire it cannot predict, but here the
 * fire is meant to come from the furniture. GROWTH stays for the page's
 * growth menu, which no longer changes anything (main.js is not B's file).
 *
 * The solver is mac3d.js: burning and real units as wind-plume's WindyFire,
 * but on a staggered grid and moving heat, soot and fuel so their totals are
 * kept (see its top for why). The walls take heat out of the air (walls.js).
 */
export const GROWTH = { slow: 0.00293e3, medium: 0.01172e3, fast: 0.0469e3, ultrafast: 0.1876e3 }; // W/s^2

// The old design fire's placeholders for "burning furniture", kept so the
// checks that still ask for it get what they were written against; each
// burning item now uses its own numbers (materials.json).
const DESIGN_FIRE = { radiantFraction: 0.35, heatOfCombustion: 25e6, sootYield: 0.05 };
const IGNITER = {
  power: 50e3,             // W, NBSIR 83-2787 §3.2.2
  duration: 200,           // s, same
  radiantFraction: 0.2,    // 假设, a natural gas flame; see materials.json igniter
  heatOfCombustion: 50e6,  // J/kg, methane
  sootYield: 0,            // 假设: a natural gas burner makes next to no soot
};

export class HouseFire extends MacFire {
  // burnTime: fuel burns over this long. 1.5 s (WindyFire's value) spread the
  // heat up the whole plume to the ceiling; 0.5 s, chosen against
  // Heskestad's free plume at 150 kW and checked at 60 kW before any Duplex
  // run, puts it in the flame. 1 m or more above the flame the centreline
  // is then within about 15% of Heskestad; nearer the flame it is too cool
  // and slow, because a 20 cm grid gives these fires only 1.5 to 2 cells
  // across (FDS advises 4 or more).
  constructor({ grid, pool, growth, peak = 1e6, burnTime = 0.5, smagorinsky = 0.2 }) {
    super({ nx: grid.nx, ny: grid.ny, nz: grid.nz, cell: grid.cell, solid: grid.solid, burnTime, smagorinsky });
    // Passing a growth rate asks for the old t-squared design fire (growing to
    // `peak` and holding): the other tasks' checks in tools/ were written
    // against it and still pass one. The page does not, and gets the igniter.
    this.designFire = growth !== undefined;
    this.growth = growth ?? GROWTH.medium;
    this.peak = peak;
    this.igniter = { ...IGNITER };
    this.radiantFraction = this.burner().radiantFraction;   // radiation.js reads it
    this.seed = 12345;
    this.sootMade = 0;   // grams
    this.heatMade = 0;   // J put into the air (the radiated share is not)
    this.setPool(pool);
    this.walls = new WallLoss(this);
  }

  setPool(cells) {
    this.firePool = cells;
    this.poolVolume = cells.length * this.cell ** 3;
    this.poolStart = this.time ?? 0;
  }

  /** The burner's numbers from materials.json `igniter` ({value} fields). */
  setIgniter(entry) {
    for (const k of Object.keys(IGNITER)) {
      const v = entry?.[k]?.value;
      if (typeof v === 'number') this.igniter[k] = v;
    }
    this.radiantFraction = this.burner().radiantFraction;
  }

  /** What the drag-placed fire burns as: the igniter, or the old design fire's placeholders. */
  burner() { return this.designFire ? DESIGN_FIRE : this.igniter; }

  /** The burner: full power from the moment it is placed, out after its duration. */
  heatRelease() {
    if (!this.firePool || this.firePool.length === 0) return 0;
    const age = Math.max(0, this.time - (this.poolStart ?? 0));
    if (this.designFire) return Math.min(this.growth * age * age, this.peak);
    return age < this.igniter.duration ? this.igniter.power : 0;
  }

  /**
   * The igniter adds fuel and soot on its patch of floor, in proportion to
   * what burns. Soot used to be a tracer held at 1 in the fire's cells, as in
   * WindyFire, which thinned to nothing within a room; and while the old
   * solver lost three quarters of it at the ceiling, it was scaled back up to
   * the amount made every step. mac3d.js keeps it, so that is gone.
   */
  step() {
    const { firePool, fuel, dens, dt } = this;
    const q = firePool.length ? this.heatRelease() : 0;
    if (q > 0) {
      const { radiantFraction, heatOfCombustion, sootYield } = this.burner();
      // Fuel is counted in the degrees it will give the air it burns in.
      const fuelRate = q * (1 - radiantFraction) / (1.2 * 1005 * this.poolVolume);
      const sootRate = q / heatOfCombustion * sootYield * 1000 / this.poolVolume;   // g/m3 per s
      this.heatMade += q * (1 - radiantFraction) * dt;
      for (const c of firePool) {
        // Slightly uneven, as in WindyFire: an even source stays symmetrical.
        this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
        const r = 0.6 + 0.8 * this.seed / 0x7fffffff;
        fuel[c] += dt * fuelRate * r;
        dens[c] += dt * sootRate * r;
        this.sootMade += dt * sootRate * r * this.cell ** 3;
      }
    }
    super.step();
    this.walls.apply(dt);
  }

  reset() {
    super.reset();
    this.poolStart = 0;
    this.sootMade = 0;
    this.heatMade = 0;
    this.walls?.reset();
  }
}

/** Air cells on the floor under a point: the fire's footprint, `size` metres across. */
export function poolAt(grid, x, z, floorY, size = 0.6) {
  const half = size / 2;
  const cells = [];
  const { origin, cell, index, solid } = grid;
  const j0 = Math.floor((floorY - origin.y) / cell) + 1;
  for (let k = 1; k <= grid.nz; k++) for (let i = 1; i <= grid.nx; i++) {
    const cx = origin.x + (i - 0.5) * cell, cz = origin.z + (k - 0.5) * cell;
    if (Math.abs(cx - x) > half || Math.abs(cz - z) > half) continue;
    // The first air cell above the floor surface, and the one over it.
    for (let j = Math.max(1, j0); j <= Math.min(grid.ny, j0 + 3); j++) {
      const c = index(i, j, k);
      if (!solid[c]) { cells.push(c); break; }
    }
  }
  return Int32Array.from(cells);
}
