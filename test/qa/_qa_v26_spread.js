// v2.6.1 独立 QA：象限分散出生（蓝 Q1+Q4 / 红 Q2+Q3 · 四角全有人 · 同队防叠 · 对角不贴脸）
// 运行：node test/_qa_v26_spread.js
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
Game.startSingle();
const p = Game.player;
const W = CFG.WORLD, mid = W / 2;
// 象限编号与 scatteredSpawn 一致：Q1左上 / Q2右上 / Q3左下 / Q4右下
const quadOf = (x, z) => ((z < mid ? 0 : 1) * 2 + (x < mid ? 0 : 1));

/* ============ 1. 蓝队出生全在 Q1∪Q4（左上+右下） ============ */
console.log('\n[1] 蓝队象限分布');
const blueAI = Game.units.filter(u => u.ai && u.team === 'blue');
let badB = blueAI.filter(u => ![0, 3].includes(quadOf(u.pos.x, u.pos.z)));
R('蓝队 AI 全在 Q1∪Q4', badB.length === 0, badB.length ? '越界: ' + badB.map(u => u.name + '(' + Math.round(u.pos.x) + ',' + Math.round(u.pos.z) + ')q' + quadOf(u.pos.x, u.pos.z)).join(';') : '');
R('玩家在 Q1（左上）', quadOf(p.pos.x, p.pos.z) === 0, '玩家在 q' + quadOf(p.pos.x, p.pos.z) + ' @(' + Math.round(p.pos.x) + ',' + Math.round(p.pos.z) + ')');
const bQ1 = blueAI.filter(u => quadOf(u.pos.x, u.pos.z) === 0).length;
const bQ4 = blueAI.filter(u => quadOf(u.pos.x, u.pos.z) === 3).length;
R('蓝队两象限都有人（Q1=' + bQ1 + ' Q4=' + bQ4 + '）', bQ1 >= 2 && bQ4 >= 2, 'Q1=' + bQ1 + ' Q4=' + bQ4);

/* ============ 2. 红队出生全在 Q2∪Q3（右上+左下） ============ */
console.log('\n[2] 红队象限分布');
const redAI = Game.units.filter(u => u.ai && u.team === 'red');
const badR = redAI.filter(u => ![1, 2].includes(quadOf(u.pos.x, u.pos.z)));
R('红队 AI 全在 Q2∪Q3', badR.length === 0, badR.length ? '越界: ' + badR.map(u => u.name + '(' + Math.round(u.pos.x) + ',' + Math.round(u.pos.z) + ')q' + quadOf(u.pos.x, u.pos.z)).join(';') : '');
const rQ2 = redAI.filter(u => quadOf(u.pos.x, u.pos.z) === 1).length;
const rQ3 = redAI.filter(u => quadOf(u.pos.x, u.pos.z) === 2).length;
R('红队两象限都有人（Q2=' + rQ2 + ' Q3=' + rQ3 + '）', rQ2 >= 2 && rQ3 >= 2, 'Q2=' + rQ2 + ' Q3=' + rQ3);

/* ============ 3. 全图四角都有人（无出生真空区） ============ */
console.log('\n[3] 四角覆盖');
const all = [p, ...blueAI, ...redAI];
for (const q of [0, 1, 2, 3]) {
  const n = all.filter(u => quadOf(u.pos.x, u.pos.z) === q).length;
  R('Q' + (q + 1) + ' 有人（' + n + '）', n >= 1, 'q' + q + ' n=' + n);
}

/* ============ 4. 同队最小间距 ≥ SPAWN_SEP（防叠点） ============ */
console.log('\n[4] 同队间距');
const sep2 = CFG.SPAWN_SEP * CFG.SPAWN_SEP;
let minB = 1e9, minR = 1e9;
for (let i = 0; i < blueAI.length; i++) for (let j = i + 1; j < blueAI.length; j++) minB = Math.min(minB, U.dist2(blueAI[i].pos.x, blueAI[i].pos.z, blueAI[j].pos.x, blueAI[j].pos.z));
for (let i = 0; i < redAI.length; i++) for (let j = i + 1; j < redAI.length; j++) minR = Math.min(minR, U.dist2(redAI[i].pos.x, redAI[i].pos.z, redAI[j].pos.x, redAI[j].pos.z));
R('蓝队最小间距 ≥ ' + CFG.SPAWN_SEP + 'm（' + Math.sqrt(minB).toFixed(1) + 'm）', minB >= sep2, 'min=' + Math.sqrt(minB).toFixed(1));
R('红队最小间距 ≥ ' + CFG.SPAWN_SEP + 'm（' + Math.sqrt(minR).toFixed(1) + 'm）', minR >= sep2, 'min=' + Math.sqrt(minR).toFixed(1));
let minP2B = 1e9;
for (const u of blueAI) minP2B = Math.min(minP2B, U.dist2(p.pos.x, p.pos.z, u.pos.x, u.pos.z));
R('玩家与最近蓝 AI ≥ ' + CFG.SPAWN_SEP + 'm（' + Math.sqrt(minP2B).toFixed(1) + 'm）', minP2B >= sep2, 'min=' + Math.sqrt(minP2B).toFixed(1));

/* ============ 5. 红蓝对角对峙（开局不贴脸：最近 ≥ SPAWN_SEP；平均距离远 = 对角分离） ============ */
console.log('\n[5] 红蓝开局距离');
let minRB = 1e9, sumRB = 0, cntRB = 0;
for (const b of blueAI) for (const r of redAI) {
  const d2 = U.dist2(b.pos.x, b.pos.z, r.pos.x, r.pos.z);
  minRB = Math.min(minRB, d2); sumRB += Math.sqrt(d2); cntRB++;
}
const minRBm = Math.sqrt(minRB), avgRB = sumRB / cntRB;
// 硬：不叠点不贴脸（相邻象限锚点距 mid，两圆半径 2×SPAWN_SPREAD → 理论下界 mid−2R）；软：平均距离反映对角分离
R('红蓝最近距离 ' + minRBm.toFixed(0) + 'm（≥ SPAWN_SEP 不贴脸）', minRBm >= CFG.SPAWN_SEP, 'min=' + minRBm.toFixed(0));
R('红蓝平均距离 ' + avgRB.toFixed(0) + 'm（对角分离，> ' + Math.round(mid * 0.5) + 'm）', avgRB > mid * 0.5, 'avg=' + avgRB.toFixed(0));

/* ============ 6. 三图 mapScale 回归：象限锚点在任何缩放下都成立 ============ */
console.log('\n[6] mapScale 回归');
const scaleBackup = CFG.mapScale;
for (const [name, scale] of [['suburb', 1.0], ['port', 0.867], ['desert', 1.133]]) {
  CFG.mapScale = scale;
  const s0 = Game.scatteredSpawn('blue', 0, []), s1 = Game.scatteredSpawn('blue', 1, []);
  const r0 = Game.scatteredSpawn('red', 0, []), r1 = Game.scatteredSpawn('red', 1, []);
  const inW = q => q.x >= 2 && q.z >= 2 && q.x <= W - 2 && q.z <= W - 2;
  const ok = quadOf(s0.x, s0.z) === 0 && quadOf(s1.x, s1.z) === 3 && quadOf(r0.x, r0.z) === 1 && quadOf(r1.x, r1.z) === 2 && inW(s0) && inW(s1) && inW(r0) && inW(r1);
  R(name + '(scale=' + scale + '): 蓝Q1/Q4 红Q2/Q3 且不出界', ok, 'b0=q' + quadOf(s0.x, s0.z) + ' b1=q' + quadOf(s1.x, s1.z) + ' r0=q' + quadOf(r0.x, r0.z) + ' r1=q' + quadOf(r1.x, r1.z));
}
CFG.mapScale = scaleBackup;

console.log('\n===== v2.6.1 象限出生: ' + passed + ' PASS / ' + failed + ' FAIL =====');
process.exit(failed ? 1 : 0);
