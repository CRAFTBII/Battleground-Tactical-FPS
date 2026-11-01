// 审计：地图声明 w/d/h vs 建筑真实几何尺寸 vs CONFIGS 碰撞盒外延
// 用法: node tools/_audit_dims.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = p => path.join(ROOT, p);

// ---- 真实几何尺寸 ----
const dims = JSON.parse(fs.readFileSync(R('models/buildings_dims.json'), 'utf8'));
// legacy 5 型（仍走 BUILDINGS_DATA，dims 不生效）
const legacySrc = fs.readFileSync(R('models/buildings_data.js'), 'utf8');
const legacy = eval('(' + legacySrc.replace(/^[\s\S]*?BUILDINGS_DATA\s*=/, '').replace(/;\s*$/, '') + ')');
for (const k of Object.keys(legacy)) {
  if (dims[k]) continue;
  const b = Buffer.from(legacy[k].pos, 'base64');
  const n = b.length / 4, f = new Float32Array(b.buffer, b.byteOffset, n);
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < n; i += 3) for (let c = 0; c < 3; c++) { const v = f[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
  dims[k] = { w: +(mx[0] - mn[0]).toFixed(2), d: +(mx[1] - mn[1]).toFixed(2), h: +(mx[2] - mn[2]).toFixed(2), legacy: true };
}

// ---- CONFIGS 碰撞盒外延 ----
const modelsSrc = fs.readFileSync(R('js/models.js'), 'utf8');
const sandbox = { window: {}, console };
const CONFIGS = (function () {
  const m = modelsSrc.match(/CONFIGS:\s*(\{[\s\S]*?)\n  \},\n\n  \/\/ 构建一栋建筑/);
  if (!m) throw new Error('未能定位 CONFIGS');
  return eval('(' + m[1] + '\n})');
})();
const cfgExtent = {};
for (const k of Object.keys(CONFIGS)) {
  const cs = CONFIGS[k].colliders || [];
  let w = 0, d = 0, h = 0;
  for (const c of cs) { w = Math.max(w, c[3]); d = Math.max(d, c[4]); h = Math.max(h, c[5]); }
  cfgExtent[k] = { w: +w.toFixed(2), d: +d.toFixed(2), h: +h.toFixed(2) };
}

// ---- 地图声明：兼容 scale 与显式 w/d/h ----
const placements = [];
for (const map of ['desert', 'port', 'suburb']) {
  const src = fs.readFileSync(R('js/maps/' + map + '.js'), 'utf8');
  const re = /type:\s*'model',\s*key:\s*'(\w+)'/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index;
    const next = src.indexOf('\n      {', start + 1);
    const end = next < 0 ? src.length : next;
    const block = src.slice(start, end);
    const num = name => {
      const hit = block.match(new RegExp('\\b' + name + ':\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+))'));
      return hit ? Number(hit[1]) : null;
    };
    const key = m[1], t = dims[key];
    const scale = num('scale');
    let w = num('w'), d = num('d'), h = num('h');
    if (scale !== null && t && !t.legacy) { w = t.w * scale; d = t.d * scale; h = t.h * scale; }
    if (w !== null && d !== null && h !== null)
      placements.push({ map, key, w, d, h, scale, legacy: !!(t && t.legacy) });
  }
}

console.log('=== 一、CONFIGS 碰撞外延 vs 真实几何（应基本一致，否则碰撞与视觉错位）===');
console.log('key'.padEnd(12), '真实 w×d×h'.padEnd(24), 'CONFIGS 外延'.padEnd(24), '状态');
for (const k of Object.keys(cfgExtent)) {
  const t = dims[k];
  if (!t) { console.log(k.padEnd(12), '(无几何)'.padEnd(24), fmt(cfgExtent[k]).padEnd(24), '✗ 缺几何'); continue; }
  const c = cfgExtent[k];
  const dev = Math.max(Math.abs(c.w - t.w) / t.w, Math.abs(c.d - t.d) / t.d, Math.abs(c.h - t.h) / t.h);
  console.log(k.padEnd(12), fmt(t).padEnd(24), fmt(c).padEnd(24),
    dev < 0.06 ? '✓' : '⚠ 偏差 ' + (dev * 100).toFixed(0) + '%');
}

console.log('\n=== 二、地图声明 vs 真实几何（非等比 = 拉伸畸变）===');
console.log('图'.padEnd(8), 'key'.padEnd(11), '声明 w×d×h'.padEnd(22), '真实 w×d×h'.padEnd(24), 'sx/sz(深)/sy(高)'.padEnd(26), '判定');
const seen = new Set();
let bad = 0;
for (const p of placements) {
  const t = dims[p.key];
  const sig = p.map + '|' + p.key + '|' + p.w + '|' + p.d + '|' + p.h;
  if (seen.has(sig)) continue; seen.add(sig);
  if (!t) { console.log(p.map.padEnd(8), p.key.padEnd(11), fmt(p).padEnd(22), '(无几何)'); continue; }
  const sx = p.w / t.w, sz = p.d / t.d, sy = p.h / t.h;
  const mn = Math.min(sx, sz, sy), mx = Math.max(sx, sz, sy);
  const ratio = mx / mn;
  const flag = t.legacy ? '— legacy(缩放不生效，仅影响檐口/小地图)'
    : ratio < 1.06 ? '✓ 等比' : '✗ 畸变 ' + ratio.toFixed(2) + '×';
  if (!t.legacy && ratio >= 1.06) bad++;
  console.log(p.map.padEnd(8), p.key.padEnd(11), fmt(p).padEnd(22), fmt(t).padEnd(24),
    (sx.toFixed(3) + ' / ' + sz.toFixed(3) + ' / ' + sy.toFixed(3)).padEnd(26), flag);
}
console.log('\n畸变摆放种类数:', bad, '| 总摆放数:', placements.length);

function fmt(o) { return o.w + '×' + o.d + '×' + o.h; }
