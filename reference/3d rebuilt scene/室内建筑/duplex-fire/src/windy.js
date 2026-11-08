// The solver in src/fluid3d.js, opened up and put into real units, to ask one
// question about the 1985 Manchester fire: at what wind does a pool fire beside
// a fuselage start leaning onto it?
//
// fluid3d.js is an unchanged copy. It models a sealed room in grid units, which
// cannot answer this, so three things are added here:
//  - open boundaries: the sides and top let air through and hold no pressure,
//    and the wind blows in across them;
//  - real units: temperature is degrees above ambient, and lift is g * dT / T0,
//    which for an ideal gas is the true acceleration of hot gas;
//  - burning: the pool releases fuel, which rides the wind and turns into heat
//    over a time tau. Depositing all the heat at the ground gives no flame at
//    all, because air cannot expand in this solver.
//
// Not modelled: expansion of hot gas, radiation beyond taking a fixed share off
// the heat, soot, and any heating of the aeroplane.
import { Fluid3D } from './fluid3d.js';

const G = 9.81;
const T0 = 293;           // K, ambient
const RHO = 1.2;          // kg/m3, ambient air
const CP = 1005;          // J/kg K
const FLAME_DT = 800;     // K above ambient: a typical mean for a large pool flame
const TURBULENT_MIXING = 2; // heat mixes faster than momentum: 1 / turbulent Prandtl number 0.5

export class WindyFire extends Fluid3D {
  /**
   * @param {object} o
   * @param {number} o.nx @param {number} o.ny @param {number} o.nz cells; y is up
   * @param {number} o.cell   metres
   * @param {Uint8Array} o.solid  from makeSolid
   * @param {{x:number, z:number}} o.wind  m/s
   * @param {Int32Array} o.pool  cells the fuel comes from
   * @param {number} o.heatRelease  W, total
   * @param {number} o.radiantFraction  share of the heat lost as radiation
   * @param {number} o.burnTime  tau, seconds
   */
  constructor({ nx, ny, nz, cell, solid, wind, pool, heatRelease, radiantFraction, burnTime, smagorinsky = 0.2 }) {
    super(nx, ny, nz, solid);
    this.cell = cell;
    this.windCells = { x: wind.x / cell, z: wind.z / cell };
    this.pool = pool;
    this.burnTime = burnTime;
    this.fuel = new Float32Array(this.size);
    this.fuel0 = new Float32Array(this.size);
    this.eddy = new Float32Array(this.size);
    this.smagorinsky = smagorinsky;
    this.seed = 12345;
    this.buoyancy = G / T0 / cell;
    this.cooling = 0;
    // Fuel is counted in the degrees it will give the air it is in when it burns.
    const poolVolume = pool.length * cell ** 3;
    this.fuelRate = heatRelease * (1 - radiantFraction) / (RHO * CP * poolVolume);
    this.openBoundaries();
    for (const n of this.fluid.keys()) {
      this.u[this.fluid[n]] = this.windCells.x;
      this.w[this.fluid[n]] = this.windCells.z;
    }
    this.time = 0;
  }

  /**
   * The ground stays solid; everything else is open. An open cell is not solid
   * but also not in the fluid list, so its pressure stays at zero, and the
   * solver in fluid3d.js treats that as air free to leave or arrive.
   */
  openBoundaries() {
    const { nx, ny, nz, sy, sz, solid } = this;
    const open = [];
    const add = (i, j, k, ni, nj, nk, normal) => {
      const c = i + sy * j + sz * k;
      solid[c] = 0;
      open.push({ c, inner: ni + sy * nj + sz * nk, normal });
    };
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      add(0, j, k, 1, j, k, [1, 0]);
      add(nx + 1, j, k, nx, j, k, [-1, 0]);
    }
    for (let i = 1; i <= nx; i++) for (let j = 1; j <= ny; j++) {
      add(i, j, 0, i, j, 1, [0, 1]);
      add(i, j, nz + 1, i, j, nz, [0, -1]);
    }
    for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) add(i, ny + 1, k, i, ny, k, [0, 0]);
    this.open = open;
    this.updateTopology();
  }

  /** Wind comes in across upwind faces; elsewhere air leaves as it arrives. */
  applyBoundaries() {
    const { u, v, w, temp, fuel, dens, windCells } = this;
    for (const { c, inner, normal } of this.open) {
      const inflow = normal[0] * windCells.x + normal[1] * windCells.z > 0;
      if (inflow) {
        u[c] = windCells.x; v[c] = 0; w[c] = windCells.z;
        temp[c] = 0; fuel[c] = 0; dens[c] = 0;
      } else {
        u[c] = u[inner]; v[c] = v[inner]; w[c] = w[inner];
        temp[c] = temp[inner]; fuel[c] = fuel[inner]; dens[c] = dens[inner];
      }
    }
  }

  step() {
    const { fluid, fuel, temp, dens, v, dt, pool } = this;
    // A slightly uneven pool: a perfectly even one on a square grid stays
    // symmetrical and takes far longer to start turning over.
    for (const c of pool) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      fuel[c] += dt * this.fuelRate * (0.6 + 0.8 * this.seed / 0x7fffffff);
      dens[c] = 1;
    }
    const burned = 1 - Math.exp(-dt / this.burnTime);
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      // Burning stops being able to heat gas past a flame's own temperature:
      // it runs short of air. Without this limit the gas over the pool reached
      // 3000 degrees above ambient. What cannot burn yet is carried along until
      // it has mixed with cooler air, and that is what gives the flame height.
      const b = Math.min(fuel[c] * burned, Math.max(0, FLAME_DT - temp[c]));
      fuel[c] -= b;
      temp[c] += b;
      v[c] += dt * this.buoyancy * temp[c];
    }
    if (this.vorticity > 0) this.confineVorticity();

    this.applyBoundaries();
    this.project(); this.blockWalls();
    this.applyBoundaries();
    this.u0.set(this.u); this.v0.set(this.v); this.w0.set(this.w);
    this.advect(this.u, this.u0, this.u0, this.v0, this.w0, false);
    this.advect(this.v, this.v0, this.u0, this.v0, this.w0, false);
    this.advect(this.w, this.w0, this.u0, this.v0, this.w0, false);
    this.applyBoundaries();
    if (this.smagorinsky > 0) {
      this.computeEddies();
      this.mix(this.u, this.u0, 1); this.mix(this.v, this.v0, 1); this.mix(this.w, this.w0, 1);
    }
    this.project(); this.blockWalls();
    this.applyBoundaries();

    this.dens0.set(dens); this.advect(dens, this.dens0, this.u, this.v, this.w, true);
    this.temp0.set(temp); this.advect(temp, this.temp0, this.u, this.v, this.w, true);
    this.fuel0.set(fuel); this.advect(fuel, this.fuel0, this.u, this.v, this.w, true);
    if (this.smagorinsky > 0) {
      this.mix(temp, this.temp0, TURBULENT_MIXING);
      this.mix(fuel, this.fuel0, TURBULENT_MIXING);
    }
    this.time += dt;
  }

  // Eddies smaller than a cell still stir the air. Without them a plume on this
  // grid stayed a clean column: at 20 m it was over 500 degrees where the
  // textbook has about 160, and rose three times too fast. This is Smagorinsky's
  // model, the same family FDS uses: how strongly a cell mixes follows how
  // sharply the wind shears there.
  computeEddies() {
    const { fluid, sy, sz, u, v, w, eddy, dt } = this;
    const cs2 = this.smagorinsky ** 2;
    // Explicit mixing is only stable up to this, with room for the scalar factor.
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

  /** Spread x according to the eddies, with no flux through solids. */
  mix(x, scratch, factor) {
    const { fluid, solid, sy, sz, eddy, dt } = this;
    scratch.set(x);
    const k = 0.5 * dt * factor;
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n], e = eddy[c], here = scratch[c];
      let change = 0;
      if (!solid[c - 1]) change += (e + eddy[c - 1]) * (scratch[c - 1] - here);
      if (!solid[c + 1]) change += (e + eddy[c + 1]) * (scratch[c + 1] - here);
      if (!solid[c - sy]) change += (e + eddy[c - sy]) * (scratch[c - sy] - here);
      if (!solid[c + sy]) change += (e + eddy[c + sy]) * (scratch[c + sy] - here);
      if (!solid[c - sz]) change += (e + eddy[c - sz]) * (scratch[c - sz] - here);
      if (!solid[c + sz]) change += (e + eddy[c + sz]) * (scratch[c + sz] - here);
      x[c] = here + k * change;
    }
  }
}

/**
 * A Boeing 737-200 in outline, from its published main dimensions; the nose
 * points towards -x, so the left wing is towards +z. Accurate to a cell at best.
 * With the aircraft off, the same pool sits on empty ground.
 */
export function buildScene({ cell, size, aircraft, poolOffset = 0, wings = true }) {
  const nx = Math.round(size.x / cell), ny = Math.round(size.y / cell), nz = Math.round(size.z / cell);
  const W = nx + 2, H = ny + 2, D = nz + 2;
  const solid = new Uint8Array(W * H * D);
  const at = (i) => (i - 0.5) * cell;
  const NOSE = 1, TAIL = 31.5, CZ = 11, CY = 3.08, R = 1.88;

  // How wide the fuselage is at x: tapering at both ends.
  const radius = (x) => {
    if (x < NOSE || x > TAIL) return 0;
    const fromNose = x - NOSE, fromTail = TAIL - x;
    let r = R;
    if (fromNose < 4) r = R * Math.sqrt(1 - (1 - fromNose / 4) ** 2);
    if (fromTail < 7) r = Math.min(r, R * (0.25 + 0.75 * fromTail / 7));
    return r;
  };
  const isFuselage = (x, y, z) => Math.hypot(y - CY, z - CZ) < radius(x);
  const isWing = (x, y, z) => {
    const span = Math.abs(z - CZ);
    if (span > 14.2 || y < 2 || y >= 2 + Math.max(cell, 0.5)) return false;
    const lead = 11 + 0.466 * span, chord = 4.7 - 0.22 * span;
    return x >= lead && x <= lead + chord;
  };
  const isEngine = (x, y, z) => {
    const side = Math.abs(z - CZ);
    return x >= 10 && x <= 14.5 && Math.hypot(y - 1.5, side - 4.83) < 0.7;
  };

  if (aircraft) {
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
      const x = at(i), y = at(j), z = at(k);
      if (isFuselage(x, y, z) || (wings && (isWing(x, y, z) || isEngine(x, y, z)))) solid[i + W * j + W * H * k] = 1;
    }
  }

  // 16 m2 of burning kerosene under and behind the left engine (the paper's
  // area; its exact outline here is my reading of a small figure).
  const pool = [];
  const POOL_X = [14, 18], POOL_Z = [CZ + 3 + poolOffset, CZ + 7 + poolOffset];
  for (let k = 1; k <= nz; k++) for (let i = 1; i <= nx; i++) {
    const x = at(i), z = at(k);
    if (x >= POOL_X[0] && x < POOL_X[1] && z >= POOL_Z[0] && z < POOL_Z[1]) pool.push(i + W * 1 + W * H * k);
  }
  return {
    nx, ny, nz, cell, solid, pool: Int32Array.from(pool), W, H,
    centre: { x: (POOL_X[0] + POOL_X[1]) / 2, z: (POOL_Z[0] + POOL_Z[1]) / 2 },
    fuselage: { NOSE, TAIL, CZ, CY, R },
  };
}
