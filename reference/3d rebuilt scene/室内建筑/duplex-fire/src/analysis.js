// Zemax-style white-canvas engineering CAE workbench for duplex-fire.
// Embeds live HRR & room-temperature line charts + clickable causal timeline
// inside #panel, and provides a minimized-by-default top-right white-theme
// multi-window dock (#anaDock) + maximized analyzer modal (#anaModal) using
// crisp white scientific line plots, scatter curves, and grouped column charts.

import * as THREE from 'three';

const RHO_AIR_CP = 1.2 * 1005; // J/(m^3 K), matching water.js & house.js
const KM_SOOT = 8.7;           // m^2/g, Mulholland & Croarkin (2000) flaming soot
const LN10 = Math.LN10;

// Literature / engine thresholds documented in materials.json & reference/
const THRESHOLDS = {
  flashoverC: 600,             // Babrauskas / radiation.js upper-layer criterion
  tenabilityC: 60,             // Human tenability thermal limit (SFPE)
  alarmObsc: 3.28,             // %/m optical obscuration (NIST TN 1455-1)
  untenableOD: 0.25,           // m^-1 optical density (~66 mg/m^3 soot)
  lflPct: 5,                   // % CH4 lower flammability limit (Zabetakis 1965)
  uflPct: 15,                  // % CH4 upper flammability limit
  gasHoseLeakC: 135,           // materials.json kitchen_gas_hose
  gasHoseMeltC: 175,           // materials.json kitchen_gas_hose
  elecDamageC: 205,            // NUREG/CR-6850 / FSRI 2019 cable/device threshold
  copperJointC: 233,           // Harris 95/5 Sn-Sb solder (water.js)
  windowBreakC: 260,           // Pagni (1991) single-pane glass thermal crack
  windowBreakPa: 3000,         // Kiwa (2021) single-pane pressure break
  boilerLeakC: 440,            // Grohn & Scheele (1997) / NTSB regulator leak
  boilerMeltC: 660,            // regulator melt-through
  doorStuckPa: 150,            // Brohez (2018) inward door sticking risk
  ifvSmokePa: 300,             // IFV (2020) cross-compartment pressure benchmark
  radCrit10: 10,               // kW/m^2 thin / upholstered ignition
  radCrit20: 20,               // kW/m^2 Babrauskas (1981) sustained flaming flux
  radCrit40: 40,               // kW/m^2 severe rapid ignition irradiance
};

const WINDOW_SPECS = [
  { id: 'profile',   short: '剖面', title: '剖面 Profile (0→2.6m)' },
  { id: 'margin',    short: '构件', title: '构件温升与阈值 Margin' },
  { id: 'leaks',     short: '压差', title: '压差与通道迁移 Leaks' },
  { id: 'radiation', short: '辐射', title: '辐射衰减 q(r) Radiation' },
  { id: 'audit',     short: '守恒', title: '物理守恒审计 Audit' },
];

// Print-grade Zemax / Origin / Matplotlib light palette on pure white plot canvas
const P = {
  paper: '#ffffff',
  axis: '#334155',
  grid: '#e2e8f0',
  ref: 'rgba(100, 116, 139, 0.42)',
  refWarn: 'rgba(217, 119, 6, 0.36)',
  refCrit: 'rgba(220, 38, 38, 0.35)',
  ink: '#0f172a',
  muted: '#64748b',
  red: '#dc2626',
  amber: '#ea580c',
  blue: '#0284c7',
  emerald: '#059669',
  violet: '#7c3aed',
  gold: '#ca8a04',
  slate: '#475569',
  base: '#334155',
};

const STYLE_CSS = `
  /* Left Panel Embedded CAE Charts & Timeline */
  #leftCharts {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .ana-bar {
    display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .ana-title {
    font-size: 11px; font-weight: 600; letter-spacing: 0.02em;
    color: #93c5fd; margin-right: auto;
  }
  .ana-select {
    background: rgba(255,255,255,0.08); color: #f8fafc;
    border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
    font-size: 11px; padding: 2px 5px; max-width: 112px; cursor: pointer;
  }
  .ana-btn {
    background: rgba(255,255,255,0.08); color: #e2e8f0;
    border: 1px solid rgba(255,255,255,0.16); border-radius: 5px;
    font-size: 10.5px; padding: 2px 7px; cursor: pointer; line-height: 1.35;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }
  .ana-btn:hover { background: rgba(255,255,255,0.16); color: #fff; }
  .ana-btn.warn {
    background: rgba(234, 88, 12, 0.25); border-color: rgba(251, 146, 60, 0.7);
    color: #ffedd5;
  }
  .ana-kpi-grid {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px;
    margin-bottom: 6px;
  }
  .ana-kpi {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 5px; padding: 3px 5px; min-width: 0;
  }
  .ana-kpi .k { font-size: 9.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ana-kpi .v { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; color: #f8fafc; white-space: nowrap; }
  .ana-canvas-wrap {
    position: relative; background: #ffffff;
    border: 1px solid #cbd5e1; border-radius: 6px;
    overflow: hidden;
  }
  .ana-canvas-wrap canvas { display: block; width: 100%; height: 100%; }

  #leftTimeline {
    margin-top: 8px; padding-top: 8px;
    border-top: 1px solid rgba(255,255,255,0.12);
  }
  .ana-tl-list {
    max-height: 144px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px;
    padding-right: 2px;
  }
  .ana-tl-list::-webkit-scrollbar,
  #anaWinList::-webkit-scrollbar { width: 5px; }
  .ana-tl-list::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.22); border-radius: 3px;
  }
  #anaWinList::-webkit-scrollbar-thumb {
    background: rgba(15,23,42,0.22); border-radius: 3px;
  }
  .ana-ev {
    display: flex; align-items: baseline; gap: 6px;
    padding: 3.5px 6px; border-radius: 5px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    cursor: pointer; font-size: 11px; line-height: 1.3; text-align: left; width: 100%;
    color: #dbe4f3;
  }
  .ana-ev:hover { background: rgba(56, 189, 248, 0.16); border-color: rgba(56, 189, 248, 0.45); }
  .ana-ev .t { font-variant-numeric: tabular-nums; color: #94a3b8; font-size: 10px; flex-shrink: 0; }
  .ana-ev .tag {
    font-size: 9.5px; padding: 0 4px; border-radius: 3px; flex-shrink: 0; font-weight: 600;
  }
  .ana-ev .msg { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ana-empty { font-size: 11px; color: #94a3b8; padding: 6px 4px; text-align: center; }

  /* White Engineering Zemax Launcher & Multi-Window Dock */
  #anaDock {
    position: fixed; top: 12px; right: 12px; z-index: 12;
    display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
    pointer-events: none; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
  }
  .ana-launcher {
    pointer-events: auto;
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
    background: rgba(255, 255, 255, 0.94);
    backdrop-filter: blur(8px);
    border: 1px solid #cbd5e1;
    border-radius: 8px; padding: 4px 6px;
    box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
  }
  .ana-launcher.floating {
    position: fixed; z-index: 15;
  }
  .ana-brand {
    font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
    color: #0284c7; padding: 0 5px 0 3px; user-select: none;
    cursor: grab; touch-action: none;
  }
  .ana-chip {
    background: #f1f5f9; color: #334155;
    border: 1px solid #cbd5e1; border-radius: 5px;
    padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: 500;
    transition: all 0.12s;
  }
  .ana-chip:hover { background: #e2e8f0; color: #0f172a; border-color: #94a3b8; }
  .ana-chip.active {
    background: #0284c7; border-color: #0369a1; color: #ffffff; font-weight: 600;
  }
  #anaWinList {
    pointer-events: auto;
    display: none; flex-direction: column; gap: 8px;
    width: 356px; max-height: calc(100vh - 310px);
    overflow-y: auto; padding-right: 2px;
  }
  body.ana-open #anaWinList { display: flex; }

  #anaFloatLayer {
    position: fixed; inset: 0; z-index: 14; pointer-events: none;
  }
  #anaSnapGuide {
    position: fixed; right: 12px; width: 356px;
    border: 2px dashed #0284c7;
    background: rgba(2, 132, 199, 0.10);
    border-radius: 8px; z-index: 13; pointer-events: none; display: none;
  }

  /* Keep #card away from top-right launcher & docked right windows */
  body:not(.ana-open) #card { top: 52px; max-height: calc(100vh - 262px); }
  body.ana-open #card { right: 380px; top: 12px; max-height: calc(100vh - 54px); }
  @media (max-width: 960px) {
    body.ana-open #card { right: 12px; top: 52px; z-index: 25; }
  }

  .ana-win {
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(8px);
    border: 1px solid #cbd5e1;
    border-radius: 8px; padding: 7px 8px;
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
    color: #0f172a;
  }
  .ana-win.floating {
    position: fixed; width: 356px; pointer-events: auto;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.22);
  }
  .ana-win.collapsed { padding: 5px 8px; }
  .ana-win.floating.collapsed { width: auto; min-width: 245px; max-width: 356px; }
  .ana-win.collapsed .ana-win-body,
  .ana-win.collapsed .ana-subbar { display: none !important; }
  .ana-win-head {
    display: flex; align-items: center; gap: 4px; margin-bottom: 5px;
    padding-bottom: 4px; border-bottom: 1px solid #e2e8f0;
    cursor: grab; user-select: none; touch-action: none;
  }
  .ana-win-head:active { cursor: grabbing; }
  .ana-win.collapsed .ana-win-head {
    margin-bottom: 0; padding-bottom: 0; border-bottom: none;
  }
  .ana-win-title {
    font-size: 11.5px; font-weight: 600; color: #0f172a;
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .ana-win-meta {
    font-size: 10px; color: #475569; font-variant-numeric: tabular-nums; font-weight: 500;
  }
  .ana-wbtn {
    background: #f8fafc; color: #334155;
    border: 1px solid #cbd5e1; border-radius: 4px;
    font-size: 10.5px; padding: 1.5px 5.5px; cursor: pointer; line-height: 1.35;
  }
  .ana-wbtn:hover { background: #e2e8f0; color: #0f172a; }
  .ana-wbtn.pin-on { background: #e0f2fe; border-color: #0284c7; color: #0369a1; font-weight: 600; }
  .ana-wbtn.warn { background: #fff7ed; border-color: #fb923c; color: #c2410c; font-weight: 600; }

  .ana-win-body {
    position: relative; width: 100%; height: 178px;
    background: #ffffff; border: 1px solid #e2e8f0; border-radius: 5px; overflow: hidden;
  }
  .ana-win-body canvas { display: block; width: 100%; height: 100%; }

  .ana-subbar {
    display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 5px;
    font-size: 10px; color: #475569;
  }
  .ana-subchip {
    background: #f8fafc; border: 1px solid #cbd5e1;
    border-radius: 4px; padding: 1px 6px; cursor: pointer; color: #334155; font-size: 10px;
  }
  .ana-subchip:hover { border-color: #0284c7; color: #0284c7; }
  .ana-subchip.on { background: #e0f2fe; border-color: #0284c7; color: #0369a1; font-weight: 600; }

  /* White Maximized Zemax Workbench Modal */
  #anaModal {
    position: fixed; inset: 22px 28px; z-index: 40;
    background: #ffffff;
    border: 1px solid #94a3b8;
    border-radius: 10px;
    box-shadow: 0 22px 60px rgba(15, 23, 42, 0.35);
    display: none; flex-direction: column; overflow: hidden;
    font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #0f172a;
  }
  #anaModal.open { display: flex; }
  .ana-modal-top {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 8px 12px; border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
  }
  .ana-modal-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-right: auto; }
  .ana-modal-select {
    background: #ffffff; color: #0f172a;
    border: 1px solid #cbd5e1; border-radius: 5px;
    font-size: 11px; padding: 2px 6px; cursor: pointer;
  }
  .ana-modal-canvas-wrap {
    flex: 1; position: relative; min-height: 0; padding: 10px 12px 6px;
    background: #ffffff;
  }
  .ana-modal-canvas-wrap canvas {
    display: block; width: 100%; height: 100%;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
  }
  .ana-modal-foot {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 7px 12px; border-top: 1px solid #e2e8f0; background: #f8fafc;
    font-size: 11px; color: #475569; flex-wrap: wrap;
  }
  .ana-hot-list { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }
`;

function injectStyle() {
  if (document.getElementById('anaStyle')) return;
  const s = document.createElement('style');
  s.id = 'anaStyle';
  s.textContent = STYLE_CSS;
  document.head.appendChild(s);
}

function fmtPower(kW) {
  if (kW >= 1000) return `${(kW / 1000).toFixed(2)} MW`;
  return `${kW >= 100 ? Math.round(kW) : kW.toFixed(1)} kW`;
}

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(160, Math.round(rect.width));
  const h = Math.max(90, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawFrameAndGridH(ctx, x0, x1, y0, y1, min, max, ticks, fmt) {
  ctx.save();
  ctx.font = '10px -apple-system, BlinkMacSystemFont, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const val of ticks) {
    const f = (val - min) / (max - min || 1);
    if (f < -0.01 || f > 1.01) continue;
    const y = y1 - f * (y1 - y0);
    ctx.strokeStyle = P.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.fillStyle = P.muted;
    ctx.fillText(fmt(val), x0 - 4, y);
  }
  ctx.strokeStyle = P.axis;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

function niceMax(val, minTop = 10, steps = [1, 2, 2.5, 5, 10]) {
  if (!(val > minTop)) return minTop;
  const pow = Math.pow(10, Math.floor(Math.log10(val)));
  for (const s of steps) {
    const candidate = s * pow;
    if (candidate >= val * 1.08) return candidate;
  }
  return 10 * pow;
}

function dynTimeMax(pts) {
  let maxT = 10;
  for (let i = 0; i < pts.length; i++) if (pts[i].t > maxT) maxT = pts[i].t;
  return niceMax(maxT * 1.05, 15, [1, 1.5, 2, 3, 4, 5, 6, 8, 10]);
}

function niceTicks(min, max, count = 4) {
  const span = Math.max(1e-6, max - min);
  const raw = span / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  let step = pow;
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= raw * 0.95) { step = m * pow; break; }
  }
  const start = Math.ceil(min / step) * step;
  const out = [];
  for (let v = start; v <= max + step * 1e-6; v += step) out.push(+v.toPrecision(6));
  return out;
}

function hLine(ctx, x0, x1, y, color, label, align = 'right', dy = -2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = color;
    ctx.font = '9.5px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = align;
    ctx.textBaseline = dy < 0 ? 'bottom' : 'top';
    ctx.fillText(label, align === 'right' ? x1 - 4 : x0 + 4, y + dy);
  }
  ctx.restore();
}

function vLine(ctx, y0, y1, x, color, label = '', dy = 4) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, y0);
  ctx.lineTo(x, y1);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.fillStyle = color;
    ctx.font = '9.5px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, x + 3, y0 + dy);
  }
  ctx.restore();
}

function drawSeries(ctx, pts, mapX, mapY, color, width = 1.8, dashed = false, fill = null) {
  if (!pts.length) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const x = mapX(pts[i][0]), y = mapY(pts[i][1]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  if (fill && pts.length > 1) {
    ctx.lineTo(mapX(pts[pts.length - 1][0]), fill.yBase);
    ctx.lineTo(mapX(pts[0][0]), fill.yBase);
    ctx.closePath();
    ctx.fillStyle = fill.color;
    ctx.fill();
  }
  ctx.restore();
}

function drawLegendRow(ctx, items, x, y) {
  ctx.save();
  ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
  ctx.textBaseline = 'middle';
  let cx = x;
  for (const it of items) {
    ctx.strokeStyle = it.color;
    ctx.lineWidth = 2;
    if (it.dashed) ctx.setLineDash([3, 2]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + 12, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.ink;
    ctx.textAlign = 'left';
    ctx.fillText(it.label, cx + 15, y);
    cx += 22 + ctx.measureText(it.label).width;
  }
  ctx.restore();
}

function drawCrosshairBox(ctx, w, lines, mx, my) {
  ctx.save();
  ctx.font = '10.5px -apple-system, BlinkMacSystemFont, monospace';
  const padX = 7, padY = 5, lh = 13.5;
  let bw = 0;
  for (const l of lines) bw = Math.max(bw, ctx.measureText(l.text).width);
  bw += padX * 2;
  const bh = lines.length * lh + padY * 2 - 2;
  const bx = mx + 12 + bw > w - 4 ? Math.max(4, mx - bw - 10) : mx + 10;
  const by = Math.max(4, my - bh - 4);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 4);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color || P.ink;
    ctx.fillText(l.text, bx + padX, by + padY + i * lh);
  });
  ctx.restore();
}

function eventMeta(ev) {
  const t = ev.type || '';
  const d = ev.data || {};
  const id = ev.objectId ? ` ${ev.objectId}` : '';
  const room = d.room ? ` (${d.room})` : '';
  if (t.includes('轰燃')) return { tag: '轰燃', bg: 'rgba(244,63,94,0.28)', fg: '#fda4af', desc: `${d.room || d.key || id} 轰燃 ${d.by || ''}` };
  if (t.includes('燃气') && t.includes('穿')) return { tag: '燃穿', bg: 'rgba(244,63,94,0.32)', fg: '#fecdd3', desc: `${d.id || id} 烧穿${room}` };
  if (t.includes('燃气') && (t.includes('渗') || t.includes('漏'))) return { tag: '燃漏', bg: 'rgba(251,146,60,0.28)', fg: '#fed7aa', desc: `${d.id || id} ${Math.round(d.c ?? 0)}°C 渗漏` };
  if (t.includes('电弧')) return { tag: '电弧', bg: 'rgba(250,204,21,0.28)', fg: '#fef08a', desc: `${d.id || id} 电弧引燃燃气` };
  if (t.includes('爆燃')) return { tag: '爆燃', bg: 'rgba(244,63,94,0.34)', fg: '#fecdd3', desc: `燃气爆燃 ${d.kW ? Math.round(d.kW) + ' kW' : ''}` };
  if (t.includes('水') || t.includes('焊')) return { tag: '爆管', bg: 'rgba(56,189,248,0.26)', fg: '#bae6fd', desc: `${d.id || id} 焊点熔开${d.litresPerMinute ? ` ${d.litresPerMinute}L/m` : ''}` };
  if (t.includes('喷淋')) return { tag: '喷淋', bg: 'rgba(56,189,248,0.26)', fg: '#bae6fd', desc: `喷淋启动 ${d.room || id}` };
  if (t.includes('窗') || t.includes('玻璃')) return { tag: '破窗', bg: 'rgba(167,139,250,0.28)', fg: '#ddd6fe', desc: `${d.id || id} ${d.by || ''}破${room}` };
  if (t.includes('烟') || t.includes('感') || t.includes('跨户')) return { tag: '烟流', bg: 'rgba(148,163,184,0.25)', fg: '#e2e8f0', desc: `${t}${room}${d.pa ? ` ${Math.round(d.pa)}Pa` : ''}` };
  if (t.includes('引燃')) return { tag: '引燃', bg: 'rgba(251,146,60,0.26)', fg: '#fed7aa', desc: `${d.label || d.material || ''}${id}${room}` };
  if (t.includes('点火')) return { tag: '点火', bg: 'rgba(251,146,60,0.28)', fg: '#fed7aa', desc: `${d.room || '起始火源'} 点火` };
  if (t.includes('熄') || t.includes('灭')) return { tag: '熄灭', bg: 'rgba(52,211,153,0.22)', fg: '#a7f3d0', desc: `${d.label || id || t} 熄灭` };
  if (t.includes('门')) return { tag: '门控', bg: 'rgba(148,163,184,0.22)', fg: '#cbd5e1', desc: `${d.room || id} 门${d.open === false ? '关' : '开'}` };
  return { tag: t.slice(0, 3) || '事件', bg: 'rgba(148,163,184,0.2)', fg: '#cbd5e1', desc: `${t}${id}${room}` };
}

function cleanLabel(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

const LEAK_KIND_NAMES = {
  wall: '分户墙孔',
  party: '分户墙',
  outlets: '背靠插座',
  outlet: '插座暗盒',
  penetrations: '穿墙管洞',
  penetration: '穿墙套管',
  door: '门缝压差',
  window: '窗缝/破窗',
  envelope: '外围护',
  duct: '风道/排风',
  fan: '风机送风',
};

export default function analysis(world) {
  if (typeof document === 'undefined' || !world?.view) return null;
  injectStyle();

  const { fire, grid, objects, events } = world;
  const rooms = (world.rooms || []).filter((r) => r.code !== 'R301')
    .sort((a, b) => a.code.localeCompare(b.code));
  const roomMap = new Map(rooms.map((r) => [`${r.code} ${r.name}`, r]));

  // Precompute per-room height-binned grid indices once
  const roomBins = new Map();
  {
    const { nx, ny, nz, origin, cell, index, solid } = grid;
    for (const r of rooms) {
      const key = `${r.code} ${r.name}`;
      const xLo = r.min[0], xHi = r.max[0];
      const yLo = r.min[1], yHi = r.max[1];
      const zLo = r.min[2], zHi = r.max[2];
      const jMin = Math.max(1, Math.floor((yLo - origin.y) / cell) + 1);
      const jMax = Math.min(ny, Math.ceil((yHi - origin.y) / cell));
      const iMin = Math.max(1, Math.floor((xLo - origin.x) / cell) + 1);
      const iMax = Math.min(nx, Math.ceil((xHi - origin.x) / cell));
      const kMin = Math.max(1, Math.floor((zLo - origin.z) / cell) + 1);
      const kMax = Math.min(nz, Math.ceil((zHi - origin.z) / cell));
      const bins = [];
      for (let j = jMin; j <= jMax; j++) {
        const yWorld = origin.y + (j - 0.5) * cell;
        const hRel = yWorld - yLo;
        if (hRel < -0.05 || hRel > (yHi - yLo) + 0.08) continue;
        const arr = [];
        for (let k = kMin; k <= kMax; k++) {
          for (let i = iMin; i <= iMax; i++) {
            const c = index(i, j, k);
            if (!solid[c]) arr.push(c);
          }
        }
        if (arr.length) bins.push({ j, h: Math.max(0, hRel), cells: Int32Array.from(arr) });
      }
      roomBins.set(key, { height: Math.max(2.4, yHi - yLo), bins });
    }
  }

  const smokeDetectors = objects.list.filter((o) => /Smoke Detector/i.test(o.name) && o.cells.length);
  const elecItems = objects.list.filter((o) => o.layer === 'electrical' && !o.wallAir && o.cells.length && !/Smoke Detector/i.test(o.name));

  // State
  let selectedRoomKey = roomMap.has('A102 Living Room') ? 'A102 Living Room' : (rooms[0] ? `${rooms[0].code} ${rooms[0].name}` : '');
  let autoTrackRoom = true;
  let profileMetric = 'all'; // 'all' | 'temp' | 'smoke' | 'gas'
  let marginMode = 'trend';  // 'trend' (default live T(t) line chart) | 'bars' (grouped columns)
  let openWins = new Set();  // Minimized by default
  let maximizedId = null;
  let hover = {};
  let baseline = null;

  const samples = [];
  const causalEvents = [];
  let nextSampleAt = 0;
  let lastDrawMs = 0;
  let lastAuditMs = 0;
  let lastAuditSim = -1;
  let cachedAudit = null;
  let cachedRadHotspots = [];

  // 3D Event Ping Beacon Ring
  let pingMesh = null;
  let pingRaf = 0;
  let pingStartMs = 0;
  function clearPing() {
    if (pingRaf) { cancelAnimationFrame(pingRaf); pingRaf = 0; }
    if (pingMesh && world.view?.scene) {
      world.view.scene.remove(pingMesh);
      pingMesh.geometry.dispose();
      pingMesh.material.dispose();
      pingMesh = null;
    }
  }
  function triggerPing(pos) {
    if (!pos || !world.view?.scene) return;
    clearPing();
    const geom = new THREE.RingGeometry(0.16, 0.30, 32);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0284c7, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false,
    });
    pingMesh = new THREE.Mesh(geom, mat);
    pingMesh.renderOrder = 999;
    pingMesh.position.set(pos[0], Math.max(0.08, pos[1] + 0.08), pos[2]);
    world.view.scene.add(pingMesh);
    pingStartMs = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - pingStartMs) / 1000;
      if (elapsed >= 2.2 || !pingMesh) { clearPing(); return; }
      const phase = (elapsed % 0.75) / 0.75;
      const scale = 1 + phase * 3.0;
      pingMesh.scale.set(scale, 1, scale);
      pingMesh.material.opacity = (1 - phase) * (1 - elapsed / 2.4);
      pingRaf = requestAnimationFrame(tick);
    };
    pingRaf = requestAnimationFrame(tick);
  }

  events.on((ev) => {
    const t = ev.time ?? fire.time ?? 0;
    let pos = ev.pos ?? null;
    if (!pos && ev.objectId) {
      const o = objects.byId.get(ev.objectId);
      if (o?.min && o?.max) {
        pos = [0.5 * (o.min[0] + o.max[0]), 0.5 * (o.min[1] + o.max[1]), 0.5 * (o.min[2] + o.max[2])];
      }
    }
    if (!pos && ev.data?.room) {
      const rm = roomMap.get(ev.data.room) || rooms.find((r) => ev.data.room.startsWith(r.code));
      if (rm?.min && rm?.max) {
        pos = [0.5 * (rm.min[0] + rm.max[0]), rm.min[1] + 0.15, 0.5 * (rm.min[2] + rm.max[2])];
      }
    }
    const meta = eventMeta(ev);
    causalEvents.push({ t, type: ev.type, objectId: ev.objectId ?? null, pos, data: ev.data ?? {}, ...meta });

    if (autoTrackRoom && (ev.type?.includes('点火') || ev.type?.includes('爆燃') || ev.type?.includes('引燃')) && ev.data?.room) {
      const found = roomMap.has(ev.data.room)
        ? ev.data.room
        : rooms.find((r) => ev.data.room.startsWith(r.code));
      const k = typeof found === 'string' ? found : found ? `${found.code} ${found.name}` : null;
      if (k) {
        selectedRoomKey = k;
        syncRoomSelects();
      }
    }
    renderTimeline();
  });

  function readComponentMargins() {
    const parts = world.gas?.parts?.() ?? [];
    let hose = { c: 20, id: 'e1145', stage: 'intact', room: 'A103' };
    let valve = { c: 20, id: 'e1034', stage: 'intact', room: 'A205' };
    for (const p of parts) {
      if (p.id === 'e1145' || p.id === 'e1149') {
        if (p.c >= hose.c || p.stage !== 'intact') hose = p;
      } else if (p.c >= valve.c || p.stage !== 'intact') {
        valve = p;
      }
    }

    let elecMaxC = 20, elecId = elecItems[0]?.id ?? 'e612', elecRoom = elecItems[0]?.room ?? '';
    for (const o of elecItems) {
      let tmax = 0;
      for (let i = 0; i < o.cells.length; i++) {
        const dt = fire.temp[o.cells[i]];
        if (dt > tmax) tmax = dt;
      }
      const radAdd = o.flux > 0 ? 0.75 * o.flux * 1000 / 18 : 0;
      const c = 20 + tmax + radAdd;
      if (c > elecMaxC) { elecMaxC = c; elecId = o.id; elecRoom = o.room; }
    }

    const joints = world.water?.joints?.(8) ?? [];
    let joint = joints[0] ?? { c: 20, id: 'e763', broken: false };
    for (const j of joints) if (j.c > joint.c || j.broken) { joint = j; if (j.broken) break; }

    const wins = world.leaks?.windows?.() ?? [];
    let winPeak = wins[0] ?? { id: 'e92', room: 'A102', state: '完好', by: null, glassC: 20 };
    let winBroken = 0;
    for (const w of wins) {
      if (w.state !== '完好') winBroken++;
      if ((w.glassC ?? 20) > (winPeak.glassC ?? 20)) winPeak = w;
    }

    let detMaxObsc = 0, detId = smokeDetectors[0]?.id ?? 'e650', detTriggered = 0;
    for (const d of smokeDetectors) {
      let sMax = 0;
      for (let i = 0; i < d.cells.length; i++) {
        const rho = fire.dens[d.cells[i]];
        if (rho > sMax) sMax = rho;
      }
      const obsc = 100 * (1 - Math.exp(-KM_SOOT * sMax));
      if (obsc >= THRESHOLDS.alarmObsc) detTriggered++;
      if (obsc > detMaxObsc) { detMaxObsc = obsc; detId = d.id; }
    }

    const zones = world.leaks?.zones?.() ?? [];
    let peakAbsPa = 0;
    for (const z of zones) peakAbsPa = Math.max(peakAbsPa, Math.abs(z.pa || 0));

    return {
      hose, elec: { c: elecMaxC, id: elecId, room: elecRoom },
      joint, window: { ...winPeak, broken: winBroken, total: wins.length, absPa: peakAbsPa },
      valve, detector: { obsc: detMaxObsc, id: detId, triggered: detTriggered, total: smokeDetectors.length },
    };
  }

  function readRoomStats(roomKey) {
    const r = world.radiation?.rooms?.find((x) => x.key === roomKey || `${x.code} ${x.name}` === roomKey);
    let peakC = r?.layerC ?? 20;
    const prof = roomBins.get(roomKey);
    if (prof) {
      for (const b of prof.bins) {
        for (let i = 0; i < b.cells.length; i++) {
          const tc = 20 + fire.temp[b.cells[i]];
          if (tc > peakC) peakC = tc;
        }
      }
    }
    return {
      layerC: r?.layerC ?? 20,
      floorFlux: r?.floorFlux ?? 0,
      flashedAt: r?.flashedAt ?? null,
      peakC,
    };
  }

  function readProfileBins(roomKey) {
    const entry = roomBins.get(roomKey);
    if (!entry) return { height: 2.6, rows: [] };
    const gasField = world.gas?.field;
    const rows = [];
    for (const b of entry.bins) {
      let tSum = 0, tMax = 0, sSum = 0, sMax = 0, gSum = 0, gMax = 0, cnt = 0;
      for (let i = 0; i < b.cells.length; i++) {
        const c = b.cells[i];
        if (fire.solid[c]) continue;
        const tc = 20 + fire.temp[c];
        tSum += tc;
        if (tc > tMax) tMax = tc;
        const sd = fire.dens[c];
        sSum += sd;
        if (sd > sMax) sMax = sd;
        if (gasField) {
          const gv = gasField[c];
          gSum += gv;
          if (gv > gMax) gMax = gv;
        }
        cnt++;
      }
      if (!cnt) continue;
      const tempC = tSum / cnt;
      const sootGm3 = sSum / cnt;
      const od = (KM_SOOT / LN10) * sootGm3;
      const odMax = (KM_SOOT / LN10) * sMax;
      const obscPct = 100 * (1 - Math.exp(-KM_SOOT * sootGm3));
      const gasPct = 100 * (gSum / cnt);
      const gasMaxPct = 100 * gMax;
      rows.push({ h: b.h, tempC, tempMaxC: tMax, sootMg: sootGm3 * 1000, od, odMax, obscPct, gasPct, gasMaxPct });
    }
    rows.sort((a, b) => a.h - b.h);
    return { height: entry.height, rows };
  }

  function sampleNow() {
    const igniterKW = (fire.heatRelease?.() ?? 0) / 1e3;
    const totalBurnKW = (world.combustion?.totalHRR?.() ?? 0) / 1e3;
    let gasKW = 0;
    const gs = world.gas?.status?.();
    if (gs?.outlets) {
      for (const o of gs.outlets) if (o.lit) gasKW += o.kW || 0;
    }
    const woodKW = Math.max(0, totalBurnKW - gasKW);
    const totalKW = totalBurnKW + igniterKW;

    const rs = readRoomStats(selectedRoomKey);
    const zones = world.leaks?.zones?.() ?? [];
    let unitAPa = 0, unitBPa = 0;
    for (const z of zones) {
      if (z.unit === 'A' && Math.abs(z.pa) > Math.abs(unitAPa)) unitAPa = z.pa;
      if (z.unit === 'B' && Math.abs(z.pa) > Math.abs(unitBPa)) unitBPa = z.pa;
    }
    const m = readComponentMargins();
    const lb = world.leaks?.books?.() ?? {};
    samples.push({
      t: fire.time,
      totalKW, woodKW, gasKW, igniterKW,
      roomUpperC: rs.layerC,
      roomPeakC: rs.peakC,
      floorFlux: rs.floorFlux,
      unitAPa, unitBPa,
      hoseC: m.hose.c,
      elecC: m.elec.c,
      jointC: m.joint.c,
      winC: m.window.glassC ?? 20,
      winPa: m.window.absPa,
      valveC: m.valve.c,
      detObsc: m.detector.obsc,
      crossG: lb.sootAcrossUnits ?? 0,
    });
    if (samples.length > 2600) {
      const next = [];
      for (let i = 0; i < samples.length; i += 2) next.push(samples[i]);
      samples.length = 0;
      samples.push(...next);
    }
  }

  function readAudit() {
    const now = performance.now();
    if (cachedAudit && fire.time === lastAuditSim && (now - lastAuditMs) < 180) return cachedAudit;
    lastAuditSim = fire.time;
    lastAuditMs = now;

    let tempSum = 0, densSum = 0, fuelSum = 0;
    const fl = fire.fluid;
    for (let i = 0; i < fl.length; i++) {
      const c = fl[i];
      tempSum += fire.temp[c];
      densSum += fire.dens[c];
      fuelSum += fire.fuel[c];
    }
    const dV = fire.cell ** 3;
    const heatInAirMJ = (tempSum * RHO_AIR_CP * dV) / 1e6;
    const fuelPendingMJ = (fuelSum * RHO_AIR_CP * dV) / 1e6;
    const sootInAirG = densSum * dV;

    const combMade = world.combustion?.made?.() ?? { sootG: 0, heatJ: 0 };
    const gb = world.gas?.books?.() ?? {};
    const gp = world.gas?.params ?? { lhv: 3.34e7 };
    const gasBurnedM3 = (gb.burnedDeflagration ?? 0) + (gb.burnedAtOutlets ?? 0);
    const gasHeatMJ = (gasBurnedM3 * (gp.lhv ?? 3.34e7)) / 1e6;
    const igniterHeatMJ = (fire.heatMade ?? 0) / 1e6;
    const combHeatMJ = (combMade.heatJ ?? 0) / 1e6;

    const wallsMJ = (fire.walls?.absorbed ?? 0) / 1e6;
    const lb = world.leaks?.books?.() ?? {};
    const leakHeatMJ = (lb.heatOut ?? 0) / 1e6;
    const wb = world.water?.books?.() ?? {};
    const waterHeatMJ = (wb.heatTaken ?? 0) / 1e6;

    const heatMadeTotal = igniterHeatMJ + combHeatMJ + gasHeatMJ;
    const heatTrackedTotal = heatInAirMJ + fuelPendingMJ + wallsMJ + leakHeatMJ + waterHeatMJ;

    const sootMadeTotal = (fire.sootMade ?? 0) + (combMade.sootG ?? 0);
    const sootOutG = lb.sootOut ?? 0;
    const sootTrackedTotal = sootInAirG + sootOutG;

    cachedAudit = {
      energy: {
        made: heatMadeTotal,
        tracked: heatTrackedTotal,
        partsMade: [
          { label: '点火器', v: igniterHeatMJ, color: P.gold },
          { label: '家具燃', v: combHeatMJ, color: P.amber },
          { label: '燃气燃', v: gasHeatMJ, color: P.emerald },
        ],
        partsTracked: [
          { label: '空气显热', v: heatInAirMJ, color: P.red },
          { label: '墙体吸热', v: wallsMJ, color: P.blue },
          { label: '外泄+蒸发', v: leakHeatMJ + waterHeatMJ, color: P.violet },
          { label: '未燃潜热', v: fuelPendingMJ, color: '#94a3b8' },
        ],
      },
      soot: {
        made: sootMadeTotal,
        tracked: sootTrackedTotal,
        inAir: sootInAirG,
        out: sootOutG,
      },
      gas: {
        released: gb.released ?? 0,
        inAir: gb.inAir ?? 0,
        burned: gasBurnedM3,
        out: (gb.leakedOutside ?? 0) + (gb.lostToSolid ?? 0) + (gb.offGrid ?? 0),
        unaccounted: gb.unaccounted ?? 0,
      },
      water: {
        released: wb.released ?? 0,
        inAir: wb.inAir ?? 0,
        evap: wb.evaporated ?? 0,
        floor: wb.onFloor ?? 0,
        furn: wb.onFurniture ?? 0,
        unaccounted: wb.unaccounted ?? 0,
      },
    };
    return cachedAudit;
  }

  // --- DOM Build: Left panel ---
  const leftChartsEl = document.getElementById('leftCharts');
  const leftTimelineEl = document.getElementById('leftTimeline');
  let leftCanvas = null, leftRoomSel = null, pinBtn = null, clearPinBtn = null;
  let kpiHrr = null, kpiTemp = null, kpiFlux = null, kpiPa = null, tlCountEl = null, tlListEl = null;

  if (leftChartsEl) {
    leftChartsEl.innerHTML = `
      <div class="ana-bar">
        <span class="ana-title">耦合实测曲线</span>
        <select class="ana-select" id="anaLeftRoom" title="选择监测房间"></select>
        <button class="ana-btn" id="anaPinBtn" title="固定当前曲线作为对比基线 Run A">Pin基线</button>
        <button class="ana-btn" id="anaClearPinBtn" style="display:none" title="清除基线 Run A">清</button>
      </div>
      <div class="ana-kpi-grid">
        <div class="ana-kpi"><div class="k">总HRR</div><div class="v" id="anaKpiHrr">0 kW</div></div>
        <div class="ana-kpi"><div class="k">上层温度</div><div class="v" id="anaKpiTemp">20 °C</div></div>
        <div class="ana-kpi"><div class="k">地面辐射</div><div class="v" id="anaKpiFlux">0.0 kW/m²</div></div>
        <div class="ana-kpi"><div class="k">最大|ΔP|</div><div class="v" id="anaKpiPa">0 Pa</div></div>
      </div>
      <div class="ana-canvas-wrap" style="height:224px">
        <canvas id="anaLeftCanvas"></canvas>
      </div>
    `;
    leftCanvas = document.getElementById('anaLeftCanvas');
    leftRoomSel = document.getElementById('anaLeftRoom');
    pinBtn = document.getElementById('anaPinBtn');
    clearPinBtn = document.getElementById('anaClearPinBtn');
    kpiHrr = document.getElementById('anaKpiHrr');
    kpiTemp = document.getElementById('anaKpiTemp');
    kpiFlux = document.getElementById('anaKpiFlux');
    kpiPa = document.getElementById('anaKpiPa');

    attachHover(leftCanvas, 'left', () => drawLeftPlot());
  }

  if (leftTimelineEl) {
    leftTimelineEl.innerHTML = `
      <div class="ana-bar" style="margin-bottom:4px">
        <span class="ana-title">耦合事件链 (点击定位)</span>
        <span class="ana-win-meta" id="anaTlCount" style="color:#94a3b8">0 条</span>
      </div>
      <div class="ana-tl-list" id="anaTlList">
        <div class="ana-empty">尚未触发耦合事件 · 点击点火开始模拟</div>
      </div>
    `;
    tlCountEl = document.getElementById('anaTlCount');
    tlListEl = document.getElementById('anaTlList');
  }

  // --- DOM Build: Top-right Zemax launcher & window dock ---
  const dock = document.createElement('div');
  dock.id = 'anaDock';
  dock.innerHTML = `
    <div class="ana-launcher">
      <span class="ana-brand" title="按住可拖动条位置，拖回右边缘自动吸附">图表</span>
      ${WINDOW_SPECS.map((w) => `<button class="ana-chip" data-win="${w.id}">${w.short}</button>`).join('')}
      <button class="ana-chip" id="anaMinAll" style="display:none;padding:3px 7px" title="关闭全部小窗">收起</button>
    </div>
    <div id="anaWinList"></div>
  `;
  document.body.appendChild(dock);

  const floatLayer = document.createElement('div');
  floatLayer.id = 'anaFloatLayer';
  document.body.appendChild(floatLayer);

  const snapGuide = document.createElement('div');
  snapGuide.id = 'anaSnapGuide';
  document.body.appendChild(snapGuide);

  const launcherEl = dock.querySelector('.ana-launcher');
  const winListEl = document.getElementById('anaWinList');
  const minAllBtn = document.getElementById('anaMinAll');
  const winEls = new Map();
  let nextFloatCascade = 0;

  function clampBoxPos(x, y, elW = 260, elH = 40) {
    const maxW = Math.max(80, (window.innerWidth || 1280) - Math.min(elW, 240));
    const maxH = Math.max(40, (window.innerHeight || 800) - Math.min(elH, 42));
    return {
      x: Math.max(8, Math.min(maxW, Math.round(x))),
      y: Math.max(8, Math.min(maxH, Math.round(y))),
    };
  }

  function showRightSnapGuide(on) {
    if (!on) { snapGuide.style.display = 'none'; return; }
    const lBot = launcherEl.classList.contains('floating') ? 12 : (launcherEl.getBoundingClientRect?.().bottom ?? 44) + 8;
    const toolsEl = document.getElementById('tools');
    const tTop = toolsEl?.getBoundingClientRect?.().top ?? ((window.innerHeight || 800) - 230);
    snapGuide.style.top = `${Math.round(lBot)}px`;
    snapGuide.style.height = `${Math.max(80, Math.round(tTop - lBot - 12))}px`;
    snapGuide.style.display = 'block';
  }

  function reorderDockedCards() {
    for (const spec of WINDOW_SPECS) {
      const ref = winEls.get(spec.id);
      if (ref && !ref.floating) winListEl.appendChild(ref.card);
    }
  }

  function setWindowFloating(id, floating, pos = null) {
    const ref = winEls.get(id);
    if (!ref) return;
    ref.floating = !!floating;
    ref.card.classList.toggle('floating', ref.floating);
    ref.dockBtn.classList.toggle('pin-on', !ref.floating);
    ref.dockBtn.title = ref.floating ? '粘回右侧栏' : '脱离右侧栏悬浮 (也可直接拖动标题栏)';
    if (ref.floating) {
      floatLayer.appendChild(ref.card);
      const r = ref.card.getBoundingClientRect();
      const defX = Math.max(340, (window.innerWidth || 1280) - 750 + (nextFloatCascade % 4) * 24);
      const defY = 56 + (nextFloatCascade % 4) * 30;
      nextFloatCascade++;
      const pt = clampBoxPos(pos?.x ?? (r.width ? r.left : defX), pos?.y ?? (r.height ? r.top : defY), r.width || 356, r.height || 40);
      ref.x = pt.x;
      ref.y = pt.y;
      ref.card.style.left = `${pt.x}px`;
      ref.card.style.top = `${pt.y}px`;
    } else {
      ref.card.style.left = '';
      ref.card.style.top = '';
      reorderDockedCards();
    }
    syncDockState();
  }

  function setWindowCollapsed(id, collapsed) {
    const ref = winEls.get(id);
    if (!ref) return;
    ref.collapsed = !!collapsed;
    ref.card.classList.toggle('collapsed', ref.collapsed);
    ref.foldBtn.textContent = ref.collapsed ? '▢' : '−';
    ref.foldBtn.title = ref.collapsed ? '展开小窗' : '就地最小化成窄条 (可拖动或粘回右边)';
    if (ref.floating) {
      const r = ref.card.getBoundingClientRect();
      const pt = clampBoxPos(ref.x, ref.y, r.width || 260, r.height || 36);
      ref.x = pt.x; ref.y = pt.y;
      ref.card.style.left = `${pt.x}px`;
      ref.card.style.top = `${pt.y}px`;
    }
    syncDockState();
    if (!ref.collapsed && openWins.has(id)) {
      requestAnimationFrame(() => drawWindow(id, ref.canvas, false));
    }
  }

  function bindDrag(handleEl, opts) {
    handleEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, select, input')) return;
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      let dragging = false, offX = 0, offY = 0, w = 356, h = 40;
      const move = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
          dragging = true;
          const r = opts.onStart(ev);
          offX = ev.clientX - r.left;
          offY = ev.clientY - r.top;
          w = r.width || 356;
          h = r.height || 40;
        }
        ev.preventDefault();
        const pt = clampBoxPos(ev.clientX - offX, ev.clientY - offY, w, h);
        const snap = opts.canSnap ? (pt.x + w >= (window.innerWidth || 1280) - 52 || ev.clientX >= (window.innerWidth || 1280) - 84) : false;
        opts.onMove(pt.x, pt.y, snap);
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (dragging) opts.onEnd(ev);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  // Draggable launcher bar itself (snaps back to top-right when near right edge)
  {
    let launcherSnap = false;
    bindDrag(launcherEl.querySelector('.ana-brand'), {
      canSnap: true,
      onStart() {
        const r = launcherEl.getBoundingClientRect();
        launcherEl.classList.add('floating');
        launcherEl.style.left = `${r.left}px`;
        launcherEl.style.top = `${r.top}px`;
        return r;
      },
      onMove(x, y, snap) {
        launcherSnap = snap;
        launcherEl.style.left = `${x}px`;
        launcherEl.style.top = `${y}px`;
        showRightSnapGuide(snap && y < 120);
      },
      onEnd() {
        showRightSnapGuide(false);
        const y = parseFloat(launcherEl.style.top) || 12;
        if (launcherSnap && y < 120) {
          launcherEl.classList.remove('floating');
          launcherEl.style.left = '';
          launcherEl.style.top = '';
        }
        syncDockHeight();
      },
    });
  }

  for (const spec of WINDOW_SPECS) {
    const card = document.createElement('div');
    card.className = 'ana-win';
    card.dataset.win = spec.id;
    card.style.display = 'none';
    card.innerHTML = `
      <div class="ana-win-head">
        <span class="ana-win-title">${spec.title}</span>
        <span class="ana-win-meta" data-meta></span>
        <button class="ana-wbtn" data-fold="${spec.id}" title="就地最小化成窄条 (可拖动或粘回右边)">−</button>
        <button class="ana-wbtn pin-on" data-dock="${spec.id}" title="脱离右侧栏悬浮 / 粘回右边">📌</button>
        <button class="ana-wbtn" data-max="${spec.id}" title="放大为分析大窗">⛶</button>
        <button class="ana-wbtn" data-close="${spec.id}" title="关闭回到顶栏">×</button>
      </div>
      <div class="ana-win-body"><canvas data-canvas="${spec.id}"></canvas></div>
      <div class="ana-subbar" data-subbar="${spec.id}"></div>
    `;
    winListEl.appendChild(card);
    const head = card.querySelector('.ana-win-head');
    const canvas = card.querySelector('canvas');
    attachHover(canvas, spec.id, () => drawWindow(spec.id, canvas, false));

    const ref = {
      card,
      canvas,
      meta: card.querySelector('[data-meta]'),
      subbar: card.querySelector('[data-subbar]'),
      foldBtn: card.querySelector('[data-fold]'),
      dockBtn: card.querySelector('[data-dock]'),
      floating: false,
      collapsed: false,
      x: 0,
      y: 0,
    };
    winEls.set(spec.id, ref);

    head.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      setWindowCollapsed(spec.id, !ref.collapsed);
    });

    let snapRight = false;
    bindDrag(head, {
      canSnap: true,
      onStart() {
        const r = card.getBoundingClientRect();
        if (!ref.floating) {
          setWindowFloating(spec.id, true, { x: r.left, y: r.top });
        }
        return card.getBoundingClientRect();
      },
      onMove(x, y, snap) {
        snapRight = snap;
        ref.x = x; ref.y = y;
        card.style.left = `${x}px`;
        card.style.top = `${y}px`;
        showRightSnapGuide(snap);
      },
      onEnd() {
        showRightSnapGuide(false);
        if (snapRight) setWindowFloating(spec.id, false);
      },
    });
  }

  // --- DOM Build: White Maximized Modal (#anaModal) ---
  const modal = document.createElement('div');
  modal.id = 'anaModal';
  modal.innerHTML = `
    <div class="ana-modal-top">
      <span class="ana-brand" style="font-size:12px">火灾耦合分析仪</span>
      <div class="ana-modal-tabs">
        ${WINDOW_SPECS.map((w) => `<button class="ana-chip" data-mtab="${w.id}">${w.short} · ${w.id.toUpperCase()}</button>`).join('')}
      </div>
      <select class="ana-modal-select" id="anaModalRoom"></select>
      <div id="anaModalSubOpts" style="display:flex;gap:4px"></div>
      <button class="ana-wbtn" id="anaModalPinBtn">Pin基线</button>
      <button class="ana-wbtn" id="anaModalClearBtn" style="display:none">清</button>
      <button class="ana-wbtn warn" id="anaModalClose">↙ 还原小窗</button>
    </div>
    <div class="ana-modal-canvas-wrap">
      <canvas id="anaModalCanvas"></canvas>
    </div>
    <div class="ana-modal-foot">
      <span id="anaModalCite"></span>
      <div class="ana-hot-list" id="anaModalHot"></div>
    </div>
  `;
  document.body.appendChild(modal);

  const modalCanvas = document.getElementById('anaModalCanvas');
  const modalRoomSel = document.getElementById('anaModalRoom');
  const modalPinBtn = document.getElementById('anaModalPinBtn');
  const modalClearBtn = document.getElementById('anaModalClearBtn');
  const modalSubOpts = document.getElementById('anaModalSubOpts');
  const modalCite = document.getElementById('anaModalCite');
  const modalHot = document.getElementById('anaModalHot');
  attachHover(modalCanvas, 'modal', () => {
    if (maximizedId) drawWindow(maximizedId, modalCanvas, true);
  });

  function fillRoomSel(sel) {
    if (!sel) return;
    sel.innerHTML = rooms.map((r) => {
      const k = `${r.code} ${r.name}`;
      return `<option value="${k}">${r.code} ${r.name}</option>`;
    }).join('');
    sel.value = selectedRoomKey;
  }
  fillRoomSel(leftRoomSel);
  fillRoomSel(modalRoomSel);

  function syncRoomSelects() {
    if (leftRoomSel) leftRoomSel.value = selectedRoomKey;
    if (modalRoomSel) modalRoomSel.value = selectedRoomKey;
  }

  function syncBaselineUI() {
    const has = !!baseline;
    const label = has ? `基线 ${Math.round(baseline.atTime)}s` : 'Pin基线';
    if (pinBtn) { pinBtn.textContent = label; pinBtn.classList.toggle('warn', has); }
    if (clearPinBtn) clearPinBtn.style.display = has ? '' : 'none';
    if (modalPinBtn) { modalPinBtn.textContent = label; modalPinBtn.classList.toggle('warn', has); }
    if (modalClearBtn) modalClearBtn.style.display = has ? '' : 'none';
  }

  function syncDockHeight() {
    const toolsEl = document.getElementById('tools');
    const lBot = launcherEl.classList.contains('floating') ? 12 : (launcherEl.getBoundingClientRect?.().bottom ?? 44) + 8;
    const tTop = toolsEl?.getBoundingClientRect?.().top ?? ((window.innerHeight || 800) - 230);
    const avail = Math.max(150, Math.floor(tTop - lBot - 10));
    winListEl.style.maxHeight = `${avail}px`;
  }

  function syncDockState() {
    const anyOpen = openWins.size > 0;
    let anyDockedOpen = false;
    for (const id of openWins) {
      if (!winEls.get(id)?.floating) { anyDockedOpen = true; break; }
    }
    document.body.classList.toggle('ana-open', anyDockedOpen);
    minAllBtn.style.display = anyOpen ? '' : 'none';
    for (const btn of dock.querySelectorAll('.ana-chip[data-win]')) {
      btn.classList.toggle('active', openWins.has(btn.dataset.win));
    }
    for (const [id, ref] of winEls) {
      ref.card.style.display = openWins.has(id) ? '' : 'none';
    }
    if (anyDockedOpen) syncDockHeight();
    if (anyOpen) redrawAllOpenWindows();
  }

  function syncModalUI() {
    modal.classList.toggle('open', !!maximizedId);
    if (!maximizedId) return;
    for (const b of modal.querySelectorAll('[data-mtab]')) {
      b.classList.toggle('active', b.dataset.mtab === maximizedId);
    }
    modalRoomSel.style.display = (maximizedId === 'profile') ? '' : 'none';
    modalSubOpts.innerHTML = maximizedId === 'profile'
      ? [['all', '三联视图'], ['temp', '温度 °C'], ['smoke', '烟雾 OD'], ['gas', '燃气 %']]
        .map(([k, txt]) => `<button class="ana-subchip ${profileMetric === k ? 'on' : ''}" data-pmetric="${k}">${txt}</button>`).join('')
      : '';
    const cites = {
      profile: '依据: 高度标线 0.7m 弯腰 / 1.6m 站立 / 2.1m 门楣；烟感 3.28%/m (NIST TN 1455-1)；OD 0.25m⁻¹ (66 mg/m³)；CH₄ 5%–15% (Zabetakis 1965)',
      margin: '依据: 燃气软管 135/175°C；电工绝缘 205°C (NUREG-6850/FSRI)；铜焊 233°C (Harris 95/5)；玻璃 260°C/3000Pa (Pagni/Kiwa)；调压阀 440/660°C (NTSB)',
      leaks: '依据: 推门卡阻 150 Pa (Brohez 2018)；跨户渗透 300 Pa / 150–180s (IFV 2020)；破窗 3000 Pa (Kiwa 2021)',
      radiation: '依据: Modak 点源辐射 q=Q_r/(4πr²)；20 kW/m² 临界着火通量 (Babrauskas 1981)；含顶棚烟层辐射累加',
      audit: '依据: MAC 交错网格通量守恒 + 墙体传导吸收 + 蒸发潜热 (2.613 MJ/kg) + 跨边界泄漏实时对账',
    };
    modalCite.textContent = cites[maximizedId] || '';
    drawWindow(maximizedId, modalCanvas, true);
  }

  function attachHover(canvas, key, redrawFn) {
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      hover[key] = { x: e.clientX - r.left, y: e.clientY - r.top };
      redrawFn();
    });
    canvas.addEventListener('mouseleave', () => {
      delete hover[key];
      redrawFn();
    });
  }

  leftRoomSel?.addEventListener('change', () => {
    autoTrackRoom = false;
    selectedRoomKey = leftRoomSel.value;
    syncRoomSelects();
    drawAll();
  });
  modalRoomSel?.addEventListener('change', () => {
    autoTrackRoom = false;
    selectedRoomKey = modalRoomSel.value;
    syncRoomSelects();
    drawAll();
  });

  function pinBaseline() {
    const prof = readProfileBins(selectedRoomKey);
    const margins = readComponentMargins();
    baseline = {
      atTime: fire.time,
      roomKey: selectedRoomKey,
      samples: samples.map((s) => ({ ...s })),
      profile: prof.rows.map((r) => ({ ...r })),
      margins: {
        hoseC: margins.hose.c,
        elecC: margins.elec.c,
        jointC: margins.joint.c,
        winC: margins.window.glassC ?? 20,
        valveC: margins.valve.c,
        detObsc: margins.detector.obsc,
      },
    };
    syncBaselineUI();
    drawAll();
  }
  function clearBaseline() {
    baseline = null;
    syncBaselineUI();
    drawAll();
  }
  pinBtn?.addEventListener('click', pinBaseline);
  clearPinBtn?.addEventListener('click', clearBaseline);
  modalPinBtn?.addEventListener('click', pinBaseline);
  modalClearBtn?.addEventListener('click', clearBaseline);

  function handlePanelClick(e) {
    const chip = e.target.closest('.ana-chip[data-win]');
    if (chip) {
      const id = chip.dataset.win;
      if (openWins.has(id)) openWins.delete(id);
      else openWins.add(id);
      syncDockState();
      return;
    }
    if (e.target.closest('#anaMinAll')) {
      openWins.clear();
      syncDockState();
      return;
    }
    const foldBtn = e.target.closest('[data-fold]');
    if (foldBtn) {
      const id = foldBtn.dataset.fold;
      const ref = winEls.get(id);
      if (ref) setWindowCollapsed(id, !ref.collapsed);
      return;
    }
    const dockBtn = e.target.closest('[data-dock]');
    if (dockBtn) {
      const id = dockBtn.dataset.dock;
      const ref = winEls.get(id);
      if (ref) setWindowFloating(id, !ref.floating);
      return;
    }
    const maxBtn = e.target.closest('[data-max]');
    if (maxBtn) { maximize(maxBtn.dataset.max); return; }
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { openWins.delete(closeBtn.dataset.close); syncDockState(); return; }
    const openObj = e.target.closest('[data-obj]');
    if (openObj && world.card?.open) world.card.open(openObj.dataset.obj);
  }
  dock.addEventListener('click', handlePanelClick);
  floatLayer.addEventListener('click', handlePanelClick);

  modal.addEventListener('click', (e) => {
    if (e.target.closest('#anaModalClose')) { maximizedId = null; syncModalUI(); return; }
    const tab = e.target.closest('[data-mtab]');
    if (tab) { maximizedId = tab.dataset.mtab; syncModalUI(); return; }
    const pm = e.target.closest('[data-pmetric]');
    if (pm) { profileMetric = pm.dataset.pmetric; syncModalUI(); return; }
    const obj = e.target.closest('[data-obj]');
    if (obj && world.card?.open) world.card.open(obj.dataset.obj);
  });

  modalCanvas.addEventListener('click', () => {
    if (maximizedId !== 'radiation' || !cachedRadHotspots.length || !hover.modal) return;
    let best = null, bestD = 18;
    for (const h of cachedRadHotspots) {
      const d = Math.hypot(h.sx - hover.modal.x, h.sy - hover.modal.y);
      if (d < bestD) { bestD = d; best = h.id; }
    }
    if (best && world.card?.open) world.card.open(best);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && maximizedId) {
      maximizedId = null;
      syncModalUI();
    }
  });
  window.addEventListener('resize', () => {
    if (launcherEl.classList.contains('floating')) {
      const r = launcherEl.getBoundingClientRect();
      const pt = clampBoxPos(parseFloat(launcherEl.style.left) || r.left, parseFloat(launcherEl.style.top) || r.top, r.width || 300, r.height || 36);
      launcherEl.style.left = `${pt.x}px`;
      launcherEl.style.top = `${pt.y}px`;
    }
    for (const [, ref] of winEls) {
      if (!ref.floating) continue;
      const r = ref.card.getBoundingClientRect();
      const pt = clampBoxPos(ref.x, ref.y, r.width || 356, r.height || 40);
      ref.x = pt.x; ref.y = pt.y;
      ref.card.style.left = `${pt.x}px`;
      ref.card.style.top = `${pt.y}px`;
    }
    if (openWins.size) syncDockHeight();
    if (openWins.size || maximizedId) drawAll();
  });

  function nearestSample(arr, t) {
    if (!arr.length) return null;
    let best = arr[0], bd = Math.abs(arr[0].t - t);
    for (let i = 1; i < arr.length; i++) {
      const d = Math.abs(arr[i].t - t);
      if (d < bd) { bd = d; best = arr[i]; }
      else if (arr[i].t > t) break;
    }
    return best;
  }

  // --- Plot 0: Left Embedded White Line Charts (HRR + Upper Temp) ---
  function drawLeftPlot() {
    if (!leftCanvas) return;
    const { ctx, w, h } = sizeCanvas(leftCanvas);
    const padL = 38, padR = 10, padT = 18, padB = 18, gap = 20;
    const hTop = Math.floor((h - padT - padB - gap) * 0.52);
    const y0Top = padT, y1Top = y0Top + hTop;
    const y0Bot = y1Top + gap, y1Bot = h - padB;
    const x0 = padL, x1 = w - padR;

    const allPts = baseline?.samples ? [...samples, ...baseline.samples] : samples;
    let maxKW = 10, maxC = 28;
    for (const s of allPts) {
      if (s.totalKW > maxKW) maxKW = s.totalKW;
      if (s.roomUpperC > maxC) maxC = s.roomUpperC;
      if (s.roomPeakC > maxC) maxC = s.roomPeakC;
    }
    const tMax = dynTimeMax(allPts);
    maxKW = niceMax(maxKW, 20);
    maxC = niceMax(maxC, 35);

    const mapX = (t) => x0 + (t / tMax) * (x1 - x0);
    const mapYTop = (kw) => y1Top - (kw / maxKW) * (y1Top - y0Top);
    const mapYBot = (c) => y1Bot - ((c - 18) / (maxC - 18)) * (y1Bot - y0Bot);

    drawFrameAndGridH(ctx, x0, x1, y0Top, y1Top, 0, maxKW, niceTicks(0, maxKW, 3), (v) => v >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${Math.round(v)}`);
    drawFrameAndGridH(ctx, x0, x1, y0Bot, y1Bot, 18, maxC, niceTicks(18, maxC, 3), (v) => `${Math.round(v)}`);

    if (THRESHOLDS.flashoverC <= maxC) {
      hLine(ctx, x0, x1, mapYBot(THRESHOLDS.flashoverC), P.refCrit, '600°C 轰燃', 'right', -2);
    }

    ctx.save();
    ctx.font = '9.5px monospace';
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const t of niceTicks(0, tMax, 4)) {
      const tx = mapX(t);
      ctx.strokeStyle = P.grid;
      ctx.beginPath();
      ctx.moveTo(tx, y0Top); ctx.lineTo(tx, y1Top);
      ctx.moveTo(tx, y0Bot); ctx.lineTo(tx, y1Bot);
      ctx.stroke();
      ctx.fillText(`${Math.round(t)}s`, tx, y1Bot + 3);
    }
    ctx.restore();

    drawLegendRow(ctx, [
      { label: '总HRR(kW)', color: P.amber },
      { label: '家具', color: P.blue },
      { label: '燃气', color: P.emerald },
      ...(baseline ? [{ label: '基线A', color: P.base, dashed: true }] : []),
    ], x0, 9);

    ctx.save();
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = P.ink;
    ctx.textAlign = 'left';
    ctx.fillText(`${selectedRoomKey.split(' ')[0]} 室温 °C (实=上层 / 浅=最高)`, x0 + 2, y0Bot - 11);
    ctx.restore();

    if (baseline?.samples?.length) {
      drawSeries(ctx, baseline.samples.map((s) => [s.t, s.totalKW]), mapX, mapYTop, P.base, 1.2, true);
      drawSeries(ctx, baseline.samples.map((s) => [s.t, s.roomUpperC]), mapX, mapYBot, P.base, 1.2, true);
    }

    drawSeries(ctx, samples.map((s) => [s.t, s.woodKW]), mapX, mapYTop, P.blue, 1.3);
    drawSeries(ctx, samples.map((s) => [s.t, s.gasKW]), mapX, mapYTop, P.emerald, 1.3);
    drawSeries(ctx, samples.map((s) => [s.t, s.totalKW]), mapX, mapYTop, P.amber, 2.0, false, { yBase: y1Top, color: 'rgba(234,88,12,0.10)' });

    drawSeries(ctx, samples.map((s) => [s.t, s.roomPeakC]), mapX, mapYBot, 'rgba(220,38,38,0.28)', 1.0);
    drawSeries(ctx, samples.map((s) => [s.t, s.roomUpperC]), mapX, mapYBot, P.red, 1.9);

    // Subtle event markers
    ctx.save();
    for (const ev of causalEvents) {
      if (ev.tag === '熄灭') continue;
      const mx = mapX(ev.t);
      if (mx < x0 || mx > x1) continue;
      ctx.fillStyle = ev.tag === '轰燃' || ev.tag === '燃穿' || ev.tag === '爆燃' ? P.red : P.blue;
      ctx.beginPath();
      ctx.arc(mx, y0Top + 3, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const hv = hover.left;
    if (hv && samples.length && hv.x >= x0 && hv.x <= x1) {
      const ht = ((hv.x - x0) / (x1 - x0)) * tMax;
      const cur = nearestSample(samples, ht);
      if (cur) {
        const cx = mapX(cur.t);
        vLine(ctx, y0Top, y1Bot, cx, P.axis);
        const lines = [
          { text: `t = ${cur.t.toFixed(1)} s`, color: P.ink },
          { text: `总HRR ${fmtPower(cur.totalKW)}`, color: P.amber },
          { text: `木质 ${fmtPower(cur.woodKW)} · 燃 ${fmtPower(cur.gasKW)}`, color: P.blue },
          { text: `上层 ${Math.round(cur.roomUpperC)}°C (峰 ${Math.round(cur.roomPeakC)}°C)`, color: P.red },
        ];
        if (baseline?.samples?.length) {
          const b = nearestSample(baseline.samples, cur.t);
          if (b) lines.push({ text: `基线A ${fmtPower(b.totalKW)} | ${Math.round(b.roomUpperC)}°C`, color: P.slate });
        }
        drawCrosshairBox(ctx, w, lines, cx, Math.min(hv.y, h - 40));
      }
    }
  }

  // --- Window 1: White Vertical Line Profile (0 -> 2.6 m) ---
  function drawProfile(canvas, big) {
    const { ctx, w, h } = sizeCanvas(canvas);
    const prof = readProfileBins(selectedRoomKey);
    const rows = prof.rows;
    const heightM = prof.height || 2.6;
    const baseRows = (baseline?.roomKey === selectedRoomKey ? baseline.profile : null);

    const panels = big && profileMetric === 'all'
      ? [
          { key: 'temp', title: '温度 Temp (°C)', color: P.red, get: (r) => r.tempC, getMax: (r) => r.tempMaxC, min: 18, floorTop: 32, fmt: (v) => `${Math.round(v)}`, vrefs: [[60, '60°C', P.refWarn], [600, '600°C 轰燃', P.refCrit]] },
          { key: 'smoke', title: '光学烟密度 OD (m⁻¹)', color: P.blue, get: (r) => r.od, getMax: (r) => r.odMax, min: 0, floorTop: 0.02, fmt: (v) => v < 0.1 ? v.toFixed(3) : v.toFixed(2), vrefs: [[0.0145, '报警', P.refWarn], [0.25, '0.25 失能', P.refCrit]] },
          { key: 'gas', title: '燃气浓度 CH₄ (%)', color: P.emerald, get: (r) => r.gasPct, getMax: (r) => r.gasMaxPct, min: 0, floorTop: 1.0, fmt: (v) => v < 1 ? v.toFixed(1) : `${Math.round(v)}`, vrefs: [[5, '5% LFL', P.refWarn], [15, '15% UFL', P.refCrit]], band: [5, 15] },
        ]
      : [profileMetric === 'smoke'
          ? { key: 'smoke', title: '烟密度 OD (m⁻¹ · 虚线=层峰)', color: P.blue, get: (r) => r.od, getMax: (r) => r.odMax, min: 0, floorTop: 0.02, fmt: (v) => v < 0.1 ? v.toFixed(3) : v.toFixed(2), vrefs: [[0.0145, '3.28%报警', P.refWarn], [0.25, '0.25失能', P.refCrit]] }
          : profileMetric === 'gas'
          ? { key: 'gas', title: '燃气 CH₄ (% · 虚线=层峰)', color: P.emerald, get: (r) => r.gasPct, getMax: (r) => r.gasMaxPct, min: 0, floorTop: 1.0, fmt: (v) => v < 1 ? v.toFixed(1) : `${Math.round(v)}`, vrefs: [[5, '5%LFL', P.refWarn], [15, '15%UFL', P.refCrit]], band: [5, 15] }
          : { key: 'temp', title: '温度 °C (虚=层峰 · 蓝=烟OD)', color: P.red, get: (r) => r.tempC, getMax: (r) => r.tempMaxC, min: 18, floorTop: 32, fmt: (v) => `${Math.round(v)}`, vrefs: [[60, '60°', P.ref], [600, '600°C', P.refCrit]], dualSmoke: true }
        ];

    const padL = 38, padR = 14, padT = big ? 26 : 20, padB = big ? 26 : 20;
    const gap = 18;
    const pw = (w - padL - padR - gap * (panels.length - 1)) / panels.length;
    const y0 = padT, y1 = h - padB;
    const mapY = (hm) => y1 - (hm / heightM) * (y1 - y0);

    ctx.save();
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let hm = 0; hm <= heightM + 0.05; hm += 0.5) {
      const yy = mapY(Math.min(hm, heightM));
      ctx.fillStyle = P.muted;
      ctx.fillText(`${hm.toFixed(1)}m`, padL - 5, yy);
    }
    ctx.restore();

    const hv = hover[big ? 'modal' : 'profile'];
    const refHeights = [
      [0.7, '0.7m 弯腰', P.ref],
      [1.6, '1.6m 站立', P.ref],
      [2.1, '2.1m 门楣', P.ref],
    ];

    let maxHoverLines = null;
    panels.forEach((p, idx) => {
      const x0 = padL + idx * (pw + gap), x1 = x0 + pw;
      const plotX0 = x0 + 5, plotX1 = x1 - 4;
      let vPeak = 0;
      for (const r of rows) {
        vPeak = Math.max(vPeak, p.get(r), p.getMax ? p.getMax(r) : 0);
      }
      if (baseRows) for (const r of baseRows) vPeak = Math.max(vPeak, p.get(r));
      const vMax = niceMax(vPeak, p.floorTop, [1, 1.5, 2, 2.5, 3, 4, 5, 8, 10]);
      const mapX = (val) => plotX0 + ((val - p.min) / (vMax - p.min || 1)) * (plotX1 - plotX0);

      if (p.band) {
        const bx0 = Math.max(x0, mapX(p.band[0])), bx1 = Math.min(x1, mapX(p.band[1]));
        if (bx1 > bx0) {
          ctx.fillStyle = 'rgba(234, 88, 12, 0.07)';
          ctx.fillRect(bx0, y0, bx1 - bx0, y1 - y0);
        }
      }

      for (const [hm, lbl, col] of refHeights) {
        if (hm <= heightM) hLine(ctx, x0, x1, mapY(hm), col, idx === 0 ? lbl : '', 'right', -2);
      }
      for (const [rv, rlbl, rcol] of p.vrefs) {
        if (rv >= p.min && rv <= vMax) vLine(ctx, y0, y1, mapX(rv), rcol, rlbl, 4);
      }

      ctx.save();
      ctx.font = '9.5px monospace';
      ctx.fillStyle = P.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const tv of niceTicks(p.min, vMax, 3)) {
        const tx = mapX(tv);
        if (tx < x0 || tx > x1) continue;
        ctx.strokeStyle = P.grid;
        ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx, y1); ctx.stroke();
        ctx.fillText(p.fmt(tv), tx, y1 + 3);
      }
      ctx.fillStyle = P.ink;
      ctx.font = '600 10.5px -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.title, x0, y0 - 4);
      ctx.restore();

      if (baseRows?.length) {
        drawSeries(ctx, baseRows.map((r) => [p.get(r), r.h]), mapX, mapY, P.base, 1.2, true);
      }
      if (p.getMax && rows.length) {
        drawSeries(ctx, rows.map((r) => [p.getMax(r), r.h]), mapX, mapY, p.color, 1.2, true);
      }
      drawSeries(ctx, rows.map((r) => [p.get(r), r.h]), mapX, mapY, p.color, 2.2);
      // Visible data nodes per 0.2 m height bin so even uniform profiles stand out clearly
      ctx.save();
      ctx.fillStyle = p.color;
      for (const r of rows) {
        ctx.beginPath();
        ctx.arc(mapX(p.get(r)), mapY(r.h), 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (p.dualSmoke && rows.length) {
        let odTop = 0.02;
        for (const r of rows) odTop = Math.max(odTop, r.odMax ?? r.od);
        odTop = niceMax(odTop, 0.02);
        const mapODX = (od) => plotX0 + (Math.min(od, odTop) / odTop) * (plotX1 - plotX0);
        drawSeries(ctx, rows.map((r) => [r.od, r.h]), mapODX, mapY, P.blue, 1.8);
      }

      if (p.key === 'gas' && vPeak < 0.01) {
        ctx.save();
        ctx.fillStyle = P.muted;
        ctx.font = '10.5px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('该房间当前无 CH₄ 泄漏 (0%)', (x0 + x1) / 2, (y0 + y1) / 2);
        ctx.restore();
      }

      ctx.strokeStyle = P.axis;
      ctx.lineWidth = 1;
      ctx.strokeRect(x0, y0, pw, y1 - y0);

      if (hv && rows.length && hv.x >= x0 - 4 && hv.x <= x1 + 4 && hv.y >= y0 && hv.y <= y1) {
        const targetH = ((y1 - hv.y) / (y1 - y0)) * heightM;
        let near = rows[0], nd = Infinity;
        for (const r of rows) {
          const d = Math.abs(r.h - targetH);
          if (d < nd) { nd = d; near = r; }
        }
        hLine(ctx, x0, x1, mapY(near.h), P.axis);
        maxHoverLines = [
          { text: `${selectedRoomKey.split(' ')[0]} · h = ${near.h.toFixed(2)} m`, color: P.ink },
          { text: `均温 ${Math.round(near.tempC)}°C (峰 ${Math.round(near.tempMaxC)}°C)`, color: P.red },
          { text: `烟 OD ${near.od.toFixed(3)} m⁻¹ · ${near.obscPct.toFixed(1)} %/m (${near.sootMg.toFixed(1)} mg/m³)`, color: P.blue },
          { text: `燃气 CH₄ ${near.gasPct.toFixed(2)} %`, color: P.emerald },
        ];
      }
    });

    if (maxHoverLines && hv) drawCrosshairBox(ctx, w, maxHoverLines, hv.x, hv.y);

    const ref = winEls.get('profile');
    if (!big && ref) {
      const topBin = rows[rows.length - 1];
      let roomPeakT = 20;
      for (const r of rows) if (r.tempMaxC > roomPeakT) roomPeakT = r.tempMaxC;
      ref.meta.textContent = `${selectedRoomKey.split(' ')[0]} · 顶${Math.round(topBin?.tempC ?? 20)}/峰${Math.round(roomPeakT)}°C`;
      if (!ref.subbar.dataset.init) {
        ref.subbar.dataset.init = '1';
        ref.subbar.innerHTML = [['all', '综合(温+烟)'], ['smoke', '烟OD'], ['gas', 'CH₄%']]
          .map(([k, l]) => `<button class="ana-subchip" data-pm="${k}">${l}</button>`).join('');
        ref.subbar.addEventListener('click', (e) => {
          const b = e.target.closest('[data-pm]');
          if (!b) return;
          profileMetric = b.dataset.pm;
          for (const x of ref.subbar.querySelectorAll('[data-pm]')) x.classList.toggle('on', x.dataset.pm === profileMetric);
          drawProfile(ref.canvas, false);
        });
      }
      for (const x of ref.subbar.querySelectorAll('[data-pm]')) {
        x.classList.toggle('on', x.dataset.pm === profileMetric || (profileMetric === 'temp' && x.dataset.pm === 'all'));
      }
    }
  }

  // Helper: White line chart of real-time component temperatures T(t)
  function drawMarginLines(ctx, x0, x1, y0, y1, w, h, hvKey, big) {
    const allPts = baseline?.samples ? [...samples, ...baseline.samples] : samples;
    let tTop = 26;
    for (const s of allPts) {
      tTop = Math.max(tTop, s.hoseC, s.elecC, s.jointC, s.winC, s.valveC);
    }
    const tMax = dynTimeMax(allPts);
    tTop = niceMax(tTop, 32, [1, 1.5, 2, 2.5, 3, 4, 5, 8, 10]);
    const yMin = 18;
    const mapX = (t) => x0 + (t / tMax) * (x1 - x0);
    const mapY = (c) => y1 - ((c - yMin) / (tTop - yMin)) * (y1 - y0);

    drawFrameAndGridH(ctx, x0, x1, y0, y1, yMin, tTop, niceTicks(yMin, tTop, big ? 5 : 4), (v) => `${Math.round(v)}°`);
    ctx.save();
    ctx.font = '9.5px monospace';
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tv of niceTicks(0, tMax, 4)) {
      const tx = mapX(tv);
      ctx.strokeStyle = P.grid;
      ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx, y1); ctx.stroke();
      ctx.fillText(`${Math.round(tv)}s`, tx, y1 + 3);
    }
    ctx.restore();

    // Subtle faded threshold lines so data curves stay hero
    const thLines = big
      ? [[135, '135°软管漏', P.refWarn], [175, '175°软管穿', P.refCrit], [205, '205°电绝缘', P.ref], [233, '233°铜焊', P.ref], [260, '260°窗破', P.refCrit], [440, '440°调压阀', P.ref]]
      : [[175, '175°软管', P.ref], [205, '205°电气', P.ref], [233, '233°铜焊', P.ref], [260, '260°窗', P.refCrit]];
    for (const [tc, lbl, col] of thLines) {
      if (tc <= tTop) hLine(ctx, x0, x1, mapY(tc), col, lbl, 'right', -2);
    }

    drawSeries(ctx, samples.map((s) => [s.t, s.hoseC]), mapX, mapY, P.amber, 2.0);
    drawSeries(ctx, samples.map((s) => [s.t, s.elecC]), mapX, mapY, P.gold, 1.8);
    drawSeries(ctx, samples.map((s) => [s.t, s.jointC]), mapX, mapY, P.blue, 1.8);
    drawSeries(ctx, samples.map((s) => [s.t, s.winC]), mapX, mapY, P.violet, 1.8);
    drawSeries(ctx, samples.map((s) => [s.t, s.valveC]), mapX, mapY, P.emerald, 1.8);

    drawLegendRow(ctx, [
      { label: '软管', color: P.amber },
      { label: '电气', color: P.gold },
      { label: '铜焊', color: P.blue },
      { label: '外窗', color: P.violet },
      { label: '调压', color: P.emerald },
    ], x0, 10);

    const hv = hover[hvKey];
    if (hv && samples.length && hv.x >= x0 && hv.x <= x1 && hv.y >= y0 && hv.y <= y1) {
      const ht = ((hv.x - x0) / (x1 - x0)) * tMax;
      const cur = nearestSample(samples, ht);
      if (cur) {
        vLine(ctx, y0, y1, mapX(cur.t), P.axis);
        drawCrosshairBox(ctx, w, [
          { text: `t = ${cur.t.toFixed(1)} s`, color: P.ink },
          { text: `软管 ${Math.round(cur.hoseC)}°C · 电气 ${Math.round(cur.elecC)}°C`, color: P.amber },
          { text: `铜焊 ${Math.round(cur.jointC)}°C · 窗 ${Math.round(cur.winC)}°C · 阀 ${Math.round(cur.valveC)}°C`, color: P.blue },
        ], mapX(cur.t), hv.y);
      }
    }
  }

  // Helper: Grouped vertical bar chart comparing Current Temp vs Critical Threshold
  function drawMarginBars(ctx, x0, x1, y0, y1, m, w, hvKey, big) {
    const groups = [
      { name: '燃气软管', val: m.hose.c, crit: THRESHOLDS.gasHoseMeltC, color: P.amber, base: baseline?.margins?.hoseC, objId: m.hose.id },
      { name: '电气绝缘', val: m.elec.c, crit: THRESHOLDS.elecDamageC, color: P.gold, base: baseline?.margins?.elecC, objId: m.elec.id },
      { name: '铜焊点', val: m.joint.c, crit: THRESHOLDS.copperJointC, color: P.blue, base: baseline?.margins?.jointC, objId: m.joint.id },
      { name: '外窗玻璃', val: m.window.glassC ?? 20, crit: THRESHOLDS.windowBreakC, color: P.violet, base: baseline?.margins?.winC, objId: m.window.id },
      { name: '调压阀', val: m.valve.c, crit: THRESHOLDS.boilerLeakC, color: P.emerald, base: baseline?.margins?.valveC, objId: m.valve.id },
    ];
    let vTop = 480;
    for (const g of groups) vTop = Math.max(vTop, g.val, g.crit);
    vTop = niceMax(vTop, 480);

    drawFrameAndGridH(ctx, x0, x1, y0, y1, 0, vTop, niceTicks(0, vTop, 4), (v) => `${Math.round(v)}°`);
    const mapY = (v) => y1 - (v / vTop) * (y1 - y0);
    const gw = (x1 - x0) / groups.length;
    const bw = Math.max(8, Math.min(22, gw * 0.28));

    ctx.save();
    groups.forEach((g, idx) => {
      const cx = x0 + (idx + 0.5) * gw;
      // Critical threshold column (outlined light gray column behind/beside)
      const ty = mapY(g.crit);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.fillRect(cx + 1, ty, bw, y1 - ty);
      ctx.strokeRect(cx + 1, ty, bw, y1 - ty);

      // Current value solid column
      const vy = mapY(g.val);
      ctx.fillStyle = g.val >= g.crit ? P.red : g.color;
      ctx.fillRect(cx - bw - 1, vy, bw, y1 - vy);

      // Baseline diamond if pinned
      if (g.base != null) {
        const by = mapY(g.base);
        ctx.fillStyle = P.base;
        ctx.beginPath();
        ctx.moveTo(cx - bw / 2 - 1, by - 3.5);
        ctx.lineTo(cx - bw / 2 + 2.5, by);
        ctx.lineTo(cx - bw / 2 - 1, by + 3.5);
        ctx.lineTo(cx - bw / 2 - 4.5, by);
        ctx.closePath();
        ctx.fill();
      }

      // Numbers above columns & label below X
      ctx.fillStyle = g.val >= g.crit ? P.red : P.ink;
      ctx.font = '9.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(g.val)}°`, cx - bw / 2 - 1, vy - 2);

      ctx.fillStyle = P.muted;
      ctx.fillText(`${g.crit}°`, cx + bw / 2 + 1, ty - 2);

      ctx.fillStyle = P.ink;
      ctx.font = big ? '10.5px -apple-system, sans-serif' : '9.5px -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(g.name, cx, y1 + 4);
    });
    ctx.restore();

    drawLegendRow(ctx, [
      { label: '实测当前°C', color: P.amber },
      { label: '失效阈值°C', color: '#94a3b8' },
    ], x0, 10);

    const hv = hover[hvKey];
    if (hv && hv.x >= x0 && hv.x <= x1 && hv.y >= y0 && hv.y <= y1) {
      const idx = Math.min(groups.length - 1, Math.max(0, Math.floor((hv.x - x0) / gw)));
      const g = groups[idx];
      drawCrosshairBox(ctx, w, [
        { text: `${g.name} (${g.objId})`, color: P.ink },
        { text: `实测 ${Math.round(g.val)} °C · 阈值 ${g.crit} °C`, color: g.color },
        { text: `温升余量 ${Math.max(0, Math.round(g.crit - g.val))} °C`, color: P.slate },
      ], hv.x, hv.y);
    }
  }

  // --- Window 2: Margin (White Line T(t) default + Vertical Comparison Column option) ---
  function drawMargin(canvas, big) {
    const { ctx, w, h } = sizeCanvas(canvas);
    const m = readComponentMargins();
    const ids = [m.hose, m.elec, m.joint, m.window, m.valve];

    if (big) {
      const mid = Math.floor(w * 0.54);
      drawMarginLines(ctx, 40, mid - 16, 22, h - 24, w, h, 'modal', true);
      drawMarginBars(ctx, mid + 28, w - 14, 22, h - 24, m, w, 'modal', true);
      modalHot.innerHTML = ids.map((x) => `<button class="ana-subchip" data-obj="${x.id}">看 ${x.id}</button>`).join('')
        + `<span class="ana-subchip">烟感 ${m.detector.triggered}/${m.detector.total} (${m.detector.obsc.toFixed(2)}%/m)</span>`;
      return;
    }

    if (marginMode === 'bars') {
      drawMarginBars(ctx, 36, w - 10, 22, h - 22, m, w, 'margin', false);
    } else {
      drawMarginLines(ctx, 36, w - 10, 22, h - 22, w, h, 'margin', false);
    }

    const ref = winEls.get('margin');
    if (ref) {
      ref.meta.textContent = `感${m.detector.triggered}/6 · 窗破${m.window.broken}`;
      ref.subbar.innerHTML = `
        <button class="ana-subchip ${marginMode === 'trend' ? 'on' : ''}" data-mm="trend">实时升温</button>
        <button class="ana-subchip ${marginMode === 'bars' ? 'on' : ''}" data-mm="bars">阈值柱状</button>
        ${ids.slice(0, 3).map((x) => `<button class="ana-subchip" data-obj="${x.id}">${x.id}</button>`).join('')}
      `;
      if (!ref.subbar.dataset.mmBound) {
        ref.subbar.dataset.mmBound = '1';
        ref.subbar.addEventListener('click', (e) => {
          const mm = e.target.closest('[data-mm]');
          if (!mm) return;
          marginMode = mm.dataset.mm;
          drawMargin(ref.canvas, false);
        });
      }
    }
  }

  // --- Window 3: White ΔP Line Chart + Vertical Pathway Column Chart ---
  function drawLeaks(canvas, big) {
    const { ctx, w, h } = sizeCanvas(canvas);
    const lb = world.leaks?.books?.() ?? { sootOut: 0, sootAcrossUnits: 0, moved: {} };
    const firsts = world.leaks?.firsts?.() ?? {};
    const movedEntries = Object.entries(lb.moved || {}).filter(([, v]) => v > 1e-5).sort((a, b) => b[1] - a[1]);

    const splitY = Math.floor(h * (big ? 0.54 : 0.52));
    const padL = 46, padR = 12, padT = 20, padB = 22;
    const x0 = padL, x1 = w - padR, y0 = padT, y1 = splitY - 22;

    const allPts = baseline?.samples ? [...samples, ...baseline.samples] : samples;
    let paMax = 4;
    for (const s of allPts) {
      paMax = Math.max(paMax, Math.abs(s.unitAPa), Math.abs(s.unitBPa));
    }
    const tMax = dynTimeMax(allPts);
    paMax = niceMax(paMax, 5);

    const mapX = (t) => x0 + (t / tMax) * (x1 - x0);
    const mapY = (pa) => y1 - (Math.min(Math.abs(pa), paMax) / paMax) * (y1 - y0);

    drawFrameAndGridH(ctx, x0, x1, y0, y1, 0, paMax, niceTicks(0, paMax, 3), (v) => `${Math.round(v)}Pa`);
    ctx.save();
    ctx.font = '9px monospace';
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tv of niceTicks(0, tMax, 4)) {
      const tx = mapX(tv);
      ctx.strokeStyle = P.grid;
      ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx, y1); ctx.stroke();
      ctx.fillText(`${Math.round(tv)}s`, tx, y1 + 2);
    }
    ctx.restore();
    if (THRESHOLDS.doorStuckPa <= paMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.doorStuckPa), P.refWarn, '150Pa 门卡阻', 'right', -2);
    if (THRESHOLDS.ifvSmokePa <= paMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.ifvSmokePa), P.refCrit, '300Pa IFV基准', 'right', -2);
    if (THRESHOLDS.windowBreakPa <= paMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.windowBreakPa), P.red, '3000Pa 破窗', 'right', -2);

    if (baseline?.samples?.length) {
      drawSeries(ctx, baseline.samples.map((s) => [s.t, Math.abs(s.unitAPa)]), mapX, mapY, P.base, 1.2, true);
    }
    drawSeries(ctx, samples.map((s) => [s.t, Math.abs(s.unitAPa)]), mapX, mapY, P.amber, 2.0);
    drawSeries(ctx, samples.map((s) => [s.t, Math.abs(s.unitBPa)]), mapX, mapY, P.blue, 1.8);

    drawLegendRow(ctx, [
      { label: 'Unit A |ΔP|', color: P.amber },
      { label: 'Unit B |ΔP|', color: P.blue },
      ...(baseline ? [{ label: '基线A', color: P.base, dashed: true }] : []),
    ], x0, 10);

    // Lower section: Vertical Column Chart of Soot Transport by Pathway (g)
    const by0 = splitY + 18, by1 = h - padB;
    const kindCN = { outlet: '插座', party: '分户墙', facade: '外窗', window: '窗缝', door: '门缝', shaft: '竖井', floor: '楼板', crack: '缝隙' };
    const firstItems = Array.isArray(firsts)
      ? firsts
          .filter((f) => f && Number.isFinite(f.time))
          .slice()
          .sort((a, b) => a.time - b.time)
          .map((f) => {
            const k = kindCN[f.kind] || f.kind || '';
            const r = f.route && f.route !== f.kind ? ` ${f.route}` : '';
            const dir = f.from && f.to ? `(${f.from}→${f.to})` : '';
            return `${Math.round(f.time)}s ${k}${r}${dir}`;
          })
      : Object.entries(firsts || {}).map(([k, v]) => `${Math.round(typeof v === 'number' ? v : (v?.time ?? 0))}s ${kindCN[k] || k}`);
    const firstKeys = firstItems.slice(0, 2).join(' · ');

    ctx.save();
    ctx.font = '10px -apple-system, sans-serif';
    ctx.fillStyle = P.ink;
    ctx.textAlign = 'left';
    ctx.fillText(`通道迁出烟灰 (g) · 跨户 ${(lb.sootAcrossUnits ?? 0).toFixed(2)}g · 外排 ${(lb.sootOut ?? 0).toFixed(2)}g`, x0, splitY + 4);

    if (!movedEntries.length) {
      ctx.strokeStyle = P.axis;
      ctx.strokeRect(x0, by0, x1 - x0, by1 - by0);
      ctx.fillStyle = P.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无通道跨流 (待烟雾压差建立)', (x0 + x1) / 2, (by0 + by1) / 2);
    } else {
      const cols = movedEntries.slice(0, big ? 8 : 5);
      const maxG = niceMax(cols[0][1], 0.05, [1, 2, 2.5, 5, 10]);
      drawFrameAndGridH(ctx, x0, x1, by0, by1, 0, maxG, niceTicks(0, maxG, 2), (v) => v < 0.1 ? v.toFixed(2) : v.toFixed(1));
      const cw = (x1 - x0) / cols.length;
      const bw = Math.max(10, Math.min(34, cw * 0.5));
      cols.forEach(([k, val], i) => {
        const cx = x0 + (i + 0.5) * cw;
        const barH = (val / maxG) * (by1 - by0);
        const yy = by1 - barH;
        ctx.fillStyle = k.includes('wall') || k.includes('outlet') || k.includes('party') ? P.red : P.violet;
        ctx.fillRect(cx - bw / 2, yy, bw, barH);
        ctx.fillStyle = P.ink;
        ctx.font = '9.5px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(val < 0.1 ? val.toFixed(3) : val.toFixed(2), cx, yy - 1);
        ctx.font = '9.5px -apple-system, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(LEAK_KIND_NAMES[k] || k, cx, by1 + 3);
      });
    }
    ctx.restore();

    const hv = hover[big ? 'modal' : 'leaks'];
    if (hv && samples.length && hv.x >= x0 && hv.x <= x1 && hv.y <= splitY) {
      const ht = ((hv.x - x0) / (x1 - x0)) * tMax;
      const cur = nearestSample(samples, ht);
      if (cur) {
        vLine(ctx, y0, y1, mapX(cur.t), P.axis);
        drawCrosshairBox(ctx, w, [
          { text: `t = ${cur.t.toFixed(1)} s`, color: P.ink },
          { text: `Unit A ${cur.unitAPa.toFixed(1)} Pa · Unit B ${cur.unitBPa.toFixed(1)} Pa`, color: P.amber },
          { text: `累计跨户 ${cur.crossG.toFixed(3)} g`, color: P.blue },
        ], mapX(cur.t), hv.y);
      }
    }

    const ref = winEls.get('leaks');
    if (!big && ref) {
      const pk = world.leaks?.peaks?.() ?? {};
      const maxPk = Math.max(0, ...Object.values(pk).map((v) => Math.abs(v || 0)));
      ref.meta.textContent = `跨户 ${(lb.sootAcrossUnits ?? 0).toFixed(2)}g · 峰 ${Math.round(maxPk)}Pa`;
      ref.subbar.textContent = `IFV基准 150–180s · 实测首烟 ${firstKeys || '待到达'}`;
    } else if (big) {
      const zs = (world.leaks?.zones?.() ?? []).filter((z) => Math.abs(z.pa) >= 5).slice(0, 5);
      const zoneChips = zs.map((z) => `<span class="ana-subchip">${z.rooms.split(' ')[0]} ${z.pa.toFixed(0)}Pa</span>`);
      const firstChips = firstItems.slice(0, 2).map((s) => `<span class="ana-subchip">首烟 ${s}</span>`);
      modalHot.innerHTML = [...zoneChips, ...firstChips].join('');
    }
  }

  // --- Window 4: White Modak Radiation Curve + Scatter + Ranked Column Risk ---
  function drawRadiation(canvas, big) {
    const { ctx, w, h } = sizeCanvas(canvas);
    const srcs = world.radiation?.sources ?? [];
    const items = world.combustion?.items ?? [];
    const radP = world.radiation?.PARAMS ?? {};
    const rMin = radP.minDistance?.value ?? 0.35;

    let mainSrc = srcs[0] ?? null;
    for (const s of srcs) if (s.qr > (mainSrc?.qr ?? 0)) mainSrc = s;

    const rMax = 5.0;
    let qMax = 4;
    const curve = [];
    const qr = mainSrc?.qr ?? 0;
    if (qr > 0) {
      for (let r = 0.2; r <= rMax + 1e-6; r += 0.1) {
        const effR = Math.max(r, rMin);
        // radiation.js pointSource().qr is already in kW (do not divide by 1000 again).
        const qkW = qr / (4 * Math.PI * effR * effR);
        curve.push([r, qkW]);
        if (qkW > qMax && r >= 0.4) qMax = qkW;
      }
    }

    const pts = [];
    for (const it of items) {
      const o = it.o;
      if (!o?.min || !o?.max) continue;
      const cx = 0.5 * (o.min[0] + o.max[0]);
      const cy = 0.5 * (o.min[1] + o.max[1]);
      const cz = 0.5 * (o.min[2] + o.max[2]);
      const dist = mainSrc ? Math.hypot(cx - mainSrc.x, cy - mainSrc.y, cz - mainSrc.z) : 99;
      const flux = o.flux ?? 0;
      if (flux < 0.05 && !(it.dose > 0) && o.state === '完好') continue;
      if (dist > rMax && flux < 0.5) continue;
      const dClamp = Math.min(rMax, Math.max(0.2, dist));
      qMax = Math.max(qMax, flux);
      pts.push({
        id: o.id, label: cleanLabel(o.label || o.name).slice(0, 12),
        r: dClamp, realR: dist, flux, flame: o.fluxFlame ?? 0, smoke: o.fluxSmoke ?? 0,
        dosePct: it.need > 0 ? Math.min(100, (100 * (it.dose ?? 0)) / it.need) : 0,
        burning: o.state !== '完好', state: o.state,
      });
    }
    qMax = niceMax(Math.min(qMax, 160), 5);

    const padL = 40, padR = big ? Math.max(210, Math.round(w * 0.28)) : 12, padT = 20, padB = 22;
    const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
    const mapX = (r) => x0 + (r / rMax) * (x1 - x0);
    const mapY = (q) => y1 - (Math.min(q, qMax) / qMax) * (y1 - y0);

    drawFrameAndGridH(ctx, x0, x1, y0, y1, 0, qMax, niceTicks(0, qMax, 4), (v) => `${v >= 10 ? Math.round(v) : v.toFixed(1)}`);
    ctx.save();
    ctx.font = '9.5px monospace';
    ctx.fillStyle = P.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const rTick of [0, 1, 2, 3, 4, 5]) {
      const tx = mapX(rTick);
      ctx.strokeStyle = P.grid;
      ctx.beginPath(); ctx.moveTo(tx, y0); ctx.lineTo(tx, y1); ctx.stroke();
      ctx.fillText(`${rTick}m`, tx, y1 + 3);
    }
    ctx.restore();

    // Soft background thresholds shown cleanly once y-scale enters range
    if (THRESHOLDS.radCrit10 <= qMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.radCrit10), P.ref, '10 kW/m²', 'right', -2);
    if (THRESHOLDS.radCrit20 <= qMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.radCrit20), P.refWarn, '20 kW/m² 引燃线', 'right', -2);
    if (THRESHOLDS.radCrit40 <= qMax) hLine(ctx, x0, x1, mapY(THRESHOLDS.radCrit40), P.refCrit, '40 kW/m²', 'right', -2);
    if (big) {
      vLine(ctx, y0, y1, mapX(0.44), P.ref, '0.44m', 4);
      vLine(ctx, y0, y1, mapX(0.88), P.ref, '0.88m', 18); // staggered vertically, never overlaps 0.44m
    } else {
      vLine(ctx, y0, y1, mapX(0.44), P.ref);
      vLine(ctx, y0, y1, mapX(0.88), P.ref);
    }

    if (qr > 0) {
      drawSeries(ctx, curve, mapX, mapY, P.blue, 2.2, false, { yBase: y1, color: 'rgba(2,132,199,0.08)' });
    } else if (!pts.length) {
      ctx.save();
      ctx.fillStyle = P.muted;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('暂无活动火焰辐射源 · 点火后自动绘制 Modak q(r) 曲线与散点', (x0 + x1) / 2, (y0 + y1) / 2);
      ctx.restore();
    }

    drawLegendRow(ctx, [
      { label: `Modak 点源 (${qr >= 10 || qr === 0 ? qr.toFixed(0) : qr.toFixed(1)}kW辐)`, color: P.blue },
      { label: '物品受热散点', color: P.amber },
    ], x0, 10);

    cachedRadHotspots = [];
    for (const p of pts) {
      const sx = mapX(p.r), sy = mapY(p.flux);
      cachedRadHotspots.push({ ...p, sx, sy });
      ctx.save();
      ctx.fillStyle = p.burning ? P.red : p.dosePct > 40 ? P.amber : P.blue;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sx, sy, big ? 5.2 : 4.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (big && (p.flux > 6 || p.dosePct > 20)) {
        ctx.fillStyle = P.ink;
        ctx.font = '9.5px -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(p.id, sx + 7, sy + 2);
      }
      ctx.restore();
    }

    // Maximized right panel: Vertical Column Chart of Top Unlit Combustibles' Ignition Dose (%)
    const unlit = [...pts].filter((p) => !p.burning).sort((a, b) => (b.dosePct - a.dosePct) || (b.flux - a.flux));
    if (big) {
      const lx0 = x1 + 36, lx1 = w - 12, ly0 = 26, ly1 = h - 36;
      ctx.save();
      ctx.font = '10.5px -apple-system, sans-serif';
      ctx.fillStyle = P.ink;
      ctx.textAlign = 'left';
      ctx.fillText('Top 未燃物引燃剂量 (%)', lx0, 12);
      drawFrameAndGridH(ctx, lx0, lx1, ly0, ly1, 0, 100, [0, 25, 50, 75, 100], (v) => `${v}%`);
      const top = unlit.slice(0, 6);
      if (top.length) {
        const cw = (lx1 - lx0) / top.length;
        const bw = Math.max(12, Math.min(30, cw * 0.56));
        top.forEach((u, idx) => {
          const cx = lx0 + (idx + 0.5) * cw;
          const bh = (u.dosePct / 100) * (ly1 - ly0);
          const yy = ly1 - bh;
          ctx.fillStyle = u.dosePct >= 70 ? P.red : u.dosePct >= 30 ? P.amber : P.blue;
          ctx.fillRect(cx - bw / 2, yy, bw, bh);
          ctx.fillStyle = P.ink;
          ctx.font = '9.5px monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText(`${Math.round(u.dosePct)}%`, cx, yy - 2);
          ctx.textBaseline = 'top';
          ctx.fillText(u.id, cx, ly1 + 4);
          ctx.fillStyle = P.muted;
          ctx.fillText(`${u.flux.toFixed(0)}kW`, cx, ly1 + 15);
        });
      }
      ctx.restore();
      modalHot.innerHTML = unlit.slice(0, 5).map((u) => `<button class="ana-subchip" data-obj="${u.id}">看 ${u.id} (${u.dosePct.toFixed(0)}%)</button>`).join('');
    } else {
      const ref = winEls.get('radiation');
      if (ref) {
        ref.meta.textContent = unlit[0] ? `危:${unlit[0].id} ${unlit[0].dosePct.toFixed(0)}%` : `${srcs.length}火源`;
        ref.subbar.innerHTML = unlit.slice(0, 3).map((u) => `<button class="ana-subchip" data-obj="${u.id}">${u.id} ${u.dosePct.toFixed(0)}%</button>`).join('') || '点散点定位构件';
      }
    }

    const hv = hover[big ? 'modal' : 'radiation'];
    if (hv && hv.x >= x0 && hv.x <= x1 && hv.y >= y0 && hv.y <= y1) {
      let best = null, bd = 18;
      for (const hPt of cachedRadHotspots) {
        const d = Math.hypot(hPt.sx - hv.x, hPt.sy - hv.y);
        if (d < bd) { bd = d; best = hPt; }
      }
      if (best) {
        drawCrosshairBox(ctx, w, [
          { text: `${best.id} ${best.label} [${best.state}]`, color: P.ink },
          { text: `距火源 ${best.realR.toFixed(2)} m · 总热流 ${best.flux.toFixed(1)} kW/m²`, color: P.amber },
          { text: `焰 ${best.flame.toFixed(1)} + 顶烟 ${best.smoke.toFixed(1)} · 剂量 ${best.dosePct.toFixed(1)}%`, color: P.blue },
        ], best.sx, best.sy);
      } else if (qr > 0) {
        const hr = ((hv.x - x0) / (x1 - x0)) * rMax;
        const effR = Math.max(hr, rMin);
        const hq = qr / (4 * Math.PI * effR * effR);
        drawCrosshairBox(ctx, w, [
          { text: `r = ${hr.toFixed(2)} m`, color: P.ink },
          { text: `Modak q = ${hq.toFixed(1)} kW/m²`, color: P.blue },
        ], hv.x, hv.y);
      }
    }
  }

  // --- Window 5: White Grouped Stacked Vertical Column Audit Chart ---
  function drawAudit(canvas, big) {
    const { ctx, w, h } = sizeCanvas(canvas);
    const a = readAudit();
    const groups = [
      {
        name: '热能 MJ', made: a.energy.made, tracked: a.energy.tracked, unit: 'MJ', prec: 2,
        segsMade: a.energy.partsMade, segsTracked: a.energy.partsTracked,
      },
      {
        name: '烟灰 g', made: a.soot.made, tracked: a.soot.tracked, unit: 'g', prec: 2,
        segsMade: [{ label: '生成', v: a.soot.made, color: P.slate }],
        segsTracked: [
          { label: '室内', v: a.soot.inAir, color: P.blue },
          { label: '外排', v: a.soot.out, color: P.violet },
        ],
      },
      {
        name: '燃气 m³', made: a.gas.released, tracked: a.gas.inAir + a.gas.burned + a.gas.out, unit: 'm³', prec: 3,
        segsMade: [{ label: '释放', v: a.gas.released, color: P.emerald }],
        segsTracked: [
          { label: '空中', v: a.gas.inAir, color: P.blue },
          { label: '已燃', v: a.gas.burned, color: P.amber },
          { label: '漏散', v: a.gas.out, color: P.violet },
        ],
      },
      {
        name: '水量 kg', made: a.water.released, tracked: a.water.inAir + a.water.evap + a.water.floor + a.water.furn, unit: 'kg', prec: 2,
        segsMade: [{ label: '出水', v: a.water.released, color: P.blue }],
        segsTracked: [
          { label: '空中', v: a.water.inAir, color: '#38bdf8' },
          { label: '蒸发', v: a.water.evap, color: P.red },
          { label: '地/物', v: a.water.floor + a.water.furn, color: P.slate },
        ],
      },
    ];

    const padL = 34, padR = 10, padT = 24, padB = 28;
    const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
    drawFrameAndGridH(ctx, x0, x1, y0, y1, 0, 100, [0, 50, 100], (v) => `${v}%`);
    drawLegendRow(ctx, [
      { label: '左柱=源产出(100%)', color: P.amber },
      { label: '右柱=空气+吸热/外排去向', color: P.blue },
    ], x0, 10);

    const gw = (x1 - x0) / groups.length;
    const bw = Math.max(10, Math.min(34, gw * 0.30));

    ctx.save();
    groups.forEach((g, idx) => {
      const cx = x0 + (idx + 0.5) * gw;
      const top = Math.max(1e-6, g.made, g.tracked);
      const errPct = g.made > 1e-6 ? ((g.tracked - g.made) / g.made) * 100 : 0;

      const drawVCol = (bx, segs) => {
        let curY = y1;
        for (const s of segs) {
          const sh = (Math.max(0, s.v) / top) * (y1 - y0);
          if (sh < 0.5) continue;
          curY -= sh;
          ctx.fillStyle = s.color;
          ctx.fillRect(bx, curY, bw, sh);
          if (big && sh > 14) {
            ctx.fillStyle = '#ffffff';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${s.label}`, bx + bw / 2, curY + sh / 2);
          }
        }
        if (curY === y1) {
          ctx.fillStyle = '#e2e8f0';
          ctx.fillRect(bx, y1 - 2, bw, 2);
        }
      };

      drawVCol(cx - bw - 2, g.segsMade);
      drawVCol(cx + 2, g.segsTracked);

      // Value readout above pair + error badge
      const hMax = Math.max(g.made, g.tracked) / top * (y1 - y0);
      ctx.fillStyle = Math.abs(errPct) < 2 ? P.emerald : P.amber;
      ctx.font = '9.5px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      if (g.made > 1e-6) {
        ctx.fillText(`${errPct >= 0 ? '+' : ''}${errPct.toFixed(1)}%`, cx, y1 - hMax - 2);
      }

      ctx.fillStyle = P.ink;
      ctx.font = big ? '11px -apple-system, sans-serif' : '10px -apple-system, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(g.name, cx, y1 + 3);
      ctx.fillStyle = P.muted;
      ctx.font = '9px monospace';
      ctx.fillText(`${g.made.toFixed(g.prec)}/${g.tracked.toFixed(g.prec)}`, cx, y1 + 15);
    });
    ctx.restore();

    const ref = winEls.get('audit');
    const sootGap = a.soot.made > 1e-4 ? Math.abs((a.soot.tracked - a.soot.made) / a.soot.made * 100).toFixed(1) : '0.0';
    if (!big && ref) {
      ref.meta.textContent = `烟差 ${sootGap}% · ${a.energy.made.toFixed(1)}MJ`;
      ref.subbar.textContent = '归一化分组柱图 (注: 热能差含家具表面辐射损失)';
    } else if (big) {
      modalHot.innerHTML = `<span class="ana-subchip">烟灰偏差 ${sootGap}%</span><span class="ana-subchip">燃气未计 ${(a.gas.unaccounted ?? 0).toExponential(1)} m³</span><span class="ana-subchip">水量未计 ${(a.water.unaccounted ?? 0).toExponential(1)} kg</span>`;
    }
  }

  function drawWindow(id, canvas, big) {
    if (id === 'profile') drawProfile(canvas, big);
    else if (id === 'margin') drawMargin(canvas, big);
    else if (id === 'leaks') drawLeaks(canvas, big);
    else if (id === 'radiation') drawRadiation(canvas, big);
    else if (id === 'audit') drawAudit(canvas, big);
  }

  function updateCollapsedMeta(id, ref) {
    const last = samples[samples.length - 1];
    if (!last) return;
    if (id === 'profile') ref.meta.textContent = `${selectedRoomKey.split(' ')[0]} · ${Math.round(last.roomUpperC)}/${Math.round(last.roomPeakC)}°C`;
    else if (id === 'margin') ref.meta.textContent = `峰 ${Math.round(Math.max(last.hoseC, last.elecC, last.jointC, last.winC, last.valveC))}°C`;
    else if (id === 'leaks') ref.meta.textContent = `跨户 ${last.crossG.toFixed(2)}g · ${Math.round(Math.max(Math.abs(last.unitAPa), Math.abs(last.unitBPa)))}Pa`;
    else if (id === 'radiation') ref.meta.textContent = `${(world.radiation?.sources ?? []).length}火源 · ${last.floorFlux.toFixed(1)}kW`;
    else if (id === 'audit') ref.meta.textContent = `${((fire.heatMade ?? 0) / 1e6).toFixed(1)}MJ`;
  }

  function redrawAllOpenWindows() {
    for (const id of openWins) {
      const ref = winEls.get(id);
      if (!ref) continue;
      if (ref.collapsed) updateCollapsedMeta(id, ref);
      else drawWindow(id, ref.canvas, false);
    }
    if (maximizedId) drawWindow(maximizedId, modalCanvas, true);
  }

  function updateKPIs() {
    const last = samples[samples.length - 1];
    if (!last) return;
    if (kpiHrr) kpiHrr.textContent = fmtPower(last.totalKW);
    if (kpiTemp) {
      kpiTemp.textContent = `${Math.round(last.roomUpperC)} °C`;
      kpiTemp.style.color = last.roomUpperC >= THRESHOLDS.flashoverC ? '#fca5a5' : last.roomUpperC >= 200 ? '#fdba74' : '#f8fafc';
    }
    if (kpiFlux) kpiFlux.textContent = `${last.floorFlux.toFixed(1)} kW/m²`;
    if (kpiPa) kpiPa.textContent = `${Math.round(Math.max(Math.abs(last.unitAPa), Math.abs(last.unitBPa)))} Pa`;
  }

  function renderTimeline() {
    if (!tlListEl) return;
    if (tlCountEl) tlCountEl.textContent = `${causalEvents.length} 条`;
    if (!causalEvents.length) {
      tlListEl.innerHTML = '<div class="ana-empty">尚未触发耦合事件 · 点击点火开始模拟</div>';
      return;
    }
    const items = [];
    for (let i = causalEvents.length - 1; i >= 0; i--) {
      const ev = causalEvents[i];
      items.push(
        `<button class="ana-ev" data-eidx="${i}" title="点击闪烁定位 3D 位置与构件卡片">` +
          `<span class="t">${ev.t.toFixed(1)}s</span>` +
          `<span class="tag" style="background:${ev.bg};color:${ev.fg}">${ev.tag}</span>` +
          `<span class="msg">${ev.desc}</span>` +
        `</button>`
      );
    }
    tlListEl.innerHTML = items.join('');
  }

  tlListEl?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-eidx]');
    if (!row) return;
    const ev = causalEvents[Number(row.dataset.eidx)];
    if (!ev) return;
    if (ev.pos) triggerPing(ev.pos);
    if (ev.objectId && world.card?.open) world.card.open(ev.objectId);
  });

  function drawAll() {
    updateKPIs();
    drawLeftPlot();
    redrawAllOpenWindows();
  }

  function openWindow(id, on = true) {
    if (!winEls.has(id)) return;
    if (on) openWins.add(id);
    else openWins.delete(id);
    syncDockState();
  }

  function maximize(id) {
    maximizedId = id && winEls.has(id) ? id : null;
    syncModalUI();
  }

  function report() {
    if (samples.length === 0 || fire.time >= nextSampleAt - 1e-6) {
      nextSampleAt = Math.floor(fire.time * 2) * 0.5 + 0.5;
      sampleNow();
    }
    const now = performance.now();
    if (now - lastDrawMs >= 110) {
      lastDrawMs = now;
      drawAll();
    }
  }

  function reset() {
    clearPing();
    samples.length = 0;
    causalEvents.length = 0;
    nextSampleAt = 0;
    lastAuditSim = -1;
    cachedAudit = null;
    lastDrawMs = 0;
    sampleNow();
    renderTimeline();
    drawAll();
  }

  sampleNow();
  syncBaselineUI();
  syncDockState();
  drawAll();

  const api = {
    report,
    reset,
    pinBaseline,
    clearBaseline,
    openWindow,
    collapseWindow(id, on = true) { setWindowCollapsed(id, on); },
    dockWindow(id, dockRight = true) { setWindowFloating(id, !dockRight); },
    maximize,
    selectRoom(key) {
      if (roomMap.has(key)) {
        autoTrackRoom = false;
        selectedRoomKey = key;
        syncRoomSelects();
        drawAll();
      }
    },
    samples,
    events: causalEvents,
    status() {
      return {
        room: selectedRoomKey,
        samples: samples.length,
        events: causalEvents.length,
        openWindows: [...openWins],
        floatingWindows: [...winEls.entries()].filter(([, r]) => r.floating).map(([id]) => id),
        collapsedWindows: [...winEls.entries()].filter(([, r]) => r.collapsed).map(([id]) => id),
        maximized: maximizedId,
        hasBaseline: !!baseline,
      };
    },
  };
  world.analysis = api;
  return api;
}
