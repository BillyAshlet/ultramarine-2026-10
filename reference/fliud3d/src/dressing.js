// Giving the eye something to measure space by.
//
// Smoke is not seen by itself: it is seen by what it does to the things
// behind it, which fade and lose their edges the further away they are (the
// painter's aerial perspective, taken to the extreme). The bare BIM house
// has evenly coloured walls and floors, so there was nothing for the smoke
// to fade, and adding detail to the smoke did not make it any more visible.
// Space and depth come first:
//  - floorboards, whose lines converge and whose spacing shrinks with
//    distance (linear perspective and texture gradient);
//  - a dark skirting line along every wall where it meets the floor;
//  - lights in the rooms with shadows, so light falls off across a wall and
//    objects sit on the floor.
// Furniture, the other big cue, is left for later.
import * as THREE from 'three';

const BOARD_TILE = 1.2;     // metres one repeat of the floor texture covers
const STOREY = 2.7;         // the wall texture spans one storey

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const boards = 8;                       // 15 cm boards
  const h = c.height / boards;
  for (let b = 0; b < boards; b++) {
    const shade = 150 + ((b * 37) % 5) * 9;   // a slightly different tone per board
    g.fillStyle = `rgb(${shade}, ${shade * 0.78 | 0}, ${shade * 0.56 | 0})`;
    g.fillRect(0, b * h, c.width, h);
    g.fillStyle = 'rgba(40, 25, 15, 0.9)';
    g.fillRect(0, b * h, c.width, 3);       // the gap between boards
    const joint = ((b * 211) % c.width);    // board ends, staggered
    g.fillRect(joint, b * h, 3, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function wallTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d4c7';
  g.fillRect(0, 0, c.width, c.height);
  const skirting = Math.round(c.height * 0.09 / STOREY);
  g.fillStyle = '#4a3a2e';
  g.fillRect(0, c.height - skirting, c.width, skirting);   // canvas y runs down; v = 0 is the floor
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, c.height - skirting - 2, c.width, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** IFC meshes have no texture coordinates; project them from world space. */
function addUv(mesh, project) {
  const pos = mesh.geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const [u, v] = project(p);
    uv[i * 2] = u; uv[i * 2 + 1] = v;
  }
  mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

/**
 * Dress the house: textures on floors and walls, lights in rooms, shadows.
 * Returns setOn(boolean) to switch all of it on and off for comparison.
 */
export function dressHouse({ renderer, scene, groups, materials, rooms, hemi, sun }) {
  for (const m of groups.slab.children) addUv(m, (p) => [p.x / BOARD_TILE, p.z / BOARD_TILE]);
  for (const m of groups.wall.children) addUv(m, (p) => [0, (((p.y % STOREY) + STOREY) % STOREY) / STOREY]);

  const floorMap = floorTexture(), wallMap = wallTexture();
  const plain = { slab: materials.slab.color.clone(), wall: materials.wall.color.clone() };

  // Indoors, light comes mostly from walls and ceilings bouncing it around,
  // so shadows are faint and their edges wide. The first version had crisp
  // dark shadows with a hard edge, which read as a single bare bulb.
  renderer.shadowMap.type = THREE.PCFShadowMap;   // the kind that honours shadow.radius
  for (const role of ['wall', 'slab', 'floor', 'roof', 'door', 'stair', 'other']) {
    for (const m of groups[role].children) { m.castShadow = true; m.receiveShadow = true; }
  }

  // Daylight through the windows. A first version hung a lamp under every
  // ceiling; light that comes in sideways through the windows, with a cool
  // sky filling the rest, reads as a lived-in room in the daytime, and the
  // patches it throws on the floor are one more cue for depth.
  // The glass must not cast shadows, or the sun would stop at every pane;
  // walls and the roof do, so light only gets in where the windows are.
  for (const m of groups.window.children) { m.castShadow = false; m.receiveShadow = false; }
  const house = new THREE.Box3();
  for (const m of groups.wall.children) house.expandByObject(m);
  const centre = house.getCenter(new THREE.Vector3());
  const reach = house.getSize(new THREE.Vector3()).length();

  // Afternoon sun: low (about 17 degrees up), so it comes in through the
  // windows and lays long bright patches across the floor, and a little
  // warm. Strong, because a patch of direct sun is far brighter than the
  // rest of a room.
  const daylight = new THREE.DirectionalLight(0xfff1dc, 7.5);
  daylight.position.copy(centre).add(new THREE.Vector3(-0.6, 0.3, 0.74).normalize().multiplyScalar(reach));
  daylight.target.position.copy(centre);
  daylight.castShadow = true;
  const cam = daylight.shadow.camera;
  cam.left = cam.bottom = -reach / 2; cam.right = cam.top = reach / 2;
  cam.near = 0.1; cam.far = reach * 2;
  daylight.shadow.mapSize.set(2048, 2048);
  daylight.shadow.radius = 2;            // sun through a window has a crisp edge
  daylight.shadow.bias = -0.0005;
  daylight.shadow.normalBias = 0.02;
  scene.add(daylight, daylight.target);
  const lights = [daylight];

  // Windows glow faintly, so they read as where the light comes from.
  const windowEmissive = materials.window.emissive.clone();

  const before = { hemi: hemi.intensity, sun: sun.intensity, sky: hemi.color.clone(), ground: hemi.groundColor.clone() };
  function setOn(on) {
    materials.slab.map = on ? floorMap : null;
    materials.slab.color.copy(on ? new THREE.Color(0xffffff) : plain.slab);
    materials.wall.map = on ? wallMap : null;
    materials.wall.color.copy(on ? new THREE.Color(0xffffff) : plain.wall);
    materials.slab.needsUpdate = materials.wall.needsUpdate = true;
    renderer.shadowMap.enabled = on;
    for (const l of lights) l.visible = on;
    // The flat fill stands in for daylight bounced off every surface: cool
    // from the sky above, warmer from the floor below. Too much and it
    // washes out the room's gradients; too little and shadows go black.
    hemi.color.copy(on ? new THREE.Color(0xcfdcf2) : before.sky);
    hemi.groundColor.copy(on ? new THREE.Color(0x8a7a68) : before.ground);
    // An afternoon room is bright all over, not only in the sun patches.
    hemi.intensity = on ? 2.7 : before.hemi;
    sun.intensity = on ? 0 : before.sun;       // the daylight replaces the old overhead sun
    materials.window.emissive.copy(on ? new THREE.Color(0x9fb8d8) : windowEmissive);
    for (const role of Object.keys(materials)) materials[role].needsUpdate = true;
  }
  return setOn;
}
