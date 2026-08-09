// 调试:玩家完整生命周期 hp NaN 测试(含 AI 射击/手雷/环境/治疗/倒地/救援/死亡)
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
const path = require('path'); const ROOT = path.join(__dirname, '..');
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
init(); Game.startSingle();
const p = Game.player;
let nanCount = 0;
const chk = (label) => { if (Number.isNaN(p.hp)) { nanCount++; console.log('!! NaN: ' + label + ' hp=' + p.hp + ' armor=' + p.armor + ' alive=' + p.alive + ' down=' + p.down + ' life=' + p.life); } };

// 1. AI 射击玩家(tryShoot 全武器)
console.log('[1] AI 射玩家');
const reds = Game.units.filter(u => u.ai && u.team === 'red');
for (const ai of reds) {
  p.hp = 100; p.armor = 100; p.alive = true; p.life = 'alive'; p.down = false;
  p.pos.set(ai.pos.x + 5, 0, ai.pos.z + 5);
  const tgt = new Unit('red', { x: p.pos.x + 20, y: 0, z: p.pos.z });
  Game.units.push(tgt); tgt.alive = true; tgt.hp = 100; tgt.team = 'blue';
  ai.ai.target = tgt; ai.ai.canSee = true; ai.ai.state = 'engage';
  ai.ai.fireT = 0; ai.ai.burst = 3; ai.ai.burstT = 0; ai.ai.dodgeT = 0;
  ai.ai.mag = 30; ai.ai.reloading = 0;
  const orig = Math.random; Math.random = () => 0.1;
  for (let i = 0; i < 5; i++) ai.ai.tryShoot(0.016);
  Math.random = orig;
  chk('AI(' + ai.weapon + ') 射玩家');
  Game.units.splice(Game.units.indexOf(tgt), 1); tgt.dispose();
}

// 2. 玩家扔手雷炸自己
console.log('[2] 手雷自炸');
p.hp = 100; p.armor = 100; p.alive = true;
PlayerGun.throwGrenade();
const g = Projectiles.list[Projectiles.list.length - 1];
g.pos.copy(p.pos); // 手雷在脚下
Projectiles.explode(g);
chk('手雷自炸');

// 3. 玩家被 AI 手雷炸
console.log('[3] AI 手雷炸玩家');
p.hp = 100; p.armor = 100;
Projectiles.spawn('grenade', p.pos.clone(), new THREE.Vector3(), 'red', reds[0]);
const g2 = Projectiles.list[Projectiles.list.length - 1];
Projectiles.explode(g2);
chk('AI 手雷');

// 4. 玩家被迫击炮炸
console.log('[4] 迫击炮');
p.hp = 100; p.armor = 100;
Game.areaDamage(p.pos, 6, 65, null, 'red');
chk('迫击炮');

// 5. 完整对局模拟(100 帧 Game.update)
console.log('[5] 对局模拟 100 帧');
p.hp = 100; p.armor = 100; p.alive = true; p.life = 'alive'; p.down = false;
Game.dead = false; Game.phase = 'playing';
for (let i = 0; i < 100; i++) {
  Game.update(0.016);
  if (Number.isNaN(p.hp)) { chk('对局帧 ' + i); break; }
}
console.log('对局后 hp=' + p.hp + ' alive=' + p.alive);

// 6. 玩家倒地→流血→救援→再被打
console.log('[6] 倒地→救援→再战');
p.hp = 0; p.armor = 30; p.alive = true; p.life = 'alive'; p.down = false;
Game.toDown(p, null);
chk('倒地后');
const blue = Game.units.filter(u => u.ai && u.team === 'blue');
Game.startRevive(blue[0], p);
for (let i = 0; i < 100; i++) { p.reviveT += 0.05; if (p.reviveT >= CFG.REVIVE_TIME) break; }
Game.completeRevive(blue[0], p);
chk('被救起');
p.hp = 30; p.armor = 0;
Game.applyDamage(p, 17, null, false);
chk('0 甲再被打');

// 7. 玩家死亡→箱子
console.log('[7] 玩家死亡');
p.hp = 0; p.alive = true; p.life = 'alive'; p.down = false;
Game.toDown(p, null);
Game.toDead(p, null, 'bleed');
chk('死亡后(观战)');

// 8. PlayerGun armor 与 Unit armor 同步检查
console.log('[8] armor 双字段检查');
p.hp = 100; p.alive = true; p.life = 'alive'; p.down = false;
p.armor = 100; PlayerGun.armor = 100;
Game.applyDamage(p, 50, null, false);
console.log('被打 50 伤后: Unit.armor=' + p.armor + ' PlayerGun.armor=' + PlayerGun.armor + ' (期望都扣)');
PlayerGun.armorkits = 1; PlayerGun.armor = 40;
PlayerGun.useArmorkit();
console.log('用护甲包后: Unit.armor=' + p.armor + ' PlayerGun.armor=' + PlayerGun.armor + ' (期望都+50, 实际Unit可能没变=BUG)');

console.log('\n===== NaN 总数: ' + nanCount + ' =====');
