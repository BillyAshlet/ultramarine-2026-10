// The supplies from outside (task F of 开工顺序.md): the power grid, the gas
// network and the water mains, each reaching a unit through one switch.
//
// 架构.md ④: a house fire hardly touches the far end of a utility, only the
// line into the house. So each supply is infinite, and the only thing between
// it and the house is a switch you work by hand: a breaker for power, a valve
// for gas and for water. Nothing switches itself (Billy, 2026-11-09: no
// automatic power cut, no fan stopping on its own).
//
// Who owns what:
//  - Power is here. Each unit's panelboard in the IFC (A101 Foyer, B101 Foyer)
//    is its breaker. What it feeds that matters to the fire is the rooftop
//    exhaust fan on the same panel (the IFC's 'panel' field); the boiler,
//    pumps and lights draw power too but nothing here models what they do.
//  - The gas valve is gas.js's (task D) and the water valve water.js's (task
//    E): each owns its own network, entry and valve. This file only lists them
//    and passes your switch on, so the toolbar has one place to look.
//
// State lives on the object table, so leaks.js (which moves air through a
// running fan) reads it there and never calls this file:
//   panel object: on       breaker closed (power on)
//   fan object:   on       its switch;  running = on and its panel on
import { centreOf } from './world.js';

export default function sources(world) {
  const { objects } = world;
  const fanDefault = world.materials.exhaust_fan?.defaultOn?.value ?? false;
  const unitIn = (s) => /Unit ([AB])/.exec(s ?? '')?.[1] ?? null;

  const breakers = objects.list
    .filter((o) => o.layer === 'electrical' && /Panelboard/.test(o.name))
    .map((o) => ({ o, unit: unitIn(o.name) }))
    .filter((b) => b.unit);
  const fans = objects.list
    .filter((o) => /Rooftop/.test(o.name) && /Fan/.test(o.name))
    .map((o) => ({ o, unit: unitIn(o.element.system), panel: unitIn(o.element.panel) }));

  function defaults() {
    for (const b of breakers) b.o.on = true;
    for (const f of fans) { f.o.on = fanDefault; f.o.running = false; }
  }
  defaults();

  const breakerOf = (unit) => breakers.find((b) => b.unit === unit);
  const powered = (unit) => breakerOf(unit)?.o.on ?? true;

  // Gas and water entries, for drawing their valves: the owner's if it says,
  // else the supply pipe that reaches furthest west (where both come in).
  function entryOf(kind, unit) {
    const owner = world[kind];
    const o = owner?.units?.[unit]?.entry?.o;
    if (o) return o;
    const cls = kind === 'gas' ? '燃气管' : '水管';
    return objects.list
      .filter((x) => x.class === cls && x.type === 'IfcFlowSegment' && unitIn(x.element.system) === unit && !/Hot/.test(x.element.system ?? ''))
      .sort((p, q) => p.min[0] - q.min[0])[0] ?? null;
  }
  // Until gas.js exists, its valves are kept here so the switch still shows.
  const standIn = { gas: { A: true, B: true } };

  const api = {
    breakers,
    fans,
    /** breaker('A', false) cuts Unit A's power; breaker('A') toggles. */
    breaker(unit, on) {
      const b = breakerOf(unit);
      if (!b) throw new Error(`[sources] no panel for unit ${unit}`);
      b.o.on = on ?? !b.o.on;
      world.events.emit({ type: b.o.on ? '合闸' : '拉闸', objectId: b.o.id, pos: centreOf(b.o), data: { unit } });
      return b.o.on;
    },
    /** fan('A', true) switches Unit A's exhaust fan on (an id such as 'e1139' works too). */
    fan(which, on) {
      const f = fans.find((x) => x.unit === which || x.o.id === which);
      if (!f) throw new Error(`[sources] no exhaust fan ${which}`);
      f.o.on = on ?? !f.o.on;
      f.o.running = f.o.on && powered(f.panel);
      world.events.emit({ type: f.o.on ? '排风机开' : '排风机关', objectId: f.o.id, pos: centreOf(f.o), data: { unit: f.unit, powered: powered(f.panel) } });
      return f.o.on;
    },
    /** valve('gas' | 'water', 'A', open): passed on to gas.js / water.js. */
    valve(kind, unit, open) {
      const owner = world[kind];
      if (owner?.valve) return owner.valve(unit, open);
      if (kind === 'gas') {
        standIn.gas[unit] = open ?? !standIn.gas[unit];
        console.info(`[sources] gas.js is not loaded yet: Unit ${unit} gas valve ${standIn.gas[unit] ? 'opened' : 'shut'} here only`);
        return standIn.gas[unit];
      }
      throw new Error(`[sources] ${kind}.js is not loaded`);
    },
    /** Whether a valve is open: from its owner, or the stand-in. */
    valveOpen(kind, unit) {
      const owner = world[kind];
      if (owner?.valve) return owner.valve()[unit] ?? true;
      return standIn[kind]?.[unit] ?? true;
    },
    entryOf,
    /** Every switch and what it is set to. */
    status() {
      return ['A', 'B'].map((unit) => ({
        unit,
        power: powered(unit),
        gas: world.gas?.valve ? api.valveOpen('gas', unit) : `${api.valveOpen('gas', unit)} (gas.js not loaded)`,
        water: api.valveOpen('water', unit),
        fan: fans.filter((f) => f.unit === unit).map((f) => (f.o.running ? 'running' : f.o.on ? 'on, no power' : 'off')).join(' '),
      }));
    },
  };
  world.sources = api;

  return {
    /** 1. A fan runs only while its switch is on and its panel has power. */
    act() { for (const f of fans) f.o.running = f.o.on && powered(f.panel); },
    // Restarting the fire keeps every switch as you left it, as doors stay
    // open or shut: setting the house up first, then lighting it, is the point.
  };
}
