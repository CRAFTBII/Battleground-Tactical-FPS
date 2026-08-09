'use strict';
const fs = require('fs'), path = require('path');
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({ style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false }, dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null, appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(), querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop, width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop }, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const elements = {};
global.document = { getElementById: id => (elements[id] || (elements[id] = fakeEl())), querySelector: () => fakeEl(), querySelectorAll: () => [], createElement: tag => fakeEl(), body: { appendChild: noop }, title: '', addEventListener: () => {}, dispatchEvent: () => true };
global.window = global; global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} }; global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const ROOT = path.join(__dirname, '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const vm = require('vm');
for (const f of scripts.slice(1)) { try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); } catch (e) { console.log('LOAD FAIL ' + f + ': ' + e.message); process.exit(1); } }
try { init(); } catch (e) { console.log('init FAIL: ' + e.message); process.exit(1); }
Game.startSingle();
function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); Game.buildCoverPts(); }
const R = (t, ok, d) => console.log((ok ? 'PASS' : 'FAIL') + ' | ' + t + (d ? ' | ' + d : ''));
// 探针5：极小圈（半径 8m）下 smartSpawn 仍不出圈
loadMap('suburb');
const z = Mechanics.zone;
if (!z || !z.active) { console.log('SKIP | 探针5 zone 未激活'); process.exit(0); }
z.curR = 8; z.targetR = 8; // 直接压到极小圈（阶段推进由 tick 驱动，此处手动模拟末期）
let allIn = true, anyNull = false;
for (let i = 0; i < 200; i++) {
  const p = Game.smartSpawn('red', {});
  if (!p) { anyNull = true; break; }
  if (Mechanics.zone.isOutside(p.x, p.z)) { allIn = false; }
}
R('P5 极小圈 200 次 smartSpawn 绝不返回 null', !anyNull, 'null=' + anyNull);
R('P5 极小圈 200 次全部圈内', allIn, 'outOfZone=' + (allIn ? 0 : '有出圈'));
console.log('===== 探针5 结束 =====');
