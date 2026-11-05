/*
 * v4.1 程序化建筑工厂。
 *
 * 目的：不再重复摆同一个别墅 GLB。用基础几何拼出多种 1~4 层建筑：
 *   cottage / villa / townhouse / shop / apartment / warehouse / shed / tower / ruin / container
 * 每栋建筑：
 *   - 按材质色合并成少量 draw call（一个颜色一个 Mesh）
 *   - 墙体/楼板/楼梯/屋顶全部注册 Rapier cuboid 碰撞
 *   - 墙体留 1.4m×2.4m 门洞，室内楼梯可上二层（玩家可进）
 *   - 返回 footprint 供导航/小地图使用
 */

export const PROC_DIMS = {
  cottage:   { w: 8.0, d: 6.0, h: 4.8, floors: 1, floorH: 3.2, roof: 'hip' },
  villa:     { w: 11.0, d: 8.0, h: 7.6, floors: 2, floorH: 3.2, roof: 'hip' },
  townhouse: { w: 7.0, d: 9.0, h: 7.2, floors: 2, floorH: 3.2, roof: 'flat' },
  shop:      { w: 10.0, d: 8.0, h: 7.2, floors: 2, floorH: 3.2, roof: 'flat' },
  apartment: { w: 14.0, d: 11.0, h: 13.0, floors: 4, floorH: 3.2, roof: 'flat' },
  warehouse: { w: 18.0, d: 12.0, h: 7.4, floors: 1, floorH: 5.4, roof: 'flat' },
  shed:      { w: 4.6, d: 4.0, h: 3.2, floors: 1, floorH: 3.0, roof: 'hip' },
  tower:     { w: 6.0, d: 6.0, h: 12.8, floors: 4, floorH: 3.0, roof: 'flat' },
  ruin:      { w: 9.0, d: 7.0, h: 3.8, floors: 1, floorH: 3.8, roof: 'none' },
  container: { w: 12.0, d: 3.0, h: 2.8, floors: 1, floorH: 2.8, roof: 'flat' }
};

const PALETTES = {
  suburb: {
    walls: [0xe0d6c3, 0xc97a5a, 0x9fb0a8, 0xb58a6a, 0xd8c8a8, 0x8f9ba8, 0xc9b08a, 0xa86b52],
    trim: 0xefe9dc, roofs: [0x7a4038, 0x5c6064, 0x8a4b3b, 0x4f5a61, 0x3f5a50],
    door: 0x5a3a25, glass: 0x8fb8cc, wood: 0x7a5a3a, metal: 0x5a6268,
    awning: [0x8e3b32, 0x3c6b5a, 0x3f567a], slab: 0x9d998f
  },
  port: {
    walls: [0x9aa2a8, 0x7f8b93, 0xb0b4b5, 0x8a7f72, 0x6f7d86, 0xa8a49a, 0x9a6a5a, 0x6f8a8a],
    trim: 0xd4d8d8, roofs: [0x4a5258, 0x3f474d, 0x5a646b, 0x685f54, 0x4a5a52],
    door: 0x36414a, glass: 0x7fa5b9, wood: 0x6b5844, metal: 0x4a535a,
    awning: [0x2f5d78, 0x7a3d32, 0x3d6652], slab: 0x777c7f
  },
  desert: {
    walls: [0xc9ab7d, 0xb8976a, 0xd6bc93, 0xa8875f, 0xd0b183, 0xbfa074, 0xb06a4a, 0xd8c8b0],
    trim: 0xead8b8, roofs: [0x8a6b45, 0x9c7a50, 0x75593c, 0x6f5a42],
    door: 0x5d4329, glass: 0x9bb7c2, wood: 0x6e5130, metal: 0x6b655a,
    awning: [0x8a5a32, 0x5d6b4a, 0x7a3f32], slab: 0xa89570
  }
};

function makeMerger(THREE) {
  const buckets = new Map();
  function bucket(color) {
    let b = buckets.get(color);
    if (!b) {
      b = { pos: [], nor: [], idx: [] };
      buckets.set(color, b);
    }
    return b;
  }
  function addGeometry(geo, matrix, color) {
    geo.applyMatrix4(matrix);
    const p = geo.attributes.position && geo.attributes.position.array;
    if (!p) { geo.dispose(); return; }
    const n = geo.attributes.normal && geo.attributes.normal.array;
    const b = bucket(color);
    const off = b.pos.length / 3;
    for (let i = 0; i < p.length; i++) { b.pos.push(p[i]); b.nor.push(n ? n[i] : 0); }
    if (geo.index) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i++) b.idx.push(ix[i] + off);
    } else {
      for (let i = 0; i < p.length / 3; i++) b.idx.push(off + i);
    }
    geo.dispose();
  }
  function box(w, h, d, x, y, z, color, rx, ry, rz) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1)
    );
    addGeometry(geo, m, color);
  }
  function cone(radius, height, x, y, z, color, ry, sx, sz) {
    const geo = new THREE.ConeGeometry(radius, height, 4, 1);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry || 0, 0, 'YXZ')),
      new THREE.Vector3(sx || 1, 1, sz || 1)
    );
    addGeometry(geo, m, color);
  }
  function finish(group, glassColor) {
    for (const [color, b] of buckets) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(b.pos), 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(b.nor), 3));
      geo.setIndex(b.idx);
      geo.computeBoundingSphere();
      const mat = new THREE.MeshLambertMaterial({ color });
      if (color === glassColor) {
        mat.emissive = new THREE.Color(0x27333c);
        mat.emissiveIntensity = 0.55;
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    buckets.clear();
  }
  return { box, cone, finish };
}

export function createBuildingFactory(THREE, physics, mapId) {
  const P = PALETTES[mapId] || PALETTES.suburb;
  const pick = (arr, k) => arr[Math.abs(k) % arr.length];

  function build(type, x, z, ry, seed) {
    const D = PROC_DIMS[type];
    if (!D) throw new Error('未知程序化建筑类型: ' + type);
    const s = (seed || Math.floor(x * 7 + z * 13)) >>> 0;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = ry || 0;
    group.name = 'proc:' + type + ':' + x + ',' + z;
    const M = makeMerger(THREE);
    const cos = Math.cos(ry || 0), sin = Math.sin(ry || 0);

    const wallColor = pick(P.walls, s);
    const trimColor = P.trim;
    const roofColor = pick(P.roofs, s >> 3);
    const doorColor = P.door;
    const glassColor = P.glass;
    const slabColor = P.slab;
    const W = D.w, DD = D.d, t = 0.28;
    const floors = D.floors, floorH = D.floorH;

    function collider(w, h, d, lx, ly, lz, rotY, sensor) {
      const wx = x + lx * cos + lz * sin;
      const wz = z - lx * sin + lz * cos;
      physics.addBoxCollider(w, h, d, wx, ly, wz, (ry || 0) + (rotY || 0), sensor);
    }
    function solid(w, h, d, lx, ly, lz, color, rx, ryLocal, rz) {
      M.box(w, h, d, lx, ly, lz, color, rx, ryLocal, rz);
      collider(w, h, d, lx, ly, lz, ryLocal || 0);
    }

    /* ---------- 地基 ---------- */
    // 只做 6cm 薄台，避免 14cm 门槛在胶囊 sweep 里变成“隐形台阶”卡门
    solid(W + 0.45, 0.06, DD + 0.45, 0, 0.03, 0, slabColor);

    /* ---------- 门洞/窗 ---------- */
    const doorW = type === 'warehouse' ? 4.2 : 1.4;
    const doorH = type === 'warehouse' ? 4.2 : 2.45;
    const doorAt = type === 'shop' ? -W * 0.18 : (s % 2 ? W * 0.16 : -W * 0.12);

    function wallX(zPos, x0, x1, by, h, color, door) {
      const len = x1 - x0;
      if (len <= 0.01) return;
      if (!door) {
        solid(len, h, t, (x0 + x1) / 2, by + h / 2, zPos, color);
        return;
      }
      const dl = Math.max(x0, door.at - door.w / 2);
      const dr = Math.min(x1, door.at + door.w / 2);
      if (dl - x0 > 0.01) solid(dl - x0, h, t, (x0 + dl) / 2, by + h / 2, zPos, color);
      if (x1 - dr > 0.01) solid(x1 - dr, h, t, (dr + x1) / 2, by + h / 2, zPos, color);
      const lh = h - door.h;
      if (lh > 0.02) solid(dr - dl, lh, t, (dl + dr) / 2, by + door.h + lh / 2, zPos, color);
      // 门框 + 半开门扇（无碰撞）
      M.box(0.1, door.h + 0.15, t + 0.12, dl, by + door.h / 2, zPos + 0.02, trimColor);
      M.box(0.1, door.h + 0.15, t + 0.12, dr, by + door.h / 2, zPos + 0.02, trimColor);
      M.box(dr - dl, 0.12, t + 0.12, (dl + dr) / 2, by + door.h + 0.06, zPos + 0.02, trimColor);
      const th = 1.12;
      const dw = dr - dl;
      M.box(dw, door.h - 0.08, 0.07,
        dl + Math.cos(th) * dw / 2, by + door.h / 2, zPos - Math.sin(th) * dw / 2,
        doorColor, 0, -th, 0);
    }

    function wallZ(xPos, z0, z1, by, h, color) {
      const len = z1 - z0;
      if (len <= 0.01) return;
      solid(t, h, len, xPos, by + h / 2, (z0 + z1) / 2, color);
    }

    function windowX(zPos, cx, by, wide, tall) {
      const w = wide || 1.15, hh = tall || 1.15;
      M.box(w, hh, 0.09, cx, by + 1.55, zPos + 0.16, glassColor);
      M.box(w + 0.2, 0.1, 0.16, cx, by + 1.55 - hh / 2 - 0.07, zPos + 0.17, trimColor);
      M.box(0.09, hh + 0.2, 0.16, cx - w / 2 - 0.06, by + 1.55, zPos + 0.17, trimColor);
      M.box(0.09, hh + 0.2, 0.16, cx + w / 2 + 0.06, by + 1.55, zPos + 0.17, trimColor);
    }
    function windowZ(xPos, cz, by, wide, tall) {
      const w = wide || 1.15, hh = tall || 1.15;
      M.box(0.09, hh, w, xPos + 0.16, by + 1.55, cz, glassColor);
      M.box(0.16, 0.1, w + 0.2, xPos + 0.17, by + 1.55 - hh / 2 - 0.07, cz, trimColor);
      M.box(0.16, hh + 0.2, 0.09, xPos + 0.17, by + 1.55, cz - w / 2 - 0.06, trimColor);
      M.box(0.16, hh + 0.2, 0.09, xPos + 0.17, by + 1.55, cz + w / 2 + 0.06, trimColor);
    }

    /* ---------- 楼板（留楼梯井） ---------- */
    const stairW = 1.5;
    const sx0 = -W / 2 + 0.65;
    const sx1 = Math.min(W / 2 - 0.65, sx0 + stairW);
    const run = Math.min(3.0, DD - 2.8);
    const sz0 = -DD / 2 + 1.4;
    const sz1 = sz0 + run;
    const stairHole = { x0: sx0, x1: sx1, z0: sz0, z1: sz1 };

    function floorSlab(topY, hole) {
      const h = 0.24;
      if (!hole) {
        solid(W - 0.15, h, DD - 0.15, 0, topY - h / 2, 0, slabColor);
        return;
      }
      const leftW = hole.x0 + W / 2;
      const rightW = W / 2 - hole.x1;
      if (leftW > 0.05) solid(leftW, h, DD - 0.15, -W / 2 + leftW / 2, topY - h / 2, 0, slabColor);
      if (rightW > 0.05) solid(rightW, h, DD - 0.15, W / 2 - rightW / 2, topY - h / 2, 0, slabColor);
      const midW = hole.x1 - hole.x0;
      const frontD = hole.z0 + DD / 2;
      const backD = DD / 2 - hole.z1;
      if (frontD > 0.05) solid(midW, h, frontD, (hole.x0 + hole.x1) / 2, topY - h / 2, -DD / 2 + frontD / 2, slabColor);
      if (backD > 0.05) solid(midW, h, backD, (hole.x0 + hole.x1) / 2, topY - h / 2, DD / 2 - backD / 2, slabColor);
    }

    function stairs(baseY) {
      const n = Math.ceil(floorH / 0.3);
      const rise = floorH / n;
      const dep = run / n;
      for (let i = 0; i < n; i++) {
        const hh = rise * (i + 1);
        const lx = (sx0 + sx1) / 2, ly = baseY + hh / 2, lz = sz0 + dep * (i + 0.5);
        M.box(sx1 - sx0 - 0.08, hh, dep + 0.02, lx, ly, lz, P.wood);
        collider(sx1 - sx0 - 0.08, hh, dep + 0.02, lx, ly, lz, 0, true);
      }
    }

    /* ---------- 每层墙体/窗 ---------- */
    const wallH = floorH - 0.14;
    for (let lv = 0; lv < floors; lv++) {
      const by = lv * floorH + 0.14;
      wallX(DD / 2 - t / 2, -W / 2, W / 2, by, wallH, wallColor, lv === 0 ? { at: doorAt, w: doorW, h: doorH } : null);
      wallX(-DD / 2 + t / 2, -W / 2, W / 2, by, wallH, wallColor, null);
      wallZ(-W / 2 + t / 2, -DD / 2, DD / 2, by, wallH, wallColor);
      wallZ(W / 2 - t / 2, -DD / 2, DD / 2, by, wallH, wallColor);

      const winY = lv * floorH;
      if (lv === 0) {
        windowX(DD / 2 - t / 2, -W * 0.28, winY, 1.25, 1.2);
        windowX(DD / 2 - t / 2, W * 0.28, winY, 1.25, 1.2);
        windowZ(-W / 2 + t / 2, -DD * 0.22, winY, 1.0, 1.15);
        windowZ(-W / 2 + t / 2, DD * 0.22, winY, 1.0, 1.15);
        windowZ(W / 2 - t / 2, 0, winY, 1.0, 1.15);
        windowX(-DD / 2 + t / 2, -W * 0.24, winY, 1.0, 1.1);
        windowX(-DD / 2 + t / 2, W * 0.24, winY, 1.0, 1.1);
      } else {
        windowX(DD / 2 - t / 2, -W * 0.25, winY, 1.1, 1.15);
        windowX(DD / 2 - t / 2, W * 0.25, winY, 1.1, 1.15);
        windowX(-DD / 2 + t / 2, 0, winY, 1.1, 1.15);
        windowZ(-W / 2 + t / 2, 0, winY, 1.05, 1.15);
        windowZ(W / 2 - t / 2, 0, winY, 1.05, 1.15);
      }

      if (lv < floors - 1) {
        const topY = (lv + 1) * floorH;
        floorSlab(topY, stairHole);
        stairs(lv * floorH + 0.14);
      }
    }

    /* ---------- 屋顶 ---------- */
    const roofY = floors * floorH;
    if (D.roof === 'none') {
      // 废墟：部分残缺墙 + 瓦砾
      M.box(W * 0.55, 1.8, t, -W * 0.15, 1.0, DD / 2, wallColor);
      M.box(W * 0.34, wallH, t, W * 0.25, wallH / 2, -DD / 2, wallColor);
      for (let i = 0; i < 7; i++) {
        const rx = (i / 7 - 0.5) * W * 0.8;
        const rz = ((i * 37) % 100) / 100 * DD - DD / 2;
        M.box(0.5 + (i % 3) * 0.35, 0.3 + (i % 2) * 0.25, 0.4, rx, 0.25, rz, slabColor, 0, (i * 0.7) % 1.2, 0);
      }
    } else if (D.roof === 'hip') {
      solid(W - 0.2, 0.28, DD - 0.2, 0, roofY - 0.14, 0, slabColor);
      const rr = Math.max(W, DD) / 1.414;
      M.cone(rr, 2.3, 0, roofY + 1.15, 0, roofColor, Math.PI / 4, 1.02, DD / W * 1.02);
      if (s % 3 === 0) M.box(0.5, 1.2, 0.5, W * 0.26, roofY + 1.4, -DD * 0.2, P.metal);
    } else {
      // flat
      solid(W - 0.15, 0.3, DD - 0.15, 0, roofY + 0.15, 0, slabColor);
      const ph = 0.55;
      solid(W, ph, 0.22, 0, roofY + 0.3 + ph / 2, DD / 2 - 0.11, wallColor);
      solid(W, ph, 0.22, 0, roofY + 0.3 + ph / 2, -DD / 2 + 0.11, wallColor);
      solid(0.22, ph, DD, -W / 2 + 0.11, roofY + 0.3 + ph / 2, 0, wallColor);
      solid(0.22, ph, DD, W / 2 - 0.11, roofY + 0.3 + ph / 2, 0, wallColor);
      // 屋顶设备
      if (s % 2 === 0) M.box(1.4, 0.9, 1.1, W * 0.2, roofY + 0.75, -DD * 0.12, P.metal);
      if (s % 3 === 0) M.box(0.6, 1.4, 0.6, -W * 0.3, roofY + 1.0, DD * 0.18, P.metal);
    }

    /* ---------- 类型细节 ---------- */
    if (type === 'shop') {
      // 雨棚 + 招牌
      M.box(3.6, 0.14, 1.2, doorAt + 0.4, 2.75, DD / 2 + 0.55, pick(P.awning, s));
      M.box(3.6, 0.5, 0.12, doorAt + 0.4, 3.25, DD / 2 + 0.05, pick(P.awning, s + 1));
      M.box(2.4, 0.55, 0.1, doorAt + 0.4, 4.15, DD / 2 + 0.2, P.trim);
    }
    if (type === 'warehouse') {
      // 大卷帘门 + 通风窗
      M.box(doorW + 0.4, 0.3, 0.25, doorAt, 4.55, DD / 2 + 0.05, P.metal);
      for (let i = 0; i < 4; i++) M.box(1.2, 0.5, 0.12, -W * 0.32 + i * 1.6, 5.0, DD / 2 + 0.1, P.metal);
      M.box(W * 0.6, 0.16, 0.16, 0, roofY + 0.4, DD / 2 + 0.1, P.metal);
    }
    if (type === 'apartment' || type === 'villa' || type === 'townhouse') {
      // 阳台（视觉 + 可站台面碰撞）
      for (let lv = 1; lv < floors; lv++) {
        const by = lv * floorH;
        const bz = DD / 2 + 0.55;
        solid(2.6, 0.16, 1.0, W * 0.18, by + 0.1, bz, slabColor);
        for (let k = -2; k <= 2; k++) M.box(0.06, 0.8, 0.06, W * 0.18 + k * 0.55, by + 0.55, bz + 0.44, P.metal);
        M.box(2.6, 0.08, 0.06, W * 0.18, by + 0.95, bz + 0.44, P.metal);
      }
    }
    if (type === 'container') {
      // 瓦楞条
      for (let i = 0; i < 10; i++) {
        M.box(0.12, D.h - 0.2, 0.05, -W / 2 + 0.6 + i * ((W - 1.2) / 9), D.h / 2, DD / 2 + 0.03, P.metal);
      }
    }
    if (type === 'tower') {
      // 顶部围栏
      for (let k = -2; k <= 2; k++) {
        M.box(0.08, 1.0, 0.08, k * 1.1, roofY + 0.9, DD / 2 - 0.15, P.metal);
      }
    }

    M.finish(group, glassColor);
    const hx = Math.abs(cos) * W / 2 + Math.abs(sin) * DD / 2 + 0.3;
    const hz = Math.abs(sin) * W / 2 + Math.abs(cos) * DD / 2 + 0.3;
    return {
      group,
      footprint: { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz },
      height: roofY + (D.roof === 'hip' ? 2.4 : 0.9),
      dims: D
    };
  }

  return { build, palette: P, dims: PROC_DIMS };
}
