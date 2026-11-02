// A fire in a real BIM house: the IFC house from ../../web, turned into a
// voxel grid, with the 3D stable-fluids solver running inside it.
//
// Global view: orbit around the cut-away house and watch smoke and wind.
// V: walk inside as a person (copied from ../../web), crouch under the smoke.
// Enter VR: the same walk on a phone, with the gyro and a thumb stick.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import * as WebIFC from 'web-ifc';
import { Person } from './person.js';
import { voxelize, openingBox } from './voxelize.js';
import { Fluid3D } from './fluid3d.js';
import { SmokePass } from './smoke-pass.js';
import { WindParticles } from './wind-particles.js';
import { dressHouse } from './dressing.js';
import { PhoneLook, ThumbStick } from './phone-vr.js';

// BASE_URL, not '/': on GitHub Pages the site lives under /ultramarine-2026-10/.
const MODEL_URL = `${import.meta.env.BASE_URL}samples/AC20-FZK-Haus.ifc`;
// Its size on disk, for the loading percentage. Servers send it compressed and
// the Content-Length, when there is one, is the compressed size, while a stream
// counts bytes after unpacking. If the model changes and this does not, only
// the percentage is off.
const MODEL_BYTES = 2526544;
const CELL = 0.2;          // metres per grid cell
const FIRE_SIZE = 0.6;     // metres across
const ROOM_NAMES = {       // FZK-Haus is German; names for the picker
  Flur: 'Hallway 走廊', Buero: 'Study 书房', Bad: 'Bathroom 浴室', Schlafzimmer: 'Bedroom 卧室',
  Wohnen: 'Living room 客厅', 'Küche': 'Kitchen 厨房', Galerie: 'Attic 阁楼',
};

// Let the page draw the new percentage before work holds the thread again.
// A timer, not requestAnimationFrame, which stops for good in a background tab.
const letPagePaint = () => new Promise((done) => setTimeout(done, 30));

async function downloadModel() {
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`${MODEL_URL}: HTTP ${response.status}`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());
  const chunks = [];
  let received = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    lintelLoad.set('Downloading the house 下载房子', 25 + 55 * Math.min(1, received / MODEL_BYTES));
  }
  const bytes = new Uint8Array(received);
  let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}

lintelLoad.set('Loading 加载中', 15);
await letPagePaint();

const view = document.getElementById('view');
const status = document.getElementById('status');
const probe = document.getElementById('probe');
const help = document.getElementById('help');

const renderer = new THREE.WebGLRenderer({ antialias: false });
const PIXEL_RATIO = Math.min(devicePixelRatio, 1.5);
renderer.setPixelRatio(PIXEL_RATIO);
view.appendChild(renderer.domElement);
// A phone can fail where a desktop does not, in ways that only leave the screen
// black: a shader its GPU rejects, or the context taken away when memory runs out.
renderer.debug.onShaderError = (gl, program) => lintelError(`Shader 着色器: ${gl.getProgramInfoLog(program)}`);
renderer.domElement.addEventListener('webglcontextlost', () => lintelError('The graphics context was lost, probably out of memory. 图形上下文丢失，可能是内存不够。'));
const labelRenderer = new CSS2DRenderer();
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', pointerEvents: 'none' });
view.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111418);
const hemi = new THREE.HemisphereLight(0xffffff, 0x505050, 2.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(10, 20, 8);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// --- how each IFC element is drawn and whether it blocks smoke -------------
const STYLE = {
  wall:   { color: 0xd9d4c7 },
  slab:   { color: 0x8c8577 },
  floor:  { color: 0x8c8577 },
  roof:   { color: 0x9b4f3c },
  door:   { color: 0xb5651d },
  window: { color: 0x7fb8e6, opacity: 0.4 },
  stair:  { color: 0x6e6a62 },
  other:  { color: 0x9a9a9a },
  site:   { color: 0x4a4f45 },
};
function roleOf(api, model, id) {
  const type = api.GetLineType(model, id);
  if (type === WebIFC.IFCWALL || type === WebIFC.IFCWALLSTANDARDCASE) return 'wall';
  if (type === WebIFC.IFCSLAB) {
    const kind = api.GetLine(model, id).PredefinedType?.value;
    // Upper floors are kept apart from the ground slab so the global view can
    // hide them and look down into the rooms below.
    return kind === 'ROOF' ? 'roof' : kind === 'FLOOR' ? 'floor' : 'slab';
  }
  if (type === WebIFC.IFCROOF) return 'roof';
  if (type === WebIFC.IFCDOOR) return 'door';
  if (type === WebIFC.IFCWINDOW) return 'window';
  // Stairs, railings and their members are thinner than a cell: as voxels
  // they would plug the stairwell, so smoke flows through them.
  if (type === WebIFC.IFCSTAIR || type === WebIFC.IFCSTAIRFLIGHT || type === WebIFC.IFCRAILING || type === WebIFC.IFCMEMBER) return 'stair';
  if (type === WebIFC.IFCSITE) return 'site';
  return 'other';
}

const groups = {};
for (const role of Object.keys(STYLE)) { groups[role] = new THREE.Group(); scene.add(groups[role]); }

async function loadHouse() {
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath(`${import.meta.env.BASE_URL}wasm/`, true);
  await api.Init(undefined, true);
  lintelLoad.set('Downloading the house 下载房子', 25);
  const bytes = await downloadModel();
  lintelLoad.set('Reading the house 解析房子', 85);
  await letPagePaint();
  const model = api.OpenModel(bytes);

  const materials = {};
  for (const [role, s] of Object.entries(STYLE)) {
    materials[role] = new THREE.MeshLambertMaterial({
      color: s.color, side: THREE.DoubleSide,
      transparent: s.opacity !== undefined, opacity: s.opacity ?? 1, depthWrite: s.opacity === undefined,
    });
  }
  const byElement = new Map();   // expressID -> meshes
  const rooms = [];

  const add = (flatMesh) => {
    const id = flatMesh.expressID;
    const isSpace = api.GetLineType(model, id) === WebIFC.IFCSPACE;
    const role = isSpace ? 'space' : roleOf(api, model, id);
    for (let i = 0; i < flatMesh.geometries.size(); i++) {
      const pg = flatMesh.geometries.get(i);
      const g = api.GetGeometry(model, pg.geometryExpressID);
      const verts = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
      const index = api.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
      g.delete();
      const buffer = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
      geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));
      const matrix = new THREE.Matrix4().fromArray(pg.flatTransformation);
      if (isSpace) {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox.clone().applyMatrix4(matrix);
        const long = api.GetLine(model, id).LongName?.value ?? '';
        rooms.push({ id, name: ROOM_NAMES[long] ?? long, box });
        continue;
      }
      const mesh = new THREE.Mesh(geometry, materials[role]);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(matrix);
      mesh.userData = { expressID: id, role, name: api.GetLine(model, id).Name?.value ?? '', closedMaterial: materials[role] };
      groups[role].add(mesh);
      if (!byElement.has(id)) byElement.set(id, []);
      byElement.get(id).push(mesh);
    }
  };
  api.StreamAllMeshes(model, add);
  api.StreamAllMeshesWithTypes(model, [WebIFC.IFCSPACE], add);
  scene.updateMatrixWorld(true);
  return { byElement, rooms, materials };
}

// --- start ---------------------------------------------------------------------
const { byElement, rooms, materials } = await loadHouse();
lintelLoad.set('Building the rooms 建立房间', 92);
await letPagePaint();
const setDressing = dressHouse({ renderer, scene, groups, materials, rooms, hemi, sun });
const dressBox = document.getElementById('dress');
setDressing(dressBox.checked);
dressBox.addEventListener('change', () => setDressing(dressBox.checked));
const meshesOf = (role) => groups[role].children;

// The grid covers the house shell: walls plus roof, but not the roof's eaves
// or the terrain around the house.
const bounds = new THREE.Box3();
for (const m of meshesOf('wall')) bounds.expandByObject(m);
bounds.max.y = Math.max(bounds.max.y, new THREE.Box3().setFromObject(groups.roof).max.y);

const t0 = performance.now();
const grid = voxelize({ bounds, cell: CELL, solids: [...meshesOf('wall'), ...meshesOf('slab'), ...meshesOf('floor'), ...meshesOf('roof'), ...meshesOf('other')] });

// Window panes always block; doors block only while closed.
for (const [id, meshes] of byElement) {
  if (meshes[0].userData.role === 'window') for (const c of grid.cellsInBox(openingBox(meshes, 0.4))) grid.solid[c] = 1;
}
const doors = new Map();   // expressID -> { cells, meshes, open }
for (const [id, meshes] of byElement) {
  if (meshes[0].userData.role !== 'door') continue;
  const box = openingBox(meshes, 0.4);
  doors.set(id, { cells: grid.cellsInBox(box), meshes, name: meshes[0].userData.name });
}
const voxelMs = performance.now() - t0;

const fluid = new Fluid3D(grid.nx, grid.ny, grid.nz, grid.solid);
const openDoorMaterial = new THREE.MeshLambertMaterial({
  color: 0xb5651d, transparent: true, opacity: 0.15, depthWrite: false, side: THREE.DoubleSide,
});
function setDoor(id, open) {
  const door = doors.get(id);
  door.open = open;
  for (const c of door.cells) grid.solid[c] = open ? 0 : 1;
  for (const m of door.meshes) { m.userData.open = open; m.material = open ? openDoorMaterial : m.userData.closedMaterial; }
}
// Inside doors start open, outside doors shut: a house with someone home.
for (const [id, door] of doors) setDoor(id, door.name.startsWith('Innen'));

// Sealing upstairs: every air cell from the underside of the upper floor up
// becomes wall, as if the gallery void and stairwell were boarded over. The
// ground floor is then a closed box of its own, and the solver also has
// about half as many cells to update.
const upperFloorBottom = new THREE.Box3().setFromObject(groups.floor).min.y;
const upstairs = [];
for (let k = 1; k <= grid.nz; k++) for (let j = 1; j <= grid.ny; j++) for (let i = 1; i <= grid.nx; i++) {
  const c = grid.index(i, j, k);
  if (!grid.solid[c] && grid.origin.y + (j - 0.5) * CELL >= upperFloorBottom) upstairs.push(c);
}
function sealUpstairs(sealed) {
  for (const c of upstairs) {
    grid.solid[c] = sealed ? 1 : 0;
    fluid.dens[c] = 0; fluid.temp[c] = 0;
  }
  fluid.updateTopology();
}
for (const c of upstairs) grid.solid[c] = 1;   // start sealed
fluid.sealBorder();
fluid.updateTopology();

// --- views ------------------------------------------------------------------
const smoke = new SmokePass(renderer, grid);
const wind = new WindParticles(fluid, grid, 3000);
scene.add(wind.lines);

const centre = bounds.getCenter(new THREE.Vector3());
const span = bounds.getSize(new THREE.Vector3()).length();
controls.target.copy(centre);
// Further back on a screen taller than it is wide, or the sides of the house are cut off.
camera.position.copy(centre).add(new THREE.Vector3(0.55, 0.85, 0.75).multiplyScalar(span * Math.max(1, innerHeight / innerWidth * 0.8)));

const labels = new Map();
for (const r of rooms) {
  const div = document.createElement('div');
  div.className = 'room-label';
  div.textContent = r.name;
  const label = new CSS2DObject(div);
  label.position.copy(r.box.getCenter(new THREE.Vector3()));
  scene.add(label);
  labels.set(r.id, div);
}

const hallway = rooms.find((r) => r.name.startsWith('Hallway')) ?? rooms[0];
const person = new Person({
  domElement: renderer.domElement,
  colliders: [...meshesOf('wall'), ...meshesOf('door'), ...meshesOf('window'), ...meshesOf('other')],
  doors: new Map([...doors].map(([id, d]) => [id, d.meshes])),
  openDoorMaterial,
  start: { x: hallway.box.getCenter(new THREE.Vector3()).x, z: hallway.box.getCenter(new THREE.Vector3()).z },
  floorY: hallway.box.min.y,
  scene,
});
person.onDoorToggle = (id, open) => {
  setDoor(id, open);
  fluid.updateTopology();
  renderer.shadowMap.needsUpdate = true;
  status.textContent = `${doors.get(id).name} ${open ? 'opened 开' : 'closed 关'}`;
};

// --- fire ---------------------------------------------------------------------
let fireRoom = null;
function lightFire(room) {
  fireRoom = room;
  const c = room.box.getCenter(new THREE.Vector3());
  const half = FIRE_SIZE / 2;
  const box = new THREE.Box3(
    new THREE.Vector3(c.x - half, room.box.min.y, c.z - half),
    new THREE.Vector3(c.x + half, room.box.min.y + 2.5 * CELL, c.z + half));
  const cells = grid.cellsInBox(box).filter((i) => !grid.solid[i]);
  fluid.sources = [{ cells: Int32Array.from(cells), smoke: 4, heat: 6 }];
  for (const [id, div] of labels) div.classList.toggle('fire', id === room.id);
  for (const select of roomSelects) select.value = String(room.id);
}
const roomSelects = [document.getElementById('room'), document.getElementById('vrRoom')];
for (const select of roomSelects) {
  for (const r of rooms) select.add(new Option(r.name, String(r.id)));
  select.addEventListener('change', () => { fluid.reset(); lightFire(rooms.find((r) => String(r.id) === select.value)); });
}
document.getElementById('random').addEventListener('click', () => {
  // The attic is open to the stairwell and has no fuel; a ground-floor room
  // is where a fire starts.
  const choices = rooms.filter((r) => r.box.min.y < 1);
  fluid.reset();
  lightFire(choices[(Math.random() * choices.length) | 0]);
});
lightFire(rooms.find((r) => r.name.startsWith('Kitchen')) ?? rooms[0]);

let running = true;
const runButton = document.getElementById('run');
runButton.addEventListener('click', () => { running = !running; runButton.textContent = running ? 'Pause 暂停' : 'Run 继续'; runButton.classList.toggle('on', !running); });
document.getElementById('reset').addEventListener('click', () => { fluid.reset(); simTime = 0; });

let mode = 'smoke';
const modeButtons = document.querySelectorAll('[data-mode]');
const markMode = () => modeButtons.forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
modeButtons.forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; markMode(); }));
markMode();

const windBox = document.getElementById('wind');
const detailBox = document.getElementById('detail');
// Lower draws thin, spreading smoke denser; 1 draws it as simulated.
const thinInput = document.getElementById('thin');
thinInput.addEventListener('input', () => { document.getElementById('thinVal').textContent = (+thinInput.value).toFixed(2); });
const roofBox = document.getElementById('roof');
const floorBox = document.getElementById('upperFloor');
groups.roof.visible = false;
groups.floor.visible = false;
roofBox.addEventListener('change', () => { groups.roof.visible = roofBox.checked; });
floorBox.addEventListener('change', () => { groups.floor.visible = floorBox.checked; });
const sealBox = document.getElementById('sealUpstairs');
sealBox.addEventListener('change', () => sealUpstairs(sealBox.checked));

let personView = false;
function setPersonView(on) {
  personView = on;
  person.setActive(on);
  labelRenderer.domElement.style.display = on ? 'none' : '';
  groups.roof.visible = on || roofBox.checked;   // ceilings matter inside
  groups.floor.visible = on || floorBox.checked;
  help.textContent = on
    ? 'Click to look · WASD walk · hold Space crouch · E door · V global view'
    : 'Drag to orbit · V walk inside 进入房子';
}
addEventListener('keydown', (e) => { if (e.code === 'KeyV' && !e.repeat && !inVr) setPersonView(!personView); });
setPersonView(false);

// --- phone VR ---------------------------------------------------------------------
let inVr = false, enteredVr = false;
const look = new PhoneLook(person.camera, renderer.domElement);
const stick = new ThumbStick(document.getElementById('stick'), document.getElementById('knob'));
person.stick = stick.value;
const vrInfo = document.getElementById('vrInfo');
const crouchButton = document.getElementById('vrCrouch');
const doorButton = document.getElementById('vrDoor');
let doorInReach = null;

function updateDoorButton() {
  doorInReach = person.doorNearby();
  doorButton.hidden = doorInReach === null;
  if (doorInReach === null) return;
  const label = doors.get(doorInReach).open ? 'Close door 关门' : 'Open door 开门';
  if (doorButton.textContent !== label) doorButton.textContent = label;
}

function setVr(on) {
  inVr = on;
  document.body.classList.toggle('vr', on);
  person.touchMode = on;
  controls.enabled = !on;
  stick.release();
  setPersonView(on);
  if (on && !enteredVr) {
    // Down the hallway rather than at the wall beside the start.
    person.camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    enteredVr = true;
  }
  if (on) look.start(); else look.stop();
  if (!on) { person.crouched = false; crouchButton.classList.remove('on'); }
  // The ray-marched smoke costs per pixel, and the house does not move, so
  // its shadows need drawing only when something changes.
  renderer.setPixelRatio(on ? 1 : PIXEL_RATIO);
  renderer.shadowMap.autoUpdate = !on;
  renderer.shadowMap.needsUpdate = true;
  resize();
}
document.getElementById('enterVr').addEventListener('click', () => { look.askForGyro(); setVr(true); });
document.getElementById('exitVr').addEventListener('click', () => setVr(false));
doorButton.addEventListener('click', () => { if (doorInReach !== null) person.toggleDoor(doorInReach); });
crouchButton.addEventListener('click', () => { person.crouched = !person.crouched; crouchButton.classList.toggle('on', person.crouched); });

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  labelRenderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  person.setAspect(w / h);
  smoke.setSize();
}
addEventListener('resize', resize);
resize();

// --- loop -------------------------------------------------------------------------
let simTime = 0, stepMs = 0, fps = 0, lastFrame = performance.now();
const clock = new THREE.Clock();

// What the person's eyes are in: smoke and heat at eye height.
function sampleAtEye() {
  const eye = person.camera.position;
  const i = Math.round((eye.x - grid.origin.x) / CELL + 0.5);
  const j = Math.round((eye.y - grid.origin.y) / CELL + 0.5);
  const k = Math.round((eye.z - grid.origin.z) / CELL + 0.5);
  if (i < 1 || j < 1 || k < 1 || i > grid.nx || j > grid.ny || k > grid.nz) return null;
  const c = grid.index(i, j, k);
  return { smoke: fluid.dens[c], heat: fluid.temp[c] };
}

lintelLoad.set('Preparing the view 准备画面', 97);
await letPagePaint();

let firstFrame = true;
renderer.setAnimationLoop(() => {
  const now = performance.now();
  fps = fps * 0.9 + (1000 / Math.max(1, now - lastFrame)) * 0.1;
  lastFrame = now;
  const dt = Math.min(clock.getDelta(), 0.1);

  if (running) {
    const s = performance.now();
    fluid.step();
    stepMs = stepMs * 0.9 + (performance.now() - s) * 0.1;
    simTime += fluid.dt;
  }
  smoke.upload(fluid);
  const showWind = windBox.checked && !inVr;
  wind.lines.visible = showWind;
  if (showWind && running) wind.update(fluid.dt);

  const activeCamera = personView ? person.camera : camera;
  if (inVr) look.update();
  if (personView) person.update(dt); else controls.update();
  smoke.time = simTime;
  smoke.detail = detailBox.checked;
  smoke.thinGamma = +thinInput.value;
  smoke.render(scene, activeCamera, mode);
  if (!personView) labelRenderer.render(scene, camera);
  // Not before this: the shaders compile during the first frame, which is a
  // long stall on a phone.
  if (firstFrame) { firstFrame = false; lintelLoad.done(); }

  status.textContent = `grid ${grid.nx}×${grid.ny}×${grid.nz} · ${fluid.fluid.length} air cells · ` +
    `step ${stepMs.toFixed(0)} ms · ${fps.toFixed(0)} fps · t ${simTime.toFixed(0)} (grid s)`;
  if (personView) {
    const at = sampleAtEye();
    probe.textContent = at ? `At your eyes 眼睛高度: smoke 烟 ${at.smoke.toFixed(2)} · heat 热 ${at.heat.toFixed(2)}` : '';
  } else {
    probe.textContent = fireRoom ? `Fire in 起火: ${fireRoom.name}` : '';
  }
  if (inVr) {
    updateDoorButton();
    const at = sampleAtEye();
    vrInfo.textContent = `${look.hasGyro ? 'Turn the phone to look 转动手机看' : 'Drag to look 拖动看四周'} · ${fps.toFixed(0)} fps` +
      (at ? ` · smoke 烟 ${at.smoke.toFixed(2)} · heat 热 ${at.heat.toFixed(2)}` : '');
  }
});

window.lintelReady = true;
const enterVr = document.getElementById('enterVr');
enterVr.disabled = false;
enterVr.textContent = 'Enter VR 进入 VR';

// Handle for poking at the scene from the browser console.
window.__lintel3d = { fluid, grid, doors, rooms, person, voxelMs, setDoor, lightFire, wind, sealUpstairs, look, stick, updateDoorButton };
