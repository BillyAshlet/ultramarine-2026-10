// Stam's "Stable Fluids" in three dimensions, with the two additions from
// Fedkiw, Stam & Jensen (2001) that smoke from a fire needs: a temperature
// field that makes hot air rise, and vorticity confinement so the swirls are
// not smeared away by the solver itself.
//
// Same steps as the 2D demo in ../fluid, one more axis. Each cell holds wind
// (u, v, w), smoke and temperature. Units are grid units: lengths in cells,
// speeds in cells per second. Diffusion and viscosity are left out: at room
// scale they are tiny next to being carried by the wind, and leaving them
// out saves two of the most expensive passes.
//
// Grid layout: index = i + W*j + W*H*k, with a one-cell solid border, so
// every fluid cell's six neighbours exist and need no bounds checks.

export class Fluid3D {
  constructor(nx, ny, nz, solid) {
    this.nx = nx; this.ny = ny; this.nz = nz;
    this.W = nx + 2; this.H = ny + 2; this.D = nz + 2;
    this.sy = this.W; this.sz = this.W * this.H;
    this.size = this.sz * this.D;
    const F = () => new Float32Array(this.size);
    this.u = F(); this.v = F(); this.w = F();
    this.u0 = F(); this.v0 = F(); this.w0 = F();
    this.dens = F(); this.dens0 = F();
    this.temp = F(); this.temp0 = F();
    this.p = F(); this.div = F();
    this.wx = F(); this.wy = F(); this.wz = F(); this.wm = F();
    this.solid = solid;
    this.sources = [];      // [{cells: Int32Array, smoke, heat}]

    this.dt = 0.1;
    this.buoyancy = 8;      // cells/s^2 of lift per unit of temperature
    this.cooling = 0.01;    // fraction of heat lost per second
    this.vorticity = 1.0;
    this.iterations = 20;   // Gauss-Seidel sweeps for the pressure solve
    this.overRelax = 1.7;   // SOR factor; 1 is the paper's plain Gauss-Seidel

    this.sealBorder();
    this.updateTopology();
  }

  sealBorder() {
    const { nx, ny, nz, sy, sz, solid } = this;
    for (let k = 0; k <= nz + 1; k++) for (let j = 0; j <= ny + 1; j++) for (let i = 0; i <= nx + 1; i++) {
      if (i === 0 || j === 0 || k === 0 || i === nx + 1 || j === ny + 1 || k === nz + 1) solid[i + sy * j + sz * k] = 1;
    }
  }

  /** Rebuild the lists of fluid cells. Call after any cell turns solid or open (a door). */
  updateTopology() {
    const { nx, ny, nz, sy, sz, solid } = this;
    const fluid = [], fi = [], fj = [], fk = [];
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      const c = i + sy * j + sz * k;
      if (!solid[c]) { fluid.push(c); fi.push(i); fj.push(j); fk.push(k); }
    }
    this.fluid = Int32Array.from(fluid);
    this.fi = Int16Array.from(fi); this.fj = Int16Array.from(fj); this.fk = Int16Array.from(fk);

    // Solid cells that touch air, and which air cells they touch: smoke and
    // heat are copied into these so lookups next to a wall read sensible
    // values instead of zero.
    const border = [], start = [0], nbs = [];
    const offsets = [-1, 1, -sy, sy, -sz, sz];
    for (let k = 0; k <= nz + 1; k++) for (let j = 0; j <= ny + 1; j++) for (let i = 0; i <= nx + 1; i++) {
      const c = i + sy * j + sz * k;
      if (!solid[c]) continue;
      const before = nbs.length;
      const coords = [[i - 1, j, k], [i + 1, j, k], [i, j - 1, k], [i, j + 1, k], [i, j, k - 1], [i, j, k + 1]];
      for (let n = 0; n < 6; n++) {
        const [a, b, d] = coords[n];
        if (a < 0 || b < 0 || d < 0 || a > nx + 1 || b > ny + 1 || d > nz + 1) continue;
        if (!solid[c + offsets[n]]) nbs.push(c + offsets[n]);
      }
      if (nbs.length > before) { border.push(c); start.push(nbs.length); }
      // Anything that just turned solid stops moving and holds nothing.
      this.u[c] = this.v[c] = this.w[c] = 0;
    }
    this.border = Int32Array.from(border);
    this.borderStart = Int32Array.from(start);
    this.borderNbs = Int32Array.from(nbs);
  }

  fillBorder(x) {
    const { border, borderStart, borderNbs } = this;
    for (let b = 0; b < border.length; b++) {
      let s = 0;
      const a = borderStart[b], e = borderStart[b + 1];
      for (let n = a; n < e; n++) s += x[borderNbs[n]];
      x[border[b]] = s / (e - a);
    }
  }

  // advect: stand at each cell, trace one step back along the wind, and take
  // what was there (trilinear lookup). The "-(u . nabla)" term.
  //
  // Walls and floors here are often a single cell thick. Two things leaked
  // smoke straight through them, so both are guarded:
  //  - a trace longer than one cell can jump a whole wall, so it is capped;
  //  - for smoke and heat, wall corners are left out of the lookup and the
  //    rest re-weighted, so a wall never passes on what is on its far side.
  advect(d, d0, uu, vv, ww, scalar) {
    const { fluid, fi, fj, fk, sy, sz, nx, ny, nz, dt, solid } = this;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      let dx = dt * uu[c], dy = dt * vv[c], dz = dt * ww[c];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > 1) { dx /= len; dy /= len; dz /= len; }
      let x = fi[n] - dx, y = fj[n] - dy, z = fk[n] - dz;
      x = x < 0.5 ? 0.5 : x > nx + 0.5 ? nx + 0.5 : x;
      y = y < 0.5 ? 0.5 : y > ny + 0.5 ? ny + 0.5 : y;
      z = z < 0.5 ? 0.5 : z > nz + 0.5 ? nz + 0.5 : z;
      const i0 = x | 0, j0 = y | 0, k0 = z | 0;
      const s1 = x - i0, t1 = y - j0, r1 = z - k0, s0 = 1 - s1, t0 = 1 - t1, r0 = 1 - r1;
      const b = i0 + sy * j0 + sz * k0;
      if (!scalar) {
        d[c] =
          r0 * (t0 * (s0 * d0[b] + s1 * d0[b + 1]) + t1 * (s0 * d0[b + sy] + s1 * d0[b + sy + 1])) +
          r1 * (t0 * (s0 * d0[b + sz] + s1 * d0[b + sz + 1]) + t1 * (s0 * d0[b + sz + sy] + s1 * d0[b + sz + sy + 1]));
        continue;
      }
      let sum = 0, weight = 0, wgt, q;
      q = b;                wgt = r0 * t0 * s0; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + 1;            wgt = r0 * t0 * s1; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sy;           wgt = r0 * t1 * s0; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sy + 1;       wgt = r0 * t1 * s1; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sz;           wgt = r1 * t0 * s0; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sz + 1;       wgt = r1 * t0 * s1; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sz + sy;      wgt = r1 * t1 * s0; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      q = b + sz + sy + 1;  wgt = r1 * t1 * s1; if (!solid[q]) { sum += wgt * d0[q]; weight += wgt; }
      d[c] = weight > 1e-6 ? sum / weight : d0[c];
    }
  }

  // No wind into a wall. On this collocated grid the pressure solve alone
  // left the plume still rising at full speed right under the ceiling, so it
  // never turned to spread sideways. Zeroing the part of the wind that points
  // into a neighbouring wall makes the ceiling a ceiling.
  blockWalls() {
    const { fluid, solid, sy, sz, u, v, w } = this;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      if ((u[c] < 0 && solid[c - 1]) || (u[c] > 0 && solid[c + 1])) u[c] = 0;
      if ((v[c] < 0 && solid[c - sy]) || (v[c] > 0 && solid[c + sy])) v[c] = 0;
      if ((w[c] < 0 && solid[c - sz]) || (w[c] > 0 && solid[c + sz])) w[c] = 0;
    }
  }

  // project: air cannot be squeezed. Find the pressure that explains how
  // much each cell is gaining or losing, and take its slope off the wind.
  // A wall counts as having the same pressure as the cell beside it, so no
  // flow is pushed into it.
  project() {
    const { fluid, solid, sy, sz, u, v, w, p, div } = this;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      div[c] = -0.5 * (u[c + 1] - u[c - 1] + v[c + sy] - v[c - sy] + w[c + sz] - w[c - sz]);
    }
    // Plain Gauss-Seidel (the paper's solver) only carries information a cell
    // or two per sweep. On a house-sized 3D grid 20 sweeps never reached the
    // next room: air piled up at the fire instead of pushing smoke onward.
    // Two cheap fixes: start from last step's pressure instead of zero, and
    // over-relax each update (SOR), which spreads corrections much faster.
    const omega = this.overRelax;
    for (let it = 0; it < this.iterations; it++) {
      for (let n = 0; n < fluid.length; n++) {
        const c = fluid[n];
        let s = div[c], count = 0;
        if (!solid[c - 1]) { s += p[c - 1]; count++; }
        if (!solid[c + 1]) { s += p[c + 1]; count++; }
        if (!solid[c - sy]) { s += p[c - sy]; count++; }
        if (!solid[c + sy]) { s += p[c + sy]; count++; }
        if (!solid[c - sz]) { s += p[c - sz]; count++; }
        if (!solid[c + sz]) { s += p[c + sz]; count++; }
        if (count) p[c] += omega * (s / count - p[c]);
      }
    }
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n], pc = p[c];
      const pl = solid[c - 1] ? pc : p[c - 1], pr = solid[c + 1] ? pc : p[c + 1];
      const pd = solid[c - sy] ? pc : p[c - sy], pu = solid[c + sy] ? pc : p[c + sy];
      const pb = solid[c - sz] ? pc : p[c - sz], pf = solid[c + sz] ? pc : p[c + sz];
      u[c] -= 0.5 * (pr - pl);
      v[c] -= 0.5 * (pu - pd);
      w[c] -= 0.5 * (pf - pb);
    }
  }

  confineVorticity() {
    const { fluid, sy, sz, u, v, w, wx, wy, wz, wm, dt } = this;
    const eps = this.vorticity;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const x = 0.5 * ((w[c + sy] - w[c - sy]) - (v[c + sz] - v[c - sz]));
      const y = 0.5 * ((u[c + sz] - u[c - sz]) - (w[c + 1] - w[c - 1]));
      const z = 0.5 * ((v[c + 1] - v[c - 1]) - (u[c + sy] - u[c - sy]));
      wx[c] = x; wy[c] = y; wz[c] = z; wm[c] = Math.sqrt(x * x + y * y + z * z);
    }
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      let gx = 0.5 * (wm[c + 1] - wm[c - 1]), gy = 0.5 * (wm[c + sy] - wm[c - sy]), gz = 0.5 * (wm[c + sz] - wm[c - sz]);
      const len = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-5;
      gx /= len; gy /= len; gz /= len;
      // Push sideways around the spinning spot: N x omega.
      u[c] += dt * eps * (gy * wz[c] - gz * wy[c]);
      v[c] += dt * eps * (gz * wx[c] - gx * wz[c]);
      w[c] += dt * eps * (gx * wy[c] - gy * wx[c]);
    }
  }

  step() {
    const { fluid, dens, temp, v, dt } = this;

    // Sources: fires keep adding smoke and heat.
    for (const s of this.sources) {
      for (const c of s.cells) {
        dens[c] = Math.min(dens[c] + dt * s.smoke, 1.5);
        temp[c] = Math.min(temp[c] + dt * s.heat, 1.2);
      }
    }
    // Buoyancy: hot air is lighter than the air around it.
    for (let n = 0; n < fluid.length; n++) { const c = fluid[n]; v[c] += dt * this.buoyancy * temp[c]; }
    if (this.vorticity > 0) this.confineVorticity();

    // Velocity: make it incompressible, let it carry itself, make it incompressible again.
    this.project(); this.blockWalls();
    this.u0.set(this.u); this.v0.set(this.v); this.w0.set(this.w);
    this.advect(this.u, this.u0, this.u0, this.v0, this.w0, false);
    this.advect(this.v, this.v0, this.u0, this.v0, this.w0, false);
    this.advect(this.w, this.w0, this.u0, this.v0, this.w0, false);
    this.project(); this.blockWalls();

    // Smoke and heat ride the same wind.
    this.dens0.set(this.dens); this.advect(this.dens, this.dens0, this.u, this.v, this.w, true);
    this.temp0.set(this.temp); this.advect(this.temp, this.temp0, this.u, this.v, this.w, true);
    // Walls take the average of the air beside them, only so the 3D texture
    // shows smooth edges; the lookup above never reads them.
    this.fillBorder(this.dens); this.fillBorder(this.temp);

    // Heat leaks away; smoke stays. Cooled smoke stops rising.
    const keep = Math.exp(-this.cooling * dt);
    for (let n = 0; n < fluid.length; n++) temp[fluid[n]] *= keep;
  }

  reset() {
    for (const a of [this.u, this.v, this.w, this.u0, this.v0, this.w0, this.dens, this.dens0, this.temp, this.temp0, this.p]) a.fill(0);
  }

  /** Wind at a point given in grid coordinates (cell centres at integers). */
  sampleVelocity(x, y, z, out) {
    const { sy, sz, nx, ny, nz, u, v, w } = this;
    x = Math.min(Math.max(x, 0.5), nx + 0.5);
    y = Math.min(Math.max(y, 0.5), ny + 0.5);
    z = Math.min(Math.max(z, 0.5), nz + 0.5);
    const i0 = x | 0, j0 = y | 0, k0 = z | 0;
    const s1 = x - i0, t1 = y - j0, r1 = z - k0, s0 = 1 - s1, t0 = 1 - t1, r0 = 1 - r1;
    const b = i0 + sy * j0 + sz * k0;
    const lerp = (f) =>
      r0 * (t0 * (s0 * f[b] + s1 * f[b + 1]) + t1 * (s0 * f[b + sy] + s1 * f[b + sy + 1])) +
      r1 * (t0 * (s0 * f[b + sz] + s1 * f[b + sz + 1]) + t1 * (s0 * f[b + sz + sy] + s1 * f[b + sz + sy + 1]));
    out[0] = lerp(u); out[1] = lerp(v); out[2] = lerp(w);
    return out;
  }
}
