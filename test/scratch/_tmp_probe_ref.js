'use strict';
const fs = require('fs'), path = require('path');
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({
  style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false },
  dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null,
  appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(),
  querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop,
  width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
global.document = { getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [], createElement: () => fakeEl(), body: { appendChild: noop }, title: '', addEventListener: noop };
global.window = global; global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0; global.Image = class { set src(v) {} };
global.addEventListener = () => {};
const lsStore = {};
global.localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); }, removeItem: k => { delete lsStore[k]; } };
const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const vm = require('vm');
for (const f of scripts.slice(1)) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
init();
World.load(World.scene, MapRegistry.get('port'));
console.log('--- port 场景 refinery footprint 邻近 collider ---');
for (const c of World.colliders) {
  if (c.min.x <= 158 && c.max.x >= 136 && c.min.z <= 171 && c.max.z >= 155 && c.max.y >= 1) {
    console.log('  x[' + c.min.x.toFixed(1) + ',' + c.max.x.toFixed(1) + '] z[' + c.min.z.toFixed(1) + ',' + c.max.z.toFixed(1) + '] y[' + c.min.y.toFixed(1) + ',' + c.max.y.toFixed(1) + ']');
  }
}
const b = BuildingLib.build('refinery', 137, 156, 0, { w: 20, d: 14, h: 12 });
console.log('--- BuildingLib refinery colliders ---');
for (const c of b.colliders) console.log('  x[' + c.min.x.toFixed(1) + ',' + c.max.x.toFixed(1) + '] z[' + c.min.z.toFixed(1) + ',' + c.max.z.toFixed(1) + '] y[' + c.min.y.toFixed(1) + ',' + c.max.y.toFixed(1) + ']');
