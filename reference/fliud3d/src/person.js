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
const BODY_RADIUS = 0.25;
const DOOR_REACH = 1.8;
const DOOR_NEARBY = 1.5;      // metres at which a door offers itself on a phone
const STOREY_HEIGHT = 2;
// Collision rays at knee and chest height: low enough for sills and stair
// treads, high enough for walls and door leaves.
const PROBE_HEIGHTS = [0.35, 1.2];

const UP = new THREE.Vector3(0, 1, 0);

export class Person {
  /**
   * @param {object} o
   * @param {HTMLElement} o.domElement  element that takes the pointer lock
   * @param {THREE.Mesh[]} o.colliders  meshes the body cannot walk through
   * @param {Map<number, THREE.Mesh[]>} o.doors  door meshes by IFC express ID
   * @param {THREE.Material} o.openDoorMaterial  how an open door is drawn
   * @param {{x:number, z:number}} o.start
   * @param {number} o.floorY
   */
  constructor({ domElement, colliders, doors, openDoorMaterial, start, floorY, scene }) {
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
    const move = new THREE.Vector3()
      .addScaledVector(forward, (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0) + this.stick.y)
      .addScaledVector(right, (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + this.stick.x);
    const push = move.length();
    if (push > 0) {
      // Pushing the stick part of the way walks slower; keys always push fully.
      move.multiplyScalar(Math.min(1, push) / push).multiplyScalar((crouching ? CROUCH_SPEED : WALK_SPEED) * dt);
      // One axis at a time, so walking into a wall at an angle slides along it.
      this.tryMove(move.x, 0);
      this.tryMove(0, move.z);
    }
    this.syncCamera();
  }

  tryMove(dx, dz) {
    const step = new THREE.Vector3(dx, 0, dz);
    const length = step.length();
    if (length === 0) return;
    const direction = step.clone().divideScalar(length);
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
    this.camera.position.set(this.position.x, this.floorY + this.eye, this.position.z);
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
