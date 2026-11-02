// Drawing smoke and heat on top of the rendered house.
//
// The house is rendered first into a texture together with its depth. Then
// one full-screen pass walks a ray from the eye through every pixel, through
// the fluid grid, and stops at whatever the house drew there. Using the
// rendered depth (not the grid's walls) means a hidden roof lets you look in
// from above, and a wall in front of you hides the smoke behind it.
//
// Detail. The grid is 20 cm a cell. Seen from across the house that is fine,
// but standing a metre from the smoke each cell covers a couple of hundred
// pixels and the smoke turns into soft grey blobs. Making the grid finer is
// not affordable (half the cell size is eight times the cells, and slower to
// converge), so the physics stays coarse and the detail is added only where
// the smoke is drawn:
//  - a 3D noise texture erodes the smoke, mostly where it is thin, so edges
//    break into wisps while dense smoke stays dense;
//  - the noise is carried along by the solver's own wind, so the wisps run
//    along the ceiling and roll out under a lintel the way the smoke moves;
//  - light from above is blocked by the smoke over each point, so the layer
//    has a lit top and a dark underside, and hot smoke near the fire glows.
// Nothing here feeds back into the simulation.
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  out vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  precision highp sampler3D;
  in vec2 vUv;
  out vec4 outColor;

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler3D tVolume;      // r = smoke, g = temperature
  uniform sampler3D tVelocity;    // rgb = wind, 0.5 = still
  uniform sampler3D tNoise;       // tiling cloud noise
  uniform mat4 uInvProj;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform float uStep;            // metres per sample
  uniform float uSmokeSigma;      // how fast light dies per metre at smoke = 1
  uniform float uHeatSigma;
  uniform int uMode;              // 0 = eyes (smoke), 1 = thermal camera (heat)
  uniform float uJitter;
  uniform int uDetail;            // 0 = the plain grid, as before; 1 = with detail
  uniform float uThinGamma;       // below 1 draws thin smoke denser; 1 = as simulated
  uniform float uTime;            // simulation time (grid seconds)
  uniform float uVelRange;        // metres per grid second that a full channel means
  uniform float uNoiseTile;       // metres one tile of noise spans
  uniform float uFlowPeriod;      // grid seconds before the noise is re-seeded
  uniform vec3 uLightDir;         // towards the light

  vec3 worldAt(vec2 ndcXY, float ndcZ) {
    vec4 v = uInvProj * vec4(ndcXY, ndcZ, 1.0);
    v /= v.w;
    return (uCamWorld * v).xyz;
  }

  // The house is rendered into a texture in linear light, so everything is
  // mixed in linear and converted for the screen only at the very end.
  vec3 toLinear(vec3 c) { return pow(c, vec3(2.2)); }
  vec3 toScreen(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
  }

  // Thermal-camera palette: black, deep red, orange, pale yellow.
  vec3 heatColor(float t) {
    t = clamp(t, 0.0, 1.0);
    return toLinear(vec3(min(1.0, t * 2.2), clamp(t * 2.2 - 0.9, 0.0, 1.0), max(0.0, t * 3.0 - 2.2)));
  }

  vec3 gridUvw(vec3 p) { return (p - uBoxMin) / (uBoxMax - uBoxMin); }
  // How dense smoke looks, from the stored value. The texture holds the
  // square root of the simulated smoke (so thin smoke keeps its precision in
  // 8 bits); squaring gives the smoke back, and raising it to a power below
  // 1 makes thin, spreading smoke look denser while thick smoke barely
  // changes (0.05 shows as 0.17 at 0.6, 0.5 as 0.66, 1 stays 1). Only the
  // drawing changes; the simulation is untouched.
  float looks(float stored) { return pow(stored, 2.0 * uThinGamma); }
  float smokeAt(vec3 p) { return looks(texture(tVolume, gridUvw(p)).r); }

  // Noise that rides the wind. Sliding a texture along a velocity stretches
  // it more the longer it slides, so two copies take turns: each slides for
  // one period and is re-seeded while the other is at full weight (the
  // usual "flow map" trick from water shading).
  float flowingNoise(vec3 p, vec3 wind) {
    float a = fract(uTime / uFlowPeriod);
    float b = fract(uTime / uFlowPeriod + 0.5);
    vec3 q = p / uNoiseTile;
    vec3 shiftA = wind * (a * uFlowPeriod) / uNoiseTile;
    vec3 shiftB = wind * (b * uFlowPeriod) / uNoiseTile;
    float na = texture(tNoise, q - shiftA).r * 0.65 + texture(tNoise, (q - shiftA) * 2.9 + 0.31).r * 0.35;
    float nb = texture(tNoise, q - shiftB + 0.53).r * 0.65 + texture(tNoise, (q - shiftB) * 2.9 + 0.71).r * 0.35;
    return mix(na, nb, abs(2.0 * a - 1.0));
  }

  // Push smoke from where the noise is low to where it is high, keeping the
  // amount about the same (the noise averages a half). Thin smoke is pushed
  // hard, so it breaks into wisps with gaps between; dense smoke only a
  // little, so a thick layer stays thick.
  // A first version subtracted a fixed amount instead: most of a smoke layer
  // is thin (0.1-0.3 here), and it simply vanished.
  float detailedSmoke(float d, float n) {
    float contrast = mix(4.0, 1.2, smoothstep(0.1, 0.5, d));
    return d * clamp(1.0 + (n - 0.5) * contrast, 0.0, 2.5);
  }

  void main() {
    vec4 base = texture(tColor, vUv);
    float depth = texture(tDepth, vUv).x;
    vec2 ndc = vUv * 2.0 - 1.0;
    vec3 dir = normalize(worldAt(ndc, 1.0) - uCamPos);
    float sceneT = depth >= 1.0 ? 1e9 : length(worldAt(ndc, depth * 2.0 - 1.0) - uCamPos);

    // A thermal camera does not see colour, only how warm things are; walls
    // at room temperature read as dim grey.
    vec3 background = uMode == 1 ? vec3(dot(base.rgb, vec3(0.3, 0.59, 0.11)) * 0.22) : base.rgb;

    vec3 t0 = (uBoxMin - uCamPos) / dir, t1 = (uBoxMax - uCamPos) / dir;
    vec3 tmin = min(t0, t1), tmax = max(t0, t1);
    float tNear = max(max(tmin.x, tmin.y), max(tmin.z, 0.0));
    float tFar = min(min(tmax.x, tmax.y), min(tmax.z, sceneT));
    if (tFar <= tNear) { outColor = vec4(toScreen(background), 1.0); return; }

    float transmit = 1.0;
    vec3 glow = vec3(0.0);
    // Smoke from a fire is soot: it reflects little light and reads dark.
    // A paler grey with full light from above looked like fog or steam.
    vec3 soot = toLinear(vec3(0.26, 0.25, 0.24));
    vec3 fire = toLinear(vec3(1.0, 0.45, 0.12));
    for (int s = 0; s < 400; s++) {
      float t = tNear + (float(s) + uJitter) * uStep;
      if (t > tFar) break;
      vec3 p = uCamPos + dir * t;
      vec2 cell = texture(tVolume, gridUvw(p)).rg;
      if (uMode == 1) {
        float a = 1.0 - exp(-uHeatSigma * cell.g * uStep);
        glow += transmit * a * heatColor(cell.g * 1.2);
        transmit *= 1.0 - a;
      } else if (uDetail == 0) {
        float a = 1.0 - exp(-uSmokeSigma * looks(cell.r) * uStep);
        glow += transmit * a * toLinear(vec3(0.16, 0.15, 0.14));
        transmit *= 1.0 - a;
      } else {
        if (cell.r < 0.02) continue;      // stored as a square root: 0.02 is 0.0004 of smoke
        vec3 wind = (texture(tVelocity, gridUvw(p)).rgb - 0.5) * 2.0 * uVelRange;
        float d = detailedSmoke(looks(cell.r), flowingNoise(p, wind));
        float a = 1.0 - exp(-uSmokeSigma * d * uStep);
        // How much of the light from above reaches this point through the
        // smoke over it (coarse smoke is enough for a soft shadow).
        float over = smokeAt(p + uLightDir * 0.2) + smokeAt(p + uLightDir * 0.5) + smokeAt(p + uLightDir * 0.9);
        float lit = exp(-uSmokeSigma * 0.3 * over);
        vec3 c = soot * (0.45 + 0.75 * lit);
        // Only the hottest smoke, right over the flames, picks up their light.
        // At a lower threshold the whole rising plume glowed, which read as
        // a pillar of fire up to the ceiling.
        c += fire * smoothstep(0.75, 1.2, cell.g) * 0.7;
        glow += transmit * a * c;
        transmit *= 1.0 - a;
      }
      if (transmit < 0.02) break;
    }
    outColor = vec4(toScreen(background * transmit + glow), 1.0);
  }
`;

/**
 * Tiling 3D "billow" noise, values 0…255, periodic so it repeats without seams.
 *
 * Inverted cellular (Worley) noise: scatter one point per lattice cell and
 * score each voxel by how close the nearest point is. That makes round
 * puffs with creases between them, the cauliflower look of smoke and
 * cumulus. A first version used smooth value noise instead, which along a
 * ray several metres long averaged out into an even haze.
 */
function cloudNoise(size = 64) {
  const out = new Uint8Array(size * size * size);
  const octaves = [{ cells: 4, amp: 0.6 }, { cells: 8, amp: 0.28 }, { cells: 16, amp: 0.12 }];
  let seed = 1234567;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const points = octaves.map((o) => Float32Array.from({ length: o.cells ** 3 * 3 }, rand));
  let lo = Infinity, hi = -Infinity;
  const raw = new Float32Array(size * size * size);
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0;
    octaves.forEach((o, n) => {
      const c = o.cells, P = points[n];
      const fx = (x / size) * c, fy = (y / size) * c, fz = (z / size) * c;
      const cx = Math.floor(fx), cy = Math.floor(fy), cz = Math.floor(fz);
      let best = 9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const ix = cx + dx, iy = cy + dy, iz = cz + dz;
        const w = (a) => ((a % c) + c) % c;
        const k = (w(ix) + c * (w(iy) + c * w(iz))) * 3;
        const px = ix + P[k] - fx, py = iy + P[k + 1] - fy, pz = iz + P[k + 2] - fz;
        best = Math.min(best, px * px + py * py + pz * pz);
      }
      v += o.amp * (1 - Math.min(1, Math.sqrt(best)));
    });
    const i = x + size * (y + size * z);
    raw[i] = v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  // Stretch to the full range: the sum of octaves bunches up around the middle.
  for (let i = 0; i < raw.length; i++) out[i] = Math.round(((raw[i] - lo) / (hi - lo)) * 255);
  return out;
}

// Wind is packed into bytes around 128; this many cells per second is the
// most a channel can hold. The plume tops out near 25.
const VEL_RANGE_CELLS = 32;

export class SmokePass {
  constructor(renderer, grid) {
    this.renderer = renderer;
    this.grid = grid;
    this.detail = true;
    this.thinGamma = 0.6;
    this.time = 0;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      depthTexture: new THREE.DepthTexture(size.x, size.y),
    });

    const { nx, ny, nz } = grid;
    const data3d = (bytes, format) => {
      const t = new THREE.Data3DTexture(bytes, nx, ny, nz);
      t.format = format;
      t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.unpackAlignment = 1;
      t.needsUpdate = true;
      return t;
    };
    this.voxels = new Uint8Array(nx * ny * nz * 2);
    this.volume = data3d(this.voxels, THREE.RGFormat);
    this.windBytes = new Uint8Array(nx * ny * nz * 4).fill(128);
    this.velocity = data3d(this.windBytes, THREE.RGBAFormat);

    const n = 64;
    this.noise = new THREE.Data3DTexture(cloudNoise(n), n, n, n);
    this.noise.format = THREE.RedFormat;
    this.noise.type = THREE.UnsignedByteType;
    this.noise.minFilter = this.noise.magFilter = THREE.LinearFilter;
    this.noise.wrapS = this.noise.wrapT = this.noise.wrapR = THREE.RepeatWrapping;
    this.noise.unpackAlignment = 1;
    this.noise.needsUpdate = true;

    const boxMin = grid.origin.clone();
    const boxMax = grid.origin.clone().add(new THREE.Vector3(nx, ny, nz).multiplyScalar(grid.cell));
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader, fragmentShader,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        tVolume: { value: this.volume },
        tVelocity: { value: this.velocity },
        tNoise: { value: this.noise },
        uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() },
        uBoxMin: { value: boxMin },
        uBoxMax: { value: boxMax },
        uStep: { value: grid.cell * 0.5 },
        uSmokeSigma: { value: 4.0 },
        uHeatSigma: { value: 2.5 },
        uMode: { value: 0 },
        uJitter: { value: 0 },
        uDetail: { value: 1 },
        uThinGamma: { value: 0.6 },
        uTime: { value: 0 },
        uVelRange: { value: VEL_RANGE_CELLS * grid.cell },
        uNoiseTile: { value: 1.6 },
        uFlowPeriod: { value: 3.0 },
        uLightDir: { value: new THREE.Vector3(0.25, 1, 0.15).normalize() },
      },
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.postScene = new THREE.Scene();
    this.postScene.add(this.quad);
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
  }

  /** Copy the fluid's smoke, heat and wind (interior cells only) into the 3D textures. */
  upload(fluid) {
    const { nx, ny, nz } = this.grid;
    const { sy, sz, dens, temp, u, v, w } = fluid;
    const k8 = 127 / VEL_RANGE_CELLS;
    const pack = (x) => Math.max(0, Math.min(255, 128 + x * k8));
    let o = 0, o4 = 0;
    for (let k = 1; k <= nz; k++) for (let j = 1; j <= ny; j++) {
      let c = 1 + sy * j + sz * k;
      for (let i = 1; i <= nx; i++, c++, o += 2, o4 += 4) {
        this.voxels[o] = Math.min(255, Math.sqrt(Math.max(0, dens[c]) / 1.5) * 255);
        this.voxels[o + 1] = Math.min(255, temp[c] * 212);
        this.windBytes[o4] = pack(u[c]);
        this.windBytes[o4 + 1] = pack(v[c]);
        this.windBytes[o4 + 2] = pack(w[c]);
      }
    }
    this.volume.needsUpdate = true;
    this.velocity.needsUpdate = true;
  }

  render(scene, camera, mode) {
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    const u = this.material.uniforms;
    camera.updateMatrixWorld();
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uMode.value = mode === 'heat' ? 1 : 0;
    u.uJitter.value = Math.random();
    u.uDetail.value = this.detail ? 1 : 0;
    u.uThinGamma.value = this.thinGamma;
    u.uTime.value = this.time;
    this.renderer.render(this.postScene, this.postCamera);
  }
}
