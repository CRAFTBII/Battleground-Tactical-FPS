// v1.3 独立验证 · 缩圈引擎（quality-lead 严守真）· test/_qa_v13_zone.js
// 只信证据不信承诺：真实 mapDef 数据 + 真实引擎代码，DOM 桩驱动（仿 smoke.js）。
// 覆盖：①三图 zone 数据契约 ②阶段推进+收缩 lerp ③圈外伤害速率逐档+owner=null 不产分
//      ④AI 进圈优先级 ⑤视觉 fog:false/颜色/vignette/小地图 ⑥联机 m_zone+非房主不裁决
//      ⑦共存：沙暴双压/水塔圈外回血/suburb 空投炮击 ⑧容错
// 用法：node test/_qa_v13_zone.js
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
global.document = {
  getElementById: id => (elements[id] || (elements[id] = fakeEl())),
  querySelector: () => fakeEl(), querySelectorAll: () => [],
  createElement: tag => fakeEl(), body: { appendChild: noop }, title: '',
  addEventListener: (t, fn) => { docListeners[t] = fn; },
  dispatchEvent: e => { const fn = docListeners[e.type]; if (fn) fn(e); return true; }
};
const docListeners = {};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };
const lsStore = {};
global.localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); }, removeItem: k => { delete lsStore[k]; } };

const ROOT = path.join(__dirname, '..', '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class { constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; } setPixelRatio() {} setSize() {} render() {} };
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('../_harness').preloadSync(ROOT);

try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
Game.startSingle();
Game.phase = 'playing';

function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}
function loadMap(id) { World.load(World.scene, MapRegistry.get(id)); }
function fastForwardZone(z, toPhaseIdx) {
  let guard = 0;
  const nextAt = z.phases[toPhaseIdx].atSec + z.shrinkSec + 0.2;
  while ((z.phaseIdx < toPhaseIdx || z.elapsed < nextAt) && guard++ < 30000) Mechanics.tick(0.25);
  return guard < 30000;
}
function freshUnit(x, z, team) {
  const u = new Unit(team || 'red', { x, y: 0, z, weapon: 'rifle' });
  u.alive = true; u.hp = 100; u.armor = 0;
  Game.units.push(u);
  return u;
}
// 测量圈外伤害速率：置于稳态阶段，1s（2×0.5s tick）= 2 次 dmgPerSec/2
function measureRate(x, z, secs) {
  const u = freshUnit(x, z, 'red');
  u.hp = 100; u.armor = 0;
  const z0 = Mechanics.zone;
  z0.dmgT = 0.5; // 对齐节流，保证 0.5s 步进恰好每次触发
  const hp0 = u.hp;
  const n = Math.round(secs / 0.5);
  for (let i = 0; i < n; i++) Mechanics.tick(0.5);
  const lost = hp0 - u.hp;
  const idx = Game.units.indexOf(u); if (idx >= 0) Game.units.splice(idx, 1);
  return lost;
}

/* ================================================================
 * ① 三图 zone 数据契约 vs design/maps/zone-br.md §1/§2
 * ================================================================ */
console.log('\n=== ① 三图 zone 数据契约 ===');
const DESIGN = {
  // v3.1 小镇化扩图后的现行数值
  suburb: { center: { x: 350, z: 350 }, r: [520, 321, 208, 135, 73], atSec: [0, 135, 315, 495, 675], dmg: [1, 3, 6, 10, 15] },
  port:   { center: { x: 310, z: 310 }, r: [460, 284, 184, 120, 65], atSec: [0, 135, 315, 495, 675], dmg: [1, 3, 6, 10, 15] },
  desert: { center: { x: 370, z: 370 }, r: [550, 340, 220, 143, 77], atSec: [0, 135, 315, 495, 675], dmg: [1, 3, 6, 10, 15] }
};
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const def = MapRegistry.get(id).zone;
  const z = Mechanics.zone;
  const exp = DESIGN[id];
  const okDef = def && z.active && z.phases.length === 5 &&
    Math.abs(def.center.x - exp.center.x) < 0.01 && Math.abs(def.center.z - exp.center.z) < 0.01 &&
    def.warnSec === 5 && def.color === 0x4d9bff;
  report(id + ' zone 数据契约（center/warnSec=5/color=0x4d9bff/5阶段）', !!okDef,
    okDef ? 'center=(' + def.center.x + ',' + def.center.z + ') warnSec=' + def.warnSec + ' color=0x' + def.color.toString(16) : JSON.stringify(def));
  let phaseOk = true, detail = '';
  for (let i = 0; i < 5; i++) {
    const p = z.phases[i];
    if (Math.abs(p.atSec - exp.atSec[i]) > 0.01 || Math.abs(p.r - exp.r[i]) > 0.01 || Math.abs(p.dmgPerSec - exp.dmg[i]) > 0.01) {
      phaseOk = false; detail += ' P' + i + '=(' + p.atSec + ',' + p.r + ',' + p.dmgPerSec + ')≠(' + exp.atSec[i] + ',' + exp.r[i] + ',' + exp.dmg[i] + ')';
    }
  }
  report(id + ' 阶段数值（atSec/r/dmgPerSec 逐项）', phaseOk, phaseOk ? 'P0~P4 全对' : detail);
  report(id + ' 初始圈覆盖所有出生点与据点', (function () {
    const md = MapRegistry.get(id);
    const pts = [].concat(md.spawns ? (md.spawns.blue || []) : [], md.spawns ? (md.spawns.red || []) : [],
      (md.capturePoints || []).map(c => [c.x, c.z]));
    const maxD = pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - exp.center.x, p[1] - exp.center.z)), 0);
    return exp.r[0] >= maxD;
  })(), 'r0=' + exp.r[0]);
}

/* ================================================================
 * ② 阶段推进 + 收缩 lerp（suburb 真实数据）
 * ================================================================ */
console.log('\n=== ② 阶段推进 + 收缩平滑 ===');
{
  loadMap('suburb');
  const z = Mechanics.zone;
  report('阶段推进：开局 P0（dmg=1, curR=520）', z.phaseIdx === 0 && z.dmgPerSec === 1 && Math.abs(z.curR - 520) < 0.5, 'phase=' + z.phaseIdx + ' dmg=' + z.dmgPerSec + ' curR=' + z.curR);
  // 收缩中段观测：推进到 P1 收缩的 1s 处，curR 应处于 520→321 中间
  z.elapsed = z.phases[1].atSec - 0.5; // 停在 P1 前 0.5s（warn 已过）
  z.shrinking = false; z._builtR = 999; // 强制后续重建
  Mechanics.tick(0.5); // 触发收缩
  if (z.phaseIdx === 1 && z.shrinking) {
    Mechanics.tick(1.0); // 收缩 1s 后
    const mid = z.curR;
    report('收缩过渡 2s lerp（1s 中段≈420）', Math.abs(mid - 420.5) < 8, 'curR@1s=' + mid.toFixed(1) + '（520→321 线性中段≈420.5）');
  } else report('收缩过渡 2s lerp（1s 中段≈420）', false, 'phase=' + z.phaseIdx + ' shrinking=' + z.shrinking);
  Mechanics.tick(1.0); // 收缩完成
  report('收缩完成到目标半径（curR≈321, shrinking=false）', Math.abs(z.curR - 321) < 0.5 && !z.shrinking, 'curR=' + z.curR.toFixed(2) + ' shrinking=' + z.shrinking);
  report('伤害即时切换 P1=3HP/s', z.dmgPerSec === 3, 'dmg=' + z.dmgPerSec);
  // warn 时序：elapsed 尚未到 P2 atSec-5 时不发 warn banner；到点发
  z.elapsed = z.phases[2].atSec - z.warnSec + 0.1;
  z.warned = {}; // 清标记重测
  const bannerBefore = UI.banner;
  let bannerMsg = null;
  UI.banner = (m) => { bannerMsg = m; };
  Mechanics.tick(0.05);
  report('警示时序：atSec-warnSec 触发「即将收缩」banner', (bannerMsg || '').indexOf('即将') >= 0, bannerMsg || '(无 banner)');
  UI.banner = bannerBefore;
}

/* ================================================================
 * ③ 圈外伤害速率逐档 + owner=null 不产分
 * ================================================================ */
console.log('\n=== ③ 圈外伤害速率逐档 ===');
{
  loadMap('suburb');
  const z = Mechanics.zone;
  const RATES = [1, 3, 6, 10, 15];
  const RADII = [520, 321, 208, 135, 73];
  const cx = z.center.x, cz = z.center.z;
  for (let i = 0; i < 5; i++) {
    if (!fastForwardZone(z, i)) { report('P' + i + ' 推进到稳态', false, '超时'); continue; }
    // 置于圈外 8m（避开极端角落），1s 速率
    const x = cx + z.curR + 8, zz = cz;
    const lost = measureRate(x, zz, 1.0);
    report('P' + i + ' 圈外速率 ≈ ' + RATES[i] + 'HP/s', Math.abs(lost - RATES[i]) <= 0.75, '1s 损失 ' + lost.toFixed(2) + '（期望 ' + RATES[i] + '）');
  }
  // owner=null 不产分：P4 下圈外低血单位死亡，比分不变、无击杀归属
  fastForwardZone(z, 4);
  const sc0 = Game.score.blue + Game.score.red;
  const victim = freshUnit(cx + z.curR + 10, cz, 'red');
  victim.hp = 1; victim.armor = 0; victim.loot = null;
  z.dmgT = 0.5;
  let guard = 0;
  while (victim.alive && guard++ < 200) Mechanics.tick(0.25);
  const sc1 = Game.score.blue + Game.score.red;
  report('owner=null 环境伤害不产分（圈外死亡比分不变）', !victim.alive && sc0 === sc1, 'dead=' + !victim.alive + ' score ' + sc0 + '→' + sc1);
  const idx = Game.units.indexOf(victim); if (idx >= 0) Game.units.splice(idx, 1);
}

/* ================================================================
 * ④ AI 进圈（无敌意最高优先级 / 有敌 engage 不受扰 / 复活圈外）
 * ================================================================ */
console.log('\n=== ④ AI 进圈 ===');
{
  // 前序 fast-forward 圈伤可能打死 AI → 先全员复活再测
  for (const u of Game.units) { u.alive = true; u.hp = CFG.PLAYER_HP; u.armor = 0; if (u.ai) u.ai.reset(); }
  loadMap('suburb');
  const z = Mechanics.zone;
  fastForwardZone(z, 4); // 最终圈 r46，多数出生点圈外
  for (const u of Game.units) { u.alive = true; u.hp = CFG.PLAYER_HP; u.armor = 0; if (u.ai) { u.ai.reset(); u.ai.repathT = -1; } }
  const squad = Game.squads.red;
  const u = squad.members.find(m => m.ai && m.alive);
  const ai = u.ai;
  // ④-1 圈外无敌意 → zoneDest 圈内可达点（最高优先级，覆盖 squad 目标）
  u.pos.set(z.center.x + z.curR + 40, 0, z.center.z);
  ai.target = null; ai.canSee = false; ai.state = 'advance'; ai.path = []; ai.repathT = -1;
  squad.objective = { x: z.center.x, z: z.center.z + z.curR + 60 }; // 圈外远处 squad 目标（应被覆盖）
  const zd = ai.zoneDest();
  report('④-1a 圈外 zoneDest 返回圈内点', !!zd && U.dist2(zd.x, zd.z, z.center.x, z.center.z) <= z.curR * z.curR + 0.01,
    zd ? 'dest=(' + zd.x.toFixed(1) + ',' + zd.z.toFixed(1) + ') curR=' + z.curR : 'null');
  ai.followOrder(squad, 0.05);
  const lastWp = ai.path[ai.path.length - 1];
  report('④-1b followOrder 最高优先级走圈内目标（路径终点在圈内）', !!lastWp && U.dist2(lastWp.x, lastWp.z, z.center.x, z.center.z) <= z.curR * z.curR + 2,
    lastWp ? 'path终=(' + lastWp.x.toFixed(1) + ',' + lastWp.z.toFixed(1) + ')' : '无路径');
  // ④-1c 圈内 → zoneDest null
  u.pos.set(z.center.x, 0, z.center.z);
  report('④-1c 圈内 zoneDest=null', ai.zoneDest() === null, '');
  // ④-2 圈外有敌 → engage 不受扰（不进圈、不打断交火）
  // 注意：ai.update 首步 perceive() 会重算 canSee（rayBlocked 实检）——必须摆真实可见敌人
  let enemy = Game.units.find(m => m !== u && m.alive && m.team !== u.team);
  if (!enemy) { enemy = freshUnit(u.pos.x + 12, u.pos.z + 12, 'blue'); }
  u.pos.set(z.center.x + z.curR + 30, 0, z.center.z);
  let placed = false;
  for (const [dx, dz] of [[12, 12], [12, -12], [-12, 12], [-12, -12], [15, 0], [0, 15], [20, 0], [0, 20], [25, 0], [0, 25]]) {
    const px = u.pos.x + dx, pz = u.pos.z + dz;
    if (px < 2 || pz < 2 || px > CFG.WORLD - 2 || pz > CFG.WORLD - 2 || !World.walkable(px, pz)) continue;
    enemy.pos.set(px, 0, pz);
    if (!World.rayBlocked(ai.eyePos(u), new THREE.Vector3(enemy.pos.x, enemy.pos.y + 1, enemy.pos.z))) { placed = true; break; }
  }
  report('④-2 前置：圈外存在可见敌人（LOS 实检）', placed, placed ? 'enemy@(' + enemy.pos.x.toFixed(0) + ',' + enemy.pos.z.toFixed(0) + ')' : '无可视摆位');
  if (placed) {
    ai.target = enemy; ai.canSee = true; ai.state = 'engage'; ai.path = []; ai.fireT = 0.1; ai.lastDmgT = -99; ai.losT = 0;
    const prePath = ai.path.length;
    ai.update(0.05, squad);
    report('④-2 圈外有敌 engage 不受扰（state 保持 engage、不进圈）', ai.state === 'engage' && ai.path.length === prePath,
      'state=' + ai.state + ' path=' + ai.path.length + ' canSee=' + ai.canSee + '（应 engage / 空路径）');
  }
  // ④-3 复活圈外 → 后续 update 目标=进圈（通用 zoneDest 兜底）
  const spawnOut = (World.spawns.red || []).find(s => {
    const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
    return z.isOutside(sx, sz);
  });
  report('④-3a 最终圈下存在圈外出生点（前提）', !!spawnOut, spawnOut ? '出生点圈外' : '无圈外出生点');
  if (spawnOut) {
    const sx = Array.isArray(spawnOut) ? spawnOut[0] : spawnOut.x, sz = Array.isArray(spawnOut) ? spawnOut[1] : spawnOut.z;
    // 本用例只验「无敌人时的进圈优先级」；先把所有敌对单位挪远，避免 perceive 命中后走 engage（设计上 engage 优先）
    for (const e of Game.units) {
      if (e !== u && e.team !== u.team) e.pos.set(10, 0, 10);
    }
    u.pos.set(sx, 0, sz); u.alive = true; ai.reset(); ai.repathT = -1;
    ai.target = null; ai.canSee = false; ai.losT = 999;
    squad.objective = null;
    ai.update(0.05, squad); // 复活后第一帧：应奔圈
    const lw = ai.path[ai.path.length - 1];
    const zdDbg = ai.zoneDest();
    report('④-3b 复活圈外 → 首帧即奔圈内', !!lw && U.dist2(lw.x, lw.z, z.center.x, z.center.z) <= z.curR * z.curR + 2,
      (lw ? 'path终=(' + lw.x.toFixed(1) + ',' + lw.z.toFixed(1) + ')' : '无路径') +
      ' state=' + ai.state + ' canSee=' + ai.canSee + ' pathN=' + ai.path.length +
      ' zd=' + (zdDbg ? '(' + zdDbg.x.toFixed(1) + ',' + zdDbg.z.toFixed(1) + ')' : 'null') +
      ' walkable=' + World.walkable(u.pos.x, u.pos.z) + ' pos=(' + u.pos.x.toFixed(1) + ',' + u.pos.z.toFixed(1) + ')');
  }
}

/* ================================================================
 * ⑤ 视觉：fog:false / 白实线+电蓝虚线 / vignette / 小地图双圈
 * ================================================================ */
console.log('\n=== ⑤ 视觉 ===');
{
  loadMap('suburb');
  const z = Mechanics.zone;
  const ring = z.ring, glow = z.glow, preview = z.preview;
  const ringOk = ring && ring.material && ring.material.fog === false && ring.material.color.getHex() === 0xf0f4f8 && ring.material.opacity === 0.85;
  const glowOk = glow && glow.material && glow.material.fog === false && glow.material.color.getHex() === 0xf0f4f8 && Math.abs(glow.material.opacity - 0.12) < 0.01;
  let prevOk = preview && preview.visible && preview.children.length === 24;
  if (preview && preview.children.length) {
    const m0 = preview.children[0].material;
    prevOk = prevOk && m0.fog === false && m0.color.getHex() === 0x2f7fe8 && Math.abs(m0.opacity - 0.9) < 0.01;
  }
  report('⑤-1 当前圈白实线 0xf0f4f8 opacity0.85 fog:false', ringOk, ring ? 'fog=' + ring.material.fog : '无 ring');
  report('⑤-2 白辉光 0xf0f4f8 opacity0.12 fog:false', glowOk, '');
  report('⑤-3 预告圈电蓝虚线 0x2f7fe8 24弧段 fog:false', prevOk, preview ? '弧段=' + preview.children.length : '无 preview');
  // 最终阶段隐藏预告圈
  fastForwardZone(z, 4);
  report('⑤-3b 最终阶段预告圈隐藏', z.preview.visible === false, 'visible=' + z.preview.visible);
  // 据点环/水塔环/炮击环 fog:false（art §6 顺带修复）
  loadMap('suburb');
  report('⑤-4 据点环 fog:false（沙暴雾不吃据点环）', World.capMeshes.every(m => m.ring.material.fog === false), '');
  loadMap('desert');
  const twRing = (Mechanics.objs || []).find(o => o && o.children && o.children.some(c => c.isMesh && c.geometry && c.geometry.type === 'RingGeometry'));
  const twOk = !!twRing && twRing.children.some(c => c.isMesh && c.geometry.type === 'RingGeometry' && c.material && c.material.fog === false);
  report('⑤-5 水塔环 fog:false', twOk, twRing ? '水塔环存在' : '未找到水塔环');
  // 圈外 vignette：强度随圈外距离 0.12→0.45，圈内 0
  loadMap('suburb');
  const zz = Mechanics.zone;
  const pl = Game.player;
  pl.alive = true; pl.dead = false;
  const vzEl = elements.zoneVignette;
  pl.pos.set(zz.center.x, 0, zz.center.z); zz._updateVignette();
  const inOp = Number(vzEl.style.opacity || 0);
  pl.pos.set(zz.center.x + zz.curR + 30, 0, zz.center.z); zz._updateVignette();
  const midOp = Number(vzEl.style.opacity || 0);
  pl.pos.set(zz.center.x + zz.curR + 120, 0, zz.center.z); zz._updateVignette();
  const farOp = Number(vzEl.style.opacity || 0);
  report('⑤-6 zoneVignette 圈内=0 / 圈外30m∈[0.12,0.45] / 远圈外=0.45',
    inOp === 0 && midOp >= 0.12 && midOp <= 0.45 && farOp === 0.45,
    'in=' + inOp + ' 30m=' + midOp.toFixed(2) + ' 120m=' + farOp);
  // 小地图双圈：白实线当前圈 + 电蓝虚线预告圈，画在据点之前
  {
    const cmds = [];
    const recCtx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { cmds.push(k); return recCtx; }), set: (t, k, v) => { t[k] = v; cmds.push(k + '=' + v); return true; } });
    recCtx.setLineDash = d => { cmds.push('dash=[' + d.join(',') + ']'); };
    elements.mm = fakeEl(); elements.mm.getContext = () => recCtx;
    MiniMap.t = 1; // 保证 draw 执行（8Hz 节流）
    MiniMap.draw();
    const hasWhite = cmds.some(c => c === 'strokeStyle=#f0f4f8');
    const hasBlue = cmds.some(c => c === 'strokeStyle=#2f7fe8');
    const hasDash = cmds.some(c => c === 'dash=[5,4]');
    const whiteIdx = cmds.indexOf('strokeStyle=#f0f4f8');
    const capIdx = cmds.findIndex(c => typeof c === 'string' && c.indexOf('strokeStyle=#') === 0 && c !== 'strokeStyle=#f0f4f8' && c !== 'strokeStyle=#2f7fe8');
    report('⑤-7 小地图双圈（白实线+电蓝虚线[5,4]）', hasWhite && hasBlue && hasDash, '白=' + hasWhite + ' 蓝=' + hasBlue + ' 虚线=' + hasDash);
    report('⑤-7b 圈画在据点之前（最底层）', whiteIdx >= 0 && (capIdx === -1 || whiteIdx < capIdx), '白圈idx=' + whiteIdx + ' 据点idx=' + capIdx);
  }
}

/* ================================================================
 * ⑥ 联机：m_zone 事件注入生效 / 非房主不重复裁决伤害
 * ================================================================ */
console.log('\n=== ⑥ 联机 ===');
{
  loadMap('suburb');
  const z = Mechanics.zone;
  const prevConnected = Net.connected, prevIsHost = Net.isHost;
  Net.connected = true; Net.isHost = false; // 客户端
  Net.handle({ t: 'event', e: { k: 'm_zone', phase: 1, r: 136, from: 220, cx: 150, cz: 150, dmgPerSec: 3 } });
  report('⑥-1 m_zone 事件注入生效（phase/dmg/中心/收缩起点）', z.phaseIdx === 1 && z.dmgPerSec === 3 && z.targetR === 136 && z.shrinking && Math.abs(z._shrinkFrom - 220) < 0.5,
    'phase=' + z.phaseIdx + ' dmg=' + z.dmgPerSec + ' targetR=' + z.targetR + ' shrinkFrom=' + z._shrinkFrom.toFixed(1));
  // 客户端视觉 lerp：1s → curR≈178
  Mechanics.tick(1.0);
  report('⑥-2 客户端本地 lerp 渲染圈（1s→≈178）', Math.abs(z.curR - 178) < 5, 'curR=' + z.curR.toFixed(1));
  // 非房主不裁决伤害：圈外单位 hp 不变
  const u = freshUnit(z.center.x + 240, z.center.z, 'red');
  u.hp = 100; u.armor = 0; z.dmgT = 0.5;
  Mechanics.tick(0.5); Mechanics.tick(0.5);
  report('⑥-3 非房主不重复裁决圈外伤害（hp 不变）', u.hp === 100, 'hp=' + u.hp + '（应 100）');
  const idx = Game.units.indexOf(u); if (idx >= 0) Game.units.splice(idx, 1);
  Net.connected = prevConnected; Net.isHost = prevIsHost;
}

/* ================================================================
 * ⑦ 共存：desert 沙暴双压 / 水塔圈外回血 / suburb 空投炮击
 * ================================================================ */
console.log('\n=== ⑦ 共存 ===');
{
  // ⑦-1 desert：圈外 + 沙暴暴露 = dmgPerSec + exposeDmg 双压
  loadMap('desert');
  const z = Mechanics.zone;
  const mech = Mechanics;
  fastForwardZone(z, 1); // dmgPerSec=3
  Game.phase = 'playing'; // 长时间 fast-forward 可能已判负进 ended；applyDamage 只在 playing 结算
  mech.state.storm = true; mech.state.t = 0; // 强制风暴
  // 找一个圈外且非庇护的空地点（大图 curR 可能接近半张图，不能只往 +x 找）
  let spot = null;
  const W = CFG.WORLD;
  for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    for (const extra of [20, 40, 70, 100, 140]) {
      const px = z.center.x + dir[0] * (z.curR + extra), pz = z.center.z + dir[1] * (z.curR + extra);
      if (px < 8 || pz < 8 || px > W - 8 || pz > W - 8) continue;
      if (World.walkable(px, pz) && !mech._inShelter(px, pz) && z.isOutside(px, pz)) { spot = { x: px, z: pz }; break; }
    }
    if (spot) break;
  }
  report('⑦-1a 找到圈外非庇护测试点（前提）', !!spot, spot ? '(' + spot.x.toFixed(0) + ',' + spot.z.toFixed(0) + ')' : '未找到');
  if (spot) {
    const u = freshUnit(spot.x, spot.z, 'red');
    u.hp = 100; u.armor = 0;
    z.dmgT = 0.5; mech.state.stormTickT = 0.5;
    const hp0 = u.hp;
    // 隔离：只保留被测单位，避免前面测试残留的濒死单位在风暴/圈伤里死亡触发结算 → phase=ended 后伤害被拦
    const savedUnits = Game.units;
    Game.units = [u];
    Game.phase = 'playing';
    Mechanics.tick(0.5); Mechanics.tick(0.5); // 1s：圈 3 + 风暴 4 = 7
    const lost = hp0 - u.hp;
    Game.units = savedUnits;
    Game.phase = 'playing';
    report('⑦-1b 双压 1s ≈ 7HP/s（圈3+沙暴4）', lost >= 5.5 && lost <= 8.5, '1s 损失 ' + lost.toFixed(2) + '（期望≈7，单圈仅3）');
    const idx = Game.units.indexOf(u); if (idx >= 0) Game.units.splice(idx, 1);
  }
  // ⑦-2 desert：水塔回血与圈外伤害解耦（5HP/s）
  fastForwardZone(z, 4); // 最终圈 r66
  Game.phase = 'playing';
  const tw = mech.state.tower;
  tw.progress = 100; tw.owner = 'blue';
  // v2.9 扩图后圈心距塔心 42.8m、塔半径 15m，最终圈 r66 完全罩住水塔 → 「塔边点在圈外」几何上不可达。
  // 临时压圈到 30m 制造圈外条件，验证回血不依赖圈内/外；测完恢复。
  const curRSave = z.curR;
  z.curR = 30;
  // 塔圈边缘点：塔心(152,132) + 向远离圈心方向 9m（r15 内、圈外）
  const tcx = 152, tcz = 132;
  const dirX = (tcx - z.center.x), dirZ = (tcz - z.center.z);
  const nd = Math.hypot(dirX, dirZ) || 1;
  const px = tcx + dirX / nd * 9, pz = tcz + dirZ / nd * 9;
  report('⑦-2a 塔边点圈外判定（前提）', z.isOutside(px, pz) && U.dist2(px, pz, tcx, tcz) <= tw.r * tw.r,
    '(' + px.toFixed(1) + ',' + pz.toFixed(1) + ') distC=' + Math.hypot(px - z.center.x, pz - z.center.z).toFixed(1) + ' curR=' + z.curR.toFixed(1));
  const zDmgSave = z.dmgPerSec;
  z.dmgPerSec = 0; // 隔离回血（仅测水塔；圈伤速率已在③逐档验证）
  const u2 = new Unit('blue', { x: px, y: 0, z: pz, weapon: 'rifle' });
  u2.alive = true; u2.hp = 50; u2.armor = 0; Game.units.push(u2);
  mech.state.towerTickT = 0.5;
  const hpB = u2.hp;
  Mechanics.tick(0.5); Mechanics.tick(0.5);
  const healed = u2.hp - hpB;
  report('⑦-2b 水塔回血圈外仍生效（≈5HP/s）', healed >= 3 && healed <= 8, '圈外回血 +' + healed.toFixed(1) + 'HP/1s（设计 5HP/s）');
  z.dmgPerSec = zDmgSave;
  z.curR = curRSave;
  const i2 = Game.units.indexOf(u2); if (i2 >= 0) Game.units.splice(i2, 1);
  mech.state.storm = false;
  // ⑦-3 suburb：空投/炮击在缩圈下不回归
  loadMap('suburb');
  const zz = Mechanics.zone;
  report('⑦-3a suburb zone 与 airdrop 共存（两者激活）', zz.active && Mechanics.kind === 'airdrop', 'zone=' + zz.active + ' kind=' + Mechanics.kind);
  const s = Mechanics.state, pt = s.dropPts[0];
  Mechanics._spawnCrate(pt.x, pt.z, World.heightAt(pt.x, pt.z));
  s.crates[s.crates.length - 1].landed = true;
  Game.player.pos.set(pt.x, 0, pt.z); Game.player.alive = true; Game.player.hp = 40; Game.dead = false;
  const picked = Mechanics.dispatch('interact');
  report('⑦-3b 缩圈下空投可落箱拾取', picked === true && s.crates.length === 0 && Game.player.hp > 40, 'picked=' + picked + ' hp=' + Game.player.hp.toFixed(0));
}

/* ================================================================
 * ⑧ 容错：缺 zone / 空 phases / center 缺字段
 * ================================================================ */
console.log('\n=== ⑧ 容错 ===');
{
  const M = cfg => Mechanics.init(Object.assign({ id: '_notest', name: '容错测试', mechanics: { type: 'searchlight' } }, cfg || {}));
  M({ zone: null });
  report('⑧-1 zone=null 不开圈', !Mechanics.zone.active, 'active=' + Mechanics.zone.active);
  M({ zone: { center: { x: 150, z: 150 }, phases: [] } });
  report('⑧-2 phases=[] 不开圈', !Mechanics.zone.active, 'active=' + Mechanics.zone.active);
  M({ zone: { center: {}, phases: [{ atSec: 0, r: 100, dmgPerSec: 2 }] } });
  report('⑧-3 center 缺字段自动补地图中心', Mechanics.zone.active && Math.abs(Mechanics.zone.center.x - CFG.WORLD / 2) < 1,
    'active=' + Mechanics.zone.active + ' center=(' + Mechanics.zone.center.x.toFixed(0) + ',' + Mechanics.zone.center.z.toFixed(0) + ')');
}

console.log('\n===== _qa_v13_zone 结果: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
process.exit(0);
