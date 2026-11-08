// Step 1 of the Duplex fire: the whole house in the smoke solver, seen from
// above, see-through or one storey at a time, with a fire you can move.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH, CELL } from './house.js';
import { SmokePass } from './smoke-pass.js';
import { dressDuplex } from './dressing.js';

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
// The services, from the MEP file, in the overlay's colours: only to see
// where they run. Nothing here is in the simulation yet.
const SERVICES = ['gas', 'electrical', 'water', 'heating'];
const services = {};
for (const name of SERVICES) services[name] = await load(name);

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
// Furniture stays solid: it is what the eye measures the rooms by.
const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cut] });
const extraMeshes = {};
for (const [name, layer] of Object.entries(extras)) {
  extraMeshes[name] = new THREE.Mesh(layer.geometry, material);
  extraMeshes[name].castShadow = extraMeshes[name].receiveShadow = true;
  scene.add(extraMeshes[name]);
}
// Pipes have their own material so they can be faded apart from the walls.
// Too thin to matter for the sun, so they cast no shadow.
const serviceMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, clippingPlanes: [cut] });
const serviceMeshes = {};
for (const [name, layer] of Object.entries(services)) {
  serviceMeshes[name] = new THREE.Mesh(layer.geometry, serviceMaterial);
  scene.add(serviceMeshes[name]);
}

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
const centre = grid.bounds.getCenter(new THREE.Vector3());
controls.target.set(centre.x, 0.5, centre.z);
camera.position.set(centre.x - 9, 17, centre.z + 12);

const smoke = new SmokePass(renderer, grid);
smoke.smokeScale = 1;
smoke.heatScale = HEAT_SCALE;

// --- fire ------------------------------------------------------------------------
let level = 'all';
const start = rooms.find((r) => r.code === 'A102');
const firePos = { x: (start.min[0] + start.max[0]) / 2, z: (start.min[2] + start.max[2]) / 2 };
const fire = new HouseFire({ grid, pool: poolAt(grid, firePos.x, firePos.z, LEVELS[1].floor) });

const marker = new THREE.Mesh(
  new THREE.ConeGeometry(0.22, 0.6, 16),
  new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.32, 0.42, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }));
const fireMarker = new THREE.Group();
fireMarker.add(marker, ring);
marker.position.y = 0.3;
ring.position.y = 0.02;
scene.add(fireMarker);

let fireLevel = 1;
/** Move the fire and start again from nothing: a design fire grows from t = 0. */
function placeFire(x, z, lvl) {
  const pool = poolAt(grid, x, z, LEVELS[lvl].floor);
  if (pool.length === 0) return false;
  firePos.x = x; firePos.z = z; fireLevel = lvl;
  fire.reset();
  fire.setPool(pool);
  simTime = 0;
  return true;
}

function showLevel(lvl) {
  level = lvl;
  cut.constant = LEVELS[lvl].cut;
  smoke.clipY = LEVELS[lvl].cut;
  for (const b of document.querySelectorAll('[data-level]')) b.classList.toggle('on', b.dataset.level === String(lvl));
}
for (const b of document.querySelectorAll('[data-level]')) {
  b.addEventListener('click', () => showLevel(b.dataset.level === 'all' ? 'all' : +b.dataset.level));
}
// With both storeys showing, the fire stays on its own storey: a click cannot
// tell which floor was meant. Pick a storey to move it between floors.
const floorLevel = () => (level === 'all' ? fireLevel : level);

// Dragging the flame moves the fire; so does a double-click on a floor.
const ray = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPoint = (ev) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -LEVELS[floorLevel()].floor), p) ? p : null;
};
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(pointer, camera);
  if (fireMarker.visible && ray.intersectObject(fireMarker, true).length) {
    dragging = true;
    controls.enabled = false;
  }
});
addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const p = floorPoint(ev);
  if (p && roomAt(p.x, p.z, floorLevel())) fireMarker.position.set(p.x, LEVELS[floorLevel()].floor, p.z);
});
addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  controls.enabled = true;
  placeFire(fireMarker.position.x, fireMarker.position.z, floorLevel());
});
renderer.domElement.addEventListener('dblclick', (ev) => {
  const p = floorPoint(ev);
  if (p && roomAt(p.x, p.z, floorLevel())) placeFire(p.x, p.z, floorLevel());
});

// --- controls ------------------------------------------------------------------
let running = true, mode = 'smoke';
const runButton = document.getElementById('run');
runButton.addEventListener('click', () => {
  running = !running;
  runButton.textContent = running ? 'Pause 暂停' : 'Run 继续';
});
document.getElementById('restart').addEventListener('click', () => placeFire(firePos.x, firePos.z, fireLevel));
const growth = document.getElementById('growth');
growth.addEventListener('change', () => { fire.growth = GROWTH[growth.value]; placeFire(firePos.x, firePos.z, fireLevel); });
for (const b of document.querySelectorAll('[data-mode]')) {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    for (const o of document.querySelectorAll('[data-mode]')) o.classList.toggle('on', o === b);
  });
}
const furnitureBox = document.getElementById('furniture');
furnitureBox.addEventListener('change', () => {
  extraMeshes.furniture.visible = extraMeshes.fixtures.visible = furnitureBox.checked;
  renderer.shadowMap.needsUpdate = true;
});
const roofBox = document.getElementById('roof');
const setRoof = () => { dressed.groups.roof.visible = roofBox.checked; renderer.shadowMap.needsUpdate = true; };
roofBox.addEventListener('change', setRoof);
setRoof();
const opacity = document.getElementById('opacity');
const setOpacity = () => {
  dressed.setOpacity(+opacity.value);
  document.getElementById('opacityVal').textContent = (+opacity.value).toFixed(2);
};
opacity.addEventListener('input', setOpacity);
setOpacity();
for (const name of SERVICES) {
  const box = document.getElementById(`show-${name}`);
  const sync = () => { serviceMeshes[name].visible = box.checked; };
  box.addEventListener('change', sync);
  sync();
}
const pipeOpacity = document.getElementById('pipeOpacity');
const setPipeOpacity = () => {
  const o = +pipeOpacity.value, solid = o >= 0.99;
  serviceMaterial.opacity = solid ? 1 : o;
  serviceMaterial.transparent = !solid;
  serviceMaterial.depthWrite = solid;
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

// --- loop ------------------------------------------------------------------------
let simTime = 0, stepMs = 0, wallSeconds = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (running) {
    const s = performance.now();
    fire.step();
    stepMs = stepMs ? stepMs * 0.9 + (performance.now() - s) * 0.1 : performance.now() - s;
    simTime = fire.time;
    wallSeconds += dt;
  }
  if (!dragging) fireMarker.position.set(firePos.x, LEVELS[fireLevel].floor, firePos.z);
  fireMarker.visible = level === 'all' || fireLevel === level;
  smoke.upload(fire);
  controls.update();
  smoke.time = simTime;
  smoke.render(scene, camera, mode);

  const room = roomAt(firePos.x, firePos.z, fireLevel);
  fireInfo.textContent = `Fire in 起火: ${room ? `${room.code} ${room.name}` : '?'} · ${(fire.heatRelease() / 1000).toFixed(0)} kW`;
  status.textContent = `t ${Math.floor(simTime / 60)}:${String(Math.floor(simTime % 60)).padStart(2, '0')} · ` +
    `${grid.nx}×${grid.ny}×${grid.nz} grid, ${fire.fluid.length} air cells · step ${stepMs.toFixed(0)} ms · ` +
    `${(fire.dt / (stepMs / 1000 || 1)).toFixed(1)}× real time at most`;
}
renderer.setAnimationLoop(frame);

// For poking at it from the console; frame() draws once even in a hidden tab.
window.duplexFire = { fire, grid, placeFire, showLevel, camera, meta, frame, dressed, serviceMeshes, serviceMaterial };
