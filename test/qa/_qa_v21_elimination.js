// v2.1 独立 QA：吃鸡淘汰制（全员一条命 + 倒地救援保留 + 玩家死后观战 + 全灭收局）
// 运行：node test/_qa_v21_elimination.js
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
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
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

/* ============ 1. 常量（v2.1 调参） ============ */
console.log('\n[1] 常量');
R('BLEED_OUT=20（拉长救援窗口）', CFG.BLEED_OUT === 20, 'BLEED_OUT=' + CFG.BLEED_OUT);
R('MEDIC_REVIVE_RANGE=80', CFG.MEDIC_REVIVE_RANGE === 80, '=' + CFG.MEDIC_REVIVE_RANGE);
R('DEFAULT_REVIVE_RANGE=12', CFG.DEFAULT_REVIVE_RANGE === 12, '=' + CFG.DEFAULT_REVIVE_RANGE);
R('观战常量存在', CFG.SPECTATE_DIST > 0 && CFG.SPECTATE_HEIGHT > 0);

/* ============ 2. 开局 ============ */
console.log('\n[2] 开局（单机吃鸡制）');
// v2.7 任务驱动：本测试的"全灭=幸存方胜"断言即 survive 任务语义——循环开局直到抽到 survive
// （仅 force mission 字段不够：队伍人数已按随机任务生成，KILLS 会产出 12 人导致人数断言 flaky）
for (let i = 0; i < 20; i++) { Game.startSingle(); if (Game.mission && Game.mission.id === 'survive') break; }
const p = Game.player;
R('玩家存活', !!p && p.alive && !p.down);
const blueAI = Game.units.filter(u => u.ai && u.team === 'blue');
const redAI = Game.units.filter(u => u.ai && u.team === 'red');
R('蓝队 9 AI + 玩家', blueAI.length === 9, 'blue=' + blueAI.length);
R('红队 10 AI', redAI.length === 10, 'red=' + redAI.length);
R('开局不设重生计时（吃鸡制）', blueAI.concat(redAI).every(u => !u.respawnT));

/* ============ 3. AI 死亡 → 不重生 ============ */
console.log('\n[3] AI 死亡不重生');
const victim = redAI[0];
const beforeAlive = Game.units.filter(u => u.alive).length;
Game.toDead(victim, null, 'bleed');
R('AI 进入最终死亡', victim.life === 'dead' && !victim.alive);
R('AI 不设 respawnT', !victim.respawnT, 'respawnT=' + victim.respawnT);
Game.update(0.1); Game.update(1.0); Game.update(8.0); // 快进 9s（旧机制此时应重生）
R('快进后仍死亡（无 AI 重生循环）', victim.life === 'dead');
R('全队存活数减少', Game.units.filter(u => u.alive).length === beforeAlive - 1);

/* ============ 4. 倒地 → 流血 20s → 救援保留 ============ */
console.log('\n[4] 倒地救援（唯一保命途径）');
const downed = blueAI[0];
Game.toDown(downed, null);
R('蓝队 AI 倒地', downed.down && downed.life === 'down' && !downed.alive);
R('流血 20s 倒计时', downed.bleedT === 20, 'bleedT=' + downed.bleedT);
// 模拟救援：读条 3s 完成
Game.startRevive(blueAI[1], downed);
for (let i = 0; i < 100; i++) { downed.reviveT += 0.05; if (downed.reviveT >= CFG.REVIVE_TIME) break; }
Game.completeRevive(blueAI[1], downed);
R('被救起恢复（残血 35）', downed.life === 'alive' && downed.alive && downed.hp === CFG.REVIVE_HP);

/* ============ 5. 玩家死亡 → 观战 ============ */
console.log('\n[5] 玩家死亡直接观战');
const camStart = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
Game.toDead(p, redAI[1], 'executed');
R('玩家最终死亡', p.life === 'dead' && Game.dead && Game.player.dead);
R('启动观战', !!Game.spectator && typeof Game.spectator.target !== 'undefined', 'spectator=' + (Game.spectator ? 'on' : 'off'));
R('观战目标=存活蓝队 AI', !!Game.spectator.target && Game.spectator.target.ai && Game.spectator.target.team === 'blue' && Game.spectator.target.alive, Game.spectator.target && Game.spectator.target.name);
R('观战目标不是玩家', Game.spectator.target !== p);
// 观战相机跟随目标移动
const tgt = Game.spectator.target;
const before = { x: camera.position.x, z: camera.position.z };
tgt.pos.x += 5; tgt.pos.z += 5;
Game.updateSpectate(0.1); Game.updateSpectate(0.1);
R('观战相机跟随目标', Math.abs(camera.position.x - before.x) > 0.01 || Math.abs(camera.position.z - before.z) > 0.01);
// 切换目标
const t1 = Game.spectator.target;
Game.spectateNext(1);
R('E 切换观战目标', Game.spectator.target && Game.spectator.target !== t1);
Game.spectateNext(-1);
R('Q 切回', Game.spectator.target === t1);
// 目标死亡 → 自动切下一个
const aliveNow = Game.spectateCandidates().length;
if (aliveNow > 1) { Game.spectator.target.alive = false; Game.spectator.target.life = 'dead'; Game.updateSpectate(0.1); R('目标死亡自动切换', Game.spectator.target && Game.spectator.target.alive); }
else R('目标死亡自动切换（仅剩 1 人，跳过）', true);

/* ============ 6. 全灭收局 ============ */
console.log('\n[6] 全灭判定（提前收局）');
// 先恢复玩家为存活（模拟继续对局）
// 红队全灭 → 蓝队胜
Game.phase = 'playing';
for (const u of Game.units.filter(u => u.team === 'red')) { u.life = 'dead'; u.alive = false; u.down = false; }
Game.checkElimination();
R('红队全灭 → 蓝队胜', Game.phase === 'ended' && document.getElementById('winnerT').textContent.indexOf('蓝队') >= 0, document.getElementById('winnerT').textContent);

// 蓝队全灭 → 红队胜（含玩家已死）
Game.phase = 'playing';
for (const u of Game.units) { if (u.team === 'red') { u.life = 'alive'; u.alive = true; } if (u.team === 'blue') { u.life = 'dead'; u.alive = false; u.down = false; } }
Game.checkElimination();
R('蓝队全灭（含玩家）→ 红队胜', Game.phase === 'ended' && document.getElementById('winnerT').textContent.indexOf('红队') >= 0, document.getElementById('winnerT').textContent);

// 倒地不算全灭：蓝队剩 1 人倒地 → 不提前收局
Game.phase = 'playing';
for (const u of Game.units) { if (u.team === 'blue') { if (u === Game.units.find(x => x.team === 'blue')) { u.life = 'down'; u.alive = false; u.down = true; } else { u.life = 'dead'; u.alive = false; u.down = false; } } }
Game.checkElimination();
R('全队仅剩倒地者不算全灭（可被救）', Game.phase === 'playing', 'phase=' + Game.phase);

/* ============ 7. 倒地流血致死 → 观战闭环 ============ */
console.log('\n[7] 流血致死闭环');
Game.phase = 'playing';
Game.dead = false;
Game.player.life = 'alive'; Game.player.alive = true; Game.player.dead = false; Game.player.down = false;
Game.spectator = null;
Game.toDown(Game.player, null);
R('玩家倒地（等待救援）', Game.player.down && !Game.dead);
Game.player.bleedT = 0.01;
Game.tickDown(0.02);
R('流血归零 → 最终死亡 → 观战', Game.player.life === 'dead' && Game.dead && !!Game.spectator);

/* ============ 汇总 ============ */
console.log('\n===== 吃鸡制 v2.1 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
if (failures.length) { console.log('加载错误:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(failed || failures.length ? 1 : 0);
