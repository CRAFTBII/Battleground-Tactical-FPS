// QA v1.2 re-gate · port 夜港 —— 探照灯+断电（修复批复验：抢修/数值/环境光/按队冷却）
'use strict';
const S = require('./_qa_v12_stub');
const { loadMap, report, finish } = S;

const def = loadMap('port');
if (!def) { finish(); return; }
Game.startSingle(); Game.phase = 'playing';
const M = Mechanics;
const amb = World.objects.find(o => o && o.isAmbientLight);
const fresh = () => { M.state.power = true; M.state.offT = 0; M.state.teamCool = { blue: 0, red: 0 }; };

/* ---------- 0. 机制初始化 + 数值对齐设计（§2.2/§5：断电 30s / 冷却 45s） ---------- */
report('port kind=searchlight', M.kind === 'searchlight', 'kind=' + M.kind);
report('port 4 灯 + 2 配电箱', M.state && M.state.lights.length === 4 && M.state.powerPanels.length === 2,
  'lights=' + (M.state ? M.state.lights.length : 0) + ' panels=' + (M.state ? M.state.powerPanels.length : 0));
report('断电时长 offSec=30（设计§5）', M._pwrOffSec === 30, 'offSec=' + M._pwrOffSec);
report('断电/抢修冷却 coolSec=45（设计§5）', M._pwrCoolSec === 45, 'coolSec=' + M._pwrCoolSec);

/* ---------- 1. 曝露 + 断电主链路（回归） ---------- */
const pl = Game.player;
const l1 = M.state.lights[0];
const dirX = Math.sin(l1.center), dirZ = Math.cos(l1.center);
pl.pos.set(l1.x + dirX * 30, 0, l1.z + dirZ * 30);
pl.alive = true; pl.hp = 100; pl.dead = false; Game.dead = false;
M.exposedIds.clear(); M.marks.length = 0;
M.tick(0.1);
report('曝露：锥内单位被标记', M.isExposed(pl), 'exposed=' + M.isExposed(pl));
report('曝露：小地图黄点(#ffd166)', M.marks.some(m => m.color === '#ffd166'), 'marks=' + M.marks.length);
const panel0 = M.state.powerPanels[0], panel1 = M.state.powerPanels[1];
fresh(); pl.team = 'blue'; pl.pos.set(panel0.x, 0, panel0.z);
const retOff = M.dispatch('interact');
report('E 断电成功（30s）', retOff === true && M.state.power === false && M.state.offT === 30,
  'ret=' + retOff + ' power=' + M.state.power + ' offT=' + M.state.offT);
report('断电方入队冷却 45s', M.state.teamCool.blue === 45, 'teamCool.blue=' + M.state.teamCool.blue);
M.tick(0.1);
report('断电后光锥隐藏', M.state.lights.every(l => l.cone.visible === false), 'cones=' + M.state.lights.map(l => l.cone.visible).join(','));
report('断电环境光 0.46→0.32（美术 P1，≥0.30 红线）', amb && Math.abs(amb.intensity - 0.32) < 0.01 && amb.intensity >= 0.30,
  'ambient=' + (amb ? amb.intensity.toFixed(2) : 'n/a'));

/* ---------- 2. 抢修路径（修复项 MAJOR-1）+ 按队冷却 ---------- */
// 2a. 断电方（蓝）队冷却 45s 内不能再按 E（设计 rule3「防同队反复开关」，反制由对方承担）
pl.pos.set(panel1.x, 0, panel1.z);
const retSelfBlocked = M.dispatch('interact');
report('断电方在自身队冷却内不能再按 E（防反复开关）', retSelfBlocked === false && M.state.power === false,
  'ret=' + retSelfBlocked + ' power=' + M.state.power + ' cool.blue=' + M.state.teamCool.blue);
// 2b. 红方（未冷却）抢修 → 恢复供电 + 红入冷却 45 + 环境光恢复
pl.team = 'red'; pl.pos.set(panel1.x, 0, panel1.z);
const retRed = M.dispatch('interact');
report('对方队抢修恢复供电（MAJOR-1 修复）+ 红入冷却45', retRed === true && M.state.power === true && M.state.teamCool.red === 45,
  'ret=' + retRed + ' power=' + M.state.power + ' teamCool.red=' + M.state.teamCool.red);
report('抢修后环境光恢复 0.32→0.46', amb && Math.abs(amb.intensity - 0.46) < 0.01, 'ambient=' + (amb ? amb.intensity.toFixed(2) : 'n/a'));
pl.team = 'blue';
// 2c. 双方同冷却（蓝 45 / 红 45）→ 双方再按 E 均被拒
pl.team = 'blue'; pl.pos.set(panel0.x, 0, panel0.z);
const retBlueCool = M.dispatch('interact');
pl.team = 'red'; pl.pos.set(panel1.x, 0, panel1.z);
const retRedCool = M.dispatch('interact');
pl.team = 'blue';
report('冷却按队计（双方冷却期 E 均被拒，供电保持）', retBlueCool === false && retRedCool === false && M.state.power === true,
  'blue=' + retBlueCool + ' red=' + retRedCool + ' power=' + M.state.power + ' cool blue=' + M.state.teamCool.blue.toFixed(1) + ' red=' + M.state.teamCool.red.toFixed(1));

/* ---------- 3. 冷却状态机 + 30s 自动恢复 + 断电安全 ---------- */
fresh(); pl.team = 'blue'; pl.pos.set(panel0.x, 0, panel0.z);
M.dispatch('interact'); // 断电 offT=30, cool.blue=45
for (let i = 0; i < 3500 && M.state.power === false; i++) M.tick(0.01); // 30s + 余量
report('断电 30s 后自动恢复供电', M.state.power === true, 'power=' + M.state.power + ' offT=' + M.state.offT.toFixed(3));
report('断电期间机制安全（200 tick 无异常）', (function () {
  let threw = false;
  fresh(); pl.team = 'blue'; pl.pos.set(panel0.x, 0, panel0.z);
  M.dispatch('interact');
  try { for (let i = 0; i < 200; i++) M.tick(0.016); } catch (e) { threw = true; }
  return !threw && M.active === true;
})(), 'active=' + M.active);

/* ---------- 4. 机制对象纯视觉（不入 colliders） ---------- */
report('机制对象不入 colliders', !World.colliders.some(c => c && (c.isMesh || c.isGroup)) && M.objs.length === 4,
  'objs=' + M.objs.length + ' colliders=' + World.colliders.length);

finish();
