// v1.3 独立验证 · 桥梯落地 + 桥下可通行（quality-lead 严守真）· test/_qa_v13_bridge.js
// 关键验收（design/maps/zone-br.md §7.3 + team-lead 授权）：
//   bridge 桥面+栏杆 collider 必须 overhead 分流（不进 World.colliders，只挡弹道）；
//   桥下地面 A* 可达 + 玩家/AI 实际可通行 + 手雷可穿过桥下 + 弹道被桥面挡。
// 本测试对「A* 可达」与「实际移动可通行」分别取证——A* 绿 ≠ 移动绿。
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
  createElement: tag => fakeEl(), body: { appendChild: noop }, title: '',
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; }
};
const docListeners = {};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };
const lsStore = {};
global.localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); }, removeItem: k => { delete lsStore[k]; } };

const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
Game.startSingle();
Game.phase = 'playing';

function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}
function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); }
function isArr(p) { return Array.isArray(p); }
function pxy(p) { return isArr(p) ? p[0] : p.x; }
function pzy(p) { return isArr(p) ? p[1] : p.z; }

const OVERHEAD_Y = 2.2; // world.js 常量（门楣/上层墙分流线）

/* 每图：主街车道（桥横跨的主街） + 桥清单 */
const MAPS = {
  suburb: { main: { a: [150, 100], b: [150, 120] }, bridges: [{ x: 135, z: 106.5, w: 30, d: 7 }] },
  port:   { main: { a: [130, 48], b: [130, 78] },  bridges: [{ x: 115, z: 56.5, w: 30, d: 7 }] },
  desert: { main: { a: [170, 108], b: [170, 136] }, bridges: [{ x: 155, z: 116.5, w: 30, d: 7 }] }
};

console.log('\n=== ① bridge/stairs 数据落地 + 内联构建 ===');
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const def = MapRegistry.get(id);
  const bridges = (def.buildings || []).filter(b => b.key === 'bridge');
  const stairs = (def.buildings || []).filter(b => b.key === 'stairs');
  report(id + ' bridge/stairs 数量符合 design §7.1', bridges.length >= 1 && stairs.length >= 2,
    'bridge=' + bridges.length + ' stairs=' + stairs.length);
  for (const b of bridges) {
    const bb = BuildingLib.build('bridge', b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
    const ok = bb && bb.mesh && bb.mesh.geometry && bb.mesh.geometry.index && (bb.mesh.geometry.index.count / 3) > 12;
    report(id + ' bridge 内联几何（非占位盒）', !!ok, ok ? '三角形 ' + bb.mesh.geometry.index.count / 3 : '占位盒/构建失败');
  }
}

console.log('\n=== ② bridge 桥面 collider 分流检查（design §7.3 硬约束） ===');
{
  loadMap('suburb');
  const def = MapRegistry.get('suburb');
  const b = def.buildings.find(x => x.key === 'bridge');
  const bb = BuildingLib.build('bridge', b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
  // 分类：桥面/栏杆 min.y≥2.6（高空） vs 桥墩 min.y<2.6（地面）
  const hi = bb.colliders.filter(c => c.min.y >= 2.6);
  const lo = bb.colliders.filter(c => c.min.y < 2.6);
  // 检查高空 collider 是否残留在 World.colliders（应进 World.overhead）
  const inColliders = hi.filter(h => World.colliders.some(c => c === h || (Math.abs(c.min.x - h.min.x) < 0.01 && Math.abs(c.min.z - h.min.z) < 0.01 && Math.abs(c.min.y - h.min.y) < 0.01)));
  const inOverhead = hi.filter(h => World.overhead.some(c => c === h || (Math.abs(c.min.x - h.min.x) < 0.01 && Math.abs(c.min.z - h.min.z) < 0.01 && Math.abs(c.min.y - h.min.y) < 0.01)));
  report('②-1 bridge 高空 collider（桥面/栏杆）应分流进 World.overhead', inColliders.length === 0 && hi.length > 0,
    '高空collider ' + hi.length + ' 个：colliders 残留 ' + inColliders.length + ' 个 / overhead ' + inOverhead.length + ' 个' +
    (hi.length ? '（桥面 min.y=' + hi[0].min.y.toFixed(2) + '~' + hi[0].max.y.toFixed(2) + '）' : ''));
  report('②-2 bridge 桥墩（地面 collider）保留在 World.colliders', lo.length > 0, '桥墩 collider ' + lo.length + ' 个');
  // 桥面 xz 投影是否覆盖主街车道（判定"实际通行是否受影响"的前提）
  const deck = hi[0];
  const laneX = MAPS.suburb.main.a[0];
  const laneOverlap = laneX > deck.min.x && laneX < deck.max.x;
  report('②-3 桥面 xz 投影覆盖主街车道（若覆盖则 ②-1 为硬性）', laneOverlap,
    '桥面 x[' + deck.min.x.toFixed(1) + ',' + deck.max.x.toFixed(1) + '] z[' + deck.min.z.toFixed(1) + ',' + deck.max.z.toFixed(1) + '] 车道x=' + laneX);
}

console.log('\n=== ③ 桥下实际通行（玩家 PC + AI moveTo）—— A* 与移动分别取证 ===');
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const M = MAPS[id];
  const ax = M.main.a[0], az = M.main.a[1], bz = M.main.b[1];
  // 自动选一条干净车道：walkable 且无地面 collider（min.y<2.6）覆盖整段（排除桥面高空 collider）
  let lane = null, laneInfo = '';
  for (let x = ax - 4; x <= ax + 4; x += 0.5) {
    const xr = Math.round(x * 2) / 2;
    let clear = true;
    for (let z = az; z <= bz; z += 1) {
      if (!World.walkable(xr, z)) { clear = false; break; }
      const groundBlock = World.colliders.some(c => c.min.y < 2.6 && xr > c.min.x && xr < c.max.x && z > c.min.z && z < c.max.z);
      if (groundBlock) { clear = false; break; }
    }
    if (clear) { lane = { x: xr }; break; }
  }
  report('③-A' + id + ' 找到无地面障碍的车道（前提）', !!lane, lane ? 'lane x=' + lane.x + ' z[' + az + ',' + bz + ']' : '未找到（车道本身被地面障碍堵死）');
  if (!lane) continue;
  // A* 可达性
  const p = findPath(lane.x, az, lane.x, bz);
  report('③-B' + id + ' 桥下主街 A* 可达（导航网格）', !!p && p.length > 0, p && p.length ? '路径 ' + p.length + ' 点' : '无路径');
  // AI moveTo 实际移动（2D 圆 vs AABB 碰撞，与玩家 PC 同款）
  // 预算：500×0.05×3.6=90m ≫ 段长（suburb 20 / port 30 / desert 28），排除预算不足假 FAIL
  const mu = new Unit('red', { x: lane.x, y: 0, z: az, weapon: 'rifle' });
  mu.alive = true; mu.ai = new AIBrain(mu, 'rifle');
  for (let i = 0; i < 500 && mu.pos.z < bz; i++) mu.ai.moveTo(lane.x, bz, 0.05, 3.6);
  const crossedAI = mu.pos.z >= bz - 1;
  report('③-C' + id + ' AI 地面移动可穿过桥下（实际通行）', crossedAI, '终 z=' + mu.pos.z.toFixed(1) + '（应 ≥' + (bz - 1) + '）' + (crossedAI ? '' : ' ← 被桥面 collider 2D 推出'));
  // 玩家 PC 实际移动（同款 2D 碰撞）
  // 预算：700×0.016×4.4=49m ≫ 段长，排除预算不足假 FAIL
  Game.player.pos.set(lane.x, World.heightAt(lane.x, az), az);
  Game.player.alive = true; Game.player.dead = false; Game.dead = false;
  PC.locked = true; PC.keys = new Set(['KeyW']); PC.yaw = Math.PI; PC.prone = false;
  for (let i = 0; i < 700 && Game.player.pos.z < bz; i++) PC.update(0.016); // 11.2s×4.4=49m
  const crossedPC = Game.player.pos.z >= bz - 1;
  report('③-D' + id + ' 玩家可穿过桥下（实际通行）', crossedPC, '终 z=' + Game.player.pos.z.toFixed(1) + '（应 ≥' + (bz - 1) + '）' + (crossedPC ? '' : ' ← 被桥面 collider 2D 推出'));
  // 手雷：Projectiles 碰撞是 3D y 判定（p.pos.y∈[min.y,max.y]）——低弹道 y<桥面 min.y 应不被桥面挡
  // v1.3 修复后桥面已分流进 World.overhead → 桥面 collider 需在 colliders+overhead 中联合定位
  const deckC = World.colliders.concat(World.overhead).find(c => c.min.y >= 2.6 && lane.x > c.min.x && lane.x < c.max.x && (az + bz) / 2 > c.min.z && (az + bz) / 2 < c.max.z);
  if (deckC) {
    const midZ = (deckC.min.z + deckC.max.z) / 2;
    // 复刻 Projectiles.update 的墙体碰撞条件：手雷 y=0.6 在桥下 → 不应判为撞墙
    const gx = lane.x, gz = midZ, gy = 0.6;
    const inDeck = gx > deckC.min.x && gx < deckC.max.x && gz > deckC.min.z && gz < deckC.max.z && gy > deckC.min.y && gy < deckC.max.y;
    report('③-E' + id + ' 手雷低弹道（y=0.6）不被桥面挡（3D y 判定）', !inDeck,
      '桥面 y[' + deckC.min.y.toFixed(2) + ',' + deckC.max.y.toFixed(2) + '] 手雷y=0.6 判撞墙=' + inDeck + '（应 false）');
    // 弹道：桥面高度被挡 / 桥下高度可过
    const midY = (deckC.min.y + deckC.max.y) / 2;
    const blockedHigh = World.rayBlocked(new THREE.Vector3(lane.x, midY, az - 1), new THREE.Vector3(lane.x, midY, bz + 1)) !== null;
    const blockedLow = World.rayBlocked(new THREE.Vector3(lane.x, deckC.min.y - 1.5, az - 1), new THREE.Vector3(lane.x, deckC.min.y - 1.5, bz + 1)) !== null;
    report('③-F' + id + ' 弹道：桥面高度被挡 / 桥下高度可过（只挡弹道）', blockedHigh && !blockedLow,
      'deck y[' + deckC.min.y.toFixed(2) + ',' + deckC.max.y.toFixed(2) + '] 桥面高被挡=' + blockedHigh + ' 桥下低可过=' + !blockedLow);
  } else {
    report('③-E' + id + ' 手雷低弹道（y=0.6）不被桥面挡（3D y 判定）', false, '未在车道上方找到桥面 collider');
    report('③-F' + id + ' 弹道：桥面高度被挡 / 桥下高度可过', false, '未在车道上方找到桥面 collider');
  }
}

console.log('\n=== ④ stairs 落地（实体阻挡 + 顶平台可站 y≈6） ===');
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const def = MapRegistry.get(id);
  const stairs = (def.buildings || []).filter(x => x.key === 'stairs');
  if (!stairs.length) { report(id + ' stairs 存在', false, '无'); continue; }
  const st = stairs[0];
  const bb = BuildingLib.build('stairs', st.x, st.z, st.ry || 0, { w: st.w, d: st.d, h: st.h });
  const footOk = bb.colliders.some(c => c.min.y < 0.01); // 底部实体
  const platform = bb.platforms[0];
  report(id + ' stairs 底部实体 + 顶平台 y≈6（与桥面同高衔接）', footOk && Math.abs(platform.y - 6) < 0.5,
    '平台 y=' + platform.y.toFixed(2) + ' 底部实体=' + footOk);
}

console.log('\n=== ⑤ 桥梯后密度回归（三图 A* 120/120 + 出生点零重叠 + 主街端到端） ===');
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const def = MapRegistry.get(id);
  const caps = def.capturePoints;
  const sps = [].concat(def.spawns.blue, def.spawns.red);
  let okCnt = 0; const failList = [];
  for (const s of sps) for (const c of caps) {
    if (findPath(pxy(s), pzy(s), c.x, c.z).length) okCnt++; else failList.push('出生->' + c.id);
  }
  for (const c of caps) for (const s of sps) {
    if (findPath(c.x, c.z, pxy(s), pzy(s)).length) okCnt++; else failList.push(c.id + '->出生');
  }
  const total = sps.length * caps.length * 2;
  report('⑤-' + id + ' A* 全连通 120/120', okCnt === total, okCnt + '/' + total + (failList.length ? ' | ' + failList.slice(0, 4).join(';') : ''));
  let spawnBad = [];
  for (const s of sps) {
    const sx = pxy(s), sz = pzy(s);
    for (const c of World.colliders) {
      if (c.min.y < 2.6 && sx >= c.min.x && sx <= c.max.x && sz >= c.min.z && sz <= c.max.z) { spawnBad.push('(' + sx + ',' + sz + ')'); break; }
    }
  }
  report('⑤-' + id + ' 出生点零重叠（地面 collider）', spawnBad.length === 0, spawnBad.length ? spawnBad.join(';') : sps.length + ' 个出生点安全');
  // 主街端到端（更长跨距）
  const MAINS = { suburb: [[150, 4, 150, 296], [4, 150, 296, 150]], port: [[130, 4, 130, 256], [4, 130, 256, 130]], desert: [[170, 4, 170, 336], [4, 170, 336, 170]] };
  let mainOk = true, mainFail = '';
  for (const st of (MAINS[id] || [])) {
    if (!findPath(st[0], st[1], st[2], st[3]).length) { mainOk = false; mainFail += ' (' + st[0] + ',' + st[1] + ')->(' + st[2] + ',' + st[3] + ')'; }
  }
  report('⑤-' + id + ' 主街端到端 A*', mainOk, mainOk ? '双街全通' : '断裂' + mainFail);
}

console.log('\n=== ⑥ 次生影响：桥面 collider 残留导致的沙暴庇护误判（desert） ===');
{
  // 桥面（高空 collider）残留在 World.colliders → _inShelter 把其 xz 外扩 2m 当庇护区
  // 设计预期：桥下地面是开阔地，沙暴应可灼伤（躲建筑/水塔才庇护）；桥面不该庇护桥下单位
  loadMap('desert');
  const mech = Mechanics;
  const def = MapRegistry.get('desert');
  const b = def.buildings.find(x => x.key === 'bridge'); // (155,116.5) 30×7×6
  const bb = BuildingLib.build('bridge', b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
  const deckC = bb.colliders.find(c => c.min.y >= 2.6);
  const under = { x: (deckC.min.x + deckC.max.x) / 2, z: (deckC.min.z + deckC.max.z) / 2 };
  const walkableUnder = World.walkable(under.x, under.z);
  const groundClear = !World.colliders.some(c => c.min.y < 2.6 && under.x > c.min.x && under.x < c.max.x && under.z > c.min.z && under.z < c.max.z);
  const sheltered = mech._inShelter(under.x, under.z);
  report('⑥-desert 桥下地面本应开阔可走（前提）', walkableUnder && groundClear, 'walkable=' + walkableUnder + ' 无地面障碍=' + groundClear + ' @(' + under.x.toFixed(1) + ',' + under.z.toFixed(1) + ')');
  report('⑥-desert 桥下不应被沙暴判为庇护（桥面非掩体）', !sheltered, '桥下 _inShelter=' + sheltered + '（应 false；桥面高空 collider 误扩为庇护区）');
}

console.log('\n===== _qa_v13_bridge 结果: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
process.exit(0);
