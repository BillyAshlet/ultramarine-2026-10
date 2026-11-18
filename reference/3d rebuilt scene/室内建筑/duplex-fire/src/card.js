// Cards: click any object in the Duplex and see what it is, what the
// measurements say about how it burns, and where each number comes from.
// While it burns, a live row shows its heat release right now.
//
// Two parts:
//   showCard(spec) / hideCard()  the panel. Task G reuses it for event cards
//                                (import { showCard } from './card.js', or
//                                world.showCard).
//   the default export           the world module: picking objects with the
//                                pointer and filling the card from the object
//                                table and materials.json.
//
// The card reads the object table and materials.json and writes nothing back.
// Its styles are injected from here so index.html stays untouched.
//
// Picking reuses the doors.js approach: only the objects are tested, never
// the walls, so a see-through wall in front does not stop a click; anything
// above the storey cut, or on a layer that is switched off, can't be picked.

import * as THREE from 'three';
import { DRAW_DIAMETER } from './pipes.js';

// --- the panel ----------------------------------------------------------------------

const STYLE = `
#card { position: fixed; top: 12px; right: 12px; width: 340px; max-width: calc(100vw - 24px); max-height: calc(100vh - 60px);
  overflow-y: auto; box-sizing: border-box; background: var(--panel, rgba(16,19,23,.92)); border: 1px solid #2a3038;
  border-radius: 8px; padding: 12px 14px; color: var(--text, #e6e6ea); font: 13px/1.45 -apple-system, system-ui, sans-serif; z-index: 10; }
#card[hidden] { display: none; }
#card .close { position: absolute; top: 6px; right: 8px; background: none; border: 0; color: var(--dim, #9a9aa6); font-size: 18px; cursor: pointer; padding: 2px 6px; }
#card .close:hover { color: var(--text, #e6e6ea); }
#card h2 { font-size: 15px; margin: 0 24px 2px 0; }
#card .sub { color: var(--dim, #9a9aa6); font-size: 11.5px; margin-bottom: 8px; word-break: break-word; }
#card table { border-collapse: collapse; width: 100%; }
#card td { padding: 3px 0; vertical-align: top; }
#card td.k { color: var(--dim, #9a9aa6); padding-right: 10px; white-space: nowrap; width: 1%; }
#card td.v { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
#card sup { color: var(--dim, #9a9aa6); font-size: 10px; margin-left: 2px; }
#card .tag { display: inline-block; font-size: 10.5px; line-height: 1.3; padding: 0 4px; margin-left: 4px; border-radius: 3px;
  background: #4a3a14; color: #ffc861; vertical-align: 1px; }
#card .live { border-top: 1px solid #2a3038; border-bottom: 1px solid #2a3038; margin: 6px 0; padding: 4px 0; }
#card .live td.v { color: var(--accent, #ff6a1a); font-weight: 600; }
#card .live tr[hidden] { display: none; }
#card .note { color: var(--dim, #9a9aa6); font-size: 12px; margin: 8px 0 0; }
#card .chart { margin: 8px 0 2px; }
#card .chart svg { display: block; width: 100%; height: auto; }
#card .chart .cap { color: var(--dim, #9a9aa6); font-size: 11px; }
#card img { display: block; max-width: 100%; margin: 8px 0; border-radius: 4px; }
#card ol { margin: 8px 0 0; padding-left: 20px; color: var(--dim, #9a9aa6); font-size: 11.5px; }
#card ol li { margin: 2px 0; word-break: break-word; }
#card .srchead { margin-top: 10px; font-size: 11.5px; color: var(--dim, #9a9aa6); }
@media (max-width: 700px) { #card { top: 8px; right: 8px; left: 8px; width: auto; max-height: 45vh; } }
`;

let panel = null;
let liveCells = [];
let liveChart = null;
let liveTimer = 0;
let onHide = null;

function ensurePanel() {
  if (panel) return panel;
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  panel = document.createElement('div');
  panel.id = 'card';
  panel.hidden = true;
  document.body.appendChild(panel);
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panel.hidden) hideCard(); });
  return panel;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/** A source that is ours rather than a measurement gets a tag on its row. */
function tagOf(source) {
  if (!source) return null;
  const s = String(source);
  if (/^\s*假设/.test(s) || /\(假设/.test(s)) return '假设';
  if (/\[估\]/.test(s)) return '估';
  return null;
}

/**
 * Show the card.
 * @param {object} spec
 * @param {string} spec.title
 * @param {string} [spec.subtitle]
 * @param {Array<[string, string, string?]>} [spec.rows]  [label, value, source?]. A row with a
 *   source gets a footnote number; a source starting 假设 or holding [估] also gets a tag.
 * @param {Array<[string, () => (string|null|undefined)]>} [spec.live]  refreshed every frame;
 *   a getter that returns null or undefined hides its row for now.
 * @param {string[]} [spec.sources]  more sources, listed after the rows' own.
 * @param {string} [spec.image]  a picture's URL.
 * @param {string} [spec.note]  a paragraph under the rows.
 * @param {{points: number[][], unit?: string, caption?: string, source?: string,
 *   now?: () => (number[]|null)}} [spec.chart]  a measured curve [[x, y], ...] and, optionally,
 *   where this item is on it right now.
 * @param {() => void} [spec.onHide]  called when the card is closed or replaced.
 */
export function showCard({ title, subtitle, rows = [], live = [], sources = [], image, note, chart, onHide: hide } = {}) {
  const p = ensurePanel();
  if (onHide) { const f = onHide; onHide = null; f(); }
  p.replaceChildren();

  const close = el('button', 'close', '×');
  close.title = 'Close 关闭 (Esc)';
  close.addEventListener('click', hideCard);
  p.append(close, el('h2', null, title ?? ''));
  if (subtitle) p.append(el('div', 'sub', subtitle));

  // Footnotes: one number per distinct source, in the order rows use them.
  const notes = [];
  const noteOf = (s) => {
    let i = notes.indexOf(s);
    if (i < 0) { notes.push(s); i = notes.length - 1; }
    return i + 1;
  };

  liveCells = [];
  if (live.length) {
    const t = el('table', 'live');
    for (const [label, get] of live) {
      const tr = el('tr');
      const v = el('td', 'v');
      tr.append(el('td', 'k', label), v);
      t.append(tr);
      liveCells.push({ tr, v, get, last: undefined });
    }
    p.append(t);
  }

  if (rows.length) {
    const t = el('table');
    for (const [label, value, source] of rows) {
      const tr = el('tr');
      const v = el('td', 'v', value ?? '—');
      if (source) {
        const tag = tagOf(source);
        if (tag) v.append(el('span', 'tag', tag));
        v.append(el('sup', null, String(noteOf(source))));
      }
      tr.append(el('td', 'k', label), v);
      t.append(tr);
    }
    p.append(t);
  }

  liveChart = null;
  if (chart && chart.points?.length > 1) {
    const box = el('div', 'chart');
    const { svg, dot } = drawChart(chart.points);
    box.append(svg);
    const cap = el('div', 'cap', chart.caption ?? '');
    if (chart.source) cap.append(el('sup', null, String(noteOf(chart.source))));
    box.append(cap);
    p.append(box);
    if (chart.now) liveChart = { dot, now: chart.now, scale: svg.scale };
  }

  if (note) p.append(el('p', 'note', note));
  if (image) {
    const img = el('img');
    img.src = image;
    img.alt = title ?? '';
    p.append(img);
  }

  for (const s of sources) if (s) noteOf(s);
  if (notes.length) {
    p.append(el('div', 'srchead', 'Sources 来源'));
    const ol = el('ol');
    for (const s of notes) ol.append(el('li', null, s));
    p.append(ol);
  }

  onHide = hide ?? null;
  p.hidden = false;
  refreshLive();
  if (!liveTimer && (liveCells.length || liveChart)) liveTimer = requestAnimationFrame(tick);
  return { close: hideCard };
}

export function hideCard() {
  if (!panel) return;
  panel.hidden = true;
  liveCells = [];
  liveChart = null;
  if (liveTimer) cancelAnimationFrame(liveTimer);
  liveTimer = 0;
  if (onHide) { const f = onHide; onHide = null; f(); }
}

function tick() {
  liveTimer = 0;
  if (!panel || panel.hidden) return;
  refreshLive();
  liveTimer = requestAnimationFrame(tick);
}

function refreshLive() {
  for (const c of liveCells) {
    let v;
    try { v = c.get(); } catch { v = null; }
    if (v === c.last) continue;
    c.last = v;
    c.tr.hidden = v == null;
    c.v.textContent = v ?? '';
  }
  if (liveChart) {
    let at = null;
    try { at = liveChart.now(); } catch { at = null; }
    liveChart.dot.style.display = at ? '' : 'none';
    if (at) {
      const [x, y] = liveChart.scale(at[0], at[1]);
      liveChart.dot.setAttribute('cx', x);
      liveChart.dot.setAttribute('cy', y);
    }
  }
}

/** A small line chart of a measured curve [[s, kW], ...], minutes on x, MW on y. */
function drawChart(points) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 300, H = 96, L = 30, R = 6, T = 6, B = 18;
  const xMax = Math.max(...points.map((q) => q[0]));
  const yMax = Math.max(...points.map((q) => q[1]));
  const scale = (x, y) => [
    L + (Math.min(x, xMax) / xMax) * (W - L - R),
    H - B - (Math.min(y, yMax * 1.15) / (yMax * 1.15)) * (H - T - B),
  ];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    svg.append(e);
    return e;
  };
  const axis = { stroke: '#3a414b', 'stroke-width': 1 };
  add('line', { x1: L, y1: H - B, x2: W - R, y2: H - B, ...axis });
  add('line', { x1: L, y1: T, x2: L, y2: H - B, ...axis });
  const label = { fill: '#9a9aa6', 'font-size': 9, 'font-family': 'system-ui, sans-serif' };
  add('text', { x: L - 4, y: scale(0, yMax)[1] + 3, 'text-anchor': 'end', ...label }, `${fmt(yMax / 1000)}`);
  add('text', { x: L - 4, y: H - B + 3, 'text-anchor': 'end', ...label }, '0');
  add('text', { x: L + 4, y: T + 6, ...label }, 'MW');
  add('text', { x: W - R, y: H - 4, 'text-anchor': 'end', ...label }, `${fmt(xMax / 60)} min`);
  add('text', { x: L, y: H - 4, ...label }, '0');
  add('polyline', {
    points: points.map(([x, y]) => scale(x, y).join(',')).join(' '),
    fill: 'none', stroke: '#ff9a3c', 'stroke-width': 1.5, 'stroke-linejoin': 'round',
  });
  const dot = add('circle', { r: 3.5, fill: '#ff6a1a', stroke: '#fff', 'stroke-width': 1 });
  dot.style.display = 'none';
  svg.scale = scale;
  return { svg, dot };
}

// --- numbers ---------------------------------------------------------------------------

/** Up to four significant figures, no trailing zeros: 2.217, 0.35, 1349. */
function fmt(x) {
  if (x == null || !Number.isFinite(x)) return String(x);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1000) return String(Math.round(x));
  return String(+x.toPrecision(4));
}

/** A {value, unit} from materials.json in readable units. */
export function formatValue(value, unit = '') {
  if (value == null) return 'no data 无数据';
  if (typeof value === 'boolean') return value ? 'yes 是' : 'no 否';
  if (typeof value !== 'number') return String(value);
  switch (unit) {
    case 'W': return watts(value);
    case 'W/m': return `${watts(value)}/m`;
    case 'J': return `${fmt(value / 1e6)} MJ`;
    case 'J/m': return `${fmt(value / 1e6)} MJ/m`;
    case 'J/kg': return `${fmt(value / 1e6)} MJ/kg`;
    case 's': return `${fmt(value)} s (${(value / 60).toFixed(1)} min)`;
    case '': return fmt(value);
    default: return `${fmt(value)} ${unit}`;
  }
}

function watts(w) {
  const a = Math.abs(w);
  if (a >= 1e6) return `${fmt(w / 1e6)} MW`;
  if (a >= 1e3) return `${fmt(w / 1e3)} kW`;
  return `${fmt(w)} W`;
}

// --- an object's card ----------------------------------------------------------------

/** materials.json fields, in the order the card lists them, with their labels. */
const FIELDS = [
  ['criticalFlux', 'Ignites above 点燃热流'],
  ['ignitionTemp', 'Ignition temp 点燃温度'],
  ['krc', 'kρc 热惯性'],
  ['peakHRR', 'Peak 峰值热释放'],
  ['peakHRRPerMetre', 'Peak per metre 每米峰值'],
  ['timeToPeak', 'Time to peak 到峰值'],
  ['totalHeat', 'Total heat 总热量'],
  ['totalHeatPerMetre', 'Heat per metre 每米热量'],
  ['scaleFrom', 'Scaled from 缩放自'],
  ['radiantFraction', 'Radiant fraction 辐射分数'],
  ['sootYield', 'Soot yield 烟灰产率'],
  ['coYield', 'CO yield CO 产率'],
  ['heatOfCombustion', 'Heat of combustion 燃烧热'],
  ['combustible', 'Burns 可燃'],
];
// Shown elsewhere on the card, or not a number.
const SKIP = new Set(['label', 'class', 'reference', 'note', 'curve']);
const ALIAS = { queen: 'bed_queen' };

/** A source like 'as sofa' or 'as queen ([估])', followed to the entry it names. */
function resolveSource(materials, key, source) {
  const m = /^as (\w+)/.exec(source ?? '');
  if (!m) return source;
  const other = materials[ALIAS[m[1]] ?? m[1]]?.[key]?.source;
  return other ? `${source} → ${other}` : source;
}

/**
 * The card for one object of the object table: everything materials.json says
 * about its material, each with its source, and live rows from the object.
 * @param {object} o  a record of world.objects
 * @param {object} world
 */
export function cardFor(o, world) {
  const materials = world.materials;
  const m = materials[o.material] ?? {};
  const rows = [
    ['Class 类别', o.class],
    ['Room 房间', o.room ?? '—'],
  ];
  if (o.element?.aholoSource) rows.push(['Asset 资产来源', o.element.aholoSource]);
  if (m.reference) rows.push(['Tested as 参考实测', m.reference]);

  const used = new Set();
  for (const [key, label] of FIELDS) {
    const f = m[key];
    if (!f || typeof f !== 'object') continue;
    used.add(key);
    rows.push(fieldRow(materials, key, label, f));
  }
  // Fields added after this file was written still show, under their own key.
  for (const [key, f] of Object.entries(m)) {
    if (used.has(key) || SKIP.has(key) || !f || typeof f !== 'object' || !('value' in f)) continue;
    rows.push(fieldRow(materials, key, key, f));
  }

  // How much this one item holds, which differs from the tested item when it
  // is worked out per metre or scaled.
  if (o.combustible && o.fuelMJ != null) {
    // A measured total needs no source of its own: it is the Total heat row.
    let how = null;
    const length = Math.max(o.size[0], o.size[2]);
    if (m.totalHeat?.value != null) how = null;
    else if (m.totalHeatPerMetre) how = `[估] ${fmt(m.totalHeatPerMetre.value / 1e6)} MJ/m × ${fmt(length)} m, its longest side (objects.js fuelOf)`;
    else if (m.scaleFrom) how = `[估] ${m.scaleFrom.value} × ${m.scaleFrom.factor} (objects.js fuelOf)`;
    rows.push(['This one holds 这一件的热量', `${fmt(o.fuelMJ)} MJ`, how ?? undefined]);
  }

  rows.push(['BIM', `${o.name} · ${o.type} · ${o.id}`]);

  const watching = o.combustible || o.class === '燃气管' || o.class === '水管' || o.class === '门' || o.class === '窗';
  const live = [
    ['State 状态', () => o.state],
    ['Now 现在', () => (o.hrr > 0 || o.state === '燃烧' ? watts(o.hrr) : null)],
    ['Burning for 已烧', () => (o.ignitedAt != null ? clock(world.time - o.ignitedAt) : null)],
    ['Burned 已烧掉', () => (o.burnedMJ > 0 ? `${fmt(o.burnedMJ)}${o.fuelMJ ? ` of ${fmt(o.fuelMJ)}` : ''} MJ` : null)],
    ['Heat on it 受热', () => (o.flux > 0.05 ? `${fmt(o.flux)} kW/m²` : null)],
    ['Water on it 落水', () => (o.wet > 0 ? `${fmt(o.wet)} kg` : null)],
  ];

  const curve = m.curve?.value;
  const chart = curve ? {
    points: curve,
    caption: 'Measured heat release of the tested item 实测热释放 · dot: this one now 圆点：这一件现在',
    source: m.curve.source,
    now: () => (o.ignitedAt != null && (o.hrr > 0 || o.state === '燃烧') ? [world.time - o.ignitedAt, o.hrr / 1000] : null),
  } : null;

  return {
    title: o.label ?? o.name,
    subtitle: o.wallAir ? `${o.room ?? ''} · inside a wall or floor 埋在墙或楼板里` : undefined,
    rows,
    live: watching ? live : [['State 状态', () => o.state]],
    chart,
    note: m.note,
  };
}

function fieldRow(materials, key, label, f) {
  let value;
  if (key === 'scaleFrom') value = `${materials[f.value]?.label ?? f.value} × ${f.factor}`;
  else value = formatValue(f.value, f.unit);
  return [label, value, resolveSource(materials, key, f.source) || undefined];
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// --- picking ---------------------------------------------------------------------------

/**
 * Pick meshes for every object the pointer can reach, each with its own
 * bounds. Pipes are drawn fatter than they are (pipes.js), so their pick
 * bounds are grown to the drawn size; windows have no mesh of their own here
 * and are picked by their box, thickened so a click on the glass lands.
 */
function buildTargets(world) {
  const { extras, services, doors } = world.view;
  const { byElement } = world.objects;
  const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const targets = [];
  const add = (layer, srcMesh, grow) => {
    const o = byElement.get(srcMesh.userData.element);
    if (!o) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', srcMesh.geometry.attributes.position);
    g.setIndex(srcMesh.geometry.index);
    const box = srcMesh.geometry.boundingBox.clone().expandByScalar(grow);
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, pickMaterial);
    mesh.userData.object = o;
    mesh.userData.layer = layer;
    targets.push(mesh);
  };
  for (const [layer, l] of Object.entries(extras ?? {})) for (const m of l.elements) add(layer, m, 0.01);
  for (const [layer, l] of Object.entries(services ?? {})) for (const m of l.elements) add(layer, m, DRAW_DIAMETER / 2);
  // Doors: the shapes doors.js draws, the doorway and the swinging leaf.
  for (const d of doors?.doors ?? []) {
    const o = byElement.get(d.state.element);
    if (!o) continue;
    for (const mesh of [d.mesh, d.leaf]) targets.push(tag(mesh, o));
  }
  const windows = world.objects.list.filter((o) => o.class === '窗').map((o) => {
    const box = new THREE.Box3(new THREE.Vector3(...o.min), new THREE.Vector3(...o.max));
    const size = box.getSize(new THREE.Vector3());
    const thin = size.x < size.z ? 'x' : 'z';
    const c = box.getCenter(new THREE.Vector3());
    box.min[thin] = Math.min(box.min[thin], c[thin] - 0.1);
    box.max[thin] = Math.max(box.max[thin], c[thin] + 0.1);
    return { box, o };
  });
  return { targets, windows };
}

// Doors' own meshes are picked directly; which object each is goes in a side table.
const doorObject = new WeakMap();
function tag(mesh, o) {
  doorObject.set(mesh, o);
  return mesh;
}

export default function cardModule(world) {
  if (typeof document === 'undefined' || !world.view) return null;
  const { renderer, rayAt, cut, extraMeshes, serviceMeshes } = world.view;
  world.showCard = showCard;
  world.hideCard = hideCard;

  const { targets, windows } = buildTargets(world);
  const raycaster = new THREE.Raycaster();
  const hitPoint = new THREE.Vector3();

  const layerVisible = (layer) => {
    const mesh = extraMeshes?.[layer] ?? serviceMeshes?.[layer];
    return mesh ? mesh.visible : true;
  };
  const drawn = (p) => !cut || cut.distanceToPoint(p) >= 0;

  /** The object under the pointer, or null. Walls are not tested. */
  function pick(ev) {
    raycaster.ray.copy(rayAt(ev));
    let best = null;
    for (const h of raycaster.intersectObjects(targets, false)) {
      if (!drawn(h.point)) continue;
      const layer = h.object.userData.layer;
      if (layer && !layerVisible(layer)) continue;
      const o = h.object.userData.object ?? doorObject.get(h.object);
      if (o) { best = { o, d: h.distance }; break; }
    }
    for (const w of windows) {
      if (!raycaster.ray.intersectBox(w.box, hitPoint) || !drawn(hitPoint)) continue;
      const d = raycaster.ray.origin.distanceTo(hitPoint);
      if (!best || d < best.d) best = { o: w.o, d };
    }
    return best?.o ?? null;
  }

  // Outlines: a faint one for what the pointer is on, a bright one for the card's object.
  const outline = (color, opacity) => {
    const h = new THREE.Box3Helper(new THREE.Box3(), color);
    h.material.depthTest = false;
    h.material.transparent = true;
    h.material.opacity = opacity;
    h.renderOrder = 21;
    h.visible = false;
    world.view.scene.add(h);
    return h;
  };
  const hoverBox = outline(0xffc861, 0.45);
  const selectBox = outline(0xff6a1a, 1);
  const frame = (h, o) => {
    h.visible = !!o;
    if (!o) return;
    h.box.min.set(...o.min);
    h.box.max.set(...o.max);
  };

  // The page's own modes take the click: placing the fire, and the fire's
  // own marker, which is dragged. Placing shows as a lit "Fire on Level" button.
  const placing = () => !!document.querySelector('[data-place].on');

  let selected = null;
  function open(o) {
    selected = o;
    frame(selectBox, o);
    showCard({ ...cardFor(o, world), onHide: () => { if (selected === o) { selected = null; frame(selectBox, null); } } });
  }

  const canvas = renderer.domElement;
  // Whether we were placing is read on pointerdown: main.js's own pointerup
  // places the fire and leaves the mode before this one runs.
  let downAt = null, placingAtDown = false;
  canvas.addEventListener('pointerdown', (ev) => {
    downAt = [ev.clientX, ev.clientY];
    placingAtDown = placing();
  });
  canvas.addEventListener('pointerup', (ev) => {
    // A click, not the end of a drag that turned the view or moved the fire.
    if (!downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4 || placingAtDown) return;
    const o = pick(ev);
    if (o) open(o);
    else if (selected) hideCard();
  });

  let pending = null;
  canvas.addEventListener('pointermove', (ev) => {
    if (ev.buttons) { frame(hoverBox, null); return; }
    if (pending) { pending = ev; return; }
    pending = ev;
    requestAnimationFrame(() => {
      const e = pending;
      pending = null;
      const o = placing() ? null : pick(e);
      frame(hoverBox, o && o !== selected ? o : null);
      // doors.js clears the cursor on every move when no door is under it; this runs after it.
      if (o) canvas.style.cursor = 'pointer';
    });
  });
  canvas.addEventListener('pointerleave', () => frame(hoverBox, null));

  // For the console: duplexFire.world.card.open('e153').
  world.card = { open: (id) => open(typeof id === 'string' ? world.objects.byId.get(id) : id), pick, cardFor: (o) => cardFor(o, world) };

  return {};
}
