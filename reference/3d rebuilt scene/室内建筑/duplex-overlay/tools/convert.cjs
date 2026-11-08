// Turn the Duplex IFC files into a few flat binary layers the page can load
// without web-ifc in the browser.
//
// Usage, from this folder's parent:
//   node tools/convert.cjs ../../../fliud3d/node_modules/web-ifc
//
// Only Architecture and MEP are used. They were exported on the same day
// (2011-09-07) and the MEP file already contains every electrical item of the
// Electrical file at the identical position. The Mechanical (2011-10-24) and
// Plumbing (2012-11-13) files are later revisions: about a third of their
// pipes moved or are new, so mixing them in would show two versions of the
// same pipe run. See README.md.
const path = require('path');
const fs = require('fs');

const here = path.join(__dirname, '..');
const webIfcDir = path.resolve(process.argv[2] || path.join(here, '../../../fliud3d/node_modules/web-ifc'));
const WebIFC = require(path.join(webIfcDir, 'web-ifc-api-node.js'));

const FILES = { arch: 'ifc/Ifc2x3_Duplex_Architecture.ifc', mep: 'ifc/Ifc2x3_Duplex_MEP.ifc' };

// Each element goes to one layer and gets one colour.
const COLOURS = {
  wall: [200, 200, 205], slab: [170, 170, 175], opening: [150, 190, 220], furniture: [190, 170, 140],
  gas: [255, 196, 0],
  cold: [60, 140, 255], hot: [255, 90, 60], sanitary: [150, 105, 70], storm: [60, 200, 190],
  hydronicSupply: [230, 60, 160], hydronicReturn: [140, 80, 220], exhaust: [160, 160, 160],
  power: [80, 220, 120], conduit: [40, 160, 80], alarm: [255, 60, 60], panel: [255, 255, 255],
  fixture: [235, 235, 235], unknown: [120, 120, 120],
};

function str(v) { return v && typeof v === 'object' && 'value' in v ? v.value : v; }

function classify(type, name, props) {
  const sys = String(props['System Name'] || props['System Type'] || props['System Classification'] || '');
  if (type === 'IfcFurnishingElement') return ['furniture', 'furniture'];
  if (/^IfcWall|IfcColumn|IfcBeam|IfcMember|IfcFooting|IfcRailing|IfcStair|IfcCovering|IfcRoof/.test(type)) return ['building', 'wall'];
  if (type === 'IfcSlab') return ['building', 'slab'];
  if (type === 'IfcDoor' || type === 'IfcWindow') return ['building', 'opening'];
  // Devices that serve several systems (the boilers) or none (the kitchen
  // range) are fixtures, so turning a system off does not hide them.
  if (/Boiler|Range|Refrigerator|Microwave|Water Closet|Lavatory|Sink|Bath Tub|Shower|Faucet|Fan|Pump/.test(name)) return ['fixtures', 'fixture'];
  if (/Natural Gas/.test(sys)) return ['gas', 'gas'];
  if (/Hot Water/.test(sys)) return ['water', 'hot'];
  if (/Cold Water/.test(sys)) return ['water', 'cold'];
  if (/Sanitary/.test(sys)) return ['water', 'sanitary'];
  if (/Storm/.test(sys)) return ['water', 'storm'];
  if (/Hydronic Return/.test(sys)) return ['heating', 'hydronicReturn'];
  if (/Hydronic/.test(sys)) return ['heating', 'hydronicSupply'];
  if (/Exhaust/.test(sys)) return ['heating', 'exhaust'];
  if (/Conduit/.test(name)) return ['electrical', 'conduit'];
  if (/Smoke Detector|Fire Alarm/.test(name)) return ['electrical', 'alarm'];
  if (/Panelboard|Telephone Terminal/.test(name)) return ['electrical', 'panel'];
  if (props.Panel !== undefined || /Receptacle|Switch|Light|Telephone|Thermostat/.test(name)) return ['electrical', 'power'];
  return ['other', 'unknown'];
}

(async () => {
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath(webIfcDir + '/', true);
  await api.Init();

  const layers = {};   // layer -> { pos: number[], col: number[], idx: number[] }
  const elements = [];
  let rooms = [];

  for (const [source, file] of Object.entries(FILES)) {
    const id = api.OpenModel(new Uint8Array(fs.readFileSync(path.join(here, file))), { COORDINATE_TO_ORIGIN: false });

    const props = new Map();
    const rels = api.GetLineIDsWithType(id, WebIFC.IFCRELDEFINESBYPROPERTIES);
    const cache = new Map();
    for (let i = 0; i < rels.size(); i++) {
      const rel = api.GetLine(id, rels.get(i), false);
      const psetId = rel.RelatingPropertyDefinition.value;
      if (!cache.has(psetId)) {
        const kv = {};
        for (const ref of api.GetLine(id, psetId, false).HasProperties || []) {
          const p = api.GetLine(id, ref.value, false);
          kv[str(p.Name)] = str(p.NominalValue);
        }
        cache.set(psetId, kv);
      }
      for (const o of rel.RelatedObjects) props.set(o.value, Object.assign(props.get(o.value) || {}, cache.get(psetId)));
    }

    const meshes = (types, cb) => {
      const fn = (mesh) => {
        const tris = [];
        for (let g = 0; g < mesh.geometries.size(); g++) {
          const pg = mesh.geometries.get(g);
          const geom = api.GetGeometry(id, pg.geometryExpressID);
          const v = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
          const ix = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
          const m = pg.flatTransformation;
          const world = [];
          for (let k = 0; k < v.length; k += 6) {
            const x = v[k], y = v[k + 1], z = v[k + 2];
            world.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
          }
          tris.push({ world, ix: Array.from(ix) });
          geom.delete();
        }
        cb(mesh.expressID, tris);
      };
      if (types) api.StreamAllMeshesWithTypes(id, types, fn); else api.StreamAllMeshes(id, fn);
    };

    if (source === 'arch') {
      meshes([WebIFC.IFCSPACE], (eid, parts) => {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (const { world } of parts) for (let k = 0; k < world.length; k += 3) for (let a = 0; a < 3; a++) {
          min[a] = Math.min(min[a], world[k + a]); max[a] = Math.max(max[a], world[k + a]);
        }
        const line = api.GetLine(id, eid, false);
        rooms.push({ code: str(line.Name), name: str(line.LongName), min, max });
      });
    }

    meshes(null, (eid, parts) => {
      const line = api.GetLine(id, eid, false);
      const type = api.GetNameFromTypeCode(api.GetLineType(id, eid));
      const name = str(line.Name) || '';
      const p = props.get(eid) || {};
      const [layer, kind] = classify(type, name, p);
      const L = layers[layer] || (layers[layer] = { pos: [], col: [], idx: [] });
      const colour = COLOURS[kind];
      const t0 = L.idx.length / 3;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const { world, ix } of parts) {
        const base = L.pos.length / 3;
        for (let k = 0; k < world.length; k++) {
          L.pos.push(world[k]);
          const a = k % 3;
          min[a] = Math.min(min[a], world[k]); max[a] = Math.max(max[a], world[k]);
        }
        for (let k = 0; k < world.length / 3; k++) L.col.push(...colour);
        for (const i of ix) L.idx.push(base + i);
      }
      const va = /-(\d+) VA/.exec(String(p['Electrical Data'] || ''));
      elements.push({
        source, layer, kind, type,
        name: name.replace(/:\d+$/, ''),
        system: p['System Name'] || null,
        panel: p.Panel || null,
        circuit: p['Circuit Number'] || null,
        va: va ? Number(va[1]) : null,
        min, max, t0, t1: L.idx.length / 3,
      });
    });
    api.CloseModel(id);
  }

  // Which room each element's centre falls in, by the architect's room boxes.
  // Rooms stop at the inside face of the wall. A margin of 15 cm once put the
  // gas risers, which run beside a wall, "in" the kitchen next door, so things
  // in or against a wall now get no room rather than a wrong one.
  for (const e of elements) {
    const c = [0, 1, 2].map((a) => (e.min[a] + e.max[a]) / 2);
    const r = rooms.find((s) => [0, 1, 2].every((a) => c[a] >= s.min[a] - 0.02 && c[a] <= s.max[a] + 0.02));
    e.room = r ? `${r.code} ${r.name}` : null;
    // Outlets, panels and risers sit in walls. Name the closest room, and
    // say it is only beside it, since the other side of the wall is as close.
    if (!r) {
      let best = null, bestGap = 0.4;
      for (const s of rooms) {
        const gap = Math.hypot(...[0, 1, 2].map((a) => Math.max(s.min[a] - c[a], 0, c[a] - s.max[a])));
        if (gap < bestGap) { best = s; bestGap = gap; }
      }
      e.beside = best ? `${best.code} ${best.name}` : null;
    }
  }

  const meta = { layers: {}, elements, rooms };
  for (const [name, L] of Object.entries(layers)) {
    const vertices = L.pos.length / 3;
    const pos = new Float32Array(L.pos);
    const col = new Uint8Array(L.col);
    const idx = vertices < 65536 ? new Uint16Array(L.idx) : new Uint32Array(L.idx);
    // Laid out position, colour, index, each padded to 4 bytes.
    const pad = (n) => Math.ceil(n / 4) * 4;
    const buf = Buffer.alloc(pos.byteLength + pad(col.byteLength) + pad(idx.byteLength));
    Buffer.from(pos.buffer).copy(buf, 0);
    Buffer.from(col.buffer).copy(buf, pos.byteLength);
    Buffer.from(idx.buffer).copy(buf, pos.byteLength + pad(col.byteLength));
    fs.writeFileSync(path.join(here, 'data', `${name}.bin`), buf);
    meta.layers[name] = { vertices, indices: idx.length, wideIndex: idx instanceof Uint32Array };
    console.log(name, vertices, 'vertices', idx.length / 3, 'triangles', (buf.length / 1e6).toFixed(1) + ' MB');
  }
  fs.writeFileSync(path.join(here, 'data', 'meta.json'), JSON.stringify(meta));
})();
