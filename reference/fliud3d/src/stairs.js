// An invisible ramp up a spiral staircase, for walking only.
//
// One staircase is three things here. The eye sees the real treads from the IFC
// file; smoke sees the 20 cm grid, where a 6 cm tread cannot exist at all; and
// the person walks on this. Stepping on the real treads would mean telling them
// apart from 83 parts that share one name, and squeezing a body between a post
// and a rail less than a metre apart, for steps nobody sees: a first-person view
// has no feet to line up. So the ramp is a formula, and on it you are on a rail.

const POST_CLEARANCE = 0.39;   // the post's 0.14 m radius plus a body
const OUTER_RADIUS = 0.95;     // the outer ends of the treads

export class SpiralStair {
  /**
   * Angles are measured in the x-z plane, around `centre`, in radians, and must
   * not cross ±180 degrees.
   * @param {object} o
   * @param {{x:number, z:number}} o.centre
   * @param {number} o.walkRadius   how far out from the post you walk
   * @param {number} o.bottomAngle  where the ramp leaves the lower floor
   * @param {number} o.topAngle     where it reaches the upper floor
   * @param {number} o.bottomY
   * @param {number} o.topY
   * @param {number} o.landing      how far past each end you step off, in metres
   */
  constructor({ centre, walkRadius, bottomAngle, topAngle, bottomY, topY, landing }) {
    Object.assign(this, { centre, walkRadius, bottomAngle, topAngle, bottomY, topY, landing });
    this.turn = topAngle - bottomAngle;
    this.length = Math.hypot(this.turn * walkRadius, topY - bottomY);
  }

  /** The point on the ramp at s, 0 at the bottom and 1 at the top. */
  at(s) {
    const a = this.bottomAngle + this.turn * s;
    return {
      x: this.centre.x + this.walkRadius * Math.cos(a),
      y: this.bottomY + (this.topY - this.bottomY) * s,
      z: this.centre.z + this.walkRadius * Math.sin(a),
    };
  }

  /** Which way is up the ramp at s, as a horizontal unit vector. */
  upAt(s) {
    const a = this.bottomAngle + this.turn * s, sign = Math.sign(this.turn);
    return { x: -Math.sin(a) * sign, z: Math.cos(a) * sign };
  }

  /** Where you stand after stepping off the end at s (0 or 1). */
  landingAt(s) {
    const p = this.at(s), up = this.upAt(s), out = s === 0 ? -this.landing : this.landing;
    return { x: p.x + up.x * out, y: p.y, z: p.z + up.z * out };
  }

  /**
   * The end of the ramp this move walks you onto (0 or 1), or null. You board
   * by walking at an end, in the direction the ramp runs from there, so brushing
   * past the foot of the stairs does not carry you off up them.
   */
  boarding(x, z, upstairs, moveX, moveZ) {
    const s = upstairs ? 1 : 0;
    const end = this.at(s), up = this.upAt(s), along = upstairs ? -1 : 1;
    const dx = end.x - x, dz = end.z - z;
    if (Math.hypot(dx, dz) > 0.5) return null;
    if (dx * moveX + dz * moveZ <= 0) return null;
    if ((up.x * moveX + up.z * moveZ) * along <= 0) return null;
    return s;
  }

  /** Whether the lower floor is closed here, by the post or by the flight overhead. */
  blocksGround(x, z) {
    const dx = x - this.centre.x, dz = z - this.centre.z, r = Math.hypot(dx, dz);
    if (r < POST_CLEARANCE) return true;
    if (r >= OUTER_RADIUS) return false;
    const a = Math.atan2(dz, dx);
    return a >= Math.min(this.bottomAngle, this.topAngle) && a <= Math.max(this.bottomAngle, this.topAngle);
  }
}
