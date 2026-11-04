/* ============================================
 * 战地突击 · js/actors.js — 角色 profile 扩展口（v4）
 * --------------------------------------------
 * 建筑物高度/门洞/层高以“默认 2.0m / 上限 2.2m 角色”为基准；
 * 相机眼高、胶囊尺寸、武器/枪口锚点必须来自 profile，不能写死 1.7m。
 *
 * 后续新增人物模型：在 data/actors/characters.catalog.json 增加 profile，
 * 运行时 ActorCatalog.setDefault(id) / get(id) 即可；建筑侧不需要改。
 * ============================================ */
'use strict';

const ActorCatalog = {
  version: 1,
  source: 'data/actors/characters.catalog.json',
  maxHeight: 2.2,
  defaultId: 'vanguard',
  data: null,

  /* 兜底 profile：JSON 加载失败时仍保证相机/胶囊契约正确 */
  _fallback() {
    return {
      schemaVersion: 1,
      units: 'm',
      maxHeight: 2.2,
      defaultId: 'vanguard',
      profiles: [{
        id: 'vanguard',
        name: '默认士兵（占位）',
        status: 'placeholder',
        glb: 'models/soldier.glb',
        modelHeight: 1.9,
        height: 2.0,
        scale: 1.0526,
        eyeHeight: 1.85,
        capsule: { radius: 0.35, height: 2.0, halfHeight: 0.65 },
        stepHeight: 0.45,
        camera: { fov: 70, near: 0.1, far: 1200 },
        anchors: {
          eye: [0, 1.85, 0],
          weaponR: [0.24, 1.6, 0.3],
          muzzle: [0.24, 1.6, 0.75]
        },
        weaponScale: 1.0,
        variants: []
      }]
    };
  },

  async load(url) {
    const src = url || this.source;
    try {
      const res = await fetch(src, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      this._validate(json);
      this.data = json;
      this.maxHeight = json.maxHeight || 2.5;
      this.defaultId = json.defaultId || 'vanguard';
      console.log('[Actors] profile 已加载：' + this.data.profiles.length + ' 套，默认 ' + this.defaultId +
        '（H=' + this.get(this.defaultId).height + 'm，eye=' + this.get(this.defaultId).eyeHeight + 'm）');
    } catch (e) {
      console.warn('[Actors] profile 加载失败，使用兜底：' + (e && e.message || e));
      this.data = this._fallback();
      this.defaultId = this.data.defaultId;
    }
    this.applyDefault();
    return this;
  },

  _validate(json) {
    if (!json || !Array.isArray(json.profiles) || !json.profiles.length) throw new Error('profiles 为空');
    const max = json.maxHeight || this.maxHeight;
    for (const p of json.profiles) {
      if (!p || !p.id || !p.glb) throw new Error('profile 缺 id/glb: ' + JSON.stringify(p && p.id));
      if (!(p.height > 0) || p.height > max + 1e-6) throw new Error('profile ' + p.id + ' 身高 ' + p.height + ' 超过 maxHeight ' + max);
      if (!(p.eyeHeight > 0) || p.eyeHeight >= p.height) throw new Error('profile ' + p.id + ' eyeHeight 必须小于 height');
      if (!p.capsule || !(p.capsule.radius > 0) || !(p.capsule.height > 0)) throw new Error('profile ' + p.id + ' 缺 capsule');
    }
  },

  list() { return (this.data || this._fallback()).profiles.slice(); },
  get(id) {
    const d = this.data || this._fallback();
    return d.profiles.find(p => p.id === (id || this.defaultId)) || d.profiles[0];
  },

  apply(p) {
    const prof = typeof p === 'string' ? this.get(p) : (p || this.get());
    if (typeof CFG === 'undefined') return prof;
    CFG.PLAYER_HEIGHT = prof.height;
    CFG.EYE = prof.eyeHeight;
    CFG.PLAYER_RADIUS = prof.capsule.radius;
    CFG.PLAYER_CAPSULE_HEIGHT = prof.capsule.height;
    CFG.PLAYER_STEP = prof.stepHeight;
    return prof;
  },

  applyDefault() { return this.apply(this.get(this.defaultId)); },
  setDefault(id) { this.defaultId = this.get(id).id; return this.applyDefault(); },
  eyeHeight(id) { return this.get(id).eyeHeight; },
  capsule(id) { return this.get(id).capsule; },
  anchors(id) { return this.get(id).anchors; },
  scale(id) { return this.get(id).scale; }
};

if (typeof window !== 'undefined') window.ActorCatalog = ActorCatalog;
