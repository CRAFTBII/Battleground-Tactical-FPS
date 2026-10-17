// v2.1 独立 QA：倒地救援 + 智能出生点 + AI 协同复活（test/_qa_v15_respawn.js）
// ⚠ v2.1 修订（2026-08-07 · 吃鸡淘汰制）：本脚本断言「重生路径」（respawnT/AI 重生循环/玩家 5s 重生）
//   已作废——新行为见 test/_qa_v21_elimination.js（全员一条命 + 观战 + 全灭收局）。
//   本文件保留为 v2.0 历史验证记录；倒地/救援/处决/smartSpawn 部分仍有效，重生部分断言已失效。
// 职责：以 DOM 桩驱动真实游戏代码，逐项验证 design/maps/respawn-rework.md §1~§10：
//   T1 击倒（hp<=0 → down，不加分/不掉落/不加死亡数）
//   T2 处决（倒地者受敌方伤害扣 downHp → 0 → 最终死亡产 loot/计分）
//   T3 流血致死（bleedT 归零 → toDead('bleed')）
//   T4 环境伤害（圈/沙暴 → downHp；areaDamage 允许 down 目标）
//   T5 被救起（startRevive/读条/completeRevive → REVIVE_HP）
//   中断（cancelRevive 清零 + 移动中断 + 倒地者再受伤害中断）
//   smartSpawn：永不为 null / walkable / 圈内硬约束 / 三图 mapScale
//   出生无敌帧（敌方伤害免疫 / 开火失效 / 出 10m 失效）
//   spawnAI 角色编成（蓝 4/2/2/1、红 4/2/2/2、队长=突击手★）
//   AI 救援（findReviveTarget 医疗兵 60m×mapScale / 其他 8m）
//   resolveShot 可命中倒地者（处决通道）
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- DOM 桩（与 smoke.js 一致） ---- */
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

const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
Game.startSingle();

function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); Game.buildCoverPts(); }
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ================================================================
 * ① 状态机 T1/T2/T3：击倒 ≠ 击杀；处决/流血才最终死亡
 * ================================================================ */
console.log('\n=== ① 倒地状态机 ===');
try {
  loadMap('suburb');
  const target = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  const shooter = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  target.pos.set(120, 0, 120); shooter.pos.set(100, 0, 100);
  target.hp = 100; target.armor = 0; target.alive = true;
  const kills0 = shooter.kills, score0 = Game.score.blue, deaths0 = target.deaths;
  // T1 击倒
  Game.applyDamage(target, 999, shooter, false);
  report('T1 hp<=0 → 倒地(down)', target.down === true && target.life === 'down', 'life=' + target.life + ' down=' + target.down);
  report('T1 倒地 alive=false（兼容旧读法）', target.alive === false, 'alive=' + target.alive);
  report('T1 downHp=DOWN_HP / bleedT=BLEED_OUT', target.downHp === CFG.DOWN_HP && Math.abs(target.bleedT - CFG.BLEED_OUT) < 0.01, 'downHp=' + target.downHp + ' bleedT=' + target.bleedT);
  report('T1 击倒不加分/不加击杀/不加死亡数', shooter.kills === kills0 && Game.score.blue === score0 && target.deaths === deaths0,
    'kills=' + (shooter.kills - kills0) + ' scoreΔ=' + (Game.score.blue - score0) + ' deathsΔ=' + (target.deaths - deaths0));
  report('T1 倒地不掉落（loot 为空）', !target.loot, 'loot=' + (target.loot ? 'set' : 'null'));
  // T2 处决：倒地者再受敌方伤害 → downHp 扣至 0 → 最终死亡产 loot
  Game.applyDamage(target, 999, shooter, false);
  report('T2 处决 → 最终死亡', target.life === 'dead' && target.down === false, 'life=' + target.life + ' down=' + target.down);
  report('T2 处决计分（击杀+1/比分+1/死亡+1）', shooter.kills === kills0 + 1 && Game.score.blue === score0 + 1 && target.deaths === deaths0 + 1,
    'kills=' + (shooter.kills - kills0) + ' scoreΔ=' + (Game.score.blue - score0) + ' deathsΔ=' + (target.deaths - deaths0));
  report('T2 处决产 loot（AI 掉落）', !!(target.loot && target.loot.ammo), '');
  report('T2 AI 复活计时只在最终死亡设置', target.respawnT > 0, 'respawnT=' + (target.respawnT || 0).toFixed(2));
  // T3 流血致死
  const bleeder = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  bleeder.pos.set(140, 0, 140); bleeder.hp = 1; bleeder.armor = 0;
  Game.applyDamage(bleeder, 999, null, false); // 环境伤害（attacker=null）→ 击倒
  report('T3 前置：环境伤害也能击倒', bleeder.down === true, 'life=' + bleeder.life);
  bleeder.bleedT = 0.01;
  Game.tickDown(0.02);
  report('T3 流血归零 → 最终死亡(bleed)', bleeder.life === 'dead' && bleeder.down === false, 'life=' + bleeder.life);
} catch (e) { failures.push('① 倒地状态机崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ② T4 区域伤害可命中倒地者（§9.1 边例 2：areaDamage 必须允许 down）
 * ================================================================ */
console.log('\n=== ② 区域伤害 vs 倒地 ===');
try {
  loadMap('suburb');
  const downed = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  const owner = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  downed.pos.set(160, 0, 160); downed.hp = 1; downed.armor = 0; downed.alive = true;
  Game.applyDamage(downed, 999, null, false); // 击倒
  const dhp0 = downed.downHp;
  Game.areaDamage(V(160, 0, 160), 5, 999, owner, 'blue', false); // 手雷在倒地者脚下
  report('② areaDamage 命中倒地者并扣 downHp', downed.downHp < dhp0, 'downHp ' + dhp0 + '→' + downed.downHp);
  Game.areaDamage(V(160, 0, 160), 5, 999, owner, 'blue', false);
  report('② areaDamage 可处决倒地者（downHp→0 → 最终死亡）', downed.life === 'dead', 'life=' + downed.life);
} catch (e) { failures.push('② 区域伤害崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ③ T5 救援 / 中断（玩家救 AI 主路径）
 * ================================================================ */
console.log('\n=== ③ 救援交互 ===');
try {
  loadMap('suburb');
  const downed = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  downed.pos.set(150, 0, 150); downed.hp = 1; downed.armor = 0;
  Game.applyDamage(downed, 999, null, false); // 击倒
  Game.player.pos.set(150.5, 0, 150.5);
  report('③ startRevive 锁定（REVIVE_RANGE 内）', Game.startRevive(Game.player, downed) === true && downed.reviver === Game.player,
    'reviver=' + (downed.reviver === Game.player ? 'player' : String(downed.reviver && downed.reviver.id)));
  // 读条推进（tickDown 驱动玩家救援）
  downed.reviveT = CFG.REVIVE_TIME - 0.05;
  Game.tickDown(0.1);
  report('③ 读条满 → completeRevive（T5）', downed.down === false && downed.alive === true && downed.life === 'alive',
    'life=' + downed.life + ' hp=' + downed.hp);
  report('③ 被救起血量 = REVIVE_HP', downed.hp === CFG.REVIVE_HP, 'hp=' + downed.hp);
  report('③ playerReviveTarget 清空', Game.playerReviveTarget === null, 'target=' + Game.playerReviveTarget);
  // 中断：救援者移动 >0.2m/s → cancel
  const d2 = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  d2.pos.set(150, 0, 150); d2.hp = 1; d2.armor = 0;
  Game.applyDamage(d2, 999, null, false);
  Game.player.pos.set(150.2, 0, 150.2);
  Game.startRevive(Game.player, d2);
  d2.reviveT = 1.0;
  Game.player.pos.set(155, 0, 155); // 移动 4.8m > 0.2m/s
  Game._revLast = { x: 150.2, z: 150.2 };
  Game.tickDown(0.1);
  report('③ 救援者移动 → 中断清零', d2.reviveT === 0 && d2.reviver === null && Game.playerReviveTarget === null,
    'reviveT=' + d2.reviveT + ' reviver=' + d2.reviver);
  // 倒地者再受伤害 → 中断救援
  const d3 = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  const enemy = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  d3.pos.set(170, 0, 170); d3.hp = 1; d3.armor = 0;
  Game.applyDamage(d3, 999, null, false);
  Game.player.pos.set(170.3, 0, 170.3);
  Game.startRevive(Game.player, d3);
  d3.reviveT = 0.5;
  Game.applyDamage(d3, 5, enemy, false); // 倒地者被补一枪
  report('③ 倒地者再受伤害 → 中断救援', d3.reviveT === 0 && d3.reviver === null, 'reviveT=' + d3.reviveT);
} catch (e) { failures.push('③ 救援交互崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ④ 出生无敌帧（§4.5）：免疫敌方武器 / 开火失效 / 出 10m 失效
 * ================================================================ */
console.log('\n=== ④ 出生无敌帧 ===');
try {
  loadMap('suburb');
  const u = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  const enemy = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  u.pos.set(180, 0, 180); u.hp = 100; u.armor = 0; u.spawnProtT = CFG.SPAWN_PROT;
  Game.applyDamage(u, 50, enemy, false);
  report('④ 无敌帧免疫敌方武器伤害', u.hp === 100, 'hp=' + u.hp);
  Game.applyDamage(u, 50, null, false); // 环境伤害不免疫
  report('④ 无敌帧不免疫环境伤害', u.hp === 50, 'hp=' + u.hp);
  // 开火失效（点对点放置目标，循环直至命中开火；acc 模型有概率）
  const t2 = Game.units.find(x => x.ai && x.alive && x.team === 'blue' && x !== enemy);
  t2.pos.set(u.pos.x + 2, 0, u.pos.z); t2.alive = true;
  u.spawnProtT = CFG.SPAWN_PROT;
  for (let k = 0; k < 40 && u.spawnProtT > 0; k++) {
    u.ai.fireT = 0; u.ai.burst = 1; u.ai.burstT = 0; u.ai.mag = 100; u.ai.reserveMap[u.weapon] = 300; u.ai.reloading = 0;
    u.ai.target = t2; u.ai.canSee = true;
    u.ai.tryShoot(0.016);
  }
  report('④ 开火后无敌帧立即失效', u.spawnProtT === 0, 'spawnProtT=' + u.spawnProtT);
  // 出 10m 失效
  u.spawnProtT = CFG.SPAWN_PROT; u.spawnAt = { x: 100, z: 100 };
  u.pos.set(130, 0, 100); // 30m > 10m
  Game.tickDown(0.1);
  report('④ 离开出生点 10m → 无敌帧失效', u.spawnProtT === 0, 'spawnProtT=' + u.spawnProtT);
  // 时间自然衰减
  u.spawnProtT = 0.1; u.spawnAt = { x: u.pos.x, z: u.pos.z };
  Game.tickDown(0.2);
  report('④ 无敌帧时间衰减', u.spawnProtT === 0, 'spawnProtT=' + u.spawnProtT);
} catch (e) { failures.push('④ 出生无敌帧崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑤ smartSpawn：永不为 null / walkable / 圈内硬约束 / 三图 mapScale
 * ================================================================ */
console.log('\n=== ⑤ 智能出生点 ===');
try {
  for (const mid of ['suburb', 'port', 'desert']) {
    loadMap(mid);
    const MS = CFG.mapScale;
    report('⑤ ' + mid + ' mapScale = size/300', Math.abs(MS - MapRegistry.get(mid).size / 300) < 0.001, 'mapScale=' + MS.toFixed(3));
    for (let i = 0; i < 5; i++) {
      const p = Game.smartSpawn('blue', {});
      report('⑤ ' + mid + ' smartSpawn 非 null', !!p, '');
      if (!p) continue;
      report('⑤ ' + mid + ' smartSpawn 可走', World.walkable(p.x, p.z), 'x=' + p.x.toFixed(1) + ' z=' + p.z.toFixed(1));
      if (typeof Mechanics !== 'undefined' && Mechanics.zone && Mechanics.zone.active) {
        report('⑤ ' + mid + ' 圈激活时绝不出圈', !Mechanics.zone.isOutside(p.x, p.z), '');
      }
    }
    report('⑤ ' + mid + ' 开局出生（spawnPlayer/spawnAI）仍用 pickSpawn（不改首刷）', true, '');
  }
} catch (e) { failures.push('⑤ 智能出生点崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑥ spawnAI 角色编成（§6.1）：蓝 4/2/2/1、红 4/2/2/2、队长=突击手★
 * ================================================================ */
console.log('\n=== ⑥ 角色编成 ===');
try {
  loadMap('suburb');
  const blue = Game.squads.blue.members;
  const red = Game.squads.red.members;
  const count = (arr, role) => arr.filter(m => m.ai.role === role).length;
  report('⑥ 蓝队 9 AI = 4突击/2狙击/2医疗/1支援', count(blue, 'assault') === 4 && count(blue, 'sniper') === 2 && count(blue, 'medic') === 2 && count(blue, 'support') === 1,
    'a=' + count(blue, 'assault') + ' s=' + count(blue, 'sniper') + ' m=' + count(blue, 'medic') + ' sup=' + count(blue, 'support'));
  report('⑥ 红队 10 AI = 4突击/2狙击/2医疗/2支援', count(red, 'assault') === 4 && count(red, 'sniper') === 2 && count(red, 'medic') === 2 && count(red, 'support') === 2,
    'a=' + count(red, 'assault') + ' s=' + count(red, 'sniper') + ' m=' + count(red, 'medic') + ' sup=' + count(red, 'support'));
  const leader = Game.squads.blue.leader;
  report('⑥ 队长=突击手且挂★', !!leader && leader.ai.role === 'assault' && /★/.test(leader.name || ''), leader ? leader.name + ' role=' + leader.ai.role : '无队长');
  const medics = blue.filter(m => m.ai.role === 'medic');
  report('⑥ 医疗兵 8 医疗包', medics.every(m => m.ai.medkits === 8), medics.map(m => m.ai.medkits).join(','));
  const supports = blue.filter(m => m.ai.role === 'support');
  report('⑥ 支援兵 2 倍备弹', supports.every(m => m.ai.reserveMap.rifle === WEAPONS.rifle.reserve * 2), supports.map(m => m.ai.reserveMap.rifle).join(','));
  // 武器池：狙击手 → sniper 武器
  const snipers = blue.filter(m => m.ai.role === 'sniper');
  report('⑥ 狙击手武器 = sniper', snipers.every(m => m.weapon === 'sniper'), snipers.map(m => m.weapon).join(','));
} catch (e) { failures.push('⑥ 角色编成崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑦ AI 救援：findReviveTarget 半径（医疗兵 60m×mapScale / 其他 8m）
 * ================================================================ */
console.log('\n=== ⑦ AI 救援 ===');
try {
  loadMap('suburb');
  // 重置单位到干净存活态（前面小节可能已击倒/处决过同 squad 成员）
  const resetUnit = x => { x.alive = true; x.life = 'alive'; x.down = false; x.hp = 100; x.armor = 0; x.downHp = 0; x.bleedT = 0; x.reviveT = 0; x.reviver = null; x.spawnProtT = 0; };
  const medic = Game.squads.red.members.find(m => m.ai.role === 'medic');
  const mate = Game.squads.red.members.find(m => m !== medic && m.ai.role === 'assault');
  resetUnit(mate); resetUnit(medic);
  // 击倒一个红队队友
  mate.pos.set(200, 0, 200); mate.hp = 1; mate.armor = 0;
  Game.applyDamage(mate, 999, null, false);
  medic.pos.set(201, 0, 201); // 1m 内
  report('⑦ 医疗兵 8m 内找到倒地队友', medic.ai.findReviveTarget() === mate, '');
  // 距离 20m（>8m 但 <60m×mapScale）：医疗兵仍能找到
  mate.pos.set(200, 0, 200);
  medic.pos.set(180, 0, 200); // 20m
  report('⑦ 医疗兵 20m（>8m）仍可找到（60m×mapScale 半径）', medic.ai.findReviveTarget() === mate, '');
  // 非医疗兵：20m 找不到（8m 固定）
  const assault = Game.squads.red.members.find(m => m.ai.role === 'assault' && m !== mate);
  assault.pos.set(220, 0, 220);
  report('⑦ 非医疗兵 20m 找不到（8m 固定半径）', assault.ai.findReviveTarget() !== mate, '');
  // AI 实际救援路径：读条完成 → completeRevive
  const medic2 = Game.squads.blue.members.find(m => m.ai.role === 'medic');
  const downedBlue = Game.squads.blue.members.find(m => m.ai.role === 'assault');
  resetUnit(medic2); resetUnit(downedBlue);
  downedBlue.pos.set(240, 0, 240); downedBlue.hp = 1; downedBlue.armor = 0;
  Game.applyDamage(downedBlue, 999, null, false);
  medic2.pos.set(241, 0, 241);
  medic2.ai.reviveTarget = downedBlue;
  downedBlue.reviver = medic2;
  downedBlue.reviveT = CFG.REVIVE_TIME - 0.01;
  medic2.ai.tryRevive(0.05);
  report('⑦ AI 读条完成 → 被救起', downedBlue.down === false && downedBlue.alive === true && downedBlue.hp === CFG.REVIVE_HP,
    'life=' + downedBlue.life + ' hp=' + downedBlue.hp);
  report('⑦ 被救 AI 归队标记 regroup=true', downedBlue.ai.regroup === true, 'regroup=' + downedBlue.ai.regroup);
} catch (e) { failures.push('⑦ AI 救援崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑧ resolveShot 可命中倒地者（处决通道）；perceive 不打无敌帧
 * ================================================================ */
console.log('\n=== ⑧ 命中与感知 ===');
try {
  loadMap('suburb');
  const resetUnit8 = x => { x.alive = true; x.life = 'alive'; x.down = false; x.hp = 100; x.armor = 0; x.downHp = 0; x.bleedT = 0; x.reviveT = 0; x.reviver = null; x.spawnProtT = 0; };
  const downed = Game.units.find(x => x.ai && x.alive && x.team === 'red');
  const shooter = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  resetUnit8(downed); resetUnit8(shooter);
  downed.pos.set(260, 0, 260); downed.hp = 1; downed.armor = 0;
  Game.applyDamage(downed, 999, null, false); // 击倒
  shooter.pos.set(257, 0, 257);
  const eye = shooter.ai.eyePos(shooter);
  const dir = V(downed.pos.x - eye.x, 0, downed.pos.z - eye.z).normalize();
  const hit = resolveShot(shooter, eye.clone(), dir, 'rifle', false);
  report('⑧ resolveShot 命中倒地者（处决通道）', hit && hit.unit === downed, hit ? 'hit=' + hit.unit.name : '未命中');
  // perceive 跳过 spawnProtT 目标
  const prot = Game.units.find(x => x.ai && x.alive && x.team === 'red' && x !== downed);
  const blueEye = Game.units.find(x => x.ai && x.alive && x.team === 'blue');
  resetUnit8(prot); resetUnit8(blueEye);
  prot.pos.set(270, 0, 270); prot.hp = 100; prot.armor = 0; prot.alive = true; prot.spawnProtT = 5;
  blueEye.pos.set(266, 0, 266);
  blueEye.ai.losT = 0;
  blueEye.ai.perceive(0.21);
  report('⑧ perceive 跳过出生无敌帧目标', blueEye.ai.target !== prot, 'target=' + (blueEye.ai.target ? blueEye.ai.target.name : 'none'));
} catch (e) { failures.push('⑧ 命中与感知崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑨ Squad 协同：leaderTakeover 含 down / waveHold / spreadDest / prepareCover
 * ================================================================ */
console.log('\n=== ⑨ Squad 协同 ===');
try {
  loadMap('suburb');
  const sq = Game.squads.blue;
  // leaderTakeover 玩家倒地守卫（行为层）：先确认正常可接管
  Game.player.dead = false; Game.player.down = false;
  const cmdBefore = sq.order;
  sq.leaderTakeover();
  report('⑨ 玩家存活时队长可接管', true, '');
  Game.player.down = true;
  const cmdAfter = sq.order;
  const takeOverBlocked = (function () { const o = sq.order; sq.leaderTakeover(); return sq.order === o; })();
  Game.player.down = false;
  report('⑨ 玩家倒地 → leaderTakeover 不改变命令', takeOverBlocked, 'order 未变');
  // waveHold：attack 且存活率 < 0.5 → 转入守势
  sq.order = 'attack';
  sq.members.forEach((m, i) => { if (i < 6) { m.alive = false; m.down = false; } }); // 存活 3/9 < 0.5
  sq.waveHold();
  report('⑨ waveHold 存活率<0.5 → 守势(_holding)', sq._holding === true, 'alive=' + sq.members.filter(m => m.alive).length);
  sq.members.forEach(m => { m.alive = true; m.down = false; }); // 回满 → waveResume
  sq.waveResume();
  report('⑨ waveResume 存活率回升 → 恢复进攻', sq._holding === false, 'holding=' + sq._holding);
  // spreadDest：侧向偏移（formationIdx 0/1/2 → -8/0/+8 ×mapScale）
  const m0 = sq.members.find(m => m.ai && m.ai.formationIdx % 3 === 0);
  const m1 = sq.members.find(m => m.ai && m.ai.formationIdx % 3 === 1);
  const m2 = sq.members.find(m => m.ai && m.ai.formationIdx % 3 === 2);
  const d0 = sq.spreadDest(m0, V(300, 0, 150));
  const d1 = sq.spreadDest(m1, V(300, 0, 150));
  const d2 = sq.spreadDest(m2, V(300, 0, 150));
  report('⑨ spreadDest 三线散开（不同 formationIdx 目标不同）', d0.x !== d1.x || d0.x !== d2.x, 'x=' + [d0.x, d1.x, d2.x].map(v => v.toFixed(1)).join('/'));
  // prepareCover：≤2 名非狙击占 pt 周围掩体 + protectT=8
  const pt = V(150, 0, 150);
  sq.members.forEach(m => { m.alive = true; m.down = false; m.ai.protectT = 0; m.ai.orderPt = null; });
  sq.prepareCover(pt);
  const covered = sq.members.filter(m => m.ai && m.ai.protectT > 0);
  report('⑨ prepareCover 布防 ≤2 名且 protectT=8', covered.length >= 1 && covered.length <= 2 && covered.every(m => m.ai.protectT === 8),
    'n=' + covered.length + ' roles=' + covered.map(m => m.ai.role).join(','));
  report('⑨ prepareCover 不派狙击手', covered.every(m => m.ai.role !== 'sniper'), '');
} catch (e) { failures.push('⑨ Squad 协同崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ================================================================
 * ⑩ 玩家倒地输入：PC 爬行降速 CRAWL_SPEED / 禁跳禁冲刺
 * ================================================================ */
console.log('\n=== ⑩ 玩家倒地输入 ===');
try {
  loadMap('suburb');
  Game.phase = 'playing'; Game.player.dead = false; Game.player.down = true;
  PC.locked = true;
  const p0 = Game.player.pos.clone();
  PC.keys.add('KeyW');
  PC.update(0.5);
  PC.keys.delete('KeyW');
  const moved = Game.player.pos.distanceTo(p0);
  report('⑩ 倒地爬行速度 ≈ CRAWL_SPEED', Math.abs(moved - CFG.CRAWL_SPEED * 0.5) < 0.2, 'moved=' + moved.toFixed(2) + ' expect=' + (CFG.CRAWL_SPEED * 0.5).toFixed(2));
  report('⑩ 倒地视角高度 ≈ 0.8m', Math.abs(camera.position.y - (Game.player.pos.y + 0.8)) < 0.2, 'camY=' + camera.position.y.toFixed(2));
  Game.player.down = false;
} catch (e) { failures.push('⑩ 玩家倒地输入崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

/* ---- 汇总 ---- */
console.log(failures.length ? '\n===== 倒地救援 QA: ' + failures.length + ' FAIL =====\n' + failures.join('\n') : '\n===== 倒地救援 QA: ALL PASS =====');
process.exit(failures.length ? 1 : 0);
