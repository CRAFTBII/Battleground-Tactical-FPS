// v2.5 独立 QA：hp NaN 防御 + 护甲双字段同步
// 运行：node test/_qa_v25_hpguard.js
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
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js', 'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js', 'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js')); global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

let passed = 0, failed = 0;
const R = (name, ok, extra) => { if (ok) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); } };
try { init(); } catch (e) { failures.push('init 崩溃: ' + e.message); }
Game.startSingle();
const p = Game.player;

/* ============ 1. dmg 净化（NaN/undefined/Infinity/负值 → 0 伤害，hp 不变） ============ */
console.log('\n[1] dmg 净化');
p.hp = 100; p.armor = 100; p.alive = true; p.life = 'alive'; p.down = false;
Game.applyDamage(p, NaN, null, false); R('dmg=NaN → hp 不变', p.hp === 100, 'hp=' + p.hp);
Game.applyDamage(p, undefined, null, false); R('dmg=undefined → hp 不变', p.hp === 100, 'hp=' + p.hp);
Game.applyDamage(p, Infinity, null, false); R('dmg=Infinity → hp 不变', p.hp === 100, 'hp=' + p.hp);
Game.applyDamage(p, -50, null, false); R('dmg=负值 → hp 不变', p.hp === 100, 'hp=' + p.hp);
Game.applyDamage(p, 17, null, false); R('正常伤害仍生效', p.hp < 100, 'hp=' + p.hp);

/* ============ 2. hp 兜底净化（上游污染也能立即修复） ============ */
console.log('\n[2] hp 兜底净化');
p.hp = NaN; p.alive = true;
Game.applyDamage(p, 17, null, false); R('hp=NaN 时受伤 → 归 0 不再 NaN', !Number.isNaN(p.hp), 'hp=' + p.hp);

/* ============ 3. 治疗净化 ============ */
console.log('\n[3] 治疗净化');
p.hp = NaN; p.alive = true; p.dead = false; p.down = false;
PlayerGun.medkits = 2;
PlayerGun.useMedkit();
R('hp=NaN 用医疗包 → 恢复满血', p.hp === CFG.PLAYER_HP, 'hp=' + p.hp);
p.hp = NaN; p.alive = true;
if (typeof Mechanics !== 'undefined' && Mechanics._heal) Mechanics._heal(p, 5);
R('hp=NaN 水塔回血 → 恢复', !Number.isNaN(p.hp), 'hp=' + p.hp);

/* ============ 4. UI 显示防御 ============ */
console.log('\n[4] UI 显示防御');
p.hp = NaN;
UI.updateHealth();
R('UI 显示 NaN → 0', String(UI.els.hpText.textContent) === '0', '显示=' + UI.els.hpText.textContent);
R('血条宽度 0%', UI.els.hpFill.style.width === '0%', 'width=' + UI.els.hpFill.style.width);

/* ============ 5. armor 双字段同步（被打 / 用护甲包） ============ */
console.log('\n[5] 护甲双字段同步');
p.hp = 100; p.alive = true; p.life = 'alive'; p.down = false;
p.armor = 100; PlayerGun.armor = 100;
Game.applyDamage(p, 50, null, false);
R('被打后两字段同步扣甲', p.armor === PlayerGun.armor && p.armor === 70, 'Unit=' + p.armor + ' PlayerGun=' + PlayerGun.armor);
PlayerGun.armorkits = 1;
const before = p.armor;
PlayerGun.useArmorkit();
R('用护甲包后两字段同步加甲', p.armor === PlayerGun.armor && p.armor === Math.min(100, before + 50), 'Unit=' + p.armor + ' PlayerGun=' + PlayerGun.armor);

/* ============ 6. areaDamage radius=0 不污染 hp ============ */
console.log('\n[6] 爆炸异常防御');
p.hp = 100; p.armor = 100; p.alive = true;
Game.areaDamage(p.pos, 0, 100, null, 'red');
R('radius=0 爆炸 → hp 不变', p.hp === 100 && !Number.isNaN(p.hp), 'hp=' + p.hp);

console.log('\n===== hp 防御 v2.5 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
if (failures.length) { console.log('加载错误:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(failed || failures.length ? 1 : 0);
