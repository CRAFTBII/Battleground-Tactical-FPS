// 压力测试:视角倒置(相机 NaN 污染)验证
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
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
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
let bad = 0, badPos = 0, total = 0;
const cam = new THREE.PerspectiveCamera();
// 模拟 20000 帧:随机移动 + 鼠标注入(其中 100 帧注入 NaN sens 模拟设置污染)
for (let i = 0; i < 20000; i++) {
  PC.keys.clear();
  if (i % 4 === 0) PC.keys.add('KeyW');
  if (i % 7 === 0) PC.keys.add('Space');
  if (i % 5 === 0) PC.keys.add('Mouse0');
  PC.update(0.016);
  // 模拟 mousemove
  if (i % 3 === 0) {
    const e = { movementX: (Math.random() - 0.5) * 40, movementY: (Math.random() - 0.5) * 40 };
    if (i > 15000 && i < 15100) PC.sens = NaN; // 注入 sens NaN(设置清空场景)
    if (i === 15100) PC.sens = 0.22; // 恢复
    PC.yaw -= e.movementX * PC.sens * 0.002;
    PC.pitch = U.clamp(PC.pitch - e.movementY * PC.sens * 0.002, -1.45, 1.45);
  }
  Game.update(0.016);
  total++;
  if (!Number.isFinite(camera.rotation.x) || !Number.isFinite(camera.rotation.y)) { bad++; if (bad < 5) console.log('帧' + i + ' rotation 异常: x=' + camera.rotation.x + ' y=' + camera.rotation.y + ' pitch=' + PC.pitch + ' yaw=' + PC.yaw + ' sens=' + PC.sens); }
  if (!Number.isFinite(camera.position.y)) { badPos++; if (badPos < 5) console.log('帧' + i + ' camera.y 异常: ' + camera.position.y + ' player.y=' + Game.player.pos.y); }
  if (i % 100 === 0) { camera.position.set(50, 0, 50); camera.rotation.set(0, 0, 0); }
}
console.log('==== ' + total + ' 帧: rotation 异常 ' + bad + ' 次, position 异常 ' + badPos + ' 次 ====');
process.exit(bad || badPos ? 1 : 0);
