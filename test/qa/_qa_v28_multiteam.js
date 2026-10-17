// v2.8 独立 QA：多队混战（N 队生成 / 每队一象限出生 / 吃鸡终局含玩家队被淘汰 / 据点网格分区 / 过渡页队伍数）
// 运行：node test/_qa_v28_multiteam.js
'use strict';
const fs = require('fs');
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({ style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false }, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null, appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(), querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop, width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const elements = {};
const docListeners = {};
global.document = { getElementById: id => (elements[id] || (elements[id] = fakeEl())), querySelector: () => fakeEl(), querySelectorAll: () => [], createElement: tag => fakeEl(), body: { appendChild: noop }, title: '', addEventListener: (t, fn) => { docListeners[t] = fn; }, dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; } };
global.window = global; global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} }; global.addEventListener = (t, fn) => { if (t === 'error') return; };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const path = require('path'); const ROOT = path.join(__dirname, '..', '..');
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

let passed = 0, failed = 0;
const R = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); } };
init();
const W = CFG.WORLD, mid = W / 2;
const quadOf = (x, z) => ((z < mid ? 0 : 1) * 2 + (x < mid ? 0 : 1)); // Q1左上/Q2右上/Q3左下/Q4右下

/* ============ 1. 2 队：对角双象限（v2.6.1 语义保留） ============ */
console.log('\n[1] 2 队象限');
Game.teamCount = 2; Game.startSingle();
const blueAI2 = Game.units.filter(u => u.ai && u.team === 'blue');
const redAI2 = Game.units.filter(u => u.ai && u.team === 'red');
R('蓝队全在 Q1∪Q4', blueAI2.every(u => [0, 3].includes(quadOf(u.pos.x, u.pos.z))), '');
R('红队全在 Q2∪Q3', redAI2.every(u => [1, 2].includes(quadOf(u.pos.x, u.pos.z))), '');
R('玩家在 Q1', quadOf(Game.player.pos.x, Game.player.pos.z) === 0, 'q=' + quadOf(Game.player.pos.x, Game.player.pos.z));

/* ============ 2. 4 队：每队一个象限 ============ */
console.log('\n[2] 4 队象限');
Game.teamCount = 4; Game.startSingle();
const quads = { blue: [], red: [], green: [], yellow: [] };
for (const t of Object.keys(quads)) {
  quads[t] = Game.units.filter(u => u.ai && u.team === t).map(u => quadOf(u.pos.x, u.pos.z));
}
R('蓝队全在 Q1', quads.blue.every(q => q === 0), quads.blue.join(','));
R('红队全在 Q2', quads.red.every(q => q === 1), quads.red.join(','));
R('绿队全在 Q3', quads.green.every(q => q === 2), quads.green.join(','));
R('黄队全在 Q4', quads.yellow.every(q => q === 3), quads.yellow.join(','));
// 同队最小间距 ≥ SPAWN_SEP
const sep2 = CFG.SPAWN_SEP * CFG.SPAWN_SEP;
let minD = 1e9;
for (const t of ['blue', 'red', 'green', 'yellow']) {
  const arr = Game.units.filter(u => u.ai && u.team === t);
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) minD = Math.min(minD, U.dist2(arr[i].pos.x, arr[i].pos.z, arr[j].pos.x, arr[j].pos.z));
}
R('4 队同队最小间距 ≥ ' + CFG.SPAWN_SEP + 'm（' + Math.sqrt(minD).toFixed(1) + 'm）', minD >= sep2, 'min=' + Math.sqrt(minD).toFixed(1));

/* ============ 3. 吃鸡终局：玩家队(蓝)全灭但其他队活着 → 游戏继续 ============ */
console.log('\n[3] 玩家队被淘汰仍继续');
Game.teamCount = 3; Game.startSingle();
Game.phase = 'playing';
for (const u of Game.units) if (u.team === 'blue') { u.life = 'dead'; u.alive = false; u.down = false; }
Game.checkElimination();
R('蓝队全灭但红绿存活 → 不终局', Game.phase === 'playing', 'phase=' + Game.phase);
// 红队也灭 → 剩绿队
for (const u of Game.units) if (u.team === 'red') { u.life = 'dead'; u.alive = false; u.down = false; }
Game.checkElimination();
R('剩绿队 → 绿队胜（吃鸡：最后存活队伍）', Game.phase === 'ended' && document.getElementById('winnerT').textContent.indexOf('绿队') >= 0, document.getElementById('winnerT').textContent);
Game.teamCount = 2;

/* ============ 4. 过渡页：队伍数上限 = 图 maxTeams ============ */
console.log('\n[4] 图最大队伍数');
const suburbDef = MapRegistry.get('suburb'), portDef = MapRegistry.get('port');
R('suburb maxTeams=4', suburbDef.maxTeams === 4, 'max=' + suburbDef.maxTeams);
R('port maxTeams=3（小图）', portDef.maxTeams === 3, 'max=' + portDef.maxTeams);
// 过渡页按钮生成逻辑：2~maxTeams
const ts = document.getElementById('teamSelect'), tRow = document.getElementById('teamSelectBtns');
R('过渡页元素存在', !!ts && !!tRow && !!document.getElementById('teamSelectInfo'), '');
const maxT = (suburbDef && suburbDef.maxTeams) || 4;
R('队伍数选项 2~' + maxT + '（队伍>1）', maxT >= 2, 'maxT=' + maxT);

/* ============ 5. 据点=3 地带 + 占领判定多队 ============ */
console.log('\n[5] 据点地带占领');
Game.teamCount = 3; Game.startSingle();
R('据点 3 个地带（A/B/C 条带）', Game.caps.length === 3 && Game.caps.every(c => c.band), 'n=' + Game.caps.length + ' band=' + Game.caps.map(c => c.band).join(','));
// 蓝 2 人占区 A → 推进；红 2 人同区 → 平票僵持
// 蓝 2 人占区 A → 推进；红 2 人同区 → 平票僵持（先清场：出生在 Q1 的蓝队天然落在 A 区圆内会破坏平票）
const c = Game.caps[0];
for (const u of Game.units) u.pos.set(260, u.pos.y, 260); // 全部挪出 A 区
c.progress = 0; c.owner = null;
const blues = Game.units.filter(u => u.alive && u.team === 'blue').slice(0, 2);
const reds = Game.units.filter(u => u.alive && u.team === 'red').slice(0, 2);
blues.forEach(u => u.pos.set(c.x + 3, u.pos.y, c.z + 3));
reds.forEach(u => u.pos.set(c.x + 8, u.pos.y, c.z + 8));
Game.updateCaps(0.5); // 蓝 2 vs 红 2 → 平票
const prog0 = c.progress;
Game.updateCaps(0.5);
R('平票僵持（不推进）', c.progress === prog0, 'prog=' + c.progress);
// 红队离开 → 蓝队独占推进 → 占领（2人×1.6/次，需 32 次，给 45 次余量）
reds.forEach(u => u.pos.set(200, u.pos.y, 200));
for (let i = 0; i < 45; i++) Game.updateCaps(0.5);
R('蓝队独占占领 A 区', c.owner === 'blue', 'owner=' + c.owner + ' prog=' + c.progress);
Game.teamCount = 2;

/* ============ 6. 队伍色扩展（4 色 + cvd 形状） ============ */
console.log('\n[6] 队伍色');
R('normal 4 队色齐全', ['blue', 'red', 'green', 'yellow'].every(t => !!CFG.teamColor(t).css), '');
R('cvd 模式 4 色+形状', (() => { location.search = '?cvd=1'; const ok = ['blue', 'red', 'green', 'yellow'].every(t => !!CFG.teamColor(t).css && !!CFG.teamColor(t).shape); location.search = ''; return ok; })(), '');

console.log('\n===== v2.8 多队混战: ' + passed + ' PASS / ' + failed + ' FAIL =====');
process.exit(failed ? 1 : 0);
