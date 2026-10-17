// 切割 soldier.glb：按空间位置分成 头/躯干/左臂/右臂/左腿/右腿 6 部件
// 每部件几何以关节为原点（pivot），输出无贴图单色 GLB（游戏侧做关节动画）
// 用法: node tools/split-glb.js
'use strict';
const fs = require('fs');

const buf = fs.readFileSync('assets/soldier/soldier.glb');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
  if (type === 'JSON') json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString());
  else if (type === 'BIN\0') bin = buf.slice(off + 8, off + 8 + len);
  off += 8 + len;
}
const VT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const compBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const compRead = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
function readAccessor(json, bin, accId, compCount) {
  const a = json.accessors[accId];
  const bv = json.bufferViews[a.bufferView];
  const stride = bv.byteStride || compBytes[a.componentType] * (compCount || VT[a.type]);
  const out = [];
  for (let i = 0; i < a.count; i++) {
    const o = (bv.byteOffset || 0) + i * stride;
    const v = [];
    for (let c = 0; c < VT[a.type]; c++) v.push(bin[compRead[a.componentType]](o + c * compBytes[a.componentType]));
    out.push(v);
  }
  return out;
}
const prim = json.meshes[0].primitives[0];
const pos = readAccessor(json, bin, prim.attributes.POSITION, 3);
const nor = readAccessor(json, bin, prim.attributes.NORMAL, 3);
const uv = readAccessor(json, bin, prim.attributes.TEXCOORD_0, 2);
const idx = readAccessor(json, bin, prim.indices, 1).map(v => v[0]);
console.log('原始: 顶点', pos.length, '索引', idx.length);

// ---- 部件定义（v2：轴向修正——模型脚在 +z、头在 -z；枪=右侧前伸簇；每部件独立颜色） ----
const PARTS = [
  { name: 'torso', pivot: [0, 0, 0],        color: [0.29, 0.35, 0.23] },  // 军绿
  { name: 'head',  pivot: [0, 0, -0.62],    color: [0.62, 0.56, 0.44] },  // 沙色
  { name: 'armL',  pivot: [-0.21, 0, -0.3], color: [0.23, 0.28, 0.19] },  // 深军绿
  { name: 'armR',  pivot: [0.21, 0, -0.3],  color: [0.23, 0.28, 0.19] },
  { name: 'legL',  pivot: [-0.11, 0, 0.2],  color: [0.23, 0.28, 0.31] },  // 蓝灰
  { name: 'legR',  pivot: [0.11, 0, 0.2],   color: [0.23, 0.28, 0.31] },
  { name: 'gun',   pivot: [0.32, 0.3, -0.1], parent: 'armR', rel: [0.11, 0.3, 0.2], color: [0.33, 0.34, 0.38] } // 金属灰（提亮便于可见），挂 armR 下随臂摆动
];
const classify = p => {
  if (p[2] < -0.62) return 'head';
  if (p[2] > 0.12) return p[0] < 0 ? 'legL' : 'legR';
  if (p[1] > 0.42 && p[0] > 0.15) return 'gun'; // 右侧前伸簇 = 持枪手 + 枪
  return Math.abs(p[0]) > 0.17 ? (p[0] < 0 ? 'armL' : 'armR') : 'torso';
};

// ---- 三角形级切割：按三角形质心归类（顶点级会拆散三角形 → 部件稀烂成线） ----
const triGroups = Object.fromEntries(PARTS.map(q => [q.name, []])); // 每部件: [i0,i1,i2,...]
let triTotal = 0;
for (let t = 0; t + 2 < idx.length; t += 3) {
  const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
  // 三角形质心
  const cx = (pos[i0][0] + pos[i1][0] + pos[i2][0]) / 3;
  const cy = (pos[i0][1] + pos[i1][1] + pos[i2][1]) / 3;
  const cz = (pos[i0][2] + pos[i1][2] + pos[i2][2]) / 3;
  triGroups[classify([cx, cy, cz])].push(i0, i1, i2);
  triTotal++;
}
console.log('三角形归属:', Object.fromEntries(Object.entries(triGroups).map(([k, v]) => [k, v.length / 3])), '| 总计', triTotal, '三角形');

// ---- 重建每部件几何（顶点减 pivot）+ 索引重映射 ----
const parts = [];
for (const p of PARTS) {
  const tris = triGroups[p.name];
  const vmap = new Map();
  const nPos = [], nNor = [], nUv = [], nIdx = [];
  const pk = p.pivot;
  for (const oi of tris) {
    if (!vmap.has(oi)) {
      vmap.set(oi, nPos.length);
      nPos.push([pos[oi][0] - pk[0], pos[oi][1] - pk[1], pos[oi][2] - pk[2]]);
      nNor.push(nor[oi]);
      nUv.push(uv[oi]);
    }
    nIdx.push(vmap.get(oi));
  }
  parts.push({ ...p, pivot: pk, pos: nPos, nor: nNor, uv: nUv, idx: nIdx }); // 保留 color/parent/rel 等定义字段
  console.log(p.name, '顶点', nPos.length, '三角形', nIdx.length / 3, 'pivot', pk.join(','));
}

// ---- 输出新 GLB（每部件独立颜色材质，无纹理） ----
const f32 = arr => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b; };
const u16 = arr => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b; };
let bvOffset = 0;
const bufferViews = [], accessors = [], meshes = [], nodes = [];
const BIN = [];
const addAccessor = (type, data, isIndex) => {
  const aligned = (bvOffset + 3) & ~3;
  if (aligned > bvOffset) { BIN.push(Buffer.alloc(aligned - bvOffset)); bvOffset = aligned; }
  bufferViews.push({ buffer: 0, byteOffset: bvOffset, byteLength: data.length });
  const compCount = VT[type];
  const a = { bufferView: bufferViews.length - 1, componentType: isIndex ? 5123 : 5126, count: data.length / (isIndex ? 2 : 4) / compCount, type };
  accessors.push(a);
  BIN.push(data);
  bvOffset += data.length;
  return accessors.length - 1;
};
const materials = [];
parts.forEach((p, i) => {
  const pA = addAccessor('VEC3', f32(p.pos.flat()));
  const nA = addAccessor('VEC3', f32(p.nor.flat()));
  const uA = addAccessor('VEC2', f32(p.uv.flat()));
  const iA = addAccessor('SCALAR', u16(p.idx), true);
  materials.push({ name: p.name, pbrMetallicRoughness: { baseColorFactor: [...p.color, 1], roughnessFactor: 0.85, metallicFactor: 0.05 } });
  meshes.push({ primitives: [{ attributes: { POSITION: pA, NORMAL: nA, TEXCOORD_0: uA }, indices: iA, material: i }] });
  nodes.push({ name: p.name, mesh: i, translation: p.rel || p.pivot });
});
// 父子层级（gun 挂 armR 下，摆臂时枪跟随）
const childrenMap = {};
parts.forEach((p, i) => { if (p.parent) { childrenMap[p.parent] = childrenMap[p.parent] || []; childrenMap[p.parent].push(i); } });
nodes.forEach((n, i) => { if (childrenMap[n.name]) n.children = childrenMap[n.name]; });
const sceneNode = nodes.length; // 根节点
nodes.push({ name: 'soldier', children: parts.map((_, i) => i) });
const jsonOut = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [sceneNode] }],
  nodes,
  meshes,
  materials,
  buffers: [{ byteLength: bvOffset }],
  bufferViews,
  accessors
};
const jsonBuf = Buffer.from(JSON.stringify(jsonOut));
const binBuf = Buffer.concat(BIN);
const pad4 = n => (n + 3) & ~3;
const jp = pad4(jsonBuf.length), bp = pad4(binBuf.length);
const out = Buffer.alloc(12 + 8 + jp + 8 + bp);
out.writeUInt32LE(0x46546C67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(jp, 12); out.write('JSON', 16); jsonBuf.copy(out, 20);
out.fill(0x20, 20 + jsonBuf.length, 20 + jp); // JSON chunk 填充必须是空格
out.writeUInt32LE(bp, 20 + jp); out.write('BIN\0', 24 + jp); binBuf.copy(out, 28 + jp);
fs.writeFileSync('assets/soldier/soldier_parts.glb', out);
console.log('输出 assets/soldier/soldier_parts.glb', (out.length / 1024).toFixed(0), 'KB');

// ---- 输出内联数据文件（file:// 双击可用：无 fetch/ESM，base64 编码） ----
const b64F32 = arr => { const b = Buffer.alloc(arr.length * 4); arr.forEach((v, i) => b.writeFloatLE(v, i * 4)); return b.toString('base64'); };
const b64U16 = arr => { const b = Buffer.alloc(arr.length * 2); arr.forEach((v, i) => b.writeUInt16LE(v, i * 2)); return b.toString('base64'); };
const dataParts = parts.map(p => ({
  name: p.name, pivot: p.pivot, rel: p.rel || null, parent: p.parent || null, color: p.color,
  pos: b64F32(p.pos.flat()), nor: b64F32(p.nor.flat()), uv: b64F32(p.uv.flat()), idx: b64U16(p.idx)
}));
fs.writeFileSync('models/soldier_data.js',
  '// 由 tools/split-glb.js 自动生成：切割士兵部件内联数据（base64 编码 Float32/Uint16，可 file:// 双击运行）\n' +
  'window.SOLDIER_DATA = ' + JSON.stringify(dataParts) + ';\n');
console.log('输出 models/soldier_data.js (' + (fs.statSync('models/soldier_data.js').size / 1024).toFixed(0) + ' KB)');
