// GLB → 内联数据转换（丢弃贴图/材质，保留几何：POSITION/NORMAL/UV/INDEX → base64）
// 用法: node tools/glb2data.js <in.glb> <key> [out.js] [flipX=1]
// flipX=1: 沿 X 镜像（SCAD +X=枪口 的武器统一为"长轴正端=枪托"约定；镜像自动翻转法线X与索引绕序）
// 输出: window.WEAPONS_DATA = { <key>: {pos,nor,uv,idx} }
'use strict';
const fs = require('fs');
const [,, inPath, key, outPath, flipX] = process.argv;
if (!inPath || !key) { console.error('用法: node tools/glb2data.js <in.glb> <key> [out.js] [flipX=1]'); process.exit(1); }
const OUT = outPath || 'models/weapons_data.js';
const FLIP_X = flipX === '1';

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
// 三角形列表法线（flat）：每三角形叉积归一化，赋给三个顶点
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
// 合并所有 mesh/primitive
const allPos = [], allNor = [], allUv = [], allIdx = [];
let vOff = 0, triN = 0;
for (const m of json.meshes) for (const p of m.primitives) {
  let pos = readAcc(p.attributes.POSITION);
  if (!pos) { console.warn('mesh 无 POSITION，跳过'); continue; }
  let nor = readAcc(p.attributes.NORMAL);
  let uv = readAcc(p.attributes.TEXCOORD_0);
  let idx;
  if (p.indices !== undefined && p.indices !== null) {
    idx = readAcc(p.indices).map(v => v[0]);
  } else {
    // 非索引模式：顶点顺序即三角形
    idx = pos.map((_, i) => i);
  }
  // 补缺失数据
  if (!nor) nor = computeNormals(pos);
  if (!uv) uv = pos.map(() => [0, 0]);
  idx = idx.map(v => v + vOff);
  if (FLIP_X) {
    // 沿 X 镜像：pos.x / nor.x 取反
    pos = pos.map(v => [-v[0], v[1], v[2]]);
    nor = nor.map(v => [-v[0], v[1], v[2]]);
    // 绕序修正：镜像翻转三角形朝向，需交换每三角形首尾（v0↔v2）
    if (p.indices !== undefined && p.indices !== null) {
      for (let t = 0; t < idx.length; t += 3) { const a = idx[t]; idx[t] = idx[t + 2]; idx[t + 2] = a; }
    } else {
      for (let t = 0; t < pos.length; t += 3) { const a = pos[t]; pos[t] = pos[t + 2]; pos[t + 2] = a; }
      const n2 = nor.map(v => v.slice());
      for (let t = 0; t < nor.length; t += 3) { const a = nor[t]; nor[t] = nor[t + 2]; nor[t + 2] = a; }
    }
  }
  allPos.push(...pos); allNor.push(...nor); allUv.push(...uv); allIdx.push(...idx);
  vOff += pos.length; triN += idx.length / 3;
}
console.log(key, '| 顶点', allPos.length, '| 三角形', triN);
const b64F32 = arr => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
const b64U16 = arr => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b.toString('base64'); };
const entry = { pos: b64F32(allPos.flat()), nor: b64F32(allNor.flat()), uv: b64F32(allUv.flat()), idx: b64U16(allIdx) };
// 追加到输出文件
let existing = '';
try { existing = fs.readFileSync(OUT, 'utf8'); } catch (e) { }
const data = existing.includes('window.WEAPONS_DATA')
  ? existing.replace(/window\.WEAPONS_DATA\s*=\s*\{/, 'window.WEAPONS_DATA = { ' + key + ': ' + JSON.stringify(entry) + ',')
  : '// 由 tools/glb2data.js 自动生成：武器模型内联数据（base64 Float32/Uint16）\nwindow.WEAPONS_DATA = { ' + key + ': ' + JSON.stringify(entry) + ' };\n';
fs.writeFileSync(OUT, data);
console.log('写入', OUT, '(' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)');
