// QA v1.2 re-gate · desert 荒漠 —— 沙暴+水塔（修复批复验：回血 5HP/s / footprint+塔圈庇护 / cap 事件 / AI d>20）
'use strict';
const S = require('./_qa_v12_stub');
const { loadMap, report, finish } = S;

const def = loadMap('desert');
if (!def) { finish(); return; }
Game.startSingle(); Game.phase = 'playing';
const M = Mechanics;
const s = M.state;

/* ---------- 0. 数值核对（回归） ---------- */
report('desert kind=sandstorm', M.kind === 'sandstorm', 'kind=' + M.kind);
report('desert 周期 storm30/calm90', s.dur === 30 && s.interval === 90, 'dur=' + s.dur + ' interval=' + s.interval);
report('desert 雾 22/70 ↔ 180/430；exposeDmg=4；水塔 r15 heal5 @(152,132)',
  s.stormFog.near === 22 && s.stormFog.far === 70 && s.calmFog.near === 180 && s.calmFog.far === 430 &&
  s.exposeDmg === 4 && s.tower && s.tower.x === 152 && s.tower.z === 132 && s.tower.r === 15 && s.tower.heal === 5,
  'fog(' + s.stormFog.near + ',' + s.stormFog.far + ') tower r=' + (s.tower ? s.tower.r : 'n/a') + ' heal=' + (s.tower ? s.tower.heal : 'n/a'));

/* ---------- 1. 风暴触发 + 雾 + 灼伤（回归） ---------- */
s.t = s.interval - 0.05; M.tick(0.1);
report('风暴在平静 90s 后触发', s.storm === true, 'storm=' + s.storm);
for (let i = 0; i < 200 && s.fade < 1; i++) M.tick(0.016);
report('风暴雾插值 near≈22 far≈70', Math.abs(World.scene.fog.near - 22) < 5 && Math.abs(World.scene.fog.far - 70) < 8,
  'near=' + World.scene.fog.near.toFixed(1) + ' far=' + World.scene.fog.far.toFixed(1));
function openSpot() {
  for (let x = 10; x < 330; x += 12) for (let z = 10; z < 330; z += 12) {
    if (!World.walkable(x, z)) continue;
    let inCol = false;
    for (const c of World.colliders) {
      if (c.max.y < 1) continue;
      if (x >= c.min.x - 2 && x <= c.max.x + 2 && z >= c.min.z - 2 && z <= c.max.z + 2) { inCol = true; break; }
    }
    if (inCol) continue;
    if (s.tower && Math.sqrt(U.dist2(x, z, s.tower.x, s.tower.z)) < s.tower.r + 2) continue;
    return [x, z];
  }
  return null;
}
const spot = openSpot();
if (!spot) report('找到无建筑空地', false, '未找到');
else {
  const victim = Game.units.find(u => u.ai && u.team === 'red') || Game.units[0];
  victim.pos.set(spot[0], 0, spot[1]); victim.hp = 100; victim.alive = true;
  const scoreBefore = Game.score.red + Game.score.blue;
  for (let i = 0; i < 120; i++) M.tick(0.016);
  report('风暴暴露者受伤（4HP/s）', victim.hp < 99 && victim.hp >= 85, 'hp=' + victim.hp.toFixed(1) + ' @(' + spot[0] + ',' + spot[1] + ')');
  report('环境伤害不归属队伍（比分不变）', Game.score.red + Game.score.blue === scoreBefore, 'score=' + Game.score.red + ':' + Game.score.blue);
}

/* ---------- 2. 庇护（修复项）：建筑 footprint 内部 + 水塔圈 + 边界 0.5m ---------- */
// 2a. 主堡中心（建筑内部）不再裸露
const interiorU = Game.units.find(u => u.ai && u.team === 'blue');
interiorU.pos.set(132, 0, 200); interiorU.hp = 100; interiorU.alive = true;
for (let i = 0; i < 60; i++) M.tick(0.016);
report('建筑 footprint 内部=庇护（修复项）', interiorU.hp === 100, 'hp=' + interiorU.hp.toFixed(1) + ' @D1 中心(132,200)');
// 2b. 水塔圈内=庇护
const ringU = Game.units.find(u => u.ai && u.team === 'red');
ringU.pos.set(158, 0, 132); ringU.hp = 100; ringU.alive = true;
for (let i = 0; i < 60; i++) M.tick(0.016);
report('水塔圈内=庇护（修复项）', ringU.hp === 100, 'hp=' + ringU.hp.toFixed(1) + ' @塔圈(158,132)');
// 2c. 庇护边界 0.5m：footprint 外扩 0.5，边界内≈庇护 / 边界外≈暴露（抽查容差）
{
  const f = s.footprints.find(f => Math.abs(f.x0 - (132 - 14 - 0.5)) < 0.01); // D1 proc 中心132 w28 → x0=117.5
  report('庇护边界 footprint 预计算', !!f, f ? 'D1 x0=' + f.x0.toFixed(2) + '（期望 117.5，外扩 0.5）' : '未找到');
  const inside = M._inShelter(117.6, 200);   // 边界内 0.1m
  const outside = M._inShelter(117.4, 200);  // 边界外 0.1m（退到碰撞体外扩区可能仍庇护 → 取更远点判断）
  report('庇护边界 0.5m：边界内庇护', inside === true, 'inShelter(117.6,200)=' + inside);
  // 边界外：取 footprint 之外且无碰撞体外扩覆盖的点（x=112 距 D1 西墙 117.5-112=5.5 > 2m 外扩）
  const out2 = M._inShelter(112, 200);
  report('庇护边界外暴露（非建筑区）', out2 === false, 'inShelter(112,200)=' + out2);
}

/* ---------- 3. 水塔占领：进度 + cap 事件 + 回血严格 5HP/s（修复项 BLOCKER） ---------- */
{
  // 捕获广播事件
  const events = [];
  const origBc = Net.broadcastEvent;
  Net.broadcastEvent = e => events.push(e);
  // 单蓝占塔推进（12.5s → owner）
  s.storm = false; // 隔离灼伤，专注占领/回血
  const bA = Game.units.find(u => u.ai && u.team === 'blue');
  bA.pos.set(152, 0, 132); bA.hp = 50; bA.alive = true;
  for (const u of Game.units) { if (u !== bA) { u.pos.set(300, 0, 300); u.alive = false; } }
  for (let i = 0; i < 820 && !s.tower.owner; i++) M.tick(0.016); // ~13s
  report('水塔占领推进（单人≈12s）', s.tower.owner === 'blue' && s.tower.progress >= 100,
    'owner=' + s.tower.owner + ' progress=' + (s.tower.progress || 0).toFixed(1));
  report('水塔易主广播 {k:\'cap\', id:\'tower\'}', events.some(e => e.k === 'cap' && e.id === 'tower'),
    'events=' + events.filter(e => e.k === 'cap').map(e => e.k + ':' + e.id).join(','));
  // 回血速率：owner 已定，2s 应 +10HP（2Hz × 2.5 × 2s）；防 150/s 回归（旧 bug 2s 即 +50 触顶）
  bA.hp = 50;
  let elapsed = 0; const dt = 1 / 60;
  while (elapsed < 2.0) { M.tick(dt); elapsed += dt; }
  const heal2s = bA.hp - 50;
  report('水塔回血严格 5HP/s（修复项 BLOCKER）', heal2s >= 6 && heal2s <= 12 && heal2s < 20, '2s +' + heal2s.toFixed(1) + 'HP（期望≈10，旧bug≈50）');
  // 多人同圈速率边界：2 蓝同圈，每人仍 5HP/s（不叠加成 10/s）
  const bB = Game.units.find(u => u.ai && u.team === 'blue' && u !== bA);
  bB.pos.set(154, 0, 132); bB.alive = true; bB.hp = 50;
  bA.hp = 50;
  elapsed = 0; while (elapsed < 2.0) { M.tick(dt); elapsed += dt; }
  report('多人同圈每人仍 5HP/s（边界抽查）', Math.abs((bA.hp - 50) - 10) <= 4 && Math.abs((bB.hp - 50) - 10) <= 4,
    '2s bA +' + (bA.hp - 50).toFixed(1) + ' bB +' + (bB.hp - 50).toFixed(1) + '（每人应≈10）');
  Net.broadcastEvent = origBc;
}
report('水塔不进 Game.caps（id 不与 A/B/C 冲突）', Game.caps.length === 3 && Game.caps.map(c => c.id).join('') === 'ABC',
  'caps=' + Game.caps.map(c => c.id).join(','));

/* ---------- 4. AI 命中惩罚：仅 20m 外 ×0.5（修复项），近战不惩罚 ---------- */
{
  const shooter = Game.units.find(u => u.ai && u.team === 'blue' && u.ai.role === 'rifle') || Game.units.find(u => u.ai);
  const target = Game.units.find(u => u.ai && u.team === 'red') || Game.units[0];
  shooter.alive = true; target.alive = true; shooter.hp = 100; target.hp = 100;
  shooter.weapon = 'rifle'; shooter.ai.role = 'rifle';
  let hits = 0;
  const origResolve = global.resolveShot;
  global.resolveShot = () => { hits++; };
  const origRand = Math.random;
  const run = (d, storm) => {
    shooter.pos.set(100, 0, 100); target.pos.set(100, 0, 100 + d);
    shooter.ai.target = target;
    s.storm = storm;
    hits = 0;
    for (let i = 0; i < 10; i++) { shooter.ai.burst = 1; shooter.ai.burstT = 0; shooter.ai.fireT = 0; shooter.ai.tryShoot(0.016); }
    return hits;
  };
  Math.random = () => 0.2;
  const d5_calm = run(5, false), d5_storm = run(5, true);   // d=5：近战不应惩罚
  const d30_calm = run(30, false), d30_storm = run(30, true); // d=30：风暴 ×0.5
  Math.random = origRand; global.resolveShot = origResolve;
  report('近战 d=5 风暴不惩罚（修复项阈值）', d5_storm === d5_calm, 'd=5 平静 ' + d5_calm + '/10 风暴 ' + d5_storm + '/10（应相等）');
  report('远距 d=30 风暴 ×0.5', d30_calm === 10 && d30_storm === 0, 'd=30 平静 ' + d30_calm + '/10 风暴 ' + d30_storm + '/10');
}

/* ---------- 5. 风暴结束雾恢复（回归） ---------- */
s.storm = true; s.t = s.dur - 0.05; s.fade = 1;
M.tick(0.1);
for (let i = 0; i < 250 && s.fade > 0; i++) M.tick(0.016);
report('风暴后雾恢复 near≈180 far≈430', Math.abs(World.scene.fog.near - 180) < 10 && Math.abs(World.scene.fog.far - 430) < 25,
  'near=' + World.scene.fog.near.toFixed(1) + ' far=' + World.scene.fog.far.toFixed(1));

finish();
