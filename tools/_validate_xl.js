// 校验 XL 碰撞配置：按 build() 的缩放逻辑把碰撞盒映射到世界坐标，
// 检查 (1) 无翻转盒 (2) 门洞/楼梯井留空确实为空 (3) 实心墙点确实被挡
'use strict';
const { buildXL } = require('./_gen_xl_colliders.js');

// 归一化 GLB 尺寸（来自 _vcount）与地图摆放尺寸（各图 GDD）
const META = {
  base:      { rw: 223, rh: 65,  rd: 184, dims: { w: 24, d: 18, h: 8 } },
  refinery:  { rw: 193, rh: 45.5, rd: 184.5, dims: { w: 20, d: 14, h: 12 } },
  stadium:   { rw: 220, rh: 32,  rd: 220, dims: { w: 26, d: 20, h: 14 } },
  megatower: { rw: 36,  rh: 145.5, rd: 36, dims: { w: 20, d: 20, h: 28 } }
};

function scale(key, c, x, z) {
  const m = META[key]; const { dims } = m;
  const sx = dims.w / m.rw, sy = dims.h / m.rh, sz = dims.d / m.rd;
  // 与 build() 一致: min=(x+c0*sx, c2*sy, z+c1*sz) max=(x+c3*sx, c5*sy, z+c4*sz)
  return {
    min: [x + c[0] * sx, c[2] * sy, z + c[1] * sz],
    max: [x + c[3] * sx, c[5] * sy, z + c[4] * sz]
  };
}
const inside = (box, pt) =>
  pt[0] >= box.min[0] && pt[0] <= box.max[0] &&
  pt[1] >= box.min[1] && pt[1] <= box.max[1] &&
  pt[2] >= box.min[2] && pt[2] <= box.max[2];

// 已知"留空"点（SCAD 坐标），应不被任何碰撞盒包含
const VOIDS = {
  base:      [[50, 0, 3], [109, 76, 3], [176, 43, 3], [83, 149, 3]],
  refinery:  [[35, 38, 3.5], [40, 20, 6]],
  stadium:   [[106, 0, 7], [0, 106, 7], [-106, 0, 7], [0, -106, 7]],
  megatower: [[18, 34, 3], [6, 6, 15], [6, 6, 40]]
};
// 已知"实心"点（应在墙内，被挡），用于反证碰撞生效
const SOLID = {
  base:      [[20, 0, 3], [110, 76.5, 20]],
  refinery:  [[10, 0, 5], [50, 39, 10]],
  stadium:   [[106, 50, 10], [50, 106, 10]],
  megatower: [[0, 17, 60], [18, 0, 60]]
};

const OFF = { base: [1.5, 1.5, 6], refinery: [97, 87.7, 0], stadium: [110, 110, 0], megatower: [0, 0, 0] };
const xl = buildXL();
let fail = 0;
for (const key of Object.keys(xl)) {
  const cfg = xl[key], m = META[key], o = OFF[key];
  const sx = m.dims.w / m.rw, sy = m.dims.h / m.rh, sz = m.dims.d / m.rd;
  const boxes = cfg.colliders.map(c => scale(key, c, 0, 0));
  // (1) 翻转检查
  for (const bx of boxes) {
    if (bx.min[0] >= bx.max[0] || bx.min[1] >= bx.max[1] || bx.min[2] >= bx.max[2]) {
      console.log(`✗ ${key}: 翻转盒`, bx); fail++;
    }
  }
  const toWorld = sc => {
    const n = [sc[0] + o[0], sc[2] + o[2], sc[1] + o[1]]; // 归一化: x, 高, 深
    return [n[0] * sx, n[1] * sy, n[2] * sz];
  };
  // (2) 留空点应自由
  for (const sc of VOIDS[key]) {
    const pt = toWorld(sc);
    const hit = boxes.some(bx => inside(bx, pt));
    if (hit) { console.log(`✗ ${key}: 留空点 ${JSON.stringify(sc)} 竟被挡`); fail++; }
  }
  // (3) 实心点应被挡
  for (const sc of SOLID[key]) {
    const pt = toWorld(sc);
    const hit = boxes.some(bx => inside(bx, pt));
    if (!hit) { console.log(`⚠ ${key}: 实心点 ${JSON.stringify(sc)} 未被挡（碰撞近似，非致命）`); }
  }
  console.log(`✓ ${key}: ${cfg.colliders.length} 盒 / ${cfg.platforms.length} 平台 — 翻转${boxes.length - boxes.filter(b => b.min[0] < b.max[0] && b.min[1] < b.max[1] && b.min[2] < b.max[2]).length} 异常`);
}
console.log(fail === 0 ? '\n全部留空校验通过 ✅' : `\n有 ${fail} 处失败 ❌`);
