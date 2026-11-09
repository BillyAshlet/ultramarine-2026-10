// Your actions (task F of 开工顺序.md): a small toolbar of mouse tools.
//
//   Scissors   cut a gas pipe or a water supply pipe
//   Valves     open or shut a unit's gas valve or water valve, or its breaker
//   Switch     turn a device on or off (the rooftop exhaust fans)
//
// Pointing with a tool makes what it can act on glow, even behind a wall, as
// doors.js does for doors: only the tool's own targets are tested, so a
// see-through wall in front does not stop the pick. The glow is one mesh
// drawn over everything; no extra pass over the smoke volume.
//
// What a click does is not decided here. Cutting and valves go to the module
// that owns the network (world.gas, world.water: tasks D and E); power and
// fans to sources.js. A network whose module is not loaded yet only reports
// what was cut. Nothing here reacts to the fire by itself.
//
// While a tool is in hand it takes the pointer: hovering and clicking do not
// reach the object cards (card.js) or the doors (doors.js) until you put the
// tool down (click it again, or Esc). Placing the fire puts the tool down.
import * as THREE from 'three';
import { DRAW_DIAMETER } from './pipes.js';

const BREATH_SECONDS = 1.2;
const STATUS_EVERY = 10;   // frames between redraws of the switch board

const STYLE = `
#tools { position: fixed; right: 12px; bottom: 34px; width: 250px; box-sizing: border-box; background: var(--panel, rgba(16,19,23,.92));
  border: 1px solid #2a3038; border-radius: 8px; padding: 10px 12px; font: 12px/1.45 -apple-system, system-ui, sans-serif;
  color: var(--text, #e6e6ea); z-index: 9; }
#tools h3 { font-size: 12.5px; margin: 0 0 6px; font-weight: 600; }
#tools .row { display: flex; gap: 5px; flex-wrap: wrap; margin: 0 0 6px; }
#tools button { font-size: 12px; padding: 4px 8px; }
#tools table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
#tools th { color: var(--dim, #9a9aa6); font-weight: 400; text-align: left; padding: 1px 4px 1px 0; }
#tools td { padding: 1px 4px 1px 0; }
#tools .on { color: #6fdc8c; } #tools .off { color: #ff6b5a; } #tools .idle { color: var(--dim, #9a9aa6); }
#tools .hint { color: var(--dim, #9a9aa6); margin-top: 6px; min-height: 1.45em; }
#tools .note { color: #ffc861; }
#toolTip { position: fixed; pointer-events: none; background: rgba(16,19,23,.92); border: 1px solid #3a4048; border-radius: 4px;
  padding: 2px 6px; font: 11.5px/1.4 -apple-system, system-ui, sans-serif; color: #e6e6ea; z-index: 11; white-space: nowrap; }
#toolTip[hidden] { display: none; }
@media (max-width: 700px) { #tools { right: 8px; left: 8px; width: auto; bottom: auto; top: 8px; } }
`;

const TOOLS = [
  { id: 'cut', label: 'Scissors 剪刀', hint: 'Point at a gas or water pipe, click to cut it 指向燃气管或水管，点击剪断' },
  { id: 'valve', label: 'Valves 阀门·电闸', hint: 'Point at a valve or a panel, click to switch it 指向阀门或配电箱，点击开关' },
  { id: 'device', label: 'Switch 设备开关', hint: 'Point at a rooftop fan, click to switch it 指向屋顶排风机，点击开关' },
];

export default function actions(world) {
  if (typeof document === 'undefined' || !world.view) return null;
  const { scene, renderer, rayAt, cut, services, extras, serviceMeshes, extraMeshes, controls } = world.view;
  const { objects } = world;
  const canvas = renderer.domElement;
  const host = canvas.parentElement ?? canvas;

  // --- the toolbar ------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.id = 'tools';
  panel.innerHTML = `<h3>Tools 工具</h3><div class="row"></div>
    <table><thead><tr><th></th><th>Power 电</th><th>Gas 气</th><th>Water 水</th><th>Fan 排风</th><th>Pa</th></tr></thead><tbody></tbody></table>
    <div class="hint"></div>`;
  document.body.appendChild(panel);
  const buttons = TOOLS.map((t) => {
    const b = document.createElement('button');
    b.textContent = t.label;
    b.addEventListener('click', () => setTool(tool === t.id ? null : t.id));
    panel.querySelector('.row').appendChild(b);
    return b;
  });
  const board = panel.querySelector('tbody');
  const hint = panel.querySelector('.hint');
  const tip = document.createElement('div');
  tip.id = 'toolTip';
  tip.hidden = true;
  document.body.appendChild(tip);

  let tool = null;
  let notice = { text: '', until: 0 };
  const say = (text) => { notice = { text, until: performance.now() + 4000 }; console.info('[actions]', text); };

  function setTool(id) {
    tool = id;
    if (id && !targets) targets = buildTargets();
    buttons.forEach((b, n) => b.classList.toggle('on', TOOLS[n].id === id));
    if (id) {
      // Placing the fire and holding a tool are one mode at a time.
      document.querySelector('[data-place].on')?.click();
      // Scissors need the pipes in view.
      if (id === 'cut') for (const name of ['gas', 'water']) {
        const box = document.getElementById(`show-${name}`);
        if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change')); }
      }
    }
    hover(null);
    canvas.style.cursor = id ? 'crosshair' : '';
  }
  for (const b of document.querySelectorAll('[data-place]')) b.addEventListener('click', () => { if (tool && b.classList.contains('on')) setTool(null); });
  addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && tool) setTool(null); });

  // --- what each tool can point at ----------------------------------------------------
  const pickMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const unitIn = (s) => /Unit ([AB])/.exec(s ?? '')?.[1] ?? null;

  /** A pick mesh over one IFC element's own drawn geometry, its bounds grown to the drawn size. */
  function elementTarget(srcMesh, grow, extra) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', srcMesh.geometry.attributes.position);
    g.setIndex(srcMesh.geometry.index);
    const box = srcMesh.geometry.boundingBox.clone().expandByScalar(grow);
    g.boundingBox = box;
    g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(g, pickMaterial);
    mesh.userData = { object: objects.byElement.get(srcMesh.userData.element), ...extra };
    return mesh;
  }

  // Valve handles: the IFC has no valves on the gas or water entries, so a
  // handle is drawn where each unit's line comes in (the owner module's entry).
  const markers = new THREE.Group();
  markers.renderOrder = 6;
  scene.add(markers);
  const clip = cut ? [cut] : [];
  const dot = (color) => new THREE.MeshBasicMaterial({ color, clippingPlanes: clip });
  const COLOURS = { on: 0x6fdc8c, off: 0xff6b5a, idle: 0x8a8f98, gas: 0xffc400, water: 0x3c8cff };
  const lamps = [];   // a small light over each switch, coloured by its state

  function lamp(pos, state) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), dot(COLOURS.idle));
    m.position.set(...pos);
    m.userData.state = state;
    markers.add(m);
    lamps.push(m);
    return m;
  }

  let targets = null;
  function buildTargets() {
    const list = { cut: [], valve: [], device: [] };
    for (const layer of ['gas', 'water']) {
      for (const m of services?.[layer]?.elements ?? []) {
        const o = objects.byElement.get(m.userData.element);
        if (o && (o.class === '燃气管' || o.class === '水管')) list.cut.push(elementTarget(m, DRAW_DIAMETER / 2, { kind: layer, layer }));
      }
    }
    const src = world.sources;
    for (const m of services?.electrical?.elements ?? []) {
      const o = objects.byElement.get(m.userData.element);
      const b = src?.breakers.find((x) => x.o === o);
      if (!b) continue;
      list.valve.push(elementTarget(m, 0.05, { kind: 'breaker', unit: b.unit, layer: 'electrical' }));
      lamp([(o.min[0] + o.max[0]) / 2, o.max[1] + 0.15, (o.min[2] + o.max[2]) / 2], () => (b.o.on ? 'on' : 'off'));
    }
    for (const kind of ['gas', 'water']) for (const unit of ['A', 'B']) {
      const entry = src?.entryOf(kind, unit);
      if (!entry) continue;
      // Where the owner put its meter, or else the entry pipe's west end:
      // both lines come in through the west wall (gas.js, water.js).
      const c = [0, 1, 2].map((a) => (entry.min[a] + entry.max[a]) / 2);
      c[0] = entry.min[0] + 0.1;
      const meter = world[kind]?.units?.[unit]?.meterPos;
      if (Array.isArray(meter) && meter.length === 3) c.splice(0, 3, ...meter);
      const handle = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 20), dot(COLOURS[kind]));
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.07), dot(COLOURS.on));
      lever.position.y = 0.07;
      handle.add(body, lever);
      handle.position.set(...c);
      // The two units' water lines come in 8 cm apart: keep the handles from overlapping.
      for (const other of markers.children) {
        if (other.isGroup && other.position.distanceTo(handle.position) < 0.3) {
          handle.position.z += 0.17; other.position.z -= 0.17;
        }
      }
      markers.add(handle);
      const state = () => (src.valveOpen(kind, unit) ? 'on' : 'off');
      lever.userData.state = state;
      lamps.push(lever);
      for (const part of [body, lever]) {
        part.userData = { ...part.userData, kind: `${kind}Valve`, unit, handle, label: `Unit ${unit} ${kind === 'gas' ? 'gas valve 燃气阀' : 'water valve 水阀'}` };
        list.valve.push(part);
      }
    }
    for (const m of extras?.fixtures?.elements ?? []) {
      const o = objects.byElement.get(m.userData.element);
      const f = src?.fans.find((x) => x.o === o);
      if (!f) continue;
      list.device.push(elementTarget(m, 0.05, { kind: 'fan', unit: f.unit, layer: 'fixtures' }));
      lamp([(o.min[0] + o.max[0]) / 2, o.max[1] + 0.2, (o.min[2] + o.max[2]) / 2], () => (o.running ? 'on' : o.on ? 'idle' : 'off'));
    }
    return list;
  }

  const raycaster = new THREE.Raycaster();
  const layerShown = (layer) => {
    if (!layer) return true;
    const mesh = serviceMeshes?.[layer] ?? extraMeshes?.[layer];
    return mesh ? mesh.visible : true;
  };
  /** The current tool's target under the pointer: { mesh, point } or null. */
  function pick(ev) {
    if (!tool || !targets) return null;
    raycaster.ray.copy(rayAt(ev));
    for (const h of raycaster.intersectObjects(targets[tool], false)) {
      if (cut && cut.distanceToPoint(h.point) < 0) continue;
      if (!layerShown(h.object.userData.layer)) continue;
      return { mesh: h.object, point: h.point.clone() };
    }
    return null;
  }

  // --- glow and tooltip -------------------------------------------------------------
  const glow = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
    color: 0xffc861, transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: clip,
  }));
  glow.renderOrder = 22;
  glow.matrixAutoUpdate = false;
  glow.visible = false;
  scene.add(glow);
  // A box round it too: a 3 cm elbow glowing is still only a few pixels.
  const frameBox = new THREE.Box3Helper(new THREE.Box3(), 0xffc861);
  frameBox.material.depthTest = false;
  frameBox.material.transparent = true;
  frameBox.renderOrder = 22;
  frameBox.visible = false;
  scene.add(frameBox);
  const MIN_FRAME = 0.3;   // m
  let hovered = null;

  function describe(t) {
    const u = t.mesh.userData, o = u.object;
    const src = world.sources;
    switch (u.kind) {
      case 'gas': return `Cut 剪断 · gas pipe 燃气管 ${o.id} · Unit ${unitIn(o.element.system) ?? '?'}${cutIds.has(o.id) ? ' · cut 已剪' : ''}`;
      case 'water': return `Cut 剪断 · water pipe 水管 ${o.id} · ${o.element.system ?? ''}${cutIds.has(o.id) ? ' · cut 已剪' : ''}`;
      case 'breaker': return `Unit ${u.unit} breaker 电闸 · ${o.on ? 'on 合 → click to cut 点击拉闸' : 'off 断 → click to restore 点击合闸'}`;
      case 'gasValve': case 'waterValve': {
        const open = src.valveOpen(u.kind === 'gasValve' ? 'gas' : 'water', u.unit);
        return `${u.label} · ${open ? 'open 开 → click to shut 点击关' : 'shut 关 → click to open 点击开'}`;
      }
      case 'fan': return `Unit ${u.unit} rooftop fan 屋顶排风机 · ${o.running ? 'running 运转' : o.on ? 'on, no power 开着但没电' : 'off 关'}`;
      default: return '';
    }
  }

  function hover(t, ev) {
    hovered = t;
    glow.visible = frameBox.visible = !!t;
    tip.hidden = !t;
    if (!t) return;
    const m = t.mesh;
    glow.geometry = m.geometry;
    m.updateMatrixWorld();
    glow.matrix.copy(m.matrixWorld);
    glow.matrixWorld.copy(m.matrixWorld);
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const box = frameBox.box.copy(m.geometry.boundingBox).applyMatrix4(m.matrixWorld);
    const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).max(new THREE.Vector3(MIN_FRAME, MIN_FRAME, MIN_FRAME));
    box.setFromCenterAndSize(c, size);
    tip.textContent = describe(t);
    if (ev) { tip.style.left = `${ev.clientX + 14}px`; tip.style.top = `${ev.clientY + 12}px`; }
  }

  // --- clicks ----------------------------------------------------------------------
  const cutIds = new Set();
  const cutMarks = new THREE.Group();
  scene.add(cutMarks);
  const cutMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b2f, depthTest: false, transparent: true, opacity: 0.9, clippingPlanes: clip });

  function markCut(point) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.025, 8, 20), cutMaterial);
    ring.position.copy(point);
    ring.renderOrder = 21;
    cutMarks.add(ring);
  }

  function act(t) {
    const u = t.mesh.userData, o = u.object, src = world.sources;
    try {
      switch (u.kind) {
        case 'gas': case 'water': {
          if (cutIds.has(o.id)) { say(`${o.id} is already cut 已经剪过了`); return; }
          const owner = world[u.kind];
          if (owner?.cut) {
            const r = owner.cut(o.id);
            say(`Cut 剪断 ${o.id}${r?.litresPerMinute != null ? ` · ${r.litresPerMinute} L/min` : ''}`);
          } else {
            say(`Cut 剪断 ${o.id} (${u.kind}.js not loaded yet: only noted 还没接上，只记下)`);
          }
          cutIds.add(o.id);
          markCut(t.point);
          return;
        }
        case 'breaker': { const on = src.breaker(u.unit); say(`Unit ${u.unit} power ${on ? 'on 合闸' : 'off 拉闸'}`); return; }
        case 'gasValve': case 'waterValve': {
          const kind = u.kind === 'gasValve' ? 'gas' : 'water';
          const open = src.valve(kind, u.unit);
          say(`${u.label} ${open ? 'opened 开' : 'shut 关'}`);
          return;
        }
        case 'fan': {
          const on = src.fan(o.id);
          say(`Unit ${u.unit} fan ${on ? (o.running ? 'on 开' : 'on, but no power 开了但没电') : 'off 关'}`);
          return;
        }
      }
    } catch (err) {
      say(`Failed 没成功: ${err.message}`);
      console.error(err);
    }
  }

  // The tool takes the pointer before card.js, doors.js and main.js see it:
  // listen on the canvas's parent, in the capture phase.
  let downAt = null, pending = null;
  host.addEventListener('pointermove', (ev) => {
    if (!tool || ev.buttons) return;
    ev.stopPropagation();
    if (pending) { pending = ev; return; }
    pending = ev;
    requestAnimationFrame(() => { const e = pending; pending = null; hover(pick(e), e); });
  }, { capture: true });
  host.addEventListener('pointerdown', (ev) => { downAt = [ev.clientX, ev.clientY]; }, { capture: true });
  host.addEventListener('pointerup', (ev) => {
    if (!tool || !downAt || Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]) > 4) return;
    // Releasing the dragged fire marker is main.js's (it turns the controls off while dragging).
    if (controls && controls.enabled === false) return;
    ev.stopPropagation();
    const t = pick(ev);
    if (t) { act(t); hover(pick(ev), ev); }
  }, { capture: true });
  host.addEventListener('dblclick', (ev) => { if (tool) ev.stopPropagation(); }, { capture: true });
  host.addEventListener('pointerleave', () => hover(null));

  // --- the switch board -------------------------------------------------------------
  let frames = 0;
  function drawBoard() {
    const src = world.sources;
    if (!src) return;
    const leaks = world.leaks;
    const zones = leaks?.zones() ?? [];
    const cellOf = (ok, text) => `<td class="${ok === true ? 'on' : ok === false ? 'off' : 'idle'}">${text}</td>`;
    board.innerHTML = src.status().map((s) => {
      const pa = zones.filter((z) => z.unit === s.unit).reduce((m, z) => (Math.abs(z.pa) > Math.abs(m) ? z.pa : m), 0);
      const gasOpen = src.valveOpen('gas', s.unit), waterOpen = src.valveOpen('water', s.unit);
      const fan = src.fans.find((f) => f.unit === s.unit)?.o;
      return `<tr><th>${s.unit}</th>${cellOf(s.power, s.power ? 'on' : 'off')}${cellOf(gasOpen, gasOpen ? 'open' : 'shut')}` +
        `${cellOf(waterOpen, waterOpen ? 'open' : 'shut')}${cellOf(fan?.running ? true : fan?.on ? null : false, fan?.running ? 'run' : fan?.on ? 'no power' : 'off')}` +
        `<td>${Math.round(pa)}</td></tr>`;
    }).join('');
    const now = performance.now();
    const t = TOOLS.find((x) => x.id === tool);
    hint.innerHTML = now < notice.until ? `<span class="note">${notice.text}</span>` : t ? t.hint : 'Pick a tool; Esc puts it down. Pa: the unit\'s highest pressure. 选一个工具；Esc 放下。Pa：这户最高的压力。';
    if (!world.gas?.cut) hint.innerHTML += '<br><span class="idle">gas.js not loaded: cutting gas only notes it 燃气模块未接上</span>';
  }

  // The board and the glow run on their own frames, so they keep up while the
  // fire is paused; they cost nothing in the simulation's step. Targets are
  // built once the page has finished loading every module (index.html removes
  // #loading then), since gas.js and water.js load after this file.
  function frame() {
    requestAnimationFrame(frame);
    if (!targets) {
      if (document.getElementById('loading')) return;
      targets = buildTargets();
    }
    if (frames++ % STATUS_EVERY === 0) {
      drawBoard();
      for (const l of lamps) l.material.color.setHex(COLOURS[l.userData.state()]);
    }
    if (hovered) {
      const phase = 0.5 - 0.5 * Math.cos((2 * Math.PI * performance.now()) / 1000 / BREATH_SECONDS);
      glow.material.opacity = 0.2 + 0.5 * phase;
      frameBox.material.opacity = 0.4 + 0.6 * phase;
    }
  }
  requestAnimationFrame(frame);

  world.actions = { setTool, get tool() { return tool; }, pick, cutIds };

  return {
    reset() {
      // A restart mends what was cut (gas.js and water.js clear their breaks); switches stay.
      cutIds.clear();
      for (const m of [...cutMarks.children]) { cutMarks.remove(m); m.geometry.dispose(); }
    },
  };
}
