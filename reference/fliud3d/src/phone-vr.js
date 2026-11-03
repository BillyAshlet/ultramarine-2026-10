// The phone as a window into the house: turning the phone turns your head and
// a thumb stick walks.
//
// A browser on an iPhone can read which way the phone faces but not where it
// is (no WebXR there, whichever browser it is), so real steps do not move you
// and lowering the phone does not crouch. ar_phone does both through ARKit.
import * as THREE from 'three';

const DRAG_PER_PIXEL = 0.005;  // radians
const STICK_RADIUS = 55;       // pixels; half the width of #stick
const STICK_DEAD_ZONE = 0.1;

const UP = new THREE.Vector3(0, 1, 0);
const OUT_OF_SCREEN = new THREE.Vector3(0, 0, 1);
// The phone's angles describe its top edge; the camera looks out of its back.
const BACK_OF_PHONE = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);

/**
 * Turns a camera with the gyro, or with a finger where there is no gyro: a
 * desktop, a refused permission, or an in-app browser that does not pass the
 * sensor on.
 *
 * A finger used to turn you sideways with the gyro on as well, so you could
 * look behind you without standing up. That broke the illusion: the house only
 * feels fixed around you while it turns exactly as far as you do, and a drag
 * swung it with your body still, so you lost track of where things were. So
 * with the gyro on only the phone turns the view, and turnAround() covers
 * looking behind you, all at once, the way VR apps snap-turn.
 */
export class PhoneLook {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.hasGyro = false;
    this.angles = null;
    this.yawOffset = null;
    this.yaw = 0;
    this.pitch = 0;
    this.dragId = null;
    this.lastX = 0;
    this.lastY = 0;

    this.onOrientation = (e) => {
      if (e.alpha === null) return;      // desktops send one empty event
      this.angles = e;
      this.hasGyro = true;
    };
    this.onDown = (e) => {
      if (this.dragId !== null) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX; this.lastY = e.clientY;
    };
    this.onMove = (e) => {
      if (e.pointerId !== this.dragId || this.hasGyro) return;
      const dx = (e.clientX - this.lastX) * DRAG_PER_PIXEL;
      const dy = (e.clientY - this.lastY) * DRAG_PER_PIXEL;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.yaw += dx;
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy, -1.5, 1.5);
    };
    this.onUp = (e) => { if (e.pointerId === this.dragId) this.dragId = null; };
  }

  /**
   * iOS only lets a tap ask for the sensor, so this has to run straight inside
   * the tap's handler, before anything asynchronous. Elsewhere nothing asks.
   */
  askForGyro() {
    const ask = globalThis.DeviceOrientationEvent?.requestPermission;
    if (ask) ask.call(DeviceOrientationEvent).catch(() => {});
  }

  turnAround() {
    if (this.hasGyro && this.yawOffset !== null) this.yawOffset += Math.PI;
    else this.yaw += Math.PI;
  }

  start() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.yawOffset = null;
    addEventListener('deviceorientation', this.onOrientation);
    this.domElement.addEventListener('pointerdown', this.onDown);
    addEventListener('pointermove', this.onMove);
    addEventListener('pointerup', this.onUp);
    addEventListener('pointercancel', this.onUp);
  }

  stop() {
    removeEventListener('deviceorientation', this.onOrientation);
    this.domElement.removeEventListener('pointerdown', this.onDown);
    removeEventListener('pointermove', this.onMove);
    removeEventListener('pointerup', this.onUp);
    removeEventListener('pointercancel', this.onUp);
    this.dragId = null;
    this.hasGyro = false;
    this.angles = null;
  }

  update() {
    if (!this.hasGyro) {
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      return;
    }
    const { alpha, beta, gamma } = this.angles;
    const d = THREE.MathUtils.degToRad;
    const phone = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(d(beta), d(alpha), d(-gamma), 'YXZ'))
      .multiply(BACK_OF_PHONE)
      .multiply(new THREE.Quaternion().setFromAxisAngle(OUT_OF_SCREEN, d(-screenAngle())));
    // The gyro's zero points somewhere arbitrary in the room. Whichever way the
    // phone faces when it starts is the way you were already looking.
    if (this.yawOffset === null) this.yawOffset = yawOf(this.camera) - yawOfQuaternion(phone);
    this.camera.quaternion.setFromAxisAngle(UP, this.yawOffset).multiply(phone);
  }
}

function screenAngle() {
  return screen.orientation?.angle ?? window.orientation ?? 0;
}
function yawOf(camera) { return yawOfQuaternion(camera.quaternion); }
function yawOfQuaternion(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

/** A thumb stick: `value` holds x right and y forward, each -1…1. */
export class ThumbStick {
  constructor(element, knob) {
    this.value = { x: 0, y: 0 };
    let id = null;
    const set = (e) => {
      const r = element.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const length = Math.hypot(x, y);
      if (length > STICK_RADIUS) { x *= STICK_RADIUS / length; y *= STICK_RADIUS / length; }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      const strong = length / STICK_RADIUS > STICK_DEAD_ZONE;
      this.value.x = strong ? x / STICK_RADIUS : 0;
      this.value.y = strong ? -y / STICK_RADIUS : 0;
    };
    this.release = () => {
      id = null;
      knob.style.transform = '';
      this.value.x = this.value.y = 0;
    };
    element.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      element.setPointerCapture(id);
      set(e);
    });
    element.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    element.addEventListener('pointerup', (e) => { if (e.pointerId === id) this.release(); });
    element.addEventListener('pointercancel', (e) => { if (e.pointerId === id) this.release(); });
  }
}
