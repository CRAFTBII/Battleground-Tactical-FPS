// v1.3 无头探针：缩圈引擎（阶段推进/圈外伤害速率/AI 进圈）+ 桥梯落地（BuildingLib 构建 + A* 连通回归）
// 用法：node test/v13-zone-bridge-probe.js [mapId]   （缺省三图全跑）
'use strict';
const fs = require('fs');
const path = require('path');

/* ---- DOM 桩（与 port-density-probe.js 一致） ---- */
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
  createElement: tag => fakeEl(), body: { appendChild: noop }, addEventListener: noop, title: ''
};
global.window = global;
global.location = { hostname: 'localhost' };
global.innerWidth = 1280; global.innerHeight = 720; global.devicePixelRatio = 1;
global.requestAnimationFrame = () => 0; global.cancelAnimationFrame = () => 0;
global.Image = class { set src(v) {} };
global.addEventListener = (t, fn) => { if (t === 'error') return; };

const ROOT = path.join(__dirname, '..');
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE;
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const scripts = ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/touch.js', 'js/weaponAnim.js', 'js/main.js'];
const vm = require('vm');
const failures = [];
for (const f of scripts.slice(1)) {
  try { vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}
/* 去内联：模型改为 HTTP 提供的 .glb，测试同步灌入 AssetLoader */
require('./_harness').preloadSync(ROOT);


try { init(); } catch (e) { failures.push('init 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
// 启动单机对局（生成玩家 + 20 AI），供圈外伤害/AI 进圈断言用；换图不影响 units
try { Game.startSingle(); } catch (e) { failures.push('startSingle 崩溃: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }

function loadMap(id) {
  const def = MapRegistry.get(id);
  if (!def) { failures.push('地图 ' + id + ' 未注册'); return null; }
  World.load(World.scene, def);
  return def;
}

function report(title, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + ' | ' + title + (detail ? ' | ' + detail : ''));
  if (!ok) failures.push(title + (detail ? ' :: ' + detail : ''));
}

/* 推进 zone.elapsed：真实 tick 循环（60Hz），断言阶段推进与警示位 */
function advanceZone(zone, targetSec) {
  const dt = 1 / 60;
  let guard = 0;
  while (zone.elapsed < targetSec && guard++ < targetSec * 60 + 240) Mechanics.tick(dt);
}

const MAIN_STREETS = {
  suburb: [{ n: '南北干道', a: [150, 4], b: [150, 296] }, { n: '东西干道', a: [4, 150], b: [296, 150] }],
  port:   [{ n: '纵主街', a: [130, 4], b: [130, 256] }, { n: '横主街', a: [4, 130], b: [256, 130] }],
  desert: [{ n: '纵主道', a: [170, 4], b: [170, 336] }, { n: '横主道', a: [4, 170], b: [336, 170] }]
};

(function run() {
  const only = process.argv[2];
  const ids = only ? [only] : ['suburb', 'port', 'desert'];

  for (const id of ids) {
    console.log('\n===== 地图 ' + id + ' =====');
    const def = loadMap(id);
    if (!def) continue;
    report(id + ' 加载', World.colliders.length > 0,
      'colliders=' + World.colliders.length + ' platforms=' + World.platforms.length + ' buildings=' + (def.buildings || []).length);

    /* ---- ① zone 激活（真实数据容错读取） ---- */
    const z = Mechanics.zone;
    const zDef = def.zone;
    report('zone 配置存在', !!zDef, zDef ? 'phases=' + (zDef.phases || []).length + ' warnSec=' + zDef.warnSec + ' color=#' + (zDef.color || 0).toString(16) : '');
    if (zDef) {
      report('zone 引擎激活', z.active && z.phases.length === zDef.phases.length,
        'active=' + z.active + ' phases=' + z.phases.length + ' 初始r=' + z.curR.toFixed(1) + ' dmg=' + z.dmgPerSec);
      // 初始阶段伤害=phases[0]
      report('zone 初始伤害对齐', z.dmgPerSec === zDef.phases[0].dmgPerSec,
        '引擎=' + z.dmgPerSec + ' 数据=' + zDef.phases[0].dmgPerSec);
      report('zone 开局全图在圈内', z.curR >= Math.sqrt(2) * def.size / 2,
        'r=' + z.curR.toFixed(1) + ' 对角=' + (Math.sqrt(2) * def.size / 2).toFixed(1) + '（首圈覆盖全图，无出生即圈外）');

      /* ---- ② 阶段推进 + warnSec 警示 ---- */
      advanceZone(z, zDef.phases[1].atSec + z.shrinkSec + 0.5); // 推进过阶段1（含 2s 收缩）
      report('zone 阶段推进到 phase1', z.phaseIdx >= 1 && z.elapsed >= zDef.phases[1].atSec,
        'phaseIdx=' + z.phaseIdx + ' elapsed=' + z.elapsed.toFixed(1));
      report('zone 伤害递增到阶段1', z.dmgPerSec === zDef.phases[1].dmgPerSec,
        '引擎=' + z.dmgPerSec + ' 数据=' + zDef.phases[1].dmgPerSec);
      report('zone 收缩完成（curR=目标r）', Math.abs(z.curR - zDef.phases[1].r) < 0.5 && !z.shrinking,
        'curR=' + z.curR.toFixed(1) + ' 目标=' + zDef.phases[1].r);

      /* ---- ③ 圈外伤害速率（吸取水塔 150HP/s 教训：校验速率与阶段，非"有伤害就行"） ---- */
      const u = Game.units.find(x => x.alive) || Game.units[0];
      if (u) {
        // 隔离既有机制干扰：desert 沙暴暴露伤害（4HP/s）会叠加在 zone 圈外伤害上
        // （设计注释"圈外+风暴暴露双压"——此处只测 zone 单项速率）
        const savedStorm = Mechanics.state ? Mechanics.state.storm : null;
        if (Mechanics.state && Mechanics.state.storm !== undefined) Mechanics.state.storm = false;
        const cx = z.center.x, cz = z.center.z;
        const far = { x: cx + z.curR + 10, z: cz }; // 圈外 10m
        u.pos.x = far.x; u.pos.z = far.z; u.hp = 100; u.armor = 0;
        const hp0 = u.hp;
        Mechanics.tick(0.5); Mechanics.tick(0.5); // 1s（2Hz × 2）
        const lost = hp0 - u.hp;
        const exp = z.dmgPerSec; // 每秒 = dmgPerSec
        report('zone 圈外伤害速率 ' + exp + 'HP/s', lost >= exp * 0.75 && lost <= exp * 1.25,
          '1s 损失 ' + lost.toFixed(1) + '（期望 ≈' + exp + '）' + (u.armor ? ' 护甲 ' + u.armor.toFixed(1) : ''));
        if (Mechanics.state && Mechanics.state.storm !== undefined) Mechanics.state.storm = savedStorm;
      } else report('zone 圈外伤害（无单位可测）', false, 'Game.units 为空');

      /* ---- ④ AI 进圈目标修正 ---- */
      const aiU = Game.units.find(x => x.ai) || null;
      if (aiU) {
        aiU.pos.x = z.center.x + z.curR + 12; aiU.pos.z = z.center.z; // 圈外
        const outD = aiU.ai.zoneDest();
        report('AI 圈外 zoneDest 非空且指向圈内', !!outD && U.dist2(outD.x, outD.z, z.center.x, z.center.z) <= z.curR * z.curR,
          outD ? '目标(' + outD.x.toFixed(1) + ',' + outD.z.toFixed(1) + ') 距圈心 ' + Math.sqrt(U.dist2(outD.x, outD.z, z.center.x, z.center.z)).toFixed(1) + ' ≤ r' + z.curR.toFixed(1) : 'null');
        aiU.pos.x = z.center.x; aiU.pos.z = z.center.z; // 圈内
        report('AI 圈内 zoneDest 为 null', aiU.ai.zoneDest() === null, '圈内不进圈');
      } else report('AI 进圈（无 AI 可测）', false, 'Game.units 无 AI');
    }

    /* ---- ⑤ 桥梯落地：BuildingLib 构建（非占位盒） ---- */
    const bridges = (def.buildings || []).filter(b => b.key === 'bridge');
    const stairses = (def.buildings || []).filter(b => b.key === 'stairs');
    report('桥梯已放置', bridges.length >= 1 && stairses.length >= 1,
      'bridge=' + bridges.length + ' stairs=' + stairses.length);
    for (const b of bridges) {
      const bb = BuildingLib.build('bridge', b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
      const ok = bb && bb.mesh && bb.mesh.geometry && bb.mesh.geometry.index && bb.mesh.geometry.attributes.color && (bb.mesh.geometry.index.count / 3) > 12;
      report('bridge(' + b.x + ',' + b.z + ') 内联几何', !!ok, ok ? '三角形 ' + bb.mesh.geometry.index.count / 3 : '占位盒/构建失败');
    }
    for (const b of stairses) {
      const bb = BuildingLib.build('stairs', b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
      const ok = bb && bb.mesh && bb.mesh.geometry && bb.mesh.geometry.index && bb.mesh.geometry.attributes.color && (bb.mesh.geometry.index.count / 3) > 12;
      report('stairs(' + b.x + ',' + b.z + ') 内联几何', !!ok, ok ? '三角形 ' + bb.mesh.geometry.index.count / 3 : '占位盒/构建失败');
    }

    /* ---- ⑥ A* 连通回归（桥/梯不得破坏 2D 地面导航） ---- */
    for (const s of (MAIN_STREETS[id] || [])) {
      const p = findPath(s.a[0], s.a[1], s.b[0], s.b[1]);
      report(s.n + ' 端到端 A* 可通行', Array.isArray(p) && p.length > 0, p && p.length ? '路径 ' + p.length + ' 点' : '无路径');
    }
    const caps = def.capturePoints;
    const spawns = [].concat((def.spawns.blue || []), (def.spawns.red || []));
    let okCnt = 0, failList = [];
    for (const s of spawns) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      for (const c of caps) {
        const p = findPath(sx, sz, c.x, c.z);
        if (p && p.length) okCnt++; else failList.push('出生(' + sx + ',' + sz + ')->' + c.id);
      }
    }
    for (const c of caps) {
      for (const s of spawns) {
        const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
        const p = findPath(c.x, c.z, sx, sz);
        if (p && p.length) okCnt++; else failList.push(c.id + '->出生(' + sx + ',' + sz + ')');
      }
    }
    const total = spawns.length * caps.length * 2;
    report('A* 全连通（出生点×据点 双向，含桥梯）', okCnt === total && failList.length === 0,
      okCnt + '/' + total + ' 条通路' + (failList.length ? ' | 失败: ' + failList.slice(0, 6).join('; ') : ''));
  }

  /* ---- ⑦ 容错：无 zone → 不开圈（向后兼容） ---- */
  const M = cfg => Mechanics.init(Object.assign({ id: '_notest', name: 'no zone', mechanics: { type: 'searchlight' } }, cfg || {}));
  M({ zone: null });
  report('容错：zone=null 不开圈', !Mechanics.zone.active, 'active=' + Mechanics.zone.active);
  M({ zone: { center: { x: 150, z: 150 }, phases: [] } });
  report('容错：phases=[] 不开圈', !Mechanics.zone.active, 'active=' + Mechanics.zone.active);
  M({ zone: { center: {}, phases: [{ atSec: 0, r: 100, dmgPerSec: 2 }] } });
  report('容错：center 缺字段自动补中心', Mechanics.zone.active && Math.abs(Mechanics.zone.center.x - CFG.WORLD / 2) < 1,
    'active=' + Mechanics.zone.active + ' center=(' + Mechanics.zone.center.x + ',' + Mechanics.zone.center.z + ')');

  finish();
})();

function finish() {
  console.log('\n===== v1.3 探针结果: ' + (failures.length ? failures.length + ' FAIL' : 'ALL PASS') + ' =====');
  if (failures.length) { failures.forEach(f => console.log(' - ' + f)); process.exit(1); }
  process.exit(0);
}
