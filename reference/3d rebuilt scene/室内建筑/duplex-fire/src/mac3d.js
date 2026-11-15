// A fire solver for a sealed house that keeps heat, soot and fuel.
//
// Why this replaces fluid3d.js + windy.js here. Those keep the wind at cell
// centres (a collocated grid). There the pressure solve cannot stop air
// flowing into a wall, so after it fluid3d.js zeroed any wind pointing into a
// wall ("blockWalls"), which is what made the ceiling a ceiling. But that left
// the air under the ceiling squeezed, and the solver, which fills each cell by
// looking back along the wind, then copied the hot plume into the row under
// the ceiling over and over. With the walls taking no heat, the air held three
// times the heat the fire had made after 60 s, nearly all of it in that row.
// Soot, carried the same way, went the other way: three quarters of it was
// lost at the ceiling, and was being scaled back up every step.
//
// Two changes fix both at the root:
//  - The wind lives on cell faces (a staggered, "MAC" grid). A face against a
//    wall is closed and holds no wind, so no air flows into walls, and the
//    pressure solve works on exactly the flows that cross faces. Nothing has
//    to be zeroed afterwards.
//  - Heat, soot and fuel are moved by what flows through each face: what
//    leaves one cell arrives in its neighbour, so totals are kept whatever
//    the wind is doing, and a closed face (a wall, however thin) lets
//    nothing through. This replaces the old wall-corner guard in the lookup.
// The wind itself is still carried by looking back along it (semi-Lagrangian),
// which is stable at any time step; only the scalars need to be conserved.
//
// Units are real: metres, seconds, kelvin above ambient. Burning, buoyancy and
// eddy mixing are as in windy.js (../../交通工具/wind-plume): fuel is counted
// in the degrees it will give the air, burns over a time tau, and cannot heat
// gas past a flame temperature; hot gas rises at g dT / T0.
//
// Grid layout as in fluid3d.js: index c = i + W*j + W*H*k with a one-cell
// solid border; cell centres sit at integer (i, j, k). uf[c] is the wind
// through the face on the low-x side of cell c, at (i - 0.5, j, k); likewise
// vf (low-y) and wf (low-z).

const G = 9.81;
const T0 = 293;
const FLAME_DT = 800;          // K above ambient, as windy.js
const TURBULENT_MIXING = 2;    // heat and soot mix twice as fast as momentum, as windy.js

function hasNonZero(arr, fluid) {
  for (let n = 0, len = fluid.length; n < len; n++) {
    if (arr[fluid[n]] !== 0) return true;
  }
  return false;
}

// Compute upwind TVD flux (van Leer limiter) across one open grid face.
function faceFlux(q, c, s, v, open, h) {
  if (!open[c] || v === 0) return 0;
  if (v > 0) {
    const qa = q[c - s], jump = q[c] - qa;
    if (jump === 0 || !open[c - s]) return v * qa;
    const r = (qa - q[c - 2 * s]) / jump;
    return r > 0 ? v * (qa + (r / (1 + r)) * (1 - v * h) * jump) : v * qa;
  }
  const qa = q[c], jump = q[c - s] - qa;
  if (jump === 0 || !open[c + s]) return v * qa;
  const r = (qa - q[c + s]) / jump;
  return r > 0 ? v * (qa + (r / (1 + r)) * (1 + v * h) * jump) : v * qa;
}

export class MacFire {
  constructor({ nx, ny, nz, cell, solid, burnTime = 1.5, smagorinsky = 0.2 }) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.W = nx + 2; this.H = ny + 2; this.D = nz + 2;
    this.sy = this.W; this.sz = this.W * this.H;
    this.size = this.sz * this.D;
    this.cell = cell;
    this.solid = solid;
    const F = () => new Float32Array(this.size);
    this.uf = F(); this.vf = F(); this.wf = F();
    this.uf0 = F(); this.vf0 = F(); this.wf0 = F();
    this.temp = F(); this.temp0 = F();
    this.dens = F(); this.dens0 = F();
    this.fuel = F(); this.fuel0 = F();
    // Other things the air carries (gas, water), added with addScalar;
    // scalars holds each one's field by name.
    this.extras = [];
    this.scalars = {};
    this.p = F(); this.eddy = F();
    this.fx = F(); this.fy = F(); this.fz = F();
    // Wind at cell centres in cells per second, only for drawing (smoke-pass.js).
    this.u = F(); this.v = F(); this.w = F();
    this.dt = 0.05;
    this.time = 0;
    this.burnTime = burnTime;
    this.smagorinsky = smagorinsky;
    // Pressure sweeps per step. It was 40, and project() took about 60% of a
    // step. Each solve starts from last step's pressure, so 10 sweeps give the
    // same fire: on the 20 cm coupling run (all open, bedrooms shut, doors
    // switched mid-fire) every event within 0.4 s, zone pressures within 13 Pa,
    // soot per room within 3%, at under half the cost (55 -> 26 ms a step).
    // Not yet checked with a gas deflagration. See 进度/耦合/40cm.md.
    this.iterations = 10;
    this.overRelax = 1.8;
    this.sealBorder();
    this.updateTopology();
  }

  sealBorder() {
    const { nx, ny, nz, sy, sz, solid } = this;
    for (let k = 0; k <= nz + 1; k++) for (let j = 0; j <= ny + 1; j++) for (let i = 0; i <= nx + 1; i++) {
      if (i === 0 || j === 0 || k === 0 || i === nx + 1 || j === ny + 1 || k === nz + 1) solid[i + sy * j + sz * k] = 1;
    }
  }

  /** Rebuild the cell lists and which faces are open. Call after any cell turns solid or open (a door). */
  updateTopology() {
    const { nx, ny, nz, sy, sz, solid, size } = this;
    const fluid = [], fi = [], fj = [], fk = [];
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      const c = i + sy * j + sz * k;
      if (!solid[c]) { fluid.push(c); fi.push(i); fj.push(j); fk.push(k); }
    }
    this.fluid = Int32Array.from(fluid);
    this.fi = Int16Array.from(fi); this.fj = Int16Array.from(fj); this.fk = Int16Array.from(fk);
    // A face is open when there is air on both sides. Closed faces hold no
    // wind; anything in a cell that just turned solid is gone.
    this.openX = new Uint8Array(size); this.openY = new Uint8Array(size); this.openZ = new Uint8Array(size);
    for (let c = sz + sy + 1; c < size; c++) {
      if (solid[c]) continue;
      this.openX[c] = solid[c - 1] ? 0 : 1;
      this.openY[c] = solid[c - sy] ? 0 : 1;
      this.openZ[c] = solid[c - sz] ? 0 : 1;
    }
    for (let c = 0; c < size; c++) {
      if (!this.openX[c]) this.uf[c] = 0;
      if (!this.openY[c]) this.vf[c] = 0;
      if (!this.openZ[c]) this.wf[c] = 0;
      if (solid[c]) {
        this.temp[c] = this.dens[c] = this.fuel[c] = this.p[c] = 0;
        for (const x of this.extras) x.field[c] = 0;
      }
    }
    this.fx.fill(0); this.fy.fill(0); this.fz.fill(0);
    // Precompute per-fluid-cell 6-face openness mask and reciprocal count for branch-light SOR projection.
    const nf = this.fluid.length;
    this.div = new Float64Array(nf);
    this.pMask = new Uint8Array(nf);
    this.pInv = new Float64Array(nf);
    for (let n = 0; n < nf; n++) {
      const c = this.fluid[n];
      let m = 0, cnt = 0;
      if (this.openX[c]) { m |= 1; cnt++; }
      if (this.openX[c + 1]) { m |= 2; cnt++; }
      if (this.openY[c]) { m |= 4; cnt++; }
      if (this.openY[c + sy]) { m |= 8; cnt++; }
      if (this.openZ[c]) { m |= 16; cnt++; }
      if (this.openZ[c + sz]) { m |= 32; cnt++; }
      this.pMask[n] = m;
      this.pInv[n] = cnt ? 1 / cnt : 0;
    }
  }

  /**
   * Have the air carry one more thing, moved and mixed exactly as soot is, so
   * its total is kept and walls stop it. Returns its field: one value per
   * cell, in whatever unit the caller writes into it. Nothing else is done to
   * it here: what makes or removes it, and any buoyancy of its own, belong to
   * the module that added it.
   */
  addScalar(name) {
    if (this.scalars[name]) return this.scalars[name];
    const field = new Float32Array(this.size);
    this.extras.push({ name, field, scratch: new Float32Array(this.size) });
    this.scalars[name] = field;
    return field;
  }

  step() {
    const dt = this.dt;
    this.burn(dt);
    this.addBuoyancy(dt);
    this.advectVelocity(dt);
    if (this.smagorinsky > 0) { this.computeEddies(); this.mixVelocity(dt); }
    this.project();
    this.advectScalars(dt);
    if (this.smagorinsky > 0) {
      this.mixScalar(this.temp, this.temp0, dt);
      this.mixScalar(this.fuel, this.fuel0, dt);
      this.mixScalar(this.dens, this.dens0, dt);
      for (const x of this.extras) this.mixScalar(x.field, x.scratch, dt);
    }
    this.cellVelocities();
    this.time += dt;
  }

  /**
   * Fuel turns into heat over tau, but cannot heat gas past a flame's own
   * temperature (windy.js: without the cap the gas over a pool reached 3000
   * degrees above ambient). What cannot burn yet is carried along.
   */
  burn(dt) {
    const { fluid, fuel, temp } = this;
    const burned = 1 - Math.exp(-dt / this.burnTime);
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      if (fuel[c] <= 0) continue;
      const b = Math.min(fuel[c] * burned, Math.max(0, FLAME_DT - temp[c]));
      fuel[c] -= b;
      temp[c] += b;
    }
  }

  /** Hot gas rises at g dT / T0 (ideal gas, small density changes), on each open vertical face. */
  addBuoyancy(dt) {
    const { fluid, vf, openY, temp, sy } = this;
    const k = dt * G / T0 * 0.5;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      if (openY[c]) vf[c] += k * (temp[c] + temp[c - sy]);
    }
  }

  /** One face-velocity component at a point in cell coordinates; closed faces count as still. */
  sampleFace(f, x, y, z, ox, oy, oz) {
    const { sy, sz, nx, ny, nz } = this;
    x += ox; y += oy; z += oz;
    x = x < 0.5 ? 0.5 : x > nx + 1.5 ? nx + 1.5 : x;
    y = y < 0.5 ? 0.5 : y > ny + 1.5 ? ny + 1.5 : y;
    z = z < 0.5 ? 0.5 : z > nz + 1.5 ? nz + 1.5 : z;
    const i0 = x | 0, j0 = y | 0, k0 = z | 0;
    const s1 = x - i0, t1 = y - j0, r1 = z - k0, s0 = 1 - s1, t0 = 1 - t1, r0 = 1 - r1;
    const b = i0 + sy * j0 + sz * k0;
    return r0 * (t0 * (s0 * f[b] + s1 * f[b + 1]) + t1 * (s0 * f[b + sy] + s1 * f[b + sy + 1])) +
      r1 * (t0 * (s0 * f[b + sz] + s1 * f[b + sz + 1]) + t1 * (s0 * f[b + sz + sy] + s1 * f[b + sz + sy + 1]));
  }

  /**
   * The wind carries itself: each open face looks back along the wind at its
   * own position and takes the component found there. A trace longer than a
   * cell is cut to one, as in fluid3d.js, so it cannot reach past a wall.
   */
  advectVelocity(dt) {
    const { fluid, fi, fj, fk, sy, sz, uf, vf, wf, uf0, vf0, wf0, openX, openY, openZ } = this;
    uf0.set(uf); vf0.set(vf); wf0.set(wf);
    const s = dt / this.cell;   // m/s to cells per step
    for (let n = 0, len = fluid.length; n < len; n++) {
      const c = fluid[n], i = fi[n], j = fj[n], k = fk[n];
      if (openX[c]) {
        // On an x-face: v and w are the four nearest of their faces.
        const u = uf0[c];
        const v = 0.25 * (vf0[c] + vf0[c + sy] + vf0[c - 1] + vf0[c - 1 + sy]);
        const w = 0.25 * (wf0[c] + wf0[c + sz] + wf0[c - 1] + wf0[c - 1 + sz]);
        const dx = s * u, dy = s * v, dz = s * w;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = d2 > 1 ? 1 / Math.sqrt(d2) : 1;
        uf[c] = this.sampleFace(uf0, i - 0.5 - dx * f, j - dy * f, k - dz * f, 0.5, 0, 0);
      }
      if (openY[c]) {
        const v = vf0[c];
        const u = 0.25 * (uf0[c] + uf0[c + 1] + uf0[c - sy] + uf0[c - sy + 1]);
        const w = 0.25 * (wf0[c] + wf0[c + sz] + wf0[c - sy] + wf0[c - sy + sz]);
        const dx = s * u, dy = s * v, dz = s * w;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = d2 > 1 ? 1 / Math.sqrt(d2) : 1;
        vf[c] = this.sampleFace(vf0, i - dx * f, j - 0.5 - dy * f, k - dz * f, 0, 0.5, 0);
      }
      if (openZ[c]) {
        const w = wf0[c];
        const u = 0.25 * (uf0[c] + uf0[c + 1] + uf0[c - sz] + uf0[c - sz + 1]);
        const v = 0.25 * (vf0[c] + vf0[c + sy] + vf0[c - sz] + vf0[c - sz + sy]);
        const dx = s * u, dy = s * v, dz = s * w;
        const d2 = dx * dx + dy * dy + dz * dz;
        const f = d2 > 1 ? 1 / Math.sqrt(d2) : 1;
        wf[c] = this.sampleFace(wf0, i - dx * f, j - dy * f, k - 0.5 - dz * f, 0, 0, 0.5);
      }
    }
  }

  /**
   * No air is created or destroyed: find the pressure that makes what flows
   * out of every cell equal what flows in, and take its differences off the
   * face winds. phi here is pressure times dt / (rho * dx), in m/s.
   */
  project() {
    const { fluid, sy, sz, uf, vf, wf, p, openX, openY, openZ, div, pMask, pInv } = this;
    const omega = this.overRelax;
    const inv6 = 1 / 6;
    const nf = fluid.length;
    for (let n = 0; n < nf; n++) {
      const c = fluid[n];
      div[n] = -(uf[c + 1] - uf[c] + vf[c + sy] - vf[c] + wf[c + sz] - wf[c]);
    }
    // Gauss-Seidel on sum(p_n - p_c) = out, over-relaxed (SOR), starting
    // from last step's pressure: plain sweeps carry a correction only a
    // cell or two each, which on a house-sized grid never reached the
    // next room (fluid3d.js found the same).
    for (let it = 0; it < this.iterations; it++) {
      for (let n = 0; n < nf; n++) {
        const m = pMask[n];
        if (!m) continue;
        const c = fluid[n];
        if (m === 63) {
          const s = div[n] + p[c - 1] + p[c + 1] + p[c - sy] + p[c + sy] + p[c - sz] + p[c + sz];
          p[c] += omega * (s * inv6 - p[c]);
        } else {
          let s = div[n];
          if (m & 1) s += p[c - 1];
          if (m & 2) s += p[c + 1];
          if (m & 4) s += p[c - sy];
          if (m & 8) s += p[c + sy];
          if (m & 16) s += p[c - sz];
          if (m & 32) s += p[c + sz];
          p[c] += omega * (s * pInv[n] - p[c]);
        }
      }
    }
    for (let n = 0; n < nf; n++) {
      const c = fluid[n];
      if (openX[c]) uf[c] -= p[c] - p[c - 1];
      if (openY[c]) vf[c] -= p[c] - p[c - sy];
      if (openZ[c]) wf[c] -= p[c] - p[c - sz];
    }
  }

  /**
   * Heat, soot and fuel move by what flows through each face. What leaves a
   * cell arrives next door, so totals are kept exactly. Moving more than a
   * cell's worth in one go would overshoot, so the step is split when the
   * wind is fast.
   *
   * The value carried through a face: taking simply the cell the air comes
   * from (first-order upwind) smeared the plume sideways so much that 1.3 to
   * 1.7 m over a 150 kW fire it was 40-60% of Heskestad's centreline
   * temperature and rose a quarter too slowly. Now it leans towards the cell
   * downwind by a van Leer-limited amount (a TVD scheme): sharp where the
   * field is smooth, first order at a peak or a wall, so it adds no new
   * highs or lows in one direction.
   */
  advectScalars(dt) {
    const { fluid, sy, sz, uf, vf, wf, openX, openY, openZ, fx, fy, fz } = this;
    const dx = this.cell;
    let worst = 0;
    for (let n = 0, len = fluid.length; n < len; n++) {
      const c = fluid[n];
      const out = Math.max(0, uf[c + 1]) - Math.min(0, uf[c]) + Math.max(0, vf[c + sy]) - Math.min(0, vf[c])
        + Math.max(0, wf[c + sz]) - Math.min(0, wf[c]);
      if (out > worst) worst = out;
    }
    const parts = Math.max(1, Math.ceil(worst * dt / dx / 0.9));
    const h = dt / parts / dx;
    this.substeps = parts;
    const fields = [this.temp, this.dens, this.fuel];
    for (let e = 0; e < this.extras.length; e++) fields.push(this.extras[e].field);
    for (let fi = 0; fi < fields.length; fi++) {
      const q = fields[fi];
      if (!hasNonZero(q, fluid)) continue;
      for (let part = 0; part < parts; part++) {
        for (let n = 0, len = fluid.length; n < len; n++) {
          const c = fluid[n];
          fx[c] = faceFlux(q, c, 1, uf[c], openX, h);
          fy[c] = faceFlux(q, c, sy, vf[c], openY, h);
          fz[c] = faceFlux(q, c, sz, wf[c], openZ, h);
        }
        // Closed faces remain 0 because updateTopology() zeroes fx/fy/fz and loop 1 writes 0 when !open*.
        for (let n = 0, len = fluid.length; n < len; n++) {
          const c = fluid[n];
          q[c] -= h * (fx[c + 1] - fx[c] + fy[c + sy] - fy[c] + fz[c + sz] - fz[c]);
        }
      }
    }
  }

  /** Wind at cell centres, in cells per second: for the eddies and for drawing. */
  cellVelocities() {
    const { fluid, sy, sz, uf, vf, wf, u, v, w } = this;
    const k = 0.5 / this.cell;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      u[c] = k * (uf[c] + uf[c + 1]);
      v[c] = k * (vf[c] + vf[c + sy]);
      w[c] = k * (wf[c] + wf[c + sz]);
    }
  }

  /**
   * Eddies smaller than a cell still stir the air (Smagorinsky, as windy.js;
   * without them a plume stayed a clean column, far too hot). Eddy viscosity
   * in cells^2 per second, capped where explicit mixing stays stable.
   */
  computeEddies() {
    this.cellVelocities();
    const { fluid, sy, sz, u, v, w, eddy, dt } = this;
    const cs2 = this.smagorinsky ** 2;
    const limit = 0.15 / (dt * TURBULENT_MIXING);
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const ux = 0.5 * (u[c + 1] - u[c - 1]), uy = 0.5 * (u[c + sy] - u[c - sy]), uz = 0.5 * (u[c + sz] - u[c - sz]);
      const vx = 0.5 * (v[c + 1] - v[c - 1]), vy = 0.5 * (v[c + sy] - v[c - sy]), vz = 0.5 * (v[c + sz] - v[c - sz]);
      const wx = 0.5 * (w[c + 1] - w[c - 1]), wy = 0.5 * (w[c + sy] - w[c - sy]), wz = 0.5 * (w[c + sz] - w[c - sz]);
      const s2 = 2 * (ux * ux + vy * vy + wz * wz) + (uy + vx) ** 2 + (uz + wx) ** 2 + (vz + wy) ** 2;
      eddy[c] = Math.min(cs2 * Math.sqrt(s2), limit);
    }
  }

  /** Spread one face-velocity component among its open neighbours without temporary offset arrays. */
  mixFace(f, scratch, open, across, k) {
    const { fluid, sy, sz, eddy } = this;
    scratch.set(f);
    for (let n = 0, len = fluid.length; n < len; n++) {
      const c = fluid[n];
      if (!open[c]) continue;
      const e = 0.5 * (eddy[c] + eddy[c - across]);
      const here = scratch[c];
      let change = 0;
      let m = c + 1;  if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      m = c - 1;      if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      m = c + sy;     if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      m = c - sy;     if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      m = c + sz;     if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      m = c - sz;     if (open[m]) change += (e + 0.5 * (eddy[m] + eddy[m - across])) * (scratch[m] - here);
      f[c] = here + k * change;
    }
  }

  /** Spread each face wind among its open neighbours of the same direction. */
  mixVelocity(dt) {
    const k = 0.5 * dt;
    this.mixFace(this.uf, this.uf0, this.openX, 1, k);
    this.mixFace(this.vf, this.vf0, this.openY, this.sy, k);
    this.mixFace(this.wf, this.wf0, this.openZ, this.sz, k);
  }

  /** Spread a scalar by the eddies, only across open faces, so nothing crosses a wall and totals are kept. */
  mixScalar(x, scratch, dt) {
    const { fluid, sy, sz, eddy, openX, openY, openZ } = this;
    if (!hasNonZero(x, fluid)) return;
    scratch.set(x);
    const k = 0.5 * dt * TURBULENT_MIXING;
    // Each face is counted once, from its high side, and moves the same amount
    // out of one cell as into the other.
    for (let n = 0, len = fluid.length; n < len; n++) {
      const c = fluid[n], e = eddy[c], here = scratch[c];
      if (openX[c]) { const m = c - 1, dm = scratch[m] - here; if (dm !== 0) { const d = k * (e + eddy[m]) * dm; x[c] += d; x[m] -= d; } }
      if (openY[c]) { const m = c - sy, dm = scratch[m] - here; if (dm !== 0) { const d = k * (e + eddy[m]) * dm; x[c] += d; x[m] -= d; } }
      if (openZ[c]) { const m = c - sz, dm = scratch[m] - here; if (dm !== 0) { const d = k * (e + eddy[m]) * dm; x[c] += d; x[m] -= d; } }
    }
  }

  reset() {
    for (const a of [this.uf, this.vf, this.wf, this.uf0, this.vf0, this.wf0, this.temp, this.temp0, this.dens, this.dens0,
      this.fuel, this.fuel0, this.p, this.eddy, this.u, this.v, this.w, ...this.extras.map((x) => x.field)]) a.fill(0);
    this.time = 0;
  }

  /** How far the face winds are from keeping air: the largest net outflow of a cell, in m/s. */
  leftoverDivergence() {
    const { fluid, sy, sz, uf, vf, wf } = this;
    let worst = 0, total = 0;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const out = Math.abs(uf[c + 1] - uf[c] + vf[c + sy] - vf[c] + wf[c + sz] - wf[c]);
      worst = Math.max(worst, out); total += out;
    }
    return { worst, mean: total / fluid.length };
  }
}
