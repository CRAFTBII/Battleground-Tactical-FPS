/* ============================================
 * 战地突击 · assetLoader.js — 模型资源加载器（HTTP → GLB → 缓存）
 *
 * 架构变更：模型不再是 base64 内联在 JS 里，而是标准 .glb 二进制，
 * 由 server.js 通过 HTTP 提供。因此**游戏必须启动服务才能玩**：
 *     node server.js   → 浏览器打开 http://localhost:8080
 *
 * 失败策略：任何资源加载失败 → AssetLoader.errors 记录 + 页面红条 + console.error，
 * **不再静默回退方块人**（用户明确要求去掉内联，就不该再假装能离线跑）。
 * ============================================ */

const AssetLoader = {
  base: 'models/',          // 资源根，相对站点根
  manifestUrl: 'models/manifest.json',
  manifest: null,
  cache: { soldier: null, weapons: {}, bolts: {}, buildings: {} },
  ready: false,
  failed: false,
  errors: [],
  stats: { files: 0, bytes: 0, ms: 0 },

  /* ---------- 离线/协议自检 ---------- */
  isStandaloneFile() {
    return typeof location !== 'undefined' && location.protocol === 'file:';
  },
  /** 给出可操作的错误文案（而不是 "fetch failed"） */
  _fail(msg) {
    this.errors.push(msg);
    console.error('[Assets] ' + msg);
    return Promise.reject(new Error(msg));
  },

  /* ---------- 取二进制 ---------- */
  async _fetchBuffer(url) {
    if (typeof fetch !== 'function') {
      throw new Error('运行环境没有 fetch，无法加载模型资源');
    }
    let res;
    try {
      res = await fetch(url, { cache: 'force-cache' });
    } catch (e) {
      throw new Error('请求 ' + url + ' 失败（' + (e && e.message || e) + '）——服务器没启动？');
    }
    if (!res || !res.ok) {
      throw new Error('请求 ' + url + ' 失败：HTTP ' + (res ? res.status : '?') +
        (res && res.status === 404 ? '（资源不存在，先跑 node tools/export_assets.cjs 生成 GLB）' : ''));
    }
    const buf = await res.arrayBuffer();
    this.stats.files++;
    this.stats.bytes += buf.byteLength;
    return buf;
  },

  /** 加载并解析单个 GLB，失败带上文件名以便定位 */
  async _loadGLB(relPath) {
    const url = this.base + relPath;
    const buf = await this._fetchBuffer(url);
    try {
      return GLB.parse(buf);
    } catch (e) {
      throw new Error(relPath + ' 解析失败：' + e.message);
    }
  },

  /* ---------- 预加载全部资源（main.js 在 init() 之前 await） ---------- */
  async preload() {
    if (this.ready) return this;
    if (this.isStandaloneFile()) {
      return this._fail('直接双击 index.html 已不再支持（模型改为服务器提供的 .glb 资源）。\n' +
        '请在本目录执行：node server.js　然后浏览器打开 http://localhost:8080');
    }
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    // 1) 资源清单（由 tools/gen_manifest.cjs 生成）
    let manifest;
    try {
      const buf = await this._fetchBuffer(this.manifestUrl);
      manifest = JSON.parse(new TextDecoder('utf-8').decode(new Uint8Array(buf)));
    } catch (e) {
      return this._fail('加载资源清单 ' + this.manifestUrl + ' 失败：' + e.message +
        '\n请先执行：node tools/gen_manifest.cjs');
    }
    this.manifest = manifest;

    // 2) 并行加载全部模型（任何一个失败都算启动失败，避免半套模型）
    const tasks = [];
    if (manifest.soldier) {
      tasks.push(this._loadGLB(manifest.soldier).then(g => { this.cache.soldier = g; }));
    }
    for (const [key, rel] of Object.entries(manifest.weapons || {})) {
      tasks.push(this._loadGLB(rel).then(g => { this.cache.weapons[key] = g; }));
    }
    for (const [key, rel] of Object.entries(manifest.bolts || {})) {
      tasks.push(this._loadGLB(rel).then(g => { this.cache.bolts[key] = g; }));
    }
    for (const [key, rel] of Object.entries(manifest.buildings || {})) {
      tasks.push(this._loadGLB(rel).then(g => { this.cache.buildings[key] = g; }));
    }

    const settled = await Promise.allSettled(tasks);
    const failed = settled.filter(s => s.status === 'rejected');
    if (failed.length) {
      const detail = failed.map(f => '  · ' + (f.reason && f.reason.message || f.reason)).join('\n');
      return this._fail('有 ' + failed.length + ' 个模型资源加载失败：\n' + detail);
    }

    this.ready = true;
    this.stats.ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
    console.log('[Assets] 模型资源就绪：' + this.stats.files + ' 个文件 / ' +
      (this.stats.bytes / 1024).toFixed(0) + ' KB / ' + this.stats.ms + ' ms' +
      '（士兵' + (this.cache.soldier ? '✓' : '✗') +
      ' 武器' + Object.keys(this.cache.weapons).length +
      ' 枪栓' + Object.keys(this.cache.bolts).length +
      ' 建筑' + Object.keys(this.cache.buildings).length + '）');
    return this;
  },

  /* ---------- 访问器 ---------- */
  soldier() { return this.cache.soldier; },
  weapon(key) { return this.cache.weapons[key] || null; },
  bolt(key) { return this.cache.bolts[key] || null; },
  building(key) { return this.cache.buildings[key] || null; },
  hasBuilding(key) { return !!this.cache.buildings[key]; },
  /** v3.2：建筑自描述元数据（GLB extras.battlegame）——dims/colliders/platforms/doors */
  buildingMeta(key) {
    const g = this.building(key);
    return (g && g.json && g.json.extras && g.json.extras.battlegame) || null;
  },
  /** 建筑是否来自「新类型」（原 BUILDINGS_OUT 那批）——现在按清单分组判断 */
  buildingSource(key) {
    if (!this.manifest) return 'missing';
    const g = (this.manifest.buildingGroups || {});
    if ((g.out || []).includes(key)) return 'inline';
    if ((g.legacy || []).includes(key)) return 'legacy';
    return this.hasBuilding(key) ? 'inline' : 'missing';
  }
};

if (typeof window !== 'undefined') window.AssetLoader = AssetLoader;
