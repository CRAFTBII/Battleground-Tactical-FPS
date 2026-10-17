// QA v1.2 re-gate · suburb 城郊 —— 空投+炮击（修复批复验：8m 警示圈 / 随机落点 / 掩体遮挡）
'use strict';
const S = require('./_qa_v12_stub');
const { loadMap, report, finish } = S;

const def = loadMap('suburb');
if (!def) { finish(); return; }
Game.startSingle(); Game.phase = 'playing';
const M = Mechanics;
const s = M.state;

/* ---------- 0. 数值核对（回归） ---------- */
report('suburb kind=airdrop', M.kind === 'airdrop', 'kind=' + M.kind);
report('suburb 数值=设计（60s / drops2 / heal50 ammoPct0.3 / arty 45/4/60/8/zone r28）',
  M.cfg.intervalSec === 60 && s.dropPts.length === 2 && M._crateCfg.heal === 50 && M._crateCfg.ammoPct === 0.3 &&
  s.arty && s.arty.interval === 45 && s.arty.warnSec === 4 && s.arty.dmg === 60 && s.arty.radius === 8 && s.arty.zones[0].r === 28,
  'interval=' + M.cfg.intervalSec + ' drops=' + s.dropPts.length + ' arty interval=' + (s.arty && s.arty.interval) + ' warnSec=' + (s.arty && s.arty.warnSec) + ' dmg=' + (s.arty && s.arty.dmg) + ' radius=' + (s.arty && s.arty.radius) + ' zone.r=' + (s.arty && s.arty.zones[0].r));

/* ---------- 1. 空投（回归） ---------- */
s.nextArty = 999;
const collBefore = World.colliders.length;
s.airdropT = s.nextDrop - 0.01;
M.tick(0.02);
report('空投定时落箱 + 信标标记', s.crates.length === 1 && M.marks.some(m => m.color === '#7ec8ff'), 'crates=' + s.crates.length);
report('空投箱不入常驻 colliders', World.colliders.length === collBefore, 'colliders 增量=' + (World.colliders.length - collBefore));
for (let i = 0; i < 220; i++) M.tick(0.016);
const crate = s.crates[0];
report('空投箱落地', crate && crate.landed === true, crate ? 'landed=' + crate.landed : '无箱');
const ammo0 = PlayerGun.reserves.rifle;
Game.player.pos.set(crate.x, 0, crate.z); Game.player.hp = 40; Game.player.alive = true; Game.player.dead = false; Game.dead = false;
const picked = M.dispatch('interact');
report('E 拾取：+50HP / +30% 弹药', picked === true && s.crates.length === 0 && Game.player.hp === 90 && PlayerGun.reserves.rifle > ammo0,
  'ret=' + picked + ' hp=' + Game.player.hp + ' rifle ' + ammo0 + '→' + PlayerGun.reserves.rifle);

/* ---------- 2. 炮击：8m 警示圈 + zone 内随机落点 + 警示圈=伤害圈（修复项 MAJOR-2） ---------- */
{
  // 连续触发多轮，收集落点，验证：警示圈半径=8m（爆炸半径）、落点在 zone 内随机、警示位置=落弹位置
  const hits = [];
  for (let r = 0; r < 5; r++) {
    s.nextArty = 0; s.artyT = 0;
    M.tick(0.02);
    const w = s.arty.warn, ring = s.arty.ring;
    hits.push({ x: w.x, z: w.z, ringR: ring ? ring.geometry.parameters.outerRadius : -1 });
    for (let i = 0; i < 260; i++) M.tick(0.016); // 警示结束 → 落弹
  }
  const all8 = hits.every(h => Math.abs(h.ringR - 8) < 1);
  report('警示圈半径=爆炸半径 8m（修复项）', all8, 'ringR=' + hits.map(h => h.ringR.toFixed(1)).join(','));
  const allInZone = hits.every(h => Math.sqrt(U.dist2(h.x, h.z, 150, 150)) <= 28.5);
  report('落点在 zone(r28) 内随机', allInZone, 'pts=' + hits.map(h => '(' + h.x.toFixed(0) + ',' + h.z.toFixed(0) + ')').join(' '));
  const distinct = new Set(hits.map(h => h.x.toFixed(1) + ',' + h.z.toFixed(1))).size > 1;
  report('落点非固定 center（随机性）', distinct, '不同落点数=' + new Set(hits.map(h => h.x.toFixed(1) + ',' + h.z.toFixed(1))).size + '/5');
}

/* ---------- 3. 落弹伤害 + 警示位置=伤害位置（一致性） ---------- */
{
  s.nextArty = 0; s.artyT = 0;
  M.tick(0.02);
  const w = s.arty.warn;
  const posBefore = { x: w.x, z: w.z };
  Game.player.pos.set(w.x, 0, w.z); Game.player.hp = 100; Game.player.alive = true; Game.player.dead = false; Game.dead = false;
  for (let i = 0; i < 260; i++) M.tick(0.016);
  report('落弹中心 60 伤害（100→40）', Game.player.hp <= 40, 'hp=' + Game.player.hp.toFixed(1) + ' @警示点(' + posBefore.x.toFixed(1) + ',' + posBefore.z.toFixed(1) + ')');
}

/* ---------- 4. 掩体可挡炮击（修复项 wallBlock=true，确定性：强制落点=广场中心 150,150） ---------- */
{
  // 目标 A：开阔 5m（应受伤）；目标 B：墙后 5m（应被挡）
  const uA = Game.units.find(u => u.ai) || Game.player;
  const uB = Game.units.find(u => u.ai && u !== uA) || Game.player;
  // Round 1：开阔
  s.arty.warn = { x: 150, z: 150, r: 8 }; s.arty.warnT = 0.01;
  uA.pos.set(155, 0, 150); uA.hp = 100; uA.alive = true;
  for (let i = 0; i < 260; i++) M.tick(0.016);
  report('开阔位仍受伤（wallBlock 不误伤开阔）', uA.hp < 100, '开阔 hp=' + uA.hp.toFixed(1) + '（5m 应 ≈77）');
  // Round 2：墙遮挡
  s.arty.warn = { x: 150, z: 150, r: 8 }; s.arty.warnT = 0.01;
  uB.pos.set(155, 0, 150); uB.hp = 100; uB.alive = true;
  World.colliders.push({ min: new THREE.Vector3(152.5, 0, 140), max: new THREE.Vector3(153.5, 3, 160) }); // 中心(150,150)与目标(155,150)之间
  for (let i = 0; i < 260; i++) M.tick(0.016);
  World.colliders.pop();
  report('掩体可挡炮击（修复项：墙后无伤）', uB.hp === 100, '墙后 hp=' + uB.hp.toFixed(1) + '（应 100，被 rayBlocked 挡）');
}

finish();
