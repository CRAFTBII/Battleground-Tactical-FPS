// v2.9 独立 QA：救援交互修复（玩家朝向锥体取反 / 联机远端救援者）
// 运行：node test/qa/_qa_v30_revive.js
'use strict';
const fs = require('fs');

/* ---- DOM 桩（对齐 _qa_v24_revivekit.js） ---- */
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
  createElement: () => fakeEl(), body: { appendChild: noop }, title: '',
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  dispatchEvent: e => { for (const fn of (docListeners[e.type] || [])) fn(e); return true; },
  exitPointerLock: noop, pointerLockElement: null
};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = () => {};
const lsStore = {};
global.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; }
};

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const vm = require('vm');
const loadFailures = [];
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { loadFailures.push('加载 ' + f + ' 失败: ' + e.message); }
}
require('../_harness').preloadSync(ROOT);

let passed = 0, failed = 0;
const R = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};
try { init(); } catch (e) { loadFailures.push('init 崩溃: ' + e.message); }
Game.startSingle();
const p = Game.player;
const blueAI = Game.units.filter(u => u.ai && u.team === 'blue');

/* 玩家视线正前方（相机 rotation.y=yaw，YXZ 序）= (-sin yaw, -cos yaw)，与 PC.update 移动分解一致 */
const fwd = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

/* ============ 1. 玩家朝向锥体 ============ */
console.log('\n[1] 玩家朝向锥体（v2.9 取反修复）');
const ally = blueAI[0];
const resetAlly = () => {
  Game.toDown(ally, null);
  ally.reviver = null; ally.reviveT = 0;
  Game.playerReviveTarget = null; Game._revLast = null;
  p.dead = false; p.down = false; p.alive = true;
  p.pos.set(150, p.pos.y, 150);
  PlayerGun.medkits = 6;
};
let frontOK = 0, backBad = 0, tested = 0;
for (const deg of [0, 45, 90, 135, 180, 225, 270, 315]) {
  const yaw = deg * Math.PI / 180;
  resetAlly();
  const f = fwd(yaw);
  ally.pos.set(p.pos.x + f.x * 1.2, p.pos.y, p.pos.z + f.z * 1.2);
  p.yaw = yaw;
  tested++;
  if (Game.findReviveTargetForPlayer() === ally) frontOK++;
  // 反方向（背后 1.2m）必须找不到——证明修的是方向而不是把扇形删了
  const b = fwd(yaw);
  ally.pos.set(p.pos.x - b.x * 1.2, p.pos.y, p.pos.z - b.z * 1.2);
  if (!Game.findReviveTargetForPlayer()) backBad++;
}
R('8 个方位：正前方 1.2m 倒地队友全部可锁定', frontOK === tested, frontOK + '/' + tested);
R('8 个方位：正后方 1.2m 不可锁定（锥体仍在，未退化为全向）', backBad === tested, backBad + '/' + tested);

/* ============ 2. 距离与状态过滤 ============ */
console.log('\n[2] 距离与状态过滤');
resetAlly();
p.yaw = 0;
const f0 = fwd(0);
ally.pos.set(p.pos.x + f0.x * (CFG.REVIVE_RANGE + 1.5), p.pos.y, p.pos.z + f0.z * (CFG.REVIVE_RANGE + 1.5));
R('超出 REVIVE_RANGE → 不可锁定', Game.findReviveTargetForPlayer() === null, 'range=' + CFG.REVIVE_RANGE);
ally.pos.set(p.pos.x + f0.x * 1.2, p.pos.y, p.pos.z + f0.z * 1.2);
ally.team = 'red';
R('敌方倒地单位不作为救援目标', Game.findReviveTargetForPlayer() === null);
ally.team = 'blue';
ally.reviver = blueAI[1];
R('已被他人锁定 → 不可抢占', Game.findReviveTargetForPlayer() === null);
ally.reviver = null;

/* ============ 3. E 键全链路 ============ */
console.log('\n[3] E 键链路（找到 → startRevive → 锁定）');
resetAlly();
PC.locked = true;
p.yaw = 0; PC.yaw = 0;
const fz = fwd(0);
ally.pos.set(p.pos.x + fz.x * 1.2, p.pos.y, p.pos.z + fz.z * 1.2);
document.dispatchEvent({ type: 'keydown', code: 'KeyE', preventDefault: noop });
R('按 E 后玩家锁定救援目标', Game.playerReviveTarget === ally, Game.playerReviveTarget ? Game.playerReviveTarget.name : 'null');
R('倒地队友记录救援者', ally.reviver === p, ally.reviver ? ally.reviver.name : 'null');

/* ============ 4. 读条推进与医救 ============ */
console.log('\n[4] 读条推进');
const kitsBefore = PlayerGun.medkits;
ally.reviveT = 0; Game._revLast = null;
for (let i = 0; i < 40 && ally.down; i++) { Game._revLast = { x: p.pos.x, z: p.pos.z }; Game.tickDown(0.1); }
R('静止读条 REVIVE_TIME 后被救起', !ally.down && ally.life === 'alive', 'down=' + ally.down + ' life=' + ally.life);
R('被救起血量为 REVIVE_HP', Math.abs(ally.hp - CFG.REVIVE_HP) < 0.001, 'hp=' + ally.hp);
R('救援完成扣 1 医疗包', PlayerGun.medkits === kitsBefore - 1, 'before=' + kitsBefore + ' after=' + PlayerGun.medkits);

/* ============ 5. 联机远端救援者（ai=null） ============ */
console.log('\n[5] 联机远端救援者');
const remote = new Unit('blue', { x: p.pos.x + 1, y: p.pos.y, z: p.pos.z, name: '队员', remote: true, label: '队员' });
remote.id = 'peer-1';
Game.units.push(remote);
const downedAI = blueAI[2];
Game.toDown(downedAI, null);
downedAI.reviver = null; downedAI.reviveT = 0;
remote.pos.set(downedAI.pos.x + 1, downedAI.pos.y, downedAI.pos.z);
R('远端玩家（无 ai 对象）可以开始救援', Game.startRevive(remote, downedAI) === true);
const t0 = downedAI.reviveT;
Game.tickDown(0.2);
R('远端玩家的读条由 tickDown 推进', downedAI.reviveT > t0, 'reviveT=' + downedAI.reviveT.toFixed(2));
downedAI.reviveT = CFG.REVIVE_TIME - 0.05;
Game.tickDown(0.1);
R('远端玩家读条满 → 完成救援', !downedAI.down && downedAI.life === 'alive', 'down=' + downedAI.down);
// 清理远端单位，避免污染后续
Game.units = Game.units.filter(u => u !== remote);

console.log('\n' + (loadFailures.length ? '加载问题:\n' + loadFailures.join('\n') + '\n' : ''));
console.log('===== 救援交互 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
process.exit(failed ? 1 : 0);
