// v1.4 独立 QA：四地标 + 重定位回归 + 小地图标记（test/_qa_v14_landmarks.js）
// 职责：独立验证（不依赖 smoke.js 结论）
//   1) 四地标 BuildingLib 构建（真模型非占位盒）+ CONFIGS 注册 + status=inline
//   2) refinery/megatower 重定位新坐标生效（地图加载后 colliders 覆盖新 footprint，旧位无残留）
//   3) 三图 A* 120/120 全连通 + 出生点零重叠 + 主街端到端可通行（重定位不得破坏）
//   4) megatower 腿式：底部中心可通行、腿位不可通行（可通不可上）
//   5) 小地图标记：ui.js 静态审查（四 key 菱形）+ 可运行断言（每图命中 key 数 + 绘制计数）
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- DOM 桩（与 smoke.js 一致；mm 元素用记录式 context 以便统计绘制） ---- */
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
const docListeners = {};
global.document = {
  getElementById: id => (elements[id] || (elements[id] = fakeEl())),
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  createElement: tag => fakeEl(), body: { appendChild: noop }, title: '',
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; }
};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };
const lsStore = {};
global.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; }
};

const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ---- 记录式小地图 context（统计 #ffd166 菱形绘制） ---- */
const mmCalls = [];
const recordCtx = new Proxy({}, {
  get: (t, k) => (...a) => { mmCalls.push([k, ...a]); return undefined; },
  set: (t, k, v) => { mmCalls.push(['set:' + k, v]); t[k] = v; return true; }
});
const mmEl = { style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false }, width: 188, height: 188, getContext: () => recordCtx };
elements['mm'] = mmEl;

function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); Game.buildCoverPts(); }

/* ================================================================
 * 1) 四地标构建 + CONFIGS + inline 状态
 * ================================================================ */
try {
  // v1.5：用 REAL_DIMS（真实几何）构建，避免非等比拉伸告警，且能验证「真模型按真实尺寸可构建」
  const LM = {
    stadium:   { w: 220, d: 220, h: 32 },
    refinery:  { w: 193, d: 184.5, h: 45.5 },
    base:      { w: 223, d: 184, h: 65 },
    megatower: { w: 36, d: 36, h: 145.48 }
  };
  for (const key of Object.keys(LM)) {
    const bb = BuildingLib.build(key, 10, 10, 0, LM[key]);
    const ok = bb && bb.mesh && bb.mesh.geometry && bb.mesh.geometry.index && (bb.mesh.geometry.index.count / 3) > 12 && bb.colliders.length > 0;
    report('1) ' + key + ' 真模型构建（非占位盒）+ 碰撞盒', !!ok,
      ok ? '三角形 ' + (bb.mesh.geometry.index.count / 3) + ' | colliders ' + bb.colliders.length : '失败/占位盒');
    report('1) ' + key + ' CONFIGS 已注册', !!(BuildingLib.CONFIGS[key] && BuildingLib.CONFIGS[key].colliders && BuildingLib.CONFIGS[key].colliders.length), '');
  }
  const st = BuildingLib.status();
  for (const key of Object.keys(LM)) {
    report('1) ' + key + ' status=inline', st[key] === 'inline', 'status=' + st[key]);
  }
  // BUILDINGS_OUT 内联数据存在（13 型）
  const outKeys = (typeof BUILDINGS_OUT !== 'undefined' && BUILDINGS_OUT) ? Object.keys(BUILDINGS_OUT) : [];
  report('1) BUILDINGS_OUT 含 4 地标', ['base', 'refinery', 'stadium', 'megatower'].every(k => outKeys.includes(k)),
    outKeys.length + ' 型（' + outKeys.join('/') + '）');
} catch (e) { report('1) 四地标构建 崩溃', false, e.message); }

/* ================================================================
 * 2) 重定位新坐标生效：port refinery (196,18) scale 0.3 / desert megatower (250,70) scale 1.0
 *    注：refinery 碰撞盒在本地坐标从 (97,87.7) 起算（非角点 0），故真实 footprint 相对角点右移约 (29,26)。
 * ================================================================ */
try {
  // refinery v1.8：门洞加宽 x[119,143] 高 9 + 删门洞正中 2 立柱（21→19 盒）→ 世界宽 7.2m ≥3 nav cells 净空
  const ref = BuildingLib.build('refinery', 196, 18, 0, { w: 57.9, d: 55.35, h: 13.65 });
  const refX = [1e9, -1e9], refZ = [1e9, -1e9];
  ref.colliders.forEach(c => { refX[0] = Math.min(refX[0], c.min.x); refX[1] = Math.max(refX[1], c.max.x); refZ[0] = Math.min(refZ[0], c.min.z); refZ[1] = Math.max(refZ[1], c.max.z); });
  const refFoot = refX[0] >= 224 && refX[1] <= 255 && refZ[0] >= 43 && refZ[1] <= 62 && ref.colliders.length === 19 && ref.platforms.length === 3;
  report('2) refinery 新坐标 (196,18) scale .3 真实 footprint', refFoot,
    'colliders ' + ref.colliders.length + ' | 范围 x[' + refX[0].toFixed(1) + ',' + refX[1].toFixed(1) + '] z[' + refZ[0].toFixed(1) + ',' + refZ[1].toFixed(1) + '] | 平台 ' + ref.platforms.length);
  // 加载 port 后 World.colliders 确实包含该 footprint 内的碰撞体（证明地标按新坐标落位）
  loadMap('port');
  const portCollidesNew = World.colliders.filter(c => c.min.x >= 224 && c.max.x <= 256 && c.min.z >= 43 && c.max.z <= 63 && c.max.y >= 5).length >= 12;
  report('2) port 加载后 refinery 碰撞在场景中（新 footprint）', portCollidesNew, 'colliders=' + World.colliders.length);

  // megatower v1.5 新位：角点 (250,70) scale 1.0 → footprint x[250,286] z[70,106]
  const mt = BuildingLib.build('megatower', 250, 70, 0, { w: 36, d: 36, h: 145.48 });
  const mtX = [1e9, -1e9], mtZ = [1e9, -1e9];
  mt.colliders.forEach(c => { mtX[0] = Math.min(mtX[0], c.min.x); mtX[1] = Math.max(mtX[1], c.max.x); mtZ[0] = Math.min(mtZ[0], c.min.z); mtZ[1] = Math.max(mtZ[1], c.max.z); });
  const mtFoot = mtX[0] === 250 && mtX[1] === 286 && mtZ[0] === 70 && mtZ[1] === 106 && mt.colliders.length === 110 && mt.platforms.length === 11;
  report('2) megatower 新坐标 (250,70) scale 1.0 footprint+平台', mtFoot,
    'colliders ' + mt.colliders.length + ' | 平台 ' + mt.platforms.length + ' | 范围 x[' + mtX[0] + ',' + mtX[1] + '] z[' + mtZ[0] + ',' + mtZ[1] + ']');
  loadMap('desert');
  const desertHasMt = World.colliders.filter(c => c.min.x >= 249 && c.max.x <= 287 && c.min.z >= 69 && c.max.z <= 107).length >= 100;
  report('2) desert 加载后 megatower 碰撞在场景中（110 盒）', desertHasMt, 'colliders=' + World.colliders.length);
} catch (e) { report('2) 重定位坐标 崩溃', false, e.message); }

/* ================================================================
 * 3) 三图 A* 120/120 + 出生点零重叠 + 主街端到端可通行
 * ================================================================ */
try {
  const MAIN = {
    suburb: [[150, 4, 150, 296], [4, 150, 296, 150]],
    port: [[130, 4, 130, 256], [4, 130, 256, 130]],
    desert: [[170, 4, 170, 336], [4, 170, 336, 170]]
  };
  for (const id of ['suburb', 'port', 'desert']) {
    const def = MapRegistry.get(id);
    loadMap(id);
    // 主街端到端 A*
    for (const st of MAIN[id]) {
      const p = findPath(st[0], st[1], st[2], st[3]);
      report('3) ' + id + ' 主街 (' + st[0] + ',' + st[1] + ')->(' + st[2] + ',' + st[3] + ') 可通行',
        Array.isArray(p) && p.length > 0, p && p.length ? '路径 ' + p.length + ' 点' : '无路径');
    }
    // 20 出生点 × 3 据点 双向 = 120 条
    const caps = def.capturePoints;
    const spawns = [].concat(def.spawns.blue, def.spawns.red);
    let okCnt = 0, failList = [];
    for (const s of spawns) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      for (const c of caps) {
        if (findPath(sx, sz, c.x, c.z).length) okCnt++; else failList.push('出生(' + sx + ',' + sz + ')->' + c.id);
        if (findPath(c.x, c.z, sx, sz).length) okCnt++; else failList.push(c.id + '->出生(' + sx + ',' + sz + ')');
      }
    }
    report('3) ' + id + ' A* 全连通 120/120', okCnt === 120 && failList.length === 0,
      okCnt + '/120 条' + (failList.length ? ' | 失败: ' + failList.slice(0, 4).join('; ') : ''));
    // 出生点零重叠
    let spawnBad = [];
    for (const s of spawns) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      for (const c of World.colliders) {
        if (sx >= c.min.x && sx <= c.max.x && sz >= c.min.z && sz <= c.max.z) {
          spawnBad.push('(' + sx + ',' + sz + ') 被碰撞体覆盖');
          break;
        }
      }
    }
    report('3) ' + id + ' 出生点零重叠', spawnBad.length === 0, spawnBad.length ? spawnBad.join('; ') : spawns.length + ' 个出生点安全');
  }
} catch (e) { report('3) 三图回归 崩溃', false, e.message); }

/* ================================================================
 * 4) megatower v1.5：中空可进（薄 perimeter 墙）+ 11 层楼板可逐层登顶
 *    角点 (250,70) scale 1.0 → footprint x[250,286] z[70,106]
 *    近墙 z[70,72] / 远墙 z[103,106](门洞 x[265,271]) / 左墙 x[250,252] / 右墙 x[284,286]；地面内庭全开放
 * ================================================================ */
try {
  loadMap('desert');
  // 内庭中心可通行（地面层无遮挡，中空设计）
  report('4) megatower 内庭中心可通行', World.walkable(268, 88), 'walkable(268,88)=' + World.walkable(268, 88));
  // 四向 perimeter 墙不可通行（CELL=2，取落在墙 cell 内的点）
  const wallPoints = [[268, 71], [251, 80], [285, 80], [260, 104], [280, 104]]; // 近/左/右/远左/远右
  let wallsBlocked = 0;
  for (const [wx, wz] of wallPoints) {
    const blocked = !World.walkable(wx, wz);
    if (blocked) wallsBlocked++;
    else report('4) perimeter 墙位 (' + wx + ',' + wz + ') 应不可通行', false, 'walkable=true（墙碰撞缺失）');
  }
  report('4) megatower 四向 perimeter 墙不可通行', wallsBlocked === 5, wallsBlocked + '/5 墙碰撞生效');
  // 远墙门洞可通行（入口）
  report('4) megatower 远墙门洞可通行（入口）', World.walkable(268, 104), 'walkable(268,104)=' + World.walkable(268, 104));
  // 内庭跨区可通行（地面层连通）
  const midOk = World.walkable(264, 88) && World.walkable(272, 88) && World.walkable(264, 90) && World.walkable(272, 90);
  report('4) megatower 内庭跨区可通行', midOk, '(264,88)/(272,88)/(264,90)/(272,90)');
  // 可上：CONFIGS 含 11 层楼板（逐层登顶）
  const mtCfg = BuildingLib.CONFIGS['megatower'];
  const mtPlat = BuildingLib.build('megatower', 250, 70, 0, { w: 36, d: 36, h: 145.48 }).platforms || [];
  report('4) megatower 11 层楼板（可逐层登顶）', mtCfg.platforms && mtCfg.platforms.length === 11 && mtPlat.length === 11, 'platforms=' + mtPlat.length);
} catch (e) { report('4) megatower 可进可登 崩溃', false, e.message); }

/* ================================================================
 * 5) 小地图标记：静态审查 + 可运行断言
 * ================================================================ */
try {
  // 静态审查：ui.js 中四地标绘制逻辑存在（金色菱形 + 四 key 判定；兼容带引号/无引号对象键写法）
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  const keysOk = ['base', 'refinery', 'stadium', 'megatower'].every(k =>
    uiSrc.includes("'" + k + "'") || uiSrc.includes('"' + k + '"') || new RegExp('\\b' + k + '\\s*:').test(uiSrc));
  report('5) ui.js 静态：四地标 key 判定存在', keysOk, '');
  report('5) ui.js 静态：金色菱形绘制（#ffd166 + moveTo/lineTo + closePath）',
    uiSrc.includes('#ffd166') && uiSrc.includes('lineTo') && uiSrc.includes('closePath') && uiSrc.includes('World.mapDef.buildings'), '');
  // 可运行断言：每图加载后，mapDef.buildings 命中四 key 的数量 = 预期；MiniMap.draw 绘制计数 = 命中数
  const EXPECT = { suburb: 1, port: 1, desert: 2 };
  for (const id of Object.keys(EXPECT)) {
    loadMap(id);
    const hit = (World.mapDef.buildings || []).filter(b => b && b.key && ['base', 'refinery', 'stadium', 'megatower'].includes(b.key)).length;
    report('5) ' + id + ' 地标 key 命中 ' + hit + '（预期 ' + EXPECT[id] + '）', hit === EXPECT[id], hit + ' 处');
    // 绘制计数：#ffd166 只在四地标菱形处设置（mortar 关闭；据点/机制不用金色）
    mmCalls.length = 0;
    MiniMap.t = 0;
    MiniMap.draw(); MiniMap.draw(); // t%2 节流，第 2 次实际绘制
    const goldSet = mmCalls.filter(c => c[0] === 'set:fillStyle' && c[1] === '#ffd166').length;
    report('5) ' + id + ' MiniMap.draw 金色菱形绘制 ' + goldSet + ' 次（= 地标数）', goldSet === EXPECT[id], 'fillStyle=#ffd166 × ' + goldSet);
  }
} catch (e) { report('5) 小地图标记 崩溃', false, e.message); }

console.log('\n===== v1.4 地标/重定位 QA: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
if (failures.length) failures.forEach(f => console.log(' - ' + f));
process.exit(failures.length ? 1 : 0);
