// Doors you can open and shut while the fire burns.
//
// A shut door is drawn with its IFC mesh (frame and leaf), sharing the dressed
// door material so the Walls slider fades it like any wall; the building's one
// merged door mesh is hidden. An open door is a plain leaf swung about its
// hinge, since the IFC mesh is frame and leaf in one piece and cannot be
// turned on its own. The drawing always follows the solver: inside doors start
// open there (as in ../../fliud3d), so they start swung open here.
//
// The IFC data has no hinge side or swing direction. The hinge is put at the
// door's low end and the leaf swings into the room the door belongs to (the
// overlay's room or "beside" field): a guess, but one that keeps the leaf
// inside the house.
//
// Pointing at a door makes it breathe, light and dark, even through walls:
// the pick tests doors only, so a see-through wall in front does not stop it.
import * as THREE from 'three';

const BREATH_SECONDS = 1.5;
const SWING_SECONDS = 0.6;
const OPEN_ANGLE = Math.PI * 0.45;   // a little short of square, clear of the wall
const LEAF_THICKNESS = 0.04;
const FRAME = 0.05;                  // jamb width on each side, inside the IFC box

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

export class Doors {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {{elements: THREE.Mesh[], geometry: THREE.BufferGeometry}} o.building  from readLayer
   * @param {{doors: {element: object, cells: number[], open: boolean, outside: boolean}[], solid: Uint8Array}} o.grid
   * @param {import('./house.js').HouseFire} o.fire
   * @param {{code: string, min: number[], max: number[]}[]} o.rooms  the architect's rooms
   * @param {THREE.Mesh} o.dressedDoors  the merged door mesh from dressing.js, hidden from now on
   * @param {THREE.Plane} o.cut  the storey cut; doors above it can't be pointed at
   * @param {THREE.WebGLRenderer} o.renderer
   */
  constructor({ scene, building, grid, fire, rooms, dressedDoors, cut, renderer }) {
    this.grid = grid;
    this.fire = fire;
    this.cut = cut;
    this.renderer = renderer;
    // Doors have their own material (see setOpacity).
    this.material = dressedDoors.material.clone();
    this.arcMaterial = new THREE.MeshBasicMaterial({
      color: 0xff9a3c, transparent: true, opacity: 0.28, depthWrite: false,
      side: THREE.DoubleSide, clippingPlanes: [cut],
    });
    this.arcLineMaterial = new THREE.LineBasicMaterial({ color: 0xff7a1a, clippingPlanes: [cut] });
    dressedDoors.visible = false;

    const { position, normal } = building.geometry.attributes;
    this.doors = [];
    for (const m of building.elements) {
      const element = m.userData.element;
      if (element.type !== 'IfcDoor') continue;
      const state = grid.doors.find((d) => d.element === element);
      // The door's box takes in a little of the frame and lintel, which the
      // grid holds as wall even with the door open. Remember them, so opening
      // a door restores its doorway as built instead of widening it.
      if (state.open) state.asBuilt = Uint8Array.from(state.cells, (c) => grid.solid[c]);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('normal', normal);
      g.setIndex(m.geometry.index);
      g.boundingBox = m.geometry.boundingBox;
      g.boundingSphere = m.geometry.boundingSphere;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      const place = element.room || element.beside || '';
      const { pivot, leaf, openAngle, width } = makeLeaf(element, rooms.find((r) => place.startsWith(r.code)), this.material);
      scene.add(pivot);
      // The swing on the floor, as an architect draws a door on a plan: a
      // sector from the shut position to where the leaf is now.
      const arc = new THREE.Group();
      arc.position.set(pivot.position.x, element.min[1] + 0.03, pivot.position.z);
      arc.add(new THREE.Mesh(new THREE.BufferGeometry(), this.arcMaterial));
      arc.add(new THREE.Line(new THREE.BufferGeometry(), this.arcLineMaterial));
      arc.renderOrder = 5;
      scene.add(arc);
      const door = { state, mesh, pivot, leaf, arc, width, openAngle, place, angle: 0, swing: null, flashUntil: 0 };
      door.angle = state.open ? openAngle : 0;
      this.doors.push(door);
      this.draw(door);
    }

    // Drawn over everything, so a door glows even behind a solid wall. It
    // copies whichever shape is showing, the shut door or the swung leaf.
    this.glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0xffc861, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
      side: THREE.DoubleSide, clippingPlanes: [cut],
    }));
    this.glow.renderOrder = 20;
    this.glow.matrixAutoUpdate = false;
    this.glow.visible = false;
    scene.add(this.glow);

    this.hovered = null;
    this.notice = { text: '', until: 0 };
    this.raycaster = new THREE.Raycaster();
  }

  /**
   * Doors follow the Walls slider exactly. They were once kept at 0.6 or more,
   * because at the walls' default a door faded to nearly nothing and opening
   * one could not be seen; but solid orange doors then hid the pipes behind
   * them, and Billy asked for doors to match the walls. The glow on pointing
   * and the swing drawn on the floor still show a door that moves.
   */
  setOpacity(o) {
    const a = Math.min(1, o);
    const solid = a >= 0.99;
    this.material.opacity = solid ? 1 : a;
    this.material.transparent = !solid;
    this.material.depthWrite = solid;
    this.material.needsUpdate = true;
  }

  /** Show the shut IFC door, or the leaf at its current angle with its swing on the floor. */
  draw(d) {
    const shut = d.angle === 0;
    d.mesh.visible = shut;
    d.pivot.visible = !shut;
    d.arc.visible = !shut;
    const base = d.pivot.userData.base;
    d.pivot.rotation.y = base + d.angle;
    d.pivot.updateMatrixWorld(true);
    if (!shut) {
      // CircleGeometry lies in xy; laid flat, angle t points along (cos t, 0, -sin t),
      // the same way the leaf points after turning by t.
      const start = Math.min(base, base + d.angle), length = Math.abs(d.angle);
      const [sector, line] = d.arc.children;
      sector.geometry.dispose();
      sector.geometry = new THREE.CircleGeometry(d.width, 24, start, length).rotateX(-Math.PI / 2);
      const pts = [];
      for (let n = 0; n <= 24; n++) {
        const t = start + (length * n) / 24;
        pts.push(new THREE.Vector3(Math.cos(t) * d.width, 0, -Math.sin(t) * d.width));
      }
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
  }

  /** The door under a ray, or null. Walls are not tested, so they never hide one. */
  pick(ray) {
    this.raycaster.ray.copy(ray);
    // Raycasting ignores visibility, so both shapes are tested: the doorway
    // answers whether the door is shut or swung open, and so does the leaf.
    const targets = this.doors.flatMap((d) => [d.mesh, d.leaf]);
    const hits = this.raycaster.intersectObjects(targets, false);
    // Above the storey cut a door is not drawn, so it can't be pointed at either.
    const hit = hits.find((h) => this.cut.distanceToPoint(h.point) >= 0);
    return hit ? this.doors.find((d) => d.mesh === hit.object || d.leaf === hit.object) : null;
  }

  hover(door) {
    this.hovered = door;
    this.glow.visible = !!door;
    this.renderer.domElement.style.cursor = door ? 'pointer' : '';
  }

  /**
   * Open or shut a door; the fire keeps burning. Opening frees its cells at
   * once, as the leaf starts to move; shutting seals them only when the leaf
   * reaches the frame, since a half-shut door still lets smoke through.
   */
  toggle(door) {
    const { state } = door;
    if (state.outside) {
      this.say(`Outside door: there is no outdoors in the solver yet 外门：引擎里还没有室外，暂时不能开`);
      return;
    }
    state.open = !state.open;
    if (state.open) this.setCells(state, true);
    door.swing = { from: door.angle, to: state.open ? door.openAngle : 0, start: performance.now() };
    // Light it up for a moment, so the door that moved is easy to find.
    door.flashUntil = performance.now() + (SWING_SECONDS + 0.6) * 1000;
    this.say(`${door.place} door ${state.open ? 'opened' : 'closed'} 门${state.open ? '开' : '关'}`);
  }

  setCells(state, open) {
    const { solid } = this.grid;
    const { dens, temp, fuel } = this.fire;
    state.cells.forEach((c, n) => {
      solid[c] = open ? (state.asBuilt?.[n] ?? 0) : 1;
      // A cell that turns into door holds no smoke, heat or fuel.
      if (!open) dens[c] = temp[c] = fuel[c] = 0;
    });
    // Rebuilds the solver's cell lists and stops the air in the new solid cells.
    this.fire.updateTopology();
  }

  say(text) {
    this.notice = { text, until: performance.now() + 3500 };
  }

  /** Swing the leaves and breathe the glow; call once a frame. */
  update(seconds) {
    let moved = false;
    for (const d of this.doors) {
      if (!d.swing) continue;
      const t = Math.min(1, (performance.now() - d.swing.start) / (SWING_SECONDS * 1000));
      d.angle = d.swing.from + (d.swing.to - d.swing.from) * ease(t);
      if (t >= 1) {
        d.angle = d.swing.to;
        d.swing = null;
        // Shut at last: only now does the doorway stop smoke.
        if (!d.state.open) this.setCells(d.state, false);
      }
      this.draw(d);
      moved = true;
    }
    // Shadows are drawn once and redrawn on demand; a moving leaf needs them each frame.
    if (moved) this.renderer.shadowMap.needsUpdate = true;

    // The glow follows the pointer, or a door that has just moved.
    const now = performance.now();
    const d = this.hovered ?? this.doors.find((x) => x.flashUntil > now);
    this.glow.visible = !!d;
    if (!d) return;
    const shut = d.angle === 0;
    this.glow.geometry = shut ? d.mesh.geometry : d.leaf.geometry;
    this.glow.matrix.copy(shut ? d.mesh.matrixWorld : d.leaf.matrixWorld);
    this.glow.matrixWorld.copy(this.glow.matrix);
    const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * seconds) / BREATH_SECONDS);
    this.glow.material.opacity = 0.12 + 0.5 * phase;
  }

  currentNotice() {
    return performance.now() < this.notice.until ? this.notice.text : '';
  }
}

/**
 * A leaf for a door element: a box hinged at the low end of the doorway, on
 * the wall's centre line. Returns the pivot (placed at the hinge, rotated
 * about y), the leaf inside it, and the angle that swings it into the room.
 */
function makeLeaf(e, room, material) {
  const dx = e.max[0] - e.min[0], dz = e.max[2] - e.min[2];
  const alongX = dx >= dz;
  const width = Math.max(0.3, (alongX ? dx : dz) - 2 * FRAME);
  const height = Math.max(0.5, e.max[1] - e.min[1] - FRAME);
  const midThin = alongX ? (e.min[2] + e.max[2]) / 2 : (e.min[0] + e.max[0]) / 2;
  const hinge = alongX
    ? new THREE.Vector3(e.min[0] + FRAME, e.min[1], midThin)
    : new THREE.Vector3(midThin, e.min[1], e.min[2] + FRAME);

  const geometry = new THREE.BoxGeometry(width, height, LEAF_THICKNESS);
  geometry.translate(width / 2, height / 2, 0);   // hinge edge on the pivot
  const leaf = new THREE.Mesh(geometry, material);
  leaf.castShadow = leaf.receiveShadow = true;
  const pivot = new THREE.Group();
  pivot.position.copy(hinge);
  // Turning by base lays the leaf's +x along the doorway.
  pivot.userData.base = alongX ? 0 : -Math.PI / 2;
  pivot.add(leaf);

  // Which way into the room: the leaf's free end after turning by +/- OPEN_ANGLE.
  const doorCentre = new THREE.Vector3((e.min[0] + e.max[0]) / 2, 0, (e.min[2] + e.max[2]) / 2);
  const roomCentre = room
    ? new THREE.Vector3((room.min[0] + room.max[0]) / 2, 0, (room.min[2] + room.max[2]) / 2)
    : doorCentre.clone().add(new THREE.Vector3(alongX ? 0 : 1, 0, alongX ? 1 : 0));
  const towardRoom = roomCentre.sub(doorCentre);
  const freeEnd = (a) => {
    const t = pivot.userData.base + a;
    return new THREE.Vector3(Math.cos(t), 0, -Math.sin(t));
  };
  const openAngle = freeEnd(OPEN_ANGLE).dot(towardRoom) >= freeEnd(-OPEN_ANGLE).dot(towardRoom) ? OPEN_ANGLE : -OPEN_ANGLE;
  return { pivot, leaf, openAngle, width };
}
