// v2.3 独立 QA：战利品箱规则重构（处决不掉箱 / 流血才掉 / 玩家箱无弹药 / AI 弹药无限 / AI 缺医疗包找箱）
// 运行：node test/_qa_v23_loot.js
'use strict';
const fs = require('fs');

/* ---- DOM 桩（对齐 smoke.js） ---- */
const noopObj = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : noop), set: () => true });
function noop() { return noopObj; }
const fakeEl = () => new Proxy({
  style: {}, classList: { add: noop, toggle: noop, remove: noop, contains: () => false },
  dataset: {}, innerHTML: '', textContent: '', value: '', title: '', className: '', onclick: null,
  appendChild: noop, prepend: noop, remove: noop, addEventListener: noop, querySelector: () => fakeEl(),
  querySelectorAll: () => [], setAttribute: noop, getContext: () => noopObj, focus: noop,
  width: 1, height: 1, requestPointerLock: noop, exitPointerLock: noop
}, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => { t[k] = v; return true; } });
const elements = {};
const docListeners = {};
global.document = {
  getElementById: id => (elements[id] || (elements[id] = fakeEl())),
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  createElement: tag => fakeEl(), body: { appendChild: noop }, title: '',
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; }
};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };
const lsStore = {};
global.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; }
};

const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) {
  const fp = path.join(ROOT, f);
  try { vm.runInThisContext(fs.readFileSync(fp, 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

let passed = 0, failed = 0;
const R = (name, ok, extra) => {
  if (ok) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  [' + extra + ']' : '')); }
};
try { init(); } catch (e) { failures.push('init 崩溃: ' + e.message); }
Items.init();
Game.startSingle();
const p = Game.player;
const redAI = Game.units.filter(u => u.ai && u.team === 'red');
const lootboxes = () => Items.list.filter(it => it.type === 'lootbox');

/* ============ 1. 处决不生成箱子 ============ */
console.log('\n[1] 处决不生成箱子');
const execVictim = redAI[0], execKiller = redAI[1];
Items.list.length = 0;
execVictim.hp = 1; execVictim.armor = 50;
execKiller.ai.lootTarget = null;
Game.applyDamage(execVictim, 999, execKiller, false); // 击倒
Game.applyDamage(execVictim, 999, execKiller, false); // 补枪处决
R('处决进入最终死亡', execVictim.life === 'dead');
R('处决不生成箱子', lootboxes().length === 0, 'boxes=' + lootboxes().length);
R('处决不绑定击杀者 lootTarget', !execKiller.ai.lootTarget);
R('处决仍计击杀分', execKiller.kills >= 1, 'kills=' + execKiller.kills);

/* ============ 2. 流血致死（20s 无人救）才掉箱 ============ */
console.log('\n[2] 流血致死掉箱');
const bleedVictim = redAI[2];
Items.list.length = 0;
Game.toDown(bleedVictim, null);
bleedVictim.bleedT = 0.01;
Game.tickDown(0.02);
R('流血进入最终死亡', bleedVictim.life === 'dead', 'life=' + bleedVictim.life);
R('流血致死生成箱子', lootboxes().length === 1, 'boxes=' + lootboxes().length);
const bleedBox = lootboxes()[0];
R('AI 箱子含弹药（玩家可捡）', bleedBox && bleedBox.loot && Object.keys(bleedBox.loot.ammo).length > 0, JSON.stringify(bleedBox && bleedBox.loot && bleedBox.loot.ammo));

/* ============ 3. 环境致死（zone）不生成箱子 ============ */
console.log('\n[3] 环境致死不掉箱');
const zoneVictim = redAI[3];
Items.list.length = 0;
Game.toDead(zoneVictim, null, 'zone');
R('环境致死不生成箱子', lootboxes().length === 0, 'boxes=' + lootboxes().length);

/* ============ 4. 玩家死亡掉箱且弹药不保留 ============ */
console.log('\n[4] 玩家箱子（弹药不保留）');
Items.list.length = 0;
p.hp = 1; p.armor = 70; PlayerGun.medkits = 5;
Game.toDead(p, redAI[4], 'executed');
const pBox = lootboxes()[0];
R('玩家死亡生成箱子', !!pBox, 'boxes=' + lootboxes().length);
R('玩家箱子弹药为空（不保留）', pBox && (!pBox.loot.ammo || Object.keys(pBox.loot.ammo).length === 0), JSON.stringify(pBox && pBox.loot && pBox.loot.ammo));
R('玩家箱子保留护甲', pBox && pBox.loot && pBox.loot.armor > 0, 'armor=' + (pBox && pBox.loot && pBox.loot.armor));
R('玩家箱子医疗包有上限', pBox && pBox.loot && pBox.loot.medkit <= CFG.PLAYER_LOOT_MEDKIT_MAX, 'medkit=' + (pBox && pBox.loot && pBox.loot.medkit));
R('玩家死亡进观战', Game.dead && !!Game.spectator);
Items.list.length = 0;

/* ============ 5. AI 弹药无限（换弹补满，备弹不耗） ============ */
console.log('\n[5] AI 弹药无限');
const infAI = redAI[5].ai;
const W2 = WEAPONS[infAI.unit.weapon];
infAI.mag = 0; infAI.reloading = 0;
const reserveBefore = infAI.reserveMap[infAI.unit.weapon];
infAI.update(0.05, Game.squads.red);
R('换弹补满弹匣', infAI.mag === W2.mag, 'mag=' + infAI.mag);
R('备弹池不消耗（无限）', infAI.reserveMap[infAI.unit.weapon] === reserveBefore, 'before=' + reserveBefore + ' after=' + infAI.reserveMap[infAI.unit.weapon]);

/* ============ 6. AI 缺医疗包主动找箱 ============ */
console.log('\n[6] AI 找箱动机（缺医疗包/护甲）');
const looter = redAI[6];
looter.ai.medkits = 0; looter.ai.armorkits = 0;
looter.ai.lootTarget = null; looter.ai.lootCd = 0;
const dropBox = Items.spawnLootbox(looter.pos.x + 10, looter.pos.y, looter.pos.z, { ammo: {}, medkit: 1, armor: 20 });
looter.ai.tryLoot(0.05);
R('缺医疗包 → 绑定附近箱子（10m 外先锁定）', looter.ai.lootTarget === dropBox, 'target=' + (looter.ai.lootTarget === dropBox));
R('箱子被 claimedBy 锁定', dropBox.claimedBy === looter);
// 医疗包充足时不找
const richAI = redAI[7];
richAI.ai.medkits = 5; richAI.ai.armorkits = 1; richAI.ai.armor = 100;
richAI.ai.lootTarget = null; richAI.ai.lootCd = 0;
const farBox = Items.spawnLootbox(richAI.pos.x, richAI.pos.y, richAI.pos.z, { ammo: {}, medkit: 1, armor: 20 });
richAI.ai.tryLoot(0.05);
R('医疗包/护甲充足不找箱', !richAI.ai.lootTarget);

/* ============ 7. AI 拾取箱子 → 医疗包 +1 ============ */
console.log('\n[7] AI 拾取箱子');
const medBefore = looter.ai.medkits;
looter.pos.set(dropBox.mesh.position.x, looter.pos.y, dropBox.mesh.position.z); // 走到箱子旁
looter.ai.tryLoot(0.05); // 拾取分支：2m 内 pickupFor + splice + 清 lootTarget
R('AI 拾取医疗包 +1', looter.ai.medkits === medBefore + 1, 'med=' + looter.ai.medkits + ' before=' + medBefore);
R('拾取后 lootTarget 清空', !looter.ai.lootTarget);
R('箱子从 Items.list 移除', !Items.list.includes(dropBox));

/* ============ 汇总 ============ */
console.log('\n===== 战利品规则 v2.3 QA: ' + passed + ' PASS / ' + failed + ' FAIL =====');
if (failures.length) { console.log('加载错误:'); failures.forEach(f => console.log('  ' + f)); }
process.exit(failed || failures.length ? 1 : 0);
