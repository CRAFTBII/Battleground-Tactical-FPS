// 调试:desert A 地带中心可达性
'use strict';
const fs = require('fs');
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({ style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false }, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null, appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(), querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop, width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const elements = {};
const docListeners = {};
global.document = { getElementById: id => (elements[id] || (elements[id] = fakeEl())), querySelector: () => fakeEl(), querySelectorAll: () => [], createElement: tag => fakeEl(), body: { appendChild: noop }, title: '', addEventListener: (t, fn) => { docListeners[t] = fn; }, dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; } };
global.window = global; global.location = { hostname: 'localhost', search: '' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} }; global.addEventListener = (t, fn) => { if (t === 'error') return; };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const path = require('path'); const ROOT = path.join(__dirname, '..', '..');
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
init();
World.load(scene, MapRegistry.get('desert'));
const capA = World.capturePoints[0];
console.log('desert cap A:', JSON.stringify(capA));
// A 中心周围 4 方向 5m 检查 walkable
for (const [dx, dz] of [[0, -5], [0, 5], [-5, 0], [5, 0], [0, 0]]) {
  const x = capA.x + dx, z = capA.z + dz;
  console.log('  (' + x + ',' + z + ') walkable=' + World.walkable(x, z));
}
// 检查 A 中心是否在 collider 内/被围:列出覆盖 A 中心 ±2 的 collider
const hit = World.colliders.filter(c => capA.x > c.min.x - 2 && capA.x < c.max.x + 2 && capA.z > c.min.z - 2 && capA.z < c.max.z + 2 && c.max.y >= 1);
console.log('A 中心附近 collider:', hit.length);
for (const c of hit.slice(0, 6)) console.log('  x[' + c.min.x + ',' + c.max.x + '] y[' + c.min.y + ',' + c.max.y + '] z[' + c.min.z + ',' + c.max.z + ']');
// 蓝队出生点是否被围:检查 (36,36) 4 方向
console.log('出生点(36,36) 4方向:');
for (const [dx, dz] of [[0, -5], [0, 5], [-5, 0], [5, 0]]) {
  console.log('  (' + (36 + dx) + ',' + (36 + dz) + ') walkable=' + World.walkable(36 + dx, 36 + dz));
}
