// Wind made visible: short streaks that ride the fluid's velocity field.
// Each streak is drawn from where it is to where the wind will take it a
// moment from now, so its length is the local wind speed. Like the fish in
// flocks, no streak knows the pattern; the pattern is in how they all move.
import * as THREE from 'three';

export class WindParticles {
  constructor(fluid, grid, count = 3000) {
    this.fluid = fluid;
    this.grid = grid;
    this.count = count;
    this.pos = new Float32Array(count * 3);      // grid coordinates
    this.age = new Float32Array(count);
    this.life = new Float32Array(count);
    this.velocity = [0, 0, 0];

    const geometry = new THREE.BufferGeometry();
    this.vertices = new Float32Array(count * 6);
    this.colors = new Float32Array(count * 6);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    this.lines.frustumCulled = false;
    for (let n = 0; n < count; n++) this.respawn(n, Math.random());
  }

  // Most of a house's air is still; streaks there are invisible dots. So a
  // new streak is born in the fastest of a few random cells, which puts the
  // streaks where the wind actually is: the plume, the ceiling jet, doorways.
  respawn(n, ageFraction = 0) {
    const f = this.fluid;
    let c = f.fluid[(Math.random() * f.fluid.length) | 0], best = -1;
    for (let tries = 0; tries < 8; tries++) {
      const cand = f.fluid[(Math.random() * f.fluid.length) | 0];
      const speed = Math.abs(f.u[cand]) + Math.abs(f.v[cand]) + Math.abs(f.w[cand]);
      if (speed > best) { best = speed; c = cand; }
    }
    const k = Math.floor(c / f.sz), j = Math.floor((c - k * f.sz) / f.sy), i = c - k * f.sz - j * f.sy;
    this.pos[n * 3] = i + Math.random() - 0.5;
    this.pos[n * 3 + 1] = j + Math.random() - 0.5;
    this.pos[n * 3 + 2] = k + Math.random() - 0.5;
    this.life[n] = 2 + Math.random() * 4;
    this.age[n] = this.life[n] * ageFraction;
  }

  /** dt in the fluid's own time, so streaks move exactly as the smoke does. */
  update(dt) {
    const f = this.fluid, g = this.grid, vel = this.velocity;
    const trail = 1.5;   // seconds of travel each streak shows
    for (let n = 0; n < this.count; n++) {
      const p = n * 3;
      let x = this.pos[p], y = this.pos[p + 1], z = this.pos[p + 2];
      f.sampleVelocity(x, y, z, vel);
      x += vel[0] * dt; y += vel[1] * dt; z += vel[2] * dt;
      this.age[n] += dt;
      const c = Math.round(x) + f.sy * Math.round(y) + f.sz * Math.round(z);
      const lost = x < 0.5 || y < 0.5 || z < 0.5 || x > f.nx + 0.5 || y > f.ny + 0.5 || z > f.nz + 0.5 || f.solid[c];
      if (this.age[n] > this.life[n] || lost) { this.respawn(n); continue; }
      this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;

      const speed = Math.hypot(vel[0], vel[1], vel[2]);
      const toWorld = (gx, gy, gz, o) => {
        this.vertices[o] = g.origin.x + (gx - 0.5) * g.cell;
        this.vertices[o + 1] = g.origin.y + (gy - 0.5) * g.cell;
        this.vertices[o + 2] = g.origin.z + (gz - 0.5) * g.cell;
      };
      toWorld(x, y, z, n * 6);
      toWorld(x + vel[0] * trail, y + vel[1] * trail, z + vel[2] * trail, n * 6 + 3);
      // Still air is faint blue, fast air bright and pale.
      const s = Math.min(1, speed / 12);
      const fade = Math.min(1, this.age[n] * 2, (this.life[n] - this.age[n]) * 2);
      for (const o of [n * 6, n * 6 + 3]) {
        this.colors[o] = (0.25 + 0.75 * s) * fade;
        this.colors[o + 1] = (0.55 + 0.45 * s) * fade;
        this.colors[o + 2] = 1.0 * fade;
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }
}
