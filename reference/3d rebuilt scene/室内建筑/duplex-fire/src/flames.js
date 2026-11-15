// Drawing fire so you can see it (task B).
//
// The goal is a flame that reads as fire at a glance, not a measured one:
// Billy could not tell what was burning when items only turned red. So the
// look is a game-style flame, and only its size follows the physics (the
// Heskestad height from the heat release, so a 2 MW sofa is tall and a
// 50 kW igniter small). The research behind real flames is in
// 进度/B/真实火焰与画法.md; most of it is deliberately not drawn, because
// none of it showed (three zones, blackbody colour, puffing frequency...).
//
// The one interface: each step, set(key, ...) for every fire that is
// burning, between begin() and end(). Anything that has a heat release can
// report one (combustion.js's items and the igniter now; a gas fire later).
// The events show up through it on their own:
//  - lit:     the heat release grows from zero, so the flame grows from a
//             small one (combustion.js also grows the burning patch from
//             where it was lit);
//  - water:   pass wet > 0 and the flame gives off white steam; the heat
//             release falling (water.js / Evans) shrinks it;
//  - out:     a fire no longer reported dies down to glowing embers and a
//             few wisps of smoke over about 25 s;
//  - big:     a flame taller than the room rolls out under the ceiling.
//
// Per fire: one mesh of quads (two flame sheets facing the camera, one flat
// over the burning patch for the view from above, one under the ceiling),
// sparks, and steam/smoke puffs. All motion is in the shaders; meshes,
// materials and lights are made once and each step only sets uniforms (no
// allocation, no volume pass: 开工顺序.md). The two biggest fires light the
// room. Time is wall-clock, so flames move while the simulation is paused.
import * as THREE from 'three';

export const FLAME_LOOK = {
  slots: 16,          // fires drawn at once (more is past flashover)
  sparks: 48,         // per fire
  puffs: 24,          // steam or smoke puffs per fire
  emberSeconds: 25,   // how long a fire that went out keeps glowing
  steamSeconds: 4,    // how long steam lingers after water stops
  lights: 2,
  lightPerSqrtKW: 0.25, // candela per sqrt(kW), for the look (0.5 lit the house's pale walls into an orange slab behind a 2 MW sofa)
};

const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { return 0.5 * noise(p) + 0.3 * noise(p * 2.07 + 7.1) + 0.2 * noise(p * 4.13 + 3.3); }
  // Dark red, orange, yellow, near white: how flames look, not a blackbody.
  vec3 fireRamp(float v) {
    v = clamp(v, 0.0, 1.0);
    vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.4, v));
    c = mix(c, vec3(1.0, 0.72, 0.18), smoothstep(0.4, 0.75, v));
    c = mix(c, vec3(1.0, 0.95, 0.75), smoothstep(0.8, 1.0, v));
    return pow(c, vec3(2.2));   // to linear light
  }
`;

// Shared by every fire: where it is and how big.
const FIRE_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform vec3 uBase;     // centre of the burning patch, at the flame's base (m)
  uniform vec2 uPatch;    // patch size along x and z (m)
  uniform float uH;       // flame height (m), not cut at the ceiling
  uniform float uCeil;    // ceiling above the base (m)
  uniform float uCrown;   // top of the burning thing above the base (m)
  uniform float uSpread;  // how far the flame runs under the ceiling (m); 0 = none
  uniform float uPower;   // 0..1: 0 = no flame (embers only)
  uniform float uEmber;   // 0..1: glowing embers after it went out
  uniform float uSteam;   // 0..1: steam from water
  uniform float uSeed;
  uniform float uCutY;    // the view's cut-away height (world m): the ceiling sheet stays under it
`;

const flameVertex = /* glsl */ `
  attribute float aKind;  // 0, 3: flame sheets; 1: over the patch; 2: under the ceiling
  ${FIRE_UNIFORMS}
  varying vec3 vLocal;
  varying float vKind;
  #include <clipping_planes_pars_vertex>
  void main() {
    vKind = aKind;
    vec3 p;
    float D = sqrt(uPatch.x * uPatch.y * 1.27);
    if (aKind < 0.5 || aKind > 2.5) {
      // Turn about the vertical to face the camera; as wide as the patch from there.
      vec2 toCam = cameraPosition.xz - uBase.xz;
      float len = length(toCam);
      vec2 f = len > 1e-4 ? toCam / len : vec2(0.0, 1.0);
      vec2 right = vec2(f.y, -f.x);
      float w = length(vec2(uPatch.x * right.x, uPatch.y * right.y)) * (aKind > 2.5 ? 0.7 : 1.15);
      // Flames stand on the burning surface (a seat, a table top), not on the floor.
      float lift = 0.6 * uCrown;
      float h = min(uCeil - lift, uH * 1.35) * step(0.001, uPower);
      // The second sheet sits a little in front, so the flame has depth.
      vec3 off = vec3(f.x, 0.0, f.y) * (aKind > 2.5 ? 0.12 * D : 0.0);
      p = uBase + off + vec3(right.x, 0.0, right.y) * position.x * w + vec3(0.0, lift + position.y * h, 0.0);
      vLocal = vec3(position.x * w, position.y * h, w);
    } else if (aKind < 1.5) {
      vec2 s = uPatch * 1.25;
      p = uBase + vec3(position.x * s.x, uCrown + 0.02, position.y * s.y);
      vLocal = vec3(position.x * s.x, position.y * s.y, 0.0);
    } else {
      vec2 s = uPatch + 2.4 * uSpread;
      p = uBase + vec3(position.x * s.x, min(uCeil - 0.03, uCutY - uBase.y - 0.05), position.y * s.y);
      vLocal = vec3(position.x * s.x, position.y * s.y, 0.0);
      if (uSpread <= 0.0 || uPower <= 0.0) p = vec3(0.0, -1e5, 0.0);
    }
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <clipping_planes_vertex>
  }
`;

const flameFragment = /* glsl */ `
  ${FIRE_UNIFORMS}
  varying vec3 vLocal;
  varying float vKind;
  #include <clipping_planes_pars_fragment>
  ${NOISE}
  void main() {
    #include <clipping_planes_fragment>
    float D = max(0.25, sqrt(uPatch.x * uPatch.y * 1.27));
    float t = uTime;
    float scale = 4.0 / D;                          // several tongues across the patch
    float rise = 1.0 + 0.5 * sqrt(uH);              // m/s the tongues climb (for the look)
    float flick = 1.0 + 0.12 * sin(t * 7.0 / sqrt(D) + uSeed * 5.0) + 0.06 * sin(t * 13.0 + uSeed);
    float H = uH * flick;
    vec3 col = vec3(0.0);
    float a = 0.0;
    if (vKind < 0.5 || vKind > 2.5) {
      float h = vLocal.y;
      if (h > uCeil - 0.6 * uCrown) discard;
      float u = vLocal.x / max(vLocal.z, 1e-3) * 2.0;   // -1..1 across
      float second = step(2.5, vKind);
      // A wide fire is several tongues side by side, not one sheet: up to 4
      // lobes, about 0.7 m each, each a little taller or shorter.
      float lobes = clamp(floor(vLocal.z / 0.7), 1.0, 4.0);
      float lu = (u * 0.5 + 0.5) * lobes + second * 0.5;
      float li = floor(lu);
      u = fract(lu) * 2.0 - 1.0;
      float Hl = H * (0.72 + 0.28 * fract(sin(li * 12.9898 + uSeed * 4.1) * 43758.5453));
      // A flame taller than the room tapers to the ceiling (the sheet under
      // the ceiling carries on); otherwise its cut-off lower part is a wall.
      Hl = min(Hl, (uCeil - 0.6 * uCrown) * 1.15);
      float y = h / max(Hl, 1e-3);
      // Noise stretched upward, so it reads as tongues licking up.
      float n = fbm(vec3(vLocal.x * scale, (h - rise * t) * scale * 0.45, uSeed + second * 9.0 + t * 0.7));
      // A teardrop that the noise tears into tongues, more so higher up.
      float w = pow(clamp(1.0 - y, 0.0, 1.0), 0.6) * (1.0 + 0.2 * (1.0 - y));
      float body = w - abs(u) + (n - 0.5) * (0.7 + 1.1 * y);
      body -= smoothstep(0.8, 1.35, y + (n - 0.5) * 0.7) * 1.2;
      float v = smoothstep(0.0, 0.1, body) * smoothstep(0.0, 0.06, h);
      // Yellow deep inside, orange then dark red at the edges and the tips.
      float heat = clamp(body * 2.5, 0.0, 1.0) * (1.1 - 0.5 * y) * (1.0 + 0.25 * second);
      col = fireRamp(heat * 0.9) * v * (0.35 + 0.65 * heat) * 0.6 * uPower;
      // Only the bright part hides what is behind: cool edges as opaque read
      // as brown holes (burnt paper) on a bright wall.
      a = v * smoothstep(0.05, 0.45, heat);
    } else if (vKind < 1.5) {
      // From above: the patch burning (flame) or glowing (embers).
      vec2 q = vLocal.xy / max(uPatch * 0.5, vec2(1e-3));
      float d = length(q);
      float n = fbm(vec3(vLocal.xy * scale * 1.2, uSeed - t * 0.9));
      float v = smoothstep(0.05, 0.55, (1.0 - d) + (n - 0.5) * 0.9) * min(1.0, uH / 0.6);
      col = fireRamp(v * 0.95) * v * 0.8 * uPower;
      // Embers: spots that glow and fade.
      // Fine cracks of glow in the char, breathing slowly.
      float m = noise(vec3(vLocal.xy * 26.0, uSeed)) * 0.6 + noise(vec3(vLocal.xy * 7.0, uSeed + 3.0)) * 0.4;
      float e = smoothstep(0.62, 0.8, m + 0.08 * sin(t * 1.3 + m * 25.0)) * smoothstep(1.1, 0.4, d);
      col += fireRamp(0.3 + 0.2 * e) * e * 1.2 * uEmber;
      a = max(v, e);
    } else {
      // Under the ceiling: the flame running out from over the patch.
      vec2 q = vLocal.xy;
      float r = length(max(abs(q) - uPatch * 0.5, 0.0));
      float n = fbm(vec3(q * scale * 0.8 - normalize(q + 1e-4) * t * rise * scale * 0.3, uSeed + t * 0.4));
      float v = smoothstep(0.0, 0.3, 1.0 - r / max(uSpread * flick, 1e-3) + (n - 0.5) * 0.9);
      col = fireRamp(v * 0.85) * v * uPower;
      a = v;
    }
    if (a < 0.004) discard;
    // Premultiplied: the flame's light (col) plus how much it hides what is
    // behind it (alpha). Added light alone washed out to a pale glow in front
    // of the house's light, see-through walls; this way the dark red edges
    // and tongues still show on a bright background.
    gl_FragColor = vec4(col, a * 0.7 * max(uPower, uEmber));
    #include <colorspace_fragment>
  }
`;

// Sparks (additive) and puffs (steam or smoke, blended): points whose whole
// life is worked out in the shader from time and a per-point random.
const pointsVertex = (puffs) => /* glsl */ `
  attribute vec3 aRand;
  ${FIRE_UNIFORMS}
  uniform float uViewH;   // drawing-buffer height (px)
  varying float vLife;
  varying float vShow;
  varying float vSteamy;
  #include <clipping_planes_pars_vertex>
  void main() {
    float t = uTime;
    vec3 p;
    float size;
    float H = max(uH, 0.3);
    if (${puffs ? 'true' : 'false'}) {
      // Steam while wet, else wisps of smoke while the embers last.
      float steam = uSteam, wisp = uEmber * (1.0 - uSteam);
      vShow = max(steam, wisp * 0.6) * step(aRand.z, max(0.3 + 0.7 * steam, wisp * 0.5));
      vSteamy = steam / max(steam + wisp, 1e-3);
      float speed = mix(0.18, 0.35, vSteamy);
      vLife = fract(t * speed * (0.8 + 0.4 * aRand.y) + aRand.x);
      vec2 at = (aRand.xy - 0.5) * uPatch * 0.9;
      p = uBase + vec3(at.x + sin(t * 0.7 + aRand.z * 9.0) * 0.25 * vLife, uCrown + vLife * mix(1.2, 2.0, vSteamy), at.y + cos(t * 0.6 + aRand.x * 9.0) * 0.25 * vLife);
      p.y = min(p.y, uBase.y + uCeil - 0.1);
      size = mix(0.3, 1.1, vLife) * mix(0.6, 1.0, vSteamy);
    } else {
      vSteamy = 0.0;
      vLife = fract(t * (0.5 + 0.5 * aRand.y) + aRand.x);
      vShow = uPower * step(aRand.z, 0.25 + 0.75 * uPower);
      vec2 at = (aRand.xy - 0.5) * uPatch * 0.8;
      float up = vLife * H * (1.2 + 0.8 * aRand.z);
      p = uBase + vec3(at.x + sin(t * 3.0 + aRand.z * 20.0) * 0.12 * vLife, uCrown * 0.6 + up, at.y + cos(t * 2.6 + aRand.y * 20.0) * 0.12 * vLife);
      if (p.y > uBase.y + uCeil - 0.05) vShow = 0.0;
      size = 0.025;
    }
    vec4 mvPosition = viewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = vShow > 0.0 ? max(1.5, size * projectionMatrix[1][1] * uViewH * 0.5 / max(-mvPosition.z, 0.1)) : 0.0;
    #include <clipping_planes_vertex>
  }
`;
const sparkFragment = /* glsl */ `
  varying float vLife;
  varying float vShow;
  varying float vSteamy;
  #include <clipping_planes_pars_fragment>
  ${NOISE}
  void main() {
    #include <clipping_planes_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float v = (1.0 - smoothstep(0.3, 1.0, d)) * (1.0 - vLife) * (1.0 - vLife) * vShow;
    if (v < 0.01) discard;
    gl_FragColor = vec4(fireRamp(0.95 - 0.6 * vLife) * v * 1.6, 1.0);
    #include <colorspace_fragment>
  }
`;
const puffFragment = /* glsl */ `
  varying float vLife;
  varying float vShow;
  varying float vSteamy;
  #include <clipping_planes_pars_fragment>
  void main() {
    #include <clipping_planes_fragment>
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float soft = 1.0 - smoothstep(0.2, 1.0, d);
    float alpha = soft * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife) * vShow * mix(0.25, 0.6, vSteamy);
    if (alpha < 0.005) discard;
    vec3 c = mix(vec3(0.22, 0.21, 0.2), vec3(0.92, 0.94, 0.96), vSteamy);
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }
`;

function flameGeometry() {
  const pos = [], kind = [], index = [];
  const quad = (k, pts) => {
    const b = pos.length / 3;
    for (const p of pts) { pos.push(p[0], p[1], 0); kind.push(k); }
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const up = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
  const flat = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  quad(1, flat);   // over the patch first, so the sheets draw over it
  quad(2, flat);
  quad(0, up);
  quad(3, up);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(kind, 1));
  g.setIndex(index);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // placed in the shader
  return g;
}
function pointsGeometry(n, seed) {
  const pos = new Float32Array(n * 3), rand = new Float32Array(n * 3);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < n * 3; i++) rand[i] = rnd();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rand, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/**
 * The fire drawer. Each step: begin(), set(...) for each burning fire, end().
 * @param {{scene: THREE.Scene, cut?: THREE.Plane}} view
 * @param {() => number} [clock]  seconds; wall-clock by default (tools/flame-lab.html steps its own)
 */
export function makeFlames(view, clock = () => performance.now() / 1000) {
  const L = FLAME_LOOK;
  const clip = view.cut ? [view.cut] : [];
  const time = { value: 0 }, viewH = { value: 800 }, cutY = { value: 1e5 };
  const size = new THREE.Vector2();
  const tick = (renderer) => {
    time.value = clock();
    renderer.getDrawingBufferSize(size);
    viewH.value = size.y;
    // The cut plane keeps y <= constant (normal pointing down).
    cutY.value = view.cut && view.cut.normal.y < -0.5 ? view.cut.constant : 1e5;
  };
  const group = new THREE.Group();
  group.name = 'flames';
  const geometry = flameGeometry();
  const slots = [];
  for (let n = 0; n < L.slots; n++) {
    const u = {
      uTime: time, uViewH: viewH, uCutY: cutY, uBase: { value: new THREE.Vector3() }, uPatch: { value: new THREE.Vector2(1, 1) },
      uH: { value: 1 }, uCeil: { value: 2.5 }, uCrown: { value: 0.5 }, uSpread: { value: 0 },
      uPower: { value: 0 }, uEmber: { value: 0 }, uSteam: { value: 0 }, uSeed: { value: n * 1.618 },
    };
    const common = { uniforms: u, transparent: true, depthWrite: false, clipping: true, clippingPlanes: clip };
    const flame = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
      ...common, vertexShader: flameVertex, fragmentShader: flameFragment, blending: THREE.NormalBlending, premultipliedAlpha: true, side: THREE.DoubleSide,
    }));
    const sparks = new THREE.Points(pointsGeometry(L.sparks, n + 1), new THREE.ShaderMaterial({
      ...common, vertexShader: pointsVertex(false), fragmentShader: sparkFragment, blending: THREE.AdditiveBlending,
    }));
    const puffs = new THREE.Points(pointsGeometry(L.puffs, n + 101), new THREE.ShaderMaterial({
      ...common, vertexShader: pointsVertex(true), fragmentShader: puffFragment, blending: THREE.NormalBlending,
    }));
    flame.renderOrder = 4; sparks.renderOrder = 5; puffs.renderOrder = 6;   // over B's (2) and C's (3) tints
    for (const m of [flame, sparks, puffs]) { m.frustumCulled = false; m.visible = false; m.onBeforeRender = tick; group.add(m); }
    // state: 0 free, 1 burning, 2 embers
    // big: the largest patch it burned (x, z, w, d), where the embers glow after.
    slots.push({ u, meshes: [flame, sparks, puffs], key: null, state: 0, seen: false, since: 0, kW: 0, wetAt: -1e9, big: [0, 0, 0, 0] });
  }
  const lights = [];
  for (let n = 0; n < L.lights; n++) {
    // Always in the scene and visible (at zero they cost the same), so the
    // house's shaders are compiled once, not every time a fire starts.
    const light = new THREE.PointLight(0xff8a3a, 0, 9, 2);
    group.add(light);
    lights.push(light);
  }
  view.scene.add(group);

  const now = clock;
  return {
    group,
    begin() { for (const s of slots) s.seen = false; },
    /**
     * One burning fire.
     * @param {*} key  anything that identifies it from step to step
     * @param {number} x @param {number} y @param {number} z  centre of the burning patch; y at its base (m)
     * @param {number} w @param {number} d  burning patch along x and z (m)
     * @param {number} q  heat release (W)
     * @param {number} ceiling  ceiling above the base (m)
     * @param {number} crown  top of the burning thing above the base (m)
     * @param {number} wet  0..1, water landing on it
     */
    set(key, x, y, z, w, d, q, ceiling, crown, wet = 0) {
      let s = null;
      for (const t of slots) if (t.key === key && t.state !== 0) { s = t; break; }
      if (!s) for (const t of slots) if (t.state === 0) { s = t; break; }
      if (!s) {   // all taken: reuse the oldest embers
        for (const t of slots) if (t.state === 2 && (!s || t.since < s.since)) s = t;
        if (!s) return;
      }
      if (s.key !== key) { s.big[2] = 0; s.big[3] = 0; s.wetAt = -1e9; }
      s.key = key; s.state = 1; s.seen = true; s.kW = q / 1e3;
      if (w * d > s.big[2] * s.big[3]) { s.big[0] = x; s.big[1] = z; s.big[2] = w; s.big[3] = d; }
      if (wet > 0) s.wetAt = now();
      const u = s.u;
      const D = Math.sqrt((4 * Math.max(w, 0.05) * Math.max(d, 0.05)) / Math.PI);
      // Only the size follows the physics: Heskestad's flame height.
      const H = Math.max(0.12, 0.235 * Math.pow(Math.max(s.kW, 0), 0.4) - 1.02 * D);
      u.uBase.value.set(x, y, z);
      u.uPatch.value.set(Math.max(0.05, w), Math.max(0.05, d));
      u.uH.value = H;
      u.uCeil.value = ceiling;
      u.uCrown.value = Math.min(crown, ceiling - 0.05);
      u.uSpread.value = H > ceiling ? H - ceiling : 0;
      u.uPower.value = Math.min(1, 0.25 + s.kW / 40);   // a few kW is already a visible flame
    },
    end() {
      const t = now();
      for (const s of slots) {
        if (s.state === 1 && !s.seen) {
          // Out: the embers glow over all of what burned.
          s.state = 2; s.since = t;
          s.u.uBase.value.x = s.big[0]; s.u.uBase.value.z = s.big[1];
          s.u.uPatch.value.set(Math.max(0.05, s.big[2]), Math.max(0.05, s.big[3]));
        }
        if (s.state === 2) {
          const e = 1 - (t - s.since) / L.emberSeconds;
          if (e <= 0) { s.state = 0; s.key = null; }
          s.u.uPower.value = 0;
          s.u.uEmber.value = Math.max(0, e);
        } else if (s.state === 1) s.u.uEmber.value = 0;
        s.u.uSteam.value = s.state === 0 ? 0 : Math.max(0, 1 - (t - s.wetAt) / L.steamSeconds);
        for (const m of s.meshes) m.visible = s.state !== 0;
      }
      // The two biggest fires light the room, flickering.
      let used = 0;
      for (const light of lights) light.intensity = 0;
      for (let k = 0; k < lights.length; k++) {
        let best = null;
        for (const s of slots) if (s.state === 1 && !(used & (1 << slots.indexOf(s))) && (!best || s.kW > best.kW)) best = s;
        if (!best) break;
        used |= 1 << slots.indexOf(best);
        const u = best.u;
        const flicker = 0.82 + 0.12 * Math.sin(t * 9.0 + u.uSeed.value) + 0.06 * Math.sin(t * 23.0 + u.uSeed.value * 3);
        lights[k].position.set(u.uBase.value.x, u.uBase.value.y + Math.min(u.uCeil.value - 0.1, u.uCrown.value + 0.4 * u.uH.value), u.uBase.value.z);
        lights[k].intensity = L.lightPerSqrtKW * Math.sqrt(best.kW) * flicker * (1 - 0.6 * u.uSteam.value);
      }
    },
    /** Drop one fire at once, leaving no embers (a gas burner, a flash of gas). */
    drop(key) {
      for (const s of slots) if (s.key === key) { s.state = 0; s.key = null; s.wetAt = -1e9; for (const m of s.meshes) m.visible = false; }
    },
    /** Drop every fire at once, embers too (a reset). */
    clear() {
      for (const s of slots) { s.state = 0; s.key = null; s.wetAt = -1e9; for (const m of s.meshes) m.visible = false; }
      for (const light of lights) light.intensity = 0;
    },
    /** Fires drawn now, burning or as embers. */
    count() { let c = 0; for (const s of slots) if (s.state !== 0) c++; return c; },
  };
}
