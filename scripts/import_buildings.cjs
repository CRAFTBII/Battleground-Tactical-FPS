#!/usr/bin/env node
/* ============================================================
 * scripts/import_buildings.cjs — 外部建筑包 → 游戏运行时资产
 * ------------------------------------------------------------
 * 输入：import_glbs/*.glb（仓库内临时目录，IMPORT_GLB_DIR 可覆盖）
 * 输出：models/buildings/<key>.glb
 *   单 mesh / Z-up / 西南角原点 / 顶点色；
 *   碰撞/平台/门洞/尺寸写入 GLB extras.battlegame（运行时单一事实源）。
 *   models/buildings_dims.json / models/.building-groups.json
 *
 * 碰撞生成（按构件名 + 包围盒）：
 *   wall/pier/armor/partition/shutter/slat/gate/jamb/sill/counter/column/post/
 *   rail/parapet/entry/cover/container/barrier/sandbag/structure → 实心盒
 *   glass → 实心盒（视觉不画，避免不透明玻璃）
 *   floor/slab/landing/platform/roof（非 slope）→ 平台；≥2.6m 再加薄碰撞盒
 *   stair step → 平台；stairs 聚合体 → 长轴 10 级平台
 *   贴地 door header（<3m）→ 门洞（nav 网格打通），本身不碰撞
 *   lintel/trim/facade/equipment/lighting/props/crate/rubble/drain/marking → 不碰撞
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
global.THREE = require(path.join(ROOT, 'libs', 'three.min.js'));
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'js', 'glb.js'), 'utf8') + '\nglobalThis.__GLB = GLB;', { filename: 'glb.js' });
const GLB = global.__GLB;
const GLB_DIR = process.env.IMPORT_GLB_DIR || path.join(ROOT, 'import_glbs');
const OUT_DIR = path.join(ROOT, 'models', 'buildings');

function readMeshes(file) {
  const b = fs.readFileSync(path.join(GLB_DIR, file));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  const root = GLB.scene(GLB.parse(ab), { castShadow: false, receiveShadow: false });
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes.push({ mesh: o, name: (o.name || '').trim(), box: new THREE.Box3().setFromObject(o) });
  });
  return meshes;
}
const unionBox = list => { const b = new THREE.Box3(); for (const m of list) b.union(m.box); return b; };
const translateBox = (box, dx, dy, dz) => { box.min.x += dx; box.min.y += dy; box.min.z += dz; box.max.x += dx; box.max.y += dy; box.max.z += dz; };

const DEFS = [
  { key: 'house_small', file: 'Tactical_FPS_Buildings.glb', prefix: 'House_A_' },
  { key: 'house', file: 'Tactical_FPS_Buildings.glb', prefix: 'House_B_' },
  { key: 'warehouse', file: 'Tactical_FPS_Buildings.glb', prefix: 'Warehouse_' },
  { key: 'guardhouse', file: 'Tactical_FPS_Buildings.glb', prefix: 'Guard_Shack_' },
  {
    key: 'cover', file: 'Tactical_FPS_Buildings.glb', selectors: [
      { prefix: 'Cover_Concrete_Wall_A', at: [0.30, 0.30] },
      { prefix: 'Cover_Concrete_Wall_C', at: [7.20, 0.30] },
      { prefix: 'Cover_Concrete_Wall_B', at: [0.30, 5.60] },
      { prefix: 'Cover_Jersey_Barrier_A', at: [11.80, 2.90] },
      { prefix: 'Cover_Sandbags_A', at: [5.40, 2.80] }
    ]
  },
  { key: 'farmhouse', file: 'Tactical_FPS_Additional_Buildings.glb', prefix: 'Farmhouse_C_' },
  { key: 'workshop', file: 'Tactical_FPS_Additional_Buildings.glb', prefix: 'Workshop_D_' },
  { key: 'apartment', file: 'Tactical_FPS_Additional_Buildings.glb', prefix: 'Apartment_E_' },
  { key: 'pumpstation', file: 'Tactical_FPS_Additional_Buildings.glb', prefix: 'PumpStation_F_' },
  { key: 'bunker', file: 'Tactical_FPS_Additional_Buildings.glb', prefix: 'Bunker_G_' },
  { key: 'base', file: 'large_combat_base.glb', skip: /^00_Site_/ },
  { key: 'estate', file: 'large_house.glb' }
];

function classify(name, box) {
  const n = name.toLowerCase();
  const r = { visual: true, collide: false, platform: false, door: false, stair: false };
  if (/^00_site_/.test(n) || /site_markings|_marking|markings_|decal/.test(n)) { r.visual = false; return r; }
  if (/^ground_1$/.test(n) || /foundation/.test(n)) return r;
  if (/glass/.test(n)) { r.visual = false; r.collide = true; return r; }
  if (/door.*header|door.*lintel/.test(n)) {
    if (box.min.z < 3.0 && box.max.z < 6.0) r.door = true;
    return r;
  }
  if (/lintel|header|header_trim|_trim$|trim_/.test(n)) return r;
  if (/rail/.test(n)) { r.collide = true; return r; }
  if (/stair/.test(n)) { if (/step/.test(n)) r.platform = true; else r.stair = true; return r; }
  if (/floor|slab|landing/.test(n)) { r.platform = true; r.collide = box.min.z > 2.5; return r; }
  if (/roof/.test(n)) {
    if (/slope|gable|pitch/.test(n)) return r;
    r.platform = true; r.collide = box.min.z > 2.5; return r;
  }
  if (/platform/.test(n)) { r.platform = true; r.collide = box.min.z > 2.5; return r; }
  if (/facade|equipment|lighting|light_|lamp|prop|crate|furniture|rubble|drain|vent|duct|sign/.test(n)) return r;
  if (/truss|beam|joist|girder/.test(n)) return r;
  if (/wall|pier|armor|partition|shutter|slat|gate|jamb|sill|counter|column|post|parapet|entry|cover|container|barrier|sandbag|structure/.test(n)) {
    r.collide = true; return r;
  }
  return r;
}

/* 聚合墙面/围墙/货柜：AABB 会把整个矩形填实（例如 base 的内外墙、四周围墙），
 * 按三角边采样成 0.4m 占据格，再贪心合并为矩形 → 保留门/窗/通道洞。 */
function voxelRects(geo, zlo, zhi, cell) {
  cell = cell || 0.4;
  const pos = geo.attributes.position.array;
  const idx = geo.index ? geo.index.array : null;
  const nTri = idx ? idx.length / 3 : pos.length / 9;
  const occ = new Set();
  const add = (x, y) => occ.add(Math.floor(x / cell) + ',' + Math.floor(y / cell));
  const sample = (ax, ay, bx, by) => {
    const d = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.ceil(d / (cell * 0.5)));
    for (let i = 0; i <= n; i++) { const t = i / n; add(ax + (bx - ax) * t, ay + (by - ay) * t); }
  };
  for (let t = 0; t < nTri; t++) {
    const i0 = idx ? idx[t * 3] * 3 : t * 9;
    const i1 = idx ? idx[t * 3 + 1] * 3 : t * 9 + 3;
    const i2 = idx ? idx[t * 3 + 2] * 3 : t * 9 + 6;
    const ax = pos[i0], ay = pos[i0 + 1], bx = pos[i1], by = pos[i1 + 1], cx = pos[i2], cy = pos[i2 + 1];
    sample(ax, ay, bx, by); sample(bx, by, cx, cy); sample(cx, cy, ax, ay);
  }
  const cells = [...occ].map(s => s.split(',').map(Number));
  const has = (x, z) => occ.has(x + ',' + z);
  const used = new Set();
  const out = [];
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x0, z0] of cells) {
    const k0 = x0 + ',' + z0;
    if (used.has(k0)) continue;
    let x1 = x0;
    while (has(x1 + 1, z0) && !used.has((x1 + 1) + ',' + z0)) x1++;
    let z1 = z0;
    for (;;) {
      let ok = true;
      for (let x = x0; x <= x1; x++) if (!has(x, z1 + 1) || used.has(x + ',' + (z1 + 1))) { ok = false; break; }
      if (!ok) break;
      z1++;
    }
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) used.add(x + ',' + z);
    out.push([x0 * cell, z0 * cell, x1 * cell + cell, z1 * cell + cell]);
  }
  return out;
}

function build(def) {  const all = readMeshes(def.file);
  let picked = [];
  if (def.prefix) picked = all.filter(m => m.name.startsWith(def.prefix));
  else if (def.selectors) {
    for (const sel of def.selectors) {
      const ms = all.filter(m => m.name.startsWith(sel.prefix));
      if (!ms.length) { console.warn('[import] 缺构件组 ' + sel.prefix); continue; }
      const u = unionBox(ms);
      const dx = sel.at[0] - u.min.x, dy = sel.at[1] - u.min.y;
      for (const m of ms) { translateBox(m.box, dx, dy, 0); m.offset = [dx, dy, 0]; }
      picked.push(...ms);
    }
  } else picked = all;
  if (def.skip) picked = picked.filter(m => !def.skip.test(m.name));
  if (!picked.length) throw new Error(def.key + ': 未选中任何构件');

  const fullBox = unionBox(picked);
  const off = { x: fullBox.min.x, y: fullBox.min.y, z: fullBox.min.z };
  const dims = {
    w: +(fullBox.max.x - off.x).toFixed(2),
    d: +(fullBox.max.y - off.y).toFixed(2),
    h: +(fullBox.max.z - off.z).toFixed(2)
  };

  const positions = [], normals = [], colors = [], indices = [];
  const colliders = [], platforms = [], doors = [];
  let vbase = 0, tris = 0;

  for (const m of picked) {
    const cls = classify(m.name, m.box);
    const bx0 = m.box.min.x - off.x, by0 = m.box.min.y - off.y, bz0 = m.box.min.z - off.z;
    const bx1 = m.box.max.x - off.x, by1 = m.box.max.y - off.y, bz1 = m.box.max.z - off.z;

    if (cls.door) doors.push([+bx0.toFixed(3), +by0.toFixed(3), +bx1.toFixed(3), +by1.toFixed(3)]);
    if (cls.collide) {
      const n = m.name.toLowerCase();
      const area = (bx1 - bx0) * (by1 - by0);
      const aggregate = area > 40 || /perimeter|interior_structure|outdoor_cover|outdoor_containers/.test(n);
      if (aggregate) {
        const cg = m.mesh.geometry.clone();
        cg.applyMatrix4(m.mesh.matrixWorld);
        if (m.offset) cg.translate(m.offset[0], m.offset[1], m.offset[2]);
        cg.translate(-off.x, -off.y, -off.z);
        for (const r of voxelRects(cg, bz0, bz1)) {
          const rx0 = Math.max(0, r[0]), ry0 = Math.max(0, r[1]);
          const rx1 = Math.min(dims.w, r[2]), ry1 = Math.min(dims.d, r[3]);
          if (rx1 - rx0 < 0.2 || ry1 - ry0 < 0.2 || bz1 - bz0 < 0.25) continue;
          colliders.push([+rx0.toFixed(3), +ry0.toFixed(3), +bz0.toFixed(3), +rx1.toFixed(3), +ry1.toFixed(3), +bz1.toFixed(3)]);
        }
        cg.dispose();
      } else if (bx1 - bx0 > 0.06 && by1 - by0 > 0.06 && bz1 - bz0 > 0.25) {
        colliders.push([+bx0.toFixed(3), +by0.toFixed(3), +bz0.toFixed(3), +bx1.toFixed(3), +by1.toFixed(3), +bz1.toFixed(3)]);
      }
    }
    if (cls.platform) platforms.push({ x0: +bx0.toFixed(3), x1: +bx1.toFixed(3), y0: +by0.toFixed(3), y1: +by1.toFixed(3), y: +bz1.toFixed(3) });
    if (cls.stair) {
      const N = 10, w = bx1 - bx0, d = by1 - by0;
      for (let i = 0; i < N; i++) {
        const z = +(bz0 + (bz1 - bz0) * (i + 1) / N).toFixed(3);
        if (w >= d) {
          platforms.push({ x0: +(bx0 + w * i / N).toFixed(3), x1: +(bx0 + w * (i + 1) / N).toFixed(3), y0: +by0.toFixed(3), y1: +by1.toFixed(3), y: z });
        } else {
          platforms.push({ x0: +bx0.toFixed(3), x1: +bx1.toFixed(3), y0: +(by0 + d * i / N).toFixed(3), y1: +(by0 + d * (i + 1) / N).toFixed(3), y: z });
        }
      }
    }

    if (!cls.visual) continue;
    const geo = m.mesh.geometry.clone();
    geo.applyMatrix4(m.mesh.matrixWorld);
    if (m.offset) geo.translate(m.offset[0], m.offset[1], m.offset[2]);
    geo.translate(-off.x, -off.y, -off.z);
    if (!geo.attributes.position) continue;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const p = geo.attributes.position.array, nr = geo.attributes.normal.array, cnt = geo.attributes.position.count;
    const mat = m.mesh.material || {};
    let carr;
    if (geo.attributes.color) {
      const cl = geo.attributes.color, stride = cl.itemSize || 3, src = cl.array;
      carr = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) {
        carr[i * 3] = src[i * stride]; carr[i * 3 + 1] = src[i * stride + 1]; carr[i * 3 + 2] = src[i * stride + 2];
      }
    } else {
      carr = new Float32Array(cnt * 3);
      const c = mat.color || new THREE.Color(0x9aa4b0);
      for (let i = 0; i < cnt; i++) { carr[i * 3] = c.r; carr[i * 3 + 1] = c.g; carr[i * 3 + 2] = c.b; }
    }
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < nr.length; i++) normals.push(nr[i]);
    for (let i = 0; i < carr.length; i++) colors.push(carr[i]);
    if (geo.index) {
      const ia = geo.index.array;
      for (let i = 0; i < ia.length; i++) indices.push(ia[i] + vbase);
      tris += ia.length / 3;
    } else {
      for (let i = 0; i < cnt; i++) indices.push(i + vbase);
      tris += cnt / 3;
    }
    vbase += cnt;
    geo.dispose();
  }

  const kept = [];
  for (let i = 0; i < colliders.length; i++) {
    const a = colliders[i];
    let contained = false;
    for (let j = 0; j < colliders.length; j++) {
      if (i === j) continue;
      const b = colliders[j];
      if (a[0] >= b[0] - 0.001 && a[3] <= b[3] + 0.001 &&
          a[1] >= b[1] - 0.001 && a[4] <= b[4] + 0.001 &&
          a[2] >= b[2] - 0.001 && a[5] <= b[5] + 0.001) { contained = true; break; }
    }
    if (!contained) kept.push(a);
  }

  return {
    dims, colliders: kept, platforms, doors,
    visual: { positions, normals, colors, indices },
    stats: { tris: Math.round(tris), colliders: kept.length, platforms: platforms.length, doors: doors.length }
  };
}

function writeGlb(file, v, name, meta) {
  const pos = new Float32Array(v.positions), nor = new Float32Array(v.normals), col = new Float32Array(v.colors);
  const idx = new Uint32Array(v.indices);
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]);
  }
  const chunks = [], views = [];
  let offset = 0;
  const addView = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (target) view.target = target;
    views.push(view); chunks.push(bytes); offset += bytes.length;
    return views.length - 1;
  };
  const vIdx = addView(idx, 34963), vPos = addView(pos, 34962), vNor = addView(nor, 34962), vCol = addView(col, 34962);
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'battlegame scripts/import_buildings.cjs' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 1, NORMAL: 2, COLOR_0: 3 }, indices: 0, material: 0 }] }],
    materials: [{ name: name + '_vc', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    accessors: [
      { bufferView: vIdx, componentType: 5125, count: idx.length, type: 'SCALAR' },
      { bufferView: vPos, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn.map(x => +x.toFixed(4)), max: mx.map(x => +x.toFixed(4)) },
      { bufferView: vNor, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
      { bufferView: vCol, componentType: 5126, count: col.length / 3, type: 'VEC3' }
    ],
    extras: { battlegame: meta }
  };
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4;
  if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const total = 12 + 8 + jsonBuf.length + 8 + bin.length;
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jhead = Buffer.alloc(8); jhead.writeUInt32LE(jsonBuf.length, 0); jhead.writeUInt32LE(0x4E4F534A, 4);
  const bhead = Buffer.alloc(8); bhead.writeUInt32LE(bin.length, 0); bhead.writeUInt32LE(0x004E4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jhead, jsonBuf, bhead, bin]));
}

function writeDims(meta) {
  const file = path.join(ROOT, 'models', 'buildings_dims.json');
  let old = {};
  try { old = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  for (const k in meta) old[k] = meta[k].dims;
  fs.writeFileSync(file, JSON.stringify(old, null, 2) + '\n');
}

function writeGroups() {
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.glb')).map(f => f.replace(/\.glb$/, '')).sort();
  const file = path.join(ROOT, 'models', '.building-groups.json');
  fs.writeFileSync(file, JSON.stringify({ generator: 'scripts/import_buildings.cjs', legacy: [], out: files }, null, 2) + '\n');
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const meta = {};
for (const def of DEFS) {
  const r = build(def);
  const m = { dims: r.dims, colliders: r.colliders, platforms: r.platforms, doors: r.doors };
  writeGlb(path.join(OUT_DIR, def.key + '.glb'), r.visual, def.key, m);
  meta[def.key] = m;
  console.log('[import] ' + def.key.padEnd(12) + ' ' + r.dims.w + '×' + r.dims.d + '×' + r.dims.h +
    '  tris=' + r.stats.tris + ' cols=' + r.stats.colliders + ' plats=' + r.stats.platforms + ' doors=' + r.stats.doors);
}
writeDims(meta);
writeGroups();
console.log('[import] 完成：' + Object.keys(meta).length + ' 个建筑 → models/buildings/');
