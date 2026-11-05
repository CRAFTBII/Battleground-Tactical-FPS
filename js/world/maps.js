/*
 * v4.1 map data.
 * 只描述数据，不碰 THREE / Rapier；由 runtime.js 消费。
 * 尺寸单位：米。地面 y=0（城镇/道路之外由 runtime 生成缓坡地形）。
 * 建筑：key = GLB 地标；type = 程序化建筑。
 */

const B_HOUSE = { w: 11, h: 8.8, d: 9 };
const B_COVER = { w: 14.5, h: 2.8, d: 6.3 };
const B_BASE = { w: 90, h: 16, d: 75 };
const B_ESTATE = { w: 80, h: 10, d: 60 };

function b(key, x, z, ry) { return { key, x, z, ry: ry || 0 }; }
function pb(type, x, z, ry) { return { type, x, z, ry: ry || 0 }; }
function prop(type, x, z, w, h, d, ry, color) {
  return { type, x, z, w, h, d, ry: ry || 0, color: color || 0x6b5a3e };
}

const SUBURB = {
  id: 'suburb',
  name: '暮色小镇',
  desc: '训练用小镇：十字主街、中央广场、可进入的多层民居与街垒',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0x8fb4cc, fog: 0x8fb4cc, fogNear: 130, fogFar: 460,
    ground: 0x4a6b3c, ground2: 0x6f7d4b, groundCss: '#33472b', terrainAmp: 1.7,
    sun: 0xfff2d8, sunIntensity: 1.25,
    hemiSky: 0xdfeaff, hemiGround: 0x3d4a3a, hemiIntensity: 0.95,
    ambient: 0x8899aa, ambientIntensity: 0.22
  },
  roads: [
    { x: 150, z: 150, w: 240, d: 14, color: 0x555a5e },
    { x: 150, z: 150, w: 14, d: 120, color: 0x555a5e },
    { x: 88, z: 175, w: 10, d: 150, color: 0x4d5256 },
    { x: 212, z: 175, w: 10, d: 150, color: 0x4d5256 },
    { x: 150, z: 215, w: 240, d: 10, color: 0x4d5256 },
    { x: 150, z: 85, w: 180, d: 10, color: 0x4d5256 },
    { x: 150, z: 150, w: 46, d: 46, color: 0x6b6d6a }
  ],
  buildings: [
    b('base', 150, 42),
    b('estate', 150, 255),
    pb('townhouse', 58, 112, 0.05),
    pb('shop', 77, 113, -0.04),
    pb('villa', 58, 176, 0.02),
    pb('cottage', 75, 187, -0.08),
    pb('shop', 55, 201, 0.03),
    pb('shop', 125, 111, -0.03),
    pb('villa', 176, 116, 0.04),
    pb('townhouse', 125, 186, 0.03),
    pb('shop', 176, 186, -0.05),
    pb('warehouse', 235, 112, 0.02),
    pb('apartment', 249, 126, 0.0),
    pb('townhouse', 235, 137, 0.03),
    pb('shop', 235, 176, -0.04),
    pb('townhouse', 225, 200, 0.02),
    pb('apartment', 249, 201, 0.0),
    pb('cottage', 42, 125, 0.06),
    pb('townhouse', 98, 204, 0.04),
    pb('ruin', 42, 190, 0.2),
    pb('cottage', 42, 75, 0.1),
    pb('cottage', 45, 168, -0.05),
    pb('shed', 40, 205, 0.2),
    pb('cottage', 265, 135, 0.05),
    pb('cottage', 265, 205, -0.1),
    b('cover', 120, 170), b('cover', 180, 170),
    b('cover', 105, 140, Math.PI / 2), b('cover', 195, 140, Math.PI / 2),
    b('cover', 150, 205, Math.PI / 2), b('cover', 150, 98),
    b('cover', 55, 155, Math.PI / 2), b('cover', 265, 175, Math.PI / 2),
    b('cover', 245, 80)
  ],
  props: [
    prop('crate', 64, 208, 1.6, 1.4, 1.6, 0, 0x8a6f4a),
    prop('crate', 86, 208, 1.6, 1.4, 1.6, 0, 0x8a6f4a),
    prop('crate', 64, 192, 1.6, 1.4, 1.6, 0.3, 0x7d6342),
    prop('crate', 86, 192, 1.6, 1.4, 1.6, -0.2, 0x7d6342),
    prop('crate', 138, 160, 1.6, 1.4, 1.6, 0.4, 0x8a6f4a),
    prop('crate', 162, 160, 1.6, 1.4, 1.6, -0.4, 0x8a6f4a),
    prop('crate', 214, 104, 1.6, 1.4, 1.6, 0, 0x7d6342),
    prop('crate', 236, 104, 1.6, 1.4, 1.6, 0.2, 0x7d6342),
    prop('sandbag', 150, 138, 5.5, 1.1, 0.8, 0, 0x9c8a62),
    prop('sandbag', 150, 162, 5.5, 1.1, 0.8, 0, 0x9c8a62)
  ],
  capturePoints: [
    { id: 'A', x: 75, z: 200, r: 6 },
    { id: 'B', x: 150, z: 150, r: 6 },
    { id: 'C', x: 225, z: 95, r: 6 }
  ],
  spawns: {
    blue: [{ x: 70, z: 235 }, { x: 90, z: 250 }, { x: 60, z: 220 }, { x: 100, z: 260 }, { x: 80, z: 275 }],
    red: [{ x: 230, z: 65 }, { x: 210, z: 50 }, { x: 250, z: 100 }, { x: 200, z: 60 }, { x: 220, z: 85 }],
    green: [{ x: 60, z: 60 }, { x: 80, z: 80 }],
    yellow: [{ x: 215, z: 260 }, { x: 235, z: 270 }]
  }
};

const PORT = {
  id: 'port',
  name: '灰港',
  desc: '集装箱港区：东西仓库、南北出生、沿街商铺与废弃塔楼',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0x7d93a8, fog: 0x8296a8, fogNear: 110, fogFar: 400,
    ground: 0x56616a, ground2: 0x6d756f, groundCss: '#3a4249', terrainAmp: 1.1,
    sun: 0xf3e6cc, sunIntensity: 1.05,
    hemiSky: 0xd3e2ef, hemiGround: 0x3a434a, hemiIntensity: 0.85,
    ambient: 0x7f8fa0, ambientIntensity: 0.25
  },
  roads: [
    { x: 150, z: 150, w: 240, d: 14, color: 0x45494d },
    { x: 150, z: 150, w: 14, d: 220, color: 0x45494d },
    { x: 150, z: 78, w: 220, d: 10, color: 0x3f4346 },
    { x: 150, z: 230, w: 90, d: 10, color: 0x3f4346 },
    { x: 75, z: 135, w: 10, d: 110, color: 0x3f4346 },
    { x: 225, z: 135, w: 10, d: 100, color: 0x3f4346 },
    { x: 150, z: 110, w: 160, d: 10, color: 0x3f4346 },
    { x: 150, z: 150, w: 40, d: 40, color: 0x5b6063 }
  ],
  buildings: [
    b('base', 245, 225),
    b('estate', 55, 225),
    pb('shop', 60, 60, 0.04),
    pb('townhouse', 95, 60, -0.03),
    pb('villa', 60, 100, 0.02),
    pb('townhouse', 100, 95, 0.05),
    pb('shop', 205, 60, -0.04),
    pb('warehouse', 230, 55, 0.02),
    pb('townhouse', 250, 58, 0.03),
    pb('apartment', 245, 105, 0.0),
    pb('warehouse', 205, 125, 0.01),
    pb('cottage', 45, 110, 0.05),
    pb('villa', 55, 130, 0.02),
    pb('townhouse', 95, 130, -0.03),
    pb('shop', 55, 175, 0.04),
    pb('shed', 45, 95, 0.1),
    pb('tower', 40, 120, 0.0),
    pb('villa', 130, 100, 0.02),
    pb('shop', 170, 95, 0.01),
    pb('shop', 110, 135, 0.03),
    pb('townhouse', 190, 135, -0.04),
    pb('apartment', 180, 185, 0.0),
    pb('apartment', 130, 190, 0.0),
    pb('shop', 105, 190, -0.02),
    pb('ruin', 275, 175, 0.2),
    pb('cottage', 40, 60, 0.1),
    pb('shed', 270, 70, -0.1),
    pb('cottage', 270, 110, 0.05),
    pb('townhouse', 210, 170, 0.02),
    b('cover', 75, 110), b('cover', 225, 110), b('cover', 110, 170),
    b('cover', 190, 170), b('cover', 150, 200), b('cover', 150, 80),
    b('cover', 75, 75), b('cover', 265, 95, Math.PI / 2),
    b('cover', 150, 245)
  ],
  props: [
    prop('crate', 64, 86, 1.6, 1.4, 1.6, 0.2, 0x55606a),
    prop('crate', 86, 104, 1.6, 1.4, 1.6, -0.3, 0x55606a),
    prop('crate', 214, 86, 1.6, 1.4, 1.6, 0.3, 0x55606a),
    prop('crate', 236, 104, 1.6, 1.4, 1.6, 0, 0x55606a),
    prop('crate', 138, 166, 1.6, 1.4, 1.6, 0.4, 0x4d5862),
    prop('crate', 162, 166, 1.6, 1.4, 1.6, -0.2, 0x4d5862),
    prop('container', 95, 45, 12, 2.8, 3, 0, 0x4d6a72),
    prop('container', 195, 45, 12, 2.8, 3, 0.15, 0x7a4a3e),
    prop('container', 120, 260, 12, 2.8, 3, 1.57, 0x3f5a68),
    prop('sandbag', 150, 143, 5.5, 1.1, 0.8, 0, 0x8b8068),
    prop('sandbag', 150, 167, 5.5, 1.1, 0.8, 0, 0x8b8068)
  ],
  capturePoints: [
    { id: 'A', x: 75, z: 95, r: 6 },
    { id: 'B', x: 150, z: 155, r: 6 },
    { id: 'C', x: 225, z: 95, r: 6 }
  ],
  spawns: {
    blue: [{ x: 150, z: 270 }, { x: 130, z: 282 }, { x: 170, z: 278 }, { x: 115, z: 262 }, { x: 185, z: 265 }],
    red: [{ x: 150, z: 30 }, { x: 130, z: 45 }, { x: 170, z: 40 }, { x: 120, z: 55 }, { x: 180, z: 50 }],
    green: [{ x: 45, z: 40 }, { x: 80, z: 40 }],
    yellow: [{ x: 255, z: 265 }, { x: 240, z: 280 }]
  }
};

const DESERT = {
  id: 'desert',
  name: '沙岭',
  desc: '荒漠前哨：中央基地、环形道路、土屋与风蚀废墟',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0xd8c49a, fog: 0xd2bd91, fogNear: 150, fogFar: 500,
    ground: 0xb19a6e, ground2: 0x8e7a55, groundCss: '#7a6949', terrainAmp: 2.0,
    sun: 0xffe8bd, sunIntensity: 1.45,
    hemiSky: 0xf0e2c4, hemiGround: 0x6a5a3c, hemiIntensity: 0.9,
    ambient: 0xa89977, ambientIntensity: 0.18
  },
  roads: [
    { x: 95, z: 150, w: 12, d: 180, color: 0x94815c },
    { x: 205, z: 135, w: 12, d: 150, color: 0x94815c },
    { x: 150, z: 95, w: 240, d: 12, color: 0x94815c },
    { x: 150, z: 205, w: 240, d: 12, color: 0x94815c },
    { x: 150, z: 52, w: 12, d: 64, color: 0x8d7b58 },
    { x: 150, z: 248, w: 12, d: 64, color: 0x8d7b58 },
    { x: 52, z: 150, w: 64, d: 12, color: 0x8d7b58 },
    { x: 248, z: 150, w: 64, d: 12, color: 0x8d7b58 }
  ],
  buildings: [
    b('base', 150, 150),
    b('estate', 225, 250),
    pb('shop', 55, 60, 0.03),
    pb('townhouse', 80, 60, -0.04),
    pb('warehouse', 120, 65, 0.02),
    pb('apartment', 180, 60, 0.0),
    pb('shop', 70, 74, 0.05),
    pb('cottage', 45, 110, 0.06),
    pb('townhouse', 70, 120, -0.03),
    pb('villa', 60, 168, 0.02),
    pb('townhouse', 70, 190, 0.04),
    pb('shop', 80, 225, -0.02),
    pb('ruin', 45, 220, 0.2),
    pb('townhouse', 240, 110, 0.03),
    pb('shop', 235, 168, -0.04),
    pb('cottage', 250, 135, 0.0),
    pb('villa', 275, 185, 0.02),
    pb('warehouse', 130, 220, 0.01),
    pb('cottage', 35, 70, 0.05),
    pb('shed', 270, 70, -0.1),
    pb('townhouse', 270, 110, 0.03),
    pb('cottage', 30, 185, 0.1),
    pb('shed', 270, 240, 0.2),
    pb('shop', 190, 30, -0.03),
    b('cover', 65, 105), b('cover', 225, 125), b('cover', 120, 82),
    b('cover', 180, 82), b('cover', 100, 220), b('cover', 200, 195),
    b('cover', 150, 108), b('cover', 150, 195),
    b('cover', 45, 160, Math.PI / 2), b('cover', 265, 140, Math.PI / 2)
  ],
  props: [
    prop('crate', 55, 95, 1.6, 1.4, 1.6, 0.2, 0x8a744e),
    prop('crate', 84, 108, 1.6, 1.4, 1.6, -0.3, 0x8a744e),
    prop('crate', 216, 82, 1.6, 1.4, 1.6, 0.3, 0x8a744e),
    prop('crate', 234, 100, 1.6, 1.4, 1.6, 0, 0x8a744e),
    prop('crate', 138, 250, 1.6, 1.4, 1.6, 0.4, 0x7d6847),
    prop('crate', 162, 250, 1.6, 1.4, 1.6, -0.2, 0x7d6847),
    prop('container', 55, 35, 12, 2.8, 3, 0.1, 0x7a5e3f),
    prop('container', 250, 35, 12, 2.8, 3, -0.1, 0x6b5a45),
    prop('sandbag', 150, 102, 5.5, 1.1, 0.8, 0, 0xa89570),
    prop('sandbag', 100, 195, 5.5, 1.1, 0.8, 0, 0xa89570)
  ],
  capturePoints: [
    { id: 'A', x: 75, z: 90, r: 6 },
    { id: 'B', x: 225, z: 90, r: 6 },
    { id: 'C', x: 150, z: 240, r: 6 }
  ],
  spawns: {
    blue: [{ x: 45, z: 265 }, { x: 65, z: 250 }, { x: 40, z: 230 }, { x: 80, z: 275 }, { x: 55, z: 285 }],
    red: [{ x: 255, z: 45 }, { x: 240, z: 60 }, { x: 260, z: 80 }, { x: 225, z: 50 }, { x: 245, z: 25 }],
    green: [{ x: 45, z: 30 }, { x: 60, z: 30 }],
    yellow: [{ x: 275, z: 265 }, { x: 260, z: 285 }]
  }
};

export const MAPS = [SUBURB, PORT, DESERT];
export const BUILDING_DIMS = { house: B_HOUSE, cover: B_COVER, base: B_BASE, estate: B_ESTATE };

export function createMapRegistry() {
  const byId = new Map(MAPS.map(m => [m.id, m]));
  return {
    defaultId: 'suburb',
    ids() { return MAPS.map(m => m.id); },
    list() { return MAPS.map(m => m); },
    count() { return MAPS.length; },
    has(id) { return byId.has(id); },
    get(id) { return byId.get(id) || MAPS[0]; },
    validate(def) {
      const errs = [];
      if (!def || !def.id) errs.push('缺 id');
      if (!def || !def.size) errs.push('缺 size');
      if (!def || !Array.isArray(def.capturePoints)) errs.push('缺 capturePoints');
      if (!def || !def.spawns) errs.push('缺 spawns');
      return { ok: errs.length === 0, errors: errs };
    }
  };
}
