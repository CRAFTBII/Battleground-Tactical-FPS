// 独立探针（不落库，仅本 QA 会话）：边界场景推演
// 1) 倒地者在圈外吃环境伤害 → 扣 downHp
// 2) 救援中被打断 → cancelRevive 且进度清零
// 3) 全员倒地 → 不死循环（无人救 → 流血 → 重生）
// 4) AI 处决不追出 25m
'use strict';
const fs = require('fs');
const path = require('path');

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
global.localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); }, removeItem: k => { delete lsStore[k]; } };

const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const vm = require('vm');
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { console.log('LOAD FAIL ' + f + ': ' + e.message); process.exit(1); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

try { init(); } catch (e) { console.log('init FAIL: ' + e.message); process.exit(1); }
Game.startSingle();
function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); Game.buildCoverPts(); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = (t, ok, d) => console.log((ok ? 'PASS' : 'FAIL') + ' | ' + t + (d ? ' | ' + d : ''));

/* ============ 探针 1：倒地者在圈外吃环境伤害 → 扣 downHp ============ */
console.log('\n=== 探针1 圈外环境伤害 vs downHp ===');
try {
  loadMap('suburb');
  const u = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  u.pos.set(120, 0, 120); u.hp = 1; u.armor = 0; u.alive = true;
  Game.applyDamage(u, 999, null, false); // 环境击倒
  R('P1 前置：环境击倒', u.down === true, 'life=' + u.life);
  const downHp0 = u.downHp;
  // 模拟圈外环境伤害（attacker=null，owner=null 不产分）
  Game.applyDamage(u, 10, null, false);
  R('P1 环境伤害扣 downHp', u.downHp === downHp0 - 10, 'downHp ' + downHp0 + '→' + u.downHp);
  // 环境伤害打死 = 环境致死（cause=zone），不计分
  const s0 = Game.score.blue + Game.score.red;
  Game.applyDamage(u, 999, null, false);
  R('P1 环境处决（无击杀者，不产分）', u.life === 'dead' && (Game.score.blue + Game.score.red) === s0, 'life=' + u.life + ' scoreΔ=' + ((Game.score.blue + Game.score.red) - s0));
} catch (e) { R('P1 崩溃', false, e.message); }

/* ============ 探针 2：救援中被打断 → cancelRevive 且进度清零 ============ */
console.log('\n=== 探针2 救援中断 ===');
try {
  loadMap('suburb');
  const downed = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  const rescuer = Game.units.find(x => x.ai && x.alive && x.team === 'blue' && x !== downed);
  downed.pos.set(120, 0, 120); rescuer.pos.set(121, 0, 120); // 1m 内
  downed.hp = 1; downed.armor = 0; downed.alive = true;
  Game.applyDamage(downed, 999, null, false); // 击倒
  const ok1 = Game.startRevive(rescuer, downed);
  R('P2 startRevive 锁定', ok1 === true && downed.reviver === rescuer, 'reviver=' + (downed.reviver ? downed.reviver.name : 'null'));
  downed.reviveT = 2.0; // 模拟已读条 2s
  // 救援者受伤 → cancelRevive
  Game.cancelRevive(rescuer, downed);
  R('P2 被打断 → cancelRevive 清零', downed.reviveT === 0 && downed.reviver === null, 'reviveT=' + downed.reviveT + ' reviver=' + downed.reviver);
  // 重新开始再验证"倒地者再受伤害 → 中断"（§2.1 中断④，applyDamage 内部触发）
  const ok2 = Game.startRevive(rescuer, downed);
  downed.reviveT = 1.5;
  Game.applyDamage(downed, 1, null, false); // 倒地者吃环境伤害
  R('P2 倒地者受伤害自动中断', ok2 === true && downed.reviveT === 0 && downed.reviver === null, 'reviveT=' + downed.reviveT + ' reviver=' + downed.reviver);
} catch (e) { R('P2 崩溃', false, e.message); }

/* ============ 探针 3：全员倒地 → 不死循环 ============ */
console.log('\n=== 探针3 全员倒地循环 ===');
try {
  loadMap('suburb');
  // 把蓝队全员（含玩家外的 AI）击倒
  let blueAIs = Game.units.filter(x => x.ai && x.team === 'blue' && x.alive);
  for (const b of blueAIs) {
    b.pos.set(120 + Math.random() * 5, 0, 120 + Math.random() * 5);
    b.hp = 1; b.armor = 0; b.alive = true; b.down = false; b.life = 'alive';
    Game.applyDamage(b, 999, null, false);
  }
  blueAIs = Game.units.filter(x => x.ai && x.team === 'blue' && x.down);
  R('P3 前置：蓝队 AI 全倒', blueAIs.length > 0 && blueAIs.every(x => x.down), 'down=' + blueAIs.length);
  // 让所有倒地者流血倒计时极短 → 依次 toDead
  let dead = 0, maxIter = 60;
  for (let i = 0; i < maxIter && blueAIs.some(x => x.down); i++) {
    for (const b of blueAIs) if (b.down) b.bleedT = Math.min(b.bleedT, 0.01);
    Game.tickDown(0.05);
  }
  dead = blueAIs.filter(x => x.life === 'dead').length;
  R('P3 流血致死全部结算（非卡死）', dead === blueAIs.length, 'dead=' + dead + '/' + blueAIs.length);
  // 重生循环：respawnT 已设置 → respawnAI 应被 update 触发（不死循环）
  const preAlive = Game.units.filter(x => x.ai && x.team === 'blue' && x.alive).length;
  for (const b of blueAIs) if (b.life === 'dead' && b.ai && b.respawnT) b.respawnT = now_s() - 0.1; // 立即到点
  for (let i = 0; i < 10; i++) Game.update(0.1);
  const postAlive = Game.units.filter(x => x.ai && x.team === 'blue' && x.alive).length;
  R('P3 死亡后自动重生（AI 补员）', postAlive > preAlive, 'alive ' + preAlive + '→' + postAlive);
} catch (e) { R('P3 崩溃', false, e.message); }

/* ============ 探针 4：AI 处决不追出 25m ============ */
console.log('\n=== 探针4 AI 处决 25m 边界 ===');
try {
  loadMap('suburb');
  const ex = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  const downT = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  downT.pos.set(200, 0, 200); downT.hp = 1; downT.armor = 0; downT.alive = true;
  Game.applyDamage(downT, 999, null, false); // 击倒蓝方
  ex.pos.set(150, 0, 150); // 50m 外
  // 清感知：无活敌可见
  ex.ai.canSee = false; ex.ai.target = null; ex.ai.lastDmgT = -99;
  ex.ai.execTarget = null;
  // 先确认 findExecTarget 在 50m 外找不到（25m 上限）
  const t50 = ex.ai.findExecTarget();
  R('P4 50m 外 findExecTarget 返回 null（25m 上限）', t50 === null, 'target=' + (t50 ? t50.name : 'null'));
  // 强制把 execTarget 指向 50m 外的倒地者（模拟"已锁定后目标爬远"）
  ex.ai.execTarget = downT;
  const x0 = ex.pos.x, z0 = ex.pos.z;
  for (let i = 0; i < 20; i++) ex.ai.update(0.1, Game.squads.red);
  const moved = Math.sqrt(U.dist2(x0, z0, ex.pos.x, ex.pos.z));
  R('P4 已锁定目标在 50m 外：AI 是否停止追击（设计：不追出 25m）', moved < 30, 'moved=' + moved.toFixed(1) + 'm (50m 外应停止，若 >30m 则越界追出)');
  R('P4 AI 状态仍为 execute（应离开）', ex.ai.state !== 'execute', 'state=' + ex.ai.state);
} catch (e) { R('P4 崩溃', false, e.message); }

console.log('\n===== 独立探针结束 =====');
