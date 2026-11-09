// The object table: one record per BIM element that fire can act on.
//
// Every mechanism reads and writes these records and the solver's fields, and
// nothing else of each other's (开工顺序.md, 接口). The record is plain data so
// it can be built and checked in node (tools/objects-check.mjs) as well as in
// the page.
//
// Which material an element is comes from its IFC family name; the numbers for
// each material, each with its source, are in materials.json.

/**
 * Family name → material key. First match wins. Names are the Revit families
 * in the NIBS Duplex IFC (duplex-overlay/data/meta.json).
 */
const FURNITURE = [
  [/^M_Sofa/, 'sofa'],
  [/^M_Bed-Standard.*Queen/, 'bed_queen'],
  [/^M_Bed-Standard.*King/, 'bed_king'],
  [/^M_Tall Cabinet/, 'wardrobe'],
  [/^M_(Base|Upper|Vanity) Cabinet/, 'cabinet_run'],
  [/^M_Table-Coffee/, 'coffee_table'],
  [/^M_Counter Top/, 'countertop'],
];

/** The material key for one meta element, or null if fire has nothing to do with it. */
export function materialOf(e) {
  switch (e.layer) {
    case 'furniture': {
      const hit = FURNITURE.find(([re]) => re.test(e.name));
      return hit ? hit[1] : null;
    }
    case 'building':
      if (e.type === 'IfcDoor') return 'door_wood';
      if (e.type === 'IfcWindow') return 'window';
      return null;
    case 'gas':
      return 'gas_pipe';
    case 'water':
      // Supply pipes can burst and spray; waste and storm pipes are drains.
      return e.kind === 'cold' || e.kind === 'hot' ? 'water_pipe' : 'drain_pipe';
    case 'fixtures':
      return 'appliance';
    case 'electrical':
      // Conduit runs are left out; panels, detectors and outlets stay (cards, leaks).
      return e.kind === 'conduit' ? null : 'appliance';
    case 'heating':
      // Hundreds of hydronic pipe pieces: only the radiators and valves.
      return e.type === 'IfcEnergyConversionDevice' || e.type === 'IfcFlowController' ? 'appliance' : null;
    default:
      return null;
  }
}

const value = (m, key) => (m && m[key] && typeof m[key] === 'object' ? m[key].value : undefined);

/**
 * How much heat an item can give, in MJ, from its material: a measured total,
 * a total per metre of length (cabinet runs), or another material scaled.
 * Null when the material does not burn or the number is still unknown.
 */
export function fuelOf(materials, key, size) {
  const m = materials[key];
  if (!m || value(m, 'combustible') === false) return null;
  const total = value(m, 'totalHeat');
  if (total != null) return total / 1e6;
  const perMetre = value(m, 'totalHeatPerMetre');
  if (perMetre != null) return (perMetre * Math.max(size[0], size[2])) / 1e6;
  if (m.scaleFrom) {
    const base = fuelOf(materials, m.scaleFrom.value, size);
    return base == null ? null : base * m.scaleFrom.factor;
  }
  return null;
}

/** The surface fire can reach: the whole box but its underside, in m². */
function exposedArea([x, y, z]) {
  return 2 * (x * y + z * y) + x * z;
}

/** A fresh record's changing part; also what reset puts back. */
function freshState(o) {
  o.state = '完好';
  o.flux = 0;
  o.dose = 0;
  o.hrr = 0;
  o.burnedMJ = 0;
  o.ignitedAt = null;
  o.wet = 0;
}

/**
 * Build the table.
 * @param {object} meta  duplex-overlay's meta.json
 * @param {object} grid  from buildGrid: cellsInBox, solid, cell
 * @param {object} materials  materials.json
 * @returns {{list: object[], byId: Map, byElement: Map, reset: Function}}
 */
export function buildObjects(meta, grid, materials) {
  const list = [];
  const byId = new Map();
  const byElement = new Map();
  const pad = grid.cell / 2;
  meta.elements.forEach((e, index) => {
    const key = materialOf(e);
    if (!key) return;
    const m = materials[key];
    const size = [0, 1, 2].map((a) => e.max[a] - e.min[a]);
    // The air touching it: cells overlapping its box grown by half a cell.
    // Furniture is not in the grid, so its own cells are air too; for pipes
    // and doors inside walls only the open cells next to them are kept.
    // An element buried in a wall or floor has none; it gets the air within
    // a cell and a half instead (wallAir is then true), which is the room
    // side of the wall it is in.
    const airAround = (p) => grid.cellsInBox({
      min: { x: e.min[0] - p, y: e.min[1] - p, z: e.min[2] - p },
      max: { x: e.max[0] + p, y: e.max[1] + p, z: e.max[2] + p },
    }).filter((c) => !grid.solid[c]);
    let cells = airAround(pad);
    const wallAir = cells.length === 0;
    if (wallAir) cells = airAround(grid.cell * 1.5);
    cells = Int32Array.from(cells);
    const o = {
      id: `e${index}`,
      element: e,
      name: e.name,
      type: e.type,
      layer: e.layer,
      class: m.class,
      material: key,
      label: m.label,
      combustible: value(m, 'combustible') !== false,
      room: e.room ?? e.beside ?? null,
      min: e.min,
      max: e.max,
      size,
      cells,
      wallAir,
      area: exposedArea(size),
      fuelMJ: fuelOf(materials, key, size),
    };
    freshState(o);
    list.push(o);
    byId.set(o.id, o);
    byElement.set(e, o);
  });
  return {
    list,
    byId,
    byElement,
    /** Back to the start of a fire: every object whole and cold. */
    reset() { for (const o of list) freshState(o); },
  };
}
