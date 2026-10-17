// v2.7+v2.8 独立 QA：任务驱动胜利语义（v2.8 修订：任务绑图 + 吃鸡终局 + 无时间限制 + 多队）
// 运行：node test/_qa_v27_mission.js
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
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
let passed = 0, failed = 0;
const R = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); } };
init();

/* ============ 1. 任务绑定固定地图（选图=选任务，不再随机） ============ */
console.log('\n[1] 任务绑图');
R('MISSIONS 含 3 任务且各绑一图', CFG.MISSIONS.length === 3 && CFG.MISSIONS.every(m => !!m.mapId), CFG.MISSIONS.map(m => m.id + '→' + m.mapId).join(' '));
const maps = ['suburb', 'desert', 'port'];
R('三图各绑唯一任务', maps.every(mid => CFG.MISSIONS.filter(m => m.mapId === mid).length === 1), '');
Game.startSingle(); // suburb → survive
R('suburb 图任务=留到最后', Game.mission.id === 'survive', 'mission=' + Game.mission.id);
R('每队人数=任务 teamSize(10)', Game.units.filter(u => u.team === 'blue').length === Game.mission.teamSize && Game.units.filter(u => u.team === 'red').length === Game.mission.teamSize, 'blue=' + Game.units.filter(u => u.team === 'blue').length);
R('任务表 kills=12 人（战场更密）', CFG.MISSIONS.find(m => m.id === 'kills').teamSize === 12, '');

/* ============ 2. 多队混战：N 队生成（默认 2 队，过渡页可设 3/4） ============ */
console.log('\n[2] 多队生成');
Game.teamCount = 4; Game.startSingle(); // 4 队
R('4 队各 10 人（总 40）', Game.units.length === 40, 'n=' + Game.units.length);
R('玩家在蓝队', Game.player.team === 'blue');
const teamKinds = new Set(Game.units.map(u => u.team));
R('4 队 = blue/red/green/yellow', ['blue', 'red', 'green', 'yellow'].every(t => teamKinds.has(t)), [...teamKinds].join(','));
Game.teamCount = 2; Game.startSingle();

/* ============ 3. 吃鸡终局：只剩 1 队 → 该队胜；剩多队不终局 ============ */
console.log('\n[3] 吃鸡终局（剩 1 队）');
Game.teamCount = 3; Game.startSingle();
Game.phase = 'playing';
// 红队全灭、蓝绿存活 → 不终局
for (const u of Game.units) if (u.team === 'red') { u.life = 'dead'; u.alive = false; u.down = false; }
Game.checkElimination();
R('红队全灭但蓝绿存活 → 不终局', Game.phase === 'playing', 'phase=' + Game.phase);
// 绿队也全灭 → 剩蓝队 → 蓝胜
for (const u of Game.units) if (u.team === 'green') { u.life = 'dead'; u.alive = false; u.down = false; }
Game.checkElimination();
R('仅剩蓝队 → 蓝队胜', Game.phase === 'ended' && document.getElementById('winnerT').textContent.indexOf('蓝队') >= 0, document.getElementById('winnerT').textContent);
Game.teamCount = 2;

/* ============ 4. 无时间限制：time 不递减、不再由时间结算 ============ */
console.log('\n[4] 无时间限制');
Game.startSingle();
Game.phase = 'playing';
const t0 = Game.time;
for (let i = 0; i < 60; i++) Game.update(0.016);
R('60 帧后 time 不变（无时间结算）', Game.time === t0 && Game.phase === 'playing', 'time=' + Game.time + ' phase=' + Game.phase);

/* ============ 5. 据点=3 个地带（z 三等分条带，覆盖全图，非圆） ============ */
console.log('\n[5] 据点地带');
R('据点 3 个（A/B/C 地带）', Game.caps.length === 3, 'n=' + Game.caps.length);
const W = CFG.WORLD, bandH = W / 3;
const bandOk = Game.caps.every((c, i) => c.band && Math.abs(c.z - (i * bandH + bandH / 2)) <= 1);
R('地带位置正确（z 三等分；x=出生点质心=活动区）', bandOk, Game.caps.map(c => c.id + '(' + c.x + ',' + c.z + ')' + (c.band ? '带' : '圆')).join(' '));
R('地带半径=条带半高（覆盖整带）', Game.caps.every(c => Math.abs(c.r - bandH / 2) <= 1), 'r=' + Game.caps[0].r);

/* ============ 6. 控制时长统计（control 任务；3 地带 2 蓝 1 红 → 0.2s/0.1s；容差 0.05s） ============ */
console.log('\n[6] 控制时长');
Game.mission = CFG.MISSIONS.find(m => m.id === 'control');
Game.capTime = { blue: 0, red: 0, green: 0, yellow: 0 };
Game.caps.forEach((c, i) => { c.owner = i < 2 ? 'blue' : 'red'; });
Game.updateCaps(0.1);
R('控制时长累加（蓝≈0.1s×2 红≈0.1s×1）', Math.abs(Game.capTime.blue - 0.2) < 0.05 && Math.abs(Game.capTime.red - 0.1) < 0.05, 'b=' + Game.capTime.blue.toFixed(2) + ' r=' + Game.capTime.red.toFixed(2));
R('结算主指标含控制时长', (Game.missionResultText().indexOf('控制') >= 0), Game.missionResultText());

/* ============ 7. CONTROL AI 行为：每队 objective 指非己方据点、蓝队 defend ============ */
console.log('\n[7] CONTROL AI 行为');
Game.teamCount = 4; Game.startSingle(); // 4 队下测每队集结
Game.mission = CFG.MISSIONS.find(m => m.id === 'control');
Game.applyControlBias();
R('蓝队 squad 自动 defend', Game.squads.blue && Game.squads.blue.order === 'defend', 'order=' + (Game.squads.blue && Game.squads.blue.order));
R('红队 objective 指向据点', Game.squads.red && Game.squads.red.objective, 'obj=' + (Game.squads.red && Game.squads.red.objective ? 'set' : 'null'));
R('绿队 objective 指向据点（多队）', Game.squads.green && Game.squads.green.objective, 'obj=' + (Game.squads.green && Game.squads.green.objective ? 'set' : 'null'));
Game.teamCount = 2;

/* ============ 8. 任务 HUD 与 objective 文案 ============ */
console.log('\n[8] 任务 HUD');
Game.updateObjective();
const objTxt = document.getElementById('objective').textContent;
R('objective 含任务名', objTxt.indexOf(Game.mission.name) >= 0, objTxt);

console.log('\n===== v2.7/2.8 任务驱动: ' + passed + ' PASS / ' + failed + ' FAIL =====');
process.exit(failed ? 1 : 0);
