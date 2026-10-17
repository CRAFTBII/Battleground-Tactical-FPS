#!/usr/bin/env node
/**
 * 触控环境下 开火 / 瞄准 / 换弹 的真实行为验收
 * =====================================================================
 * 直接加载真实 js/combat.js（连同它依赖的 core.js），而不是抽取函数或写桩复刻。
 * 关键：combat.js 会自己声明 WEAPONS/Projectiles 等，所以桩只补它**真正缺**的外部符号，
 *       且必须在同一 vm 上下文里、按依赖顺序加载，避免重复声明。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let nPass = 0, nFail = 0;
const fails = [];
const ok = (n, d) => { nPass++; console.log('PASS | ' + n + (d ? ' | ' + d : '')); };
const bad = (n, d) => { nFail++; fails.push(n + (d ? ' | ' + d : '')); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

/* ---------- 浏览器环境 ---------- */
function ctx2d() {
  const noop = () => {};
  const g = () => ({ addColorStop: noop });
  return { createRadialGradient: g, createLinearGradient: g, fillRect: noop, clearRect: noop,
    drawImage: noop, beginPath: noop, arc: noop, ellipse: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, closePath: noop, save: noop, restore: noop, translate: noop,
    rotate: noop, scale: noop, fillText: noop, measureText: () => ({ width: 8 }),
    getImageData: () => ({ data: [] }), putImageData: noop, createImageData: () => ({ data: [] }),
    setTransform: noop, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '' };
}
const mkEl = () => ({
  style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild(c) { return c; }, removeChild(c) { return c; }, addEventListener() {},
  getContext: ctx2d, querySelector: () => null, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }),
  innerHTML: '', textContent: '', dataset: {}, children: []
});

const win = {};
win.window = win; win.globalThis = win; win.self = win;
win.document = {
  getElementById: mkEl, createElement: mkEl, querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, body: mkEl(), documentElement: mkEl(),
  exitPointerLock() {}, pointerLockElement: null
};
win.navigator = { userAgent: 'node', maxTouchPoints: 5 };
win.location = { protocol: 'http:', hostname: 'localhost', search: '?touch=1', href: 'http://localhost:8080/' };
win.addEventListener = () => {}; win.removeEventListener = () => {};
win.requestAnimationFrame = () => 0;
win.setTimeout = setTimeout; win.clearTimeout = clearTimeout;
win.setInterval = () => 0; win.clearInterval = () => {};
win.performance = { now: () => Date.now() };
win.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
win.console = { log() {}, warn() {}, error() {} };
win.matchMedia = () => ({ matches: true, addEventListener() {} });
win.Image = class {}; win.Audio = class { play() {} pause() {} };
win.ontouchstart = null;
win.devicePixelRatio = 3;
win.innerWidth = 844; win.innerHeight = 390;
// 把宿主的标准内建透传进沙箱（vm 上下文默认没有）
for (const k of ['Object','Array','Number','String','Boolean','RegExp','Error','TypeError','JSON','Math','Date',
  'isNaN','isFinite','parseInt','parseFloat','Map','Set','Promise','Symbol','ArrayBuffer','DataView',
  'Float32Array','Float64Array','Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
  'TextDecoder','TextEncoder']) {
  win[k] = globalThis[k];
}
vm.createContext(win);

/* ---------- 依赖顺序加载（与 index.html 一致，只取 combat.js 需要的） ---------- */
const scripts = ['libs/three.min.js', 'js/core.js', 'js/combat.js', 'js/game.js'];
for (const f of scripts) {
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), win, { filename: f }); }
  catch (e) { console.error('加载失败 ' + f + ': ' + e.message); process.exit(1); }
}


/* 外围模块桩：只补 combat/game 会调用、但与本次验证无关的 UI/音频/特效 */
vm.runInContext([
  'var UI = { scope:function(){}, aim:function(){}, slots:function(){}, reload:function(){}, toast:function(){},',
  '  armorBar:function(){}, hpBar:function(){}, score:function(){}, killfeed:function(){}, banner:function(){},',
  '  minimap:function(){}, fps:function(){}, spectate:function(){}, objective:function(){}, capBar:function(){} };',
  'var AudioFX = { init:function(){}, resume:function(){}, ui:function(){}, reload:function(){}, shot:function(){},',
  '  melee:function(){}, hit:function(){}, explode:function(){}, setListener:function(){}, setVol:function(){} };',
  'var WeaponAnim = { attach:function(){}, update:function(){}, fire:function(){}, startReload:function(){}, finishReload:function(){} };',
  'var Items = { update:function(){}, init:function(){} };',
  'if (typeof Ticker === "undefined") { globalThis.Ticker = { init:function(){}, radio:function(){}, kill:function(){} }; }',
  'var Settings = { key:function(a){ return a === "interact" ? "KeyE" : a; }, actionByCode:function(){ return null; } };',
  'var Accounts = {};',
  'var Engine = { tick:function(){} };'
].join('\n'), win, { filename: '(stubs)' });

const PC = vm.runInContext('PC', win);
const PlayerGun = vm.runInContext('PlayerGun', win);
const Game = vm.runInContext('Game', win);
const WEAPONS = vm.runInContext('WEAPONS', win);
const THREE = vm.runInContext('THREE', win);

// combat.js 里 camera/renderer 由 main.js 定义，这里补上
const camera = new THREE.PerspectiveCamera(70, 2.1, 0.1, 500);
camera.position.set(0, 1.7, 0);
vm.runInContext('var camera2 = null;', win);
win.camera = camera;

/* FX 需要 scene（真实运行时由 main.js 提供） */
try {
  const FXobj = vm.runInContext('FX', win);
  const scene = new THREE.Scene();
  const camTmp = new THREE.PerspectiveCamera(70, 2, 0.1, 500);
  // 走真实 FX.init，把 tracer/muzzle/bulletHole 等资源一次性建好，
  // 避免逐个补字段（否则 tryFire 会一路踩到未初始化的子对象）
  if (typeof FXobj.init === 'function') FXobj.init(scene, camTmp);
  FXobj.scene = scene;
  FXobj.parts = FXobj.parts || [];
} catch (e) { console.log('  (FX.init 不可用: ' + e.message + ')'); }

/* Game 处于对局中、玩家存活 */
Game.phase = 'playing';
Game.mortarMode = false;
Game.player = {
  pos: new THREE.Vector3(0, 0, 0), dead: false, down: false, spawnProtT: 0,
  hp: 100, alive: true, isPlayer: true, team: 'blue', yaw: 0, vel: new THREE.Vector3()
};
Game.units = [Game.player];

/* 初始化武器弹匣（不走 init()，避免构建 3D 模型） */
PlayerGun.mags = {}; PlayerGun.reserves = {};
for (const k in WEAPONS) { PlayerGun.mags[k] = WEAPONS[k].mag; PlayerGun.reserves[k] = WEAPONS[k].reserve; }
PlayerGun.cur = 'rifle';
PlayerGun.reloading = false;
PlayerGun.lastShot = 0;

/* ================= 1. 触控（无 Pointer Lock）开火 ================= */
PC.locked = false; PC.forceLocked = true;
const b1 = PlayerGun.mags.rifle;
try { PlayerGun.tryFire(camera); } catch (e) { console.log('  (tryFire 内部异常被吞: ' + e.message + ')'); }
PlayerGun.mags.rifle === b1 - 1
  ? ok('触控开火真的消耗子弹', b1 + ' → ' + PlayerGun.mags.rifle)
  : bad('触控开火被守卫挡掉（弹匣不变）', '弹匣=' + PlayerGun.mags.rifle);

/* 反向：都不锁 → 不能开火 */
PC.locked = false; PC.forceLocked = false;
const b2 = PlayerGun.mags.rifle;
PlayerGun.lastShot = 0;
PlayerGun.tryFire(camera);
PlayerGun.mags.rifle === b2 ? ok('未锁定时 tryFire 正确拦截（桌面安全）') : bad('未锁定也能开火');

/* ================= 2. 瞄准 ================= */
PC.locked = false; PC.forceLocked = true;
PlayerGun.cur = 'rifle'; PlayerGun.aimT = 0; PlayerGun.reloading = false;
const keysAim = new Set(['Mouse2']);
for (let i = 0; i < 20; i++) PlayerGun.update(0.016, keysAim, camera);
PlayerGun.aimT > 0.5 ? ok('触控按住瞄准 → aimT 上升', 'aimT=' + PlayerGun.aimT.toFixed(2))
  : bad('瞄准无效果', 'aimT=' + PlayerGun.aimT.toFixed(2));

for (let i = 0; i < 40; i++) PlayerGun.update(0.016, new Set(), camera);
PlayerGun.aimT < 0.1 ? ok('松开 → 收镜', 'aimT=' + PlayerGun.aimT.toFixed(2))
  : bad('收镜无效果', 'aimT=' + PlayerGun.aimT.toFixed(2));

/* 自动连发 */
PlayerGun.mags.rifle = 30; PlayerGun.lastShot = 0;
const keysFire = new Set(['Mouse0']);
let realNow = 0;
for (let i = 0; i < 20; i++) {
  realNow += 60;
  PlayerGun.lastShot = Math.max(0, PlayerGun.lastShot);
  PlayerGun.update(0.06, keysFire, camera);
  if (i === 3) break;
}
PlayerGun.mags.rifle < 30 ? ok('触控按住开火 → 连发消耗', '30 → ' + PlayerGun.mags.rifle)
  : bad('自动开火无效', '弹匣=' + PlayerGun.mags.rifle);

/* ================= 3. 换弹 ================= */
PlayerGun.cur = 'rifle'; PlayerGun.reloading = false;
PlayerGun.mags.rifle = 5; PlayerGun.reserves.rifle = 90;
PlayerGun.reload();
PlayerGun.reloading ? ok('reload() 进入换弹状态') : bad('reload() 未生效');
PlayerGun.aimT === 0 ? ok('换弹强制收镜') : bad('换弹未收镜');

PlayerGun.reloadEnd = 0;
PlayerGun.update(0.016, new Set(), camera);
(PlayerGun.reloading === false && PlayerGun.mags.rifle > 5)
  ? ok('换弹完成 → 弹匣补满', '5 → ' + PlayerGun.mags.rifle + '，备弹剩 ' + PlayerGun.reserves.rifle)
  : bad('换弹未完成', 'reloading=' + PlayerGun.reloading + ' mag=' + PlayerGun.mags.rifle);

PlayerGun.mags.rifle = 30; PlayerGun.reloading = false;
PlayerGun.reload();
PlayerGun.reloading === false ? ok('满弹匣 reload() 正确忽略') : bad('满弹匣仍进入换弹');

/* ================= 4. 守卫源码回归 ================= */
const src = fs.readFileSync(path.join(ROOT, 'js', 'combat.js'), 'utf8');
const tfIdx = src.indexOf('tryFire(cam) {');
const tf = src.slice(tfIdx, tfIdx + 400);
if (/!PC\.inputReady\(\)/.test(tf)) ok('tryFire 守卫用 PC.inputReady()（移动端可用）');
else bad('tryFire 守卫未用 inputReady');
// 只看代码行，排除注释（我上一版在注释里提到过 !PC.locked 会被误判）
const tfCode = tf.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
if (/!PC\.locked\b/.test(tfCode)) bad('tryFire 里仍有裸 !PC.locked（会把触控开火挡掉）');
else ok('tryFire 代码里没有裸 !PC.locked（只剩注释提及）');

const mgSrc = fs.readFileSync(path.join(ROOT, 'js', 'mg.js'), 'utf8');
/inputReady\(\)/.test(mgSrc) ? ok('mg.js 迫击炮守卫同样用 inputReady()') : bad('mg.js 仍用 PC.locked');

/* ================= 5. 移动端性能约束 ================= */
const touchCss = fs.readFileSync(path.join(ROOT, 'css', 'touch.css'), 'utf8');
/backdrop-filter/.test(touchCss) ? bad('touch.css 仍有 backdrop-filter，移动端会卡') : ok('touch.css 无 backdrop-filter');
/@keyframes|animation:/.test(touchCss) ? bad('touch.css 仍有动画，移动端持续重绘') : ok('touch.css 无动画/关键帧');

const touchJs = fs.readFileSync(path.join(ROOT, 'js', 'touch.js'), 'utf8');
const m = /setInterval\(\(\) => this\._sync\(\), (\d+)\)/.exec(touchJs);
(m && +m[1] >= 500) ? ok('状态同步间隔 ≥500ms', m[1] + 'ms') : bad('状态同步过频');
/_dirty/.test(touchJs) ? ok('DOM 写入有变化检测') : bad('DOM 全量写入');

console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
if (nFail) { console.log('失败清单：'); fails.forEach(f => console.log('  · ' + f)); }
process.exit(nFail ? 1 : 0);
