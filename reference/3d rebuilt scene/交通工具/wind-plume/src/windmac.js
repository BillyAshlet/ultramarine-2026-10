// The Duplex's heat-keeping solver (src/mac3d.js), opened up to the wind, for
// the same question as windy.js: at what wind does a pool fire beside a
// fuselage start leaning onto it?
//
// Why it replaces windy.js + fluid3d.js. In the Duplex we found fluid3d.js
// makes heat: after the pressure solve it zeroes any wind pointing into a wall
// (blockWalls), and its look-back advection then copies hot gas into the
// squeezed cells again and again. A sealed house held 315% of the heat its
// fire had made. Here it does the same against the ground: in still air the
// old solver carried 63 MW up through every plane above the pool, against the
// 26.6 MW the fire releases after radiation, and the domain plus what had left
// it held 235% of the heat released after 30 s (140% with a 3 m/s wind; see
// budget-log.txt). That is enough to explain why the old still plume was
// 50-70% too hot above the flame against Heskestad.
//
// mac3d.js is an unchanged copy of ../../室内建筑/duplex-fire/src/mac3d.js: wind
// on cell faces, heat and fuel moved face by face with a van Leer limiter, so
// what leaves a cell arrives next door. It models a sealed house; this file
// adds what windy.js added to fluid3d.js:
//  - open boundaries: the four sides and the top let air through and hold no
//    pressure (as windy.js), and the ground stays solid;
//  - wind: faces on the upwind sides are reset to the wind before each
//    pressure solve, and the pressure solve then lets the fire draw extra air
//    through them, as it can through every other open side;
//  - the pool, adding fuel at the ground as windy.js did, with the same uneven
//    spread and the same random numbers.
// Heat leaves only by being carried out across an open face, and the solver
// counts it (heatOut), so the budget can be checked exactly.
//
// The boundaries, in the grid: the cells just outside the four sides and the
// top ("ghost" cells) are not solid, but they are not in the fluid list, so
// their pressure stays zero. The face between a ghost and the domain is real:
// on the low sides it belongs to the first fluid cell (as every low face does),
// on the high sides to the ghost. The ghosts' other faces only feed the
// look-back of the wind and the limiter, and are set each step: the wind on an
// upwind side, a copy of the cell inside elsewhere. Ambient air coming in
// carries no heat; gas going out carries what the cell inside holds.
//
// Smoke (dens) is not carried: nothing in this experiment reads it.
import { MacFire } from './mac3d.js';

const RHO = 1.2;   // kg/m3, ambient air
const CP = 1005;   // J/kg K

export class WindyMacFire extends MacFire {
  /**
   * @param {object} o  as WindyFire in windy.js
   * @param {{x:number, z:number}} o.wind  m/s
   */
  constructor({ nx, ny, nz, cell, solid, wind, pool, heatRelease, radiantFraction, burnTime, smagorinsky = 0.2 }) {
    super({ nx, ny, nz, cell, solid, burnTime, smagorinsky });
    this.wind = wind;
    this.pool = pool;
    this.seed = 12345;
    // Fuel is counted in the degrees it will give the air it is in when it burns.
    this.fuelRate = heatRelease * (1 - radiantFraction) / (RHO * CP * pool.length * cell ** 3);
    this.heatOut = 0;   // kelvin-cells carried out across the open faces, heat and fuel together
    this.openBoundaries();
    const { uf, wf, openX, openZ, size } = this;
    for (let c = 0; c < size; c++) {
      if (openX[c]) uf[c] = wind.x;
      if (openZ[c]) wf[c] = wind.z;
    }
    this.setGhostVelocities();
  }

  /** The four sides and the top open; the ground stays solid. */
  openBoundaries() {
    const { nx, ny, nz, sy, sz, solid } = this;
    // axis 0 = x, 1 = y, 2 = z; sign is the outward direction along it.
    const g = [], inner = [], axis = [], sign = [];
    const add = (i, j, k, ni, nj, nk, a, s) => {
      const c = i + sy * j + sz * k;
      solid[c] = 0;
      g.push(c); inner.push(ni + sy * nj + sz * nk); axis.push(a); sign.push(s);
    };
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      add(0, j, k, 1, j, k, 0, -1);
      add(nx + 1, j, k, nx, j, k, 0, 1);
    }
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      add(i, j, 0, i, j, 1, 2, -1);
      add(i, j, nz + 1, i, j, nz, 2, 1);
    }
    for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) add(i, ny + 1, k, i, ny, k, 1, 1);
    this.ghost = Int32Array.from(g);
    this.ghostIn = Int32Array.from(inner);
    this.ghostAxis = Uint8Array.from(axis);
    this.ghostSign = Int8Array.from(sign);
    // The boundary face of each ghost: on a low side the inner cell's own low
    // face, on a high side the ghost's low face.
    const step = [1, sy, sz];
    this.ghostFace = Int32Array.from(g.map((c, n) => (sign[n] < 0 ? inner[n] : c)));
    // The face one cell further in, for copying the wind outwards.
    this.ghostNext = Int32Array.from(g.map((c, n) => (sign[n] < 0 ? inner[n] + step[axis[n]] : inner[n])));
    this.updateTopology();
  }

  /**
   * As mac3d.js, then the ghosts' faces are closed except each high ghost's
   * boundary face: their pressure never changes, and the mixing and the
   * limiter must not reach past them.
   */
  updateTopology() {
    super.updateTopology();
    if (!this.ghost) return;   // first call, from MacFire's constructor
    const { ghost, ghostAxis, ghostSign, openX, openY, openZ } = this;
    for (let n = 0; n < ghost.length; n++) {
      const c = ghost[n];
      openX[c] = openY[c] = openZ[c] = 0;
      if (ghostSign[n] > 0) [openX, openY, openZ][ghostAxis[n]][c] = 1;
    }
  }

  /** The wind component along a ghost's outward normal, m/s. */
  windOut(n) {
    const a = this.ghostAxis[n];
    return this.ghostSign[n] * (a === 0 ? this.wind.x : a === 2 ? this.wind.z : 0);
  }

  /**
   * The ghosts' faces other than the boundary face: the wind itself on an
   * upwind side, a copy of the cell inside elsewhere. They are read only by the
   * look-back of the wind.
   */
  setGhostVelocities() {
    const { ghost, ghostIn, ghostFace, uf, vf, wf, wind } = this;
    for (let n = 0; n < ghost.length; n++) {
      const c = ghost[n], i = ghostIn[n], keep = ghostFace[n] === c ? this.ghostAxis[n] : -1;
      const upwind = this.windOut(n) < 0;
      if (keep !== 0) uf[c] = upwind ? wind.x : uf[i];
      if (keep !== 1) vf[c] = upwind ? 0 : vf[i];
      if (keep !== 2) wf[c] = upwind ? wind.z : wf[i];
    }
  }

  /**
   * Before the pressure solve: the boundary faces on upwind sides carry the
   * wind, elsewhere the face takes the wind one face further in. The pressure
   * solve then adjusts all of them, so the fire can draw air in or push it out
   * anywhere.
   */
  setBoundaryFaces() {
    const { ghost, ghostAxis, ghostSign, ghostFace, ghostNext } = this;
    const faces = [this.uf, this.vf, this.wf];
    for (let n = 0; n < ghost.length; n++) {
      const f = faces[ghostAxis[n]], out = this.windOut(n);
      f[ghostFace[n]] = out < 0 ? out * ghostSign[n] : f[ghostNext[n]];
    }
  }

  /**
   * As mac3d.js, but the look-back may reach the ghosts' faces and no further.
   * mac3d.js lets it go half a cell past the border, which in a sealed house
   * only ever reads closed faces; here, at the top corner of the grid, that
   * read past the end of the arrays.
   */
  sampleFace(f, x, y, z, ox, oy, oz) {
    const { sy, sz, nx, ny, nz } = this;
    const edge = 1 - 1e-4;
    x += ox; y += oy; z += oz;
    x = x < 0 ? 0 : x > nx + edge ? nx + edge : x;
    y = y < 0.5 ? 0.5 : y > ny + edge ? ny + edge : y;
    z = z < 0 ? 0 : z > nz + edge ? nz + edge : z;
    const i0 = x | 0, j0 = y | 0, k0 = z | 0;
    const s1 = x - i0, t1 = y - j0, r1 = z - k0, s0 = 1 - s1, t0 = 1 - t1, r0 = 1 - r1;
    const b = i0 + sy * j0 + sz * k0;
    return r0 * (t0 * (s0 * f[b] + s1 * f[b + 1]) + t1 * (s0 * f[b + sy] + s1 * f[b + sy + 1])) +
      r1 * (t0 * (s0 * f[b + sz] + s1 * f[b + sz + 1]) + t1 * (s0 * f[b + sz + sy] + s1 * f[b + sz + sy + 1]));
  }

  /** mac3d.js's solve, then the high boundary faces, which belong to ghosts and so are not in its loop. */
  project() {
    super.project();
    const { ghost, ghostIn, ghostFace, ghostSign, ghostAxis, p } = this;
    const faces = [this.uf, this.vf, this.wf];
    for (let n = 0; n < ghost.length; n++) {
      if (ghostSign[n] > 0) faces[ghostAxis[n]][ghostFace[n]] -= p[ghost[n]] - p[ghostIn[n]];
    }
  }

  /** As mac3d.js, plus the ghosts copying the cell inside, so the eddies see no false shear at the boundary. */
  cellVelocities() {
    super.cellVelocities();
    const { ghost, ghostIn, u, v, w } = this;
    for (let n = 0; n < ghost.length; n++) {
      const c = ghost[n], i = ghostIn[n];
      u[c] = u[i]; v[c] = v[i]; w[c] = w[i];
    }
  }

  /** Outward wind through each ghost's boundary face, m/s. */
  outward(n) {
    return this.ghostSign[n] * [this.uf, this.vf, this.wf][this.ghostAxis[n]][this.ghostFace[n]];
  }

  /** Ghost values of a scalar: what is inside where gas leaves, ambient (zero) where air comes in. */
  ghostScalar(q, alwaysCopy) {
    const { ghost, ghostIn } = this;
    for (let n = 0; n < ghost.length; n++) q[ghost[n]] = alwaysCopy || this.outward(n) > 0 ? q[ghostIn[n]] : 0;
  }

  step() {
    const { fuel, pool, dt } = this;
    // A slightly uneven pool, as windy.js: a perfectly even one on a square
    // grid stays symmetrical and takes far longer to start turning over.
    for (const c of pool) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      fuel[c] += dt * this.fuelRate * (0.6 + 0.8 * this.seed / 0x7fffffff);
    }
    this.setGhostVelocities();
    this.burn(dt);
    this.addBuoyancy(dt);
    this.advectVelocity(dt);
    if (this.smagorinsky > 0) { this.computeEddies(); this.mixVelocity(dt); }
    this.setGhostVelocities();
    this.setBoundaryFaces();
    this.project();
    this.advectScalars(dt);
    if (this.smagorinsky > 0) {
      // A ghost equal to the cell inside: no heat is mixed out across a boundary.
      this.ghostScalar(this.temp, true); this.mixScalar(this.temp, this.temp0, dt);
      this.ghostScalar(this.fuel, true); this.mixScalar(this.fuel, this.fuel0, dt);
    }
    this.cellVelocities();
    this.time += dt;
  }

  /**
   * mac3d.js's face-by-face transport with the same van Leer limiter, for heat
   * and fuel only, with the high boundary faces added (they belong to ghosts,
   * which its loop does not visit) and what crosses the boundary counted.
   */
  advectScalars(dt) {
    const { fluid, sy, sz, uf, vf, wf, openX, openY, openZ, fx, fy, fz, ghost, ghostIn, ghostAxis, ghostSign, ghostFace } = this;
    const dx = this.cell;
    let worst = 0;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const out = Math.max(0, uf[c + 1]) - Math.min(0, uf[c]) + Math.max(0, vf[c + sy]) - Math.min(0, vf[c])
        + Math.max(0, wf[c + sz]) - Math.min(0, wf[c]);
      if (out > worst) worst = out;
    }
    const parts = Math.max(1, Math.ceil(worst * dt / dx / 0.9));
    const h = dt / parts / dx;
    this.substeps = parts;
    const faceValue = (q, a, b, aa, cfl) => {
      const qa = q[a], jump = q[b] - qa;
      if (aa < 0 || jump === 0) return qa;
      const r = (qa - q[aa]) / jump;
      const limiter = r > 0 ? 2 * r / (1 + r) : 0;   // van Leer
      return qa + 0.5 * limiter * (1 - cfl) * jump;
    };
    const fluxes = [fx, fy, fz], steps = [1, sy, sz], opens = [openX, openY, openZ], faces = [uf, vf, wf];
    let out = 0;
    for (const q of [this.temp, this.fuel]) {
      for (let part = 0; part < parts; part++) {
        this.ghostScalar(q, false);
        for (let n = 0; n < fluid.length; n++) {
          const c = fluid[n];
          const u = uf[c], v = vf[c], w = wf[c];
          fx[c] = !openX[c] ? 0 : u > 0
            ? u * faceValue(q, c - 1, c, openX[c - 1] ? c - 2 : -1, u * h)
            : u * faceValue(q, c, c - 1, openX[c + 1] ? c + 1 : -1, -u * h);
          fy[c] = !openY[c] ? 0 : v > 0
            ? v * faceValue(q, c - sy, c, openY[c - sy] ? c - 2 * sy : -1, v * h)
            : v * faceValue(q, c, c - sy, openY[c + sy] ? c + sy : -1, -v * h);
          fz[c] = !openZ[c] ? 0 : w > 0
            ? w * faceValue(q, c - sz, c, openZ[c - sz] ? c - 2 * sz : -1, w * h)
            : w * faceValue(q, c, c - sz, openZ[c + sz] ? c + sz : -1, -w * h);
        }
        // High boundary faces: the ghost is downwind when gas leaves, and holds
        // nothing when air comes in.
        for (let n = 0; n < ghost.length; n++) {
          if (ghostSign[n] < 0) continue;
          const a = ghostAxis[n], g = ghost[n], i = ghostIn[n], s = steps[a], f = faces[a][g];
          fluxes[a][g] = f > 0 ? f * faceValue(q, i, g, opens[a][i] ? i - s : -1, f * h) : f * q[g];
        }
        for (let n = 0; n < fluid.length; n++) {
          const c = fluid[n];
          const fxh = openX[c + 1] ? fx[c + 1] : 0, fyh = openY[c + sy] ? fy[c + sy] : 0, fzh = openZ[c + sz] ? fz[c + sz] : 0;
          q[c] -= h * (fxh - fx[c] + fyh - fy[c] + fzh - fz[c]);
        }
        for (let n = 0; n < ghost.length; n++) out += h * ghostSign[n] * fluxes[ghostAxis[n]][ghostFace[n]];
      }
    }
    this.heatOut += out;
  }
}
