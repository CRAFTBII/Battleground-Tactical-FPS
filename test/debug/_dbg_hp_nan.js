// 调试:玩家 hp NaN 压力测试——覆盖所有伤害/治疗路径
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
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

init(); Game.startSingle();
const p = Game.player;

let nanCount = 0;
const chk = (label) => { if (Number.isNaN(p.hp)) { nanCount++; console.log('!! NaN 出现: ' + label + '  hp=' + p.hp + '  armor=' + p.armor); } };

// 1. 各种武器伤害(玩家被打)
console.log('[1] 武器伤害');
for (const w of ['rifle', 'pistol', 'sniper', 'shotgun']) {
  p.hp = 100; p.armor = 100; p.alive = true; p.life = 'alive'; p.down = false;
  const W = WEAPONS[w];
  for (let i = 0; i < 3; i++) {
    const dmg = W.dmg * (Math.random() < 0.3 ? W.head : 1);
    Game.applyDamage(p, dmg, null, false);
    chk(w + ' dmg=' + dmg);
  }
}

// 2. armor 特殊值
console.log('[2] armor 特殊值');
p.hp = 100; p.alive = true;
p.armor = undefined; Game.applyDamage(p, 17, null, false); chk('armor=undefined');
p.hp = 100;
p.armor = NaN; Game.applyDamage(p, 17, null, false); chk('armor=NaN');
p.hp = 100;
p.armor = '100'; Game.applyDamage(p, 17, null, false); chk('armor=string');

// 3. dmg 特殊值(调用方传错)
console.log('[3] dmg 特殊值');
p.hp = 100; p.armor = 100; p.alive = true;
Game.applyDamage(p, undefined, null, false); chk('dmg=undefined');
p.hp = 100;
Game.applyDamage(p, NaN, null, false); chk('dmg=NaN');

// 4. 爆炸伤害
console.log('[4] 爆炸');
p.hp = 100; p.armor = 100;
Game.areaDamage(p.pos, 5, 100, null, 'red'); chk('手雷爆炸');
p.hp = 100;
Game.areaDamage(p.pos, 6, 65, null, 'red'); chk('迫击炮');
p.hp = 100;
Game.areaDamage(p.pos, 0, 100, null, 'red'); chk('radius=0(边缘)');

// 5. 环境伤害
console.log('[5] 环境');
p.hp = 100; p.armor = 100;
Game.applyDamage(p, 4 * 0.5, null, false); chk('沙暴 exposeDmg');
Game.applyDamage(p, 3 * 0.5, null, false); chk('缩圈 dmgPerSec');

// 6. 治疗
console.log('[6] 治疗');
p.hp = 50; p.alive = true;
PlayerGun.useMedkit(); chk('医疗包回血');
p.hp = 50;
if (typeof Mechanics !== 'undefined' && Mechanics._heal) Mechanics._heal(p, 5); chk('水塔回血');
p.hp = 50;
p.hp = Math.min(CFG.PLAYER_HP, p.hp + 50); chk('AI 式回血');

// 7. 倒地+处决+救援
console.log('[7] 倒地/处决/救援');
p.hp = 0; p.armor = 50;
Game.toDown(p, null);
Game.applyDamage(p, 999, null, false); // 处决
chk('倒地被处决');
p.hp = 0; p.alive = false; p.life = 'down'; p.down = true; p.armor = 50;
Game.completeRevive(blueAI()[0], p);
chk('被救起');

// 8. 连续伤害+护甲磨穿(模拟实战)
console.log('[8] 实战模拟(1000 轮)');
let nanInLoop = 0;
for (let i = 0; i < 1000; i++) {
  p.hp = 100; p.armor = Math.random() * 100; p.alive = true; p.life = 'alive'; p.down = false;
  const W = WEAPONS[['rifle', 'pistol', 'sniper', 'shotgun'][i % 4]];
  const dmg = W.dmg * (Math.random() < 0.3 ? W.head : 1);
  Game.applyDamage(p, dmg, null, false);
  if (Number.isNaN(p.hp)) { nanInLoop++; chk('实战轮 ' + i); }
  // 治疗
  if (p.alive && !Number.isNaN(p.hp) && p.hp < 80) p.hp = Math.min(100, p.hp + 50);
}
console.log('实战 1000 轮 NaN 次数: ' + nanInLoop);

function blueAI() { return Game.units.filter(u => u.ai && u.team === 'blue'); }
console.log('\n===== 总 NaN 出现: ' + nanCount + ' =====');
