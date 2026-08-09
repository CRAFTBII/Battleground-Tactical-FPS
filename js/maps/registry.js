/* ============================================
 * 战地突击 · js/maps/registry.js — 地图注册表
 * --------------------------------------------
 * 离线约束（关键）：本项目主打「双击 index.html（file://）即玩」。
 * 浏览器在 file:// 协议下禁止 fetch 本地 JSON（CORS/opaque origin），
 * 因此地图数据一律以 <script> 引入的 JS 模块形式注册到 window.MapRegistry，
 * 绝不使用 fetch/XHR 加载 .json。详见 docs/architecture/adr/adr-002-*.md
 *
 * 加载顺序（index.html）：
 *   registry.js  →  各地图文件(suburb.js/...)  →  js/world.js  →  ... → js/main.js
 * ============================================ */
(function (root) {
  'use strict';

  const MapRegistry = {
    SCHEMA_VERSION: 1,
    maps: {},        // id -> mapDef
    order: [],       // 注册顺序（UI 列表用）
    defaultId: null, // 默认地图（第一个成功注册的）

    /* 注册一张地图；校验失败只警告不抛异常（保证单图坏掉不拖垮整局） */
    register(def) {
      const err = this.validate(def);
      if (err) {
        console.warn('[MapRegistry] 地图 "' + (def && def.id) + '" 注册失败：' + err);
        return null;
      }
      if (!this.maps[def.id]) this.order.push(def.id);
      this.maps[def.id] = def;
      if (!this.defaultId) this.defaultId = def.id;
      return def;
    },

    get(id) { return this.maps[id || this.defaultId] || null; },
    has(id) { return !!this.maps[id]; },
    ids() { return this.order.slice(); },
    count() { return this.order.length; },
    /* 供地图选择 UI 使用的摘要列表 */
    list() {
      return this.order.map(id => {
        const m = this.maps[id];
        return { id: id, name: m.name, desc: m.desc || '', size: m.size || 300, theme: m.theme || '' };
      });
    },
    setDefault(id) { if (this.maps[id]) this.defaultId = id; return this.defaultId; },

    /* ---- Schema 校验：只拦「会让对局跑不起来」的硬契约 ---- */
    validate(def) {
      if (!def || typeof def !== 'object') return '不是对象';
      if (!def.id || typeof def.id !== 'string') return '缺少 id';
      if (!def.name || typeof def.name !== 'string') return '缺少 name';
      if (def.size !== undefined && !(def.size > 0)) return 'size 非法';

      const caps = def.capturePoints;
      if (caps !== undefined && (!Array.isArray(caps) || caps.length < 1)) return 'capturePoints 非法（v2.8 已改网格分区，允许缺省/自定义）';
      if (Array.isArray(caps)) for (const c of caps) {
        if (!c || !c.id) return '据点缺少 id';
        if (typeof c.x !== 'number' || typeof c.z !== 'number') return '据点 ' + c.id + ' 坐标非法';
      }

      const sp = def.spawns;
      if (!sp || !Array.isArray(sp.blue) || !Array.isArray(sp.red)) return '缺少 spawns.blue / spawns.red';
      if (!sp.blue.length || !sp.red.length) return '出生点数组为空（World.pickSpawn 会取到 undefined）';
      for (const t of ['blue', 'red']) {
        for (const s of sp[t]) {
          const ok = Array.isArray(s) ? (typeof s[0] === 'number' && typeof s[1] === 'number')
            : (s && typeof s.x === 'number' && typeof s.z === 'number');
          if (!ok) return t + ' 出生点格式非法（应为 [x,z] 或 {x,z}）';
        }
      }

      if (def.buildings && !Array.isArray(def.buildings)) return 'buildings 必须是数组';
      if (def.cover && !Array.isArray(def.cover)) return 'cover 必须是数组';
      return null;
    }
  };

  root.MapRegistry = MapRegistry;
})(typeof window !== 'undefined' ? window : globalThis);
