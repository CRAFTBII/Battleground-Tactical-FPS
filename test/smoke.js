// 无头冒烟测试：用 DOM/Canvas 桩驱动真实游戏代码（init + 单机开局 + AI 帧 + 手雷爆炸 + 联机状态注入）
'use strict';
const fs = require('fs');

/* ---- DOM 桩 ---- */
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
const failures = [];
global.addEventListener = (t, fn) => { if (t === 'error') return; };
// localStorage 桩（账号系统用）
const lsStore = {};
global.localStorage = {
  getItem: k => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: k => { delete lsStore[k]; }
};

/* ---- 加载 three + 游戏脚本（按 index.html 顺序） ---- */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const scripts = ['libs/three.min.js', 'js/core.js', 'js/audio.js', 'js/textures.js',
  'js/maps/registry.js', 'js/maps/suburb.js', 'js/maps/port.js', 'js/maps/desert.js', 'js/world.js',
  'js/settings.js', 'js/combat.js', 'js/game.js', 'js/ai.js', 'js/ui.js', 'js/accounts.js', 'js/items.js', 'models/soldier_data.js', 'models/weapons_data.js', 'models/buildings_data.js', 'models/buildings_out.js', 'js/models.js', 'js/mechanics.js', 'js/net.js', 'js/main.js'];
const THREE = require(path.join(ROOT, 'libs/three.min.js'));
global.THREE = THREE; // 浏览器里 three 是全局，这里对齐
THREE.WebGLRenderer = class {
  constructor() { this.domElement = fakeEl(); this.shadowMap = { enabled: false, type: 0 }; }
  setPixelRatio() {} setSize() {} render() {}
};
const vm = require('vm');
for (const f of scripts.slice(1)) {
  const fp = path.join(ROOT, f);
  try { vm.runInThisContext(fs.readFileSync(fp, 'utf8'), { filename: f }); }
  catch (e) { failures.push('加载 ' + f + ' 失败: ' + e.message); }
}

/* ---- 1. 初始化 ---- */
try { init(); } catch (e) { failures.push('init 崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
if (typeof init !== 'function') failures.push('init 未定义');
console.log('BATTLEGROUND 全局:', typeof BATTLEGROUND, '| World:', typeof World, '| Game:', typeof Game, '| PC:', typeof PC);
/* ---- 1.1 地图注册断言（T4：三图必须全部注册成功，默认图 = suburb） ---- */
try {
  if (typeof MapRegistry === 'undefined') failures.push('MapRegistry 未定义');
  else {
    console.log('地图注册断言 | ids:', MapRegistry.ids().join(','));
    if (MapRegistry.count() !== 3) failures.push('地图注册数异常: ' + MapRegistry.count() + '（期望 3）');
    if (MapRegistry.defaultId !== 'suburb') failures.push('默认图异常: ' + MapRegistry.defaultId);
    for (const id of ['suburb', 'port', 'desert']) {
      const def = MapRegistry.get(id);
      if (!def) { failures.push('地图 ' + id + ' 未注册'); continue; }
      const verr = MapRegistry.validate(def);
      if (verr) failures.push('地图 ' + id + ' validate 失败: ' + verr);
    }
  }
} catch (e) { failures.push('地图注册断言崩溃: ' + e.message); }

/* ---- 1.2 模型构建断言（防"还是方块人"回归：SOLDIER_DATA 必须能构建出 7 部件） ---- */
try {
  ModelLib.load();
  if (ModelLib.ready && ModelLib.root) {
    let meshN = 0, triN = 0;
    ModelLib.root.traverse(o => { if (o.isMesh) { meshN++; triN += o.geometry.index.count / 3; } });
    console.log('模型断言 | 部件 mesh:', meshN, '| 三角形:', triN, '（期望 7 部件 / 9864 三角形）');
    if (meshN !== 7) failures.push('模型部件数异常: ' + meshN);
    if (triN !== 9864) failures.push('模型三角形数异常: ' + triN);
  } else {
    failures.push('模型构建失败（方块人回退）: ' + ModelLib._err);
  }
} catch (e) { failures.push('模型断言崩溃: ' + e.message); }

/* ---- 1.3 武器模型断言（防"第一人称看不到武器"回归：WEAPONS_DATA → buildWeaponMesh） ---- */
try {
  const wm = ModelLib.buildWeaponMesh('rifle');
  if (!wm || !wm.geometry || !wm.geometry.attributes.position || !wm.geometry.attributes.position.count) {
    failures.push('buildWeaponMesh 失败（WEAPONS_DATA 缺失或解码错误），第一人称无 3D 武器');
  } else {
    console.log('武器断言 | rifle 模型构建成功，顶点', wm.geometry.attributes.position.count, '| 索引', wm.geometry.index ? wm.geometry.index.count : 0);
  }
  const ws = ['pistol', 'sniper', 'shotgun'];
  for (const k of ws) {
    const m = ModelLib.buildWeaponMesh(k);
    if (!m && typeof WEAPONS_DATA !== 'undefined' && WEAPONS_DATA && WEAPONS_DATA[k]) failures.push('武器 ' + k + ' 有数据但构建失败');
    // WEAPONS_DATA 无该键 → 方块 fallback 合法，不视为失败
  }
  // 武器朝向断言：长轴必须对齐 Z（枪管朝前/后），否则第一人称朝向错误
  for (const k of ['rifle', 'pistol', 'shotgun', 'sniper']) {
    const m = ModelLib.buildWeaponMesh(k);
    if (!m) continue;
    m.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(m);
    const size = bb.getSize(new THREE.Vector3());
    if (size.z < size.x || size.z < size.y) failures.push('武器 ' + k + ' 长轴未对齐 Z: ' + size.toArray().map(v => v.toFixed(2)).join('/'));
    else console.log('武器朝向断言 | ' + k + ' 长轴沿 Z（' + size.toArray().map(v => v.toFixed(2)).join('/') + '）✓');
  }
  // 枪口位置断言（弹道/火光起点应距相机 0.7~1.2m，太近=火光贴脸、太远=弹道漂移）
  {
    const wlen = ModelLib.WEAPON_LEN.rifle || 0.6;
    const ml = camera.localToWorld(new THREE.Vector3(0.26, -0.24, -0.5 - wlen / 2 - 0.03));
    const md = ml.distanceTo(camera.position);
    if (md < 0.6 || md > 1.2) failures.push('枪口距离异常: ' + md.toFixed(2) + 'm');
    else console.log('枪口断言 | 步枪枪口距相机 ' + md.toFixed(2) + 'm ✓');
  }
  // 弹道方向断言：相机旋转后 getWorldDirection 必须跟随（防"弹道只有一个方向"）
  {
    camera.rotation.set(0, 0.7, 0); camera.updateMatrixWorld(true);
    const d1 = camera.getWorldDirection(new THREE.Vector3());
    camera.rotation.set(0, -0.7, 0); camera.updateMatrixWorld(true);
    const d2 = camera.getWorldDirection(new THREE.Vector3());
    console.log('弹道调试 | d1(' + d1.toArray().map(v => v.toFixed(2)).join(',') + ') d2(' + d2.toArray().map(v => v.toFixed(2)).join(',') + ')');
    if (Math.abs(d1.x - d2.x) < 0.5) failures.push('弹道方向不跟随相机旋转: d1x=' + d1.x.toFixed(2) + ' d2x=' + d2.x.toFixed(2));
  }
  // 曳光朝向断言：tracer 长轴必须跟随 from→to（防"曳光全部同一方向"）
  {
    FX.tracers.length = 0;
    FX.tracer(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0), 0xffe08a);
    FX.tracer(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10), 0xffe08a);
    const ax1 = new THREE.Vector3(0, 1, 0).applyQuaternion(FX.tracers[0].m.quaternion).normalize();
    const ax2 = new THREE.Vector3(0, 1, 0).applyQuaternion(FX.tracers[1].m.quaternion).normalize();
    console.log('曳光断言 | 朝+X 长轴(' + ax1.toArray().map(v => v.toFixed(2)).join(',') + ') 朝+Z 长轴(' + ax2.toArray().map(v => v.toFixed(2)).join(',') + ')');
    if (Math.abs(ax1.x) < 0.8) failures.push('曳光长轴未跟随方向（X 轴分量 ' + ax1.x.toFixed(2) + '）');
    if (Math.abs(ax2.z) < 0.8) failures.push('曳光长轴未跟随方向（Z 轴分量 ' + ax2.z.toFixed(2) + '）');
    FX.tracers.forEach(t => { FX.scene.remove(t.m); t.m.material.dispose(); });
    FX.tracers.length = 0;
  }
} catch (e) { failures.push('武器断言崩溃: ' + e.message); }

/* ---- 1.4 第一人称挂载断言（buildModels 后 rifle 必须含网格且默认可见） ---- */
try {
  const g = PlayerGun.models && PlayerGun.models.rifle;
  if (!g) {
    failures.push('PlayerGun.models.rifle 不存在（buildModels 未执行？）');
  } else {
    // hasMesh 需递归检查：buildRealWeapon 返回 root > wapanim_inner > [body, bolt] 嵌套结构
    // （models.js:139 设计意图，wapanim_inner 供换弹整体下沉），直接子节点是 Group 不是 Mesh
    let hasMesh = false;
    g.traverse(o => { if (o.isMesh) hasMesh = true; });
    const vis = g.visible;
    console.log('第一人称断言 | rifle children:', g.children.length, '| 含网格(递归):', hasMesh, '| visible:', vis, '| 相机子节点:', camera.children.length);
    if (!hasMesh) failures.push('第一人称 rifle group 无任何网格（ModelLib.buildWeaponMesh 返回 null?）');
  }
  PlayerGun.setCur('rifle');
  if (!PlayerGun.models.rifle.visible) failures.push('setCur(rifle) 后 rifle 仍不可见');
  // 相机必须入场景图（否则第一人称枪永远不渲染）
  if (!scene.children.includes(camera)) failures.push('相机未加入场景图——第一人称枪无法渲染');
  else console.log('相机入场景图断言 | scene.children 含 camera ✓');
  // 开镜动画断言：按住右键 → aimT 上升、枪位置向 aimPos 移动、FOV 缩小；狙击无黑边（scopeOverlay 已移除）
  {
    const phaseBackup = Game.phase;
    Game.phase = 'playing'; // 开镜要求 phase==='playing'
    const g0 = PlayerGun.models.rifle.position.clone();
    PlayerGun.keys = { has: k => k === 'Mouse2' };
    for (let i = 0; i < 40; i++) PlayerGun.update(0.016, PlayerGun.keys, camera);
    if (PlayerGun.aimT < 0.9) failures.push('开镜动画未生效: aimT=' + PlayerGun.aimT.toFixed(2) + '（按住右键应≥0.9）');
    if (Math.abs(camera.fov - WEAPONS.rifle.aimFov) > 3) failures.push('开镜 FOV 未缩至 aimFov: ' + camera.fov.toFixed(1) + '（期望 ' + WEAPONS.rifle.aimFov + '）');
    else console.log('开镜FOV断言 | ' + camera.fov.toFixed(0) + '°（期望 ' + WEAPONS.rifle.aimFov + '°）✓');
    const g1 = PlayerGun.models.rifle.position;
    const moved = g1.distanceTo(g0) > 0.15;
    if (!moved) failures.push('开镜时枪位置未移动（腰射→瞄准位动画失效）');
    if (Math.abs(camera.fov - WEAPONS.rifle.aimFov) > 3) failures.push('开镜 FOV 未缩至 aimFov: ' + camera.fov.toFixed(1) + '（期望 ' + WEAPONS.rifle.aimFov + '）');
    for (let i = 0; i < 40; i++) PlayerGun.update(0.016, { has: () => false }, camera); // 松开收镜
    if (PlayerGun.aimT > 0.2) failures.push('收镜动画未生效: aimT=' + PlayerGun.aimT.toFixed(2) + '（松开应≤0.2）');
    Game.phase = phaseBackup;
    // 狙击开镜隐藏枪（镜内视野，防枪管挡瞄准镜）：切狙击 → 开镜 → visible=false；收镜恢复
    {
      PlayerGun.setCur('sniper');
      Game.phase = 'playing';
      PlayerGun.keys = { has: k => k === 'Mouse2' };
      for (let i = 0; i < 40; i++) PlayerGun.update(0.016, PlayerGun.keys, camera);
      if (PlayerGun.aimT < 0.9) failures.push('狙击开镜未生效: aimT=' + PlayerGun.aimT.toFixed(2));
      if (PlayerGun.models.sniper.visible) failures.push('狙击开镜后枪模型仍可见（应隐藏，防挡瞄准镜）');
      for (let i = 0; i < 40; i++) PlayerGun.update(0.016, { has: () => false }, camera);
      if (!PlayerGun.models.sniper.visible) failures.push('狙击收镜后枪模型未恢复可见');
      PlayerGun.setCur('rifle');
      Game.phase = phaseBackup;
      console.log('狙击镜断言 | 开镜隐藏枪✓ 收镜恢复✓');
    }
    if (PlayerGun.scopeOverlay !== undefined && PlayerGun.scopeOverlay !== null) failures.push('scopeOverlay 黑边遮罩仍存在（狙击镜不应有黑边）');
    else console.log('开镜断言 | aimT 升降✓ 枪位移✓ FOV→' + camera.fov.toFixed(0) + ' 收镜✓ 无黑边✓');
  }
} catch (e) { failures.push('第一人称断言崩溃: ' + e.message); }

/* ---- 1.3 武器模型断言（WEAPONS_DATA → 玩家手里的模型武器） ---- */
try {
  if (typeof WEAPONS_DATA !== 'undefined' && WEAPONS_DATA) {
    const hasModel = ['pistol', 'rifle'].every(k => {
      const m = ModelLib.buildWeaponMesh(k);
      return m && m.geometry && m.geometry.attributes.position && m.geometry.index;
    });
    console.log('武器模型断言 | WEAPONS_DATA 键:', Object.keys(WEAPONS_DATA).join(','), '| pistol/rifle 模型构建:', hasModel ? 'OK' : 'FAIL');
    if (!hasModel) failures.push('武器模型构建失败');
  } else {
    failures.push('WEAPONS_DATA 缺失');
  }
} catch (e) { failures.push('武器断言崩溃: ' + e.message); }

/* ---- 1.5 地形覆盖范围断言（防"只画一个象限"回归） ---- */
try {
  const ter = scene.children.find(o => o.geometry && o.geometry.attributes && o.geometry.attributes.position && o.geometry.type === 'PlaneGeometry');
  if (!ter) failures.push('未找到地形网格');
  else {
    const p = ter.geometry.attributes.position;
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    console.log('地形覆盖断言 | x[' + minX.toFixed(1) + ',' + maxX.toFixed(1) + '] z[' + minZ.toFixed(1) + ',' + maxZ.toFixed(1) + ']（期望 [0,' + CFG.WORLD + ']）');
    if (minX < -0.5 || maxX < CFG.WORLD - 0.5 || minZ < -0.5 || maxZ < CFG.WORLD - 0.5) failures.push('地形未覆盖完整世界: x[' + minX + ',' + maxX + '] z[' + minZ + ',' + maxZ + ']');
  }
} catch (e) { failures.push('地形断言崩溃: ' + e.message); }

/* ---- 2. 单机开局 + 模拟 40 帧 ---- */
try {
  Game.startSingle();
  PC.locked = true; // 假装鼠标锁定，驱动 PC.update
  PC.keys.add('KeyW');
  let fired = 0;
  // v2.6.1/v2.7：出生点随象限+任务变化，跳跃测试与出生点解耦——挪到地图中心开阔区测
  Game.player.pos.set(150, World.heightAt(150, 150), 150);
  const gy0 = World.heightAt(Game.player.pos.x, Game.player.pos.z);
  let maxPlayerY = Game.player.pos.y;
  // 换弹断言（防"UI.reload is not a function"回归）：先打光一弹匣到触发换弹
  PlayerGun.mags.rifle = 0;
  PlayerGun.reload(); // 直接调换弹函数（模拟按 R）
  if (!elements.reloadTag.textContent.includes('换弹中')) failures.push('换弹 UI.reload 未生效：reloadTag = ' + JSON.stringify(elements.reloadTag.textContent));
  for (let i = 0; i < 40; i++) {
    const dt = 0.016;
    // 第 2~12 帧按住空格（跳跃回归测试：此前玩家 y 被 updateVisual 钉死导致跳不起来）
    if (i >= 2 && i <= 12) PC.keys.add('Space'); else PC.keys.delete('Space');
    PC.update(dt); PlayerGun.update(dt, PC.keys, camera); Projectiles.update(dt);
    Game.update(dt); FX.update(dt); MiniMap.draw();
    if (Game.player.pos.y > maxPlayerY) maxPlayerY = Game.player.pos.y;
    if (i === 10) { PlayerGun.tryFire(camera); fired++; }
    if (i === 15) PlayerGun.throwGrenade();
    if (i === 20) PlayerGun.throwSmoke();
    if (i === 25) PlayerGun.melee();
    if (i === 30) Game.toggleMortar();
    // 模拟按 5-8（切消耗品槽）后 update 不能崩（script error 回归：W.aimPos/W.aimFov 裸引用）
    if (i === 32) PlayerGun.setCur('medkit');
    if (i === 33) PlayerGun.setCur('armorkit');
    if (i === 34) PlayerGun.setCur('grenade');
    if (i === 35) PlayerGun.setCur('smoke');
    if (i === 36) PlayerGun.setCur('rifle');
    if (i === 38) { Game.toggleMortar(); Game.fireMortar(); }
  }
  PC.keys.delete('Space');
  // v1.6 迫击炮射程在「发射位」测（后续对讲机断言会把玩家挪到世界角落，落点钳到角落会误报 2.7m 射程过近）
  const mortarDist = Game.mortarTarget ? Math.sqrt(U.dist2(Game.player.pos.x, Game.player.pos.z, Game.mortarTarget.x, Game.mortarTarget.z)) : -1;
  // 对讲机指挥断言：队长/分队/四命令/疾跑
  try {
    const sq = Game.squads.blue;
    if (!sq.leader) failures.push('蓝队无队长');
    else if ((sq.leader.name || '').indexOf('★') < 0) failures.push('队长名牌缺 ★: ' + sq.leader.name);
    if (sq.groups.length !== 3) failures.push('分队数异常: ' + sq.groups.length + '（应 3 组）');
    if (sq.groups.reduce((s, g) => s + g.members.length, 0) !== sq.members.length) failures.push('分队未覆盖全部蓝队AI');
    // attack 命令 → objective 指向红方半场（v2.8 象限出生：红队 Q2(右上 x≥150)∪Q3(左下 z≥150)）
    const redC = Game.squads.red.members;
    sq.command('attack');
    if (!sq.objective) failures.push('attack 命令未设置目标');
    else if (sq.objective.x < 140 && sq.objective.z < 140) failures.push('attack 目标未指向红方半场: x=' + sq.objective.x.toFixed(0) + ' z=' + sq.objective.z.toFixed(0));
    // group 命令 → 目标指向玩家
    sq.command('group');
    if (!sq.objective || Math.abs(sq.objective.x - Game.player.pos.x) > 1) failures.push('group 目标未指向玩家');
    // 疾跑：attack 命令下 AI followOrder 置 sprinting（memberDest 生效）
    sq.command('attack');
    const aiu = sq.members.find(m => m.ai && m !== sq.leader);
    aiu.pos.set(50, 0, 50); aiu.ai.path = []; aiu.ai.repathT = -1;
    aiu.ai.followOrder(sq, 0.05);
    if (!aiu.ai.sprinting) failures.push('AI 进攻未疾跑（sprinting=false）');
    // 验证 memberDest 返回非空（attack 时目标存在）
    const dest = sq.memberDest(aiu);
    if (!dest) failures.push('memberDest 未返回目标');
    // 三小队散开断言：attack 命令下各组目标互不相同（分散到地图各处）
    sq.order = 'free'; sq.orderT = 0; // 清冷却确保重新下发
    sq.command('attack');
    const gtargets = sq.groups.map(g => g.target).filter(t => t);
    const distinct = new Set(gtargets.map(t => Math.round(t.x * 4) + '_' + Math.round(t.z * 4)));
    if (gtargets.length < 2) failures.push('小队目标数不足: ' + gtargets.length);
    if (distinct.size < 2) failures.push('三小队未分散（目标相同）');
    // 占点不加分断言：占领据点 score 不变
    {
      const sc0 = Game.score.blue;
      const cap = Game.caps[0];
      // v2.9 地带变大（z 条带覆盖大区）：出生单位全在条带内会干扰计数 → 清场后单单位占点
      for (const uu of Game.units) if (uu !== Game.player) uu.pos.set(CFG.WORLD - 5, uu.pos.y, CFG.WORLD - 5);
      Game.player.pos.set(CFG.WORLD - 5, Game.player.pos.y, CFG.WORLD - 5);
      cap.progress = 100; cap.owner = null;
      const u0 = Game.units.find(u => u.alive && u.team === 'blue' && u !== Game.player);
      if (u0) { u0.pos.set(cap.x, u0.pos.y, cap.z); }
      Game.updateCaps(0.5);
      if (cap.owner !== 'blue') failures.push('占点判定失败: owner=' + cap.owner);
      if (Game.score.blue !== sc0) failures.push('占领据点仍加分: ' + (Game.score.blue - sc0));
      Game.updateCaps(2.1); // 持续占点产分也移除
      if (Game.score.blue !== sc0) failures.push('持续占点仍产分: ' + (Game.score.blue - sc0));
    }
    // 队长接管：autoT 归零 → leaderTakeover 下令（cmdFrom 记录队长名）
    sq.autoT = 0.01; sq.order = 'free'; sq.orderT = 0;
    sq.update(0.05);
    if (!sq.cmdFrom) failures.push('AI 队长未接管指挥（cmdFrom 为空）');
    else if ((sq.cmdFrom || '').indexOf('★') < 0) failures.push('队长接管缺 ★ 标识: ' + sq.cmdFrom);
    // 躺尸 bug：玩家死亡 → rotation.x≈PI/2 → 复活后必须归零
    const pl = Game.player;
    pl.mesh.grp.rotation.x = Math.PI / 2; // 模拟死亡姿态
    pl.alive = true; pl.dead = false; // 模拟已复活
    pl.setPose();
    if (Math.abs(pl.mesh.grp.rotation.x) > 0.05) failures.push('复活后仍躺尸 rotation.x=' + pl.mesh.grp.rotation.x.toFixed(2));
    // 脚底补偿：GLTF 模型脚底 -0.57 → 活体 setPose 渲染 y = pos.y + 0.57（防半截入土）
    const aiu2 = sq.members.find(m => m.ai);
    if (aiu2) {
      aiu2.usingModel = true; aiu2.modelParts = { legL: { rotation: {} }, legR: { rotation: {} }, armL: { rotation: {} }, armR: { rotation: {} } };
      aiu2.pos.set(100, World.heightAt(100, 100), 100);
      aiu2.alive = true; aiu2.ai.moving = false;
      aiu2.setPose();
      const dy = aiu2.mesh.grp.position.y - aiu2.pos.y;
      if (dy < 0.5) failures.push('模型脚底补偿缺失（渲染y-逻辑y=' + dy.toFixed(2) + '，应≈0.57）');
      aiu2.usingModel = false; aiu2.modelParts = null;
    }
    console.log('对讲机断言 | 队长★ ✓ 3 分队 ✓ 小队分散(' + distinct.size + '目标) ✓ 疾跑 ✓ 队长接管★ ✓ 占点不加分 ✓ 复活复位 ✓ 脚底补偿 ✓');
  } catch (e) { failures.push('对讲机断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }
  console.log('40 帧模拟完成 | 单位数:', Game.units.length, '| 蓝AI:', Game.squads.blue.members.length, '| 红AI:', Game.squads.red.members.length,
    '| 投射物:', Projectiles.list.length, '| 烟雾:', FX.smokes.length, '| 开火次数:', fired);
  console.log('跳跃测试 | 地面高:', gy0.toFixed(2), '| 离地最高:', (maxPlayerY - gy0).toFixed(2), 'm（期望 ≥0.3，新参数≈2.3）');
  // v2.7 任务驱动：单位数跟随任务 teamSize（KILLS=12×2=24 / 其余 20）
  const expUnits = (Game.mission ? Game.mission.teamSize : 10) * 2;
  if (Game.units.length !== expUnits) failures.push('单位数量异常（期望 ' + expUnits + '，任务=' + (Game.mission && Game.mission.id) + '）: ' + Game.units.length);
  // v2.9 据点=3 个地带（A/B/C z 三等分条带）
  if (!Game.caps || Game.caps.length !== 3) failures.push('据点初始化异常（期望 3 地带）: ' + (Game.caps ? Game.caps.length : 'null'));
  if (maxPlayerY - gy0 < 0.3) failures.push('跳跃失败：玩家 y 未离地（被 updateVisual 钉死？）maxY=' + maxPlayerY.toFixed(2));
  // 迫击炮落点断言（第一人称：yaw+仰角 → 落点必须界内且炮管实体存在）
  if (!Game.mortarTarget || Game.mortarTarget.x < 2 || Game.mortarTarget.x > CFG.WORLD - 2 || Game.mortarTarget.z < 2 || Game.mortarTarget.z > CFG.WORLD - 2)
    failures.push('迫击炮落点越界: ' + JSON.stringify(Game.mortarTarget && { x: +Game.mortarTarget.x.toFixed(1), z: +Game.mortarTarget.z.toFixed(1) }));
  if (Game.mortarTarget) {
    const R = mortarDist >= 0 ? mortarDist : Math.sqrt(U.dist2(Game.player.pos.x, Game.player.pos.z, Game.mortarTarget.x, Game.mortarTarget.z));
    console.log('迫击炮断言 | 落点距离 ' + R.toFixed(0) + 'm（仰角 ' + Game.mortarAngle + '°）');
    if (R < 30) failures.push('迫击炮射程过近: ' + R.toFixed(1) + 'm');
  }
} catch (e) { failures.push('对局模拟崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 2.5 投掷物不穿墙断言 ---- */
try {
  // 朝一堵墙正上方的矮处投掷：墙体 AABB 拦截后不应出现在墙的另一侧
  // v2.7 选墙防御：必须是「从近地面竖起」的垂直墙（min.y≤1 且高≥2m，手雷在 y≈0.5 飞行应撞）——
  // 排除屋顶板（y[8,8.5] 手雷在其下正常飞过）与零厚度墙（z[76,76]，外部 world.js 改动产物）
  const wallC = World.colliders.find(c => c.min.y <= 1 && c.max.y >= 2 && c.max.x - c.min.x > 5 && c.max.z - c.min.z > 0.5);
  if (!wallC) {
    console.log('投掷物碰撞断言 | 未找到测试墙（跳过）');
  } else {
    // v2.7 清空残留投射物（前面对局模拟的弹/迫击炮会污染 list[0]，曾导致「终 x=138.3」误报为穿墙）
    Projectiles.list.slice().forEach(p => { if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh); });
    Projectiles.list.length = 0;
    const cx = (wallC.min.x + wallC.max.x) / 2, cz = (wallC.min.z + wallC.max.z) / 2;
    const from = new THREE.Vector3(cx - 2, 0.5, cz), vel = new THREE.Vector3(6, 0.5, 0); // 朝墙飞
    Projectiles.spawn('grenade', from, vel, 'blue', null);
    const g = Projectiles.list[0];
    for (let i = 0; i < 60 && Projectiles.list.includes(g); i++) Projectiles.update(0.016);
    const endX = Projectiles.list.includes(g) ? g.pos.x : cx; // 未爆仍在 → 取手雷自身位置
    if (endX > wallC.max.x + 1) failures.push('手雷穿墙：终 x=' + endX.toFixed(1) + ' 墙 x=' + wallC.max.x.toFixed(1));
    else console.log('投掷物碰撞断言 | 墙 x∈[' + wallC.min.x.toFixed(0) + ',' + wallC.max.x.toFixed(0) + '] 手雷被拦在 x=' + endX.toFixed(1) + ' ✓');
  }
} catch (e) { failures.push('投掷物断言崩溃: ' + e.message); }

/* ---- 3. 手雷/迫击炮爆炸落地 ---- */
try {
  for (let i = 0; i < 200; i++) { Projectiles.update(0.016); Game.update(0.016); }
  console.log('爆炸模拟完成 | 剩余投射物:', Projectiles.list.length, '| 红队分数:', Game.score.red, '| 蓝队分数:', Game.score.blue);
} catch (e) { failures.push('爆炸模拟崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4. 联机状态注入（模拟房主快照） ---- */
try {
  Net.myId = 'me'; Game.player.id = 'me';
  Net.handle({ t: 'states', score: { blue: 3, red: 2 }, time: 500, players: [
    { id: 'me', name: '你', team: 'blue', hp: 80, alive: true, kills: 2, deaths: 0, x: 20, y: 0, z: 20, yaw: 0, weapon: 'rifle' },
    { id: 'p2', name: '队友', team: 'blue', hp: 100, alive: true, kills: 1, deaths: 1, x: 40, y: 0, z: 30, yaw: 1, weapon: 'rifle' }
  ], ai: [
    { id: 'a1', name: '红方AI', team: 'red', hp: 100, alive: true, kills: 0, deaths: 0, x: 150, y: 0, z: 150, yaw: 2, weapon: 'rifle' }
  ] });
  Net.handle({ t: 'event', e: { k: 'kill', a: 'p2', t: 'a1', head: true } });
  Net.handle({ t: 'event', e: { k: 'fire', id: 'a1', w: 'rifle', x: 150, y: 0, z: 150, yaw: 2 } });
  Net.handle({ t: 'event', e: { k: 'incoming', x: 20, z: 20 } });
  Net.handle({ t: 'event', e: { k: 'boom', x: 25, y: 0, z: 25, r: 6 } });
  console.log('联机注入完成 | 单位数:', Game.units.length, '| 玩家hp:', Game.player.hp, '| 击杀播报元素数:', elements.killfeed ? 'ok' : 'n/a');
  const hasRemote = Game.units.some(u => u.id === 'p2');
  if (!hasRemote) failures.push('远端玩家未创建');
} catch (e) { failures.push('联机注入崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.4 物品系统断言（账号仓库 / 死亡不补弹 / 护甲 / 搜刮 / AI 随机） ---- */
try {
  // 账号注册 + 登录 + 仓库持久化
  const reg = Accounts.register('tester', 'pass1234');
  if (!reg.ok) failures.push('账号注册失败: ' + reg.msg);
  if (Accounts.current !== 'tester') failures.push('注册后未自动登录');
  const st = Accounts.storage();
  if (!st || st.ammo.rifle <= 0) failures.push('默认仓库弹药缺失');
  // 仓库持久化（重新 load）
  Accounts.data['tester'].st.ammo.rifle = 55;
  Accounts.save(); Accounts.load();
  if (Accounts.storage().ammo.rifle !== 55) failures.push('仓库持久化失败');
  // 死亡不补弹药：备弹扣光后死亡→重生→备弹仍为死前值（不回满）
  PlayerGun.reserves.rifle = 10; PlayerGun.mags.rifle = 0;
  Game.player.hp = 0; Game.player.alive = false;
  Game.killUnit(Game.player, null, false);
  Game.respawnPlayer();
  if (PlayerGun.reserves.rifle !== 10) failures.push('死亡后弹药被回复: ' + PlayerGun.reserves.rifle + '（应保持死前 10）');
  if (PlayerGun.armor > 30) failures.push('死亡后护甲未降: ' + PlayerGun.armor);
  // 护甲吸收：100 甲吃 100 伤 → 甲扣 60，血扣 40
  const du = new Unit('red', { x: 250, y: 0, z: 250, armor: 100, weapon: 'rifle' });
  Game.units.push(du);
  Game.applyDamage(du, 100, Game.player, false);
  if (Math.abs(du.armor - 40) > 0.01 || Math.abs(du.hp - 60) > 0.01) failures.push('护甲吸收异常: armor=' + du.armor.toFixed(0) + ' hp=' + du.hp.toFixed(0) + '（应 40/60）');
  // v2.3 战利品规则：击倒不产 loot；处决也不产（处决=击杀分，不叠加箱子）；只有流血致死（20s 无人救）才掉箱
  du.ai = { reserveMap: { rifle: 60, pistol: 48, sniper: 15, shotgun: 24 } }; // AI 单位才有 loot
  Game.applyDamage(du, 999, Game.player, false); // 击倒（T1：进入倒地，不结算掉落/击杀）
  if (!du.down) failures.push('击倒未进入倒地状态: life=' + du.life);
  if (du.loot) failures.push('倒地即产 loot（v2.3：倒地不掉箱）');
  Game.applyDamage(du, 999, Game.player, false); // 补枪处决（T2）→ 最终死亡
  if (du.loot) failures.push('v2.3 处决不应当产 loot（只有流血致死才掉箱）');
  if (du.life !== 'dead') failures.push('处决未进入最终死亡: life=' + du.life);
  // 流血致死（队友 20s 没救）→ 产 loot → 可搜刮
  const du2 = new Unit('red', { x: 240, y: 0, z: 240, armor: 50, weapon: 'rifle' });
  du2.ai = { reserveMap: { rifle: 60, pistol: 48, sniper: 15, shotgun: 24 } };
  Game.units.push(du2);
  Game.toDown(du2, null);
  du2.bleedT = 0.01;
  Game.tickDown(0.02);
  if (!du2.loot || !du2.loot.ammo) failures.push('流血致死应产 loot（队友 20s 没救白死）');
  else {
    const before = PlayerGun.reserves.rifle;
    const r = Backpack.lootCorpse(du2);
    if (!r.ok) failures.push('搜刮失败: ' + r.msg);
    if (PlayerGun.reserves.rifle <= before) failures.push('搜刮未增加弹药');
    if (du2.loot !== null) failures.push('搜刮后 loot 未清空');
  }
  // AI 武器随机：spawnAI 生成的单位武器应多样化（角色编成 → 突击步枪+狙击+霰弹，20 个至少 2 种）
  const wset = {};
  const squad = Game.spawnAI('red', 20, []);
  for (const u of squad) wset[u.weapon] = 1;
  const wcount = Object.keys(wset).length;
  if (wcount < 2) failures.push('AI 武器随机不足: ' + wcount + ' 种（spawnAI 应随机分配）');
  console.log('物品系统断言 | 账号✓ 仓库持久化✓ 死亡不补弹✓ 护甲吸收✓ 搜刮✓ AI随机(' + wcount + '种武器)✓');
} catch (e) { failures.push('物品系统断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.45 Hotbar 物品栏断言（掉落/拾取/丢弃/医疗包/AI自愈/滚轮） ---- */
try {
  Items.init();
  Game.phase = 'playing'; Game.player.alive = true; Game.player.dead = false;
  // 掉落生成 + 自动拾取：在玩家脚下 spawn 弹药 → update 一帧 → 备弹增加、实体消失
  Items.list.length = 0;
  const rBefore = PlayerGun.reserves.rifle;
  Items.spawn('ammo', Game.player.pos.x, Game.player.pos.y, Game.player.pos.z, 12, 'rifle');
  Items.update(0.1);
  if (PlayerGun.reserves.rifle !== rBefore + 12) failures.push('弹药自动拾取失败: ' + (PlayerGun.reserves.rifle - rBefore));
  if (Items.list.length !== 0) failures.push('拾取后掉落实体未清除');
  // 医疗包拾取 + 使用回血
  Items.spawn('medkit', Game.player.pos.x, Game.player.pos.y, Game.player.pos.z, 1);
  Items.update(0.1);
  if (PlayerGun.medkits <= 0) failures.push('医疗包拾取失败');
  Game.player.hp = 30;
  PlayerGun.useMedkit();
  if (Game.player.hp !== 80) failures.push('医疗包回血异常: hp=' + Game.player.hp + '（应 80）');
  // Q 丢弃：丢弃步枪弹药 → 实体生成
  Items.list.length = 0;
  const dBefore = PlayerGun.reserves.rifle;
  PlayerGun.cur = 'rifle'; PlayerGun.discard();
  if (Items.list.length === 0) failures.push('Q 丢弃未生成掉落实体');
  if (PlayerGun.reserves.rifle >= dBefore) failures.push('Q 丢弃未扣弹药');
  // 滚轮切槽（非迫击炮）：deltaY>0 → 从 rifle 切到 sniper
  PlayerGun.cur = 'rifle';
  PC.locked = true;
  const wheelEvt = new Event('wheel');
  Object.defineProperty(wheelEvt, 'deltaY', { value: 100 });
  document.dispatchEvent(wheelEvt);
  if (PlayerGun.cur !== 'sniper') failures.push('滚轮切槽失败: ' + PlayerGun.cur);
  // AI 医疗包：低血 + 无视线 → 自动回血
  const hdu = Game.squads.red ? (Game.squads.red.members.find(u => u.ai && u.alive) || null) : null;
  if (hdu && typeof hdu.ai.update === 'function') {
    hdu.hp = 20; hdu.ai.medkits = 5; hdu.ai.canSee = false; hdu.ai.healCd = 0;
    hdu.ai.update(0.05, Game.squads.red);
    if (hdu.hp !== 70) failures.push('AI 医疗包未生效: hp=' + hdu.hp + '（应 70）');
  } else if (!hdu) failures.push('无可测 AI 单位');
  PlayerGun.cur = 'rifle';
  console.log('Hotbar 断言 | 掉落拾取✓ 医疗包回血✓ Q丢弃✓ 滚轮切槽✓ AI自愈✓');
} catch (e) { failures.push('Hotbar 断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.8 AI 弹匣/换弹停顿/捡盒子断言 ---- */
try {
  // ① 弹匣打空停 5s：mag=1 → 打一枪 → reloading=5 → 5.1s 后补满
  const aiUnit = Game.units.find(u => u.ai && u.alive);
  const ab = aiUnit.ai;
  const aw = aiUnit.weapon;
  ab.mag = 1; ab.burst = 1; ab.burstT = 0; ab.fireT = 0; ab.reloading = 0;
  ab.reserveMap[aw] = 60;
  ab.target = aiUnit; // 自瞄避免 null（tryShoot 用 target）
  ab.canSee = true; ab.state = 'engage';
  ab.tryShoot(0.016);
  if (ab.mag !== 0) failures.push('AI 弹匣未消耗: mag=' + ab.mag);
  if (ab.reloading !== 5) failures.push('AI 打空弹匣未停 5s: reloading=' + ab.reloading);
  // 换弹停顿中 tryShoot 不射击（fireT 保持 >0）
  ab.fireT = 0; ab.burst = 1;
  ab.tryShoot(0.016);
  if (ab.mag !== 0) failures.push('换弹停顿中仍开火: mag=' + ab.mag);
  // 5.1s 后补满（先清目标避免补弹后立即开枪）
  ab.reloading = 0.05; ab.target = null; ab.canSee = false;
  ab.update(0.1, Game.squads[aiUnit.team]);
  if (ab.mag !== WEAPONS[aw].mag) failures.push('换弹完成后未补满弹匣: mag=' + ab.mag + ' 应 ' + WEAPONS[aw].mag);

  // ② AI 捡盒子：脚下放盒子 → 拾取 → 备弹/医疗包增加（按实际武器）
  const rb2 = ab.reserveMap[aw] || 0, mb2 = ab.medkits;
  const box = Items.spawnLootbox(aiUnit.pos.x, aiUnit.pos.y, aiUnit.pos.z, { ammo: {}, medkit: 1, armor: 20 });
  box.loot.ammo[aw] = 30;
  ab.lootTarget = box;
  ab.update(0.1, Game.squads[aiUnit.team]);
  if ((ab.reserveMap[aw] || 0) !== rb2 + 30) failures.push('AI 拾取盒子弹药未生效: ' + ((ab.reserveMap[aw] || 0) - rb2));
  if (ab.medkits !== mb2 + 1) failures.push('AI 拾取盒子医疗包未生效');
  if (Items.list.includes(box)) failures.push('AI 拾取后盒子未移除');

  // ③ v2.3 战利品规则：处决不生成箱子/不绑定 lootTarget；流血致死（20s 无人救）才掉箱
  const killer = Game.units.find(u => u.ai && u.alive && u !== aiUnit);
  const victim = aiUnit;
  victim.hp = 1; victim.armor = 50;
  killer.ai.lootTarget = null;
  Items.list.length = 0;
  Game.applyDamage(victim, 999, killer, false); // 击倒
  Game.applyDamage(victim, 999, killer, false); // 补枪处决
  if (killer.ai.lootTarget) failures.push('v2.3 处决不应当绑定战利品盒');
  if (Items.list.some(it => it.type === 'lootbox')) failures.push('v2.3 处决不应当生成箱子');
  // 流血致死：队友 20s 没救 → 掉箱
  const victim2 = Game.units.find(u => u.ai && u.alive && u !== aiUnit && u !== killer);
  if (victim2) {
    Game.toDown(victim2, null);
    victim2.bleedT = 0.01;
    Game.tickDown(0.02);
    if (victim2.life !== 'dead') failures.push('v2.3 流血致死应进入最终死亡');
    if (!Items.list.some(it => it.type === 'lootbox')) failures.push('v2.3 流血致死应生成箱子');
    Items.list.length = 0;
  }
  console.log('AI 战术断言 | 弹匣消耗✓ 打空停5s✓ 换弹补满✓ 拾取盒子✓ 击杀绑定✓');
} catch (e) { failures.push('AI 战术断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.9 潜伏 / 刺刀 / 烟雾链路断言 ---- */
try {
  const pl2 = Game.player;
  // ① 潜伏：Ctrl 按住 → PC.prone=true → 相机降到 0.55m 伏地高度
  PC.locked = true; Game.phase = 'playing';
  pl2.dead = false; pl2.alive = true;
  const camY0 = camera.position.y;
  PC.keys.add('ControlLeft');
  PC.update(0.016);
  if (!PC.prone) failures.push('潜伏未触发: Ctrl 按住 PC.prone 仍 false');
  if (Math.abs(camera.position.y - (pl2.pos.y + 0.55)) > 0.2) failures.push('潜伏相机高度错误: ' + camera.position.y.toFixed(2) + '（应 ' + (pl2.pos.y + 0.55).toFixed(2) + '）');
  PC.keys.delete('ControlLeft');
  PC.update(0.016);
  if (PC.prone) failures.push('松开 Ctrl 后仍潜伏');
  // ② AI 潜伏：低血无视线无药 → prone=true；有敌人 → 站起
  const au2 = Game.units.find(u => u.ai && u.alive);
  const ab2 = au2.ai;
  ab2.medkits = 0; ab2.prone = false; au2.hp = 20; ab2.canSee = false;
  ab2.update(0.016, Game.squads[au2.team]);
  if (!ab2.prone) failures.push('AI 低血潜伏未触发');
  ab2.canSee = true;
  ab2.update(0.016, Game.squads[au2.team]);
  if (ab2.prone) failures.push('AI 发现敌人后未站起');
  // ③ 刺刀：弹匣 0 + 备弹 0 → 左键 tryFire 自动近战（meleeCd 触发）
  PlayerGun.setCur('rifle');
  PlayerGun.mags.rifle = 0; PlayerGun.reserves.rifle = 0;
  PlayerGun.meleeCd = 0;
  PC.locked = true;
  PlayerGun.tryFire(camera);
  if (PlayerGun.meleeCd <= 0) failures.push('刺刀未触发: 无弹无备弹 tryFire 后 meleeCd=' + PlayerGun.meleeCd);
  // 有备弹时无弹 → 换弹而非刺刀
  PlayerGun.reserves.rifle = 30; PlayerGun.meleeCd = 0; PlayerGun.reloading = false;
  PlayerGun.tryFire(camera);
  if (PlayerGun.meleeCd > 0) failures.push('有备弹误触发刺刀');
  // ④ 烟雾链路：throwSmoke → 投掷物生成 → 落地 → 烟云生成
  PlayerGun.smokes = 2; PlayerGun.smokeCd = 0;
  const plN = Projectiles.list.length;
  PlayerGun.throwSmoke();
  const sm = Projectiles.list[plN];
  if (!sm || sm.type !== 'smoke') failures.push('烟雾弹未生成投掷物');
  const fx0 = FX.smokes.length;
  for (let i = 0; i < 120; i++) Projectiles.update(0.016); // 飞行约 2s（fuse 0.9 落地引爆）
  if (FX.smokes.length === fx0) failures.push('烟雾弹未生成烟云（FX.smokes 无增长）');
  else console.log('潜伏/刺刀/烟雾断言 | 潜伏✓ AI潜伏✓ 刺刀✓ 烟雾链✓（烟云 ' + (FX.smokes.length - fx0) + ' 团）');
  // 恢复状态
  PlayerGun.mags.rifle = WEAPONS.rifle.mag; PlayerGun.reserves.rifle = WEAPONS.rifle.reserve;
  Game.phase = 'playing'; PC.locked = false; PC.prone = false;
} catch (e) { failures.push('潜伏/刺刀断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.47 背包/仓库分离断言（Minecraft 式格子） ---- */
try {
  Accounts.load();
  if (Accounts.current !== 'tester') { const r = Accounts.register('tester', 'pass1234'); if (!r.ok) failures.push('账号重注册失败: ' + r.msg); }
  const st = Accounts.storage();
  st.ammo.rifle = 30; st.medkits = 3; PlayerGun.reserves.rifle = 10; PlayerGun.medkits = 2;
  // 转移：背包弹药→仓库（点击步枪弹格）
  UI.transfer('ammo-rifle');
  if (PlayerGun.reserves.rifle !== 0 || st.ammo.rifle !== 40) failures.push('背包→仓库 转移失败: bag=' + PlayerGun.reserves.rifle + ' store=' + st.ammo.rifle + '（应 0/40）');
  // 转移：仓库→背包（再点一次，取 min(store,120)）
  UI.transfer('ammo-rifle');
  if (PlayerGun.reserves.rifle !== 40 || st.ammo.rifle !== 0) failures.push('仓库→背包 转移失败: bag=' + PlayerGun.reserves.rifle + ' store=' + st.ammo.rifle + '（应 40/0）');
  // 120 发/组上限：仓库 150 → 取出 120，仓库剩 30
  st.ammo.rifle = 150; PlayerGun.reserves.rifle = 0;
  UI.transfer('ammo-rifle');
  if (PlayerGun.reserves.rifle !== 120 || st.ammo.rifle !== 30) failures.push('120/组堆叠失败: bag=' + PlayerGun.reserves.rifle + ' store=' + st.ammo.rifle + '（应 120/30）');
  // 医疗包转移：背包 2 个 → 仓库
  UI.transfer('medkit');
  if (PlayerGun.medkits !== 0 || st.medkits !== 5) failures.push('医疗包转移失败: bag=' + PlayerGun.medkits + ' store=' + st.medkits);
  // 全部取出（120 堆叠上限）：先清空背包 → 取出 30（背包 30）→ 再存回测试上限保护
  PlayerGun.reserves.rifle = 0;
  UI.storeTakeAll(true);
  if ((st.ammo.rifle || 0) !== 0 || PlayerGun.reserves.rifle !== 30) failures.push('全部取出异常: bag=' + PlayerGun.reserves.rifle + ' store=' + (st.ammo.rifle || 0) + '（应 30/0）');
  // 背包满 120 时全部取出不超上限（仓库 200 → 背包保持 120，仓库剩 200）
  PlayerGun.reserves.rifle = 120; st.ammo.rifle = 200;
  UI.storeTakeAll(true);
  if (PlayerGun.reserves.rifle > 120) failures.push('全部取出超堆叠上限: ' + PlayerGun.reserves.rifle);
  if ((st.ammo.rifle || 0) !== 200) failures.push('堆叠上限保护异常: 背包满时仓库不应被清空, store=' + st.ammo.rifle);
  // 渲染不崩（DOM 桩：invBag/invStore 是 fakeEl）
  UI.inventory();
  // 护甲包单位统一（个↔个，修复诡异消失）：背包 2 个 → 仓库
  PlayerGun.armorkits = 2; st.armorkits = 0;
  UI.transfer('armorkit');
  if (PlayerGun.armorkits !== 0 || st.armorkits !== 2) failures.push('护甲包转移异常: bag=' + PlayerGun.armorkits + ' store=' + st.armorkits + '（应 0/2）');
  // 手雷消耗（修复 0 也能扔）：0 个时 throwGrenade 不产生投射物
  PlayerGun.grenades = 0; const pr0 = Projectiles.list.length;
  PlayerGun.gCd = 0; PlayerGun.throwGrenade();
  if (Projectiles.list.length > pr0) failures.push('手雷 0 个仍能扔（应消耗检查拦截）');
  PlayerGun.grenades = 2;
  PlayerGun.throwGrenade();
  if (Projectiles.list.length !== pr0 + 1 || PlayerGun.grenades !== 1) failures.push('手雷消耗异常: n=' + PlayerGun.grenades + '（应扔1次剩1）');
  console.log('背包仓库断言 | 分离转移✓ 弹药0/40→40/0✓ 医疗包✓ 全部取出+120上限✓ 护甲包单位✓ 手雷消耗✓ 渲染✓');
} catch (e) { failures.push('背包仓库断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.48 战利品盒断言（PUBG 式：击杀掉一个盒子，含全部 loot，一次拾取） ---- */
try {
  Items.init();
  Game.phase = 'playing'; Game.player.alive = true; Game.player.dead = false;
  Items.list.length = 0;
  // dropForUnit：AI 死亡 → 一个 lootbox 实体（而非散落多个小物品）
  const lbu = Game.units.find(u => u.ai && u.alive);
  if (lbu) {
    lbu.ai.reserveMap = { rifle: 60, pistol: 48, sniper: 15, shotgun: 24 };
    lbu.loot = { ammo: { rifle: 30 }, armor: 40, medkit: 1 };
    Items.dropForUnit(lbu);
    if (Items.list.length !== 1) failures.push('击杀掉落未合成单盒: ' + Items.list.length + ' 个实体（应 1 lootbox）');
    if (Items.list[0] && Items.list[0].type !== 'lootbox') failures.push('掉落类型非 lootbox: ' + Items.list[0].type);
  } else failures.push('无可测 AI 单位（lootbox）');
  // 拾取：一次性获得全部（弹药+护甲+医疗包），实体清除
  const rb = PlayerGun.reserves.rifle, ab = PlayerGun.armor, mb = PlayerGun.medkits;
  if (Items.list.length) {
    Items.pickup(Items.list[0]);
    if (PlayerGun.reserves.rifle !== rb + 30) failures.push('lootbox 弹药未拾取');
    if (PlayerGun.armor < ab) failures.push('lootbox 护甲未拾取（不应减少）');
    if (PlayerGun.medkits !== mb + 1) failures.push('lootbox 医疗包未拾取');
    Items.list.length = 0;
  }
  console.log('战利品盒断言 | 击杀单盒✓ 含全部loot✓ 一次拾取✓');
} catch (e) { failures.push('战利品盒断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.5 长时间战斗性能断言（防"玩一会卡死"回归） ----
 * 强制制造 AI 远距追击（旧 bug：d>30 触发每帧全图 A* ×16 AI → 主线程被拖死） */
try {
  Game.phase = 'playing';
  // 摆位：玩家在西南角，红队 AI 全部拉到东北角，蓝队 AI 留在玩家附近 → 敌人质心在玩家侧 → 红 AI 远距追击
  Game.player.pos.set(30, 0, 30);
  Game.player.alive = true; Game.player.hp = 100; Game.dead = false;
  Game.player.dead = false;
  const reds = Game.squads.red.members, blues = Game.squads.blue.members;
  reds.forEach((u, i) => { u.pos.set(280, 0, 280); u.alive = true; u.hp = 100; if (u.ai) { u.ai.path = []; u.ai.repathT = 0; u.ai.target = null; u.ai.state = 'advance'; } });
  blues.forEach((u, i) => u.pos.set(30 + i * 3, 0, 36));
  const t0 = performance.now();
  let maxFrame = 0, frames = 600;
  for (let i = 0; i < frames; i++) {
    const ft0 = performance.now();
    Game.update(0.016);
    FX.update(0.016);
    const dt = performance.now() - ft0;
    if (dt > maxFrame) maxFrame = dt;
  }
  const avg = (performance.now() - t0) / frames;
  console.log('性能断言 | ' + frames + ' 帧战斗模拟 | 平均 ' + avg.toFixed(2) + 'ms/帧 | 最坏帧 ' + maxFrame.toFixed(1) + 'ms');
  if (avg > 8) failures.push('主线程过载：平均 ' + avg.toFixed(1) + 'ms/帧（AI 每帧 A* 拖死？）');
  if (maxFrame > 80) failures.push('单帧峰值过载：' + maxFrame.toFixed(1) + 'ms（>80ms 用户感知卡顿）');
} catch (e) { failures.push('性能断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.5 狙击镜 SVG 静态断言（防 index.html 丢元素） ---- */
try {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // 狙击镜：分划要素在位
  const need = ['id="scopeSVG"', 'scopeGlow"', 'MIL 1.2', '#00ff4d'];
  for (const n of need) if (!html.includes(n)) failures.push('狙击镜 SVG 缺元素: ' + n);
  // 无黑边无呼吸（用户要求）：mask/breath/breathe 动画必须不存在
  for (const n of ['scopeMask', 'class="breath"', 'breathe']) if (html.includes(n)) failures.push('狙击镜残留已删元素: ' + n);
  console.log('狙击镜 SVG 断言 | 分划在位 + 无黑边无呼吸 ✓');
} catch (e) { failures.push('狙击镜 SVG 断言崩溃: ' + e.message); }

/* ---- 4.6 模型建筑断言（5 栋构建 + 门洞可通行 + 碰撞注册） ---- */
try {
  const bKeys = ['warehouse', 'apartment', 'house', 'watchtower', 'cover'];
  for (const k of bKeys) {
    const b = BuildingLib.build(k, 10, 10, 0);
    if (!b) { failures.push('建筑 ' + k + ' 构建失败'); continue; }
    if (!b.mesh) failures.push('建筑 ' + k + ' 无 mesh');
    if (!b.colliders.length) failures.push('建筑 ' + k + ' 无碰撞盒');
  }
  // 门洞可通行断言：warehouse 卷帘门（x∈[8.6,13.4] 宽 × 高<5.4）处不应有碰撞盒覆盖
  const wh = BuildingLib.build('warehouse', 0, 0, 0);
  const doorBlocked = wh.colliders.some(c =>
    c.min.x < 13.4 && c.max.x > 8.6 &&  // x 与门洞重叠
    c.min.y < 5.4 &&                    // 高度低于门楣
    c.min.z < 0.2 && c.max.z > -0.2     // z 在门所在墙(y=0)附近
  );
  if (doorBlocked) failures.push('warehouse 卷帘门被碰撞盒挡住（应留空 8.6~13.4 × 高5.4）');
  // 建筑数据键检查
  if (typeof BUILDINGS_DATA === 'undefined' || Object.keys(BUILDINGS_DATA).length < 5) failures.push('BUILDINGS_DATA 键数异常: ' + (typeof BUILDINGS_DATA === 'undefined' ? 'undefined' : Object.keys(BUILDINGS_DATA).length));
  console.log('建筑断言 | 5 栋构建 OK + warehouse 卷帘门留空 ✓');
} catch (e) { failures.push('建筑断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.7 精修/碰撞修复断言（D-01/02 上层窗、D-03 ry≠0、D-05 阴影覆盖） ---- */
try {
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  // ① D-01/D-02：多层 proc 建筑上层窗洞不应被墙填死（射线穿窗洞=null，穿墙=命中）
  World.buildBuilding(10, 290, 10, 8, 9, { floors: 3, floorH: 3, windows: 1, doors: [[[4, 6]], [], [], []], wallTex: 'concrete' });
  const throughWindow = World.rayBlocked(v3(10, 4.7, 300), v3(10, 4.7, 280));
  const throughWall = World.rayBlocked(v3(8, 4.7, 300), v3(8, 4.7, 280));
  if (throughWindow !== null) failures.push('D-01 上层窗洞被墙填死（射线应穿过窗洞）');
  if (throughWall === null) failures.push('D-02 上层墙段丢失（射线应被墙挡）');
  console.log('精修断言 D-01/02 | 上层窗洞可穿行 ✓（窗洞不挡 / 墙段挡）');
  // ② D-03：placeModelBuilding 对 ry≠0 建筑绕角点旋转碰撞（用测试 house ry:90 验证机制；
  //    suburb 数据已统一 ry:0，视觉归位压平垫 —— 机制由本断言守护，未来 ry≠0 图可复用）
  World.placeModelBuilding({ type: 'model', key: 'house', x: 30, z: 280, ry: 90, w: 10, d: 8, h: 4.3, trim: false });
  // house 10×8 旋转 +90°（THREE 约定 x'=dz, z'=−dx）绕角点 (30,280) → footprint x[30,38]·z[270,280]
  const inRotated = World.colliders.some(c => 34 > c.min.x && 34 < c.max.x && 276 > c.min.z && 276 < c.max.z && c.max.y > 0.6);
  const inOld = World.colliders.some(c => 34 > c.min.x && 34 < c.max.x && 284 > c.min.z && 284 < c.max.z && c.max.y > 0.6);
  if (!inRotated) failures.push('D-03 ry=90 碰撞未旋转到视觉 footprint（(34,276) 应被挡）');
  if (inOld) failures.push('D-03 ry=90 碰撞旋转错误（(34,284) 不应有碰撞）');
  console.log('精修断言 D-03 | ry=90 建筑视觉/碰撞对齐 ✓（旋转 footprint 命中，旧位无残留）');
  // ③ D-05：阳光阴影相机 extent 覆盖整图
  const sun = World.objects.find(o => o && o.isDirectionalLight);
  if (!sun) failures.push('D-05 场景无 DirectionalLight');
  else {
    const ext = sun.shadow.camera.right;
    if (ext < CFG.WORLD * 0.5) failures.push('D-05 阴影 extent ' + ext + ' 未覆盖地图（< size/2=' + (CFG.WORLD * 0.5) + '）');
    console.log('精修断言 D-05 | 阴影 extent=' + ext + ' 覆盖整图 ✓');
  }
} catch (e) { failures.push('精修断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.8 C1：?detail=off 三图暗腔归零（LOD 逃生舱全图生效） ---- */
try {
  const countCavity = () => {
    let n = 0;
    for (const root of World.objects) root.traverse(o => {
      if (o.isMesh && o.material && o.material.isMeshBasicMaterial && o.material.color && o.material.color.getHex() === 0x0d1014) n++;
    });
    return n;
  };
  const prevSearch = global.location.search || '';
  global.location.search = '?detail=off';
  let bad = 0;
  for (const id of MapRegistry.ids()) {
    World.load(scene, MapRegistry.get(id));
    const n = countCavity();
    if (n !== 0) { bad++; failures.push('C1 ' + id + ' ?detail=off 下暗腔 ' + n + '（应 0，建筑级 detail 反超地图级）'); }
  }
  global.location.search = prevSearch;
  if (!bad) console.log('C1 断言 | ?detail=off 三图暗腔归零 ✓');
} catch (e) { failures.push('C1 断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.9 三图紧凑回归（出生点可走 + A* 全连通 + GLB 回退不抛错） ---- */
try {
  let spawnBlocked = 0, pathFail = 0;
  for (const id of MapRegistry.ids()) {
    try { World.load(scene, MapRegistry.get(id)); }
    catch (e) { failures.push('三图回归 ' + id + ' load 抛错（含 GLB 回退路径）: ' + e.message); continue; }
    for (const t of ['blue', 'red']) for (const s of World.spawns[t]) {
      const px = Array.isArray(s) ? s[0] : s.x, pz = Array.isArray(s) ? s[1] : s.z;
      if (!World.walkable(px, pz)) spawnBlocked++;
      for (const cp of World.capturePoints) {
        const p = findPath(px, pz, cp.x, cp.z);
        // findPath 同格返回 []（已在目标格，world.js 合法语义）；失败也返回 [] → 用同格判定区分
        const sameCell = Math.floor(px / CFG.CELL) === Math.floor(cp.x / CFG.CELL) && Math.floor(pz / CFG.CELL) === Math.floor(cp.z / CFG.CELL);
        if (!sameCell && (!p || !p.length)) pathFail++;
      }
    }
  }
  if (spawnBlocked) failures.push('三图回归出生点不可走 ' + spawnBlocked + ' 个');
  if (pathFail) failures.push('三图回归 A* 连通失败 ' + pathFail + ' 条');
  console.log('三图回归 | 出生点零被堵 ✓ A* ' + (3 * 20 * 3) + ' 路径全连通 ✓ GLB 回退不抛错 ✓');
} catch (e) { failures.push('三图回归崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.10 v1.2：BuildingLib 新增 9 类型（内联管线落地 + 缩放 + 门洞/平台） ---- */
try {
  const NEW_KEYS = ['bunker', 'hangar', 'pillbox', 'tower', 'wall', 'bridge', 'stairs', 'container', 'ruins'];
  if (typeof BUILDINGS_OUT === 'undefined' || !BUILDINGS_OUT) failures.push('BUILDINGS_OUT 缺失（models/buildings_out.js 未加载）');
  else {
    for (const k of NEW_KEYS) if (!BUILDINGS_OUT[k]) failures.push('BUILDINGS_OUT 缺类型 ' + k);
  }
  const status = BuildingLib.status();
  for (const k of NEW_KEYS) if (status[k] !== 'inline') failures.push('BuildingLib.status[' + k + '] = ' + status[k] + '（应 inline）');
  for (const k of ['apartment', 'house', 'warehouse', 'watchtower', 'cover']) if (status[k] !== 'legacy') failures.push('旧类型 ' + k + ' 数据源异常: ' + status[k] + '（应 legacy 不变）');
  // 每类型按地图常见尺寸构建（含缩放），必须产出 mesh + 碰撞
  const dimsOf = { bunker: [10, 8, 3.5], hangar: [20, 14, 5], pillbox: [6, 6, 3.5], tower: [4, 4, 8], wall: [8, 1.5, 2.5], bridge: [30, 7, 10], stairs: [6, 6, 6], container: [6, 6, 5.2], ruins: [10, 8, 4] };
  for (const k of NEW_KEYS) {
    const dd = dimsOf[k];
    const b = BuildingLib.build(k, 0, 0, 0, { w: dd[0], d: dd[1], h: dd[2] });
    if (!b) { failures.push('新类型 ' + k + ' 构建失败'); continue; }
    if (!b.mesh || !b.mesh.geometry || !b.mesh.geometry.attributes.position) failures.push('新类型 ' + k + ' 无网格几何');
    if (!b.colliders || !b.colliders.length) failures.push('新类型 ' + k + ' 无碰撞盒');
    // 缩放校验：所有碰撞盒的并集包围盒 ≈ 摆放 w×d（容差 0.5），高度 ≤ h（组合型/矮型不要求顶满）
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, myy = -1e9, mzz = -1e9;
    for (const c of b.colliders) {
      mnx = Math.min(mnx, c.min.x); mny = Math.min(mny, c.min.y); mnz = Math.min(mnz, c.min.z);
      mxx = Math.max(mxx, c.max.x); myy = Math.max(myy, c.max.y); mzz = Math.max(mzz, c.max.z);
    }
    const uw = mxx - mnx, uh = myy - mny, ud = mzz - mnz;
    if (Math.abs(uw - dd[0]) > 0.5 || Math.abs(ud - dd[1]) > 0.5)
      failures.push('新类型 ' + k + ' 碰撞 footprint 未按 w/d 缩放: 实测 ' + uw.toFixed(1) + 'x' + ud.toFixed(1) + ' 期望 ' + dd[0] + 'x' + dd[1]);
    if (uh > dd[2] + 1.5)
      failures.push('新类型 ' + k + ' 碰撞高度超过摆放 h: ' + uh.toFixed(1) + ' > ' + dd[2] + '（允许护栏/女儿墙 +1.5）');
    if (uh < 0.3) failures.push('新类型 ' + k + ' 碰撞高度异常过矮: ' + uh.toFixed(2));
  }
  // 方向修复校验：bunker 摆放 w10 d8 h3.5 → 视觉几何 y 向高度应 ≈ h(3.5)，z 向深度 ≈ d(8)（不再是侧躺）
  {
    const b = BuildingLib.build('bunker', 0, 0, 0, { w: 10, d: 8, h: 3.5 });
    b.mesh.geometry.computeBoundingBox();
    const bb = b.mesh.geometry.boundingBox;
    const hy = bb.max.y - bb.min.y, hz = Math.abs(bb.max.z - bb.min.z);
    if (Math.abs(hy - 3.5) > 0.5 || Math.abs(hz - 8) > 0.5) failures.push('bunker 朝向/缩放错误: y高=' + hy.toFixed(1) + ' z深=' + hz.toFixed(1) + '（期望 高3.5 深8）');
  }
  console.log('v1.2 建筑断言 | BUILDINGS_OUT ' + NEW_KEYS.length + ' 型内联 + 5 旧型 legacy 不变 + 按 w/d/h 缩放 + 朝向修复 ✓');
} catch (e) { failures.push('v1.2 建筑断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.11 v1.2：机制引擎（注入测试配置；真实地图 mechanics 已在 4.9 回归中随 load 初始化） ---- */
try {
  const M = (cfg, extra) => Mechanics.init(Object.assign({ id: '_mechtest', name: '机制测试', mechanics: cfg }, extra || {}));
  // ① 探照灯：曝露标记 + 断电 + 对侧抢修 + 环境光切换 + 数值 30/45（port 真实图 ambient 0.46）
  {
    World.load(scene, MapRegistry.get('port'));
    const mech = M({ type: 'searchlight', lights: [{ x: 150, z: 150, y: 8, range: 40, halfAngle: 30, yawDeg: 0, sweepDeg: 60, speed: 5 }], powerPanels: [{ x: 130, z: 130, offSec: 0.05, coolSec: 0.05 }], expose: {} });
    const u = Game.units.find(x => x.ai) || Game.player;
    if (!u) failures.push('机制测试无单位');
    else {
      u.pos.set(150, 0, 170); u.alive = true; // 灯正 +Z 方向，锥内
      mech.tick(0.1);
      const exp0 = mech.isExposed(u);
      const marks0 = mech.marks.length;
      u.pos.set(150, 0, 110);
      mech.tick(0.1);
      if (!exp0) failures.push('searchlight 未曝露锥内单位');
      if (marks0 < 1) failures.push('searchlight 未产生小地图标记');
      // 断电：蓝队 E → 灯灭 + 环境光降（art P1）+ offT 生效
      const amb = World.objects.find(o => o && o.isAmbientLight);
      const ambBase = amb ? amb.intensity : 0;
      Game.player.pos.set(130, 0, 130); Game.player.alive = true; Game.player.hp = 100; Game.dead = false;
      const ok = mech.dispatch('interact');
      if (!ok || mech.state.power !== false) failures.push('searchlight 断电交互失败');
      if (amb && Math.abs(amb.intensity - Math.max(0.30, Math.min(ambBase, 0.32))) > 0.01) failures.push('断电环境光未降 ambient=' + amb.intensity.toFixed(2));
      if (mech.isExposed(u)) failures.push('searchlight 断电后仍曝露');
      // 抢修：断电后对侧（红队）到面板 E → 立即恢复供电（设计 §2.2 反制对称）
      Game.player.team = 'red';
      const rep = mech.dispatch('interact');
      Game.player.team = 'blue';
      if (!rep || mech.state.power !== true) failures.push('searchlight 抢修未立即恢复供电');
      if (amb && Math.abs(amb.intensity - ambBase) > 0.01) failures.push('恢复供电环境光未还原 ambient=' + amb.intensity.toFixed(2));
      // 冷却衰减后蓝队再断电 → offSec 到点自动恢复
      for (let i = 0; i < 10; i++) mech.tick(0.02); // 冷却归零
      mech.dispatch('interact');
      for (let i = 0; i < 10 && mech.state.power === false; i++) mech.tick(0.02);
      if (mech.state.power !== true) failures.push('searchlight 断电后未自动恢复');
    }
    // 数值对齐设计 §5：默认断电期 30s、断电/抢修冷却 45s
    {
      const m2 = M({ type: 'searchlight', lights: [], powerPanels: [{ x: 1, z: 1 }] });
      if (m2._pwrOffSec !== 30 || m2._pwrCoolSec !== 45) failures.push('断电数值未对齐设计: offSec=' + m2._pwrOffSec + ' coolSec=' + m2._pwrCoolSec + '（应 30/45）');
    }
    console.log('机制断言① searchlight | 曝露✓ 断电✓ 抢修✓ 环境光✓ 数值30/45✓');
  }
  // ② 沙暴：风暴雾 + 暴露伤害 + 建筑内部庇护 + AI 20m 阈值 + 水塔回血速率 5HP/s
  {
    World.load(scene, MapRegistry.get('desert'));
    const mech = M(
      { type: 'sandstorm', cycle: { stormSec: 0.6, calmSec: 0.6, fadeDur: 0.05 }, fog: { storm: { near: 5, far: 30 }, calm: { near: 100, far: 400 } }, exposeDmg: 4, tower: { x: 60, z: 60, r: 6, healPerSec: 5 } },
      { buildings: [{ type: 'proc', x: 200, z: 200, w: 20, d: 16 }] } // 测试用建筑 footprint（庇护）
    );
    for (let i = 0; i < 45; i++) mech.tick(0.016);
    if (!mech.state.storm) failures.push('sandstorm 未进入风暴期');
    for (let i = 0; i < 8; i++) mech.tick(0.016);
    if (World.scene.fog.near > 50) failures.push('sandstorm 风暴雾未变浓 near=' + World.scene.fog.near.toFixed(1));
    // 暴露伤害：空地（170,170）受伤
    const u = Game.units.find(x => x.ai) || Game.player;
    u.pos.set(170, 0, 170); u.alive = true;
    const hp0 = u.hp;
    for (let i = 0; i < 20; i++) mech.tick(0.016);
    if (u.hp >= hp0) failures.push('sandstorm 暴露者未受伤 hp=' + u.hp.toFixed(1) + ' 初=' + hp0.toFixed(1));
    // 建筑内部庇护：主堡（200,200）内不受灼伤（设计 §3.1「建筑内部=庇护」）
    u.pos.set(200, 0, 200); u.alive = true;
    const hpIn = u.hp;
    for (let i = 0; i < 20; i++) mech.tick(0.016);
    if (u.hp < hpIn) failures.push('sandstorm 建筑内部仍受灼伤 hp=' + u.hp.toFixed(1) + ' 初=' + hpIn.toFixed(1));
    // AI d≤20 不减半：风暴中 5m 目标应能命中（stub random=0.3 < acc≈0.467；若错误减半 0.233 则 miss）
    u.pos.set(170, 0, 170); // 把 a1 移回空地，避免与 AI 目标同点
    // v2.9 修复：目标挪出主堡 (200,200)——建筑 collider 挡射线导致假 miss；且 tgt 不能与 u(170,170) 同点（射线先撞 u）
    const aiU = new Unit('blue', { x: 170, y: 0, z: 165 });
    aiU.ai = new AIBrain(aiU, 'rifle');
    Game.units.push(aiU); aiU.alive = true;
    const tgt = new Unit('red', { x: 178, y: 0, z: 170 }); // 对角位：u(170,170) 不在 aiU→tgt 连线上
    Game.units.push(tgt); tgt.alive = true; tgt.hp = 100;
    aiU.ai.target = tgt; aiU.ai.canSee = true; aiU.ai.state = 'engage';
    aiU.ai.fireT = 0; aiU.ai.burst = 1; aiU.ai.burstT = 0; aiU.ai.dodgeT = 0;
    const origRandom = Math.random;
    Math.random = () => 0.3;
    aiU.ai.tryShoot(0.016);
    Math.random = origRandom;
    if (tgt.hp >= 100) failures.push('风暴 d≤20 AI 命中被错误减半（应命中）');
    // 水塔回血速率：占领态 1s ≈ +5HP（非 150/s；BLOCKER 回归）
    const blue = Game.units.find(x => x.team === 'blue' && x.alive && x !== aiU) || Game.player;
    blue.hp = 40; blue.pos.set(60, 0, 60);
    mech.state.tower.progress = 100; mech.state.tower.owner = 'blue';
    const hpBefore = blue.hp;
    for (let i = 0; i < 62; i++) mech.tick(0.016); // ≈1s
    const healed = blue.hp - hpBefore;
    if (healed < 3 || healed > 12) failures.push('水塔回血速率异常: +' + healed.toFixed(1) + 'HP/s（设计 5HP/s）');
    // 风暴结束恢复雾
    for (let i = 0; i < 10; i++) mech.tick(0.016);
    if (mech.state.storm) failures.push('sandstorm 风暴未结束');
    if (Math.abs(World.scene.fog.near - 100) > 10) failures.push('sandstorm 风暴后雾未恢复 near=' + World.scene.fog.near.toFixed(1) + '（期望≈100）');
    console.log('机制断言② sandstorm | 风暴✓ 雾✓ 灼伤✓ 建筑内部庇护✓ AI 20m阈值✓ 回血5HP/s✓');
  }
  // ③ 空投：定时落箱 + 拾取回血/弹药
  {
    World.load(scene, MapRegistry.get('suburb'));
    const mech = M({ type: 'airdrop', intervalSec: 0.05, drops: [{ x: 150, z: 150 }], crate: { heal: 30, ammoPct: 0.3, fallSec: 0.05 }, arty: { intervalSec: 99, zone: { x: 150, z: 150, r: 6 }, warnSec: 0.05, dmg: 60, radius: 8 } });
    for (let i = 0; i < 10 && mech.state.crates.length === 0; i++) mech.tick(0.016);
    if (!mech.state.crates.length) failures.push('airdrop 未落箱');
    for (let i = 0; i < 10; i++) mech.tick(0.016); // 落地
    const crate = mech.state.crates[0];
    if (!crate || !crate.landed) failures.push('airdrop 箱未落地');
    Game.player.pos.set(150, 0, 150); Game.player.alive = true; Game.player.hp = 50; Game.dead = false;
    const ammo0 = PlayerGun.reserves.rifle;
    const picked = mech.dispatch('interact');
    if (!picked || mech.state.crates.length !== 0) failures.push('airdrop 拾取失败');
    if (Game.player.hp <= 50) failures.push('airdrop 拾取未回血 hp=' + Game.player.hp.toFixed(1));
    if (PlayerGun.reserves.rifle <= ammo0) failures.push('airdrop 拾取未补弹药');
    console.log('机制断言③ airdrop | 落箱✓ 落地✓ 拾取回血/弹药✓');
  }
  // ④ 炮击：警示（8m 圈 + 随机落点）→ 延迟伤害（MAJOR-2 回归）
  {
    World.load(scene, MapRegistry.get('suburb'));
    const mech = M({ type: 'airdrop', intervalSec: 99, drops: [], crate: {}, arty: { intervalSec: 0.01, zone: { x: 150, z: 150, r: 6 }, warnSec: 0.05, dmg: 60, radius: 8 } });
    const u = Game.units.find(x => x.ai) || Game.player;
    u.pos.set(150, 0, 150); u.alive = true;
    const hp0 = u.hp;
    for (let i = 0; i < 6; i++) mech.tick(0.016); // 触发警示
    if (!(mech.state.arty && mech.state.arty.warn)) failures.push('arty 未进入警示期');
    const R = mech.state.arty.radius;
    const w1 = { x: mech.state.arty.warn.x, z: mech.state.arty.warn.z };
    if (Math.abs(w1.x - 150) < 0.01 && Math.abs(w1.z - 150) < 0.01) failures.push('arty 落点未随机（仍固定 center）');
    const ringR = mech.state.arty.ring && mech.state.arty.ring.geometry && mech.state.arty.ring.geometry.parameters ? (mech.state.arty.ring.geometry.parameters.outerRadius || 0) : 0;
    if (Math.abs(ringR - R) > 0.6) failures.push('arty 警示环半径异常: ' + ringR.toFixed(1) + '（应=伤害半径 ' + R + '）');
    if (!mech.marks.some(m => m.color === '#ff4757')) failures.push('arty 无警示标记');
    for (let i = 0; i < 40; i++) mech.tick(0.016); // 警示结束 → 落弹
    if (u.hp >= hp0) failures.push('arty 落弹未造成伤害 hp=' + u.hp.toFixed(1) + ' 初=' + hp0.toFixed(1));
    // 落点随机性：连续多轮应有 ≥2 个不同落点
    const landings = new Set();
    for (let i = 0; i < 120; i++) {
      mech.tick(0.016);
      const a = mech.state.arty;
      if (a.warn) landings.add(Math.round(a.warn.x * 10) + ',' + Math.round(a.warn.z * 10));
    }
    if (landings.size < 2) failures.push('arty 落点未随机（' + landings.size + ' 个唯一落点）');
    console.log('机制断言④ arty | 警示✓ 8m圈✓ 随机落点✓ 延迟伤害✓');
  }
  // ⑤ 容错：未知 type / 缺字段不崩
  {
    M({ type: 'unknown_mechanic', foo: 1 });
    M({ type: 'searchlight' });
    M({ type: 'sandstorm' });
    M({ type: 'airdrop' });
    M(null);
    M({});
    console.log('机制断言⑤ 容错 | 未知 type/缺字段不崩 ✓');
  }
} catch (e) { failures.push('v1.2 机制断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.12 v1.2：三图真实数据机制激活（紧凑断言 ≤3 组） ---- */
try {
  // port：真实 mechanics → searchlight 4 灯 + 2 配电箱
  World.load(scene, MapRegistry.get('port'));
  const p = Mechanics.describe();
  if (Mechanics.kind !== 'searchlight' || p.lights !== 4 || p.panels !== 2)
    failures.push('port 真实机制异常: kind=' + Mechanics.kind + ' lights=' + p.lights + ' panels=' + p.panels);
  // desert：真实 mechanics → sandstorm + 水塔据点
  World.load(scene, MapRegistry.get('desert'));
  if (Mechanics.kind !== 'sandstorm' || !Mechanics.state || !Mechanics.state.tower)
    failures.push('desert 真实机制异常: kind=' + Mechanics.kind + ' tower=' + !!(Mechanics.state && Mechanics.state.tower));
  // suburb：真实 mechanics → airdrop，且真实投放点数据下可落箱+拾取
  World.load(scene, MapRegistry.get('suburb'));
  if (Mechanics.kind !== 'airdrop' || !Mechanics.state || !Mechanics.state.dropPts.length)
    failures.push('suburb 真实机制异常: kind=' + Mechanics.kind);
  else {
    const s = Mechanics.state, pt = s.dropPts[0];
    Mechanics._spawnCrate(pt.x, pt.z, World.heightAt(pt.x, pt.z));
    s.crates[s.crates.length - 1].landed = true;
    Game.player.pos.set(pt.x, 0, pt.z); Game.player.alive = true; Game.player.hp = 40; Game.dead = false;
    const picked = Mechanics.dispatch('interact');
    if (!picked || s.crates.length !== 0) failures.push('suburb 真实空投不可拾取');
    else if (Game.player.hp <= 40) failures.push('suburb 真实空投未回血');
  }
  console.log('v1.2 三图真实机制 | port 4灯2面板✓ desert 沙暴+水塔✓ suburb 空投可拾取✓');
} catch (e) { failures.push('v1.2 三图真实机制断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.13 v1.3：缩圈引擎（阶段推进/伤害递增/圈外速率/AI 进圈/容错） ---- */
try {
  // ① 三图真实 zone 激活（数据契约容错读取）
  const zDefs = ['port', 'desert', 'suburb'].map(id => {
    World.load(scene, MapRegistry.get(id));
    return { id, z: Mechanics.zone, def: MapRegistry.get(id).zone };
  });
  if (!zDefs.every(x => x.def && x.z.active && x.z.phases.length === x.def.phases.length))
    failures.push('v1.3 三图 zone 激活异常: ' + zDefs.map(x => x.id + ':' + (x.z.active ? x.z.phases.length : 'off')).join(' '));
  // ② suburb 阶段推进 + 伤害递增（真实数据：atSec 90 → dmg 1→3, r 220→136, warnSec 5；收缩时长取引擎默认）
  World.load(scene, MapRegistry.get('suburb'));
  const z = Mechanics.zone;
  const dt = 1 / 60; let guard = 0;
  while (z.elapsed < z.phases[1].atSec + z.shrinkSec + 0.5 && guard++ < 15000) Mechanics.tick(dt); // 推进过阶段1（含收缩）
  if (z.phaseIdx < 1 || z.dmgPerSec !== 3)
    failures.push('v1.3 阶段推进/伤害递增异常: phase=' + z.phaseIdx + ' dmg=' + z.dmgPerSec + '（期望 1/3）');
  if (Math.abs(z.curR - z.phases[1].r) > 0.5 || z.shrinking)
    failures.push('v1.3 收缩未到 ' + z.phases[1].r + ': curR=' + z.curR.toFixed(1) + ' shrinking=' + z.shrinking);
  // ③ 圈外伤害速率（suburb 无风暴干扰；单位置于圈外，1s ≈ 3HP — 校验速率非"有伤害就行"）
  const u = Game.units.find(x => x.alive) || Game.player;
  u.pos.x = z.center.x + z.curR + 10; u.pos.z = z.center.z; u.hp = 100; u.armor = 0;
  const hp0 = u.hp;
  Mechanics.tick(0.5); Mechanics.tick(0.5);
  const lost = hp0 - u.hp;
  if (lost < 2.25 || lost > 3.75) failures.push('v1.3 圈外伤害速率异常: 1s 损失 ' + lost + '（期望≈3HP/s）');
  // ④ AI 进圈目标修正：圈外 → zoneDest 指向圈内；圈内 → null
  const aiU = Game.units.find(x => x.ai && typeof x.ai.zoneDest === 'function');
  if (aiU) {
    aiU.pos.x = z.center.x + z.curR + 12; aiU.pos.z = z.center.z;
    const od = aiU.ai.zoneDest();
    if (!od || U.dist2(od.x, od.z, z.center.x, z.center.z) > z.curR * z.curR)
      failures.push('v1.3 AI 圈外未进圈: ' + (od ? '目标出圈' : 'zoneDest=null'));
    aiU.pos.x = z.center.x; aiU.pos.z = z.center.z;
    if (aiU.ai.zoneDest() !== null) failures.push('v1.3 AI 圈内仍触发进圈');
  } else failures.push('v1.3 AI 进圈断言无 AI 单位');
  console.log('v1.3 缩圈 | 三图激活✓ 阶段推进✓ 伤害递增✓ 圈外速率3HP/s✓ AI进圈✓');
} catch (e) { failures.push('v1.3 缩圈断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.14 v1.3：桥梯落地 + A* 连通回归（桥/梯不得破坏 2D 地面导航） ---- */
try {
  const MAIN = {
    suburb: [[150, 4, 150, 296], [4, 150, 296, 150]],
    port: [[130, 4, 130, 256], [4, 130, 256, 130]],
    desert: [[170, 4, 170, 336], [4, 170, 336, 170]]
  };
  for (const id of ['suburb', 'port', 'desert']) {
    const def = MapRegistry.get(id);
    World.load(scene, def);
    // bridge/stairs 内联几何（非占位盒）
    for (const key of ['bridge', 'stairs']) {
      const b = (def.buildings || []).find(x => x.key === key);
      if (!b) { failures.push(id + ' 缺 ' + key + ' 放置'); continue; }
      const bb = BuildingLib.build(key, b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
      if (!bb || !bb.mesh || !bb.mesh.geometry.index || !bb.mesh.geometry.attributes.color || (bb.mesh.geometry.index.count / 3) <= 12)
        failures.push(id + ' ' + key + ' 构建失败/占位盒');
    }
    // 主街端到端 A*
    for (const st of (MAIN[id] || [])) {
      const p = findPath(st[0], st[1], st[2], st[3]);
      if (!p || !p.length) failures.push(id + ' 主街 A* 断裂: (' + st[0] + ',' + st[1] + ')->(' + st[2] + ',' + st[3] + ')');
    }
    // 出生点×据点 双向全连通
    const caps = def.capturePoints, sps = [].concat(def.spawns.blue, def.spawns.red);
    let ok = 0;
    for (const s of sps) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      for (const c of caps) if (findPath(sx, sz, c.x, c.z).length) ok++;
    }
    for (const c of caps) for (const s of sps) {
      const sx = Array.isArray(s) ? s[0] : s.x, sz = Array.isArray(s) ? s[1] : s.z;
      if (findPath(c.x, c.z, sx, sz).length) ok++;
    }
    if (ok !== sps.length * caps.length * 2) failures.push(id + ' A* 连通不足: ' + ok + '/' + (sps.length * caps.length * 2));
  }
  console.log('v1.3 桥梯 | bridge/stairs 内联✓ 三图主街+全连通 A* 回归✓');
} catch (e) { failures.push('v1.3 桥梯断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.15 v1.4：AI 战术实现（ai-tactics.md §1~§7）行为断言（模拟场景真实触发） ---- */
try {
  /* ① 沙暴庇护：风暴期暴露且 12m 内有庇护 → shelterDest 给出最近可走庇护点；非战斗 tacticalDest → shelter */
  {
    World.load(scene, MapRegistry.get('desert'));
    Game.buildCoverPts(); // 换图后刷新掩体点
    const aiU = Game.units.find(x => x.ai && x.alive);
    if (!aiU) failures.push('v1.4 ① 无可用 AI 单位');
    else {
      // v2.9 修复：desert base 地标已重排到 (20,200)，旧测试位 (70,186) 附近无庇护 → 动态取第一个建筑庇护区南侧
      const fp = (Mechanics.state.footprints || []).find(f => f.x1 < CFG.WORLD - 10 && f.z1 < CFG.WORLD - 10);
      if (!fp) failures.push('v1.4 ① desert 无可用庇护区');
      else {
        const bx = (fp.x0 + fp.x1) / 2, bz = fp.z1 + 5;
        aiU.pos.set(bx, World.heightAt(bx, bz), bz); // 庇护区南侧 5m 开阔地（12m 内有庇护）
        Mechanics.state.storm = true;                  // 强制风暴期
        Mechanics.exposedIds.add(aiU.id);
        const sd = aiU.ai.shelterDest();
        if (!sd) failures.push('v1.4 ① 沙暴庇护: shelterDest 返回 null');
        else {
          if (!World.walkable(sd.x, sd.z)) failures.push('v1.4 ① 庇护点不可走 (' + sd.x.toFixed(1) + ',' + sd.z.toFixed(1) + ')');
          if (!Mechanics._inShelter(sd.x, sd.z)) failures.push('v1.4 ① 庇护点不在庇护区');
          if (U.dist2(aiU.pos.x, aiU.pos.z, sd.x, sd.z) > 13 * 13) failures.push('v1.4 ① 庇护点过远');
        }
        aiU.ai.canSee = false; aiU.ai.evadeT = 0; aiU.ai.exposedT = 5;
        const td = aiU.ai.tacticalDest();
        if (!td || td.tag !== 'shelter') failures.push('v1.4 ① tacticalDest 未给 shelter（tag=' + (td && td.tag) + '）');
        Mechanics.state.storm = false;
        Mechanics.exposedIds.delete(aiU.id);
      }
    }
  }

  /* ② 探照灯避光：被曝露 >2s → leaveConeDest 给出对所有灯都不曝露的点；断电 → null；断电推进：手雷窗口放宽 */
  {
    World.load(scene, MapRegistry.get('port'));
    Game.buildCoverPts();
    const aiU = Game.units.find(x => x.ai && x.alive);
    if (!aiU) failures.push('v1.4 ② 无可用 AI 单位');
    else {
      const s = Mechanics.state;
      const realLights = s.lights;
      s.power = true;
      s.lights = [{ x: 130, z: 145, range: 30, halfAngle: 0.6, angle: 0 }]; // 合成光锥朝 +z 罩住 AI
      aiU.pos.set(130, 0, 150);
      Mechanics.exposedIds.add(aiU.id);
      aiU.ai.exposedT = 3;
      const ld = aiU.ai.leaveConeDest();
      if (!ld) failures.push('v1.4 ② 避光: leaveConeDest 返回 null');
      else if (aiU.ai._inAnyCone(ld.x, ld.z, s.lights, 1)) failures.push('v1.4 ② 避光: 目标仍在光锥内 (' + ld.x.toFixed(1) + ',' + ld.z.toFixed(1) + ')');
      s.power = false;
      if (aiU.ai.leaveConeDest() !== null) failures.push('v1.4 ② 避光: 断电时 leaveConeDest 应返回 null');
      // 断电推进：d=7（平时 8~26 窗口外）→ 断电窗口 6~30 内 → 手雷应投出
      s.power = false;
      const eT = { id: 't_pwr_enemy', team: aiU.team === 'blue' ? 'red' : 'blue', alive: true, pos: new THREE.Vector3(130, 0, 143), hp: 100, ai: null, isPlayer: false }; // 7m 远
      aiU.pos.set(130, 0, 150);
      aiU.ai.target = eT; aiU.ai.canSee = true; aiU.ai.grenadeCd = 0; aiU.ai._prevTarget = eT;
      const pBefore = Projectiles.list.filter(p => p.type === 'grenade').length;
      aiU.ai.update(0.016, Game.squads[aiU.team]);
      const pAfter = Projectiles.list.filter(p => p.type === 'grenade').length;
      if (pAfter <= pBefore) failures.push('v1.4 ② 断电推进: 7m 手雷未投出（窗口应放宽 6~30）');
      s.power = true;
      s.lights = realLights;
      Mechanics.exposedIds.delete(aiU.id);
    }
  }

  /* ③ 缩圈边打边退：圈外 engage → retreatInZone 给圈心方向退 5m 可走点；tacticalDest → retreat */
  {
    World.load(scene, MapRegistry.get('desert'));
    Game.buildCoverPts();
    Mechanics.state.storm = false;
    const aiU = Game.units.find(x => x.ai && x.alive);
    if (!aiU) failures.push('v1.4 ③ 无可用 AI 单位');
    else {
      const z = Mechanics.zone;
      z.active = true; z.center = { x: 110, z: 140 }; z.curR = 40;
      aiU.pos.set(240, 0, 220); // 圈外（距中心 ≈152 > 40）
      aiU.hp = 100; aiU.ai.canSee = true; aiU.ai.retreatT = 0; aiU.ai.burst = 0;
      const beforeD = Math.sqrt(U.dist2(aiU.pos.x, aiU.pos.z, 110, 140));
      const rd = aiU.ai.retreatInZone();
      if (!rd) failures.push('v1.4 ③ 边打边退: retreatInZone 返回 null');
      else {
        const afterD = Math.sqrt(U.dist2(rd.x, rd.z, 110, 140));
        const step = Math.sqrt(U.dist2(aiU.pos.x, aiU.pos.z, rd.x, rd.z));
        if (afterD >= beforeD) failures.push('v1.4 ③ 边打边退: 目标未向圈内（' + afterD.toFixed(1) + '>=' + beforeD.toFixed(1) + '）');
        if (step < 4 || step > 6.5) failures.push('v1.4 ③ 边打边退: 步长异常 ' + step.toFixed(1) + 'm');
      }
      const td3 = aiU.ai.tacticalDest();
      if (!td3 || td3.tag !== 'retreat') failures.push('v1.4 ③ tacticalDest 未给 retreat（tag=' + (td3 && td3.tag) + '）');
      z.active = false;
    }
  }

  /* ④ 烟雾掩护：开阔地 + 被敌射界覆盖 + 带烟 → 转点投烟（模拟场景，Math.random 固定触发概率 0.5） */
  {
    World.load(scene, MapRegistry.get('desert'));
    Game.buildCoverPts();
    const sm = Game.units.find(x => x.ai && x.alive);
    if (!sm) failures.push('v1.4 ④ 无可用 AI 单位');
    else {
      const savedUnits = Game.units;
      Projectiles.list = []; // 清掉前面段的烟雾/手雷，保证断言干净
      const eTeam = sm.team === 'blue' ? 'red' : 'blue';
      const fakeMe = { id: 't_smoke_ai', team: sm.team, alive: true, pos: new THREE.Vector3(170, 0, 170), hp: 100, ai: sm.ai, weapon: 'rifle', yaw: 0, vel: new THREE.Vector3() };
      const eEnemy = { id: 't_smoke_enemy', team: eTeam, alive: true, pos: new THREE.Vector3(170, 0, 210), hp: 100, ai: null, isPlayer: false }; // 40m 开阔
      Game.units = [Game.player, fakeMe, eEnemy];
      sm.pos.set(170, 0, 170);
      sm.ai._prevTarget = null; sm.ai.smokes = 1; sm.ai.smokeCd = 0; sm.ai._smokeT = 0;
      sm.ai.target = null; sm.ai.canSee = false; sm.ai.losT = 0; // 清视线节流，强制本帧重算
      const origRandom = Math.random;
      Math.random = () => 0; // 触发概率 0.5 → 必定触发（同时固定 U.rand）
      sm.ai.update(0.016, Game.squads[sm.team]);
      Math.random = origRandom;
      const smokeProj = Projectiles.list.filter(p => p.type === 'smoke');
      if (!smokeProj.length) failures.push('v1.4 ④ 烟雾掩护: 未投出烟雾弹');
      else if (sm.ai.smokes !== 0 || sm.ai.smokeCd <= 0) failures.push('v1.4 ④ 烟雾掩护: 计数/冷却未消耗');
      Game.units = savedUnits;
    }
  }

  /* ⑤ 护甲包：armor<50 且带包 → 用包 +50（不打断对枪）；低血+敌视线 → 撤掩体目标（tacticalDest heal） */
  {
    World.load(scene, MapRegistry.get('suburb'));
    Game.buildCoverPts();
    const aiU = Game.units.find(x => x.ai && x.alive);
    if (!aiU) failures.push('v1.4 ⑤ 无可用 AI 单位');
    else {
      aiU.pos.set(260, 0, 260); // 远端孤立点
      aiU.hp = 100; aiU.armor = 30; aiU.ai.armorkits = 1; aiU.ai.armorCd = 0; aiU.ai.burst = 0;
      aiU.ai.update(0.016, Game.squads[aiU.team]);
      if (aiU.armor < 80) failures.push('v1.4 ⑤ 护甲包未生效: armor=' + aiU.armor + '（期望 ≥80）');
      if (aiU.ai.armorkits !== 0) failures.push('v1.4 ⑤ 护甲包未消耗: armorkits=' + aiU.ai.armorkits);
      // 低血 + 敌视线 + 带医疗包 → tacticalDest 给 heal（撤掩体再用药；8m 无掩体 → 向远离敌视线退 6m）
      const eTeamH = aiU.team === 'blue' ? 'red' : 'blue';
      aiU.hp = 30; aiU.ai.medkits = 2; aiU.ai.healCd = 0; aiU.ai.canSee = true; aiU.ai.burst = 0;
      aiU.ai.target = { id: 't_heal_enemy', team: eTeamH, alive: true, pos: new THREE.Vector3(260, 0, 240), hp: 100, ai: null, isPlayer: false };
      const th = aiU.ai.tacticalDest();
      if (!th || th.tag !== 'heal') failures.push('v1.4 ⑤ 低血撤掩体: tacticalDest 未给 heal（tag=' + (th && th.tag) + '）');
    }
  }

  /* ⑥ 残血优先：多目标评分——残血目标（距离主导 + −12）优先于近距满血；换目标节流 <4 分不换 */
  {
    World.load(scene, MapRegistry.get('desert'));
    Game.buildCoverPts();
    const pr = Game.units.find(x => x.ai && x.alive);
    if (!pr) failures.push('v1.4 ⑥ 无可用 AI 单位');
    else {
      const savedU2 = Game.units;
      const pTeam = pr.team, eTeam2 = pTeam === 'blue' ? 'red' : 'blue';
      pr.pos.set(170, 0, 170);
      const prMe = { id: 't_score_ai', team: pTeam, alive: true, pos: new THREE.Vector3(170, 0, 170), hp: 100, ai: pr.ai, weapon: 'rifle', yaw: 0, vel: new THREE.Vector3() };
      const eNear = { id: 't_near', team: eTeam2, alive: true, pos: new THREE.Vector3(178, 0, 178), hp: 100, ai: null, isPlayer: false }; // d≈11.3, score 11.3
      const eLow = { id: 't_low', team: eTeam2, alive: true, pos: new THREE.Vector3(183, 0, 183), hp: 20, ai: null, isPlayer: false }; // d≈18.4, score 6.4 → 优先
      Game.units = [Game.player, prMe, eNear, eLow];
      pr.ai.target = eNear; pr.ai.losT = 0;
      pr.ai.perceive(0.5);
      if (pr.ai.target !== eLow) failures.push('v1.4 ⑥ 残血优先: 未选残血目标（当前=' + (pr.ai.target && pr.ai.target.id) + '）');
      Game.units = savedU2;
    }
  }
  console.log('v1.4 AI 战术 | 沙暴庇护✓ 避光✓ 断电推进✓ 边打边退✓ 烟雾✓ 护甲✓ 残血优先✓');
} catch (e) { failures.push('v1.4 AI 战术断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 4.16 v1.4：四地标 BuildingLib 注册 + 构建 / 缺数据回退断言 ---- */
try {
  const LM = {
    suburb: { key: 'stadium', x: 180, z: 150, w: 66, d: 66, h: 9.6 },
    port: { key: 'refinery', x: 186, z: 3, w: 20, d: 14, h: 12 },
    desert: [{ key: 'base', x: 60, z: 160, w: 24, d: 18, h: 8 }, { key: 'megatower', x: 250, z: 70, w: 20, d: 20, h: 28 }]
  };
  // ① 每张地图加载后，4 新类型构建为真模型（非占位盒）+ 有碰撞盒
  for (const id of Object.keys(LM)) {
    World.load(scene, MapRegistry.get(id));
    const arr = Array.isArray(LM[id]) ? LM[id] : [LM[id]];
    for (const b of arr) {
      const bb = BuildingLib.build(b.key, b.x, b.z, b.ry || 0, { w: b.w, d: b.d, h: b.h });
      if (!bb || !bb.mesh || !bb.mesh.geometry || !bb.mesh.geometry.index || (bb.mesh.geometry.index.count / 3) <= 12)
        failures.push('v1.4 ' + b.key + ' 构建失败/占位盒');
      else if (!bb.colliders.length) failures.push('v1.4 ' + b.key + ' 无碰撞盒');
      const cfg = BuildingLib.CONFIGS[b.key];
      if (!cfg || !cfg.colliders || !cfg.colliders.length) failures.push('v1.4 ' + b.key + ' CONFIGS 未注册');
    }
  }
  // ② BuildingLib.status() 报告 4 新类型为 inline
  const st = BuildingLib.status();
  for (const k of ['base', 'refinery', 'stadium', 'megatower']) {
    if (st[k] !== 'inline') failures.push('v1.4 ' + k + ' status=' + st[k] + '（期望 inline）');
  }
  // ③ megatower 腿式：底部中心可通行（设计「四腿之间可通行」；全实心盒会堵）
  World.load(scene, MapRegistry.get('desert'));
  if (!World.walkable(262, 82)) failures.push('v1.4 megatower 底部中心应可通行（腿式）');
  if (World.walkable(251, 71)) failures.push('v1.4 megatower 腿位应不可通行（碰撞腿）');
  // ④ 缺数据回退：删除 BUILDINGS_OUT['stadium'] → placeModelBuilding 回退占位盒不崩（安全），恢复后真模型
  {
    const saved = BUILDINGS_OUT['stadium'];
    delete BUILDINGS_OUT['stadium'];
    let ok = true;
    try { World.load(scene, MapRegistry.get('suburb')); } catch (e2) { ok = false; failures.push('v1.4 回退: suburb 加载崩溃 ' + e2.message); }
    if (ok && !World.colliders.some(c => c.min.x < 181 && c.max.x > 205 && c.min.z < 151 && c.max.z > 169))
      failures.push('v1.4 回退: stadium 占位盒碰撞缺失（缺数据时应有 w/d/h 占位碰撞）');
    BUILDINGS_OUT['stadium'] = saved;
    World.load(scene, MapRegistry.get('suburb')); // 恢复后重建
  }
  console.log('v1.4 四地标 | stadium/refinery/base/megatower 构建+CONFIGS✓ 状态 inline✓ 腿式可通行✓ 缺数据回退✓');
} catch (e) { failures.push('v1.4 四地标断言崩溃: ' + e.stack.split('\n').slice(0, 3).join(' | ')); }

/* ---- 5. 结束流程 ---- */
try { Game.endMatch(); console.log('结算流程 OK'); } catch (e) { failures.push('结算崩溃: ' + e.message); }

console.log(failures.length ? '\n=== 冒烟失败 ' + failures.length + ' 项 ===\n' + failures.join('\n') : '\n=== 无头冒烟测试全部通过 ===');
process.exit(failures.length ? 1 : 0);
