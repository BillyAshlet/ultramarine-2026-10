// Turn the IFC house into the fluid's grid: which cells are wall, which are air.
//
// Walls carry their door and window openings as holes in their geometry, so
// a box test would close every doorway. Instead each grid column shoots one
// ray straight down and pairs up the hits on each element (in, out, in, out):
// a cell is solid if its centre lies between a pair. That keeps the hole
// under a lintel open and the wall above it solid.
//
// Doors and window panes are thinner than a cell, so a column ray can slip
// past them. They are added as boxes instead, widened across the wall so
// they always fill at least one cell.
import * as THREE from 'three';

const DOWN = new THREE.Vector3(0, -1, 0);
// Columns are nudged off the cell centre so rays never run exactly along an
// edge, where one surface reports two hits and breaks the in/out pairing.
const NUDGE = 1e-3;

/**
 * @param {object} o
 * @param {THREE.Box3} o.bounds      world box the grid covers
 * @param {number} o.cell            cell size in metres
 * @param {THREE.Mesh[]} o.solids    closed elements: walls, slabs, roof, beams
 * @returns {{nx:number, ny:number, nz:number, origin:THREE.Vector3, solid:Uint8Array, cellAt:Function, centre:Function}}
 *   solid is indexed like the fluid: i + W*j + W*H*k with a one-cell border.
 */
export function voxelize({ bounds, cell, solids }) {
  const size = bounds.getSize(new THREE.Vector3());
  const nx = Math.ceil(size.x / cell), ny = Math.ceil(size.y / cell), nz = Math.ceil(size.z / cell);
  const W = nx + 2, H = ny + 2;
  const origin = bounds.min.clone();
  const solid = new Uint8Array(W * H * (nz + 2));
  const index = (i, j, k) => i + W * (j + H * k);
  const centre = (i, j, k) => new THREE.Vector3(
    origin.x + (i - 0.5) * cell, origin.y + (j - 0.5) * cell, origin.z + (k - 0.5) * cell);

  for (const m of solids) m.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const top = bounds.max.y + 1;

  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const c = centre(i, 1, k);
    raycaster.set(new THREE.Vector3(c.x + NUDGE, top, c.z + NUDGE), DOWN);
    const byObject = new Map();
    for (const hit of raycaster.intersectObjects(solids, false)) {
      const list = byObject.get(hit.object) ?? [];
      // Drop a repeat hit at the same height (a shared triangle edge).
      if (list.length === 0 || Math.abs(list[list.length - 1] - hit.point.y) > 1e-4) list.push(hit.point.y);
      byObject.set(hit.object, list);
    }
    for (const ys of byObject.values()) {
      for (let h = 0; h + 1 < ys.length; h += 2) {
        const yTop = ys[h], yBottom = ys[h + 1];
        for (let j = 1; j <= ny; j++) {
          const y = origin.y + (j - 0.5) * cell;
          if (y <= yTop && y >= yBottom) solid[index(i, j, k)] = 1;
        }
      }
    }
  }

  /** Cells whose centre is inside a box, as a list of grid indices. */
  const cellsInBox = (box) => {
    const out = [];
    const lo = (v, o) => Math.max(1, Math.ceil((v - o) / cell + 0.5));
    const hi = (v, o, n) => Math.min(n, Math.floor((v - o) / cell + 0.5));
    for (let k = lo(box.min.z, origin.z); k <= hi(box.max.z, origin.z, nz); k++)
      for (let j = lo(box.min.y, origin.y); j <= hi(box.max.y, origin.y, ny); j++)
        for (let i = lo(box.min.x, origin.x); i <= hi(box.max.x, origin.x, nx); i++) out.push(index(i, j, k));
    return out;
  };

  return { nx, ny, nz, origin, cell, solid, index, centre, cellsInBox };
}

/**
 * The box a thin opening element (door leaf, window pane) should block:
 * its own box, widened across its thin direction to at least `across` metres.
 */
export function openingBox(meshes, across) {
  const box = new THREE.Box3();
  for (const m of meshes) { m.updateMatrixWorld(true); box.expandByObject(m); }
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const thin = size.x < size.z ? 'x' : 'z';
  const half = Math.max(size[thin], across) / 2;
  box.min[thin] = centre[thin] - half;
  box.max[thin] = centre[thin] + half;
  return box;
}
