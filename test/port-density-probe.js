// 无头探针：夜港 v1.2 密度回归（24+ 栋 / 主街可通行 / A* 全连通 / 出生点不被碰撞体重叠）
// 用法：node test/port-density-probe.js [mapId]   （默认 port；也可 desert/suburb）
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- DOM 桩（与 smoke.js 一致） ---- */
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({
  style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false },
  dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null,
  appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(),
  querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop,
  width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const elements = {};
global.document = {
  getElementById: id => (elements[id] || (elements[id] = fakeEl())),
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  createElement: tag => fakeEl(), body: { appendChild: noop }, addEventListener: noop, title: ''
};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };

const ROOT = path.join(__dirname, '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('./_harness').preloadSync(ROOT);


const mapId = process.argv[2] || 'port';
try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* 换图：World.load 会 unload 上一图并重建 */
function loadMap(id) {
  const def = MapRegistry.get(id);
  if (!def) { failures.push('地图 ' + id + ' 未注册'); return null; }
  World.load(World.scene, def);
  return def;
}

function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}

(function run() {
  const def = loadMap(mapId);
  if (!def) { finish(); return; }

  /* ---- 0. 碰撞/平台统计 ---- */
  report('地图 ' + mapId + ' 加载', !!def && World.colliders.length > 0,
    'colliders=' + World.colliders.length + ' platforms=' + World.platforms.length +
    ' buildings=' + (def.buildings ? def.buildings.length : 0) +
    ' cover=' + (def.cover ? def.cover.length : 0));

  /* ---- 1. 建筑数断言（port ≥ 24，其余 ≥ 现状） ---- */
  const bN = def.buildings ? def.buildings.length : 0;
  const minB = mapId === 'port' ? 24 : 11;
  report('建筑数 ≥ ' + minB, bN >= minB, '实际 ' + bN + ' 栋');

  /* ---- 2. 两条主街端到端 A* 可通行 ---- */
  const mainStreets = {
    port:   [{ n: '纵主街', a: [130, 4], b: [130, 256] }, { n: '横主街', a: [4, 130], b: [256, 130] }],
    desert: [{ n: '纵主道', a: [170, 4], b: [170, 336] }, { n: '横主道', a: [4, 170], b: [336, 170] }],
    suburb: [{ n: '南北干道', a: [150, 4], b: [150, 296] }, { n: '东西干道', a: [4, 150], b: [296, 150] }]
  };
  for (const s of (mainStreets[mapId] || [])) {
    const p = findPath(s.a[0], s.a[1], s.b[0], s.b[1]);
    report(s.n + ' 端到端 A* 可通行', Array.isArray(p) && p.length > 0,
      p && p.length ? '路径长 ' + p.length + ' 点' : '无路径');
  }

  /* ---- 3. 全连通：20 出生点 × 3 据点（60 条）+ 反向 3×20（60 条）= 120 条 ---- */
  const caps = def.capturePoints;
  const spawns = [].concat((def.spawns.blue || []), (def.spawns.red || []));
  let okCnt = 0, failList = [];
  for (const s of spawns) {
    const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
    for (const c of caps) {
      const p = findPath(sx, sz, c.x, c.z);
      if (p && p.length) okCnt++; else failList.push('出生(' + sx + ',' + sz + ')->' + c.id);
    }
  }
  for (const c of caps) {
    for (const s of spawns) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      const p = findPath(c.x, c.z, sx, sz);
      if (p && p.length) okCnt++; else failList.push(c.id + '->出生(' + sx + ',' + sz + ')');
    }
  }
  const total = spawns.length * caps.length * 2;
  report('A* 全连通（出生点×据点 双向）', okCnt === total && failList.length === 0,
    okCnt + '/' + total + ' 条通路' + (failList.length ? ' | 失败: ' + failList.slice(0, 6).join('; ') : ''));

  /* ---- 4. 出生点不被碰撞体重叠（点落在 collider 内 = 出生即卡死） ---- */
  let spawnBad = [];
  for (const s of spawns) {
    const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
    for (const c of World.colliders) {
      if (sx >= c.min.x && sx <= c.max.x && sz >= c.min.z && sz <= c.max.z) {
        spawnBad.push('(' + sx + ',' + sz + ') 被碰撞体 [' + c.min.x.toFixed(1) + ',' + c.max.x.toFixed(1) + ']x[' + c.min.z.toFixed(1) + ',' + c.max.z.toFixed(1) + '] 覆盖');
        break;
      }
    }
  }
  report('出生点无碰撞体重叠', spawnBad.length === 0,
    spawnBad.length ? spawnBad.join('; ') : spawns.length + ' 个出生点全部安全');

  /* ---- 5. 新类型 key 统计（仅 port 报告；desert/suburb 顺带） ---- */
  const NEW_KEYS = ['bunker', 'hangar', 'pillbox', 'tower', 'wall', 'bridge', 'stairs', 'container', 'ruins'];
  const usedNew = (def.buildings || []).filter(b => b.key && NEW_KEYS.includes(b.key));
  const usedOld = (def.buildings || []).filter(b => b.key && !NEW_KEYS.includes(b.key));
  report('新 BuildingLib 类型使用数', true,
    '新类型 ' + usedNew.length + ' 栋（' + usedNew.map(b => b.key).join('/') + '）| 既有 ' + usedOld.length + ' 栋');

  /* ---- 6. v1.2 内联管线落地：新类型走 BUILDINGS_OUT 真模型（无占位盒/无 fallback 警告） ---- */
  if (mapId === 'port') {
    // 场景中带顶点色(vertexColors)+索引的网格 = 内联建筑模型（程序化占位盒/过程建筑为无 color 的 Box）
    let inlineMeshes = 0;
    World.scene.traverse(o => {
      if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        const g = o.geometry;
        if (g.attributes.color && g.index) inlineMeshes++;
      }
    });
    report('port 内联建筑渲染', inlineMeshes >= 14,
      '内联(顶点色+索引)网格 ' + inlineMeshes + ' 个（≥14 = N1~N14 全走真模型）| 无 BuildingLib 构建失败警告见日志');
    // 抽 2 栋核对：hangar/bunker 应有非占位几何（索引+颜色+三角形数 > 盒子 12 面）
    for (const k of ['hangar', 'bunker']) {
      const b = (def.buildings || []).find(x => x.key === k);
      if (!b) continue;
      const bb = BuildingLib.build(k, b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
      const ok = bb && bb.mesh && bb.mesh.geometry && bb.mesh.geometry.index && bb.mesh.geometry.attributes.color && (bb.mesh.geometry.index.count / 3) > 12;
      report(k + ' 内联几何（非占位盒）', !!ok, ok ? '三角形 ' + bb.mesh.geometry.index.count / 3 : '仍是占位盒/构建失败');
    }
    // 机制对象不产生阻塞碰撞：探照灯/配电箱/水塔/空投箱均为纯视觉（不 push colliders）
    if (typeof Mechanics !== 'undefined' && Mechanics.kind === 'searchlight') {
      report('port 机制激活', Mechanics.state.lights.length === 4 && Mechanics.state.powerPanels.length === 2,
        '探照灯 ' + Mechanics.state.lights.length + ' | 配电箱 ' + Mechanics.state.powerPanels.length);
    } else if (typeof Mechanics !== 'undefined') {
      report('port 机制激活', false, 'kind=' + Mechanics.kind);
    }
  }
  if (mapId === 'desert' && typeof Mechanics !== 'undefined') {
    report('desert 机制激活', Mechanics.kind === 'sandstorm' && !!Mechanics.state.tower,
      'kind=' + Mechanics.kind + ' 水塔=' + !!(Mechanics.state && Mechanics.state.tower));
  }
  if (mapId === 'suburb' && typeof Mechanics !== 'undefined') {
    report('suburb 机制激活', Mechanics.kind === 'airdrop',
      'kind=' + Mechanics.kind + ' drops=' + (Mechanics.state ? Mechanics.state.dropPts.length : 0) + ' arty=' + !!(Mechanics.state && Mechanics.state.arty));
  }

  finish();
})();

function finish() {
  console.log('\n===== 探针结果: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
  if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
  process.exit(0);
}
