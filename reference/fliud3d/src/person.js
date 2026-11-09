// A person walking through the house at eye height.
//
// Unlike the chase cameras in flocks, where the fish decides where it goes and
// the camera only follows, here looking *is* steering: the mouse turns the
// head, and W always walks the way you are looking.
import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const EYE_STANDING = 1.6;
// Low enough to sit under a smoke layer that has come down to door height.
const EYE_CROUCHED = 0.7;
// Metres per second. Real speeds, because "how long to reach the bedroom"
// only means something if walking takes as long as it really does.
const WALK_SPEED = 1.4;
const CROUCH_SPEED = 0.6;
// Along the slope. A placeholder that looks right, not a measured stair speed.
const STAIR_SPEED = 0.6;
const BODY_RADIUS = 0.25;
const DOOR_REACH = 1.8;
const DOOR_NEARBY = 1.5;      // metres at which a door offers itself on a phone
const STOREY_HEIGHT = 2;
// Collision rays at knee and chest height, low enough for sills and high enough
// for walls and door leaves, and over the head for the attic's sloping roof.
const PROBE_HEIGHTS = [0.35, 1.2, 1.7];

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

export class Person {
  /**
   * @param {object} o
   * @param {HTMLElement} o.domElement  element that takes the pointer lock
   * @param {THREE.Mesh[]} o.colliders  meshes the body cannot walk through
   * @param {Map<number, THREE.Mesh[]>} o.doors  door meshes by IFC express ID
   * @param {THREE.Material} o.openDoorMaterial  how an open door is drawn
   * @param {{x:number, z:number}} o.start
   * @param {number} o.floorY
   * @param {import('./stairs.js').SpiralStair} [o.stair]
   * @param {THREE.Mesh[]} [o.upperFloors]  what you can stand on upstairs
   */
  constructor({ domElement, colliders, doors, openDoorMaterial, start, floorY, scene, stair, upperFloors = [] }) {
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.03, 300);
    this.controls = new PointerLockControls(this.camera, domElement);
    this.domElement = domElement;
    this.colliders = colliders;
    this.doors = doors;
    this.doorCentres = new Map([...doors].map(([id, meshes]) => {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      return [id, box.getCenter(new THREE.Vector3())];
    }));
    this.walls = colliders.filter((m) => m.userData.role !== 'door');
    this.openDoorMaterial = openDoorMaterial;
    this.floorY = floorY;
    this.position = new THREE.Vector3(start.x, floorY, start.z);
    this.eye = EYE_STANDING;
    this.keys = new Set();
    this.active = false;
    this.raycaster = new THREE.Raycaster();
    this.onDoorToggle = null;
    // Phone VR: a thumb stick and a crouch button stand in for the keys, and
    // something else turns the camera, so a tap must not grab the pointer.
    this.stick = { x: 0, y: 0 };
    this.crouched = false;
    this.touchMode = false;

    this.stair = stair;
    this.upperFloors = upperFloors;
    this.rampS = null;           // where on the stairs you are, null when off them
    this.rampForward = 1;        // which way along them "forward" takes you
    this.waitForRelease = false;
    // Getting on or off moves you a little at once; this hides the jump by
    // easing the eye from where it was.
    this.slide = new THREE.Vector3();

    this.marker = makeMarker();
    scene.add(this.marker);

    domElement.addEventListener('click', () => {
      if (this.active && !this.touchMode && !this.controls.isLocked) this.controls.lock();
    });
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyE' && !e.repeat) this.toggleDoorInFront();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.syncCamera();
  }

  setActive(active) {
    this.active = active;
    this.marker.visible = !active;
    this.keys.clear();
    if (!active && this.controls.isLocked) this.controls.unlock();
  }

  setAspect(aspect) {
    this.camera.aspect = aspect;
    // A phone held upright is narrow: at the usual 70 degrees up and down you
    // would see only about 35 across.
    this.camera.fov = aspect < 1 ? 85 : 70;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    if (!this.active) return;
    const crouching = this.keys.has('Space') || this.crouched;
    const targetEye = crouching ? EYE_CROUCHED : EYE_STANDING;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 10);

    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, UP);
    const ahead = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) + this.stick.y;
    const move = new THREE.Vector3()
      .addScaledVector(forward, ahead)
      .addScaledVector(right, (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + this.stick.x);
    const push = move.length();
    this.slide.multiplyScalar(Math.exp(-dt * 6));
    if (push === 0) this.waitForRelease = false;

    if (this.rampS !== null) {
      this.walkRamp(ahead, crouching, dt);
    } else if (push > 0 && !this.waitForRelease) {
      const s = this.stair?.boarding(this.position.x, this.position.z, this.upstairs(), move.x, move.z);
      if (s === 0 || s === 1) {
        this.boardRamp(s, ahead);
      } else {
        // Pushing the stick part of the way walks slower; keys always push fully.
        move.multiplyScalar(Math.min(1, push) / push).multiplyScalar((crouching ? CROUCH_SPEED : WALK_SPEED) * dt);
        // One axis at a time, so walking into a wall at an angle slides along it.
        this.tryMove(move.x, 0);
        this.tryMove(0, move.z);
      }
    }
    this.syncCamera();
  }

  upstairs() {
    return this.stair !== undefined && this.floorY > this.stair.bottomY + 0.1;
  }

  /**
   * On the ramp "forward" means carrying on the way you got on, wherever you are
   * looking: on a spiral you would otherwise have to physically turn most of a
   * circle to climb it, which nobody sitting down can do, and you could not stop
   * to look back at the smoke. Sideways does nothing. Getting on from the top
   * makes forward go down, or pushing forward at the top would throw you straight
   * back off.
   */
  boardRamp(s, ahead) {
    const p = this.stair.at(s);
    this.rampS = s;
    this.rampForward = (s === 0 ? 1 : -1) * (ahead < 0 ? -1 : 1);
    this.slide.set(this.position.x - p.x, 0, this.position.z - p.z);
    this.position.set(p.x, p.y, p.z);
    this.floorY = p.y;
  }

  walkRamp(ahead, crouching, dt) {
    const push = Math.max(-1, Math.min(1, ahead));
    const speed = crouching ? STAIR_SPEED * CROUCH_SPEED / WALK_SPEED : STAIR_SPEED;
    this.rampS += this.rampForward * push * speed * dt / this.stair.length;
    if (this.rampS <= 0 || this.rampS >= 1) {
      const end = this.rampS <= 0 ? 0 : 1;
      const p = this.stair.at(end), off = this.stair.landingAt(end);
      this.slide.set(p.x - off.x, 0, p.z - off.z);
      this.position.set(off.x, off.y, off.z);
      this.floorY = off.y;
      this.rampS = null;
      // Forward here was along the stairs. Carrying it over would suddenly mean
      // the way you are looking, so wait for the stick to be let go.
      this.waitForRelease = true;
      return;
    }
    const p = this.stair.at(this.rampS);
    this.position.set(p.x, p.y, p.z);
    this.floorY = p.y;
  }

  /** Upstairs the floor has a big hole in it: stay on it, a body's width from the edge. */
  floorEndsAt(x, z) {
    this.raycaster.set(new THREE.Vector3(x, this.floorY + 0.1, z), DOWN);
    this.raycaster.far = 0.4;
    return this.raycaster.intersectObjects(this.upperFloors, false).length === 0;
  }

  tryMove(dx, dz) {
    const step = new THREE.Vector3(dx, 0, dz);
    const length = step.length();
    if (length === 0) return;
    const direction = step.clone().divideScalar(length);
    const nextX = this.position.x + dx, nextZ = this.position.z + dz;
    if (this.upstairs()) {
      if (this.floorEndsAt(nextX + direction.x * BODY_RADIUS, nextZ + direction.z * BODY_RADIUS)) return;
    } else if (this.stair?.blocksGround(nextX, nextZ)) {
      return;
    }
    const solid = this.colliders.filter((m) => !m.userData.open);
    for (const h of PROBE_HEIGHTS) {
      const origin = new THREE.Vector3(this.position.x, this.floorY + h, this.position.z);
      this.raycaster.set(origin, direction);
      this.raycaster.far = length + BODY_RADIUS;
      if (this.raycaster.intersectObjects(solid, false).length > 0) return;
    }
    this.position.add(step);
  }

  toggleDoorInFront() {
    const origin = this.camera.getWorldPosition(new THREE.Vector3());
    const direction = this.camera.getWorldDirection(new THREE.Vector3());
    this.raycaster.set(origin, direction);
    this.raycaster.far = DOOR_REACH;
    const all = [...this.doors.values()].flat();
    const hit = this.raycaster.intersectObjects(all, false)[0];
    if (hit) this.toggleDoor(hit.object.userData.expressID);
  }

  /**
   * The closest door you are standing by, or null. Aiming at a door is fine
   * with a mouse but fiddly with a phone in your hand, so being near is enough.
   * A door on the far side of a wall can be just as close, so the way to it
   * has to be clear.
   */
  doorNearby() {
    const body = new THREE.Vector3(this.position.x, this.floorY + 1.2, this.position.z);
    let best = null, bestDistance = DOOR_NEARBY;
    for (const [id, centre] of this.doorCentres) {
      if (Math.abs(centre.y - body.y) > STOREY_HEIGHT) continue;
      const toDoor = new THREE.Vector3(centre.x - body.x, 0, centre.z - body.z);
      const distance = toDoor.length();
      if (distance >= bestDistance) continue;
      if (distance > 0.05) {
        this.raycaster.set(body, toDoor.divideScalar(distance));
        this.raycaster.far = distance;
        if (this.raycaster.intersectObjects(this.walls, false).length > 0) continue;
      }
      best = id;
      bestDistance = distance;
    }
    return best;
  }

  toggleDoor(id) {
    const open = !this.doors.get(id)[0].userData.open;
    for (const mesh of this.doors.get(id)) {
      mesh.userData.open = open;
      mesh.material = open ? this.openDoorMaterial : mesh.userData.closedMaterial;
    }
    this.onDoorToggle?.(id, open);
  }

  syncCamera() {
    this.camera.position.set(this.position.x + this.slide.x, this.floorY + this.eye, this.position.z + this.slide.z);
    this.marker.position.set(this.position.x, this.floorY, this.position.z);
    const forward = this.camera.getWorldDirection(new THREE.Vector3());
    this.marker.rotation.y = Math.atan2(forward.x, forward.z);
  }
}

/** A capsule body with a cone at eye height showing which way it faces. */
function makeMarker() {
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({ color: 0xff7a3d });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(BODY_RADIUS, 1.1, 4, 12), material);
  body.position.y = 0.8;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 12), material);
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, EYE_STANDING, 0.35);
  group.add(body, nose);
  return group;
}
