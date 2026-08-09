'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = 'C:/Users/Administrator/WorkBuddy/battlegame';
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = { style: {} }; this.shadowMap = {}; } setPixelRatio(){} setSize(){} render(){} };
global.window = global;
global.document = {
  getElementById: () => new Proxy({ style: {} }, { get: (t, k) => (k === 'style' ? t.style : () => {}), set: () => true }),
  querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}),
  addEventListener: () => {}, dispatchEvent: () => true, body: { appendChild: () => {} }
};
global.addEventListener = () => {}; global.requestAnimationFrame = () => 0; global.Image = class {};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
for (const f of ['js/core.js', 'js/audio.js', 'js/textures.js', 'js/world.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'js/models.js', 'js/net.js']) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { console.log('LOAD FAIL', f, e.message.slice(0, 100)); process.exit(1); }
}
// 手动模拟 World/Game 最小状态
World.scene = new THREE.Scene();
Game.startSingle();
Game.phase = 'playing'; Game.player.dead = false; Game.player.alive = true;
const camera = new THREE.PerspectiveCamera(70, 1.6, 0.1, 500);
for (const k of ['medkit', 'armorkit', 'grenade', 'smoke']) {
  PlayerGun.setCur(k);
  for (let i = 0; i < 10; i++) PlayerGun.update(0.016, { has: () => false }, camera);
  console.log('切到', k, 'update OK');
}
PlayerGun.setCur('rifle');
console.log('消耗品槽切换全部无错误 OK');
