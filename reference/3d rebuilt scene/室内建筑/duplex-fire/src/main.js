// Step 1 of the Duplex fire: the whole house in the smoke solver, seen from
// above, see-through or one storey at a time, with a fire you can move.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { readLayer, buildGrid, HouseFire, poolAt, CELL } from './house.js';
import { SmokePass } from './smoke-pass.js';
import { fadeForZone } from './firezone.js';
import { dressDuplex } from './dressing.js';
import { Doors } from './doors.js';
import { thickenPipes } from './pipes.js';
import { buildObjects, ensureKitchenGas } from './objects.js';
import { World } from './world.js';
import { mountAholoAssets } from './aholo.js';

const DATA = '../duplex-overlay/data';
// A storey on its own is shown cut just under its own ceiling; 'all' shows
// the whole house, see-through.
const LEVELS = {
  all: { cut: 1e6 },
  1: { floor: 0, cut: 2.55 },
  2: { floor: 3.12, cut: 5.65 },
};
// The thermal view's palette tops out here, in kelvin above ambient. The flame
// itself is held at 800, so only the air over the fire glows.
const HEAT_SCALE = 600;

const status = document.getElementById('status');
const fireInfo = document.getElementById('fire');

const meta = await (await fetch(`${DATA}/meta.json`)).json();
const load = async (name) => readLayer(meta, name, await (await fetch(`${DATA}/${name}.bin`)).arrayBuffer());
const building = await load('building');
const extras = { furniture: await load('furniture'), fixtures: await load('fixtures') };
/** Append synthetic pipe/valve boxes into a readLayer service mesh before thickenPipes. */
function appendServiceBoxes(layer, elements, rgb255) {
  if (!elements?.length) return;
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const bPos = unitBox.attributes.position, bIdx = unitBox.index.array;
  const vPerBox = bPos.count, iPerBox = bIdx.length;
  const oldPos = layer.geometry.attributes.position;
  const oldCol = layer.geometry.attributes.color;
  const oldIdx = layer.geometry.index;
  const totalVerts = oldPos.count + elements.length * vPerBox;
  const totalIdx = oldIdx.count + elements.length * iPerBox;
  const posArr = new Float32Array(totalVerts * 3);
  const colArr = new Uint8Array(totalVerts * 3);
  const IdxArr = totalVerts > 65535 ? Uint32Array : Uint16Array;
  const idxArr = new IdxArr(totalIdx);
  posArr.set(oldPos.array);
  colArr.set(oldCol.array);
  idxArr.set(oldIdx.array);
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  const colAttr = new THREE.BufferAttribute(colArr, 3, true);
  const idxAttr = new THREE.BufferAttribute(idxArr, 1);
  for (const m of layer.elements) m.geometry.setAttribute('position', posAttr);
  const pickMat = layer.elements[0]?.material ?? new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  let vBase = oldPos.count, iBase = oldIdx.count;
  for (const e of elements) {
    const cx = (e.min[0] + e.max[0]) / 2, cy = (e.min[1] + e.max[1]) / 2, cz = (e.min[2] + e.max[2]) / 2;
    const sx = e.max[0] - e.min[0], sy = e.max[1] - e.min[1], sz = e.max[2] - e.min[2];
    for (let k = 0; k < vPerBox; k++) {
      const o = (vBase + k) * 3;
      posArr[o] = cx + bPos.getX(k) * sx;
      posArr[o + 1] = cy + bPos.getY(k) * sy;
      posArr[o + 2] = cz + bPos.getZ(k) * sz;
      colArr[o] = rgb255[0]; colArr[o + 1] = rgb255[1]; colArr[o + 2] = rgb255[2];
    }
    for (let k = 0; k < iPerBox; k++) idxArr[iBase + k] = vBase + bIdx[k];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', posAttr);
    g.setIndex(new THREE.BufferAttribute(idxArr.subarray(iBase, iBase + iPerBox), 1));
    g.boundingBox = new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, pickMat);
    mesh.userData.element = e;
    layer.elements.push(mesh);
    vBase += vPerBox;
    iBase += iPerBox;
  }
  unitBox.dispose();
  layer.geometry.setAttribute('position', posAttr);
  layer.geometry.setAttribute('color', colAttr);
  layer.geometry.setIndex(idxAttr);
  layer.geometry.computeVertexNormals();
}

// The services, from the MEP file, in the overlay's colours.
const SERVICES = ['gas', 'electrical', 'water', 'heating'];
const services = {};
for (const name of SERVICES) {
  services[name] = await load(name);
  if (name === 'gas') appendServiceBoxes(services.gas, ensureKitchenGas(meta), [255, 196, 0]);
  thickenPipes(services[name]);
  // Boost pipe colour saturation and bake gentle 3D tube shading in linear space
  // so X-ray pipes read vividly without blowing out under the 7.5 sun light.
  const geo = services[name].geometry;
  const srcCol = geo.attributes.color, nrm = geo.attributes.normal;
  const shaded = new Float32Array(srcCol.count * 3);
  for (let i = 0; i < srcCol.count; i++) {
    let r = Math.pow(srcCol.getX(i), 2.2), g = Math.pow(srcCol.getY(i), 2.2), b = Math.pow(srcCol.getZ(i), 2.2);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = Math.min(1, Math.max(0, luma + (r - luma) * 1.55));
    g = Math.min(1, Math.max(0, luma + (g - luma) * 1.55));
    b = Math.min(1, Math.max(0, luma + (b - luma) * 1.55));
    const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i);
    const tube = 0.64 + 0.36 * Math.abs(0.38 * nx + 0.72 * ny + 0.58 * nz);
    shaded[i * 3] = r * tube; shaded[i * 3 + 1] = g * tube; shaded[i * 3 + 2] = b * tube;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(shaded, 3));
}

const grid = buildGrid(building, CELL);
const rooms = meta.rooms.filter((r) => r.code !== 'R301');
const roomAt = (x, z, level) => rooms.find((r) =>
  x >= r.min[0] && x <= r.max[0] && z >= r.min[2] && z <= r.max[2] && Math.abs(r.min[1] - LEVELS[level].floor) < 0.3);

// --- scene ---------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.localClippingEnabled = true;
document.getElementById('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111418);
const hemi = new THREE.HemisphereLight(0xffffff, 0x505050, 2.2);
scene.add(hemi);

const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), LEVELS.all.cut);
const dressed = dressDuplex({ renderer, scene, building, clippingPlanes: [cut], hemi });
// Furniture and fixtures share their own independent opacity material (see setFurnitureOpacity).
const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cut] });
const extraMeshes = {};
for (const [name, layer] of Object.entries(extras)) {
  extraMeshes[name] = new THREE.Mesh(layer.geometry, material);
  extraMeshes[name].castShadow = extraMeshes[name].receiveShadow = true;
  scene.add(extraMeshes[name]);
}
// Pipes draw in saturated X-ray over walls and slabs, but under B's flames (renderOrder 4..6).
const serviceMaterial = new THREE.MeshBasicMaterial({
  vertexColors: true, side: THREE.DoubleSide, transparent: true,
  depthTest: false, depthWrite: false, clippingPlanes: [cut],
});
const serviceMeshes = {};
for (const [name, layer] of Object.entries(services)) {
  serviceMeshes[name] = new THREE.Mesh(layer.geometry, serviceMaterial);
  serviceMeshes[name].renderOrder = 3.5;
  scene.add(serviceMeshes[name]);
}

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
// Pause sim steps briefly during active orbit/zoom so camera stays responsive without changing dt.
let interacting = false, wheelUntil = 0;
controls.addEventListener('start', () => { interacting = true; });
controls.addEventListener('end', () => { interacting = false; });
renderer.domElement.addEventListener('wheel', () => { wheelUntil = performance.now() + 160; }, { passive: true });
const centre = grid.bounds.getCenter(new THREE.Vector3());
controls.target.set(centre.x, 0.5, centre.z);
camera.position.set(centre.x - 9, 17, centre.z + 12);

const smoke = new SmokePass(renderer, grid);
smoke.smokeScale = 1;
smoke.heatScale = HEAT_SCALE;
let uploadDirty = true;

// --- fire ------------------------------------------------------------------------
let level = 'all';
let simTime = 0;
const start = rooms.find((r) => r.code === 'A102');
const firePos = { x: (start.min[0] + start.max[0]) / 2, z: (start.min[2] + start.max[2]) / 2 };
let fireLevel = 1;
// Start calm and unlit: fire begins when "Start 默认起火" or "Ignite 点火" is used.
const fire = new HouseFire({ grid, pool: new Int32Array(0) });

const doors = new Doors({ scene, building, grid, fire, rooms, dressedDoors: dressed.groups.door, cut, renderer });

// The object table and the mechanisms that act on it (world.js). The
// mechanism files are loaded further down, once the page is set up.
const materials = await (await fetch(new URL('./materials.json', import.meta.url))).json();
const objects = buildObjects(meta, grid, materials);
const aholo = await mountAholoAssets({ meta, extras, extraMeshes, objects, cut, scene, renderer });
const world = new World({ fire, grid, objects, rooms, materials });

function showLevel(lvl) {
  level = lvl;
  cut.constant = LEVELS[lvl].cut;
  smoke.clipY = LEVELS[lvl].cut;
  for (const b of document.querySelectorAll('[data-level]')) b.classList.toggle('on', b.dataset.level === String(lvl));
}
for (const b of document.querySelectorAll('[data-level]')) {
  b.addEventListener('click', () => showLevel(b.dataset.level === 'all' ? 'all' : +b.dataset.level));
}

const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const rayAt = (ev) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  return ray.ray;
};
const floorPoint = (ev, lvl) => {
  rayAt(ev);
  const p = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -LEVELS[lvl].floor), p)) return null;
  return roomAt(p.x, p.z, lvl) ? { p, lvl } : null;
};

renderer.domElement.addEventListener('pointermove', (ev) => {
  doors.hover(doors.pick(rayAt(ev)));
});
renderer.domElement.addEventListener('pointerleave', () => { doors.hover(null); });

// uFocus (0..1) greys the whole house out, so that what a mechanism draws with
// its own materials stands out (water.js's water view, gas.js's gas view).
const fade = { uFadeMode: { value: 0 }, uFadeDist: { value: 0 }, uFocus: { value: 0 } };
const fadeMaterials = [
  ...Object.values(dressed.groups).map((m) => m.material),
  material, serviceMaterial, doors.material, ...aholo.materials,
];
for (const m of fadeMaterials) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade);
    shader.vertexShader = 'varying vec3 vFadeWorld;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vFadeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = 'uniform float uFocus;\nvarying vec3 vFadeWorld;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float grey = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)) * 0.6;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(grey), uFocus);`);
  };
  m.customProgramCacheKey = () => 'fade-focus';
  m.needsUpdate = true;
}
// The house gives way in front of the fire zone (firezone.js): front walls,
// ceilings and upper slabs open a clean window, while the fire's own floor,
// back walls, same-storey furniture and X-ray pipes remain intact.
for (const [kind, mesh] of Object.entries(dressed.groups)) {
  const floorLike = kind === 'boards' || kind === 'tiles' || kind === 'slab';
  fadeForZone(mesh.material, smoke.zone, { mode: floorLike ? 1 : 0 });
}
fadeForZone(doors.material, smoke.zone, { mode: 0 });
fadeForZone(material, smoke.zone, { mode: 2 });
for (const m of aholo.materials) fadeForZone(m, smoke.zone, { mode: 2 });

// Pointing at a door makes it breathe; double-clicking it opens or shuts it.
renderer.domElement.addEventListener('dblclick', (ev) => {
  const door = doors.pick(rayAt(ev));
  if (door) {
    doors.toggle(door);
    uploadDirty = true;
  }
});

// --- controls ------------------------------------------------------------------
let running = false, userPaused = false, simSpeed = 1, simAccum = 0, mode = 'smoke';
const runButton = document.getElementById('run');
function syncRunButton() {
  runButton.textContent = running ? 'Pause 暂停' : 'Run 继续';
}
function startSim() {
  running = true;
  userPaused = false;
  syncRunButton();
  uploadDirty = true;
}
function lightFloor(x, y, z) {
  const lvl = y > 1.5 ? 2 : 1;
  const pool = poolAt(grid, x, z, LEVELS[lvl].floor);
  if (pool.length === 0) return false;
  firePos.x = x; firePos.z = z; fireLevel = lvl;
  fire.setPool(pool);
  uploadDirty = true;
  world.combustion?.redraw?.();
  return true;
}
function resetAll() {
  running = false;
  userPaused = false;
  simAccum = 0;
  simTime = 0;
  fire.reset();
  fire.setPool(new Int32Array(0));
  world.reset();
  world.actions?.reset?.();
  world.combustion?.redraw?.();
  syncRunButton();
  uploadDirty = true;
}
function startDefaultFire() {
  const activeCount = (world.combustion?.burningCount?.() ?? 0) + (fire.heatRelease() > 0 ? 1 : 0);
  if (simTime > 0 || activeCount > 0) resetAll();
  // Ignite A102 living-room sofa e159 at its SW corner beside sofa e158 & coffee table.
  const sofa = objects.list.find((o) => o.material === 'sofa' && o.room?.startsWith('A102') && o.max[0] - o.min[0] > 1.5)
    ?? objects.list.find((o) => o.material === 'sofa' && o.room?.startsWith('A102'));
  if (sofa) {
    const sx = sofa.min[0] + 0.26, sz = (sofa.min[2] + sofa.max[2]) * 0.5;
    firePos.x = sx; firePos.z = sz; fireLevel = 1;
    world.ignite?.(sofa, 'lighter', sx, sz);
    world.combustion?.redraw?.();
  } else {
    lightFloor(firePos.x, LEVELS[1].floor, firePos.z);
  }
  startSim();
}
function placeFire(x, z, lvl = 1) {
  resetAll();
  const ok = lightFloor(x, LEVELS[lvl].floor, z);
  if (ok) startSim();
  return ok;
}
let fastForwardUntil = null;
function setSpeed(s) {
  simSpeed = s;
  simAccum = 0;
  // Scale solver dt safely (mac3d CFL-substeps scalar advection and caps eddy viscosity)
  // so 4× and 12× actually reach high wall-clock speed instead of hitting a 2.5× CPU ceiling.
  fire.dt = s >= 10 ? 0.14 : s >= 4 ? 0.08 : 0.05;
  for (const b of document.querySelectorAll('[data-speed]')) b.classList.toggle('on', +b.dataset.speed === s);
}
function fastForward(seconds = 30) {
  const activeCount = (world.combustion?.burningCount?.() ?? 0) + (fire.heatRelease() > 0 ? 1 : 0);
  if (simTime === 0 && activeCount === 0 && !(world.gas?.status?.().outlets?.length > 0) && !(world.water?.status?.().outlets?.length > 0)) {
    startDefaultFire();
  }
  fastForwardUntil = Math.max(fastForwardUntil ?? fire.time, fire.time) + seconds;
  uploadDirty = true;
}
document.getElementById('startFire')?.addEventListener('click', startDefaultFire);
document.getElementById('ffwd')?.addEventListener('click', () => fastForward(30));
runButton.addEventListener('click', () => {
  fastForwardUntil = null;
  running = !running;
  userPaused = !running;
  simAccum = 0;
  syncRunButton();
});
document.getElementById('restart').addEventListener('click', () => {
  fastForwardUntil = null;
  fire.dt = simSpeed >= 10 ? 0.14 : simSpeed >= 4 ? 0.08 : 0.05;
  resetAll();
});
for (const b of document.querySelectorAll('[data-speed]')) {
  b.addEventListener('click', () => setSpeed(+b.dataset.speed));
}
syncRunButton();
for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.classList.toggle('on', o === b);
    document.getElementById('legend').hidden = mode !== 'heat';
  });
}

// The thermal view's colour bar, in degrees Celsius. The palette is not in
// proportion to temperature: smoke-pass.js stores heat as a square root and
// draws it raised to heatGamma, so low heat shows stronger. The ticks are
// placed by the same sums, so each one sits on the colour it is drawn in.
// The colour of a thick, uniform layer; a thin one shows paler.
const AMBIENT_C = 20;   // windy.js takes ambient as 293 K
function drawLegend() {
  const canvas = document.getElementById('legendBar');
  const g = canvas.getContext('2d');
  const { width: w, height: h } = canvas;
  const heatColour = (t) => [Math.min(1, t * 2.2), Math.min(1, Math.max(0, t * 2.2 - 0.9)), Math.max(0, t * 3 - 2.2)];
  for (let y = 0; y < h; y++) {
    const t = 1 - y / (h - 1);   // hottest at the top
    const [r, gr, b] = heatColour(t).map((c) => Math.round(c * 255));
    g.fillStyle = `rgb(${r},${gr},${b})`;
    g.fillRect(0, y, w, 1);
  }
  // Where a temperature lands on the bar: the shader's own steps, in order.
  const position = (celsius) => {
    const stored = Math.sqrt(Math.min(1, Math.max(0, celsius - AMBIENT_C) / HEAT_SCALE));
    return Math.min(1, Math.pow(stored, 2 * smoke.heatGamma) * 1.2);
  };
  const top = HEAT_SCALE * Math.pow(1 / 1.2, 1 / smoke.heatGamma) + AMBIENT_C;   // the palette runs out here
  const ticks = document.getElementById('legendTicks');
  ticks.innerHTML = '';
  for (const c of [20, 40, 60, 100, 150, 200, 300, Math.round(top / 10) * 10]) {
    const span = document.createElement('span');
    span.textContent = c >= top - 5 ? `${c}+ °C` : `${c} °C`;
    span.style.top = `${(1 - position(c)) * 100}%`;
    ticks.appendChild(span);
  }
}
drawLegend();
const furnitureBox = document.getElementById('furniture');
const furnitureOpacity = document.getElementById('furnitureOpacity');
let lastFurnitureOpacity = 1;
const applyFurnitureOpacity = (o) => {
  const shown = o > 0.005;
  const solid = o >= 0.99;
  extraMeshes.furniture.visible = extraMeshes.fixtures.visible = shown;
  extraMeshes.furniture.renderOrder = extraMeshes.fixtures.renderOrder = solid ? 0 : 1;
  material.opacity = solid ? 1 : o;
  material.transparent = !solid;
  material.depthWrite = solid;
  material.needsUpdate = true;
  aholo.setOpacity(o);
  if (shown) lastFurnitureOpacity = o;
  furnitureBox.checked = shown;
  document.getElementById('furnitureOpacityVal').textContent = o.toFixed(2);
  if (world.view) world.view.furnitureOpacity = o;
  world.combustion?.paint?.();
  world.radiation?.paint?.();
  renderer.shadowMap.needsUpdate = true;
};
furnitureOpacity.addEventListener('input', () => applyFurnitureOpacity(+furnitureOpacity.value));
furnitureBox.addEventListener('change', () => {
  const next = furnitureBox.checked ? (lastFurnitureOpacity > 0.05 ? lastFurnitureOpacity : 1) : 0;
  furnitureOpacity.value = String(next);
  applyFurnitureOpacity(next);
});
const roofBox = document.getElementById('roof');
const setRoof = () => { dressed.groups.roof.visible = roofBox.checked; renderer.shadowMap.needsUpdate = true; };
roofBox.addEventListener('change', setRoof);
setRoof();
const opacity = document.getElementById('opacity');
const setOpacity = () => {
  const o = +opacity.value;
  dressed.setOpacity(o);
  doors.setOpacity(o);
  document.getElementById('opacityVal').textContent = o.toFixed(2);
};
opacity.addEventListener('input', setOpacity);
setOpacity();
applyFurnitureOpacity(+furnitureOpacity.value);
// How dense smoke (and, in the thermal view, heat) is drawn: scales how fast
// light dies through it. Drawing only; the simulation is untouched.
const SMOKE_SIGMA = smoke.material.uniforms.uSmokeSigma.value;
const HEAT_SIGMA = smoke.material.uniforms.uHeatSigma.value;
const smokeOpacity = document.getElementById('smokeOpacity');
const setSmokeOpacity = () => {
  const k = +smokeOpacity.value;
  smoke.material.uniforms.uSmokeSigma.value = SMOKE_SIGMA * k;
  smoke.material.uniforms.uHeatSigma.value = HEAT_SIGMA * k;
  document.getElementById('smokeOpacityVal').textContent = `×${k.toFixed(2)}`;
};
smokeOpacity.addEventListener('input', setSmokeOpacity);
setSmokeOpacity();
// 火区透视度: how far smoke and house in front of the burning area give way
// (firezone.js). 0 draws the page exactly as before. Built here, under the
// smoke slider, so index.html is untouched.
{
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<label style="flex:1" title="Smoke, walls and floors between you and what is burning turn see-through 着火区域前面挡着的烟和墙变透明">' +
    'Fire zone see-through 火区透视度 <span id="zoneSeeVal"></span><br>' +
    '<input type="range" id="zoneSee" min="0" max="1" step="0.05" value="1" style="width:100%"></label>';
  smokeOpacity.closest('.row').after(row);
  const see = row.querySelector('#zoneSee');
  const setSee = () => { smoke.zone.see = +see.value; row.querySelector('#zoneSeeVal').textContent = (+see.value).toFixed(2); };
  see.addEventListener('input', setSee);
  setSee();
}
for (const name of SERVICES) {
  const box = document.getElementById(`show-${name}`);
  const sync = () => { serviceMeshes[name].visible = box.checked; };
  box.addEventListener('change', sync);
  sync();
}
const pipeOpacity = document.getElementById('pipeOpacity');
const setPipeOpacity = () => {
  const o = +pipeOpacity.value;
  serviceMaterial.visible = o > 0.005;
  serviceMaterial.opacity = o;
  serviceMaterial.transparent = true;
  serviceMaterial.depthTest = false;
  serviceMaterial.depthWrite = false;
  serviceMaterial.needsUpdate = true;
  document.getElementById('pipeOpacityVal').textContent = o.toFixed(2);
};
pipeOpacity.addEventListener('input', setPipeOpacity);
setPipeOpacity();

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  smoke.setSize();
}
addEventListener('resize', resize);
resize();
showLevel('all');

// --- mechanisms -------------------------------------------------------------------
// What a mechanism that draws or picks may need from the page.
world.view = {
  scene, camera, renderer, controls, cut, building, dressed, doors, meta, extras, extraMeshes,
  services, serviceMeshes, smoke, rayAt, floorPoint, roomAt, LEVELS, focus: fade.uFocus,
  furnitureOpacity: +furnitureOpacity.value,
  startSim, lightFloor, startDefaultFire, resetAll, setSpeed, fastForward,
  isRunning: () => running,
  isUserPaused: () => userPaused,
  getLevel: () => level,
};
await world.load();

// --- loop ------------------------------------------------------------------------
let stepMs = 0, renderMs = 0, wallSeconds = 0;
const clock = new THREE.Clock();
const combustionModule = world.modules.find((m) => m.name === 'combustion');   // fills the fire zone
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const interactive = interacting || performance.now() < wheelUntil;
  if (fastForwardUntil != null && !interactive) {
    const prevDt = fire.dt;
    fire.dt = 0.15;
    let steps = 0;
    const t0 = performance.now();
    while (fire.time < fastForwardUntil && steps < 14 && performance.now() - t0 < 52) {
      const s = performance.now();
      world.step();
      stepMs = stepMs ? stepMs * 0.9 + (performance.now() - s) * 0.1 : performance.now() - s;
      steps++;
    }
    fire.dt = prevDt;
    simTime = fire.time;
    uploadDirty = true;
    if (fire.time >= fastForwardUntil) fastForwardUntil = null;
  } else if (running && !interactive) {
    simAccum = Math.min(simAccum + dt * simSpeed, fire.dt * 10);
    let steps = 0;
    const t0 = performance.now();
    while (simAccum >= fire.dt && steps < 10 && (steps === 0 || performance.now() - t0 < 46)) {
      const s = performance.now();
      world.step();
      stepMs = stepMs ? stepMs * 0.9 + (performance.now() - s) * 0.1 : performance.now() - s;
      simAccum -= fire.dt;
      steps++;
    }
    if (steps > 0) {
      simTime = fire.time;
      wallSeconds += dt;
      uploadDirty = true;
    }
  }
  doors.update(clock.elapsedTime);
  const r0 = performance.now();
  if (uploadDirty || smoke._lastFluid !== fire.fluid) {
    smoke.upload(fire);
    uploadDirty = false;
  }
  // What is burning now (combustion.js), for the fire zone; none without it.
  if (combustionModule && !combustionModule.off) world.combustion.fireZone(smoke.zone);
  else { smoke.zone.begin(); smoke.zone.end(); }
  controls.update();
  smoke.time = simTime;
  smoke.render(scene, camera, mode);
  const rCost = performance.now() - r0;
  renderMs = renderMs ? renderMs * 0.9 + rCost * 0.1 : rCost;

  const note = doors.currentNotice();
  const totalHRR = world.combustion?.totalHRR?.() ?? fire.heatRelease();
  const burningN = (world.combustion?.burningCount?.() ?? 0) + (fire.heatRelease() > 0 ? 1 : 0);
  if (burningN === 0 && simTime === 0) {
    fireInfo.textContent = 'Ready 待命 · Click "Start 默认起火" or pick "Ignite 点火" 点「默认起火」或右下角「点火」' +
      (note ? ` · ${note}` : '');
  } else {
    const kw = totalHRR >= 1e6 ? `${(totalHRR / 1e6).toFixed(2)} MW` : `${(totalHRR / 1000).toFixed(0)} kW`;
    const ffText = fastForwardUntil != null ? ` · Fast-forward 快进 → ${Math.floor(fastForwardUntil / 60)}:${String(Math.floor(fastForwardUntil % 60)).padStart(2, '0')}` : '';
    fireInfo.textContent = `Fire 燃烧中: ${kw} · ${burningN} burning 处火源` +
      (ffText || (!running ? ' · Paused 已暂停' : simSpeed > 1 ? ` · ${simSpeed}×` : '')) +
      (note ? ` · ${note}` : '');
  }
  status.textContent = `t ${Math.floor(simTime / 60)}:${String(Math.floor(simTime % 60)).padStart(2, '0')} (${simSpeed}×) · ` +
    `${grid.nx}×${grid.ny}×${grid.nz} grid, ${fire.fluid.length} air cells · step ${stepMs.toFixed(0)} ms · render ${renderMs.toFixed(1)} ms · ` +
    `${(fire.dt / (stepMs / 1000 || 1)).toFixed(1)}× real time at most` +
    // Each mechanism's share of the step (world.js), against the 10 ms budget.
    world.timings().slice(1).map((t) => ` · ${t.name} ${t.ms.toFixed(1)} ms${t.off ? ' (off)' : ''}`).join('');
}
renderer.setAnimationLoop(frame);

// For poking at it from the console; frame() draws once even in a hidden tab.
window.duplexFire = {
  fire, grid, placeFire, startDefaultFire, resetAll, setSpeed, showLevel,
  camera, meta, frame, dressed, serviceMeshes, serviceMaterial, doors, world, objects,
};
