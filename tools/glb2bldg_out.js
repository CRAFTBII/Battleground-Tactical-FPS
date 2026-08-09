// models/out → 内联建筑数据（丢弃贴图/材质，保留 POSITION/NORMAL/INDEX + 按类型生成顶点色）
// 用法: node tools/glb2bldg_out.js
// 输出: models/buildings_out.js → window.BUILDINGS_OUT = { <key>: {pos,nor,col,idx} }
// 与 tools/glb2bldg.js 同范式：几何 base64 内联，离线 file:// 可玩（无 fetch）。
// 处理 13 个类型（9 个既有 + v1.4 四地标 base/refinery/stadium/megatower）；
// 旧 5 型（apartment/house/warehouse/watchtower/cover）已在 models/buildings_data.js，不重复内联。
// 归一化：每类型几何平移到角点原点（min=(0,0,0)），与 BuildingLib.CONFIGS「x[0,w] y[0,d] z[0,h]」约定对齐。
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = 'models/buildings_out.js';
// v1.5：按顺序在多个目录里找 battle_<key>.glb —— 早期 9 型编译产物归档在 out/done，
// 只扫 models/out 会静默丢掉它们（→ 游戏里退化成占位实心盒，bridge/stairs 变实心墙）。
const SRC_DIRS = ['models/out', 'models/out/done'];
// 新增类型 → 源文件名（无该文件则跳过并告警）
const KEYS = ['bunker', 'hangar', 'pillbox', 'tower', 'wall', 'bridge', 'stairs', 'container', 'ruins',
  'base', 'refinery', 'stadium', 'megatower',
  // v1.7 程序化主题建筑（SCAD 源文件在 models/source/，用户编译后自动接入）
  'crane', 'tankH', 'tankV', 'mast', 'guardhouse',
  // v1.8 超大型综合体（models/source/battle_complex.scad）
  'complex'];
function findSrc(key) {
  for (const dir of SRC_DIRS) {
    const f = path.join(dir, 'battle_' + key + '.glb');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/* ============ 顶点色规则（无 SCAD 源码色 → 按类型基色 + 高度带近似）
   规则: { base:[r,g,b], roof:[r,g,b], roofY?: 三角形质心 y >= roofY 用 roof 色（缺省 = 最大高 × 0.9） } */
const PALETTE = {
  bunker:    { base: [0.44, 0.46, 0.41], roof: [0.37, 0.39, 0.35] },  // 橄榄灰混凝土
  hangar:    { base: [0.50, 0.52, 0.56], roof: [0.42, 0.44, 0.48] },  // 钢架蓝灰
  pillbox:   { base: [0.42, 0.44, 0.40], roof: [0.36, 0.38, 0.34] },  // 野战灰
  tower:     { base: [0.34, 0.36, 0.41], roof: [0.29, 0.31, 0.35] },  // 钢结构深蓝灰
  wall:      { base: [0.47, 0.45, 0.41], roof: [0.40, 0.38, 0.34] },  // 混凝土围墙
  bridge:    { base: [0.43, 0.45, 0.49], roof: [0.37, 0.39, 0.43] },  // 桥面钢灰
  stairs:    { base: [0.51, 0.49, 0.45], roof: [0.44, 0.42, 0.38] },  // 石阶米灰
  container: { base: [0.40, 0.30, 0.22], roof: [0.32, 0.24, 0.18] },  // 集装箱橙棕
  ruins:     { base: [0.40, 0.38, 0.34], roof: [0.33, 0.31, 0.28] },  // 残垣土灰
  // v1.4 四地标（各图 GDD §4.8 主题色）
  base:      { base: [0.72, 0.62, 0.44], roof: [0.60, 0.52, 0.38] },  // 前哨基地（desert 土坯黄）
  refinery:  { base: [0.42, 0.46, 0.50], roof: [0.35, 0.38, 0.42] },  // 炼油厂（port 冷灰蓝）
  stadium:   { base: [0.55, 0.55, 0.55], roof: [0.46, 0.46, 0.48] },  // 竞技场（suburb 中性灰）
  megatower: { base: [0.48, 0.42, 0.34], roof: [0.40, 0.35, 0.28] },   // 巨塔（desert 沙棕）
  // v1.7 程序化主题建筑（与地图 tint 协调；SCAD 自带 color 也会被这里统一上色）
  crane:     { base: [0.55, 0.42, 0.30], roof: [0.65, 0.55, 0.38] },  // 龙门吊（port 锈橙 + 梁黄）
  tankH:     { base: [0.60, 0.54, 0.45], roof: [0.68, 0.62, 0.52] },  // 卧式油罐（冷灰黄罐体）
  tankV:     { base: [0.62, 0.56, 0.47], roof: [0.70, 0.64, 0.54] },  // 立式油罐
  mast:      { base: [0.45, 0.40, 0.36], roof: [0.50, 0.46, 0.40] },  // 天线塔（钢灰桁架）
  guardhouse:{ base: [0.70, 0.66, 0.58], roof: [0.55, 0.40, 0.34] },  // 岗亭（灰白墙 + 红褐顶）
  complex:   { base: [0.60, 0.62, 0.66], roof: [0.48, 0.50, 0.54] }   // 综合体（desert 混凝土灰）
};

/* ---- GLB 解析（与 glb2bldg.js 同实现） ---- */
const CB = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const CR = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
const VT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function parseGlb(file) {
  const buf = fs.readFileSync(file);
  let off = 12, json = null, bin = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
    if (type === 'JSON') json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString());
    else if (type === 'BIN\0') bin = buf.slice(off + 8, off + 8 + len);
    off += 8 + len;
  }
  if (!json || !bin) throw new Error('GLB 无 JSON/BIN');
  return { json, bin };
}
function readAcc(json, bin, accId) {
  if (accId === undefined || accId === null) return null;
  const a = json.accessors[accId];
  if (!a || a.bufferView === undefined) return null;
  const bv = json.bufferViews[a.bufferView];
  const stride = bv.byteStride || CB[a.componentType] * VT[a.type], o = (bv.byteOffset || 0);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const v = [];
    for (let c = 0; c < VT[a.type]; c++) v.push(bin[CR[a.componentType]](o + i * stride + c * CB[a.componentType]));
    out.push(v);
  }
  return out;
}
function computeNormals(pos) {
  const n = new Array(pos.length).fill(null).map(() => [0, 0, 0]);
  for (let t = 0; t + 2 < pos.length; t += 3) {
    const a = pos[t], b = pos[t + 1], c = pos[t + 2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 3; k++) { n[t + k][0] = nx; n[t + k][1] = ny; n[t + k][2] = nz; }
  }
  return n;
}
function colorize(pos, spec) {
  // 先算最大高（z 轴 = 建筑高，与 BUILDINGS_DATA 约定一致）
  let maxZ = 0;
  for (const v of pos) if (v[2] > maxZ) maxZ = v[2];
  const roofY = spec.roofY !== undefined ? spec.roofY : maxZ * 0.9;
  const col = new Array(pos.length).fill(null);
  for (let t = 0; t + 2 < pos.length; t += 3) {
    const cz = (pos[t][2] + pos[t + 1][2] + pos[t + 2][2]) / 3;
    // 轻微高度抖动（±0.01）避免大面积纯色死板
    const c = cz >= roofY ? spec.roof : spec.base;
    for (let k = 0; k < 3; k++) col[t + k] = c;
  }
  return col;
}

/* ---- 逐类型转换（v1.4：先读全部 primitive → 计算全局 bbox → 平移到角点原点） ---- */
const outData = {};
let totalTri = 0;
const dimReport = {};
for (const key of KEYS) {
  const file = findSrc(key);
  if (!file) { console.warn('[glb2bldg_out] 缺源文件: battle_' + key + '.glb（已找过 ' + SRC_DIRS.join(', ') + '），跳过 ' + key); continue; }
  const { json, bin } = parseGlb(file);
  const spec = PALETTE[key] || { base: [0.7, 0.7, 0.7], roof: [0.6, 0.6, 0.6] };
  const prims = [];
  for (const m of json.meshes) for (const p of m.primitives) {
    const pos = readAcc(json, bin, p.attributes.POSITION);
    if (!pos) { console.warn('mesh 无 POSITION，跳过'); continue; }
    const nor = readAcc(json, bin, p.attributes.NORMAL) || computeNormals(pos);
    let idx;
    if (p.indices !== undefined && p.indices !== null) idx = readAcc(json, bin, p.indices).map(v => v[0]);
    else idx = pos.map((_, i) => i);
    prims.push({ pos, nor, idx });
  }
  if (!prims.length) { console.warn('[glb2bldg_out] ' + key + ' 无几何，跳过'); continue; }
  // 归一化：全局 min → (0,0,0)，与 CONFIGS「x[0,w] y[0,d] z[0,h]」约定一致（placeModelBuilding D-04 对齐）
  let mn = [1e9, 1e9, 1e9];
  for (const pr of prims) for (const v of pr.pos) for (let c = 0; c < 3; c++) if (v[c] < mn[c]) mn[c] = v[c];
  const allPos = [], allNor = [], allCol = [], allIdx = [];
  let vOff = 0, triN = 0;
  for (const pr of prims) {
    const pos = pr.pos.map(v => [v[0] - mn[0], v[1] - mn[1], v[2] - mn[2]]);
    const nor = pr.nor, idx = pr.idx;
    const col = colorize(pos, spec);
    const idx2 = idx.map(v => v + vOff);
    allPos.push(...pos); allNor.push(...nor); allCol.push(...col); allIdx.push(...idx2);
    vOff += pos.length; triN += idx.length / 3;
  }
  totalTri += triN;
  const b64F32 = arr => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
  const b64U16 = arr => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b.toString('base64'); };
  outData[key] = { pos: b64F32(allPos.flat()), nor: b64F32(allNor.flat()), col: b64F32(allCol.flat()), idx: b64U16(allIdx) };
  // 真实归一化尺寸（模型系：x=宽 y=深 z=高）—— 地图 w/d/h 必须与此等比，否则 build() 会拉伸畸变
  let mx = [0, 0, 0];
  for (const v of allPos) for (let c = 0; c < 3; c++) if (v[c] > mx[c]) mx[c] = v[c];
  dimReport[key] = { w: +mx[0].toFixed(2), d: +mx[1].toFixed(2), h: +mx[2].toFixed(2) };
  console.log(key.padEnd(12), '| 顶点', String(allPos.length).padStart(5), '| 三角形', String(triN).padStart(5),
    '| 真实 w×d×h =', mx[0].toFixed(1) + '×' + mx[1].toFixed(1) + '×' + mx[2].toFixed(1), '| 源', file);
}

/* ---- 输出 ---- */
const jsonOut = '// 由 tools/glb2bldg_out.js 自动生成：models/out 新增建筑类型内联数据（base64 Float32/Uint16 + 顶点色）\n' +
  '// 离线 file:// 可用（无 fetch）；与 BUILDINGS_DATA 同格式，BuildingLib 优先取用\n' +
  'window.BUILDINGS_OUT = ' + JSON.stringify(outData) + ';\n';
fs.writeFileSync(OUT, jsonOut);
// 真实尺寸清单：地图 w/d/h 校验 / 生成的唯一事实来源
fs.writeFileSync('models/buildings_dims.json', JSON.stringify(dimReport, null, 2) + '\n');
console.log('写入', OUT, '(' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB) | 类型', Object.keys(outData).length, '| 总三角形', totalTri);
console.log('写入 models/buildings_dims.json（真实尺寸清单，供地图 w/d/h 校验）');
