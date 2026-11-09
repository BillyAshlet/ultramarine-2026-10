// The NIST two-storey test house (Kinston, N.C.; TN 1455-1, figures 88, 89,
// 92 and 93), drawn as boxes on the solver's grid.
//
// Read off the report's plan figures with a ruler, so walls are good to about
// a cell. x runs left to right on the plans, z from the front wall (bottom of
// the plans) to the back, y up. The outside walls are the grid's own border.
//
// Not in the report and assumed here:
//  - ceiling height 2.4 m on both floors (8 ft), floor 0.2 m thick;
//  - doors that the plans draw shut, or that lead to small rooms the tests did
//    not measure (both bathrooms, the closet), are closed; "Bedroom 1 (Closed
//    Room)" upstairs is closed, as its label says;
//  - the stair is an open shaft between the floors, without treads.

export const SIZE = { x: 9.6, y: 5.0, z: 7.2 };
export const CEILING = { 1: 2.4, 2: 5.0 };
const FLOOR_BASE = { 1: 0, 2: 2.6 };

// Where the instruments were, in plan metres, with the floor they were on.
// Names follow the report's data files; "Bedroom 1" there is the large bedroom
// on the right of the upper floor (station A), the one the plans call Bedroom 2.
export const STATIONS = {
  livingRoom: { floor: 1, x: 2.65, z: 1.8, label: 'Living room' },
  kitchen: { floor: 1, x: 4.95, z: 5.48, label: 'Kitchen' },
  den: { floor: 1, x: 8.74, z: 2.1, label: 'Den (D)' },
  foyer: { floor: 1, x: 6.46, z: 0.52, label: 'Foyer (B)' },
  hallway: { floor: 2, x: 5.58, z: 4.58, label: 'Upstairs hallway (C)' },
  bedroom1: { floor: 2, x: 8.4, z: 4.36, label: 'Bedroom 1 (A)' },
  bedroom3: { floor: 2, x: 1.77, z: 5.5, label: 'Bedroom 3' },
};

// What burns, as the box its fuel comes from (absolute heights).
// The chair sat on its load cell in the living room (figure 92). The report
// does not show where the twin mattress lay in bedroom 3; it is put along the
// back wall here, which is an assumption.
export const FIRES = {
  chair: { x0: 0.2, x1: 1.2, z0: 1.4, z1: 2.4, y0: 0.4, y1: 0.8 },
  mattress: { x0: 0.3, x1: 1.3, z0: 5.0, z1: 6.9, y0: 3.0, y1: 3.4 },
};
export const CHAIR = FIRES.chair;

/**
 * @param {number} cell
 * @param {object} [o]
 * @param {'chair'|'mattress'} [o.fire]
 * @param {'open'|'closed'|'leaky'} [o.bedroom3Door]  'leaky' is shut but with
 *   one cell open at the floor and one at the head of the door, the only way a
 *   solver this coarse can let a shut door's gaps through. Two cells are 0.08 m2
 *   of opening, a few times what real gaps round a door add up to.
 */
export function buildHouse(cell, { fire = 'chair', bedroom3Door = 'open' } = {}) {
  const nx = Math.round(SIZE.x / cell), ny = Math.round(SIZE.y / cell), nz = Math.round(SIZE.z / cell);
  const W = nx + 2, H = ny + 2;
  const solid = new Uint8Array(W * H * (nz + 2));
  const ci = (x) => Math.min(nx, Math.max(1, Math.floor(x / cell) + 1));
  // Cells whose centres lie inside [a, b). Rounding the ends, not flooring them:
  // 2.4 / 0.2 is 11.999..., and flooring once made the floor slab two cells
  // thick, which put the downstairs ceiling at 2.2 m and buried every
  // ceiling-height instrument inside it.
  const span = (a, b, n) => [Math.max(1, Math.round(a / cell) + 1), Math.min(n, Math.round(b / cell))];
  const fill = (x0, x1, y0, y1, z0, z1, value = 1) => {
    const [i0, i1] = span(x0, x1, nx), [j0, j1] = span(y0, y1, ny), [k0, k1] = span(z0, z1, nz);
    for (let k = k0; k <= k1; k++)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) solid[i + W * j + W * H * k] = value;
  };
  const storey = (f) => [FLOOR_BASE[f], CEILING[f]];
  const wallX = (f, x, z0, z1) => fill(x - cell / 2, x + cell / 2, ...storey(f), z0, z1);
  const wallZ = (f, z, x0, x1) => fill(x0, x1, ...storey(f), z - cell / 2, z + cell / 2);
  const room = (f, x0, x1, z0, z1) => fill(x0, x1, ...storey(f), z0, z1);

  // The floor between the storeys, with the stair opening in it.
  fill(0, SIZE.x, CEILING[1], FLOOR_BASE[2], 0, SIZE.z);
  fill(4.95, 6.05, CEILING[1], FLOOR_BASE[2], 1.6, 3.6, 0);

  // Ground floor: living room, dining room, kitchen and den are largely open.
  wallX(1, 3.34, 5.14, SIZE.z);       // dining | kitchen
  wallZ(1, 3.51, 2.67, 4.95);         // kitchen | living room
  wallX(1, 3.34, 3.51, 4.39);         // stub off that wall
  wallZ(1, 3.58, 0, 0.9);             // living | dining stub
  wallX(1, 6.08, 1.6, 4.2);           // stair | den
  room(1, 7.6, SIZE.x, 0, 1.86);      // bathroom, closed

  // Upper floor.
  room(2, 0, 4.37, 0, 3.54);          // Bedroom 1 on the plans: the closed room
  wallZ(2, 3.54, 0, 4.37);
  wallX(2, 3.39, 4.5, SIZE.z);        // bedroom 3 | bath, door below 4.5
  room(2, 3.39, 6.36, 4.98, SIZE.z);  // bathroom and linen closet, closed
  wallX(2, 4.95, 1.6, 3.5);           // stair well, left
  wallX(2, 6.05, 1.6, 4.27);          // stair well, right; door to the big bedroom above it
  room(2, 4.37, 6.9, 0, 1.56);        // closet
  room(2, 6.9, SIZE.x, 0, 1.56);      // bathroom
  if (bedroom3Door !== 'open') {
    wallX(2, 3.39, 3.54, 4.5);
    if (bedroom3Door === 'leaky') {
      fill(3.39 - cell / 2, 3.39 + cell / 2, FLOOR_BASE[2], FLOOR_BASE[2] + cell, 4.0, 4.0 + cell, 0);
      fill(3.39 - cell / 2, 3.39 + cell / 2, CEILING[2] - cell, CEILING[2], 4.0, 4.0 + cell, 0);
    }
  }

  const cellAt = (x, y, z) => ci(x) + W * ci(y) + W * H * ci(z);
  const chair = [];
  const F = FIRES[fire];
  const [ci0, ci1] = span(F.x0, F.x1, nx), [cj0, cj1] = span(F.y0, F.y1, ny), [ck0, ck1] = span(F.z0, F.z1, nz);
  for (let k = ck0; k <= ck1; k++)
    for (let j = cj0; j <= cj1; j++)
      for (let i = ci0; i <= ci1; i++) chair.push(i + W * j + W * H * k);
  return { nx, ny, nz, cell, W, H, solid, chair: Int32Array.from(chair), cellAt };
}
