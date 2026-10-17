// 调试:smoke 手雷穿墙断言的测试墙 AABB
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
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

init();
const wallC = World.colliders.find(c => c.max.y >= 4 && c.max.x - c.min.x > 5);
if (!wallC) console.log('未找到测试墙');
else {
  console.log('测试墙 AABB: x[' + wallC.min.x + ',' + wallC.max.x + '] y[' + wallC.min.y + ',' + wallC.max.y + '] z[' + wallC.min.z + ',' + wallC.max.z + ']');
  let y = 0.5, vy = 0.5;
  for (let i = 0; i < 20; i++) { vy -= 24 * 0.016; y += vy * 0.016; }
  console.log('手雷第20帧 y=' + y.toFixed(2) + ' (墙 min.y=' + wallC.min.y + ') 判定=' + (y > wallC.min.y ? '命中' : '从下方穿过'));
  // 墙数量与外部修改痕迹
  console.log('colliders 总数=' + World.colliders.length + ' 高墙(>=4m)数=' + World.colliders.filter(c => c.max.y >= 4).length);
}
