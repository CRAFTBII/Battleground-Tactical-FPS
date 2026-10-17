#!/usr/bin/env node
/**
 * 移动端触控适配验收
 * =====================================================================
 * 用 vm 在受控上下文里跑真实产品代码，验证：
 *   设备判定 / 摇杆移动 / 右半屏转视角 / 不依赖 Pointer Lock / 竖屏提示 / 桌面不激活
 *
 * 用法：node test/touch-check.js    退出码 0 全过 / 1 有失败
 * =====================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let nPass = 0, nFail = 0;
const fails = [];
const ok = (n, d) => { nPass++; console.log('PASS | ' + n + (d ? ' | ' + d : '')); };
const bad = (n, d) => { nFail++; fails.push(n + (d ? ' — ' + d : '')); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

/* ---------------- 造一个够用的浏览器桩 ---------------- */
function makeCtx2d() {
  const noop = () => {};
  const grad = () => ({ addColorStop: noop });
  return {
    createRadialGradient: grad, createLinearGradient: grad,
    fillRect: noop, clearRect: noop, drawImage: noop, beginPath: noop, arc: noop, ellipse: noop,
    fill: noop, stroke: noop, moveTo: noop, lineTo: noop, closePath: noop, save: noop, restore: noop,
    translate: noop, rotate: noop, scale: noop, fillText: noop, strokeText: noop,
    measureText: () => ({ width: 10 }), getImageData: () => ({ data: [0, 0, 0, 0] }),
    putImageData: noop, createImageData: () => ({ data: [] }), setTransform: noop,
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: ''
  };
}

/**
 * @param {object} opt { touch:boolean, landscape:boolean, forceQuery:string }
 */
function buildEnv(opt) {
  const o = Object.assign({ touch: false, landscape: true, forceQuery: '' }, opt);
  const listeners = {};                    // 记录事件绑定，测试里手动触发
  const addL = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  const mkEl = (tag) => {
    const el = {
      tagName: (tag || 'div').toUpperCase(),
      style: {}, dataset: {}, children: [], _cls: new Set(),
      innerHTML: '', textContent: '', className: '',
      getContext: () => makeCtx2d(),
      appendChild(c) { el.children.push(c); c.parentNode = el; return c; },
      removeChild(c) { el.children = el.children.filter(x => x !== c); return c; },
      addEventListener: (t, fn) => addL('el:' + (el.id || el.tagName) + ':' + t, fn),
      removeEventListener: () => {},
      setAttribute: () => {}, getAttribute: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      getBoundingClientRect: () => ({ left: 10, top: 400, width: 132, height: 132, right: 142, bottom: 532 }),
      closest: (sel) => {
        // 简化实现：按 id/class 粗匹配，够 touch.js 用
        const ids = (sel.match(/#([\w-]+)/g) || []).map(s => s.slice(1));
        let n = el;
        while (n) { if (n.id && ids.includes(n.id)) return n; n = n.parentNode; }
        return null;
      },
      classList: {
        add: c => el._cls.add(c), remove: c => el._cls.delete(c),
        toggle: (c, v) => { if (v === undefined) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); } else v ? el._cls.add(c) : el._cls.delete(c); },
        contains: c => el._cls.has(c)
      }
    };
    return el;
  };

  const byId = {};
  const body = mkEl('body');
  const doc = {
    body,
    documentElement: mkEl('html'),
    getElementById: id => (byId[id] = byId[id] || (() => { const e = mkEl('div'); e.id = id; return e; })()),
    createElement: mkEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: addL,
    removeEventListener: () => {},
    exitPointerLock: () => { doc.pointerLockElement = null; },
    pointerLockElement: null
  };

  const win = {
    innerWidth: o.landscape ? 844 : 390,
    innerHeight: o.landscape ? 390 : 844,
    devicePixelRatio: 3,
    addEventListener: addL,
    removeEventListener: () => {},
    document: doc,
    location: { protocol: 'http:', hostname: 'localhost', search: o.forceQuery, href: 'http://localhost:8080/' },
    navigator: { userAgent: o.touch ? 'iPhone' : 'node', maxTouchPoints: o.touch ? 5 : 0 },
    matchMedia: q => ({ matches: /coarse/.test(q) ? !!o.touch : !o.touch, addEventListener: () => {} }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    performance: { now: () => Date.now() },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console: { log: () => {}, warn: () => {}, error: () => {} },
    JSON, Math, Date, Number, Array, Object, String, Boolean, RegExp, Error, isNaN, isFinite,
    TextDecoder, ArrayBuffer, Uint16Array, Uint32Array, Float32Array, Int8Array, Uint8Array, Int16Array,
    _listeners: listeners
  };
  if (o.touch) win.ontouchstart = null;      // 关键：触屏判定
  win.window = win;
  win.globalThis = win;
  win.self = win;

  // canvas #c 需要给 renderer 用
  const canvas = mkEl('canvas'); canvas.id = 'c';
  byId['c'] = canvas;

  return { win, doc, listeners, body, byId, mkEl };
}

function loadInto(ctx, files) {
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(src, ctx, { filename: f });
  }
}

/**
 * 最小 PC / 游戏桩。touch.js 只依赖这些成员：
 * yaw / pitch / safeYaw / keys / forceLocked / touchMove / touchSprint / inputReady
 * （真实 PC 与 Game 在 combat.js / game.js 里，这里没必要把整个游戏加载进来）
 */
const PC_STUB = [
  'var PC = {',
  '  yaw: 0, pitch: 0, recoil: 0, locked: false, forceLocked: false, keys: new Set(),',
  '  touchMove: null, touchSprint: false,',
  '  inputReady() { return this.locked || this.forceLocked; },',
  '  safeYaw(y) {',
  '    const m = Math.PI * 2;',
  '    let r = (Number.isFinite(y) ? y : 0) % m;',
  '    if (r <= -Math.PI) r += m; else if (r > Math.PI) r -= m;',
  '    return r;',
  '  }',
  '};',
  'var Game = { phase: "menu" };',
  'var PlayerGun = { cur: "rifle", reload(){}, tryFire(){}, throwGrenade(){}, throwSmoke(){}, useMedkit(){}, useArmorkit(){} };',
  'var Settings = { key: a => a };',
  'var U = { clamp: (v, a, b) => Math.max(a, Math.min(b, v)) };',
  'var AudioFX = { ui(){} };',
  'var UI = { toast(){} };'
].join('\n');

function installPCStub(ctx) {
  vm.runInContext(PC_STUB, ctx, { filename: '(pc-stub)' });
}

/* ================= 1. 静态检查 ================= */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (/css\/touch\.css/.test(html)) ok('index.html 引入 css/touch.css');
else bad('index.html 未引入 css/touch.css');

if (/js\/touch\.js/.test(html)) ok('index.html 引入 js/touch.js');
else bad('index.html 未引入 js/touch.js');

const iTouch = html.indexOf('js/touch.js');
const iMain = html.indexOf('js/main.js');
if (iTouch >= 0 && iMain >= 0 && iTouch < iMain) ok('touch.js 在 main.js 之前加载', 'touch#' + iTouch + ' < main#' + iMain);
else bad('touch.js 加载顺序错误', 'touch=' + iTouch + ' main=' + iMain);

const css = fs.readFileSync(path.join(ROOT, 'css', 'touch.css'), 'utf8');
if (/#touchLayer\s*\{\s*display:\s*none/.test(css)) ok('触控层默认 display:none（不遮挡桌面）');
else bad('触控层默认未隐藏');

if (/body\.touch-ui #touchLayer/.test(css)) ok('仅在 body.touch-ui 下显示触控层');
else bad('缺少 body.touch-ui 作用域');

/* ================= 2. 桌面环境：不应激活 ================= */
{
  const env = buildEnv({ touch: false });
  const ctx = vm.createContext(env.win);
  installPCStub(ctx);
  loadInto(ctx, ['js/touch.js']);
  const T = vm.runInContext('TouchUI', ctx);
  if (T && typeof T.init === 'function') ok('TouchUI 已定义（有 init）');
  else bad('TouchUI 未定义或缺 init');

  const enabledDesktop = T.enabled();
  if (enabledDesktop === false) ok('桌面环境 enabled() = false');
  else bad('桌面环境误判为触控', String(enabledDesktop));

  T.init();
  if (T.active === false) ok('桌面 init() 后不激活');
  else bad('桌面 init() 误激活');
  if (env.body.classList.contains('touch-ui') === false) ok('桌面 body 不带 touch-ui class');
  else bad('桌面 body 误加 touch-ui');
  if (vm.runInContext('PC', ctx).forceLocked === false) ok('桌面不置位 PC.forceLocked（仍走 Pointer Lock）');
  else bad('桌面误置位 PC.forceLocked');
}

/* ================= 3. 触控环境：激活 + 行为 ================= */
{
  const env = buildEnv({ touch: true, landscape: true });
  const ctx = vm.createContext(env.win);
  installPCStub(ctx);
  loadInto(ctx, ['js/touch.js']);
  const T = vm.runInContext('TouchUI', ctx);
  const PC = vm.runInContext('PC', ctx);

  if (T.enabled() === true) ok('触控环境 enabled() = true（maxTouchPoints>0 且 ontouchstart）');
  else bad('触控环境未被识别');

  T.init();
  if (T.active === true) ok('触控 init() 后激活');
  else bad('触控 init() 未激活');
  if (env.body.classList.contains('touch-ui')) ok('触控 body 带 touch-ui class');
  else bad('触控 body 缺 touch-ui class');

  /* --- 关键：不依赖 Pointer Lock --- */
  if (PC.forceLocked === true) ok('触控置位 PC.forceLocked（不依赖 Pointer Lock）');
  else bad('触控未置位 forceLocked');
  env.doc.pointerLockElement = null;              // 模拟移动端：永远拿不到指针锁
  if (PC.inputReady() === true) ok('pointerLockElement 为 null 时 inputReady() 仍为 true', '触控可操作');
  else bad('触控下 inputReady() 为 false（无法移动/开火）');

  /* --- 左摇杆：前推 → touchMove.f > 0 --- */
  const stick = env.byId['tStick'];
  const fire = (el, type, touch) => {
    const ls = env.listeners['el:' + (el.id || el.tagName) + ':' + type] || [];
    const ev = { changedTouches: [touch], preventDefault: () => {}, target: touch.target || el };
    ls.forEach(fn => fn(ev));
    return ls.length;
  };
  // 摇杆中心 (76,466)，向前推 40px（屏幕 y 向上 = 前进）
  fire(stick, 'touchstart', { identifier: 1, clientX: 76, clientY: 466, target: stick });
  const l = env.listeners['el:tStick:touchmove'] || [];
  l.forEach(fn => fn({ changedTouches: [{ identifier: 1, clientX: 76, clientY: 426, target: stick }], preventDefault: () => {} }));

  if (PC.touchMove && PC.touchMove.f > 0) ok('左摇杆前推 → PC.touchMove.f > 0', 'f=' + PC.touchMove.f.toFixed(2));
  else bad('左摇杆未产生前向移动', JSON.stringify(PC.touchMove));

  if (PC.touchMove && Math.abs(PC.touchMove.s) < 0.2) ok('前推时横向分量接近 0', 's=' + PC.touchMove.s.toFixed(2));
  else bad('前推时横向分量异常');

  // 推满 → 疾跑
  l.forEach(fn => fn({ changedTouches: [{ identifier: 1, clientX: 76, clientY: 400, target: stick }], preventDefault: () => {} }));
  if (PC.touchSprint === true) ok('摇杆推满 → 触控疾跑置位');
  else bad('摇杆推满未触发疾跑', String(PC.touchSprint));

  // 松手 → 归零
  fire(stick, 'touchend', { identifier: 1, clientX: 76, clientY: 400, target: stick });
  if (PC.touchMove === null) ok('松手后 PC.touchMove 归零');
  else bad('松手后仍残留移动输入', JSON.stringify(PC.touchMove));

  /* --- 右半屏：拖动改变 yaw / pitch --- */
  const beforeYaw = PC.yaw, beforePitch = PC.pitch;
  // 在触控层根节点上拖动（ouch.js 绑定在 #touchLayer 上）
  const layer = env.byId['touchLayer'];
  const startLs = env.listeners['el:touchLayer:touchstart'] || [];
  const moveLs = env.listeners['el:touchLayer:touchmove'] || [];
  const freeTouch = { identifier: 7, clientX: 600, clientY: 200, target: layer };
  startLs.forEach(fn => fn({ changedTouches: [freeTouch], preventDefault: () => {} }));
  moveLs.forEach(fn => fn({ changedTouches: [{ identifier: 7, clientX: 660, clientY: 230, target: layer }], preventDefault: () => {} }));

  if (PC.yaw !== beforeYaw) ok('右半屏横向拖动改变 PC.yaw', beforeYaw.toFixed(3) + ' → ' + PC.yaw.toFixed(3));
  else bad('右半屏拖动未改变 yaw');
  if (PC.pitch !== beforePitch) ok('右半屏纵向拖动改变 PC.pitch', beforePitch.toFixed(3) + ' → ' + PC.pitch.toFixed(3));
  else bad('右半屏拖动未改变 pitch');

  // pitch 必须被夹紧，不能翻转
  const clampStart = PC.pitch;
  for (let i = 0; i < 50; i++) moveLs.forEach(fn => fn({ changedTouches: [{ identifier: 7, clientX: 660, clientY: 900 + i * 20, target: layer }], preventDefault: () => {} }));
  if (Math.abs(PC.pitch) <= 1.46) ok('pitch 被夹紧在 ±1.45（不会翻转）', 'pitch=' + PC.pitch.toFixed(2));
  else bad('pitch 越界未夹紧', String(PC.pitch));

  /* --- 横竖屏 --- */
  if (env.byId['tRotate'].style.display === 'none') ok('横屏时不显示「请横屏」提示');
  else bad('横屏误显示竖屏提示', env.byId['tRotate'].style.display);
}

/* ================= 4. 竖屏提示 ================= */
{
  const env = buildEnv({ touch: true, landscape: false });
  const ctx = vm.createContext(env.win);
  installPCStub(ctx);
  loadInto(ctx, ['js/touch.js']);
  const T = vm.runInContext('TouchUI', ctx);
  T.init();
  const rot = env.byId['tRotate'];
  if (rot && rot.style.display === 'flex') ok('竖屏时显示「请横屏游玩」遮罩');
  else bad('竖屏未显示提示', rot && rot.style.display);
  if (env.body.classList.contains('touch-portrait')) ok('竖屏时 body 带 touch-portrait class');
  else bad('竖屏缺 touch-portrait class');
}

/* ================= 5. ?touch=1 强制开启 ================= */
{
  const env = buildEnv({ touch: false, forceQuery: '?touch=1' });
  const ctx = vm.createContext(env.win);
  installPCStub(ctx);
  loadInto(ctx, ['js/touch.js']);
  const T = vm.runInContext('TouchUI', ctx);
  if (T.enabled() === true) ok('?touch=1 可在桌面强制开启触控层（便于调试）');
  else bad('?touch=1 未生效');
}

console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
if (nFail) { console.log('失败清单：'); fails.forEach(f => console.log('  · ' + f)); }
process.exit(nFail ? 1 : 0);
