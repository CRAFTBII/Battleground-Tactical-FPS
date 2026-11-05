/*
 * v4 map data.
 * 只描述数据，不碰 THREE / Rapier；由 runtime.js 消费。
 * 尺寸单位：米。地面 y=0。
 * 建筑 key 对应 models/buildings/<key>.glb 的 VIS/COL/NAV 节点。
 */

const B_HOUSE = { w: 11, h: 8.8, d: 9 };
const B_COVER = { w: 14.5, h: 2.8, d: 6.3 };
const B_BASE = { w: 90, h: 16, d: 75 };
const B_ESTATE = { w: 80, h: 10, d: 60 };

function b(key, x, z, ry) {
  return { key, x, z, ry: ry || 0 };
}
function prop(type, x, z, w, h, d, ry, color) {
  return { type, x, z, w, h, d, ry: ry || 0, color: color || 0x6b5a3e };
}

const SUBURB = {
  id: 'suburb',
  name: '暮色小镇',
  desc: '训练用小镇：中央广场、三处据点、可进入的住宅与街垒',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0x8fb4cc, fog: 0x8fb4cc, fogNear: 140, fogFar: 470,
    ground: 0x4a6b3c, groundCss: '#33472b', sun: 0xfff2d8, sunIntensity: 1.25,
    hemiSky: 0xdfeaff, hemiGround: 0x3d4a3a, hemiIntensity: 0.95, ambient: 0x8899aa, ambientIntensity: 0.22
  },
  roads: [
    { x: 150, z: 150, w: 250, d: 9, color: 0x5b5f62 },
    { x: 150, z: 150, w: 9, d: 250, color: 0x5b5f62 },
    { x: 150, z: 150, w: 42, d: 42, color: 0x6a6d6e }
  ],
  buildings: [
    b('base', 150, 55),
    b('estate', 150, 250),
    b('house', 75, 120), b('house', 75, 180), b('house', 112, 197),
    b('house', 188, 197), b('house', 225, 165), b('house', 215, 120),
    b('house', 185, 100), b('house', 120, 100), b('house', 150, 125),
    b('house', 150, 190), b('house', 45, 95), b('house', 245, 235),
    b('cover', 120, 170), b('cover', 180, 170),
    b('cover', 105, 140, Math.PI / 2), b('cover', 195, 140, Math.PI / 2),
    b('cover', 150, 205, Math.PI / 2), b('cover', 150, 98),
    b('cover', 55, 155, Math.PI / 2), b('cover', 245, 195, Math.PI / 2),
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
  desc: '集装箱港区：东西两大建筑、南北出生、三处沿街据点',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0x7d93a8, fog: 0x8296a8, fogNear: 120, fogFar: 420,
    ground: 0x56616a, groundCss: '#3a4249', sun: 0xf3e6cc, sunIntensity: 1.05,
    hemiSky: 0xd3e2ef, hemiGround: 0x3a434a, hemiIntensity: 0.85, ambient: 0x7f8fa0, ambientIntensity: 0.25
  },
  roads: [
    { x: 150, z: 150, w: 260, d: 11, color: 0x4a4f54 },
    { x: 150, z: 150, w: 11, d: 260, color: 0x4a4f54 },
    { x: 150, z: 60, w: 220, d: 8, color: 0x43484d },
    { x: 150, z: 250, w: 220, d: 8, color: 0x43484d }
  ],
  buildings: [
    b('base', 245, 225),
    b('estate', 55, 225),
    b('house', 75, 65), b('house', 110, 85), b('house', 150, 60),
    b('house', 190, 80), b('house', 225, 55), b('house', 250, 140),
    b('house', 50, 140), b('house', 65, 185), b('house', 235, 175),
    b('house', 150, 220), b('house', 150, 110), b('house', 105, 135),
    b('house', 195, 135),
    b('cover', 75, 110), b('cover', 225, 110), b('cover', 110, 170),
    b('cover', 190, 170), b('cover', 150, 200), b('cover', 150, 80),
    b('cover', 60, 100, Math.PI / 2), b('cover', 240, 100, Math.PI / 2),
    b('cover', 150, 245)
  ],
  props: [
    prop('crate', 64, 86, 1.6, 1.4, 1.6, 0.2, 0x55606a),
    prop('crate', 86, 104, 1.6, 1.4, 1.6, -0.3, 0x55606a),
    prop('crate', 214, 86, 1.6, 1.4, 1.6, 0.3, 0x55606a),
    prop('crate', 236, 104, 1.6, 1.4, 1.6, 0, 0x55606a),
    prop('crate', 138, 166, 1.6, 1.4, 1.6, 0.4, 0x4d5862),
    prop('crate', 162, 166, 1.6, 1.4, 1.6, -0.2, 0x4d5862),
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
    green: [{ x: 45, z: 40 }, { x: 60, z: 55 }],
    yellow: [{ x: 255, z: 265 }, { x: 240, z: 280 }]
  }
};

const DESERT = {
  id: 'desert',
  name: '沙岭',
  desc: '荒漠前哨：中央基地、环城土屋、三处据点',
  size: 300,
  maxTeams: 2,
  env: {
    sky: 0xd8c49a, fog: 0xd2bd91, fogNear: 160, fogFar: 520,
    ground: 0xb19a6e, groundCss: '#7a6949', sun: 0xffe8bd, sunIntensity: 1.45,
    hemiSky: 0xf0e2c4, hemiGround: 0x6a5a3c, hemiIntensity: 0.9, ambient: 0xa89977, ambientIntensity: 0.18
  },
  roads: [
    { x: 150, z: 150, w: 260, d: 8, color: 0x97845f },
    { x: 150, z: 150, w: 8, d: 260, color: 0x97845f },
    { x: 150, z: 90, w: 200, d: 7, color: 0x8d7b58 },
    { x: 150, z: 230, w: 200, d: 7, color: 0x8d7b58 }
  ],
  buildings: [
    b('base', 150, 150),
    b('estate', 225, 250),
    b('house', 65, 65), b('house', 100, 45), b('house', 200, 45),
    b('house', 245, 100), b('house', 60, 190), b('house', 245, 190),
    b('house', 75, 235), b('house', 190, 210), b('house', 150, 35),
    b('house', 150, 265), b('house', 45, 140), b('house', 255, 155),
    b('cover', 75, 125), b('cover', 225, 125), b('cover', 120, 90),
    b('cover', 180, 90), b('cover', 100, 210), b('cover', 205, 200),
    b('cover', 150, 100), b('cover', 150, 200),
    b('cover', 45, 160, Math.PI / 2), b('cover', 255, 140, Math.PI / 2)
  ],
  props: [
    prop('crate', 66, 82, 1.6, 1.4, 1.6, 0.2, 0x8a744e),
    prop('crate', 84, 100, 1.6, 1.4, 1.6, -0.3, 0x8a744e),
    prop('crate', 216, 82, 1.6, 1.4, 1.6, 0.3, 0x8a744e),
    prop('crate', 234, 100, 1.6, 1.4, 1.6, 0, 0x8a744e),
    prop('crate', 138, 250, 1.6, 1.4, 1.6, 0.4, 0x7d6847),
    prop('crate', 162, 250, 1.6, 1.4, 1.6, -0.2, 0x7d6847),
    prop('sandbag', 150, 105, 5.5, 1.1, 0.8, 0, 0xa89570),
    prop('sandbag', 150, 195, 5.5, 1.1, 0.8, 0, 0xa89570)
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
