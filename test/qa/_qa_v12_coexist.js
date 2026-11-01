// QA v1.2 · 机制与既有玩法共存 + 联机事件注入 独立验证
'use strict';
const S = require('./_qa_v12_stub');
const { loadMap, report, finish } = S;

/* ---------- 1. desert：风暴激活态下据点推进/伤害/比分不回归 ---------- */
{
  loadMap('desert'); Game.startSingle(); Game.phase = 'playing';
  const M = Mechanics; const s = M.state;
  s.storm = true; s.fade = 1; s.t = 0; // 维持风暴
  const capA = Game.caps.find(c => c.id === 'A');
  const blue = Game.units.find(u => u.ai && u.team === 'blue');
  const blue2 = Game.units.find(u => u.ai && u.team === 'blue' && u !== blue);
  blue.pos.set(capA.x, 0, capA.z); blue.alive = true;
  blue2.pos.set(capA.x + 2, 0, capA.z); blue2.alive = true;
  for (const u of Game.units) { if (u !== blue && u !== blue2) { u.pos.set(8, 0, capA.z + capA.r + 60); } }
  const sc0 = Game.score.blue + Game.score.red;
  for (let i = 0; i < 50; i++) { Game.updateCaps(0.016); Mechanics.tick(0.016); }
  const prog = Game.caps.find(c => c.id === 'A').progress;
  report('风暴激活下据点推进不回归', prog > 0, 'A progress=' + prog.toFixed(1));
  report('风暴环境伤害不产分', Game.score.blue + Game.score.red === sc0, 'score=' + Game.score.blue + ':' + Game.score.red);
  // 普通伤害在机制激活下仍生效（v2.5 起护甲吸收 60%，这里清零护甲只验伤害管线）
  const tgt = Game.units.find(u => u.ai && u.team === 'red');
  tgt.hp = 100; tgt.armor = 0; tgt.alive = true;
  Game.applyDamage(tgt, 30, Game.player, false);
  report('机制激活下 applyDamage 正常', tgt.hp === 70, 'hp=' + tgt.hp);
}

/* ---------- 2. 联机事件注入（客户端路径 onEvent） ---------- */
// 2a. desert m_storm
{
  loadMap('desert'); Game.startSingle();
  Net.connected = true; Net.isHost = false;
  Mechanics.onEvent({ k: 'm_storm', storm: true });
  report('联机 m_storm → 客户端风暴态', Mechanics.state.storm === true, 'storm=' + Mechanics.state.storm);
  Mechanics.onEvent({ k: 'm_storm', storm: false });
  report('联机 m_storm(false) → 客户端恢复', Mechanics.state.storm === false, 'storm=' + Mechanics.state.storm);
  Net.connected = false;
}
// 2b. port m_pwr
{
  loadMap('port'); Game.startSingle();
  Net.connected = true; Net.isHost = false;
  Mechanics.onEvent({ k: 'm_pwr', on: false });
  report('联机 m_pwr(false) → 客户端断电视觉', Mechanics.state.power === false, 'power=' + Mechanics.state.power);
  Mechanics.onEvent({ k: 'm_pwr', on: true });
  report('联机 m_pwr(true) → 客户端恢复', Mechanics.state.power === true, 'power=' + Mechanics.state.power);
  Net.connected = false;
}
// 2c. suburb m_airdrop / m_arty
{
  loadMap('suburb'); Game.startSingle();
  Net.connected = true; Net.isHost = false;
  const n0 = Mechanics.state.crates.length;
  Mechanics.onEvent({ k: 'm_airdrop', x: 120, z: 180 });
  report('联机 m_airdrop → 客户端落箱视觉', Mechanics.state.crates.length === n0 + 1, 'crates=' + Mechanics.state.crates.length);
  Mechanics.onEvent({ k: 'm_arty', x: 150, z: 150, r: 28, warn: true });
  report('联机 m_arty → 客户端警示环', !!(Mechanics.state.arty && Mechanics.state.arty.warn && Mechanics.state.arty.ring),
    'warn=' + !!(Mechanics.state.arty && Mechanics.state.arty.warn));
  Net.connected = false;
}

/* ---------- 3. 房主权威：非房主 tick 不跑 sim ---------- */
{
  loadMap('suburb'); Game.startSingle(); Game.phase = 'playing';
  Net.connected = true; Net.isHost = false;
  const s = Mechanics.state;
  s.airdropT = s.nextDrop - 0.01;
  Mechanics.tick(0.02);
  report('非房主不跑 sim（空投不落箱）', s.crates.length === 0, 'crates=' + s.crates.length);
  Net.connected = false;
}

finish();
