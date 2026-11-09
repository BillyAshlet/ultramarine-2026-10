// Walls, floors and ceilings taking heat out of the air beside them.
//
// Without this the house kept every joule the fire put into the air: the
// upstairs hallway was 100 K over ambient 90 s into a 380 kW fire, and it only
// ever got hotter. In a measured 1 MW compartment fire about 74% of the heat
// went into the walls, ceiling and floor (Hamins et al. 2008).
//
// Each air cell next to a solid face loses heat through that face. The flow of
// heat meets two resistances in a row:
//  - gas to wall surface: convection plus radiation, in the form EN 1991-1-2
//    (3.1)-(3.3) uses for a surface in a fire compartment: alpha_c = 25 W/m2K
//    (its value for the standard fire curve), surface emissivity 0.8, fire
//    emissivity 1.0, configuration factor 1;
//  - into the wall: a cold wall soaks heat up fast and a warm one slowly. As
//    in the MQH method (NUREG-1805 ch. 2), h_k = sqrt(k rho c / t) while the
//    heat is still soaking in, and k / thickness once it has gone through.
//    t is how long this patch of wall has had hot gas against it, so walls far
//    from the fire start cold when the smoke reaches them.
// Every face is taken as 12.7 mm gypsum board (NUREG-1805's table: k rho c =
// 0.18 (kW/m2K)^2 s, k = 0.17 W/mK). The Duplex's ceilings and partitions are
// gypsum; its slab floor and block party wall soak up heat faster than this,
// so the loss there is if anything too low.
//
// The wall's own temperature is not kept: the radiation term takes the wall
// surface as ambient, and h_k stands in for the wall warming up.
// Thin smoke radiates less than the fire emissivity of 1.0 assumes, so early
// on, with little smoke, the radiation part is too high.

const SIGMA = 5.67e-8;
const T0 = 293;            // K, ambient, as in windy.js
const RHO_CP = 1.2 * 1005; // J/m3K, as windy.js counts fuel
const CONVECTION = 25;     // W/m2K, EN 1991-1-2 3.2.1 (35 for simple fire models)
const EMISSIVITY = 0.8 * 1.0;
const GYPSUM = { kRhoC: 0.18e6, k: 0.17, thickness: 0.0127 };
const HOT = 5;             // K over ambient that counts as hot gas against a wall

export class WallLoss {
  constructor(fire, material = GYPSUM) {
    this.fire = fire;
    this.material = material;
    // Penetration time: about when heat reaches the far side of the board.
    const diffusivity = material.k / (material.kRhoC / material.k);
    this.penetration = material.thickness ** 2 / (4 * diffusivity);
    this.absorbed = 0;   // J, all walls together
    this.enabled = true;
    this.build();
  }

  /** Which air cells touch a solid face, and how many faces. Redone when doors change. */
  build() {
    const { fluid, solid, sy, sz } = this.fire;
    this.fluidList = fluid;
    const cells = [], faces = [];
    for (let n = 0; n < fluid.length; n++) {
      const c = fluid[n];
      const f = solid[c - 1] + solid[c + 1] + solid[c - sy] + solid[c + sy] + solid[c - sz] + solid[c + sz];
      if (f) { cells.push(c); faces.push(f); }
    }
    const old = this.exposed && new Map([...this.cells].map((c, i) => [c, this.exposed[i]]));
    this.cells = Int32Array.from(cells);
    this.faces = Uint8Array.from(faces);
    this.exposed = new Float32Array(cells.length);
    if (old) for (let i = 0; i < cells.length; i++) this.exposed[i] = old.get(cells[i]) ?? 0;
  }

  apply(dt) {
    if (!this.enabled) return;
    const fire = this.fire;
    if (fire.fluid !== this.fluidList) this.build();
    const { temp, cell } = fire;
    const { kRhoC, k, thickness } = this.material;
    const { cells, faces, exposed, penetration } = this;
    const hThrough = k / thickness;
    let lost = 0;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const dT = temp[c];
      if (dT <= 0) continue;
      if (dT > HOT) exposed[i] += dt;
      const t = Math.max(exposed[i], 1);
      const hWall = t < penetration ? Math.sqrt(kRhoC / t) : hThrough;
      const Tg = T0 + dT;
      const hGas = CONVECTION + EMISSIVITY * SIGMA * (Tg ** 4 - T0 ** 4) / dT;
      const h = 1 / (1 / hGas + 1 / hWall);
      // The cell is a cell-sized box; its walls are `faces` cell-sized squares.
      const after = dT * Math.exp(-h * faces[i] * dt / (RHO_CP * cell));
      temp[c] = after;
      lost += dT - after;
    }
    this.absorbed += lost * RHO_CP * cell ** 3;
  }

  reset() {
    this.exposed.fill(0);
    this.absorbed = 0;
  }
}
