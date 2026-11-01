/* ============================================
 * 战地突击 · world.js — 数据驱动地图运行时
 * --------------------------------------------
 * 地图 = 数据定义（js/maps/*.js，注册到 window.MapRegistry）
 *      + 通用构建器（本文件）
 * 入口：World.load(scene, mapDef)   —— 构建任意一张地图
 *       World.init(scene, mapId)    —— 便捷封装，取注册表里的图（默认第一张）
 *
 * 离线约束：mapDef 必须由 <script> 注入（file:// 下 fetch 本地 JSON 被禁）。
 *           外部 GLB 为 opt-in，加载失败/离线一律回退程序化几何，游戏不崩。
 * 架构文档：docs/architecture/map-architecture.md
 * ============================================ */

/* 门楣/上层墙的基准高度：>= 该高度的墙段只挡子弹（overhead），不挡走位与寻路，
 * 使程序化建筑的门洞真正可通行（现有移动/导航碰撞检测忽略 AABB 的 y 区间）。 */
const OVERHEAD_Y = 2.2;

/* ---- 轴向盒合批：把 N 个 BoxGeometry 合成 1 个 BufferGeometry（细节几何防 draw call 爆炸） ---- */
let _unitBox = null;
function _mergeBoxes(boxes) {
  if (!boxes || !boxes.length) return null;
  if (!_unitBox) _unitBox = new THREE.BoxGeometry(1, 1, 1);
  const bp = _unitBox.attributes.position.array, bn = _unitBox.attributes.normal.array;
  const bu = _unitBox.attributes.uv.array, bi = _unitBox.index.array;
  const vc = _unitBox.attributes.position.count, ic = bi.length, n = boxes.length;
  const pos = new Float32Array(n * vc * 3), nor = new Float32Array(n * vc * 3), uv = new Float32Array(n * vc * 2);
  const idx = (n * vc > 65535) ? new Uint32Array(n * ic) : new Uint16Array(n * ic);
  for (let b = 0; b < n; b++) {
    const o = boxes[b], vo = b * vc;
    for (let v = 0; v < vc; v++) {
      const p3 = (vo + v) * 3, s3 = v * 3, p2 = (vo + v) * 2, s2 = v * 2;
      pos[p3] = bp[s3] * o.w + o.x;
      pos[p3 + 1] = bp[s3 + 1] * o.h + o.y;
      pos[p3 + 2] = bp[s3 + 2] * o.d + o.z;
      nor[p3] = bn[s3]; nor[p3 + 1] = bn[s3 + 1]; nor[p3 + 2] = bn[s3 + 2];
      uv[p2] = bu[s2]; uv[p2 + 1] = bu[s2 + 1];
    }
    for (let k = 0; k < ic; k++) idx[b * ic + k] = bi[k] + vo;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}
/* 环形（4 段）细节：檐口/分缝/勒脚 */
function _ringBoxes(out, cx, cz, sw, sd, y, hgt, thk) {
  const W = sw + thk * 2;
  out.push({ x: cx, y: y, z: cz - sd / 2 - thk / 2, w: W, h: hgt, d: thk });
  out.push({ x: cx, y: y, z: cz + sd / 2 + thk / 2, w: W, h: hgt, d: thk });
  out.push({ x: cx - sw / 2 - thk / 2, y: y, z: cz, w: thk, h: hgt, d: sd });
  out.push({ x: cx + sw / 2 + thk / 2, y: y, z: cz, w: thk, h: hgt, d: sd });
}

/* ---- 外部 GLB 插槽：在线尝试加载，离线/失败回退程序化几何 ----
 * 复用 models.js 的「加载 + 回退」范式；默认不启用（THREE.GLTFLoader 未挂全局时直接跳过）。 */
const GLBSlots = {
  _loader: null, _warned: false,
  enabled() {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return false;   // 未引入 loader → 纯程序化
    const loc = (typeof location !== 'undefined') ? location : null;
    if (loc && loc.protocol === 'file:') return false;                     // 离线双击 → 直接回退
    if (loc && /noglb=1/.test(loc.search || '')) return false;             // 调试开关
    return true;
  },
  loader() {
    if (!this._loader) this._loader = new THREE.GLTFLoader();
    return this._loader;
  },
  load(url, onOk, onFail) {
    if (!this.enabled()) {
      if (!this._warned) { this._warned = true; console.log('[GLB] 未启用外部 GLB（离线或未引入 GLTFLoader），全部使用程序化建筑'); }
      onFail && onFail(new Error('GLB 未启用'));
      return;
    }
    try {
      this.loader().load(url, g => { try { onOk(g); } catch (e) { onFail && onFail(e); } },
        undefined, e => onFail && onFail(e));
    } catch (e) { onFail && onFail(e); }
  }
};

/* ============================================================
 * TownGen · 小镇化外围街区生成器（v3.1）
 * ------------------------------------------------------------
 * 目标：把大地图外围补成可打的街区，而不是空地。
 * 只改数据（mapDef.buildings / roads / terrain.flatten / minimap），
 * 建筑仍走 placeModelBuilding（碰撞/导航/精修与手写建筑完全同权）。
 * 约束：
 *  - 只避让现有建筑、道路、据点、出生区；不会拆/改手写内容。
 *  - 生成物写进 mapDef._townDone，重复 World.load 不会重复叠加。
 *  - 建筑一律 trim:false（合批友好）；ry 只用 0，碰撞轴对齐可预测。
 * ============================================================ */
const TownGen = {
  _rng(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  _dims(b) {
    if (!b) return null;
    if (b.w && b.d) return { w: b.w, d: b.d, h: b.h || 4 };
    const lib = (typeof BuildingLib !== 'undefined') ? BuildingLib : null;
    if (lib && lib.dimsFor) {
      const d = lib.dimsFor(b.key, b.scale || 1);
      if (d) return d;
    }
    return null;
  },
  _hit(a, b, m) {
    m = m || 0;
    return a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
  },
  expand(mapDef) {
    const T = mapDef && mapDef.town;
    if (!T || mapDef._townDone) return;
    mapDef._townDone = true;
    const size = mapDef.size || CFG.WORLD;
    const rnd = this._rng(T.seed || 20261101);
    const occ = [];              // 不可放置建筑（建筑/道路/据点/出生区）
    const occOrig = [];          // 生成前已有内容（用于判断街道能否穿过）
    const pads = [];             // 新增 terrain.flattenPads
    const addRect = (arr, x0, z0, x1, z1, m) => arr.push({ x0: x0 - (m || 0), z0: z0 - (m || 0), x1: x1 + (m || 0), z1: z1 + (m || 0) });

    // 1) 现有建筑占地
    for (const b of (mapDef.buildings || [])) {
      const d = this._dims(b); if (!d) continue;
      if (b.type === 'proc') { addRect(occ, b.x - d.w / 2, b.z - d.d / 2, b.x + d.w / 2, b.z + d.d / 2, 2); addRect(occOrig, b.x - d.w / 2, b.z - d.d / 2, b.x + d.w / 2, b.z + d.d / 2, 2); }
      else { addRect(occ, b.x, b.z, b.x + d.w, b.z + d.d, 2); addRect(occOrig, b.x, b.z, b.x + d.w, b.z + d.d, 2); }
    }
    // 2) 现有道路
    const roads = mapDef.roads || (mapDef.roads = { strips: [], marks: [] });
    if (!roads.strips) roads.strips = [];
    if (!roads.marks) roads.marks = [];
    for (const s of roads.strips) {
      addRect(occ, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, 1);
      addRect(occOrig, s.x - s.w / 2, s.z - s.d / 2, s.x + s.w / 2, s.z + s.d / 2, 1);
    }
    // 3) 现有掩体/废墟（粗略，避免新楼压住掩体）
    for (const c of (mapDef.cover || [])) {
      if (!c) continue;
      if (c.t === 'box') addRect(occ, c.x - (c.w || 2) / 2, c.z - (c.d || 2) / 2, c.x + (c.w || 2) / 2, c.z + (c.d || 2) / 2, 0);
      else if (c.t === 'sandline' || c.t === 'barrier') {
        const L = c.len || 4;
        addRect(occ, c.x - (c.horiz ? L / 2 : 1), c.z - (c.horiz ? 1 : L / 2), c.x + (c.horiz ? L / 2 : 1), c.z + (c.horiz ? 1 : L / 2), 0);
      }
    }
    // 3b) 废墟/瞭望塔（避免新楼压住残墙与塔基）
    const ru = mapDef.ruins || {};
    for (const w of (ru.walls || [])) addRect(occ, w.x - w.w / 2, w.z - w.d / 2, w.x + w.w / 2, w.z + w.d / 2, 1);
    for (const r of (ru.rubble || [])) addRect(occ, r.x0, r.z0, r.x1, r.z1, 0);
    for (const t of ((mapDef.props || {}).towers || [])) addRect(occ, t[0] - 3, t[1] - 3, t[0] + 3, t[1] + 3, 0);
    // 4) 据点（band 据点由 spawns 推导）：保 26m 广场
    const caps = (typeof World !== 'undefined' && World.bandsCaps) ? World.bandsCaps(mapDef) : (mapDef.capturePoints || []);
    const flats = (mapDef.terrain && (mapDef.terrain.flatten || (mapDef.terrain.flatten = []))) || [];
    const mm = mapDef.minimap || (mapDef.minimap = { roads: [] });
    if (!mm.roads) mm.roads = [];
    for (const c of caps) {
      addRect(occ, c.x - 26, c.z - 26, c.x + 26, c.z + 26, 0);
      if (!(mm.plaza && Math.abs(mm.plaza.x - c.x) < 1 && Math.abs(mm.plaza.z - c.z) < 1)) {
        flats.push({ x0: c.x - 20, x1: c.x + 20, z0: c.z - 20, z1: c.z + 20 });
      }
    }
    // 5) 出生区：保 30m 并压平
    for (const team in (mapDef.spawns || {})) {
      for (const s of mapDef.spawns[team]) {
        const x = Array.isArray(s) ? s[0] : s.x, z = Array.isArray(s) ? s[1] : s.z;
        addRect(occ, x - 30, z - 30, x + 30, z + 30, 0);
        flats.push({ x0: x - 26, x1: x + 26, z0: z - 26, z1: z + 26 });
      }
    }
    // 5b) 机制点位：炮击圈/空投点保持开阔（避免新楼挡住落弹或压住补给）
    const mech = mapDef.mechanics;
    if (mech) {
      if (mech.arty && mech.arty.zone) {
        const az = mech.arty.zone, rr = (az.r || 8) + 6;
        addRect(occ, az.x - rr, az.z - rr, az.x + rr, az.z + rr, 0);
        flats.push({ x0: az.x - rr, x1: az.x + rr, z0: az.z - rr, z1: az.z + rr });
      }
      for (const d of (mech.drops || [])) {
        addRect(occ, d.x - 7, d.z - 7, d.x + 7, d.z + 7, 0);
      }
    }

    // 6) 街道：每条网格线一条长街；与旧建筑冲突则跳过
    const streetKeys = new Set();
    const addStreet = (x, z, w, d) => {
      const key = Math.round(x) + ':' + Math.round(z) + ':' + Math.round(w) + ':' + Math.round(d);
      if (streetKeys.has(key)) return;
      streetKeys.add(key);
      const r = { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 };
      for (const o of occOrig) if (this._hit(r, o, 0)) return;
      roads.strips.push({ x: x, z: z, w: w, d: d, h: 0.12 });
      flats.push({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
      mm.roads.push({ x: x, z: z, w: w, d: d });
      addRect(occ, r.x0, r.z0, r.x1, r.z1, 1);
    };

    const blocks = [];
    for (const dist of (T.districts || [])) {
      const xs = [], zs = [];
      for (let x = dist.x0; x <= dist.x1 + 0.1; x += dist.gw) xs.push(Math.min(x, dist.x1));
      for (let z = dist.z0; z <= dist.z1 + 0.1; z += dist.gd) zs.push(Math.min(z, dist.z1));
      for (const x of xs) addStreet(x, (dist.z0 + dist.z1) / 2, dist.street || 12, dist.z1 - dist.z0);
      for (const z of zs) addStreet((dist.x0 + dist.x1) / 2, z, dist.x1 - dist.x0, dist.street || 12);
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const sw = dist.street || 12;
        const x0 = xs[i] + sw / 2 + 2, x1 = xs[i + 1] - sw / 2 - 2;
        const z0 = zs[j] + sw / 2 + 2, z1 = zs[j + 1] - sw / 2 - 2;
        if (x1 - x0 < 14 || z1 - z0 < 14) continue;
        blocks.push({ x0, z0, x1, z1, dist });
      }
    }
    // 打乱街区顺序，让各地块均匀分布（而不是先填满北区）
    for (let i = blocks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = blocks[i]; blocks[i] = blocks[j]; blocks[j] = t; }

    // 7) 沿街区南北边缘布置建筑
    const paletteFor = (style) => (T.palette && T.palette[style]) || [0x8a8f86];
    const pickKind = (style, maxW, maxD) => {
      const ks = (T.styles && T.styles[style]) || []; if (!ks.length) return null;
      for (let i = 0; i < 8; i++) {
        const k = ks[Math.floor(rnd() * ks.length)];
        const d = this._dims({ key: k, scale: 1 }); if (!d) continue;
        if (d.w <= maxW && d.d <= maxD) return { key: k, d };
      }
      return null;
    };
    let placed = 0;
    const max = T.max || 80;
    const tryPlace = (kind, x, z) => {
      if (x < 2 || z < 2 || x + kind.d.w > size - 2 || z + kind.d.d > size - 2) return false;
      const r = { x0: x, z0: z, x1: x + kind.d.w, z1: z + kind.d.d };
      for (const o of occ) if (this._hit(r, o, T.margin || 3)) return false;
      const pal = paletteFor(kind.style);
      mapDef.buildings.push({
        type: 'model', key: kind.key, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10,
        ry: 0, scale: 1, tint: pal[Math.floor(rnd() * pal.length)], trim: false
      });
      addRect(occ, r.x0, r.z0, r.x1, r.z1, T.margin || 3);
      pads.push([(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, kind.d.w, kind.d.d]);
      placed++;
      return true;
    };
    for (const b of blocks) {
      if (placed >= max) break;
      const style = b.dist.style || 'residential';
      const dens = b.dist.density !== undefined ? b.dist.density : 0.7;
      const perBlock = T.perBlock || 3; // 每块上限：防止前面街区吃满配额、后面整块空置
      let blockPlaced = 0;
      // 四边沿街立面（每条边最多 6 个槽位；密度按街区风格）
      for (const row of ['south', 'north', 'west', 'east']) {
        if (placed >= max || blockPlaced >= perBlock) break;
        let guard = 0;
        if (row === 'south' || row === 'north') {
          let cx = b.x0 + 2 + rnd() * 5;
          while (cx < b.x1 - 8 && guard++ < 6) {
            const kind = pickKind(style, b.x1 - cx - 2, (b.z1 - b.z0) / 2 - 3);
            if (!kind) break;
            kind.style = style;
            const z = row === 'south' ? b.z1 - kind.d.d - 2 : b.z0 + 2;
            if (rnd() < dens && tryPlace(kind, cx, z)) { cx += kind.d.w + 3 + rnd() * 5; blockPlaced++; }
            else cx += Math.min(12, kind.d.w) + 3 + rnd() * 4;
            if (placed >= max || blockPlaced >= perBlock) break;
          }
        } else {
          let cz = b.z0 + 2 + rnd() * 5;
          while (cz < b.z1 - 8 && guard++ < 6) {
            const kind = pickKind(style, b.x1 - b.x0 - 4, b.z1 - cz - 2);
            if (!kind) break;
            kind.style = style;
            const x = row === 'west' ? b.x0 + 2 : b.x1 - kind.d.w - 2;
            if (rnd() < dens && tryPlace(kind, x, cz)) { cz += kind.d.d + 3 + rnd() * 5; blockPlaced++; }
            else cz += Math.min(10, kind.d.d) + 3 + rnd() * 4;
            if (placed >= max || blockPlaced >= perBlock) break;
          }
        }
      }
      // 大块内部补一栋（公寓/仓库/货柜），避免大块只有一圈薄边
      if (placed < max && blockPlaced < perBlock && (b.x1 - b.x0) > 38 && (b.z1 - b.z0) > 34) {
        const kind = pickKind(style, Math.min(22, (b.x1 - b.x0) - 10), Math.min(18, (b.z1 - b.z0) - 10));
        if (kind && rnd() < dens * 0.65) {
          kind.style = style;
          tryPlace(kind, (b.x0 + b.x1) / 2 - kind.d.w / 2, (b.z0 + b.z1) / 2 - kind.d.d / 2);
        }
      }
    }
    // 8) 写回地形压平与小地图
    if (mapDef.terrain) {
      if (!mapDef.terrain.flattenPads) mapDef.terrain.flattenPads = [];
      for (const p of pads) mapDef.terrain.flattenPads.push(p);
    }
    console.log('[Town] ' + (mapDef.id || '?') + ' 新增街区建筑 ' + placed + ' 栋 | 新街道 ' + streetKeys.size + ' 条');
  }
};

const World = {
  scene: null, colliders: [], walls: [], platforms: [], overhead: [], grid: null,
  terrainH: null, minimapStatic: null, spawns: { blue: [], red: [] }, navDoors: [],
  capturePoints: [], capMeshes: [],
  objects: [],            // 本图创建的场景根级对象（用于换图卸载）
  mapDef: null, mapId: null,
  _grp: null, _gen: 0, _detail: 2, _matCache: {}, _batchMeshes: [], _batchMat: null,

  DETAIL: { off: 0, none: 0, low: 1, high: 2, full: 2 },

  /* ============ 入口 ============ */
  /* 便捷封装：用注册表里的地图（不传 id → 默认图） */
  init(scene, mapId) {
    let def = (typeof MapRegistry !== 'undefined' && MapRegistry) ? MapRegistry.get(mapId) : null;
    if (!def) {
      console.warn('[World] 未找到地图定义' + (mapId ? ' "' + mapId + '"' : '') + '，使用内置兜底空场');
      def = this.FALLBACK;
    }
    return this.load(scene, def);
  },

  /* 核心：按 mapDef 构建整张地图 */
  load(scene, mapDef) {
    this.scene = scene;
    if (!mapDef) return this.init(scene);
    if (typeof MapRegistry !== 'undefined' && MapRegistry.validate) {
      const err = MapRegistry.validate(mapDef);
      if (err) { console.warn('[World] mapDef 非法（' + err + '），使用内置兜底空场'); mapDef = this.FALLBACK; }
    }
    this.unload();
    this.mapDef = mapDef;
    this.mapId = mapDef.id;
    if (mapDef.size && mapDef.size !== CFG.WORLD) CFG.WORLD = mapDef.size;
    // §4.7 地图尺寸归一化：mapScale 用于空间类距离（出生扩散/救援半径/散兵线）。
    // v3.1：小镇图 700~740m 若按 size/300 线性放大（2.3~2.5×），出生会散到 140m 外、救援半径离谱；
    //       上限锁 1.5（旧 suburb 450 的值），大地图只放大玩法空间，不无限放大交互距离。
    CFG.mapScale = U.clamp((mapDef.size || CFG.WORLD) / 300, 0.8, 1.5);
    this._detail = this._resolveDetail(mapDef.detail);

    // v3.2 模型自描述元数据：GLB extras 为唯一事实源，运行时同步到 BuildingLib（REAL_DIMS/CONFIGS）
    this.syncBuildingMeta();
    // v3.2 小镇化：在构建地形/道路/建筑前展开外围街区（只改数据，建筑仍走统一管线）
    if (typeof TownGen !== 'undefined' && TownGen.expand) TownGen.expand(mapDef);

    Tex.setupOverrides();
    this.buildEnv(mapDef.env || {});
    this.buildTerrain(mapDef.terrain || {});
    this.buildRoads(mapDef.roads || {});
    this.buildBuildings(mapDef.buildings || []);
    this.batchStaticBuildings();
    this.buildCover(mapDef.cover || []);
    this.buildRuins(mapDef.ruins || {});
    this.buildProps(mapDef.props || {});
    // v2.9 据点=3 条带地带：地图按 z 三等分，每带一个据点（band 标志 → 判定用条带区域而非圆），覆盖整图
    this.buildCapturePoints(this.bandsCaps(mapDef) || mapDef.capturePoints || []);
    this.buildNavGrid();
    this.buildMinimapStatic(mapDef.minimap || {});
    this.genSpawns(mapDef.spawns || {});
    // v1.2：地图机制（探照灯/沙暴/空投炮击）；Mechanics 未加载/无数据 → 无操作
    if (typeof Mechanics !== 'undefined' && Mechanics.init) Mechanics.init(this.mapDef);
    console.log('[World] 地图 "' + mapDef.name + '" (' + mapDef.id + ') 构建完成 | 碰撞体 ' + this.colliders.length +
      ' | 平台 ' + this.platforms.length + ' | 精修等级 ' + this._detail);
    return this;
  },

  /* v3.2：把每个 GLB 的 extras.battlegame 同步进 BuildingLib（尺寸 + 碰撞/平台/门洞）。
   * 没有 extras 的旧模型保持手写 CONFIGS（container/watchtower 等未替换类型）。 */
  syncBuildingMeta() {
    if (typeof AssetLoader === 'undefined' || !AssetLoader.buildingMeta) return;
    const lib = (typeof BuildingLib !== 'undefined') ? BuildingLib : null;
    if (!lib) return;
    for (const k of Object.keys(AssetLoader.cache.buildings || {})) {
      const m = AssetLoader.buildingMeta(k);
      if (!m) continue;
      if (m.dims) lib.REAL_DIMS[k] = m.dims;
      lib.CONFIGS[k] = { colliders: m.colliders || [], platforms: m.platforms || [], doors: m.doors || [] };
    }
  },

  /* 卸载当前地图（换图用）：移除场景对象 + 清空空间数据 */
  unload() {
    this._gen++;
    if (this.scene) {
      for (const o of this.objects) {
        this.scene.remove(o);
        o.traverse && o.traverse(c => { if (c.geometry) c.geometry.dispose(); });
      }
    }
    this.objects = [];
    this.colliders = []; this.walls = []; this.platforms = []; this.overhead = [];
    this.capturePoints = []; this.capMeshes = [];
    this.grid = null; this.terrainH = null; this.minimapStatic = null;
    this.spawns = { blue: [], red: [] };
    this.navDoors = [];
    this.sun = null; this.sunTarget = null;
    this._batchMeshes = [];
    return this;
  },

  _resolveDetail(v) {
    const loc = (typeof location !== 'undefined') ? location : null;
    const m = loc && /[?&]detail=(\w+)/.exec(loc.search || '');
    const key = m ? m[1] : v;
    if (key === undefined || key === null) return 2;
    if (typeof key === 'number') return U.clamp(key | 0, 0, 2);
    return this.DETAIL[key] !== undefined ? this.DETAIL[key] : 2;
  },
  /* 某栋建筑的精修等级（C1：地图级一票否决——建筑级只能在地图级允许集内提升，不能反超。
   * ?detail=off 下 World._detail=0 → 建筑级显式 detail:'high' 也被压回 0，LOD 逃生舱对全图生效） */
  detailLevel(opts) {
    const mapLvl = this._detail;
    if (!opts) return mapLvl;
    let lvl = mapLvl;
    if (opts.detail === false || opts.trim === false) lvl = 0;
    else if (typeof opts.detail === 'string') lvl = this.DETAIL[opts.detail] !== undefined ? this.DETAIL[opts.detail] : lvl;
    else if (typeof opts.detail === 'number') lvl = U.clamp(opts.detail | 0, 0, 2);
    return Math.min(lvl, mapLvl);
  },

  /* 场景挂载：建筑构建期间挂到临时组（便于 GLB 整体替换），否则直接挂场景并登记 */
  _attach(obj) {
    if (this._grp) { this._grp.add(obj); return obj; }
    this.scene.add(obj);
    this.objects.push(obj);
    return obj;
  },
  /* 共享材质缓存（细节几何全图共用，避免材质数量爆炸） */
  sharedMat(name, repeat, color) {
    const key = name + '|' + (repeat || 1) + '|' + (color || 0);
    if (this._matCache[key]) return this._matCache[key];
    const m = color
      ? new THREE.MeshLambertMaterial({ color: color })
      : new THREE.MeshLambertMaterial({ map: Tex.get(name, repeat || 1, 1) });
    this._matCache[key] = m;
    return m;
  },
  /* 不受光材质缓存（D-12/D-13：灯/旗/导航标线必须 Basic，夜景可读性红线） */
  basicMat(name, color) {
    const key = 'basic:' + name + ':' + (color || 0);
    if (this._matCache[key]) return this._matCache[key];
    const m = new THREE.MeshBasicMaterial({ color: color });
    this._matCache[key] = m;
    return m;
  },

  /* ============ 环境 ============ */
  buildEnv(e) {
    const fog = e.fog || { color: 0x8fb4cc, near: 80, far: 340 };
    this.scene.fog = new THREE.Fog(fog.color, fog.near, fog.far);
    this.scene.background = new THREE.Color(e.background !== undefined ? e.background : fog.color);
    const hemi = e.hemi || { sky: 0xdfe9ff, ground: 0x3d4a3a, intensity: 0.85 };
    this._attach(new THREE.HemisphereLight(hemi.sky, hemi.ground, hemi.intensity));
    const s = e.sun || { color: 0xfff2d8, intensity: 1.4, pos: [120, 160, 80], shadow: { mapSize: 1024, extent: 130, far: 400 } };
    const sun = new THREE.DirectionalLight(s.color, s.intensity);
    sun.position.set(s.pos[0], s.pos[1], s.pos[2]);
    sun.castShadow = true;
    // D-05/T-04：阳光目标点 + 阴影范围按地图尺寸推导，否则 60%+ 地图无投影
    const sz = CFG.WORLD;
    const tx = s.target ? s.target[0] : sz * 0.5, tz = s.target ? s.target[1] : sz * 0.5;
    sun.target.position.set(tx, 0, tz);
    sun.target.updateMatrixWorld();
    this._attach(sun.target); // target 必须入场景，否则矩阵不更新
    const sh = s.shadow || {};
    sun.shadow.mapSize.set(sh.mapSize || 2048, sh.mapSize || 2048);
    // v3.1：大图不再整图覆盖阴影（2048 贴图铺 700m 只剩 0.34m/texel），改为跟随玩家 ~170m
    const ext = sh.extent || 170;
    sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
    sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
    sun.shadow.camera.far = sh.far || 420;
    this._attach(sun);
    this.sun = sun; this.sunTarget = sun.target; this._sunOff = [120, 160, 80];
    const amb = e.ambient || { color: 0x8899aa, intensity: 0.25 };
    this._attach(new THREE.AmbientLight(amb.color, amb.intensity));
  },

  /* v3.1：阴影相机跟随玩家（每 ~0.25s 调用一次；小范围=高精度+更少阴影绘制） */
  updateSun(px, pz) {
    if (!this.sun || !this.sunTarget) return;
    const o = this._sunOff || [120, 160, 80];
    this.sun.position.set(px + o[0], o[1], pz + o[2]);
    this.sunTarget.position.set(px, 0, pz);
    this.sunTarget.updateMatrixWorld();
    if (this.sun.shadow && this.sun.shadow.camera) this.sun.shadow.camera.updateMatrixWorld();
  },

  /* ============ 地形：噪声起伏 + 土丘 + 压平区 ============ */
  buildTerrain(t) {
    const n = makeNoise2D(t.seed !== undefined ? t.seed : 20260805);
    const amp = t.amp !== undefined ? t.amp : 4.4;
    const flatY = t.flatY !== undefined ? t.flatY : 0;
    const pad = t.flattenPad !== undefined ? t.flattenPad : 4;
    const mounds = t.mounds || [];
    const flatten = [];
    for (const f of t.flatten || []) flatten.push({ x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1 });
    for (const b of t.flattenPads || []) {
      flatten.push({ x0: b[0] - b[2] / 2 - pad, x1: b[0] + b[2] / 2 + pad, z0: b[1] - b[3] / 2 - pad, z1: b[1] + b[3] / 2 + pad });
    }

    this.terrainH = function (x, z) {
      let h = (n(x, z) - 0.5) * amp;
      for (let i = 0; i < mounds.length; i++) {
        const m = mounds[i];
        const dx = x - m.x, dz = z - m.z;
        const v = m.peak - Math.sqrt(dx * dx + dz * dz) / m.falloff;
        if (v > 0) h += v * m.scale;
      }
      for (let i = 0; i < flatten.length; i++) {
        const f = flatten[i];
        if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) { h = flatY; break; }
      }
      return h;
    };

    const seg = t.seg || 128;
    const geo = new THREE.PlaneGeometry(CFG.WORLD, CFG.WORLD, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(CFG.WORLD / 2, 0, CFG.WORLD / 2); // 平移到世界 [0,W]×[0,W]（否则只有西南象限有地面）
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cols = t.colors || [0x4a6b3c, 0x5c6e52];
    const gCol = new THREE.Color(cols[0]), rCol = new THREE.Color(cols[1] !== undefined ? cols[1] : cols[0]);
    const mix = t.colorMix !== undefined ? t.colorMix : 0.5;
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, this.terrainH(pos.getX(i), pos.getZ(i)));
      const c = Math.random() < mix ? gCol : rCol;
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    mesh.receiveShadow = true;
    this._attach(mesh);
  },

  /* ============ 道路（压平区上铺沥青平面） ============ */
  buildRoads(r) {
    const strips = r.strips || [], marks = r.marks || [];
    if (strips.length) {
      const mat = new THREE.MeshLambertMaterial({ map: Tex.get(r.tex || 'asphalt', r.repeat || 40, 1) });
      const th = r.thick || 0.12;
      for (const s of strips) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h || th, s.d), mat);
        m.position.set(s.x, (s.h || th) / 2, s.z);
        m.receiveShadow = true;
        this._attach(m);
      }
    }
    if (marks.length) {
      const lm = new THREE.MeshBasicMaterial({ color: r.markColor !== undefined ? r.markColor : 0xd8d8c0 });
      const my = r.markY !== undefined ? r.markY : 0.16;
      for (const k of marks) {
        for (let v = k.from; v < k.to; v += k.step) {
          const g = k.axis === 'z' ? new THREE.PlaneGeometry(k.w, k.len) : new THREE.PlaneGeometry(k.len, k.w);
          const m = new THREE.Mesh(g, lm);
          m.rotation.x = -Math.PI / 2;
          if (k.axis === 'z') m.position.set(k.at, my, v); else m.position.set(v, my, k.at);
          this._attach(m);
        }
      }
    }
  },

  /* ============ 建筑 ============ */
  addWall(meshMat, x, z, w, d, h, ry, matIdx, castShadow, baseY) {
    const by = baseY || 0;
    // AABB 碰撞体（世界轴向，纯数据，与 Mesh 完全解耦 —— 精修/合批不影响玩法 D-11）
    const hw = w / 2, hd = d / 2;
    const box = { min: new THREE.Vector3(x - hw, by, z - hd), max: new THREE.Vector3(x + hw, by + h, z + hd) };
    if (by >= OVERHEAD_Y) this.overhead.push(box);   // 门楣/上层墙：只挡弹道
    else { this.colliders.push(box); this.walls.push(box); }
    return { x: x, y: by + h / 2, z: z, w: w, h: h, d: d }; // 供 buildBuilding 合批成 1 个 mesh
  },

  /* 程序化建筑：外墙扫描线开洞（门/窗）+ 多楼层 + 屋顶平台 + 精修细节 */
  buildBuilding(x, z, w, d, h, opts) {
    opts = opts || {};
    const t = opts.thick || 0.5, floorH = opts.floorH || 3.0;
    const floors = opts.floors || 1;
    if (!(typeof h === 'number' && h > 0)) h = floors * floorH; // D-07：h 缺失时按层高推导
    const roofY = h;                                             // 屋顶/檐口/烟囱/坡道一律对齐 h
    const lvl = this.detailLevel(opts);
    const matW = new THREE.MeshLambertMaterial({ map: Tex.get(opts.wallTex || 'brick', Math.max(1, Math.round(w / 6)), 1) });
    const matF = new THREE.MeshLambertMaterial({ map: Tex.get('floor', Math.max(1, Math.round(w / 4)), 1) });
    const matR = new THREE.MeshLambertMaterial({ map: Tex.get('roof', 4, 1) });
    const x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2;

    const grp = new THREE.Group();
    const prevGrp = this._grp;
    this._grp = grp;                       // 本栋建筑的所有网格进同一组（GLB 替换/卸载友好）
    const det = [];                        // 精修细节盒（最后合批成 1 个 mesh）
    const wallBoxes = [];                  // D-11：墙段几何（碰撞已是纯数据，几何合批成 1 个 mesh）
    const darkBoxes = [];                  // 新精修部件①：窗内暗腔（单独暗色合批，避免一眼看穿）

    // 楼层地板（地面层薄板 + 上层楼板 + 屋顶）
    const slab = (sx, sz, sw, sd, sy, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.28, sd), m);
      mesh.position.set(sx, sy, sz); mesh.receiveShadow = true; this._attach(mesh);
    };
    slab(x, z, w, d, 0.14, matF);
    for (let f = 1; f < floors; f++) slab(x, z, w - t * 2, d - t * 2, f * floorH, matF);
    slab(x, z, w, d, roofY, matR);

    // 面定义：0 南(z0) 1 东(x1) 2 北(z1) 3 西(x0)；sign = 外法线方向
    const faces = [
      { horiz: true, c: z0, sign: -1 },
      { horiz: false, c: x1, sign: 1 },
      { horiz: true, c: z1, sign: 1 },
      { horiz: false, c: x0, sign: -1 }
    ];
    // 面局部坐标(u 沿墙, y 世界高, o 沿外法线偏移) → 世界盒
    const pushF = (fc, uc, yc, oc, us, ys, os) => {
      if (fc.horiz) det.push({ x: x0 + uc, y: yc, z: fc.c + fc.sign * oc, w: us, h: ys, d: os });
      else det.push({ x: fc.c + fc.sign * oc, y: yc, z: z0 + uc, w: os, h: ys, d: us });
    };

    for (let f = 0; f < floors; f++) {
      const fy = f * floorH;
      const wallTop = Math.min(h - fy, floorH); // D-01/D-02：每层只建到本层层顶，不建到建筑顶（避免堵死上层窗 + 跨层共面重叠）
      faces.forEach((fc, wi) => {
        const len = fc.horiz ? w : d;
        const opens = [];
        if (f === 0 && opts.doors && opts.doors[wi]) {
          for (const du of opts.doors[wi]) opens.push({ u0: du[0], u1: du[1], y0: 0, y1: opts.doorH || 2.6, kind: 'door' });
        }
        if (opts.windows) {
          const ws = opts.windows; // 每面窗数
          for (let k = 1; k <= ws; k++) {
            const cu = (len / (ws + 1)) * k - 0.7;
            opens.push({ u0: cu, u1: cu + 1.4, y0: 1.1, y1: 2.3, kind: 'window' });
          }
        }
        opens.sort((a, b) => a.u0 - b.u0);
        // 扫描线：整墙 → 开洞 → 剩余矩形集合
        const segs = []; let prev = 0;
        for (const o of opens) {
          const a = Math.max(0, Math.min(len, o.u0)), b = Math.max(0, Math.min(len, o.u1));
          if (a > prev) segs.push({ u0: prev, u1: a, y0: 0, y1: wallTop });
          if (o.y0 > 0) segs.push({ u0: a, u1: b, y0: 0, y1: o.y0 });          // 窗下沿
          if (o.y1 < wallTop) segs.push({ u0: a, u1: b, y0: o.y1, y1: wallTop }); // 窗上沿/门楣
          prev = Math.max(prev, b);
        }
        if (prev < len) segs.push({ u0: prev, u1: len, y0: 0, y1: wallTop });
        // 每段墙收集几何描述符（碰撞已在 addWall 内入 colliders/overhead）
        for (const s of segs) {
          if (s.u1 - s.u0 < 0.05 || s.y1 - s.y0 < 0.05) continue;
          const uc = (s.u0 + s.u1) / 2, ul = s.u1 - s.u0, bh = s.y1 - s.y0;
          const wb = fc.horiz
            ? this.addWall(matW, x0 + uc, fc.c + fc.sign * t / 2, ul + t, t, bh, 0, null, true, fy + s.y0)
            : this.addWall(matW, fc.c + fc.sign * t / 2, z0 + uc, t, ul + t, bh, 0, null, true, fy + s.y0);
          if (wb) wallBoxes.push(wb);
        }
        /* ---- 精修：窗框 / 窗台 / 门框 ---- */
        if (lvl >= 1) {
          for (const o of opens) {
            const ya = fy + o.y0, yb = fy + o.y1, uc = (o.u0 + o.u1) / 2, ul = o.u1 - o.u0;
            const isDoor = o.kind === 'door';
            const bw = isDoor ? 0.17 : 0.13;              // 框料宽
            const fd = isDoor ? 0.18 : 0.15;              // 框料外凸厚
            const oc = t + fd / 2 - 0.03;
            if (lvl >= 2) {
              pushF(fc, o.u0, (ya + yb) / 2, oc, bw, (yb - ya) + bw * 2, fd); // 左立梃
              pushF(fc, o.u1, (ya + yb) / 2, oc, bw, (yb - ya) + bw * 2, fd); // 右立梃
              pushF(fc, uc, yb, oc, ul + bw * 2, bw, fd);                     // 上冒头
              if (!isDoor) pushF(fc, uc, ya, oc, ul + bw * 2, bw, fd);        // 下冒头
            }
            if (!isDoor) pushF(fc, uc, ya - 0.1, t / 2 + 0.15, ul + 0.4, 0.13, t + 0.3); // 窗台
            else pushF(fc, uc, yb + 0.16, t / 2 + 0.22, ul + 0.7, 0.16, t + 0.44);       // 门楣挑檐
            // 新精修部件①：窗内暗腔 —— 窗洞内衬暗色薄板（向内收 0.05），避免一眼看穿对面
            if (!isDoor) {
              const cy = (ya + yb) / 2;
              darkBoxes.push(fc.horiz
                ? { x: x0 + uc, y: cy, z: fc.c - fc.sign * (t / 2 - 0.05), w: Math.max(0.1, ul - 0.1), h: Math.max(0.1, (yb - ya) - 0.1), d: 0.08 }
                : { x: fc.c - fc.sign * (t / 2 - 0.05), y: cy, z: z0 + uc, w: 0.08, h: Math.max(0.1, (yb - ya) - 0.1), d: Math.max(0.1, ul - 0.1) });
            }
          }
        }
      });
    }

    /* ---- 精修：墙面水平分缝线 / 檐口压顶 / 勒脚 ---- */
    if (lvl >= 1) {
      const sw = w + t * 2, sd = d + t * 2;
      for (let f = 1; f < floors; f++) _ringBoxes(det, x, z, sw, sd, f * floorH, 0.18, 0.09);
      _ringBoxes(det, x, z, sw, sd, roofY + 0.2, 0.44, 0.3);                    // 檐口/女儿墙压顶（对齐 h）
      if (opts.plinth) _ringBoxes(det, x, z, sw, sd, 0.3, 0.6, 0.14);          // 勒脚（会横穿门洞，默认关）
    }
    /* ---- 精修：阳台栏杆 ---- */
    if (lvl >= 2 && floors >= 2) {
      // D-08：默认不开阳台；显式 balcony:true 才自动生成，或提供显式 balconies[] 列表
      // D-09：balconies 数组只读（slice 防污染 mapDef）
      const hasList = Array.isArray(opts.balconies) && opts.balconies.length > 0;
      const list = (opts.balconies || []).slice();
      if (!hasList && opts.balcony === true) {
        const side = opts.balconySide !== undefined ? opts.balconySide : 0;
        const flen = (side % 2 === 0 ? w : d);
        for (let f = 1; f < floors; f++) list.push({ floor: f, side: side, u: flen * 0.25, len: flen * 0.5 });
      }
      for (const b of list) {
        const fc = faces[b.side % 4], fy = b.floor * floorH, bd = b.depth || 1.4;
        const uc = b.u + b.len / 2;
        pushF(fc, uc, fy + 0.09, t + bd / 2, b.len, 0.18, bd);                    // 挑板
        pushF(fc, uc, fy + 0.62, t + bd - 0.06, b.len, 1.0, 0.12);                // 外栏板
        pushF(fc, b.u, fy + 0.62, t + bd / 2, 0.12, 1.0, bd);                     // 侧栏板
        pushF(fc, b.u + b.len, fy + 0.62, t + bd / 2, 0.12, 1.0, bd);
        pushF(fc, uc, fy + 1.17, t + bd / 2 - 0.02, b.len + 0.16, 0.1, bd + 0.16); // 扶手
      }
    }
    /* ---- 精修：烟囱 ---- */
    if (lvl >= 2 && opts.chimney !== false && floors <= 2) {
      const ch = (typeof opts.chimney === 'object') ? opts.chimney : {};
      const cw = ch.w || 0.9, cd = ch.d || 0.9, chh = ch.h || 1.9;
      const cx = ch.x !== undefined ? x0 + ch.x : x + w * 0.28;
      const cz = ch.z !== undefined ? z0 + ch.z : z + d * 0.28;
      const base = roofY + 0.14;
      det.push({ x: cx, y: base + chh / 2, z: cz, w: cw, h: chh, d: cd });
      det.push({ x: cx, y: base + chh + 0.08, z: cz, w: cw + 0.24, h: 0.16, d: cd + 0.24 }); // 烟囱帽
    }

    // 一层室内家具（制造近身战掩体，让建筑内部有玩头）
    const fMat = this.sharedMat('furnA', 1, 0x8a7355);
    const fMat2 = this.sharedMat('furnB', 1, 0x6b5a42);
    const furn = (fx, fz, fw, fh, fd, m) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, fd), m);
      mesh.position.set(fx, fh / 2, fz); mesh.castShadow = true; mesh.receiveShadow = true;
      this._attach(mesh);
      this.colliders.push({ min: new THREE.Vector3(fx - fw / 2, 0, fz - fd / 2), max: new THREE.Vector3(fx + fw / 2, fh, fz + fd / 2) });
    };
    if (w > 16 && d > 14) {        // 大房间：桌 + 柜
      furn(x - w * 0.2, z - d * 0.2, 2.6, 1.15, 1.5, fMat);
      furn(x + w * 0.18, z + d * 0.16, 2.1, 1.5, 0.95, fMat2);
    } else if (w > 10) {           // 小房间：单柜
      furn(x - w * 0.15, z - d * 0.15, 1.8, 1.4, 0.9, fMat2);
    }

    // 屋顶平台（可站上，含外部坡道）
    if (opts.rooftop) {
      this.platforms.push({ x0, x1, z0, z1, y: roofY });
      const r = opts.rooftop;
      const pm = this.sharedMat('concrete', 3);
      const rail = (px, pz, pw, pd) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(pw, 0.7, pd), pm);
        m.position.set(px, roofY + 0.35, pz); m.castShadow = true; this._attach(m);
      };
      rail(x, z0, w, 0.3); rail(x, z1, w, 0.3); rail(x0, z, 0.3, d); rail(x1, z, 0.3, d);
      const rampW = 3, rampLen = 16;
      const rx = r.side === 'east' ? x1 + 1 : x0 - 1 - rampW;
      const rmx = rx + rampW / 2;
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(rampW, roofY, rampLen), matR);
      ramp.position.set(rmx, roofY / 2, z);
      ramp.rotation.z = r.side === 'east' ? -Math.atan2(roofY, rampLen) : Math.atan2(roofY, rampLen);
      ramp.castShadow = true; ramp.receiveShadow = true; this._attach(ramp);
      this.platforms.push({ x0: rx, x1: rx + rampW, z0: z - rampLen / 2, z1: z + rampLen / 2, y0: 0, y1: roofY, ramp: true, dir: r.side === 'east' ? 1 : -1 });
    }

    /* ---- 新精修部件②：雨落管（四角竖向细盒，随 detail 合批，纯视觉） ---- */
    if (lvl >= 2 && opts.downpipe !== false) {
      const dp = opts.downpipeW || 0.13;
      const corners = [[x0 - dp / 2, z0 - dp / 2], [x0 - dp / 2, z1 + dp / 2], [x1 + dp / 2, z0 - dp / 2], [x1 + dp / 2, z1 + dp / 2]];
      for (const [cx2, cz2] of corners) det.push({ x: cx2, y: (roofY + 0.15) / 2, z: cz2, w: dp, h: roofY + 0.15, d: dp });
    }
    /* ---- 新精修部件③：屋顶设备（AC 机组 + 通风口凸台，纯视觉） ---- */
    if (lvl >= 2 && opts.ac !== false) {
      const aw = 0.9, ad = 0.9, ah = 0.7;
      const acx = x + w * 0.22, acz = z + d * 0.25;
      det.push({ x: acx, y: roofY + ah / 2, z: acz, w: aw, h: ah, d: ad });
      det.push({ x: acx, y: roofY + ah + 0.08, z: acz, w: aw * 0.6, h: 0.16, d: ad * 0.6 });
    }

    // D-11：墙段几何合批成 1 个 mesh（碰撞已在 addWall 入 colliders/overhead，纯视觉）
    const wg = _mergeBoxes(wallBoxes);
    if (wg) {
      const wm = new THREE.Mesh(wg, matW);
      wm.castShadow = true; wm.receiveShadow = true;
      grp.add(wm);
    }

    // 细节合批（全图共享一份材质）
    const dg = _mergeBoxes(det);
    if (dg) {
      const dm = new THREE.Mesh(dg, this.sharedMat(opts.detailTex || 'concrete', 2));
      dm.castShadow = true; dm.receiveShadow = true;
      grp.add(dm);
    }
    // 新精修部件①：窗内暗腔合批（Basic 暗色不受光，保证「暗腔」语义，夜景一致）
    const dkg = _mergeBoxes(darkBoxes);
    if (dkg) {
      const dk = new THREE.Mesh(dkg, this.basicMat('windowDark', 0x0d1014));
      dk.receiveShadow = true;
      grp.add(dk);
    }

    this._grp = prevGrp;
    this._attach(grp);
    // GLB 插槽（proc 路径）：外部模型替换视觉，碰撞/导航仍来自程序化数据；
    // 离线/失败/无 glb 字段静默回退（ADR-003）。proc 建筑轴对齐（ry 无效），
    // 传 ry:0 防止 GLB 旋转与程序化几何错位（proc+glb 请保持 ry:0）。
    if (opts.glb) this.glbSlot(Object.assign({}, opts, { ry: 0 }), grp, { w: w, d: d, h: h });
    return grp;
  },

  /* 模型建筑（BuildingLib 内联 GLB 数据）+ 程序化精修外挂件 */
  /* D-03：把 AABB 碰撞盒绕角点 (ox,oz) 旋转 rad 后取轴向包围盒
   * 旋转约定与 THREE 的 mesh.rotation.y 一致：x' = dx·cos + dz·sin，z' = −dx·sin + dz·cos
   * 90° 倍数 → 精确（当前数据全为此）；其它角度 → 保守过覆盖（不产生可见墙无碰撞） */
  _rotateAABB(box, ox, oz, rad) {
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const cx = (box.min.x + box.max.x) / 2 - ox, cz = (box.min.z + box.max.z) / 2 - oz;
    const hw = (box.max.x - box.min.x) / 2, hd = (box.max.z - box.min.z) / 2;
    let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
    for (const px of [-hw, hw]) for (const pz of [-hd, hd]) {
      const dx = cx + px, dz = cz + pz;
      const rx = dx * cos + dz * sin + ox, rz = -dx * sin + dz * cos + oz;
      mnx = Math.min(mnx, rx); mxx = Math.max(mxx, rx); mnz = Math.min(mnz, rz); mxz = Math.max(mxz, rz);
    }
    box.min.x = mnx; box.max.x = mxx; box.min.z = mnz; box.max.z = mxz;
  },
  /* D-03：model 建筑 colliders 绕角点按 ry 旋转（与视觉对齐） */
  rotateColliders(b, list) {
    const rad = (b.ry || 0) * Math.PI / 180;
    if (!rad || !list) return;
    for (const box of list) this._rotateAABB(box, b.x, b.z, rad);
  },
  /* D-03：model 建筑 platforms 绕角点按 ry 旋转（轴对齐矩形；90° 倍数精确） */
  rotatePlatforms(b, list) {
    const rad = (b.ry || 0) * Math.PI / 180;
    if (!rad || !list) return;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    for (const p of list) {
      const cx = (p.x0 + p.x1) / 2 - b.x, cz = (p.z0 + p.z1) / 2 - b.z;
      const hw = (p.x1 - p.x0) / 2, hd = (p.z1 - p.z0) / 2;
      let mnx = 1e9, mnz = 1e9, mxx = -1e9, mxz = -1e9;
      for (const px of [-hw, hw]) for (const pz of [-hd, hd]) {
        const dx = cx + px, dz = cz + pz;
        const rx = dx * cos + dz * sin + b.x, rz = -dx * sin + dz * cos + b.z;
        mnx = Math.min(mnx, rx); mxx = Math.max(mxx, rx); mnz = Math.min(mnz, rz); mxz = Math.max(mxz, rz);
      }
      p.x0 = mnx; p.x1 = mxx; p.z0 = mnz; p.z1 = mxz;
    }
  },
  /* 从已构建 mesh 的几何求局部尺寸（D-06：真实 footprint，檐口/GLB 对齐） */
  geometryDims(mesh) {
    const geo = mesh && mesh.geometry;
    if (!geo || !geo.attributes.position) return null;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return null;
    return { w: bb.max.x - bb.min.x, d: bb.max.z - bb.min.z, h: bb.max.y - bb.min.y };
  },

  placeModelBuilding(b) {
    const vis = new THREE.Group();
    // v1.2：新类型（models/buildings/*.glb）按地图 w/d/h 缩放（设计契约「碰撞尺寸以 w/d/h 为准」）；
    // 旧 5 型传 dims 但 build 内仅对新类型生效 → 沿用 GLB 原尺寸，观感不变
    const dims = this.modelDims(b);
    const built = (typeof BuildingLib !== 'undefined' && BuildingLib) ? BuildingLib.build(b.key, b.x, b.z, b.ry || 0, dims) : null;
    let dim = null;
    if (built) {
      // D-04：几何归一化到角点原点（watchtower 居中 → 平移对齐 CONFIGS 角点系；已是角点的 no-op）
      const geo = built.mesh.geometry;
      if (geo && geo.attributes.position) {
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (bb && (Math.abs(bb.min.x) > 0.001 || Math.abs(bb.min.z) > 0.001)) {
          geo.translate(-bb.min.x, -bb.min.y, -bb.min.z);
          geo.computeBoundingSphere();
        }
        // v1.5 sink：模型地坪不在 z=0 的类型（base 因卧式油罐被整体抬高 6）→ 归一化后再下沉，
        //            使地坪与地形齐平（碰撞/平台已在 BuildingLib.build 里同步下移）。
        if (built.sinkY) { geo.translate(0, -built.sinkY, 0); geo.computeBoundingSphere(); }
      }
      // D-06：真实几何尺寸（檐口/GLB 缩放用；比数据 w/d/h 更贴合视觉）
      dim = this.geometryDims(built.mesh) || this.modelDims(b);
      // D-03：绕角点旋转 colliders/platforms（与 ry 视觉对齐；当前数据全为 90° 倍数 → 精确）
      this.rotateColliders(b, built.colliders);
      this.rotatePlatforms(b, built.platforms);
      // v3.2：门洞矩形（nav 网格打通）；随建筑 ry 旋转
      if (built.doors && built.doors.length) {
        const rad = (b.ry || 0) * Math.PI / 180;
        for (const d of built.doors) {
          const box = { min: new THREE.Vector3(d.x0, 0, d.z0), max: new THREE.Vector3(d.x1, 0, d.z1) };
          if (rad) this._rotateAABB(box, b.x, b.z, rad);
          this.navDoors.push({ x0: box.min.x, z0: box.min.z, x1: box.max.x, z1: box.max.z });
        }
      }
      for (const c of built.colliders) {
        // v1.3（design §7.3 + QA BLOCKER）：bridge 高空结构（桥面/栏杆 min.y≥OVERHEAD_Y）分流进
        // World.overhead —— 只挡弹道、不进移动碰撞，桥下地面可通行（A* 与移动双绿）。
        // 同时避免高空 collider 残留被 _initSandstorm 当掩体外扩 2m → 桥下沙暴误判庇护。
        // 桥墩（min.y<OVERHEAD_Y）是地面实体，照旧进 colliders。
        if (b.key === 'bridge' && c.min.y >= OVERHEAD_Y) this.overhead.push(c);
        else this.colliders.push(c);
      }
      for (const p of built.platforms) this.platforms.push(p);
      // D-15/T-01：主题染色（material.color × 顶点色，0xffffff=不染色）
      // v3.2：新导入模型已自带材质色（顶点色），整幅 tint 会把颜色压暗；向白色混合 60% 保留主题但不过曝变黑。
      let tintHex = b.tint || 0xffffff;
      if (b.tint && typeof AssetLoader !== 'undefined' && AssetLoader.buildingMeta && AssetLoader.buildingMeta(b.key)) {
        tintHex = new THREE.Color(b.tint).lerp(new THREE.Color(0xffffff), 0.6).getHex();
      }
      if (tintHex !== 0xffffff) built.mesh.traverse(o => { if (o.isMesh && o.material && o.material.color) o.material.color.setHex(tintHex); });
      this._batchMeshes.push({ mesh: built.mesh, tint: tintHex });
      vis.add(built.mesh);
    } else {
      // 回退：BuildingLib 缺失/数据损坏 → 用一个实心盒占位，保证碰撞与导航仍成立
      console.warn('[World] 模型建筑 "' + b.key + '" 构建失败，使用占位盒');
      dim = this.modelDims(b) || { w: 8, d: 8, h: 4 };
      const m = new THREE.Mesh(new THREE.BoxGeometry(dim.w, dim.h, dim.d), this.sharedMat('concrete', 2));
      m.position.set(b.x + dim.w / 2, dim.h / 2, b.z + dim.d / 2);
      m.castShadow = true; m.receiveShadow = true;
      vis.add(m);
      this.colliders.push({
        min: new THREE.Vector3(b.x, 0, b.z),
        max: new THREE.Vector3(b.x + dim.w, dim.h, b.z + dim.d)
      });
    }
    // 程序化精修外挂件（纯视觉，不产生碰撞体 → 不影响走位/寻路/小地图）
    if (dim && this.detailLevel(b) >= 1 && b.trim !== false) {
      const trim = this.buildModelTrim(dim, (typeof b.trim === 'object' && b.trim) || {}, this.detailLevel(b));
      if (trim) {
        trim.position.set(b.x, 0, b.z);
        if (b.ry) trim.rotation.y = (b.ry || 0) * Math.PI / 180;
        vis.add(trim);
      }
    }
    this._attach(vis);
    this.glbSlot(b, vis, dim);
    return vis;
  },

  /* v3.1 静态合批：把每栋建筑的主几何按 180m 空间块合并成少数 chunk。
   * 渲染层 100+ 建筑 → ~10 个 draw call；tint 烘进顶点色，碰撞/平台/导航完全不动。
   * 只合批「主几何」，檐口/烟囱等精修仍各自独立（生成建筑已 trim:false）。 */
  batchStaticBuildings() {
    const list = this._batchMeshes || [];
    this._batchMeshes = [];
    if (!list.length) return;
    const CHUNK = 180;
    const groups = new Map();
    const tmpV = new THREE.Vector3();
    for (const it of list) {
      const mesh = it.mesh;
      if (!mesh || !mesh.geometry) continue;
      mesh.updateMatrixWorld(true);
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      const pos = geo.attributes.position;
      if (!pos) continue;
      const cnt = pos.count;
      const tint = new THREE.Color(it.tint || 0xffffff);
      let col = geo.attributes.color;
      if (!col) {
        const arr = new Float32Array(cnt * 3);
        for (let i = 0; i < cnt; i++) { arr[i * 3] = tint.r; arr[i * 3 + 1] = tint.g; arr[i * 3 + 2] = tint.b; }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        col = geo.attributes.color;
      } else {
        const arr = col.array, is = col.itemSize || 3;
        for (let i = 0; i < cnt; i++) {
          arr[i * is] *= tint.r; arr[i * is + 1] *= tint.g; arr[i * is + 2] *= tint.b;
        }
      }
      let idx = geo.index ? geo.index.array : null;
      if (!idx) {
        idx = cnt > 65535 ? new Uint32Array(cnt) : new Uint16Array(cnt);
        for (let i = 0; i < cnt; i++) idx[i] = i;
      }
      geo.computeBoundingBox();
      geo.boundingBox.getCenter(tmpV);
      const key = Math.floor(tmpV.x / CHUNK) + '_' + Math.floor(tmpV.z / CHUNK);
      let g = groups.get(key);
      if (!g) { g = { pos: [], nor: [], col: [], idx: [], v: 0 }; groups.set(key, g); }
      const p = geo.attributes.position.array;
      const nrm = geo.attributes.normal ? geo.attributes.normal.array : null;
      const cl = geo.attributes.color.array;
      for (let i = 0; i < p.length; i++) g.pos.push(p[i]);
      if (nrm) for (let i = 0; i < nrm.length; i++) g.nor.push(nrm[i]);
      else for (let i = 0; i < cnt; i++) g.nor.push(0, 1, 0);
      for (let i = 0; i < cl.length; i++) g.col.push(cl[i]);
      for (let i = 0; i < idx.length; i++) g.idx.push(idx[i] + g.v);
      g.v += cnt;
      geo.dispose();
    }
    // 原始逐栋 mesh 移除（碰撞/平台已独立保存，不受影响）
    for (const it of list) {
      const m = it.mesh;
      if (!m) continue;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material && m.material.dispose) m.material.dispose();
    }
    const mat = this._batchMat || (this._batchMat = new THREE.MeshLambertMaterial({ vertexColors: true }));
    let chunks = 0;
    for (const g of groups.values()) {
      if (!g.pos.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      const IA = g.v > 65535 ? Uint32Array : Uint16Array;
      geo.setIndex(new THREE.BufferAttribute(new IA(g.idx), 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      this._attach(mesh);
      chunks++;
    }
    console.log('[Batch] 建筑静态合批 ' + list.length + ' 栋 → ' + chunks + ' 个空间块');
  },

  /* 模型建筑尺寸（v1.5 尺寸契约）
   * 优先级：scale（等比，推荐）> 显式 w/d/h（兼容旧数据，非等比会告警）> 碰撞盒推断
   * 等比推导从根上消除了「地图手写尺寸与真实几何比例不符 → 建筑被拉伸/压扁」这一类错误。 */
  modelDims(b) {
    const lib = (typeof BuildingLib !== 'undefined') ? BuildingLib : null;
    // v3.2：模型自描述尺寸优先（GLB extras.battlegame.dims）；地图只写 uniform scale
    const meta = (typeof AssetLoader !== 'undefined' && AssetLoader.buildingMeta) ? AssetLoader.buildingMeta(b.key) : null;
    if (meta && meta.dims) {
      const k = (typeof b.scale === 'number' && b.scale > 0) ? b.scale : 1;
      return { w: meta.dims.w * k, d: meta.dims.d * k, h: meta.dims.h * k };
    }
    if (lib && lib.REAL_DIMS && lib.REAL_DIMS[b.key]) {
      if (b.scale || !(b.w && b.d && b.h)) return lib.dimsFor(b.key, b.scale);
      const dev = lib.aspectDeviation(b.key, b);
      if (dev > 5 && !this._aspectWarned) {
        this._aspectWarned = {};
      }
      if (dev > 5 && this._aspectWarned && !this._aspectWarned[b.key]) {
        this._aspectWarned[b.key] = 1;
        console.warn('[World] 建筑 "' + b.key + '" 摆放尺寸非等比（轴间偏差 ' + dev.toFixed(0) +
          '%），几何会被拉伸；建议改用 scale 字段。真实尺寸=' + JSON.stringify(lib.REAL_DIMS[b.key]));
      }
      return { w: b.w, d: b.d, h: b.h };
    }
    if (b.w && b.d && b.h) return { w: b.w, d: b.d, h: b.h };
    const cfg = (lib && lib.CONFIGS) ? lib.CONFIGS[b.key] : null;
    if (!cfg || !cfg.colliders || !cfg.colliders.length) return null;
    let w = 0, d = 0, h = 0;
    for (const c of cfg.colliders) { w = Math.max(w, c[3]); d = Math.max(d, c[4]); h = Math.max(h, c[5]); }
    return { w, d, h };
  },

  /* 模型建筑精修：檐口 + 角柱 + 楼层分缝 + 烟囱（模型局部坐标 x∈[0,w] y∈[0,h] z∈[0,d]）
   * lvl：0=无 1=檐口+分缝 2=+角柱+烟囱（D-14：model 建筑 low/high 分档） */
  buildModelTrim(dim, cfg, lvl) {
    lvl = (lvl === undefined) ? 2 : lvl;
    const det = [];
    const w = dim.w, d = dim.d, top = cfg.top !== undefined ? cfg.top : dim.h;
    const cx = w / 2, cz = d / 2;
    if (lvl >= 1) {
      if (cfg.cornice !== false) _ringBoxes(det, cx, cz, w, d, top + 0.2, 0.44, 0.3);
      for (const by of cfg.bands || []) _ringBoxes(det, cx, cz, w, d, by, 0.2, 0.1);
    }
    if (lvl >= 2 && cfg.pilaster) {
      const pw = cfg.pilasterW || 0.45, e = 0.12;
      const corners = [[0, 0], [w, 0], [0, d], [w, d]];
      for (const c of corners) {
        det.push({
          x: c[0] + (c[0] === 0 ? -e + pw / 2 : e - pw / 2),
          y: top / 2,
          z: c[1] + (c[1] === 0 ? -e + pw / 2 : e - pw / 2),
          w: pw + e * 2, h: top, d: pw + e * 2
        });
      }
    }
    if (lvl >= 2 && cfg.chimney) {
      const ch = cfg.chimney, base = ch.base !== undefined ? ch.base : top;
      det.push({ x: ch.x, y: base + ch.h / 2, z: ch.z, w: ch.w, h: ch.h, d: ch.d });
      det.push({ x: ch.x, y: base + ch.h + 0.08, z: ch.z, w: ch.w + 0.24, h: 0.16, d: ch.d + 0.24 });
    }
    const g = _mergeBoxes(det);
    if (!g) return null;
    const m = new THREE.Mesh(g, this.sharedMat(cfg.tex || 'concrete', 2));
    m.castShadow = true; m.receiveShadow = true;
    return m;
  },

  /* GLB 插槽：在线尝试加载外部模型替换视觉；碰撞/导航始终来自程序化数据。
   * 离线（file://）、未引入 GLTFLoader、加载失败 → 静默保留程序化建筑。 */
  glbSlot(def, vis, dim) {
    if (!def || !def.glb || !dim) return;
    const gen = this._gen, self = this;
    GLBSlots.load(def.glb, gltf => {
      if (gen !== self._gen) return;                      // 已换图，丢弃迟到的结果
      const obj = gltf.scene || gltf.scenes && gltf.scenes[0];
      if (!obj) throw new Error('GLB 无 scene');
      const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
      const sx = dim.w / (size.x || 1), sy = dim.h / (size.y || 1), sz = dim.d / (size.z || 1);
      const uni = def.glbFit === 'uniform' ? Math.min(sx, sy, sz) : 0;
      obj.scale.set(uni || sx, uni || sy, uni || sz);
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj);
      obj.position.set(-bb.min.x, -bb.min.y, -bb.min.z);  // 角点对齐到 (0,0,0)
      obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const holder = new THREE.Group();
      holder.position.set(def.x, 0, def.z);
      if (def.ry) holder.rotation.y = def.ry * Math.PI / 180;
      holder.add(obj);
      vis.visible = false;                                // 程序化视觉退居幕后，碰撞体保持不变
      self._attach(holder);
      console.log('[GLB] ' + def.glb + ' 已替换 "' + def.key + '" 的视觉');
    }, e => {
      console.log('[GLB] ' + def.glb + ' 未加载（' + (e && e.message || 'n/a') + '），保留程序化建筑');
    });
  },

  buildBuildings(list) {
    // v1.5：先把 scale 语义归一化回写成 w/d/h —— 下游（mechanics 庇护 footprint、ui 小地图地标、
    //       nav/minimap）一律直接读 b.w/b.d/b.h，无需各自理解尺寸契约。
    for (const b of list) {
      if (!b || (b.type || (b.key ? 'model' : 'proc')) !== 'model') continue;
      const dm = this.modelDims(b);
      if (dm) { b.w = dm.w; b.d = dm.d; b.h = dm.h; }
    }
    for (const b of list) {
      if (!b) continue;
      const type = b.type || (b.key ? 'model' : 'proc');
      if (type === 'model') this.placeModelBuilding(b);
      else this.buildBuilding(b.x, b.z, b.w, b.d, b.h, b);
    }
  },

  /* ============ 掩体 ============ */
  addBox(x, z, w, h, d, mat, color) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshLambertMaterial({ color: color || 0x7a7d80 }));
    m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true; this._attach(m);
    const hw = w / 2, hd = d / 2;
    this.colliders.push({ min: new THREE.Vector3(x - hw, 0, z - hd), max: new THREE.Vector3(x + hw, h, z + hd) });
    return m;
  },
  buildCover(list) {
    if (!list.length) return;
    const mats = {
      sandbag: this.sharedMat('sandbag', 4),
      concrete: this.sharedMat('concrete', 2),
      crate: this.sharedMat('crate', 1, 0x8a6f4a),
      metal: this.sharedMat('metal', 2),
      sand: this.sharedMat('sand', 4) // C3：接线 sand —— 荒漠围挡/土墙
    };
    for (const c of list) {
      switch (c.t) {
        case 'sandline': {
          const step = c.step || 2.4, hgt = c.h || 1.1;
          const n = Math.round(c.len / step);
          for (let i = 0; i < n; i++) {
            const px = c.x + (c.horiz ? (i - (n - 1) / 2) * step : 0);
            const pz = c.z + (c.horiz ? 0 : (i - (n - 1) / 2) * step);
            this.addBox(px, pz, c.horiz ? step : 1.0, hgt, c.horiz ? 1.0 : step, mats.sandbag);
          }
          break;
        }
        case 'barrier':
          this.addBox(c.x, c.z, c.horiz ? 3.6 : 0.9, c.h || 1.0, c.horiz ? 0.9 : 3.6, mats.concrete);
          break;
        case 'box':
        default:
          this.addBox(c.x, c.z, c.w, c.h, c.d, mats[c.mat] || mats.concrete);
          break;
      }
    }
  },

  /* ============ 废墟 ============ */
  buildRuins(r) {
    const walls = r.walls || [], fields = r.rubble || [];
    if (!walls.length && !fields.length) return;
    const rm = this.sharedMat('ruinWall', 1, r.wallColor !== undefined ? r.wallColor : 0x6b645c);
    const dm = this.sharedMat('ruinRubble', 1, r.rubbleColor !== undefined ? r.rubbleColor : 0x544e48);
    for (const wl of walls) {
      const ry = wl.ry || 0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(wl.w, wl.h, wl.d), rm);
      m.position.set(wl.x, wl.h / 2, wl.z); m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = true; this._attach(m);
      // 近似碰撞（旋转后的世界轴向包围盒）
      const cw = Math.abs(wl.w * Math.cos(ry)) + Math.abs(wl.d * Math.sin(ry));
      const cd = Math.abs(wl.w * Math.sin(ry)) + Math.abs(wl.d * Math.cos(ry));
      this.colliders.push({ min: new THREE.Vector3(wl.x - cw / 2, 0, wl.z - cd / 2), max: new THREE.Vector3(wl.x + cw / 2, wl.h, wl.z + cd / 2) });
    }
    for (const f of fields) {
      for (let i = 0; i < f.n; i++) {
        const s = U.rand(f.s0, f.s1);
        const m = new THREE.Mesh(new THREE.CylinderGeometry(s * U.rand(0.5, 1), s * U.rand(0.5, 1), U.rand(0.4, 0.8), 6), dm);
        m.position.set(U.rand(f.x0, f.x1), 0.3, U.rand(f.z0, f.z1));
        m.rotation.y = Math.random() * 3; m.castShadow = true; this._attach(m);
      }
    }
  },

  /* ============ 装饰物（路灯 / 树 / 岗哨台） ============ */
  buildProps(p) {
    const poleMat = this.sharedMat('pole', 1, 0x4a4f55);
    for (const l of p.lamps || []) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.2, 6), poleMat);
      pole.position.set(l[0], 2.1, l[1]); pole.castShadow = true; g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.12), poleMat);
      arm.position.set(l[0] + 0.45, 4.1, l[1]); g.add(arm);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), this.basicMat('bulb', 0xffe9a8)); // D-12：Basic 不受光，夜景才亮
      bulb.position.set(l[0] + 0.85, 4.1, l[1]); g.add(bulb);
      this._attach(g);
    }
    const trunkMat = this.sharedMat('trunk', 1, 0x5a4630), leafMat = this.sharedMat('leaf', 1, 0x2f5d33);
    for (const t of p.trees || []) {
      const g = new THREE.Group();
      const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 3, 6), trunkMat);
      tr.position.set(t[0], 1.5, t[1]); tr.castShadow = true; g.add(tr);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(1.5, 7, 6), leafMat);
      fl.position.set(t[0], 3.6, t[1]); fl.castShadow = true; g.add(fl);
      this._attach(g);
    }
    const wood = this.sharedMat('wood', 1, 0x6b5238);
    for (const t of p.towers || []) {
      const tw = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 5, 0.3), wood);
        const a = (i / 4) * Math.PI * 2;
        leg.position.set(Math.cos(a) * 1.4, 2.5, Math.sin(a) * 1.4);
        tw.add(leg);
      }
      const plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 3.2), wood);
      plat.position.y = 5; tw.add(plat);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 3.6), wood);
      roof.position.y = 6.2; tw.add(roof);
      tw.position.set(t[0], 0, t[1]);
      this._attach(tw);
    }
  },

  /* ============ 据点（占领玩法）：地面圈 + 旗杆 + 旗面 ============ */
  // v2.9 三个地带据点：地图按 z 三等分（北/中/南条带），每带一个据点 A/B/C（band: true → 占领判定用条带区域，非圆）
  // 据点 x = 该地带内出生点的质心（实际活动区；地图扩大后建筑区留在原地，固定中心 x 会穿墙导致据点不可达）
  // r = 条带半高（判定用：|u.z - c.z| <= c.r 即在该地带）
  bandsCaps(mapDef) {
    const size = (mapDef && mapDef.size) || CFG.WORLD;
    const n = 3, bandH = size / n;
    const sp = (mapDef && mapDef.spawns) || {};
    const pts = [];
    for (const t of ['blue', 'red', 'green', 'yellow']) for (const s of (sp[t] || [])) {
      pts.push({ x: Array.isArray(s) ? s[0] : s.x, z: Array.isArray(s) ? s[1] : s.z });
    }
    return ['A', 'B', 'C'].map((id, i) => {
      const zc = i * bandH + bandH / 2;
      const inBand = pts.filter(p => Math.abs(p.z - zc) <= bandH / 2);
      const x = inBand.length ? Math.round(inBand.reduce((s2, p) => s2 + p.x, 0) / inBand.length) : Math.round(size / 2);
      return { id, x, z: Math.round(zc), r: Math.round(bandH / 2), band: true };
    });
  },
  buildCapturePoints(list) {
    this.capturePoints = list.map(cp => ({ id: cp.id, x: cp.x, z: cp.z, r: cp.r || CFG.CAP_R, band: !!cp.band }));
    this.capMeshes = [];
    const neutral = (typeof CFG !== 'undefined' && CFG.teamColor) ? CFG.teamColor('neutral').hex : 0x707880; // 队伍色单一数据源（accessibility P0）
    for (const cp of this.capturePoints) {
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(cp.r - 1.2, cp.r, 32, 1),
        new THREE.MeshBasicMaterial({ color: neutral, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false })); // fog:false：沙暴雾不吃据点环（art/zone-visual §6）
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(cp.x, 0.06, cp.z);
      g.add(ring);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 6, 6), new THREE.MeshLambertMaterial({ color: 0x4a4f55 }));
      pole.position.set(cp.x, 3, cp.z); pole.castShadow = true;
      g.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 0.06), this.basicMat('flag', neutral)); // D-13：Basic 不受光，夜景队色可辨
      flag.position.set(cp.x + 1.0, 5.4, cp.z);
      g.add(flag);
      this._attach(g);
      this.capMeshes.push({ g, ring, flag, pole });
    }
  },

  /* ============ 导航网格（2m 栅格，A*） ============ */
  buildNavGrid() {
    const n = Math.ceil(CFG.WORLD / CFG.CELL);
    this.grid = { n, blocked: new Uint8Array(n * n), path: [] };
    const block = (min, max) => {
      const x0 = Math.max(0, Math.floor(min.x / CFG.CELL)), x1 = Math.min(n - 1, Math.floor((max.x - 0.01) / CFG.CELL));
      const z0 = Math.max(0, Math.floor(min.z / CFG.CELL)), z1 = Math.min(n - 1, Math.floor((max.z - 0.01) / CFG.CELL));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.blocked[z * n + x] = 1;
    };
    for (const c of this.colliders) {
      // v1.3：高空结构不切断 2D 地面导航。头顶净空 ≥2.6m（高于玩家身高+跳越）的
      // 板/面（bridge 桥面 9.6m、屋顶板、楼层板、塔台平台）不 block 地面网格：
      //   - bridge 桥下可通行（否则过街桥会把主街切成死墙）
      //   - 塔台下方/平台投影可走（腿/墙仍 block，安全）
      // 墙体/低掩体/桥墩（min.y < 2.6，从地面起）照常 block —— 地面通行语义不变。
      if (c.min.y >= 2.6) continue;
      block(c.min, c.max);
    }
    // v3.2：门洞打通（1.2~1.8m 小门在 2m 栅格里会被相邻墙格堵死）→ 按 GLB 门洞矩形清空格子
    for (const d of (this.navDoors || [])) {
      const x0 = Math.max(0, Math.floor((d.x0 - 0.1) / CFG.CELL));
      const x1 = Math.min(n - 1, Math.floor((d.x1 + 0.1) / CFG.CELL));
      const z0 = Math.max(0, Math.floor((d.z0 - 0.1) / CFG.CELL));
      const z1 = Math.min(n - 1, Math.floor((d.z1 + 0.1) / CFG.CELL));
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid.blocked[z * n + x] = 0;
    }
    // 出生区外沿护栏
  },
  walkable(x, z) {
    const n = this.grid.n, gx = Math.floor(x / CFG.CELL), gz = Math.floor(z / CFG.CELL);
    if (gx < 0 || gz < 0 || gx >= n || gz >= n) return false;
    return this.grid.blocked[gz * n + gx] === 0;
  },

  /* ---- 竖直遮挡判定：碰撞盒是否落在「脚底 feet」的人体高度区间内 ----
   * v1.5 关键修复：此前移动碰撞是纯 2D（只看 c.max.y < 0.8），导致
   *   楼板 / 屋顶板 / 塔台平台 这类「悬空水平板」被当成从地面拔起的实心墙，
   *   任何带楼板的建筑（apartment / warehouse / base / megatower …）整栋不可进入
   *   —— 这正是「碰撞留空配置」做了却毫无效果的根因。
   * 语义：
   *   c.max.y < feet + STEP  → 在脚下（矮掩体/楼板边/台阶）→ 可跨越，不挡
   *   c.min.y > feet + BODY  → 在头顶（楼板/门楣/上层墙）→ 不挡（才能进屋、才能上楼）
   * 与 buildNavGrid 的 min.y >= 2.6 跳过规则同源，只是这里按实时脚底高度算，支持多层。 */
  BODY_H: 1.8,
  STEP_H: 0.8,
  blocksAt(c, feet) {
    const f = feet || 0;
    return c.max.y >= f + this.STEP_H && c.min.y <= f + this.BODY_H;
  },

  /* ---- 地表高度（含屋顶/坡道平台） ----
   * curY 可选：给出当前脚底高度时，在同一水平投影内的多层平台里取「脚下最高的一层」，
   *            多层建筑（base 11 层 / megatower 11 层 / container 双层）才能逐层站立；
   *            不给 curY 时退化为取「最低一层」（地面层），比原先的「取第一个匹配项」稳定。 */
  heightAt(x, z, curY) {
    let best = null;
    const known = (curY !== undefined && curY !== null);
    const ceil = known ? curY + this.STEP_H : 0;
    for (const p of this.platforms) {
      if (x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      const y = p.ramp ? U.lerp(p.y0, p.y1, U.clamp((x - p.x0) / (p.x1 - p.x0), 0, 1)) : p.y;
      if (known) { if (y <= ceil && (best === null || y > best)) best = y; }
      else if (best === null || y < best) best = y;
    }
    const ground = this.terrainH ? this.terrainH(x, z) : 0;
    if (!known) return best === null ? ground : best;   // 无上下文 → 取最低层，避免被顶到楼顶
    // v1.5：碰撞盒顶面也是可站立面（只在「抬脚能上去」的范围内），楼梯/台阶/货柜才走得上去。
    //       walls 的顶面因为 max.y 远高于 ceil 会被首条判断直接剔除，开销可忽略。
    for (const c of this.colliders) {
      if (c.max.y > ceil || c.max.y < ground) continue;
      if (x < c.min.x || x > c.max.x || z < c.min.z || z > c.max.z) continue;
      if (best === null || c.max.y > best) best = c.max.y;
    }
    if (best === null || ground > best) return ground;
    return best;
  },

  /* ---- 射线遮挡检测：墙/掩体 AABB + 门楣 + 烟雾球 + 地形采样
   *     返回命中点(Vector3)或 null（未遮挡） ---- */
  rayBlocked(from, to, ignoreSmoke) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.01) return null;
    dir.divideScalar(len);
    const f = new THREE.Vector3(), d = new THREE.Vector3();
    // 1) 碰撞体 AABB（仅统计竖向高度 > 0.6 的实墙，跳过平台/地面）
    for (const c of this.colliders) {
      if (c.max.y < 0.6) continue;
      if (rayAABB(from, dir, len, c, f)) return f.clone();
    }
    // 1.5) 门楣/上层墙（不挡走位但挡弹道）
    for (const c of this.overhead) {
      if (rayAABB(from, dir, len, c, f)) return f.clone();
    }
    // 2) 烟雾（命中即视为遮挡，返回命中点语义）
    if (!ignoreSmoke && FX.smokes) {
      for (const s of FX.smokes) {
        if (raySphere(from, dir, s.pos, s.r)) return s.pos.clone();
      }
    }
    // 3) 地形起伏采样
    const steps = Math.ceil(len / 3);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      d.copy(from).addScaledVector(dir, t * len);
      const gy = this.heightAt(d.x, d.z);
      if (d.y < gy + 0.4 && d.y > gy - 1) return d.clone(); // 贴地命中
    }
    return null;
  },

  /* ---- 地面拾取点（鼠标 → 地形交点，迫击炮/标记用） ---- */
  groundPick(camera, ndcX, ndcY) {
    const r = new THREE.Raycaster();
    r.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const o = r.ray.origin, dir = r.ray.direction;
    for (let i = 0; i < 400; i++) {
      const p = o.clone().addScaledVector(dir, i * 0.75);
      if (p.y < this.heightAt(p.x, p.z)) return p;
    }
    return null;
  },

  genSpawns(s) {
    const mk = p => {
      const x = Array.isArray(p) ? p[0] : p.x, z = Array.isArray(p) ? p[1] : p.z;
      return { x, z, y: this.heightAt(x, z) };
    };
    this.spawns.blue = (s.blue || []).map(mk);
    this.spawns.red = (s.red || []).map(mk);
    if (!this.spawns.blue.length) this.spawns.blue = [mk([20, 20])];
    if (!this.spawns.red.length) this.spawns.red = [mk([CFG.WORLD - 20, CFG.WORLD - 20])];
  },

  buildMinimapStatic(mm) {
    // v1.6：静态底图渲染到「离屏 canvas」，避免 MiniMap.draw 每帧 clearRect 后再
    // drawImage(World.minimapStatic) 把可见 canvas 画到自身 → 底图（道路/墙体）被清空丢失。
    const c = document.createElement('canvas');
    c.width = 188; c.height = 188;
    const g = c.getContext('2d');
    const s = 188 / CFG.WORLD;
    const bg = mm.bg || '#202a33';
    g.fillStyle = bg; g.fillRect(0, 0, 188, 188);
    // 道路（世界坐标 → 小地图像素）
    let roads = mm.roads;
    if (!roads && this.mapDef && this.mapDef.roads) roads = this.mapDef.roads.strips;
    g.fillStyle = mm.roadColor || '#2e3a44';
    for (const r of roads || []) g.fillRect((r.x - r.w / 2) * s, (r.z - r.d / 2) * s, r.w * s, r.d * s);
    if (mm.plaza) {
      g.fillStyle = mm.plazaColor || '#3a4854';
      g.fillRect((mm.plaza.x - mm.plaza.w / 2) * s, (mm.plaza.z - mm.plaza.d / 2) * s, mm.plaza.w * s, mm.plaza.d * s);
    }
    g.fillStyle = mm.wallColor || '#4a3a30';
    for (const col of this.colliders) {
      if (col.max.y < 1.6) continue;
      g.fillRect(col.min.x * s, col.min.z * s, (col.max.x - col.min.x) * s, (col.max.z - col.min.z) * s);
    }
    this.minimapStatic = c;
    this.minimapBg = bg; // 旋转时填补四角空隙用
  },

  /* ---- 出生点/复活点取用 ---- */
  pickSpawn(team) {
    const list = this.spawns[team];
    return list[Math.floor(Math.random() * list.length)];
  },

  /* ---- 兜底空场：MapRegistry 缺失时也能起局（不崩） ---- */
  FALLBACK: {
    id: '_fallback', name: '兜底空场', size: 300,
    terrain: { seed: 1, amp: 0, seg: 32, colors: [0x4a6b3c, 0x5c6e52], colorMix: 0 },
    capturePoints: [{ id: 'A', x: 150, z: 150 }, { id: 'B', x: 110, z: 108 }, { id: 'C', x: 215, z: 250 }],
    spawns: { blue: [[40, 40], [56, 30], [30, 56]], red: [[260, 260], [244, 270], [270, 244]] }
  }
};

/* 射线-AABB 相交（slab 法） */
function rayAABB(origin, dir, maxT, box, out) {
  // 标准 slab 测试：轴平行时（d≈0）起点在盒内则跳过该轴，否则不命中；
  // 修复旧实现 d=0 时 0/0=NaN 污染 tmax → 薄墙被误判命中（影响子弹 LOS 与炮击掩体遮挡）
  let tmin = 0, tmax = maxT;
  for (let i = 0; i < 3; i++) {
    const o = origin.getComponent(i), d = dir.getComponent(i);
    if (Math.abs(d) < 1e-8) {
      if (o < box.min.getComponent(i) - 1e-6 || o > box.max.getComponent(i) + 1e-6) return false;
      continue;
    }
    let t1 = (box.min.getComponent(i) - o) / d, t2 = (box.max.getComponent(i) - o) / d;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (tmin > maxT + 1e-6) return false;
  out.copy(origin).addScaledVector(dir, Math.max(0, tmin));
  return true;
}
/* 射线-球 相交 */
function raySphere(origin, dir, center, r) {
  const oc = new THREE.Vector3().subVectors(origin, center);
  const b = oc.dot(dir), c = oc.dot(oc) - r * r;
  const disc = b * b - c;
  return disc > 0 && (-b - Math.sqrt(disc)) > 0;
}

/* ---- A* 寻路（4/8 方向，含拐角检查）----
 * v3.1 性能：g/came/seen 与 open 堆全部复用（大图 n≈370 时旧版每次寻路分配 ~1MB，
 * 20 AI × 1.67 次/秒会产生数十 MB/s 垃圾 → GC 卡顿）。seen 用「代数戳」避免每帧 fill。 */
const _AStar = {
  n: 0, g: null, came: null, seen: null, gen: 0, heapP: [], heapV: [], size: 0,
  ensure(n) {
    if (this.n === n) return;
    this.n = n;
    this.g = new Float32Array(n * n);
    this.came = new Int32Array(n * n);
    this.seen = new Uint32Array(n * n);
    this.gen = 0;
    this.heapP = []; this.heapV = []; this.size = 0;
  }
};
function _hpPush(A, p, v) {
  const hp = A.heapP, hv = A.heapV;
  let i = A.size++;
  hp[i] = p; hv[i] = v;
  while (i > 0) {
    const par = (i - 1) >> 1;
    if (hp[par] <= hp[i]) break;
    const tp = hp[par], tv = hv[par];
    hp[par] = hp[i]; hv[par] = hv[i];
    hp[i] = tp; hv[i] = tv;
    i = par;
  }
}
function _hpPop(A) {
  const hp = A.heapP, hv = A.heapV;
  const top = hv[0];
  const lastP = hp[--A.size], lastV = hv[A.size];
  if (A.size > 0) {
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < A.size && hp[l] < hp[m]) m = l;
      if (r < A.size && hp[r] < hp[m]) m = r;
      if (m === i) break;
      const tp = hp[m], tv = hv[m];
      hp[m] = hp[i]; hv[m] = hv[i];
      hp[i] = tp; hv[i] = tv;
      i = m;
    }
    hp[i] = lastP; hv[i] = lastV;
  }
  return top;
}
function findPath(wx, wz, tx, tz) {
  const grid = World.grid, n = grid.n;
  const sx = Math.floor(wx / CFG.CELL), sz = Math.floor(wz / CFG.CELL);
  const ex = Math.floor(tx / CFG.CELL), ez = Math.floor(tz / CFG.CELL);
  if (sx < 0 || sz < 0 || sx >= n || sz >= n || ex < 0 || ez < 0 || ex >= n || ez >= n) return [];
  if (sx === ex && sz === ez) return [];
  const A = _AStar;
  A.ensure(n);
  let gen = ++A.gen;
  if (A.gen >= 0x7fffffff) { A.seen.fill(0); A.gen = 1; gen = 1; }
  const g = A.g, came = A.came, seen = A.seen;
  const key = (x, z) => z * n + x;
  const sk = key(sx, sz), ek = key(ex, ez);
  A.size = 0; A.heapP.length = 0; A.heapV.length = 0;
  seen[sk] = gen; g[sk] = 0; came[sk] = -1;
  _hpPush(A, 0, sk);
  const h = (x, z) => Math.abs(x - ex) + Math.abs(z - ez);
  let found = false, expanded = 0;
  const cap = Math.min(n * n + 10000, 120000);
  while (A.size && expanded++ < cap) {
    const cur = _hpPop(A);
    if (cur === ek) { found = true; break; }
    const cx = cur % n, cz = Math.floor(cur / n);
    const gc = g[cur];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz;
      if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
      const k2 = key(nx, nz);
      if (grid.blocked[k2]) continue;
      if (dx && dz && (grid.blocked[key(cx + dx, cz)] || grid.blocked[key(cx, cz + dz)])) continue;
      const ng = gc + (dx && dz ? 1.414 : 1);
      if (seen[k2] === gen && ng >= g[k2]) continue;
      seen[k2] = gen; g[k2] = ng; came[k2] = cur;
      _hpPush(A, ng + h(nx, nz), k2);
    }
  }
  if (!found) return [];
  const path = []; let cur = ek;
  while (cur !== -1 && cur !== sk) {
    if (seen[cur] !== gen) break;
    path.push(cur); cur = came[cur];
  }
  path.reverse();
  // 转世界坐标（格心）并做视线剪枝
  const pts = path.map(k => ({ x: (k % n + 0.5) * CFG.CELL, z: (Math.floor(k / n) + 0.5) * CFG.CELL }));
  const smooth = [];
  let i = 0;
  smooth.push({ x: wx, z: wz });
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !gridLineClear(smooth[smooth.length - 1], pts[j])) j--;
    smooth.push(pts[j]); i = j + 1;
  }
  smooth.push({ x: tx, z: tz });
  return smooth;
}
function gridLineClear(a, b) {
  const n = World.grid.n;
  const steps = Math.ceil(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) / (CFG.CELL * 0.8));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.floor(U.lerp(a.x, b.x, t) / CFG.CELL), z = Math.floor(U.lerp(a.z, b.z, t) / CFG.CELL);
    if (x < 0 || z < 0 || x >= n || z >= n || World.grid.blocked[z * n + x]) return false;
  }
  return true;
}
