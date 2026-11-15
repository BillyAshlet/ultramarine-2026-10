// The fire zone: seeing through to where it burns (task B, a proposal).
//
// Billy's idea (2026-11-11): the whole area on fire is what matters, so
// anything between the eye and it (smoke, a wall, a floor) turns see-through,
// by a slider 火区透视度. Smoke elsewhere is drawn as it is; only the view of
// the fire is opened. 0 = as now (smoke hides fire), 1 = nothing in front.
//
// The zone is up to 8 boxes: each burning thing's box, raised to the top of
// its flame and widened a little (combustion.js knows these; the flame lab
// makes its own). A shader asks, for a point it is drawing: does the line
// from the eye through this point go on into a zone box *behind* it? If so,
// that point is in the way and fades. The test is a ray against 8 boxes per
// pixel, inside a pass that is drawn anyway: no extra pass, no volume pass.
//
// Used so far only by tools/flame-lab.html. In the house:
//  - combustion.js fills the zone each step: world.combustion.fireZone(zone);
//  - smoke-pass.js would add ZONE_GLSL and, once per pixel,
//    zoneAlongRay(): samples nearer than the zone's far side thin by (1 - x);
//  - main.js would make the zone and the slider, and fadeForZone() the
//    house's materials (walls, floors) so they fade in front of it.
// smoke-pass.js and main.js are not B's: that waits for the main engine.
import * as THREE from 'three';

export const ZONE_BOXES = 8;

/** GLSL: uniforms and inZone(eye, dir, t) -> 0..1, how much the point at distance t is in front of the zone. */
export const ZONE_GLSL = /* glsl */ `
  uniform vec3 uZoneMin[${ZONE_BOXES}];
  uniform vec3 uZoneMax[${ZONE_BOXES}];
  uniform int uZoneCount;
  uniform float uZoneSee;     // the slider: 0..1
  // A ray grazing a box's edge passes only a short way through it: that
  // chord, over this length, softens the zone's outline.
  const float ZONE_SOFT = 0.32;
  // mode 0: walls/ceilings/doors/windows (fade anything between eye and zone's far face)
  // mode 1: floors/slabs (keep the floor the fire stands on solid)
  // mode 2: furniture (keep items in the fire's own storey, fade upper-storey blockers)
  float inZoneMode(vec3 eye, vec3 dir, float t, float worldY, int mode) {
    float w = 0.0;
    for (int i = 0; i < ${ZONE_BOXES}; i++) {
      if (i >= uZoneCount) break;
      if (mode == 1 && worldY <= uZoneMin[i].y + 0.16) continue;
      if (mode == 2 && worldY <= uZoneMax[i].y + 0.15) continue;
      vec3 a = (uZoneMin[i] - eye) / dir, b = (uZoneMax[i] - eye) / dir;
      vec3 lo = min(a, b), hi = max(a, b);
      float tNear = max(max(lo.x, lo.y), lo.z), tFar = min(min(hi.x, hi.y), hi.z);
      // Only if some of the box is behind this point.
      if (tFar > max(tNear, t + 0.02)) w = max(w, clamp((tFar - max(tNear, t)) / ZONE_SOFT, 0.0, 1.0));
    }
    return w * uZoneSee;
  }
  float inZone(vec3 eye, vec3 dir, float t) {
    return inZoneMode(eye, dir, t, 1e6, 0);
  }
  // For a ray marcher (smoke-pass.js): worked out once per pixel. Returns how
  // much to thin what lies in front (x) and how far that goes along the ray
  // (y, the far side of the zone); samples with t < y get a *= 1.0 - x.
  vec2 zoneAlongRay(vec3 eye, vec3 dir) {
    float w = 0.0, far = 0.0;
    for (int i = 0; i < ${ZONE_BOXES}; i++) {
      if (i >= uZoneCount) break;
      vec3 a = (uZoneMin[i] - eye) / dir, b = (uZoneMax[i] - eye) / dir;
      vec3 lo = min(a, b), hi = max(a, b);
      float tNear = max(max(lo.x, lo.y), max(lo.z, 0.0)), tFar = min(min(hi.x, hi.y), hi.z);
      if (tFar > tNear) {
        float wi = clamp((tFar - tNear) / ZONE_SOFT, 0.0, 1.0);
        if (wi > w) { w = wi; far = tFar; }
      }
    }
    return vec2(w * uZoneSee, far);
  }
`;

/** The zone's uniforms, shared by every material that fades for it. */
export function makeZone() {
  const uniforms = {
    uZoneMin: { value: Array.from({ length: ZONE_BOXES }, () => new THREE.Vector3()) },
    uZoneMax: { value: Array.from({ length: ZONE_BOXES }, () => new THREE.Vector3()) },
    uZoneCount: { value: 0 },
    uZoneSee: { value: 1.0 },
  };
  let n = 0;
  return {
    uniforms,
    begin() { n = 0; },
    /** One burning thing: its box, up to the top of its flame, widened by `grow` (m). */
    add(x0, y0, z0, x1, y1, z1, grow = 0.3) {
      if (n >= ZONE_BOXES) return;
      uniforms.uZoneMin.value[n].set(x0 - grow, y0, z0 - grow);
      uniforms.uZoneMax.value[n].set(x1 + grow, y1, z1 + grow);
      n++;
    },
    end() { uniforms.uZoneCount.value = n; },
    set see(v) { uniforms.uZoneSee.value = v; },
    get see() { return uniforms.uZoneSee.value; },
  };
}

/**
 * Make a Lambert (or any built-in) material fade where it stands in front of
 * the zone. It drops a share inZone() of its pixels in a fixed 4x4 pattern
 * (screen-door), as main.js already fades the other storey. Blending it
 * instead meant turning every wall transparent, which changes how the house
 * sorts and draws even with the slider at 0, and a faded wall still wrote
 * depth and hid the flames behind it. A dropped pixel writes no depth.
 */
export function fadeForZone(material, zone, { mode = 0 } = {}) {
  if (material.userData.fadeForZone) return material;
  material.userData.fadeForZone = true;
  // Chain onto whatever already patches this material (gas.js greys
  // materials the same way), and keep its program key apart.
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, zone.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vZoneWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvZoneWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vZoneWorld;\n${ZONE_GLSL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (uZoneCount > 0 && uZoneSee > 0.0) {
        vec3 d = vZoneWorld - cameraPosition; float t = length(d);
        float w = 1.02 * inZoneMode(cameraPosition, d / t, t, vZoneWorld.y, ${mode | 0});
        // Warm architectural section-cut bevel where the wall/slab opens.
        float cutRim = smoothstep(0.02, 0.38, w) * (1.0 - smoothstep(0.58, 0.98, w));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.95, 0.48, 0.16), cutRim * 0.45);
        // 4x4 ordered dither on the soft bevel; w >= 1 discards 100% cleanly with no dots left.
        ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
        int k = ((p.x ^ p.y) & 1) * 8 + (p.y & 1) * 4 + (((p.x ^ p.y) >> 1) & 1) * 2 + ((p.y >> 1) & 1);
        if (w > (float(k) + 0.5) / 16.0) discard;
      }`);
  };
  material.customProgramCacheKey = () => `${key}|fadeForZone:${mode | 0}`;
  material.needsUpdate = true;
  return material;
}
