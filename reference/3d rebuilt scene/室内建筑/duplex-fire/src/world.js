// The world: the solver's fields, the object table, the events, and the
// mechanisms that act on them, run in a fixed order every step.
//
// Mechanisms are separate files (combustion.js, radiation.js, gas.js, ...),
// each owned by one task in 开工顺序.md. They never call each other; they read
// and write the fields and the object table. The only exceptions are
// world.ignite(object) and world.events.emit(...).
//
// A mechanism file's default export is a function that takes the world and
// returns a module: an object with any of the phase methods below, plus
// optional reset(world). The world loads the files in MODULES that exist; a
// file that is missing is skipped, so each task can add its own without
// touching main.js.
//
// One step, in the order of 架构.md 「每一步的顺序」:
//   act(world, dt)       1  your actions and the sources (valves, breakers)
//   source(world, dt)    2  burning objects, leaks and sprays write heat, soot, gas, water into the fields
//   (the solver)         3  wind, carrying everything, and the walls taking heat (house.js, mac3d.js, walls.js)
//   transfer(world, dt)  4  radiation, smoke leaking through gaps
//   react(world, dt)     5  objects read the fields and change state
//   report(world, dt)    6  what changed becomes events and drawing
// If a module throws, it is switched off and the error is printed; the rest
// keeps running.
//
// Every module is timed: world.timings() gives each one's milliseconds per
// step (all its phases together, smoothed), and the solver's. The budget in
// 开工顺序.md is 10 ms per step for all the mechanisms together; the solver
// alone is about 43 ms, which is already about as fast as real time.

import { Events } from './events.js';

const PHASES_BEFORE = ['act', 'source'];
const PHASES_AFTER = ['transfer', 'react', 'report'];

/**
 * Files the world looks for, in this order within each phase. Add a name
 * here when a new mechanism needs its own file.
 */
export const MODULES = ['sources', 'actions', 'combustion', 'gas', 'water', 'radiation', 'leaks', 'card', 'eventsView', 'analysis'];

export class World {
  /**
   * @param {object} o
   * @param {import('./house.js').HouseFire} o.fire  the fields
   * @param {object} o.grid  from buildGrid
   * @param {ReturnType<import('./objects.js').buildObjects>} o.objects
   * @param {object[]} o.rooms  meta.rooms
   * @param {object} o.materials  materials.json
   * @param {object} [o.view]  the page's scene, camera, renderer and the like, for modules that draw
   */
  constructor({ fire, grid, objects, rooms, materials, view = null }) {
    this.fire = fire;
    this.grid = grid;
    this.objects = objects;
    this.rooms = rooms;
    this.materials = materials;
    this.view = view;
    this.events = new Events(() => this.fire.time);
    this.modules = [];
    this.solverMs = 0;
  }

  get time() { return this.fire.time; }

  /**
   * Put an object on fire. combustion.js (task B) replaces this; until then it
   * only marks the state, so flashover or deflagration can be tried without it.
   */
  ignite(object) {
    if (!object.combustible || object.state === '燃烧' || object.state === '烧尽') return false;
    object.state = '燃烧';
    object.ignitedAt = this.time;
    this.events.emit({ type: '点燃', objectId: object.id, pos: centreOf(object) });
    return true;
  }

  /** Add one module (what a mechanism file's factory returned). */
  add(name, module) {
    if (!module) return;
    module.name = name;
    this.modules.push(module);
  }

  /** Load the mechanism files that exist. Call once, after the view is ready. */
  async load(names = MODULES) {
    for (const name of names) {
      let factory;
      try {
        factory = (await import(`./${name}.js`)).default;
      } catch (err) {
        // A file that is not there yet is normal; anything else is a bug in it.
        if (!/Failed to fetch|Cannot find module|ERR_MODULE_NOT_FOUND|Importing a module script failed|error loading dynamically imported module/i.test(String(err))) {
          console.error(`[world] ${name}.js failed to load`, err);
        }
        continue;
      }
      if (typeof factory !== 'function') {
        console.error(`[world] ${name}.js has no default export function`);
        continue;
      }
      try {
        this.add(name, factory(this));
      } catch (err) {
        console.error(`[world] ${name}.js failed to start`, err);
      }
    }
    console.info('[world] modules:', this.modules.map((m) => m.name).join(', ') || 'none');
  }

  run(phase, dt) {
    for (const m of this.modules) {
      if (m.off || typeof m[phase] !== 'function') continue;
      const t = performance.now();
      try {
        m[phase](this, dt);
      } catch (err) {
        m.off = true;
        console.error(`[world] ${m.name}.${phase} threw; ${m.name} is switched off`, err);
      }
      m.stepMs = (m.stepMs ?? 0) + performance.now() - t;
    }
  }

  /** One step of everything, dt = the solver's step. */
  step() {
    const dt = this.fire.dt;
    for (const m of this.modules) m.stepMs = 0;
    for (const p of PHASES_BEFORE) this.run(p, dt);
    const t = performance.now();
    this.fire.step();
    this.solverMs = smooth(this.solverMs, performance.now() - t);
    for (const p of PHASES_AFTER) this.run(p, dt);
    for (const m of this.modules) m.ms = smooth(m.ms, m.stepMs);
  }

  /** Milliseconds per step, smoothed: the solver, then each module that does work in the step. */
  timings() {
    return [
      { name: 'solver', ms: this.solverMs },
      ...this.modules.filter((m) => m.ms != null).map((m) => ({ name: m.name, ms: m.ms, off: !!m.off })),
    ];
  }

  /** Start over: fields (the caller resets the fire), objects, events, every module. */
  reset() {
    this.objects.reset();
    this.events.reset();
    for (const m of this.modules) {
      m.off = false;
      try { m.reset?.(this); } catch (err) { console.error(`[world] ${m.name}.reset threw`, err); }
    }
  }
}

const smooth = (old, now) => (old ? old * 0.9 + now * 0.1 : now);

/** An object's box centre, [x, y, z]. */
export function centreOf(o) {
  return [0, 1, 2].map((a) => (o.min[a] + o.max[a]) / 2);
}
