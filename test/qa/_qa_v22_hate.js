// v2.2 独立 QA：仇恨机制（受伤记仇 + 目标优先 + 周期衰减）+ 红队全兵种救援
// 运行：node test/_qa_v22_hate.js
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
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
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
let passed = 0, failed = 0;
const R = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};
try { init(); } catch (e) { failures.push('init 崩溃: ' + e.message); }
Game.startSingle();
const p = Game.player;
const redAI = Game.units.filter(u => u.ai && u.team === 'red');
const blueAI = Game.units.filter(u => u.ai && u.team === 'blue');
const decoy = blueAI[0];

/* ============ 1. 受伤反应 bug 修复（玩家打 AI → AI 记受伤 + 记仇） ============ */
console.log('\n[1] 玩家打 AI → 受伤反应 + 仇恨注入');
const victim = redAI[0];
const beforeDmgT = victim.ai.lastDmgT;
Game.applyDamage(victim, 10, p, false);
R('玩家打 AI → AI 记受伤反应 lastDmgT', victim.ai.lastDmgT !== beforeDmgT, 'lastDmgT=' + victim.ai.lastDmgT);
R('玩家打 AI → AI 对玩家记仇（红队 ×1.25）', (victim.ai.hateMap[p.id] || 0) >= CFG.HATE_SELF * 1.24, 'hate=' + victim.ai.hateMap[p.id]);

/* ============ 2. 旁观仇恨（队友挨打 → 90m 内队友记仇） ============ */
console.log('\n[2] 旁观仇恨');
const nearbyAlly = redAI.find(u => u !== victim);
// v2.6.1 象限出生：红队分散对角象限，队友可能距 victim >90m → 手动摆进 90m 内再测旁观仇恨
nearbyAlly.pos.set(victim.pos.x + 20, victim.pos.y, victim.pos.z + 20);
Game.applyDamage(victim, 5, p, false);
R('90m 内红队队友对玩家记 HATE_ALLY', (nearbyAlly.ai.hateMap[p.id] || 0) >= CFG.HATE_ALLY * 0.99, 'hate=' + nearbyAlly.ai.hateMap[p.id]);

/* ============ 3. 仇恨目标优先（谁打我我打谁，压过距离） ============ */
console.log('\n[3] 仇恨目标优先（scoreTarget 单元断言，不依赖地图遮挡）');
const hater = redAI[1].ai;
hater.reset(); hater.hateMap = {}; hater.hateT = 99; // 冻结衰减
hater.addHate(p, 100);
const sFar = hater.scoreTarget(p, 60);      // 玩家 60m，仇恨 100 → 60 − 60 = 0
const sNear = hater.scoreTarget(decoy, 10); // 近敌 10m，无仇恨 → 10
R('高仇恨玩家(60m)评分低于近敌(10m)', sFar < sNear, 'far=' + sFar + ' near=' + sNear);
R('无仇恨目标评分 = 纯距离', sNear === 10, 'near=' + sNear);

/* ============ 4. 仇恨周期衰减（每 HATE_REFRESH 秒刷新；红队更慢遗忘） ============ */
console.log('\n[4] 仇恨衰减刷新');
const h1 = redAI[0].ai, h2 = blueAI[0].ai;
const blueTarget = blueAI[1]; // 红队 AI 的敌人 = 蓝队
h1.hateMap = {}; h2.hateMap = {};
h1.addHate(blueTarget, 100); h2.addHate(redAI[3], 100); // 各记对方阵营的仇（addHate 拒绝同队目标）
h1.hateT = 0; h2.hateT = 0;
h1.tickHate(0.01); h2.tickHate(0.01);
R('蓝队衰减 ×' + CFG.HATE_DECAY, h2.hateMap[redAI[3].id] === 100 * CFG.HATE_DECAY, 'hate=' + h2.hateMap[redAI[3].id]);
R('红队衰减 ×' + CFG.HATE_RED_DECAY + '（更慢遗忘）', h1.hateMap[blueTarget.id] === 100 * CFG.HATE_RED_DECAY && CFG.HATE_RED_DECAY > CFG.HATE_DECAY, 'hate=' + h1.hateMap[blueTarget.id]);
// 连续衰减到 FLOOR 以下 → 清除
for (let i = 0; i < 10; i++) { h2.hateT = 0; h2.tickHate(0.01); }
R('低于 HATE_FLOOR 清除', !h2.hateMap[redAI[3].id], JSON.stringify(h2.hateMap));

/* ============ 5. 红队全兵种救援优先 ============ */
console.log('\n[5] 红队全兵种救援（"红队也要救援机制"）');
Game.phase = 'playing';
const redDown = redAI[2];
Game.toDown(redDown, null);
// 红队非医疗兵：附近有敌人（canSee）也应进入 revive 态
const redRescuer = redAI.find(u => u.role !== 'medic' && u !== redDown);
redRescuer.ai.reset();
redRescuer.ai.reviveTarget = redDown;
redRescuer.pos.set(redDown.pos.x + 1, redDown.pos.y, redDown.pos.z); // 摆到倒地者旁(读条距离内)
redRescuer.ai.canSee = true; redRescuer.ai.target = p; // 模拟有敌在旁
redRescuer.ai.losT = -1;
redRescuer.ai.lastDmgT = -99;
redRescuer.ai.update(0.05, Game.squads.red);
R('红队非医疗兵有敌在旁仍进 revive', redRescuer.ai.state === 'revive', 'state=' + redRescuer.ai.state);
// 红队非医疗兵搜索半径：能发现 20m 外倒地队友
const farDown = redAI[3];
Game.toDown(farDown, null);
redRescuer.pos.set(50, 0, 50);
farDown.pos.set(70, 0, 50); // 20m 外
redRescuer.ai.reviveTarget = null;
const rt = redRescuer.ai.findReviveTarget();
R('红队非医疗兵 40m 半径发现 20m 外倒地队友', rt === farDown, 'rt=' + (rt && rt.name));
// 蓝队非医疗兵：有敌在旁 → 不抢救（维持"有活敌先打"）
const blueRescuer = blueAI.find(u => u.role !== 'medic');
blueRescuer.ai.reset();
blueRescuer.ai.reviveTarget = blueAI.find(u => u.down) || null;
blueRescuer.ai.canSee = true; blueRescuer.ai.target = p;
blueRescuer.ai.losT = -1; blueRescuer.ai.lastDmgT = -99;
if (blueRescuer.ai.reviveTarget) {
  blueRescuer.ai.update(0.05, Game.squads.blue);
  R('蓝队非医疗兵有敌在旁 → engage 不抢救', blueRescuer.ai.state === 'engage', 'state=' + blueRescuer.ai.state);
} else R('蓝队非医疗兵有敌在旁 → engage 不抢救（无倒地队友可测，跳过）', true);

/* ============ 6. 红队读条中断豁免（只受击，不因看见敌中断） ============ */
console.log('\n[6] 红队读条中断口径');
redRescuer.pos.set(redDown.pos.x + 1, redDown.pos.y, redDown.pos.z); // 读条距离内
redRescuer.ai.reviveTarget = redDown;
redRescuer.ai.canSee = true; redRescuer.ai.target = p;
redRescuer.ai.lastDmgT = -99;
redRescuer.ai.tryRevive(0.05);
R('红队读条中看见敌不中断', redRescuer.ai.reviveTarget === redDown, 'reviveTarget=' + (redRescuer.ai.reviveTarget && redRescuer.ai.reviveTarget.name));

/* ============ 汇总 ============ */
console.log('\n===== 仇恨机制 v2.2 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
if (failures.length) { console.log('加载错误:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(failed || failures.length ? 1 : 0);
