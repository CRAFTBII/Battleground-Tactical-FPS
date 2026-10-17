// 调试:smoke 迫击炮 mortarTarget 2.7m 之谜
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
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
init();
Game.startSingle();
PC.locked = true;
PC.keys.add('KeyW');
for (let i = 0; i < 40; i++) {
  const dt = 0.016;
  if (i >= 2 && i <= 12) PC.keys.add('Space'); else PC.keys.delete('Space');
  PC.update(dt);
  if (i === 30) {
    console.log('第30帧前: PC.yaw=' + PC.yaw.toFixed(3) + ' player.yaw=' + Game.player.yaw.toFixed(3));
    Game.toggleMortar();
    console.log('toggleMortar后: mortarYaw=' + Game.mortarYaw.toFixed(3) + ' mortarAngle=' + Game.mortarAngle);
  }
  Game.update(dt);
  if (i >= 31 && Game.mortarTarget) {
    const R = Math.sqrt(U.dist2(Game.player.pos.x, Game.player.pos.z, Game.mortarTarget.x, Game.mortarTarget.z));
    console.log('帧' + i + ': mortarYaw=' + Game.mortarYaw.toFixed(3) + ' player.pos=(' + Game.player.pos.x.toFixed(1) + ',' + Game.player.pos.z.toFixed(1) + ') target=(' + Game.mortarTarget.x.toFixed(1) + ',' + Game.mortarTarget.z.toFixed(1) + ') R=' + R.toFixed(1));
  }
}
