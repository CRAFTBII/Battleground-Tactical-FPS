// 探测 soldier.glb 顶点分布：决定切割阈值（y 分头/躯干/腿，x 分左右臂）
'use strict';
const fs = require('fs');
const buf = fs.readFileSync('models/soldier.glb');
let off = 12, json = null, bin = null;
while (off < buf.length) {
  const len = buf.readUInt32LE(off), type = buf.toString('ascii', off + 4, off + 8);
  if (type === 'JSON') json = JSON.parse(buf.slice(off + 8, off + 8 + len).toString());
  else if (type === 'BIN\0') bin = buf.slice(off + 8, off + 8 + len);
  off += 8 + len;
}
const mesh = json.meshes[0], prim = mesh.primitives[0];
const acc = json.accessors;
const readAcc = id => {
  const a = acc[id], bv = json.bufferViews[a.bufferView];
  const data = bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  const cnt = a.count, stride = bv.byteStride || (a.componentType === 5126 ? 4 : 2) * { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const comp = a.componentType === 5126 ? 'f32' : 'u16';
  const out = [];
  for (let i = 0; i < cnt; i++) {
    const o = i * stride;
    const v = [];
    for (let c = 0; c < { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type]; c++) v.push(data.readFloatLE(o + c * 4));
    out.push(v);
  }
  return out;
};
const pos = readAcc(prim.attributes.POSITION);
console.log('顶点总数:', pos.length);
let minY = 1e9, maxY = -1e9, minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
const yBuckets = {}, xBuckets = {};
for (const p of pos) {
  if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
  if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
}
console.log('包围盒: x[' + minX.toFixed(2) + ',' + maxX.toFixed(2) + '] y[' + minY.toFixed(2) + ',' + maxY.toFixed(2) + '] z[' + minZ.toFixed(2) + ',' + maxZ.toFixed(2) + ']');
// y 直方图（10 桶）
for (const p of pos) {
  const b = Math.floor((p[1] - minY) / (maxY - minY) * 10);
  yBuckets[b] = (yBuckets[b] || 0) + 1;
}
console.log('y 直方图(0=脚底,10=头顶):', JSON.stringify(yBuckets));
// x 直方图（左右）
for (const p of pos) {
  const b = Math.floor((p[0] - minX) / (maxX - minX) * 8);
  xBuckets[b] = (xBuckets[b] || 0) + 1;
}
console.log('x 直方图(0=左,8=右):', JSON.stringify(xBuckets));
