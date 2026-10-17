// v2.4 独立 QA：救援消耗医疗包 + 分配调整
// 运行：node test/_qa_v24_revivekit.js
'use strict';
const fs = require('fs');

/* ---- DOM 桩（对齐 smoke.js） ---- */
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
const failures = [];
for (const f of scripts.slice(1)) {
  const fp = path.join(ROOT, f);
  try { vm.runInThisContext(fs.readFileSync(fp, 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

let passed = 0, failed = 0;
const R = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};
try { init(); } catch (e) { failures.push('init 崩溃: ' + e.message); }
Game.startSingle();
const p = Game.player;
const blueAI = Game.units.filter(u => u.ai && u.team === 'blue');
const redAI = Game.units.filter(u => u.ai && u.team === 'red');

/* ============ 1. 分配（v2.4 常量） ============ */
console.log('\n[1] 医疗包分配');
R('玩家开局 6 包', PlayerGun.medkits === CFG.PLAYER_START_MEDKITS && CFG.PLAYER_START_MEDKITS === 6, 'medkits=' + PlayerGun.medkits);
const medic = blueAI.find(u => u.ai.role === 'medic');
const nonMedic = blueAI.find(u => u.ai.role !== 'medic');
R('AI 医疗兵 8 包', medic.ai.medkits === CFG.AI_MEDIC_MEDKITS, '=' + medic.ai.medkits);
R('AI 非医疗兵 4 包', nonMedic.ai.medkits === CFG.AI_MEDKITS, '=' + nonMedic.ai.medkits);
R('AI 流血箱掉包概率常量 0.75', CFG.AI_LOOT_MEDKIT_CHANCE === 0.75, '=' + CFG.AI_LOOT_MEDKIT_CHANCE);

/* ============ 2. 玩家救 AI：有包能救、完成扣包 ============ */
console.log('\n[2] 玩家救 AI');
const downed = blueAI[0];
Game.toDown(downed, null);
downed.pos.set(p.pos.x + 1, p.pos.y, p.pos.z); // 1m 内
const kitsBefore = PlayerGun.medkits;
R('有包 → 开始救援', Game.startRevive(p, downed) === true);
downed.reviveT = CFG.REVIVE_TIME;
Game.completeRevive(p, downed);
R('救援完成扣 1 包', PlayerGun.medkits === kitsBefore - 1, 'before=' + kitsBefore + ' after=' + PlayerGun.medkits);
R('被救起恢复', downed.life === 'alive' && downed.alive);

/* ============ 3. 玩家没包不能救 + 中断不扣 ============ */
console.log('\n[3] 没包不能救 / 中断不扣');
const downed2 = blueAI[1];
Game.toDown(downed2, null);
downed2.pos.set(p.pos.x + 1, p.pos.y, p.pos.z);
PlayerGun.medkits = 0;
R('没包 → 不能开始救援', Game.startRevive(p, downed2) === false);
R('没包时救援目标未锁定', !p._revLast || downed2.reviver !== p);
PlayerGun.medkits = 5;
Game.startRevive(p, downed2);
const beforeCancel = PlayerGun.medkits;
Game.cancelRevive(p, downed2);
R('救援中断不扣包', PlayerGun.medkits === beforeCancel, 'before=' + beforeCancel + ' after=' + PlayerGun.medkits);

/* ============ 4. AI 救 AI：扣 AI 的包 ============ */
console.log('\n[4] AI 救 AI');
const aiRescuer = blueAI[2], aiDowned = blueAI[3];
Game.toDown(aiDowned, null);
aiRescuer.pos.set(aiDowned.pos.x + 1, aiDowned.pos.y, aiDowned.pos.z);
const aiKitsBefore = aiRescuer.ai.medkits;
R('AI 有包 → 开始救援', Game.startRevive(aiRescuer, aiDowned) === true);
aiDowned.reviveT = CFG.REVIVE_TIME;
Game.completeRevive(aiRescuer, aiDowned);
R('AI 救援完成扣 1 包', aiRescuer.ai.medkits === aiKitsBefore - 1, 'before=' + aiKitsBefore + ' after=' + aiRescuer.ai.medkits);

/* ============ 5. AI 没包不锁定救援目标 ============ */
console.log('\n[5] AI 没包不锁定目标');
const noKitAI = redAI[4];
const redDown = redAI[5];
Game.toDown(redDown, null);
noKitAI.ai.medkits = 0;
noKitAI.ai.reviveTarget = redDown; // 模拟已锁定 → update 应清空
noKitAI.pos.set(redDown.pos.x + 1, redDown.pos.y, redDown.pos.z);
noKitAI.ai.losT = 0.5; // 冻结 perceive
noKitAI.ai.update(0.05, Game.squads.red);
R('AI 医疗包耗尽 → 不锁定救援目标', !noKitAI.ai.reviveTarget, 'rt=' + (noKitAI.ai.reviveTarget && noKitAI.ai.reviveTarget.name));
R('AI 医疗包耗尽 → 不进 revive 态', noKitAI.ai.state !== 'revive', 'state=' + noKitAI.ai.state);

/* ============ 6. 红队全兵种锁定条件修复（v2.2 疏漏回归） ============ */
console.log('\n[6] 红队全兵种锁定条件（有敌在旁也锁）');
// 选存活红队非医疗兵（前面测试处决过 redAI[0]，dead 单位 update 直接 return 不锁目标 → 必须过滤 alive）
const redRescuer = redAI.find(u => u.alive && u.ai.role !== 'medic' && u !== redDown && u.ai.medkits > 0);
redRescuer.ai.medkits = 4;
redRescuer.pos.set(redDown.pos.x + 2, redDown.pos.y, redDown.pos.z); // 强制进入 40m 搜索半径（红队全兵种），防出生点距离 flaky
redRescuer.ai.reviveTarget = null;
redRescuer.ai.lootCd = 99;
redRescuer.ai.canSee = true; redRescuer.ai.target = p;
redRescuer.ai.losT = -1;
redRescuer.ai.update(0.05, Game.squads.red);
R('红队非医疗兵有敌在旁仍锁定救援目标', !!redRescuer.ai.reviveTarget, 'rt=' + (redRescuer.ai.reviveTarget && redRescuer.ai.reviveTarget.name));
R('红队非医疗兵进入 revive 态', redRescuer.ai.state === 'revive', 'state=' + redRescuer.ai.state);

/* ============ 汇总 ============ */
console.log('\n===== 救援耗包 v2.4 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
if (failures.length) { console.log('加载错误:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(failed || failures.length ? 1 : 0);
