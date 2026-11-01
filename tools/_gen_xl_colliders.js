// 生成 XL 四地标碰撞留空配置并落地进 js/models.js 的 BuildingLib.CONFIGS
// 用法: node tools/_gen_xl_colliders.js   (同时打印并写回 models.js)
'use strict';
const fs = require('fs');
const path = require('path');

// 每建筑 GLB 归一化偏移 = -rawGLB_min (glb2bldg_out.js 把几何平移到角点)
const OFF = {
  base:      [1.5, 1.5, 6],
  refinery:  [97, 87.7, 0],
  stadium:   [110, 110, 0],
  megatower: [0, 0, 0]
};
const b = (o, x0, y0, z0, x1, y1, z1) =>
  [x0 + o[0], y0 + o[1], z0 + o[2], x1 + o[0], y1 + o[1], z1 + o[2]];
const p = (o, x0, y0, x1, y1, y) =>
  ({ x0: x0 + o[0], x1: x1 + o[0], y0: y0 + o[1], y1: y1 + o[1], y: y + o[2] });

function wallX(o, x0, x1, t, y0, z0, h, door, doorH) {
  const y1 = y0 + t, z1 = z0 + h;
  if (!door) return [b(o, x0, y0, z0, x1, y1, z1)];
  const [d0, d1] = door;
  return [b(o, x0, y0, z0, d0, y1, z1), b(o, d1, y0, z0, x1, y1, z1), b(o, d0, y0, z0 + doorH, d1, y1, z1)];
}
function wallY(o, y0, y1, t, x0, z0, h, door, doorH) {
  const x1 = x0 + t, z1 = z0 + h;
  if (!door) return [b(o, x0, y0, z0, x1, y1, z1)];
  const [d0, d1] = door;
  return [b(o, x0, y0, z0, x1, d0, z1), b(o, x0, d1, z0, x1, y1, z1), b(o, x0, d0, z0 + doorH, x1, d1, z1)];
}
function slab(o, x0, y0, x1, y1, z0, z1, hole) {
  if (!hole) return [b(o, x0, y0, z0, x1, y1, z1)];
  const [hx0, hy0, hx1, hy1] = hole;
  return [
    b(o, x0, y0, z0, hx0, y1, z1),
    b(o, hx1, y0, z0, x1, y1, z1),
    b(o, hx0, y0, z0, hx1, hy0, z1),
    b(o, hx0, hy1, z0, hx1, y1, z1)
  ];
}

function genBase() {
  const o = OFF.base, C = [], P = [];
  C.push(...wallX(o, 0, 95, 3, 0, 0, 9, [44, 56], 6));
  C.push(...wallX(o, 105, 200, 3, 0, 0, 9, null, 6));
  C.push(...wallX(o, 0, 95, 3, 177, 0, 9, [44, 56], 6));
  C.push(...wallX(o, 105, 200, 3, 177, 0, 9, null, 6));
  C.push(...wallY(o, 0, 85, 3, 0, 0, 9, [40, 52], 6));
  C.push(...wallY(o, 95, 180, 3, 0, 0, 9, null, 6));
  C.push(...wallY(o, 0, 85, 3, 217, 0, 9, [40, 52], 6));
  C.push(...wallY(o, 95, 180, 3, 217, 0, 9, null, 6));
  C.push(...wallX(o, 90, 130, 2, 75, 0, 28, [107, 113], 6));
  C.push(...wallX(o, 90, 130, 2, 103, 0, 28, [107, 113], 6));
  C.push(...wallY(o, 75, 105, 2, 90, 0, 28, [87, 93], 6));
  C.push(...wallY(o, 75, 105, 2, 128, 0, 28, [87, 93], 6));
  C.push(...slab(o, 90, 75, 130, 105, 8, 9, [92, 77, 98, 83]));
  C.push(...slab(o, 90, 75, 130, 105, 17, 18, [92, 77, 98, 83]));
  C.push(...slab(o, 90, 75, 130, 105, 27, 28, null));
  C.push(...wallY(o, 75, 105, 1, 110, 0, 27, [81, 84], 6));
  C.push(...wallX(o, 90, 130, 1, 90, 0, 27, [114, 117], 6));
  P.push(p(o, 90, 75, 130, 105, 27));
  P.push(p(o, 90, 75, 130, 105, 18));
  for (const [px, py] of [[12, 42], [150, 42], [12, 135]]) {
    C.push(...wallX(o, px, px + 52, 2, py, 0, 12, [px + 23, px + 29], 6));
    C.push(...wallX(o, px, px + 52, 2, py + 12, 0, 12, [px + 23, px + 29], 6));
    C.push(...wallY(o, py, py + 14, 2, px, 0, 12, [py + 5, py + 11], 6));
    C.push(...wallY(o, py, py + 14, 2, px + 50, 0, 12, [py + 5, py + 11], 6));
    C.push(b(o, px, py, 11, px + 52, py + 14, 12));
    P.push(p(o, px, py, px + 52, py + 14, 11));
  }
  for (const [px, py] of [[150, 118], [60, 120]]) {
    C.push(...wallX(o, px, px + 46, 2, py + 28, 0, 16, [px + 14, px + 32], 11));
    C.push(b(o, px, py, 0, px + 46, py + 2, 16));
    C.push(b(o, px, py, 0, px + 2, py + 30, 16));
    C.push(b(o, px + 44, py, 0, px + 46, py + 30, 16));
    C.push(b(o, px, py, 15, px + 46, py + 30, 16));
    P.push(p(o, px, py, px + 46, py + 30, 15));
  }
  for (const [px, py] of [[0, 0], [216, 0], [0, 177], [216, 177]]) {
    C.push(b(o, px, py, 0, px + 4, py + 4, 12));
    P.push(p(o, px - 1, py - 1, px + 5, py + 5, 12));
  }
  C.push(b(o, 186, 88, 0, 190, 92, 50));
  C.push(b(o, 94, 134, 0, 106, 146, 14));
  C.push(b(o, 112, 134, 0, 124, 146, 14));
  return { colliders: C, platforms: P };
}

function genRefinery() {
  const o = OFF.refinery, C = [], P = [];
  C.push(...wallX(o, 0, 70, 2, 0, 0, 22, null, 7));
  C.push(...wallX(o, 0, 70, 2, 38, 0, 22, [30, 40], 7));
  C.push(...wallY(o, 0, 40, 2, 0, 0, 22, null, 7));
  C.push(...wallY(o, 0, 40, 2, 68, 0, 22, null, 7));
  C.push(...slab(o, 0, 0, 70, 40, 11, 12, [4, 4, 8, 8]));
  P.push(p(o, 0, 0, 70, 40, 11));
  for (const cx of [10, 30, 50]) for (const cy of [8, 32])
    C.push(b(o, cx, cy, 0, cx + 2, cy + 2, 22));
  for (const [cx, cy] of [[82, 18], [82, 42]]) {
    C.push(b(o, cx - 13, cy - 13, 0, cx + 13, cy + 13, 38));
    P.push(p(o, cx - 13, cy - 13, cx + 13, cy + 13, 38));
  }
  for (const [cx, cy] of [[10, 12], [30, 12], [50, 12]])
    C.push(b(o, cx - 2.5, cy - 2.5, 0, cx + 2.5, cy + 2.5, 44));
  return { colliders: C, platforms: P };
}

function genStadium() {
  const o = OFF.stadium, C = [];
  C.push(...wallY(o, -110, 110, 4, 104, 0, 32, [-6, 6], 14));
  C.push(...wallY(o, -110, 110, 4, -108, 0, 32, [-6, 6], 14));
  C.push(...wallX(o, -110, 110, 4, 104, 0, 32, [-6, 6], 14));
  C.push(...wallX(o, -110, 110, 4, -108, 0, 32, [-6, 6], 14));
  return { colliders: C, platforms: [] };
}

function genMegatower() {
  const o = OFF.megatower, C = [], P = [];
  C.push(...wallX(o, 0, 36, 2, 0, 0, 120, null, 6));
  C.push(...wallX(o, 0, 36, 2, 34, 0, 120, [15, 21], 6));
  C.push(...wallY(o, 0, 36, 2, 0, 0, 120, null, 6));
  C.push(...wallY(o, 0, 36, 2, 34, 0, 120, null, 6));
  for (let k = 1; k <= 11; k++) {
    C.push(...slab(o, 0, 0, 36, 36, k * 10, k * 10 + 1, [2, 2, 11, 11]));
    P.push(p(o, 0, 0, 36, 36, k * 10));
  }
  for (let k = 1; k <= 10; k++) {
    const z0 = k * 10 + 1;
    if (k % 2 === 1) {
      C.push(...wallX(o, 0, 36, 1, 18, z0, 9, [6, 9], 6));
      C.push(...wallX(o, 0, 36, 1, 26, z0, 9, [24, 27], 6));
    } else {
      C.push(...wallY(o, 0, 36, 1, 14, z0, 9, [6, 9], 6));
      C.push(...wallY(o, 0, 36, 1, 24, z0, 9, [24, 27], 6));
    }
  }
  return { colliders: C, platforms: P };
}

function buildXL() {
  return { base: genBase(), refinery: genRefinery(), stadium: genStadium(), megatower: genMegatower() };
}

// 把配置格式化成 CONFIGS 内的源码文本
function configToSource(key, cfg) {
  const ind = '    ';            // 4 空格（CONFIGS 项下）
  const ind2 = '      ';         // 6 空格
  const ind3 = '        ';       // 8 空格
  let s = `${ind}${key}: { // 碰撞留空配置（${cfg.colliders.length} 盒 / 平台 ${cfg.platforms.length}）：真实门洞 + 内部中空 + 楼板楼梯井\n`;
  s += `${ind2}colliders: [\n`;
  for (const c of cfg.colliders) {
    s += `${ind3}[${c.map(n => Math.round(n * 10) / 10).join(', ')}],\n`;
  }
  s += `${ind2}],\n`;
  if (cfg.platforms.length) {
    s += `${ind2}platforms: [\n`;
    for (const pl of cfg.platforms) {
      const f = n => Math.round(n * 10) / 10;
      s += `${ind3}{ x0: ${f(pl.x0)}, x1: ${f(pl.x1)}, y0: ${f(pl.y0)}, y1: ${f(pl.y1)}, y: ${f(pl.y)} },\n`;
    }
    s += `${ind2}]\n`;
  }
  s += `${ind}}`;
  return s;
}

const COMMENT = `    /* ============ v1.4 四地标（models/out 内联数据，BUILDINGS_OUT）— 已落地碰撞留空 ============
     * 坐标系 x[0,w] y[0,d](深) z[0,h](高)，尺寸 = 归一化 GLB bbox（tools/glb2bldg_out.js 探测输出）；
     * 运行时按地图 w/d/h 缩放（碰撞尺寸以地图数据为准），门洞留空、平台可站。
     * 全部可进入（真实门洞 + 内部中空 + 楼板楼梯井），由 battle_*.scad 可进入版编译：
     *   - base 前哨基地（GLB 223×184×65）：围墙四门 + 中央 HQ(3层迷宫) + 3营房 + 2机库 + 4哨塔（可爬）
     *   - refinery 炼油厂（GLB 193×184.5×45.5）：主厂房前向大门 + catwalk 检修层 + 2冷却塔 + 3烟囱
     *   - stadium 竞技场（GLB 220×220×32）：外壳环 4 径向隧道门（可进场内 / 场地 / 看台下通道）
     *   - megatower 巨塔（GLB 36×36×145.5）：前墙大门 + 11层楼板(中央楼梯井) + 奇偶层隔间迷宫（可逐层登顶）
     * 注：垂直爬行依赖游戏楼梯/平台机制；碰撞盒为 AABB 近似（圆形 stadium/冷却塔用外接方墙近似）。 */`;

// 安全策略：该生成器中的 OFF / wall / slab 数据属于旧版模型坐标，
// 不得再写入当前 BuildingLib.CONFIGS。保留 buildXL() 仅供历史对照。
// 正式碰撞配置必须以 js/models.js 为唯一事实源。
function apply() {
  throw new Error(
    '已阻止写入：此 XL 生成器使用过时的尺寸/门洞数据。请先更新并通过 tools/_validate_xl.js，' +
    '再由人工审查后修改 js/models.js。'
  );
}

if (require.main === module) {
  const xl = buildXL();
  console.log('[SAFE PREVIEW ONLY] 旧版 XL 生成器不会写入 js/models.js。');
  console.log('历史配置盒数:', Object.fromEntries(Object.entries(xl).map(([k, v]) => [k, v.colliders.length])));
  console.error('如需正式更新碰撞配置，请先修正模型坐标与地图 scale，再人工审查变更。');
  process.exitCode = 2;
}
module.exports = { buildXL, configToSource, apply };
