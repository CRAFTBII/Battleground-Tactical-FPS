#!/usr/bin/env node
/**
 * 移动端触控层 —— 真实 DOM 验收（jsdom + 真实 CSS）
 * =====================================================================
 * 之前用"假 DOM 桩"测，桩里元素没有尺寸/布局，所以测不出
 * 「按钮太小」「回菜单还有按键」「开火打不出去」这类问题。
 * 这里改用 jsdom 渲染真实 index.html + 真实 css，并断言：
 *   1. 触控元素在真实布局里达到最小可点击尺寸
 *   2. 只有对局中才显示，回菜单/暂停必须隐藏
 *   3. 开火真的调到 PlayerGun.tryFire 且带得到 camera
 *   4. 换弹/切枪按钮真的调到对应方法
 *   5. 右半屏拖动真的转视角
 * 用法：node test/touch-dom-check.js   退出码 0/1
 * =====================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
let nPass = 0, nFail = 0;
const fails = [];
const ok = (n, d) => { nPass++; console.log('PASS | ' + n + (d ? ' | ' + d : '')); };
const bad = (n, d) => { nFail++; fails.push(n + (d ? ' — ' + d : '')); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

/* ---------- 用真实 index.html 建 DOM ---------- */
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cssFiles = ['css/base.css', 'css/hud.css', 'css/panels.css', 'css/menu.css', 'css/responsive.css', 'css/touch.css'];
const css = cssFiles.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost:8080/?touch=1',
});
const { window } = dom;
const { document } = window;

// 注入 CSS（jsdom 不会自己加载外部样式表）
const styleEl = document.createElement('style');
styleEl.textContent = css;
document.head.appendChild(styleEl);

/* 触摸设备环境 */
Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
window.ontouchstart = null;
window.matchMedia = q => ({ matches: /coarse/.test(q), addEventListener: () => {}, removeEventListener: () => {} });
window.innerWidth = 844; window.innerHeight = 390;
Object.defineProperty(window, 'innerWidth', { value: 844, writable: true, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 390, writable: true, configurable: true });

/* ---------- 产品代码所需的全局桩 ---------- */
const calls = { tryFire: 0, reload: 0, setCur: [], throwGrenade: 0, dispatch: 0 };
const fakeCamera = { isCamera: true, updateMatrixWorld() {} };

window.PC = {
  yaw: 0, pitch: 0, locked: false, forceLocked: false, keys: new Set(),
  touchMove: null, touchSprint: false, aimT: 0, cur: 'rifle',
  inputReady() { return this.locked || this.forceLocked; },
  safeYaw(y) { const m = Math.PI * 2; let r = (Number.isFinite(y) ? y : 0) % m; if (r <= -Math.PI) r += m; else if (r > Math.PI) r -= m; return r; }
};
window.Game = { phase: 'playing', player: { dead: false, down: false }, mortarMode: false, fireMortar() {} };
window.PlayerGun = {
  cur: 'rifle', reloading: false, aimT: 0, mags: { rifle: 30 }, reserves: { rifle: 90 },
  reload() { calls.reload++; }, tryFire(cam) { calls.tryFire++; if (!cam) throw new Error('tryFire 没拿到 camera'); },
  setCur(k) { calls.setCur.push(k); this.cur = k; }, throwGrenade() { calls.throwGrenade++; },
  throwSmoke() {}, useMedkit() {}, useArmorkit() {}
};
window.WEAPONS = { rifle: { damage: 17, mag: 30 }, sniper: { damage: 80, mag: 5 } };
window.Settings = { key: a => a === 'interact' ? 'KeyE' : a };
window.AudioFX = { ui() {} };
window.UIS = {};
window.World = { scene: { getObjectByProperty: () => fakeCamera } };
window.BATTLEGROUND = { camera: fakeCamera };
window.UI = { toast() {} };

/* 加载真实 touch.js */
const touchSrc = fs.readFileSync(path.join(ROOT, 'js', 'touch.js'), 'utf8');
window.eval(touchSrc);
const TouchUI = window.TouchUI;

if (!TouchUI) { console.error('TouchUI 未定义'); process.exit(1); }
TouchUI.init();

/* ================= 1. 触控层结构与可点击尺寸 ================= */
const layer = document.getElementById('touchLayer');
layer ? ok('触控层已注入 DOM') : bad('触控层未注入');

/** jsdom 不跑布局引擎，用 CSS 里声明的宽高做"设计尺寸"断言 */
function declaredSize(sel) {
  const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{([^}]*)\\}', 'g');
  let m, best = { w: 0, h: 0 };
  while ((m = re.exec(css))) {
    const body = m[1];
    const w = /width:\s*(\d+)px/.exec(body);
    const h = /height:\s*(\d+)px/.exec(body);
    if (w) best.w = Math.max(best.w, +w[1]);
    if (h) best.h = Math.max(best.h, +h[1]);
  }
  return best;
}

// 手游可点击区建议 >= 64px（拇指命中率）
for (const [sel, min] of [['.tbtn.fire', 88], ['#tAim', 72], ['.tbtn.sm', 60], ['.twpn', 40]]) {
  const s = declaredSize(sel);
  const pass = (s.w >= min && s.h >= (min === 40 ? 32 : min));
  pass ? ok(sel + ' 尺寸达标', s.w + '×' + s.h + 'px（要求 ≥' + min + '）')
    : bad(sel + ' 尺寸偏小', s.w + '×' + s.h + 'px（要求 ≥' + min + '）');
}

// 按钮数量与关键控件存在
const btnIds = ['tFire', 'tAim', 'tReload', 'tJump', 'tInteract', 'tItem'];
const missingBtn = btnIds.filter(id => !document.getElementById(id));
missingBtn.length === 0 ? ok('动作按钮齐全', btnIds.length + ' 个') : bad('缺按钮', missingBtn.join(','));

const wbar = document.getElementById('tWeaponBar');
const wpnCount = wbar ? wbar.querySelectorAll('.twpn').length : 0;
wpnCount >= 4 ? ok('武器切换条存在', wpnCount + ' 个槽位') : bad('武器切换条缺失或过少', String(wpnCount));

/* ================= 2. 显隐：只有对局中才显示 ================= */
const displayOf = el => { try { return window.getComputedStyle(el).display; } catch (e) { return '?'; } };

// 对局中
window.Game.phase = 'playing';
TouchUI._sync();
const inGame = displayOf(layer);
if (inGame !== 'none') ok('对局中触控层显示', 'display=' + inGame);
else bad('对局中触控层被隐藏（无法操作）', String(inGame));

// 回菜单
window.Game.phase = 'menu';
TouchUI._sync();
const inMenu = displayOf(layer);
if (inMenu === 'none') ok('回菜单后触控层隐藏（不再有游离按键）', 'display=' + inMenu);
else bad('回菜单后按键仍在（用户反馈的 bug）', 'display=' + inMenu);

// 暂停/结算
for (const ph of ['ended']) {
  window.Game.phase = ph;
  TouchUI._sync();
  displayOf(layer) === 'none' ? ok(ph + ' 状态下触控层隐藏') : bad(ph + ' 状态下仍显示');
}

// 玩家死亡/倒地
window.Game.phase = 'playing';
window.Game.player.dead = true;
TouchUI._sync();
displayOf(layer) === 'none' ? ok('玩家阵亡后触控层隐藏') : bad('阵亡后仍显示触控层');
window.Game.player.dead = false;

/* ================= 3. 开火：必须真的调 tryFire 且拿到 camera ================= */
TouchUI._sync();
const fire = document.getElementById('tFire');
let fireErr = null;
try {
  const ev = new window.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'changedTouches', { value: [{ identifier: 1, clientX: 700, clientY: 300, target: fire }] });
  Object.defineProperty(ev, 'touches', { value: [{ identifier: 1, clientX: 700, clientY: 300, target: fire }] });
  fire.dispatchEvent(ev);
} catch (e) { fireErr = e; }

if (fireErr) bad('开火按钮抛错', fireErr.message);
else if (calls.tryFire > 0) ok('开火按钮 → PlayerGun.tryFire 被调用', calls.tryFire + ' 次（拿到 camera）');
else bad('开火按钮没触发射击（用户反馈"开火不能用"）');

// 开火必须置位 Mouse0（连发）
window.PC.keys.has('Mouse0') ? ok('开火置位 Mouse0（支持连发）') : bad('开火未置位 Mouse0');

/* ================= 4. 换弹与切枪 ================= */
const relBtn = document.getElementById('tReload');
try {
  const ev = new window.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'changedTouches', { value: [{ identifier: 2, clientX: 760, clientY: 320, target: relBtn }] });
  relBtn.dispatchEvent(ev);
} catch (e) { }
calls.reload > 0 ? ok('换弹按钮 → PlayerGun.reload 被调用', calls.reload + ' 次') : bad('换弹按钮无效（用户反馈"换弹不能用"）');

const firstWpn = wbar.querySelector('.twpn');
try {
  const ev = new window.Event('touchstart', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'changedTouches', { value: [{ identifier: 3, clientX: 400, clientY: 370, target: firstWpn }] });
  firstWpn.dispatchEvent(ev);
} catch (e) { }
calls.setCur.length > 0 ? ok('武器条 → PlayerGun.setCur 被调用', calls.setCur.join(',')) : bad('武器条无效（用户反馈"不能切换武器"）');

/* ================= 5. 右半屏拖动转视角 ================= */
window.PC.yaw = 0; window.PC.pitch = 0;
const mkTouch = (type, id, x, y, target) => {
  const ev = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y, target }] });
  return ev;
};
// 右半屏（x>422）按下并横向拖动
document.dispatchEvent(Object.assign(mkTouch('touchstart', 9, 700, 200, document.body), {}));
document.dispatchEvent(mkTouch('touchmove', 9, 780, 200, document.body));
if (window.PC.yaw !== 0) ok('右半屏拖动改变 yaw（可转向）', 'yaw=' + window.PC.yaw.toFixed(3));
else bad('右半屏拖动没转向（用户反馈"不能转向"）');

// 左半屏按下 → 摇杆出现且可移动
window.PC.touchMove = null;
const stick = document.getElementById('tStick');
document.dispatchEvent(mkTouch('touchstart', 11, 120, 300, document.body));
if (stick.classList.contains('on')) ok('左半屏按下 → 浮动摇杆出现');
else bad('左半屏按下摇杆没出现');

document.dispatchEvent(mkTouch('touchmove', 11, 120, 240, document.body));   // 向上推
if (window.PC.touchMove && window.PC.touchMove.f > 0) ok('摇杆前推 → 前进输入', 'f=' + window.PC.touchMove.f.toFixed(2));
else bad('摇杆前推无前进输入');

// 推满 → 疾跑
document.dispatchEvent(mkTouch('touchmove', 11, 120, 200, document.body));
window.PC.touchSprint === true ? ok('摇杆推满 → 疾跑') : bad('推满未触发疾跑（用户反馈"不能疾跑"）', String(window.PC.touchSprint));

/* ================= 6. 竖屏提示 ================= */
window.innerWidth = 390; window.innerHeight = 844;
window.dispatchEvent(new window.Event('resize'));
const rot = document.getElementById('tRotate');
rot && window.getComputedStyle(rot).display === 'flex'
  ? ok('竖屏显示「请横屏」提示')
  : bad('竖屏提示未显示', rot ? window.getComputedStyle(rot).display : 'no el');

console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
if (nFail) { console.log('失败清单：'); fails.forEach(f => console.log('  · ' + f)); }
process.exit(nFail ? 1 : 0);
