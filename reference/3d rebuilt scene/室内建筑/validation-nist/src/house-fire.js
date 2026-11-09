// The solver in src/fluid3d.js (an unchanged copy), in real units, inside a
// closed house, with a fire whose size is given from outside.
//
// What is added, and where it comes from:
//  - real units and burning, the same as wind-plume/src/windy.js: temperature is
//    degrees above ambient, lift is g * dT / T0, fuel turns into heat over
//    burnTime and cannot heat gas past a flame's temperature. Smagorinsky 0.4
//    and burnTime 3 s are the values wind-plume fixed against a textbook plume
//    before any comparison, and are not retuned here;
//  - soot in kg/m3, released with the fuel at a fixed yield. It does not change
//    the flow, so a different yield only scales every smoke number;
//  - heat lost to walls, floors and ceilings: each air cell beside a surface
//    loses h * (its exposed area) * dT. Without this a closed house only heats up.
//
// Not modelled: expansion of hot gas and leakage through the house's gaps,
// radiation beyond taking a fixed share off the heat, the walls warming up.
import { Fluid3D } from './fluid3d.js';

const G = 9.81;
const T0 = 293;
const RHO = 1.2;
const CP = 1005;
const FLAME_DT = 800;
const TURBULENT_MIXING = 2;

export class HouseFire extends Fluid3D {
  constructor({ nx, ny, nz, cell, solid, chair, smagorinsky = 0.4, burnTime = 3, radiantFraction = 0.3, wallH = 15 }) {
    super(nx, ny, nz, solid);
    this.cell = cell;
    this.source = chair;
    this.burnTime = burnTime;
    this.radiantFraction = radiantFraction;
    this.smagorinsky = smagorinsky;
    this.fuel = new Float32Array(this.size);
    this.fuel0 = new Float32Array(this.size);
    this.eddy = new Float32Array(this.size);
    this.buoyancy = G / T0 / cell;
    this.cooling = 0;
    this.seed = 12345;
    this.time = 0;
    this.fuelRate = 0;
    this.sootRate = 0;
    // Per second, the share of its heat an air cell gives to the surfaces it touches.
    const { fluid, sy, sz } = this;
    this.wallLoss = new Float32Array(fluid.length);
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const faces = solid[c - 1] + solid[c + 1] + solid[c - sy] + solid[c + sy] + solid[c - sz] + solid[c + sz];
      this.wallLoss[n] = wallH * faces / (RHO * CP * cell);
    }
  }

  /** The fire this moment: burning rate in kg/s. */
  setFire(burningRate, heatOfCombustion, sootYield) {
    const volume = this.source.length * this.cell ** 3;
    this.fuelRate = burningRate * heatOfCombustion * (1 - this.radiantFraction) / (RHO * CP * volume);
    this.sootRate = burningRate * sootYield / volume;
  }

  step() {
    const { fluid, fuel, temp, dens, v, dt, source } = this;
    for (const c of source) {
      this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
      fuel[c] += dt * this.fuelRate * (0.6 + 0.8 * this.seed / 0x7fffffff);
      dens[c] += dt * this.sootRate;
    }
    const burned = 1 - Math.exp(-dt / this.burnTime);
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const b = Math.min(fuel[c] * burned, Math.max(0, FLAME_DT - temp[c]));
      fuel[c] -= b;
      temp[c] += b;
      v[c] += dt * this.buoyancy * temp[c];
    }
    if (this.vorticity > 0) this.confineVorticity();

    this.project(); this.blockWalls();
    this.u0.set(this.u); this.v0.set(this.v); this.w0.set(this.w);
    this.advect(this.u, this.u0, this.u0, this.v0, this.w0, false);
    this.advect(this.v, this.v0, this.u0, this.v0, this.w0, false);
    this.advect(this.w, this.w0, this.u0, this.v0, this.w0, false);
    if (this.smagorinsky > 0) {
      this.computeEddies();
      this.mix(this.u, this.u0, 1); this.mix(this.v, this.v0, 1); this.mix(this.w, this.w0, 1);
    }
    this.project(); this.blockWalls();

    this.dens0.set(dens); this.advect(dens, this.dens0, this.u, this.v, this.w, true);
    this.temp0.set(temp); this.advect(temp, this.temp0, this.u, this.v, this.w, true);
    this.fuel0.set(fuel); this.advect(fuel, this.fuel0, this.u, this.v, this.w, true);
    if (this.smagorinsky > 0) {
      this.mix(temp, this.temp0, TURBULENT_MIXING);
      this.mix(fuel, this.fuel0, TURBULENT_MIXING);
      this.mix(dens, this.dens0, TURBULENT_MIXING);
    }
    for (let n = 0; n < fluid.length; n++) temp[fluid[n]] *= Math.exp(-this.wallLoss[n] * dt);
    this.time += dt;
  }

  // Same as wind-plume/src/windy.js.
  computeEddies() {
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

  /** A scalar field at a point in metres, trilinear between cell centres. */
  sample(field, x, y, z) {
    const { sy, sz, nx, ny, nz, cell } = this;
    let gx = x / cell + 0.5, gy = y / cell + 0.5, gz = z / cell + 0.5;
    gx = Math.min(Math.max(gx, 1), nx); gy = Math.min(Math.max(gy, 1), ny); gz = Math.min(Math.max(gz, 1), nz);
    const i0 = Math.min(gx | 0, nx - 1), j0 = Math.min(gy | 0, ny - 1), k0 = Math.min(gz | 0, nz - 1);
    const s1 = gx - i0, t1 = gy - j0, r1 = gz - k0, s0 = 1 - s1, t0 = 1 - t1, r0 = 1 - r1;
    const b = i0 + sy * j0 + sz * k0;
    // Leave solid corners out, as advect does, so a reading never comes from inside a wall.
    let sum = 0, wsum = 0;
    const add = (q, w) => { if (!this.solid[q]) { sum += w * field[q]; wsum += w; } };
    add(b, r0 * t0 * s0); add(b + 1, r0 * t0 * s1); add(b + sy, r0 * t1 * s0); add(b + sy + 1, r0 * t1 * s1);
    add(b + sz, r1 * t0 * s0); add(b + sz + 1, r1 * t0 * s1); add(b + sz + sy, r1 * t1 * s0); add(b + sz + sy + 1, r1 * t1 * s1);
    return wsum > 1e-6 ? sum / wsum : 0;
  }
}
