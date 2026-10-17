// 压力测试 v2:定位 rotation 异常来源
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
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

init();
Game.startSingle();
Game.phase = 'playing';
PC.locked = true;
let bad = 0, printed = 0;
for (let i = 0; i < 20000; i++) {
  PC.keys.clear();
  if (i % 4 === 0) PC.keys.add('KeyW');
  PC.update(0.016);
  if (i % 3 === 0) {
    const e = { movementX: (Math.random() - 0.5) * 40, movementY: (Math.random() - 0.5) * 40 };
    if (i > 15000 && i < 15100) PC.sens = NaN;
    if (i === 15100) PC.sens = 0.22;
    PC.yaw -= e.movementX * PC.sens * 0.002;
    PC.pitch = U.clamp(PC.pitch - e.movementY * PC.sens * 0.002, -1.45, 1.45);
  }
  Game.update(0.016);
  if (!Number.isFinite(camera.rotation.x) || !Number.isFinite(camera.rotation.y)) {
    bad++;
    if (printed < 4) {
      printed++;
      console.log('帧' + i + ': rot.x=' + camera.rotation.x + ' rot.y=' + camera.rotation.y +
        ' | pitch=' + PC.pitch + ' yaw=' + PC.yaw + ' sens=' + PC.sens +
        ' | camPos=(' + camera.position.x.toFixed(2) + ',' + camera.position.y.toFixed(2) + ',' + camera.position.z.toFixed(2) + ')' +
        ' | playerPos=(' + Game.player.pos.x + ',' + Game.player.pos.y + ',' + Game.player.pos.z + ')');
    }
  }
}
console.log('==== 异常 ' + bad + ' 次 ====');
