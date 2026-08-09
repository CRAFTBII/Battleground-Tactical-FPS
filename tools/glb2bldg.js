// 建筑 GLB → 内联数据（丢弃 UV，保留 POSITION/NORMAL/INDEX + 按 SCAD 部件规则生成顶点色）
// 用法: node tools/glb2bldg.js <in.glb> <key> [out.js]
// 输出: window.BUILDINGS_DATA = { <key>: {pos,nor,col,idx} }
'use strict';
const fs = require('fs');
const [,, inPath, key, outPath] = process.argv;
if (!inPath || !key) { console.error('用法: node tools/glb2bldg.js <in.glb> <key> [out.js]'); process.exit(1); }
const OUT = outPath || 'models/buildings_data.js';

/* ============ 建筑部件颜色规则（源自 SCAD 源码 color()） ============
   每规则: { y0, y1, r, g, b, x0?, x1?, z0?, z1? } —— 三角形质心满足 y∈[y0,y1)（及可选 x/z 范围）则用该色
   顺序匹配，先命中先用；都不中 = 默认色 */
const COLOR_RULES = {
  apartment: { // 米灰墙体 + 深灰楼板 + 灰屋顶
    default: [0.80, 0.79, 0.76],
    rules: [
      { y0: 3.85, y1: 4.15, c: [0.70, 0.70, 0.68] },
      { y0: 7.85, y1: 8.15, c: [0.70, 0.70, 0.68] },
      { y0: 11.85, y1: 12.15, c: [0.70, 0.70, 0.68] },
      { y0: 15.9, y1: 99, c: [0.66, 0.66, 0.64] }
    ]
  },
  house: { // 米黄墙体 + 红棕人字屋顶
    default: [0.82, 0.78, 0.70],
    rules: [
      { y0: 3.9, y1: 99, c: [0.55, 0.32, 0.28] }
    ]
  },
  warehouse: { // 灰墙 + 深灰屋顶
    default: [0.66, 0.64, 0.60],
    rules: [
      { y0: 7.9, y1: 99, c: [0.55, 0.53, 0.50] }
    ]
  },
  watchtower: { // 木腿 + 灰平台 + 深红屋顶
    default: [0.45, 0.35, 0.25],
    rules: [
      { y0: 6.9, y1: 7.5, c: [0.70, 0.70, 0.68] },
      { y0: 8.3, y1: 99, c: [0.50, 0.30, 0.26] }
    ]
  },
  cover: { // 集装箱红 / 沙袋米 / 路障灰 / 木箱棕（按 y 分层近似）
    default: [0.62, 0.30, 0.24],
    rules: [
      { y0: 2.55, y1: 3.0, c: [0.30, 0.30, 0.32] },  // 集装箱顶
      { y0: 0.0, y1: 0.55, x0: -9, x1: 99, c: [0.74, 0.68, 0.52] }, // 沙袋（矮层）
      { y0: 0.8, y1: 1.4, c: [0.80, 0.80, 0.78] },   // 路障
      { y0: 1.0, y1: 2.0, x0: 6.5, x1: 99, c: [0.55, 0.40, 0.26] } // 木箱（中右区）
    ]
  }
};

const buf = fs.readFileSync(inPath);
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
  if (type === 'JSON') json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString());
  else if (type === 'BIN\0') bin = buf.slice(off + 8, off + 8 + len);
  off += 8 + len;
}
const CB = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const CR = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
const VT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readAcc(accId) {
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
// 三角形质心匹配颜色规则
function colorize(pos) {
  const spec = COLOR_RULES[key];
  if (!spec) return pos.map(() => [0.7, 0.7, 0.7]);
  const col = new Array(pos.length).fill(null);
  for (let t = 0; t + 2 < pos.length; t += 3) {
    const cx = (pos[t][0] + pos[t + 1][0] + pos[t + 2][0]) / 3;
    const cy = (pos[t][1] + pos[t + 1][1] + pos[t + 2][1]) / 3;
    const cz = (pos[t][2] + pos[t + 1][2] + pos[t + 2][2]) / 3;
    let c = spec.default;
    for (const r of spec.rules) {
      if (cy >= r.y0 && cy < r.y1 &&
        (r.x0 === undefined || cx >= r.x0) && (r.x1 === undefined || cx < r.x1) &&
        (r.z0 === undefined || cz >= r.z0) && (r.z1 === undefined || cz < r.z1)) { c = r.c; break; }
    }
    for (let k = 0; k < 3; k++) col[t + k] = c;
  }
  return col;
}

const allPos = [], allNor = [], allCol = [], allIdx = [];
let vOff = 0, triN = 0;
for (const m of json.meshes) for (const p of m.primitives) {
  const pos = readAcc(p.attributes.POSITION);
  if (!pos) { console.warn('mesh 无 POSITION，跳过'); continue; }
  const nor = readAcc(p.attributes.NORMAL) || computeNormals(pos);
  const col = colorize(pos);
  let idx;
  if (p.indices !== undefined && p.indices !== null) idx = readAcc(p.indices).map(v => v[0]);
  else idx = pos.map((_, i) => i);
  idx = idx.map(v => v + vOff);
  allPos.push(...pos); allNor.push(...nor); allCol.push(...col); allIdx.push(...idx);
  vOff += pos.length; triN += idx.length / 3;
}
console.log(key, '| 顶点', allPos.length, '| 三角形', triN);
const b64F32 = arr => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
const b64U16 = arr => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b.toString('base64'); };
const entry = { pos: b64F32(allPos.flat()), nor: b64F32(allNor.flat()), col: b64F32(allCol.flat()), idx: b64U16(allIdx) };
let existing = '';
try { existing = fs.readFileSync(OUT, 'utf8'); } catch (e) { }
const data = existing.includes('window.BUILDINGS_DATA')
  ? existing.replace(/window\.BUILDINGS_DATA\s*=\s*\{/, 'window.BUILDINGS_DATA = { ' + key + ': ' + JSON.stringify(entry) + ',')
  : '// 由 tools/glb2bldg.js 自动生成：建筑模型内联数据（base64 + 顶点色）\nwindow.BUILDINGS_DATA = { ' + key + ': ' + JSON.stringify(entry) + ' };\n';
fs.writeFileSync(OUT, data);
console.log('写入', OUT, '(' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
