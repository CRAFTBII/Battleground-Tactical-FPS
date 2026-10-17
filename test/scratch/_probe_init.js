/* 用 minimal DOM 模拟实际页面加载 init() 流程,捕获 null.textContent 来源 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// 收集所有 id（含 dynamic 模板里要存在的）
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);

// Minimal DOM（支持 getElementById + querySelector(All) + textContent/style/innerHTML/value + addEventListener）
function el(tag, id) {
  const n = { tag, id, children: [], attrs: {}, style: {}, classes: [], dataset: {},
    appendChild(c) { this.children.push(c); c.parent = this; return c; },
    addEventListener() {}, removeEventListener() {},
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; },
    get textContent() { return this._text || ''; },
    set className(v) { this._class = v; },
    get className() { return this._class || ''; },
    set value(v) { this._v = v; }, get value() { return this._v || ''; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    get firstChild() { return this.children[0] || null; },
    get parentNode() { return this.parent || null; },
    getBoundingClientRect() { return { left:0, top:0, width:0, height:0 }; },
    requestPointerLock() {},
  };
  return n;
}
const byId = {};
ids.forEach(id => { byId[id] = el('div', id); });
const document = {
  getElementById: id => byId[id] || null,
  querySelector() { return null; }, querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
  createElement(t) { return el(t); },
  createElementNS(_, t) { return el(t); },
  body: el('body'),
  exitPointerLock: () => {},
  pointerLockElement: null,
};
const window = { addEventListener() {}, removeEventListener() {}, AudioContext: function(){} };
const localStorage = (() => { const s = {}; return { getItem: k => s[k] || null, setItem: (k,v) => s[k]=String(v), removeItem: k => delete s[k] }; })();
const performance = { now: () => Date.now() };
const location = { hostname: 'localhost', search: '' };
const requestAnimationFrame = () => {}; // 不启动 loop

const sandbox = { document, window, localStorage, performance, location, requestAnimationFrame, setTimeout, clearTimeout, console };
sandbox.self = sandbox; sandbox.global = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// 加载 scripts（跳过 maps/registry 与具体地图，因为它们是数据；先 world 因为它需要 registry 等）
// 简化：按 html 顺序全部加载，但 stub 不存在的全局
for (const src of scripts) {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: src });
    process.stdout.write('.');
  } catch (e) {
    console.log('\n✗ 抛错于 ' + src);
    console.log('  ' + e.message);
    if (e.stack) console.log(e.stack.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
}
console.log('\n[脚本层加载完毕]');

// 尝试触发 init 流程（模拟 main.js 底部 IIFE）
try {
  vm.runInContext(`
    (function () {
      if (typeof THREE === 'undefined') {
        console.log('[skip] THREE 未定义（stub 环境）');
        return;
      }
      try { init(); } catch (e) {
        console.log('init() 抛错: ' + (e && e.message));
        if (e && e.stack) console.log(e.stack.split('\\n').slice(0, 6).join('\\n'));
      }
    })();
  `, sandbox, { filename: 'init-driver.js' });
} catch (e) {
  console.log('\n✗ init 抛错');
  console.log('  ' + e.message);
  if (e.stack) console.log(e.stack.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

// 模拟 wireMenu + refreshAcc
try {
  vm.runInContext(`wireMenu();`, sandbox, { filename: 'wire-driver.js' });
} catch (e) {
  console.log('\n✗ wireMenu 抛错');
  console.log('  ' + e.message);
  if (e.stack) console.log(e.stack.split('\n').slice(0, 8).join('\n'));
  process.exit(1);
}

console.log('[init + wireMenu 完成]');