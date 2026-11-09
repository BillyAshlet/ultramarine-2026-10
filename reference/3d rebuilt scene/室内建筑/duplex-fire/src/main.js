// Step 1 of the Duplex fire: the whole house in the smoke solver, seen from
// above, see-through or one storey at a time, with a fire you can move.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { readLayer, buildGrid, HouseFire, poolAt, GROWTH, CELL } from './house.js';
import { SmokePass } from './smoke-pass.js';
import { dressDuplex } from './dressing.js';
import { Doors } from './doors.js';
import { thickenPipes } from './pipes.js';
import { buildObjects } from './objects.js';
import { World } from './world.js';

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
for (const name of SERVICES) {
  services[name] = await load(name);
  thickenPipes(services[name]);
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
// Furniture and fixtures share one material, faded with the walls (see setOpacity).
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

const doors = new Doors({ scene, building, grid, fire, rooms, dressedDoors: dressed.groups.door, cut, renderer });

// The object table and the mechanisms that act on it (world.js). The
// mechanism files are loaded further down, once the page is set up.
const materials = await (await fetch(new URL('./materials.json', import.meta.url))).json();
const objects = buildObjects(meta, grid, materials);
const world = new World({ fire, grid, objects, rooms, materials });

let fireLevel = 1;
/** Move the fire and start again from nothing: a design fire grows from t = 0. */
function placeFire(x, z, lvl) {
  const pool = poolAt(grid, x, z, LEVELS[lvl].floor);
  if (pool.length === 0) return false;
  firePos.x = x; firePos.z = z; fireLevel = lvl;
  fire.reset();
  world.reset();
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
// Where a fire would go: a point on one storey's floor, inside a room.
//
// The storey is always chosen first, never guessed from the click: with both
// storeys showing a click hits both floors, and seen from above the upper
// floor covers nearly all of the lower one. Guessing (the floor in front,
// Shift for the one below) was tried and still read as ambiguous.
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

// Dragging the flame moves it on its own storey.
let dragging = false;
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (ev) => {
  downAt = [ev.clientX, ev.clientY];
  if (placeLevel) return;
  rayAt(ev);
  if (fireMarker.visible && ray.intersectObject(fireMarker, true).length) {
    dragging = true;
    controls.enabled = false;
  }
});
addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const hit = floorPoint(ev, fireLevel);
  if (hit) fireMarker.position.set(hit.p.x, LEVELS[fireLevel].floor, hit.p.z);
});
addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  controls.enabled = true;
  placeFire(fireMarker.position.x, fireMarker.position.z, fireLevel);
});

// Place mode: "Fire on Level 1" or "Fire on Level 2". A see-through flame
// follows the pointer on that storey's floor, with the 0.6 m square the fire
// burns on; grey where it can't go. The other storey is drawn see-through
// meanwhile (below). A click puts the fire there and leaves the mode; Esc
// leaves without moving it. Kept a mode of its own, so looking around or
// opening a door never moves the fire by accident, which would restart it.
let placeLevel = null;
const ghostMaterial = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.55, depthTest: false });
const ghost = new THREE.Group();
const ghostCone = new THREE.Mesh(marker.geometry, ghostMaterial);
ghostCone.scale.setScalar(1.4);
ghostCone.position.y = 0.42;
const ghostPad = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6).rotateX(-Math.PI / 2), ghostMaterial);
ghostPad.position.y = 0.03;
// A thin light pillar up to the ceiling: from across the house the cone is
// a few pixels, and the pillar shows where it stands.
const ghostPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 12),
  new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.35, depthTest: false }));
ghostPillar.position.y = 1.2;
ghost.add(ghostCone, ghostPad, ghostPillar);
ghost.renderOrder = 15;
ghost.visible = false;
scene.add(ghost);
let ghostHit = null, lastMove = null;
const placeButtons = [...document.querySelectorAll('[data-place]')];
const placeHint = document.getElementById('placeHint');
function setPlacing(lvl) {
  placeLevel = lvl;
  for (const b of placeButtons) b.classList.toggle('on', +b.dataset.place === lvl);
  placeHint.hidden = !lvl;
  placeHint.textContent = lvl ? `Level ${lvl} ${lvl}层 · click a floor 点地面放下 · Esc: cancel 取消` : '';
  ghost.visible = false;
  ghostHit = null;
  doors.hover(null);
  renderer.domElement.style.cursor = lvl ? 'crosshair' : '';
}
for (const b of placeButtons) {
  b.addEventListener('click', () => setPlacing(placeLevel === +b.dataset.place ? null : +b.dataset.place));
}
function moveGhost(ev) {
  const hit = floorPoint(ev, placeLevel);
  ghostHit = hit && poolAt(grid, hit.p.x, hit.p.z, LEVELS[placeLevel].floor).length ? hit : null;
  ghost.visible = !!hit;
  if (!hit) return;
  ghost.position.set(hit.p.x, LEVELS[placeLevel].floor, hit.p.z);
  ghostMaterial.color.set(ghostHit ? 0xff6a1a : 0x8a8f98);
  placeHint.textContent = `Level ${placeLevel} ${placeLevel}层 · ${roomAt(hit.p.x, hit.p.z, placeLevel)?.code ?? ''} · Esc: cancel 取消`;
}
renderer.domElement.addEventListener('pointermove', (ev) => {
  lastMove = ev;
  if (placeLevel) { moveGhost(ev); return; }
  doors.hover(dragging ? null : doors.pick(rayAt(ev)));
});
renderer.domElement.addEventListener('pointerleave', () => { doors.hover(null); ghost.visible = false; });
addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && placeLevel) setPlacing(null); });
// While placing, a two-finger swipe on a trackpad turns the view instead of
// zooming, so you can look around the house with the flame still in hand;
// a pinch (which the browser reports as a wheel with ctrlKey) still zooms.
// Caught on the canvas's parent, before OrbitControls sees it.
const orbit = new THREE.Spherical();
document.getElementById('view').addEventListener('wheel', (ev) => {
  if (!placeLevel || ev.ctrlKey) return;
  ev.preventDefault();
  ev.stopPropagation();
  const offset = camera.position.clone().sub(controls.target);
  orbit.setFromVector3(offset);
  // Swiping drags the house the way the fingers move.
  orbit.theta += ev.deltaX * 0.004;
  orbit.phi = Math.min(Math.PI - 0.05, Math.max(0.05, orbit.phi + ev.deltaY * 0.004));
  camera.position.copy(controls.target).add(offset.setFromSpherical(orbit));
  camera.lookAt(controls.target);
  controls.update();
  if (lastMove) moveGhost(lastMove);
}, { capture: true, passive: false });

// While placing, the other storey (walls, floors, furniture, pipes, doors)
// is drawn as a fine screen of dots, half the pixels left out, so it neither
// hides the storey you are placing on nor gets mistaken for it. So is
// anything nearer the eye than the ghost flame, on either storey, so the
// walls in front don't hide where the fire is going. Leaving
// pixels out, rather than fading them, needs no change to how the
// see-through materials are sorted, and works the same on solid ones.
// The split is by height: Level 1 up to its ceiling, Level 2 from its floor.
const FADE_ABOVE = 2.6;   // placing on Level 1: thin out from its ceiling up
const FADE_BELOW = 2.7;   // placing on Level 2: thin out below its floor slab
const fade = { uFadeMode: { value: 0 }, uFadeDist: { value: 0 } };   // mode: 0 off, 1 above, 2 below
const fadeMaterials = [
  ...Object.values(dressed.groups).map((m) => m.material),
  material, serviceMaterial, doors.material,
];
for (const m of fadeMaterials) {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fade);
    shader.vertexShader = 'varying float vFadeY;\n' + shader.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  vFadeY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = 'uniform int uFadeMode;\nuniform float uFadeDist;\nvarying float vFadeY;\n' +
      shader.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      bool other = (uFadeMode == 1 && vFadeY > ${FADE_ABOVE.toFixed(2)}) || (uFadeMode == 2 && vFadeY < ${FADE_BELOW.toFixed(2)});
      bool inFront = uFadeMode > 0 && length(vViewPosition) < uFadeDist;
      if ((other || inFront) && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 2.0) < 1.0) discard;`);
  };
  m.customProgramCacheKey = () => 'fade-other-storey';
  m.needsUpdate = true;
}
function updateFade() {
  fade.uFadeMode.value = placeLevel === 1 ? 1 : placeLevel === 2 ? 2 : 0;
  // A little short of the flame, so the floor it stands on stays whole.
  fade.uFadeDist.value = placeLevel && ghost.visible ? camera.position.distanceTo(ghost.position) - 0.6 : 0;
}

// A click, not the end of a drag that turned the view.
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!placeLevel || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
  moveGhost(ev);
  if (!ghostHit) return;
  placeFire(ghostHit.p.x, ghostHit.p.z, ghostHit.lvl);
  setPlacing(null);
});

// Pointing at a door makes it breathe; double-clicking it opens or shuts it.
// Double-clicking a floor no longer moves the fire: it was too easy to do
// when aiming at a door. Use Fire on Level 1 / 2.
renderer.domElement.addEventListener('dblclick', (ev) => {
  if (placeLevel) return;
  const door = doors.pick(rayAt(ev));
  if (door) doors.toggle(door);
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
  // Furniture and fixtures fade with the walls, so a solid sofa no longer
  // hides the smoke and doors behind it when the walls are see-through.
  const o = +opacity.value, solid = o >= 0.99;
  material.opacity = solid ? 1 : o;
  material.transparent = !solid;
  material.depthWrite = solid;
  material.needsUpdate = true;
  doors.setOpacity(o);
  document.getElementById('opacityVal').textContent = (+opacity.value).toFixed(2);
};
opacity.addEventListener('input', setOpacity);
setOpacity();
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

// --- mechanisms -------------------------------------------------------------------
// What a mechanism that draws or picks may need from the page.
world.view = { scene, camera, renderer, controls, cut, dressed, doors, meta, extras, extraMeshes, services, serviceMeshes, smoke, rayAt, roomAt, LEVELS };
await world.load();

// --- loop ------------------------------------------------------------------------
let simTime = 0, stepMs = 0, wallSeconds = 0;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (running) {
    const s = performance.now();
    world.step();
    stepMs = stepMs ? stepMs * 0.9 + (performance.now() - s) * 0.1 : performance.now() - s;
    simTime = fire.time;
    wallSeconds += dt;
  }
  if (!dragging) fireMarker.position.set(firePos.x, LEVELS[fireLevel].floor, firePos.z);
  fireMarker.visible = level === 'all' || fireLevel === level;
  doors.update(clock.elapsedTime);
  updateFade();
  smoke.upload(fire);
  controls.update();
  smoke.time = simTime;
  smoke.render(scene, camera, mode);

  const room = roomAt(firePos.x, firePos.z, fireLevel);
  const note = doors.currentNotice();
  fireInfo.textContent = `Fire in 起火: ${room ? `${room.code} ${room.name}` : '?'} · ${(fire.heatRelease() / 1000).toFixed(0)} kW` +
    (note ? ` · ${note}` : '');
  status.textContent = `t ${Math.floor(simTime / 60)}:${String(Math.floor(simTime % 60)).padStart(2, '0')} · ` +
    `${grid.nx}×${grid.ny}×${grid.nz} grid, ${fire.fluid.length} air cells · step ${stepMs.toFixed(0)} ms · ` +
    `${(fire.dt / (stepMs / 1000 || 1)).toFixed(1)}× real time at most`;
}
renderer.setAnimationLoop(frame);

// For poking at it from the console; frame() draws once even in a hidden tab.
window.duplexFire = { fire, grid, placeFire, showLevel, camera, meta, frame, dressed, serviceMeshes, serviceMaterial, doors, world, objects };
