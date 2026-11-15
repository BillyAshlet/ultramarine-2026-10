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
      if (e.type === 'IfcEnergyConversionDevice' || e.type === 'IfcFlowController') return 'appliance';
      if ((e.type === 'IfcFlowSegment' || e.type === 'IfcFlowFitting') && /Hydronic Supply/.test(e.system ?? '')) return 'water_pipe';
      return null;
    default:
      return null;
  }
}

/**
 * Residential kitchen gas branch spurs (Unit A → A103 Kitchen range,
 * Unit B → B103 Kitchen range). The NIBS Duplex IFC only routed gas to the
 * 2nd-floor utility boilers; these branches tee off each unit's crawlspace
 * gas line, rise behind the 1st-floor kitchen counter, and end at a stove
 * shut-off/hose fitting behind M_Range. Appended after all IFC elements so
 * existing e0..eN indices stay unchanged.
 */
export const KITCHEN_GAS_PIPES = [
  // Unit A branch: from crawlspace elbow e1038 [3.967..4.002, -0.688..-0.660, 9.678..9.713] → A103 Kitchen stove
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Gas Branch', system: 'Unit A Natural Gas', room: null, stoveBranch: true, min: [3.971, -0.691, 9.713], max: [4.004, -0.657, 10.542] },
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Gas Branch', system: 'Unit A Natural Gas', room: null, stoveBranch: true, min: [4.004, -0.691, 10.508], max: [4.567, -0.657, 10.542] },
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Gas Riser', system: 'Unit A Natural Gas', room: 'A103 Kitchen', stoveBranch: true, min: [4.533, -0.657, 10.508], max: [4.567, 0.805, 10.542] },
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Stove Line', system: 'Unit A Natural Gas', room: 'A103 Kitchen', stoveBranch: true, min: [4.567, 0.772, 10.508], max: [5.080, 0.805, 10.542] },
  { layer: 'gas', type: 'IfcFlowFitting', name: 'M_Stove Gas Valve:Kitchen Cock', system: 'Unit A Natural Gas', room: 'A103 Kitchen', stoveBranch: true, stoveValve: true, min: [5.080, 0.768, 10.504], max: [5.125, 0.809, 10.546] },
  // Unit B branch: from crawlspace elbow e1033 [4.027..4.062, -0.672..-0.637, 10.234..10.263] → B103 Kitchen stove
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Gas Branch', system: 'Unit B Natural Gas', room: null, stoveBranch: true, min: [4.031, -0.674, 7.258], max: [4.064, -0.641, 10.234] },
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Gas Riser', system: 'Unit B Natural Gas', room: 'B103 Kitchen', stoveBranch: true, min: [4.031, -0.641, 7.258], max: [4.064, 0.805, 7.292] },
  { layer: 'gas', type: 'IfcFlowSegment', name: 'Pipe Types:Kitchen Stove Line', system: 'Unit B Natural Gas', room: 'B103 Kitchen', stoveBranch: true, min: [3.660, 0.772, 7.258], max: [4.031, 0.805, 7.292] },
  { layer: 'gas', type: 'IfcFlowFitting', name: 'M_Stove Gas Valve:Kitchen Cock', system: 'Unit B Natural Gas', room: 'B103 Kitchen', stoveBranch: true, stoveValve: true, min: [3.615, 0.768, 7.254], max: [3.660, 0.809, 7.296] },
];

export function ensureKitchenGas(meta) {
  if (meta._kitchenGasAdded) return meta._kitchenGasAdded;
  const added = KITCHEN_GAS_PIPES.map((p) => ({ ...p, min: [...p.min], max: [...p.max] }));
  meta.elements.push(...added);
  meta._kitchenGasAdded = added;
  return added;
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
  ensureKitchenGas(meta);
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
