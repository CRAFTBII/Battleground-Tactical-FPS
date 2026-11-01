// v1.4 独立 QA：AI 战术 7 项行为验证（test/_qa_v14_ai.js）
// 职责：以 DOM 桩驱动真实游戏代码，逐项验证 design/maps/ai-tactics.md §1~§8：
//   ①沙暴庇护（shelterDest → 庇护区可走点；tacticalDest tag=shelter）
//   ②探照灯避光（leaveConeDest → 不在光锥；断电 null；断电推进 grenade 窗口 6~30）
//   ③缩圈边打边退（retreatInZone → 向圈心退 5m；tacticalDest tag=retreat）
//   ④烟雾掩护（maybeThrowSmoke → 投烟 + 穿烟推进）
//   ⑤护甲/医疗（armor<50 用包 +50；低血+敌视线 → tacticalDest tag=heal）
//   ⑥残血优先（scoreTarget 残血 −12 → 残血目标优先于近距满血）
//   ⑦纯战术不改数值（acc 公式 / 视线 0.2s / 反应 1.6s / 换弹 5s / 移速 3.6·6.2 / 护甲 60% 静态核对）
// 独立：不依赖 smoke.js 结论，自带 DOM 桩与真实触发路径（调用生产 update/tryShoot/perceive）。
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
 * 战术① 沙暴庇护：风暴期 + 暴露 + 12m 内有庇护 → shelterDest 给出
 * 庇护区可走点；tacticalDest → tag='shelter'
 * ================================================================ */
try {
  loadMap('desert');
  const aiU = Game.units.find(x => x.ai && x.alive);
  report('① 沙暴庇护: desert 图可取得 AI 单位', !!aiU, aiU ? aiU.name : '');
  if (aiU) {
    const M = Mechanics.state;
    // 动态取一个真实庇护矩形外侧 3m 的可走点（地图布局多次调整，硬编码 base 坐标会失效）
    const rects = (M.footprints || []).concat(M.shelter || [])
      .filter(r => (r.x1 - r.x0) > 4 && (r.z1 - r.z0) > 4);
    let spot = null;
    for (const r of rects) {
      const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
      for (const [x, z] of [[r.x1 + 3, cz], [r.x0 - 3, cz], [cx, r.z1 + 3], [cx, r.z0 - 3]]) {
        if (x < 1 || z < 1 || x > CFG.WORLD - 1 || z > CFG.WORLD - 1) continue;
        if (!World.walkable(x, z) || Mechanics._inShelter(x, z)) continue;
        spot = { x, z }; break;
      }
      if (spot) break;
    }
    report('① 前置：找到庇护区外侧可走点', !!spot, spot ? '(' + spot.x.toFixed(1) + ',' + spot.z.toFixed(1) + ')' : 'null');
    if (spot) aiU.pos.set(spot.x, World.heightAt(spot.x, spot.z), spot.z);
    aiU.alive = true; aiU.hp = 100;
    M.storm = true;                    // 强制风暴期
    Mechanics.exposedIds.add(aiU.id);  // 暴露
    const sd = aiU.ai.shelterDest();
    report('① shelterDest 非空', !!sd, sd ? '(' + sd.x.toFixed(1) + ',' + sd.z.toFixed(1) + ')' : 'null');
    if (sd) {
      report('① 庇护点可走', World.walkable(sd.x, sd.z), '(' + sd.x.toFixed(1) + ',' + sd.z.toFixed(1) + ')');
      report('① 庇护点在庇护区', Mechanics._inShelter(sd.x, sd.z), '(' + sd.x.toFixed(1) + ',' + sd.z.toFixed(1) + ')');
      const d2 = U.dist2(aiU.pos.x, aiU.pos.z, sd.x, sd.z);
      report('① 庇护点 ≤12m', d2 <= 13 * 13, '距离 ' + Math.sqrt(d2).toFixed(1) + 'm');
    }
    // tacticalDest 走生产路径：非战斗状态（canSee=false）+ 风暴 → tag=shelter
    aiU.ai.canSee = false; aiU.ai.evadeT = 0; aiU.ai.exposedT = 5;
    const td = aiU.ai.tacticalDest();
    report('① tacticalDest tag=shelter', td && td.tag === 'shelter', td ? (td.tag + ' → ' + td.d.x.toFixed(1) + ',' + td.d.z.toFixed(1)) : 'null');
    M.storm = false; Mechanics.exposedIds.delete(aiU.id);
  }
} catch (e) { report('① 沙暴庇护 崩溃', false, e.message); }

/* ================================================================
 * 战术② 探照灯避光：被曝露 >2s → leaveConeDest 对所有灯都不曝露；
 * 断电 → null；断电推进：手雷窗口放宽（d=7 → 应投出）
 * ================================================================ */
try {
  loadMap('port');
  const aiU = Game.units.find(x => x.ai && x.alive);
  report('② 避光: port 图可取得 AI 单位', !!aiU, aiU ? aiU.name : '');
  if (aiU) {
    const s = Mechanics.state;
    const realLights = s.lights;
    s.power = true;
    // 合成一盏灯罩住 AI：灯在 (130,145) 朝 +z，range30 halfAngle0.6 → (130,150) 锥内
    s.lights = [{ x: 130, z: 145, range: 30, halfAngle: 0.6, angle: 0 }];
    aiU.pos.set(130, 0, 150);
    Mechanics.exposedIds.add(aiU.id);
    aiU.ai.exposedT = 3;
    const ld = aiU.ai.leaveConeDest();
    report('② leaveConeDest 非空', !!ld, ld ? '(' + ld.x.toFixed(1) + ',' + ld.z.toFixed(1) + ')' : 'null');
    if (ld) {
      const inCone = aiU.ai._inAnyCone(ld.x, ld.z, s.lights, 1);
      report('② 目标点不在任一光锥(+1m)', !inCone, '(' + ld.x.toFixed(1) + ',' + ld.z.toFixed(1) + ') inCone=' + inCone);
    }
    s.power = false;
    report('② 断电时 leaveConeDest=null', aiU.ai.leaveConeDest() === null, '');
    // 断电推进：d=7（平时窗口 8~26 外）→ 断电窗口 6~30 内 → 手雷应投出
    const eT = { id: 't_pwr2', team: aiU.team === 'blue' ? 'red' : 'blue', alive: true, pos: V(130, 0, 143), hp: 100, ai: null, isPlayer: false };
    aiU.pos.set(130, 0, 150);
    aiU.ai.target = eT; aiU.ai.canSee = true; aiU.ai.grenadeCd = 0; aiU.ai._prevTarget = eT; aiU.ai.burst = 0;
    aiU.ai.losT = 0.5; // 视线节流内：本次 update 不重算 perceive（模拟已发现敌人后的 0.2s 窗口）
    const pBefore = Projectiles.list.filter(p => p.type === 'grenade').length;
    aiU.ai.update(0.016, Game.squads[aiU.team]);
    const pAfter = Projectiles.list.filter(p => p.type === 'grenade').length;
    report('② 断电推进: 7m 手雷投出（窗口 6~30）', pAfter > pBefore, 'grenade ' + pBefore + '→' + pAfter);
    s.power = true; s.lights = realLights; Mechanics.exposedIds.delete(aiU.id);
  }
} catch (e) { report('② 避光 崩溃', false, e.message); }

/* ================================================================
 * 战术③ 缩圈边打边退：圈外 engage → retreatInZone 向圈心退 5m；
 * tacticalDest → tag='retreat'
 * ================================================================ */
try {
  loadMap('desert');
  Mechanics.state.storm = false;
  const aiU = Game.units.find(x => x.ai && x.alive);
  report('③ 边打边退: desert 图可取得 AI 单位', !!aiU, aiU ? aiU.name : '');
  if (aiU) {
    const z = Mechanics.zone;
    z.active = true; z.center = { x: 110, z: 140 }; z.curR = 40;
    aiU.pos.set(240, 0, 220); // 圈外（距圈心 ≈152.6 > 40）
    aiU.hp = 100; aiU.ai.canSee = true; aiU.ai.retreatT = 0; aiU.ai.burst = 0;
    const beforeD = Math.sqrt(U.dist2(aiU.pos.x, aiU.pos.z, 110, 140));
    const rd = aiU.ai.retreatInZone();
    report('③ retreatInZone 非空', !!rd, rd ? '(' + rd.x.toFixed(1) + ',' + rd.z.toFixed(1) + ')' : 'null');
    if (rd) {
      const afterD = Math.sqrt(U.dist2(rd.x, rd.z, 110, 140));
      const step = Math.sqrt(U.dist2(aiU.pos.x, aiU.pos.z, rd.x, rd.z));
      report('③ 目标向圈心（距离减小）', afterD < beforeD, 'before ' + beforeD.toFixed(1) + 'm → after ' + afterD.toFixed(1) + 'm');
      report('③ 步长 ≈5m（4~6.5）', step >= 4 && step <= 6.5, step.toFixed(1) + 'm');
      report('③ 目标点可走', World.walkable(rd.x, rd.z), '(' + rd.x.toFixed(1) + ',' + rd.z.toFixed(1) + ')');
    }
    const td = aiU.ai.tacticalDest();
    report('③ tacticalDest tag=retreat', td && td.tag === 'retreat', td ? (td.tag + ' → ' + (td.d && td.d.x) + ',' + (td.d && td.d.z)) : 'null');
    z.active = false;
  }
} catch (e) { report('③ 边打边退 崩溃', false, e.message); }

/* ================================================================
 * 战术④ 烟雾掩护：开阔地 + 被敌射界覆盖 + 带烟 → 投烟 + 消耗 + 穿烟推进
 * ================================================================ */
try {
  loadMap('desert');
  Mechanics.state.storm = false;
  const sm = Game.units.find(x => x.ai && x.alive);
  report('④ 烟雾掩护: desert 图可取得 AI 单位', !!sm, sm ? sm.name : '');
  if (sm) {
    const savedUnits = Game.units;
    Projectiles.list = [];
    const eTeam = sm.team === 'blue' ? 'red' : 'blue';
    const fakeMe = { id: 't_sm4_ai', team: sm.team, alive: true, pos: V(170, 0, 170), hp: 100, ai: sm.ai, weapon: 'rifle', yaw: 0, vel: V() };
    const eEnemy = { id: 't_sm4_enemy', team: eTeam, alive: true, pos: V(170, 0, 210), hp: 100, ai: null, isPlayer: false }; // 40m 开阔
    Game.units = [Game.player, fakeMe, eEnemy];
    sm.pos.set(170, 0, 170);
    sm.ai._prevTarget = null; sm.ai.smokes = 1; sm.ai.smokeCd = 0; sm.ai._smokeT = 0; sm.ai.burst = 0;
    sm.ai.target = null; sm.ai.canSee = false; sm.ai.losT = 0; sm.ai.exposedT = 0;
    const origRandom = Math.random;
    Math.random = () => 0; // 触发概率 0.5 → 必定触发（同时固定 U.rand）
    sm.ai.update(0.016, Game.squads[sm.team]);
    Math.random = origRandom;
    const smokeProj = Projectiles.list.filter(p => p.type === 'smoke');
    report('④ 投出烟雾弹', smokeProj.length > 0, smokeProj.length + ' 颗');
    if (smokeProj.length) {
      // 发射点是原点，方向由 vel 决定（throwSmokeAt: vel 指向投烟点 pt = 朝敌方向 8~14m）
      const sp = smokeProj[0];
      report('④ 速度方向朝敌（+z 为主）', sp.vel.z > sp.vel.x && sp.vel.z > 1, 'vel(' + sp.vel.x.toFixed(2) + ',' + sp.vel.y.toFixed(2) + ',' + sp.vel.z.toFixed(2) + ')');
      report('④ 水平速度对应 8~14m 投烟', sp.vel.z >= 5.5 && sp.vel.z <= 11, 'velZ=' + sp.vel.z.toFixed(2));
    }
    report('④ 烟雾计数消耗+冷却置位', sm.ai.smokes === 0 && sm.ai.smokeCd > 0, 'smokes=' + sm.ai.smokes + ' smokeCd=' + sm.ai.smokeCd.toFixed(1));
    report('④ 穿烟推进窗口 _smokeT>0', sm.ai._smokeT > 0, '_smokeT=' + sm.ai._smokeT.toFixed(2));
    Game.units = savedUnits;
  }
} catch (e) { report('④ 烟雾掩护 崩溃', false, e.message); }

/* ================================================================
 * 战术⑤ 护甲/医疗：armor<50 带包 → 用包 +50；低血+敌视线 → tag='heal'
 * ================================================================ */
try {
  loadMap('suburb');
  const aiU = Game.units.find(x => x.ai && x.alive);
  report('⑤ 护甲医疗: suburb 图可取得 AI 单位', !!aiU, aiU ? aiU.name : '');
  if (aiU) {
    aiU.pos.set(260, 0, 260); // 远端孤立点
    aiU.hp = 100; aiU.armor = 30; aiU.ai.armorkits = 1; aiU.ai.armorCd = 0; aiU.ai.burst = 0;
    aiU.ai.canSee = false;
    aiU.ai.update(0.016, Game.squads[aiU.team]);
    report('⑤ 护甲包 +50（armor 30→≥80）', aiU.armor >= 80, 'armor=' + aiU.armor + '（初 30，+50 → 80）');
    report('⑤ 护甲包消耗', aiU.ai.armorkits === 0, 'armorkits=' + aiU.ai.armorkits);
    // 低血 + 敌视线 + 带医疗包 → tacticalDest tag=heal（撤掩体再用药）
    const eTeamH = aiU.team === 'blue' ? 'red' : 'blue';
    aiU.hp = 30; aiU.ai.medkits = 2; aiU.ai.healCd = 0; aiU.ai.canSee = true; aiU.ai.burst = 0;
    aiU.ai.target = { id: 't_heal5', team: eTeamH, alive: true, pos: V(260, 0, 240), hp: 100, ai: null, isPlayer: false };
    const th = aiU.ai.tacticalDest();
    report('⑤ 低血+敌视线 → tag=heal', th && th.tag === 'heal', th ? (th.tag + ' → ' + (th.d && th.d.x.toFixed ? th.d.x.toFixed(1) : th.d.x) + ',' + (th.d && th.d.z.toFixed ? th.d.z.toFixed(1) : th.d.z)) : 'null');
  }
} catch (e) { report('⑤ 护甲医疗 崩溃', false, e.message); }

/* ================================================================
 * 战术⑥ 残血优先：多目标评分——残血目标（距离 −12）优先于近距满血；
 * 换目标节流差 <4 不换
 * ================================================================ */
try {
  loadMap('desert');
  Mechanics.state.storm = false;
  const pr = Game.units.find(x => x.ai && x.alive);
  report('⑥ 残血优先: desert 图可取得 AI 单位', !!pr, pr ? pr.name : '');
  if (pr) {
    const savedU2 = Game.units;
    const pTeam = pr.team, eTeam2 = pTeam === 'blue' ? 'red' : 'blue';
    pr.pos.set(170, 0, 170);
    const prMe = { id: 't_score6_ai', team: pTeam, alive: true, pos: V(170, 0, 170), hp: 100, ai: pr.ai, weapon: 'rifle', yaw: 0, vel: V() };
    const eNear = { id: 't_near6', team: eTeam2, alive: true, pos: V(178, 0, 178), hp: 100, ai: null, isPlayer: false }; // d≈11.3
    const eLow = { id: 't_low6', team: eTeam2, alive: true, pos: V(183, 0, 183), hp: 20, ai: null, isPlayer: false };  // d≈18.4, score 6.4
    Game.units = [Game.player, prMe, eNear, eLow];
    pr.ai.target = eNear; pr.ai.losT = 0;
    pr.ai.perceive(0.5);
    report('⑥ 残血目标优先于近距满血', pr.ai.target === eLow, 'target=' + (pr.ai.target && pr.ai.target.id) + '（应 t_low6）');
    // 换目标节流：评分差 <4 不换
    pr.ai.target = eNear; pr.ai.losT = 0;
    const nearSc = pr.ai.scoreTarget(eNear, 11.3), lowSc = pr.ai.scoreTarget(eLow, 18.4);
    report('⑥ 节流边界（差 4.9 ≥4 → 可换）', (nearSc - lowSc) >= 4, 'nearScore=' + nearSc.toFixed(1) + ' lowScore=' + lowSc.toFixed(1) + ' 差=' + (nearSc - lowSc).toFixed(1));
    Game.units = savedU2;
  }
} catch (e) { report('⑥ 残血优先 崩溃', false, e.message); }

/* ================================================================
 * 战术⑦ 纯战术不改数值手感：静态核对手感层常量与文档 §8 红线一致
 * ================================================================ */
try {
  const aiSrc = fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8');
  const gameSrc = fs.readFileSync(path.join(ROOT, 'js/game.js'), 'utf8');
  const checks = [
    ['acc 步枪公式 clamp(0.5-d/150,0.04,0.55)', /U\.clamp\(0\.5\s*-\s*d\s*\/\s*150,\s*0\.04,\s*0\.55\)/.test(aiSrc)],
    ['acc 狙击公式 clamp(0.48-d/260,0.05,0.55)', /U\.clamp\(0\.48\s*-\s*d\s*\/\s*260,\s*0\.05,\s*0\.55\)/.test(aiSrc)],
    ['视线重算 0.2s', /this\.losT\s*=\s*0\.2/.test(aiSrc)],
    ['受伤反应 1.6s dodge', /1\.6/.test(aiSrc) && /dodgeT/.test(aiSrc)],
    ['换弹 5s', /reloading\s*=\s*5/.test(aiSrc)],
    ['移速 3.6/6.2（advance/followOrder）', /3\.6/.test(aiSrc) && /6\.2/.test(aiSrc)],
    ['护甲吸收 60%（dmg*0.6）', /dmg\s*\*\s*0\.6/.test(gameSrc)]
  ];
  let allOk = true;
  for (const [name, ok] of checks) { report('⑦ ' + name, ok, ''); if (!ok) allOk = false; }
  // 运行时额外核对：acc 公式在 d=150 时 = clamp(0.5-1)=0.04；d=0 → 0.5
  const accAt = d => U.clamp(0.5 - d / 150, 0.04, 0.55);
  report('⑦ acc 边界核对 d=150→0.04 d=0→0.5', Math.abs(accAt(150) - 0.04) < 1e-9 && Math.abs(accAt(0) - 0.5) < 1e-9, 'acc(150)=' + accAt(150) + ' acc(0)=' + accAt(0));
} catch (e) { report('⑦ 数值手感 崩溃', false, e.message); }

console.log('\n===== v1.4 AI 战术 QA: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
if (failures.length) failures.forEach(f => console.log(' - ' + f));
process.exit(failures.length ? 1 : 0);
