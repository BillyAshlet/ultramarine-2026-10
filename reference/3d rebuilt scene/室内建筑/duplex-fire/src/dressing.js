// Giving the eye something to measure the Duplex by, and a way to see into it.
//
// Adapted from ../../../fliud3d/src/dressing.js, which explains the cues:
// floorboards whose lines converge with distance, a dark skirting line where
// walls meet the floor, and low afternoon sun through the windows with soft
// shadows. Here the house can also be made see-through, walls and floors
// alike, so both storeys and the smoke in them show at once. The shadows fade
// with the walls: at a quarter opacity a wall that threw a full-strength
// shadow read as a solid wall again.
import * as THREE from 'three';

const BOARD_TILE = 1.2;   // metres one repeat of the floorboard texture covers
const TILE = 0.6;         // metres one repeat of the tile texture covers (two tiles)
const STOREY = 3.1;       // the wall texture spans one storey; Level 2 is at 3.1 m
const UPPER_FLOOR = 3.0;  // walls above this belong to Level 2

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const floorboards = () => canvasTexture(512, 512, (g, w, h) => {
  const boards = 8, bh = h / boards;      // 15 cm boards
  for (let b = 0; b < boards; b++) {
    const shade = 150 + ((b * 37) % 5) * 9;
    g.fillStyle = `rgb(${shade}, ${shade * 0.78 | 0}, ${shade * 0.56 | 0})`;
    g.fillRect(0, b * bh, w, bh);
    g.fillStyle = 'rgba(40, 25, 15, 0.9)';
    g.fillRect(0, b * bh, w, 3);
    g.fillRect((b * 211) % w, b * bh, 3, bh);
  }
});

const tiles = () => canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = '#d8d6d0';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#9a968e';
  for (const p of [0, w / 2]) { g.fillRect(p, 0, 3, h); g.fillRect(0, p, w, 3); }
});

const wallpaper = () => canvasTexture(4, 512, (g, w, h) => {
  g.fillStyle = '#d9d4c7';
  g.fillRect(0, 0, w, h);
  const skirting = Math.round(h * 0.09 / STOREY);
  g.fillStyle = '#4a3a2e';
  g.fillRect(0, h - skirting, w, skirting);    // canvas y runs down; v = 0 is the floor
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, h - skirting - 2, w, 2);
});

/** Which group an element of the building layer is drawn in. */
function kindOf(e) {
  if (/^IfcWall/.test(e.type)) return 'wall';
  if (e.type === 'IfcSlab') {
    if (/Finish Floor - Wood/.test(e.name)) return 'boards';
    if (/Ceramic Tile/.test(e.name)) return 'tiles';
    if (/Roof/.test(e.name)) return 'roof';
    return 'slab';
  }
  if (e.type === 'IfcCovering') return 'ceiling';
  if (e.type === 'IfcDoor') return 'door';
  if (e.type === 'IfcWindow') return /Skylight/.test(e.name) ? 'roof' : 'window';
  return 'other';   // beams, stairs, railings, footings
}

const STYLE = {
  wall: { color: 0xffffff },
  boards: { color: 0xffffff },
  tiles: { color: 0xffffff },
  slab: { color: 0x8c8577 },
  roof: { color: 0x9b4f3c },
  ceiling: { color: 0xeeeeea },
  door: { color: 0xb5651d },
  window: { color: 0x7fb8e6, glass: true },
  other: { color: 0x6e6a62 },
};

/**
 * Split the building into groups that share its vertices, give each its look,
 * and light the house. Returns the meshes by group and setOpacity(0..1).
 */
export function dressDuplex({ renderer, scene, building, clippingPlanes, hemi }) {
  const src = building.geometry;
  const position = src.attributes.position, normal = src.attributes.normal;
  const uv = new Float32Array(position.count * 2);
  const byKind = {};
  for (const mesh of building.elements) {
    const e = mesh.userData.element;
    const kind = kindOf(e);
    const index = mesh.geometry.index.array;
    (byKind[kind] ||= []).push(index);
    // IFC geometry has no texture coordinates: project them from the world.
    for (const i of index) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      if (kind === 'wall') {
        uv[i * 2] = 0;
        uv[i * 2 + 1] = (y - (y > UPPER_FLOOR ? STOREY : 0)) / STOREY;
      } else {
        const tile = kind === 'tiles' ? TILE : BOARD_TILE;
        uv[i * 2] = x / tile;
        uv[i * 2 + 1] = z / tile;
      }
    }
  }
  const uvAttribute = new THREE.BufferAttribute(uv, 2);

  const maps = { wall: wallpaper(), boards: floorboards(), tiles: tiles() };
  const groups = {};
  for (const [kind, parts] of Object.entries(byKind)) {
    const length = parts.reduce((n, p) => n + p.length, 0);
    const index = new Uint32Array(length);
    let at = 0;
    for (const p of parts) { index.set(p, at); at += p.length; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setAttribute('uv', uvAttribute);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingSphere();
    const s = STYLE[kind];
    const material = new THREE.MeshLambertMaterial({
      color: s.color, map: maps[kind] ?? null, side: THREE.DoubleSide, clippingPlanes,
      emissive: s.glass ? new THREE.Color(0x9fb8d8) : new THREE.Color(0),
      emissiveIntensity: s.glass ? 0.35 : 0,
    });
    const mesh = new THREE.Mesh(g, material);
    // The glass must not cast shadows, or the sun would stop at every pane.
    mesh.castShadow = !s.glass;
    mesh.receiveShadow = !s.glass;
    mesh.userData.glass = !!s.glass;
    mesh.userData.ceiling = kind === 'ceiling';
    scene.add(mesh);
    groups[kind] = mesh;
  }

  // Indoors, light mostly bounces off walls and ceilings, so shadows are faint
  // and soft. They are drawn once: nothing that casts one moves.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const house = new THREE.Box3();
  for (const m of building.elements) if (/^IfcWall/.test(m.userData.element.type)) house.union(m.geometry.boundingBox);
  const centre = house.getCenter(new THREE.Vector3());
  const reach = house.getSize(new THREE.Vector3()).length();
  // Afternoon sun, about 17 degrees up, slightly warm, through the windows on
  // the -x and +z sides.
  const daylight = new THREE.DirectionalLight(0xfff1dc, 7.5);
  daylight.position.copy(centre).add(new THREE.Vector3(-0.6, 0.3, 0.74).normalize().multiplyScalar(reach));
  daylight.target.position.copy(centre);
  daylight.castShadow = true;
  const cam = daylight.shadow.camera;
  cam.left = cam.bottom = -reach / 2; cam.right = cam.top = reach / 2;
  cam.near = 0.1; cam.far = reach * 2;
  daylight.shadow.mapSize.set(2048, 2048);
  daylight.shadow.radius = 2;
  daylight.shadow.bias = -0.0005;
  daylight.shadow.normalBias = 0.02;
  scene.add(daylight, daylight.target);

  // Cool from the sky, warmer from the floor: daylight bounced off everything.
  hemi.color.set(0xcfdcf2);
  hemi.groundColor.set(0x8a7a68);
  hemi.intensity = 2.7;

  function setOpacity(o) {
    for (const mesh of Object.values(groups)) {
      const m = mesh.material;
      // Looking down through the house, the two white ceilings stacked into
      // a haze over everything, so they thin out faster than the walls.
      const a = mesh.userData.glass ? Math.min(o, 0.35) : mesh.userData.ceiling && o < 0.99 ? o * 0.3 : o;
      const solid = a >= 0.99;
      m.opacity = solid ? 1 : a;
      m.transparent = !solid;
      // See-through surfaces leave the depth alone, so the smoke behind them
      // is drawn (the smoke stops where the rendered depth says).
      m.depthWrite = solid;
      m.needsUpdate = true;
    }
    daylight.shadow.intensity = o;
  }
  return { groups, setOpacity, daylight };
}
