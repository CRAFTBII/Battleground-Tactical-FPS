/* ============================================
 * 战地突击 · game.js（由 index.html 内联脚本拆分）
 * ============================================ */

const Net = { broadcastEvent: () => {}, sendState: () => {}, peerState: () => {}, isHost: false, connected: false };

// AI 随机呼号池（英文代号，呼应 FPS UI 英文文案基调）；randAIName() 供 spawnAI / rebalance 复用
const AI_NAMES = ['Viper','Ghost','Wolf','Hawk','Bear','Falcon','Reaper','Nomad','Ranger','Cobra','Titan','Phantom','Striker','Hunter','Sentinel','Ace','Blade','Frost','Onyx','Raider','Vector','Echo','Joker','Maverick','Spartan','Wraith','Cyclone','Dagger','Sandman','Bullet'];
function randAIName() { return AI_NAMES[Math.floor(Math.random() * AI_NAMES.length)]; }

const Game = {
  phase: 'menu', units: [], squads: {}, score: { blue: 0, red: 0 }, time: CFG.MATCH_TIME,
  // v2.8 多队混战：队伍列表（players 永远在 blue=第0队）；teamCount 由开局过渡页设置（2~图 maxTeams，默认 2）
  teams: CFG.TEAMS.slice(0, 2), teamCount: 2, maxTeams: 4,
  player: null, coverPts: [], mortarMode: false, mortarTarget: null,
  mortarYaw: 0, mortarAngle: 45, mortarMesh: null, mortarBarrel: null, mortarMarker: null,
  MORTAR_V: 100, // 迫击炮初速 m/s，射程 R = V²·sin(2θ)/g（θ∈[20°,78°] → R≈150~420m 覆盖全图）
  mortarShots: CFG.MORTAR_MAX, mortarCd: 0, scoped: false, aiMortarCd: 30, dead: false, deadT: 0,
  caps: [], capTickT: 0, capScoreT: 0, // 据点状态
  // 复活机制状态（design/maps/respawn-rework.md §8.3）
  playerRespawnPt: null,    // 玩家最终死亡时预计算的智能落点（§5.2）【v2.1 无重生后停用，保留字段防回归】
  playerReviveTarget: null, // 玩家当前正在救援的倒地单位（E 键 hold-to-revive）
  _revLast: null,           // 玩家救援移动中断检测（上一帧位置）
  spectator: null,          // v2.1 吃鸡制观战：{ target, idx }；null = 未在观战

  startSingle() {
    this.reset();
    this.spawnPlayer();
    // v2.8 多队：teamCount 由过渡页设置（默认 2）；玩家在 blue，其余队各 teamSize AI
    for (let ti = 1; ti < this.teamCount; ti++) this.spawnAI(this.teams[ti], this.mission.teamSize);
    this.spawnAI('blue', this.mission.teamSize - 1); // 蓝队 = 玩家 + (任务人数-1) AI
    this.initCaps();
    this.phase = 'playing';
    document.getElementById('menu').style.display = 'none';
    // v2.7 任务驱动：banner 播报任务 + objective 更新（v2.8 任务绑图，选图即选任务）
    UI.banner('本局任务：' + this.mission.name + ' · ' + this.teamCount + ' 队混战', '#ffd166', 3);
    this.updateObjective();
    // v2.7 联机：房主开局广播任务（客户端 onEvent('mission') 同步；v2.8 附带 teamCount）
    if (Net.connected && Net.isHost) Net.broadcastEvent({ k: 'mission', id: this.mission.id, tc: this.teamCount });
    this.applyControlBias();
    requestPointerLockSafe();
    if (typeof AudioFX !== 'undefined') {
      if (AudioFX.startAmbience) AudioFX.startAmbience(); // 战场环境底噪（风声）
      if (AudioFX.playSample) AudioFX.playSample('alarm', { gain: 0.05 }); // 战斗开始警报（完整放完）
    }
  },
  // v2.7/2.8 CONTROL 任务 AI 行为：每队往「最近的非己方据点」集结（夺点/守点由占领判定自然演化）
  applyControlBias() {
    if (!this.mission || this.mission.id !== 'control') return;
    for (const t of this.teams) {
      const sq = this.squads[t];
      if (!sq) continue;
      const target = (this.caps || []).find(c => c.owner !== t) || (this.caps || [])[0];
      if (target) sq.objective = { x: target.x, z: target.z };
      if (t === 'blue' && sq.command) sq.command('defend');
    }
  },
  reset() {
    for (const u of this.units) u.dispose();
    this.units = []; this.squads = {}; this.score = { blue: 0, red: 0 };
    // v2.8 队伍列表按 teamCount 重建（teamCount 由过渡页设置，reset 不清）
    this.teams = CFG.TEAMS.slice(0, this.teamCount);
    this.maxTeams = (typeof MapRegistry !== 'undefined' && MapRegistry.get && MapRegistry.get(World.mapId)) ? (MapRegistry.get(World.mapId).maxTeams || 4) : 4;
    // v2.8 任务绑定固定地图（选图=选任务，不再随机抽签）；控制时长统计归零
    const mDef = CFG.MISSIONS.find(m => m.mapId === World.mapId) || CFG.MISSIONS[0];
    this.mission = mDef;
    this.capTime = {};
    for (const t of this.teams) this.capTime[t] = 0;
    this.time = CFG.MATCH_TIME; this.mortarMode = false; this.mortarShots = CFG.MORTAR_MAX; this.mortarCd = 0;
    this.destroyMortarMesh(); this.destroyMortarMarker();
    this.aiMortarCd = 25; this.dead = false;
    this.playerRespawnPt = null; this.playerReviveTarget = null; this._revLast = null;
    this.spectator = null;
    this.caps = [];
    Projectiles.list.slice().forEach(p => { World.scene.remove(p.mesh); });
    Projectiles.list.length = 0;
    FX.smokes.slice().forEach(s => World.scene.remove(s.g)); FX.smokes.length = 0;
    FX.parts.slice().forEach(p => World.scene.remove(p.m)); FX.parts.length = 0;
    document.getElementById('killfeed').innerHTML = '';
    // v2.1：重新开局清理观战 UI
    const sq = document.getElementById('spectateQuit'); if (sq) sq.style.display = 'none';
    const si = document.getElementById('spectateInfo'); if (si) { si.style.display = 'none'; si.textContent = ''; }
    this.buildCoverPts();
  },
  /* ---- 据点初始化与逻辑 ---- */
  // v2.7 任务 HUD：objective 文案随任务（开局调用一次；无 HUD 循环覆盖）
  updateObjective() {
    const el = document.getElementById('objective');
    if (!el || !this.mission) return;
    el.textContent = '任务：' + this.mission.name + ' · ' + this.mission.desc;
  },
  initCaps() {
    this.caps = World.capturePoints.map(cp => ({ id: cp.id, x: cp.x, z: cp.z, r: cp.r, band: !!cp.band, owner: null, progress: 0 }));
    this.capTickT = 0; this.capScoreT = 0;
    World.capMeshes.forEach(m => { m.ring.material.color.setHex(CFG.teamColor('neutral').hex); m.flag.material.color.setHex(CFG.teamColor('neutral').hex); });
  },
  updateCaps(dt) {
    this.capTickT += dt; this.capScoreT += dt;
    // v2.7 CONTROL 任务：控制时长每帧累加（仅任务为 control 时统计；owner 的占据秒数）
    if (this.mission && this.mission.id === 'control') {
      for (const c of this.caps) if (c.owner) this.capTime[c.owner] += dt;
    }
    if (this.capTickT >= 0.4) {
      this.capTickT = 0;
      for (let i = 0; i < this.caps.length; i++) {
        const c = this.caps[i];
        // v2.9 地带判定：band 据点按 z 条带（|u.z-c.z|≤r 即在该地带）；非 band 按圆半径
        const inCap = u => c.band ? Math.abs(u.pos.z - c.z) <= c.r : U.dist2(u.pos.x, u.pos.z, c.x, c.z) <= c.r * c.r;
        // v2.8 多队占领判定：地带内各队人数，最多且唯一者推进（平票僵持）
        const counts = {};
        for (const t of this.teams) counts[t] = 0;
        for (const u of this.units) {
          if (!u.alive) continue;
          if (!inCap(u)) continue;
          counts[u.team] = (counts[u.team] || 0) + 1;
        }
        const ranked = this.teams.filter(t => counts[t] > 0).sort((a, b) => counts[b] - counts[a]);
        const top = ranked[0];
        const contested = ranked.length > 1 && counts[ranked[0]] === counts[ranked[1]];
        if (top && !contested) c.progress = Math.min(100, c.progress + counts[top] * 1.6);
        else if (!top) c.progress = Math.max(0, c.progress - 1.2);
        if (c.progress >= 100) {
          const newOwner = top;
          if (c.owner !== newOwner) {
            c.owner = newOwner; // 占领不加分（v2.9.5：据点是战术目标非分数来源）
            const nName = (CFG.TEAM_NAMES && CFG.TEAM_NAMES[newOwner]) || newOwner;
            UI.banner('据点 ' + c.id + ' 被' + nName + '占领！', CFG.teamColor(newOwner).css, 2.5);
            Net.broadcastEvent({ k: 'cap', id: c.id, owner: newOwner });
          }
        }
      }
      this.updateCapVisual();
    }
    // 已占领据点每 2s 产分 — 已移除（v2.9.5：占点不再加分，胜负只看击杀）
  },
  updateCapVisual() {
    World.capMeshes.forEach((m, i) => {
      const c = this.caps[i];
      const col = CFG.teamColor(c.owner || 'neutral').hex; // 队伍色单一数据源（accessibility P0；v2.8 多队泛化）
      m.ring.material.color.setHex(col);
      m.flag.material.color.setHex(col);
      // 占领进度显示：旗杆高度随进度
      m.pole.scale.y = 0.6 + c.progress / 100 * 0.4;
    });
  },
  buildCoverPts() {
    this.coverPts = [];
    for (const c of World.colliders) {
      if (c.max.y < 0.9) continue;
      const faces = [
        [(c.min.x + c.max.x) / 2, c.min.z - 1.3], [(c.min.x + c.max.x) / 2, c.max.z + 1.3],
        [c.min.x - 1.3, (c.min.z + c.max.z) / 2], [c.max.x + 1.3, (c.min.z + c.max.z) / 2]
      ];
      for (const f of faces) if (World.walkable(f[0], f[1])) this.coverPts.push({ x: f[0], z: f[1] });
    }
  },
  // v2.6.1 分散出生·象限锚点版：地图按中心分 4 象限。v2.8 多队：2 队保持对角双象限（蓝 Q1+Q4 / 红 Q2+Q3），
  // N≥3 每队一个象限（team i → Q i）；玩家=蓝队 idx 0 → Q1。idx%2 决定锚点（2 队时），每锚点内 5 人左右
  // 在 SPAWN_SPREAD×mapScale 半径内分散（可走 + ≥SPAWN_SEP 防叠）。40 次尝试失败 → 兜底象限锚点。
  scatteredSpawn(team, idx, existing) {
    existing = existing || [];
    const W = CFG.WORLD, mid = W / 2;
    // 锚点取象限中心偏外（远离地图中心 → 拉开两军开局距离）；Q1左上/Q2右上/Q3左下/Q4右下
    const anchors = [[mid * 0.5, mid * 0.5], [W - mid * 0.5, mid * 0.5], [mid * 0.5, W - mid * 0.5], [W - mid * 0.5, W - mid * 0.5]];
    const ti = this.teams.indexOf(team);
    // v2.9.1 3 队也四角覆盖：蓝队 Q1+Q4(对角双象限)、红 Q2、绿 Q3（修 Q4 空置）
    const quad = (this.teamCount === 2)
      ? (team === 'blue' ? (idx % 2 === 0 ? 0 : 3) : (idx % 2 === 0 ? 1 : 2))
      : (this.teamCount === 3 && team === 'blue')
        ? (idx % 2 === 0 ? 0 : 3)
        : Math.min(ti, 3); // 4 队：每队一象限（team i → Q i）
    const cx = anchors[quad][0], cz = anchors[quad][1];
    const R = CFG.SPAWN_SPREAD * (CFG.mapScale || 1);
    const SEP2 = CFG.SPAWN_SEP * CFG.SPAWN_SEP;
    // 象限硬约束：采样点必须落在目标象限内（防半径跨界，保证「分象限出生」100% 成立）
    const inQuad = (x, z) => (((z < mid ? 0 : 1) * 2 + (x < mid ? 0 : 1)) === quad);
    for (let tries = 0; tries < 40; tries++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * R; // sqrt：圆内均匀分布（防内密外疏）
      const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
      if (x < 2 || z < 2 || x > W - 2 || z > W - 2) continue;
      if (!inQuad(x, z)) continue;
      if (!World.walkable(x, z)) continue;
      let ok = true;
      for (const e of existing) {
        if (e && U.dist2(x, z, e.pos.x, e.pos.z) < SEP2) { ok = false; break; }
      }
      if (ok) return { x, z, y: World.heightAt(x, z) };
    }
    // 兜底：象限锚点（多队下 green/yellow 无 World.spawns 配置，不能依赖 pickSpawn）
    return { x: Math.round(cx), z: Math.round(cz), y: World.heightAt(Math.round(cx), Math.round(cz)) };
  },
  spawnPlayer() {
    const s = this.scatteredSpawn('blue', 0, []); // v2.6.1：玩家 idx=0 → 蓝队 Q1(左上象限)
    this.player = new Unit('blue', { player: true, name: '你', x: s.x, y: s.y, z: s.z, weapon: 'rifle', armor: 100 });
    this.player.dead = false;
    this.units.push(this.player);
    PC.yaw = Math.PI / 4; PC.pitch = 0; PC.vy = 0;
    PlayerGun.setCur('rifle');
    PlayerGun.mags = {}; PlayerGun.reserves = {};
    for (const w in WEAPONS) { PlayerGun.mags[w] = WEAPONS[w].mag; PlayerGun.reserves[w] = WEAPONS[w].reserve; }
    PlayerGun.armor = 100;
    PlayerGun.medkits = CFG.PLAYER_START_MEDKITS; PlayerGun.armorkits = 0; PlayerGun.grenades = 3; PlayerGun.smokes = 2; // 每局开始补给（v2.4 医疗包按分配常量）
    PlayerGun.reloading = false;
    // v3.0：无账号系统，开局统一初始物资
    if (typeof Backpack !== 'undefined' && Backpack.resetToDefault) Backpack.resetToDefault();
    this.dead = false; Game._hpPrev = 100;
    camera.position.set(this.player.pos.x, this.player.pos.y + CFG.EYE, this.player.pos.z);
    this.player.mesh.grp.visible = false; // 第一人称隐藏自网格，迫击炮视角恢复
  },
  spawnAI(team, n, avoidIds) {
    avoidIds = avoidIds || [];
    // 战术角色固定编成（respawn-rework §6.1）：蓝 4突击/2狙击/2医疗/1支援，红 4/2/2/2；
    // 角色 → 武器池（保留池内随机），队长从突击手中指定 ★；替代旧 randRole 纯随机武器
    const ROLE_PATTERN = {
      blue: ['assault', 'assault', 'assault', 'assault', 'sniper', 'sniper', 'medic', 'medic', 'support'],
      red:  ['assault', 'assault', 'assault', 'assault', 'sniper', 'sniper', 'medic', 'medic', 'support', 'support']
    };
    const pattern = ROLE_PATTERN[team] || ROLE_PATTERN.blue;
    const roleAt = i => pattern[i % pattern.length];
    // 角色 → 武器池（§6.1 表）
    const roleWeapon = role => {
      if (role === 'sniper') return 'sniper';
      if (role === 'medic') return Math.random() < 0.7 ? 'rifle' : 'shotgun';
      if (role === 'support') return Math.random() < 0.6 ? 'shotgun' : 'rifle';
      return 'rifle'; // assault
    };
    // 队长：从突击手中指定 1 名（★ 名牌；队长不占独立槽位）
    let leaderIdx = 0;
    for (let i = 0; i < n; i++) if (roleAt(i) === 'assault') { leaderIdx = i; break; }
    const arr = [];
    for (let i = 0; i < n; i++) {
      // v2.6.1 分散出生·象限锚点：蓝队 AI idx=i+1（玩家占 0 → Q1/Q4 交替），红队 idx=i（Q2/Q3 交替）
      const s = this.scatteredSpawn(team, (team === 'blue' ? i + 1 : i), (this.player ? [this.player] : []).concat(arr));
      const role = roleAt(i);
      const isLeader = i === leaderIdx;
      const u = new Unit(team, { x: s.x, y: s.y, z: s.z, name: (isLeader ? '★ ' : '') + randAIName() });
      u.weapon = roleWeapon(role); // 关键：Unit.weapon 同步武器（AI 射击/搜刮都用它）
      u.ai = new AIBrain(u, role);
      u.ai.spawnIdx = i;
      u.ai.formationIdx = i % 10; // §7：分散偏移序号（0~9，长期打散阵型）
      // AI 备用弹药（搜刮尸体用）；支援兵 2 倍备弹（§6.4，构造内已翻倍但此处重置 → 需再翻倍）
      u.ai.reserveMap = {}; for (const w in WEAPONS) u.ai.reserveMap[w] = WEAPONS[w].reserve;
      if (role === 'support') for (const w in WEAPONS) u.ai.reserveMap[w] *= 2;
      this.units.push(u);
      arr.push(u);
    }
    this.squads[team] = new Squad(team, arr);
    return arr;
  },
  /* 联机人数变化时补/撤 AI 保持平衡（v2.7：上限跟随任务 teamSize） */
  rebalance() {
    const blueH = this.units.filter(u => u.team === 'blue' && !u.ai && u !== this.player).length + (this.player ? 1 : 0);
    const redH = this.units.filter(u => u.team === 'red' && !u.ai).length;
    const TS = this.mission ? this.mission.teamSize : CFG.TEAM_SIZE;
    const wantB = U.clamp(TS - blueH, 3, TS), wantR = U.clamp(TS - redH, 3, TS);
    const fix = (team, want) => {
      const ai = (this.squads[team] || { members: [] }).members;
      while (ai.length > want) { const u = ai.pop(); this.killUnit(u, null); u.dispose(); this.units = this.units.filter(x => x !== u); }
      while (ai.length < want) { const s = this.scatteredSpawn(team, ai.length, (this.player ? [this.player] : []).concat(ai)); const u = new Unit(team, { x: s.x, y: s.y, z: s.z, name: randAIName() }); u.ai = new AIBrain(u, 'assault'); u.ai.formationIdx = ai.length % 10; this.units.push(u); ai.push(u); if (!this.squads[team]) this.squads[team] = new Squad(team, ai); }
    };
    fix('blue', wantB); fix('red', wantR);
  },

  /* ---------- 伤害与击杀 / 倒地救援（respawn-rework §8.3） ---------- */
  applyDamage(u, dmg, attacker, isHead) {
    if (!u || this.phase !== 'playing') return;
    // v2.5 防御：伤害值净化——任何调用方传 NaN/±Infinity/负值 → 按 0 处理，防 hp 被污染成 NaN
    // （NaN 常见来源：射线/位置异常导致 resolveShot 的 dist=NaN、areaDamage 的 radius 异常等）
    dmg = Number(dmg);
    if (!Number.isFinite(dmg) || dmg < 0) dmg = 0;
    // 调试指令 /setinvincible：完全免疫伤害（无敌）
    if (u.invincible) return;
    // §4.5 出生无敌帧守卫：仅免疫敌方武器伤害；环境伤害（attacker=null）不免疫
    if (u.spawnProtT > 0 && attacker && attacker.team !== u.team) return;
    // 倒地态（T2/T4）：敌方武器/环境伤害 → 扣执行池 downHp；归零 → 处决/环境致死
    if (u.down) {
      u.downHp -= dmg;
      if (u.reviver) this.cancelRevive(u.reviver, u); // 倒地者再受伤害 → 中断救援（§2.1 中断条件④）
      if (u.downHp <= 0) this.toDead(u, attacker, attacker ? 'executed' : 'zone', isHead);
      return;
    }
    if (!u.alive) return; // 最终死亡单位不再结算
    // 护甲吸收 60% 伤害（先扣甲，甲尽后全伤入血）
    if (u.armor > 0) {
      const absorbed = Math.min(u.armor, dmg * 0.6);
      u.armor -= absorbed;
      dmg -= absorbed;
      if (u.isPlayer && u === this.player) {
        UI.armorBar(u.armor);
        // v2.5 修复护甲双字段：战斗扣甲同步背包侧（此前不同步 → 玩家用护甲包时基于错误的剩余甲判断）
        if (typeof PlayerGun !== 'undefined') PlayerGun.armor = u.armor;
      }
    }
    u.hp -= dmg;
    // v2.5 防御：hp 兜底净化（任何上游污染都能在写入后立即修复，UI 永不显示 NaN）
    if (!Number.isFinite(u.hp)) u.hp = 0;
    // v2.2 修复受伤反应 bug（原条件 attacker.ai：玩家打 AI 时不记录 → AI 不 dodge 不记仇，难度虚低）。
    // 改为「被攻击者是 AI 且攻击者存在」→ 记受伤反应（dodge）+ 记仇恨（优先解决在攻击我的人）
    // addHate 做方法级防御：联机远端单位快照/测试 mock 的 AI 对象可能无此方法，不得炸高频路径
    if (u.ai && attacker && attacker !== u) {
      u.ai.lastDmgT = now_s(); u.ai.dmgSrc = attacker;
      if (typeof u.ai.addHate === 'function') {
        u.ai.addHate(attacker, (u.team === 'red' ? CFG.HATE_RED_MULT : 1) * CFG.HATE_SELF);
        // 旁观仇恨：90m 内存活队友对攻击者记 HATE_ALLY（看到队友挨打 → 优先打攻击者）
        for (const o of this.units) {
          if (o === u || o === attacker || !o.ai || o.team !== u.team || !o.alive || o.down) continue;
          if (U.dist2(o.pos.x, o.pos.z, u.pos.x, u.pos.z) > 90 * 90) continue;
          if (typeof o.ai.addHate === 'function') o.ai.addHate(attacker, CFG.HATE_ALLY);
        }
      }
    }
    if (u.isPlayer && u === this.player) {
      UI.updateHealth();
      UI.flashDmg();
      // 敌方武器命中 → 中弹闷响 + 耳鸣（环境伤害不响，避免沙暴/缩圈持续刷音）
      if (attacker && attacker.team !== u.team && typeof AudioFX !== 'undefined' && AudioFX.dmg) AudioFX.dmg();
      if (u.hp <= 30) UI.lowhp(true);
    }
    if (u.hp <= 0) this.downOrKill(u, attacker, isHead);
  },
  // hp<=0 分流：非 down → toDown（击倒）；down → 直接处决（防御）
  downOrKill(u, attacker, isHead) {
    if (!u || u.life === 'dead') return;
    if (u.down) { u.downHp = 0; this.toDead(u, attacker, 'executed', isHead); return; }
    this.toDown(u, attacker);
  },
  // T1：ALIVE → DOWN（击倒 ≠ 击杀：不加分/不掉落/不加死亡数）
  toDown(u, attacker) {
    if (!u || u.life === 'dead' || u.down) return;
    u.life = 'down'; u.alive = false; u.down = true;
    u.downHp = CFG.DOWN_HP; u.bleedT = CFG.BLEED_OUT;
    u.reviveT = 0; u.reviver = null; u.downAt = Date.now();
    // 玩家侧：倒地 UI / 爬行 / 收镜 / 取消迫击炮 / 蓝队 AI 队长立即接管（§5.1）
    if (u.isPlayer && u === this.player) this.playerDown(true);
    if (u.team === 'blue' && this.squads.blue && typeof this.squads.blue.leaderTakeover === 'function') this.squads.blue.leaderTakeover();
    // 击倒 killfeed（R6：与"击杀"两级信息）
    if (typeof UI !== 'undefined' && UI.downfeed) UI.downfeed(attacker ? attacker.name : '环境', u.name);
    Net.broadcastEvent({ k: 'down', id: u.id, x: u.pos.x, z: u.pos.z, by: attacker ? attacker.id : null,
      an: attacker ? attacker.name : null, tn: u.name });
  },
  // T2/T3/T4：DOWN → DEAD（处决/流血/环境）；沿用 killUnit 做最终结算
  toDead(u, attacker, cause, isHead) {
    if (!u || u.life === 'dead') return;
    // 中断针对我的救援（处决/流血 → 救援者取消，§9.1 边例 3）
    if (u.reviver) {
      const rv = u.reviver;
      u.reviver = null;
      if (rv === this.player) this.playerReviveTarget = null;
      else if (rv.ai) { rv.ai.reviveTarget = null; if (rv.ai.state === 'revive') rv.ai.state = 'advance'; }
    }
    // v2.1 吃鸡制：玩家最终死亡后不再重生 → 不再预计算落点/布防（原 §5.2 逻辑删除）
    this.killUnit(u, attacker, isHead, cause);
  },
  // 最终死亡入口（killUnit 保留：toDead 调用 + rebalance 强制处决；战斗路径走 downOrKill 分流）
  killUnit(u, attacker, isHead, cause) {
    if (!u || u.life === 'dead') return;
    if (!u.alive && !u.down) return;
    u.life = 'dead'; u.alive = false; u.deathAt = Date.now(); u.deaths++;
    u.down = false; u.downHp = 0; u.bleedT = 0; u.reviveT = 0; u.reviver = null;
    // v2.3 战利品箱规则：
    // - AI 只在"流血致死"(cause==='bleed')掉箱——队友 20s 没救白死，尸体留战利品作为"救 vs 不救"的决策回报；
    //   处决/环境致死不掉箱（处决已拿击杀分，不叠加箱子收益）
    // - 玩家任何死亡都掉箱，但弹药不保留（AI 弹药无限用不上；玩家观战中也捡不回自己的箱子）
    const dropLoot = u.ai ? (cause === 'bleed') : true;
    if (dropLoot) {
      if (u.ai) {
        if (!u.ai.reserveMap) { u.ai.reserveMap = {}; for (const w in WEAPONS) u.ai.reserveMap[w] = WEAPONS[w].reserve; }
        u.loot = { ammo: {}, armor: Math.round(u.armor * 0.6), medkit: Math.random() < CFG.AI_LOOT_MEDKIT_CHANCE ? 1 : 0 };
        for (const w in WEAPONS) {
          const ammo = Math.round((WEAPONS[w].mag + (u.ai.reserveMap[w] || 0)) * 0.5);
          if (ammo > 0) u.loot.ammo[w] = ammo;
        }
      } else if (u.isPlayer && u === this.player) {
        // 玩家箱子：弹药不保留（ammo 空）；护甲 + 死前医疗包（上限 PLAYER_LOOT_MEDKIT_MAX）
        u.loot = { ammo: {}, armor: Math.round(u.armor * 0.6), medkit: Math.min(CFG.PLAYER_LOOT_MEDKIT_MAX, PlayerGun.medkits || 0) };
      }
      // 地面掉落实体：PUBG 式战利品盒（尸体处一个盒子，一次拾取）
      const box = (typeof Items !== 'undefined' && Items.dropForUnit) ? Items.dropForUnit(u) : null;
      // 击杀者 AI 绑定战利品盒：无敌人时走过去拾取（当前仅"有击杀者且掉箱"触发，处决不掉箱故不绑定）
      if (box && attacker && attacker.ai) attacker.ai.lootTarget = box;
    }
    if (attacker) { attacker.kills++; this.score[attacker.team]++; if (attacker.isPlayer && attacker === this.player) { if (isHead && typeof AudioFX !== 'undefined' && AudioFX.killHead) AudioFX.killHead(); else if (typeof AudioFX !== 'undefined' && AudioFX.kill) AudioFX.kill(); UI.banner('击杀 +1', CFG.teamColor('blue').css, 1.2); } }
    UI.killfeed(attacker ? attacker.name : '坠落', u.name, isHead, cause);
    if (u === this.player) {
      this.dead = true; this.player.dead = true;
      // v2.1 吃鸡制：玩家最终死亡 → 不再重生，直接进入观战（第三人称跟随存活 AI 队友）
      this.startSpectate();
      PlayerGun.aimT = 0; Game.scoped = false; // 死亡强制收镜
      UI.scope(false); UI.aim(false);
      // 死亡关背包面板
      if (UI.inventoryOpen) { UI.inventoryOpen = false; document.getElementById('invPanel').style.display = 'none'; }
      if (this.mortarMode) { this.mortarMode = false; UI.mortarUI(false); document.getElementById('aimRing').style.display = 'none'; this.destroyMortarMesh(); this.destroyMortarMarker(); }
      document.getElementById('deathOverlay').style.display = 'flex';
      const dt = document.getElementById('deathTimer');
      if (dt) dt.textContent = '观战中 · E/Q 切换队友视角';
      if (document.getElementById('spectateInfo')) document.getElementById('spectateInfo').style.display = 'block';
      if (document.getElementById('spectateQuit')) document.getElementById('spectateQuit').style.display = 'inline-block';
      if (document.getElementById('downOverlay')) document.getElementById('downOverlay').style.display = 'none';
      // 观战用键盘切人，释放指针锁（死亡不弹暂停，main.js pointerlockchange 有 Game.dead 守卫）
      if (document.pointerLockElement) document.exitPointerLock();
      if (!Net.isHost) Net.sendState({ t: 'die' });
    }
    // v2.1 吃鸡制：AI 最终死亡后不重生（respawnT 不再设置，尸体保留可搜刮）
    Net.broadcastEvent({ k: 'kill', a: attacker ? attacker.id : null, t: u.id, head: !!isHead, ts: now_s() });
    // 全灭检测：某队全员 life==='dead' → 对局提前结束（吃鸡制胜负判定）
    this.checkElimination();
  },
  // 玩家找准星范围内（±30°、REVIVE_RANGE 内）的倒地蓝队队友（§2.2）
  findReviveTargetForPlayer() {
    const p = this.player;
    if (!p || p.dead || p.down) return null;
    const R2 = CFG.REVIVE_RANGE * CFG.REVIVE_RANGE;
    const dirX = Math.sin(p.yaw), dirZ = Math.cos(p.yaw);
    let best = null, bestD = R2;
    for (const u of this.units) {
      if (!u || u === p || u.team !== 'blue') continue;
      if (!u.down || u.life !== 'down' || u.reviver) continue;
      const d2 = U.dist2(p.pos.x, p.pos.z, u.pos.x, u.pos.z);
      if (d2 > R2) continue;
      const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
      const dd = Math.sqrt(dx * dx + dz * dz) || 0.01;
      if (((dx / dd) * dirX + (dz / dd) * dirZ) < Math.cos(Math.PI / 6)) continue; // 朝向 ±30°
      if (d2 < bestD) { bestD = d2; best = u; }
    }
    return best;
  },
  // 玩家处决目标：±30°、REVIVE_RANGE 内的倒地敌人（T2 补刀；与 revive 同口径判定）
  findExecTargetForPlayer() {
    const p = this.player;
    if (!p || p.dead || p.down) return null;
    const R2 = CFG.REVIVE_RANGE * CFG.REVIVE_RANGE;
    const dirX = Math.sin(p.yaw), dirZ = Math.cos(p.yaw);
    let best = null, bestD = R2;
    for (const u of this.units) {
      if (!u || u === p || u.team === p.team) continue;
      if (!u.down || u.life !== 'down') continue;
      const d2 = U.dist2(p.pos.x, p.pos.z, u.pos.x, u.pos.z);
      if (d2 > R2) continue;
      const dx = u.pos.x - p.pos.x, dz = u.pos.z - p.pos.z;
      const dd = Math.sqrt(dx * dx + dz * dz) || 0.01;
      if (((dx / dd) * dirX + (dz / dd) * dirZ) < Math.cos(Math.PI / 6)) continue;
      if (d2 < bestD) { bestD = d2; best = u; }
    }
    return best;
  },
  // 处决执行（T2 倒地 → 最终死亡，击杀计分；不耗弹药/医疗包，与 AI 处决口径一致）
  // executor 通常是玩家；联机远端玩家处决由房主流入此入口（net exec_req），避免客户端越权
  execUnit(executor, t) {
    if (!executor || !t || t.team === executor.team || t === executor) return false;
    if (!t.down || t.life !== 'down') return false;
    if (Math.sqrt(U.dist2(executor.pos.x, executor.pos.z, t.pos.x, t.pos.z)) > CFG.REVIVE_RANGE + 0.5) return false;
    this.toDead(t, executor, 'executed', false);
    if (executor === this.player && typeof UI !== 'undefined' && UI.toast) UI.toast('处决 +1');
    return true;
  },
  playerDown(on) {
    const p = this.player;
    if (!p) return;
    if (on) {
      this.dead = false; // 倒地不是最终死亡（死亡倒计时 UI 专属）
      PlayerGun.aimT = 0; this.scoped = false; UI.scope(false); UI.aim(false);
      if (this.mortarMode) { this.mortarMode = false; UI.mortarUI(false); document.getElementById('aimRing').style.display = 'none'; this.destroyMortarMesh(); this.destroyMortarMarker(); }
      if (UI.inventoryOpen) { UI.inventoryOpen = false; document.getElementById('invPanel').style.display = 'none'; }
      document.getElementById('deathOverlay').style.display = 'none';
      const ov = document.getElementById('downOverlay');
      if (ov) ov.style.display = 'flex';
      UI.banner('你倒下了 — 等待救援或爬向掩体', '#ffd166', 3);
    } else {
      const ov = document.getElementById('downOverlay');
      if (ov) ov.style.display = 'none';
    }
  },
  // 开始救援（锁定 downed.reviver，一次一人）。v2.4：救援消耗医疗包——救援者必须有包才能开始（完成时扣）
  startRevive(reviver, downed) {
    if (!reviver || !downed || !downed.down || downed.life !== 'down') return false;
    if (downed.reviver && downed.reviver !== reviver) return false; // 已被他人锁定
    const hasKit = (reviver === this.player) ? (PlayerGun.medkits > 0) : !!(reviver.ai && reviver.ai.medkits > 0);
    if (!hasKit) return false; // 没医疗包不能救人（v2.4）
    const d = Math.sqrt(U.dist2(reviver.pos.x, reviver.pos.z, downed.pos.x, downed.pos.z));
    if (d > CFG.REVIVE_RANGE) return false;
    downed.reviver = reviver; downed.reviveT = 0;
    if (reviver === this.player) this.playerReviveTarget = downed;
    else if (reviver.ai) { reviver.ai.reviveTarget = downed; reviver.ai.state = 'revive'; }
    return true;
  },
  // 中断救援：进度清零重来（§2.1 中断副作用）
  cancelRevive(reviver, downed) {
    if (!downed) return;
    downed.reviveT = 0;
    if (downed.reviver === reviver) downed.reviver = null;
    if (reviver === this.player) this.playerReviveTarget = null;
    else if (reviver && reviver.ai) { reviver.ai.reviveTarget = null; if (reviver.ai.state === 'revive') reviver.ai.state = 'advance'; }
    Net.broadcastEvent({ k: 'revive_cancel', id: downed.id, by: reviver ? reviver.id : null });
  },
  // T5：DOWN → ALIVE（被救起，残血 REVIVE_HP；弹匣/备弹/护甲保持倒地前）
  completeRevive(reviver, downed) {
    if (!downed || !downed.down) return;
    // v2.4 救援完成消耗 1 医疗包（成功才扣，中断不亏；Math.max 防御读条中资源被用掉）
    if (reviver === this.player) PlayerGun.medkits = Math.max(0, PlayerGun.medkits - 1);
    else if (reviver && reviver.ai) reviver.ai.medkits = Math.max(0, reviver.ai.medkits - 1);
    downed.life = 'alive'; downed.down = false; downed.alive = true;
    downed.hp = CFG.REVIVE_HP; downed.downHp = 0; downed.bleedT = 0;
    downed.reviveT = 0; downed.reviver = null;
    if (reviver === this.player) this.playerReviveTarget = null;
    else if (reviver && reviver.ai) { reviver.ai.reviveTarget = null; reviver.ai.state = 'advance'; }
    // 被救者归队标记（§5.3）：AI 先置 regroup 再 reset
    if (downed.ai && typeof downed.ai.reset === 'function') { downed.ai.regroup = true; downed.ai.reset(); }
    // 玩家被救起 → 恢复视角/输入
    if (downed.isPlayer && downed === this.player) this.playerDown(false);
    Net.broadcastEvent({ k: 'revive', id: downed.id, by: reviver ? reviver.id : null });
    // 蓝队被救 → 若在守势，存活率回升触发 waveResume（§5.4）
    if (downed.team === 'blue' && this.squads.blue && typeof this.squads.blue.waveResume === 'function') this.squads.blue.waveResume();
  },
  // 每帧：流血倒计时（T3）/ 玩家救援进度 / 出生无敌帧衰减
  tickDown(dt) {
    for (const u of this.units) {
      // 出生无敌帧衰减 + 离开保护半径提前失效（§4.5）
      if (u.spawnProtT > 0) {
        u.spawnProtT = Math.max(0, u.spawnProtT - dt);
        if (u.spawnProtT > 0 && u.spawnAt && U.dist(u.pos.x, u.pos.z, u.spawnAt.x, u.spawnAt.z) > CFG.SPAWN_PROT_RADIUS) u.spawnProtT = 0;
      }
      if (!u.down) continue;
      // T3 流血致死（救援读条中也会死：T3 与 T5 竞争，§9.1 边例 3）
      u.bleedT -= dt;
      if (u.bleedT <= 0) { this.toDead(u, null, 'bleed'); continue; }
      // 玩家救援进度（AI 救援由 AIBrain.tryRevive 驱动，避免双推进）
      if (u.reviver === this.player) {
        const p = this.player;
        let cancel = false;
        if (p.dead || p.down || !p.alive) cancel = true;                       // 救援者倒地/死亡
        const dMoved = this._revLast ? U.dist(this._revLast.x, this._revLast.z, p.pos.x, p.pos.z) : 0;
        this._revLast = { x: p.pos.x, z: p.pos.z };
        if (dMoved > 0.2 * dt) cancel = true;                                  // 救援者移动 >0.2m/s（§2.1 中断①）
        else if (U.dist(p.pos.x, p.pos.z, u.pos.x, u.pos.z) > CFG.REVIVE_RANGE + 0.5) cancel = true; // 离开范围（中断⑤）
        if (cancel) { this.cancelRevive(p, u); continue; }
        u.reviveT += dt;
        if (u.reviveT >= CFG.REVIVE_TIME) this.completeRevive(p, u);
      }
    }
    if (!this.playerReviveTarget) this._revLast = null;
  },
  // 倒地/救援进度 UI + 观战提示（10Hz 并入既有 HUD 节流）
  downHud() {
    const p = this.player;
    if (!p) return;
    if (p.down) {
      const t = document.getElementById('downTimer');
      if (t) t.textContent = '流血 ' + Math.max(0, Math.ceil(p.bleedT)) + 's · 等待队友救援';
      const hint = document.getElementById('downHint');
      if (hint) {
        if (p.reviver) hint.textContent = '队友正在救援…';
        else {
          // 显示最近存活队友的距离/动向（比固定文案更实时）
          let rc = null, rd = 1e9;
          for (const u of this.units) {
            if (u === p || u.team !== 'blue' || !u.alive || u.down) continue;
            const d2 = U.dist2(p.pos.x, p.pos.z, u.pos.x, u.pos.z);
            if (d2 < rd) { rd = d2; rc = u; }
          }
          const coming = rc && rc.ai && rc.ai.reviveTarget === p;
          hint.textContent = rc ? ('队友 ' + rc.name + ' ' + Math.max(1, Math.round(Math.sqrt(rd))) + 'm' + (coming ? ' · 赶来中' : ' · AI 会来救你')) : '无存活队友 · 爬向掩体等流血';
        }
      }
    }
    // v2.1 观战信息（死亡后跟随 AI 队友）
    const si = document.getElementById('spectateInfo');
    if (si) {
      const tgt = this.spectator && this.spectator.target;
      si.textContent = tgt ? '观战 · ' + tgt.name + ' · E/Q 切换' : '观战 · 等待队友…';
    }
    const wrap = document.getElementById('reviveBarWrap');
    if (this.playerReviveTarget && this.playerReviveTarget.down) {
      if (wrap) wrap.style.display = 'block';
      UI.reviveBar(U.clamp(this.playerReviveTarget.reviveT / CFG.REVIVE_TIME, 0, 1));
      // v2.4 救援消耗医疗包：提示剩余数量（玩家救援读条时可见）
      const rl = document.getElementById('reviveLabel');
      if (rl) rl.textContent = '正在救援队友（消耗医疗包 ×' + Math.max(0, PlayerGun.medkits) + '）…';
    } else if (wrap) wrap.style.display = 'none';
    // 处决提示：准星对准倒地敌人时显示（存活状态），复用 downHud 的 10Hz 节流
    const eh = document.getElementById('execHint');
    if (eh) {
      const has = !p.dead && !p.down && typeof this.findExecTargetForPlayer === 'function' && !!this.findExecTargetForPlayer();
      eh.style.display = has ? 'block' : 'none';
    }
  },
  /* v2.1 停用（吃鸡制无重生）：respawnAI / respawnPlayer 保留仅为防回归，不再被任何流程调用 */
  respawnAI(u) {
    const s = this.smartSpawn(u.team, {});
    u.pos.set(s.x, s.y, s.z); u.hp = CFG.PLAYER_HP; u.alive = true; u.deathAt = 0;
    u.life = 'alive'; u.down = false; u.downHp = 0; u.bleedT = 0; u.reviveT = 0; u.reviver = null;
    u.spawnProtT = CFG.SPAWN_PROT; u.spawnAt = { x: s.x, z: s.z };
    if (u.ai && typeof u.ai.reset === 'function') { u.ai.regroup = true; u.ai.reset(); } // §5.3 重生归队
    Net.broadcastEvent({ k: 'spawn', id: u.id, x: s.x, y: s.y, z: s.z });
  },
  respawnPlayer() {
    // §5.2：优先复用死亡时预计算的智能落点；失效（不可走/出圈）→ 重算
    let pt = this.playerRespawnPt;
    if (!pt || !World.walkable(pt.x, pt.z) ||
        (typeof Mechanics !== 'undefined' && Mechanics.zone && Mechanics.zone.active && Mechanics.zone.isOutside(pt.x, pt.z))) {
      pt = this.smartSpawn('blue', { player: true });
    }
    this.playerRespawnPt = null;
    this.player.pos.set(pt.x, pt.y, pt.z);
    this.player.hp = CFG.PLAYER_HP; this.player.alive = true; this.player.dead = false; this.player.deathAt = 0;
    this.player.life = 'alive'; this.player.down = false; this.player.downHp = 0;
    this.player.bleedT = 0; this.player.reviveT = 0; this.player.reviver = null;
    this.player.spawnProtT = CFG.SPAWN_PROT; this.player.spawnAt = { x: pt.x, z: pt.z }; // §4.5 出生无敌帧
    this.dead = false; PC.vy = 0;
    if (this.mortarMode) { this.mortarMode = false; UI.mortarUI(false); document.getElementById('aimRing').style.display = 'none'; }
    // 死亡惩罚（v2.8）：死后不再回复弹药——弹匣清零（尸体掉了），备弹保留死前数量；
    // 护甲仅恢复 30%（剩余靠搜刮尸体/仓库护甲包补）
    for (const w in WEAPONS) PlayerGun.mags[w] = 0;
    PlayerGun.armor = Math.min(PlayerGun.armor, 30);
    UI.armorBar(PlayerGun.armor);
    UI.updateHealth(); UI.lowhp(false);
    document.getElementById('deathOverlay').style.display = 'none';
    if (document.getElementById('downOverlay')) document.getElementById('downOverlay').style.display = 'none';
    Net.broadcastEvent({ k: 'respawn', id: this.player.id, x: pt.x, y: pt.y, z: pt.z });
  },
  /* ================================================================
   * v2.1 吃鸡制 · 观战系统（玩家最终死亡后第三人称跟随存活 AI 队友）
   * E/Q 切换目标；目标死亡/倒地/消失自动切下一个；蓝队全灭 → 等 checkElimination 收局
   * ================================================================ */
  startSpectate() {
    this.spectator = { target: null, idx: -1 };
    this.spectateNext(1);
  },
  spectateCandidates() {
    // v2.8 多队观战：优先蓝队（玩家队伍）存活 AI；蓝队全灭 → 全场存活 AI（吃鸡观战惯例：看剩余队伍打）
    const blue = this.units.filter(u => u.ai && u.team === 'blue' && u.alive && !u.down && u.life === 'alive');
    if (blue.length) return blue;
    return this.units.filter(u => u.ai && u.alive && !u.down && u.life === 'alive');
  },
  spectateNext(dir) {
    if (!this.spectator) return;
    const list = this.spectateCandidates();
    if (!list.length) { this.spectator.target = null; return; }
    let i = Math.max(0, this.spectator.idx);
    // 至少跳一位，防 E/Q 停在同一个人
    for (let k = 0; k < list.length; k++) {
      i = (i + dir + list.length) % list.length;
      if (k === list.length - 1) break;
      if (list[i] !== this.spectator.target) break;
    }
    this.spectator.idx = i; this.spectator.target = list[i];
    AudioFX.ui();
  },
  updateSpectate(dt) {
    if (!this.spectator) return;
    // 目标失效 → 自动切下一个
    const t = this.spectator.target;
    if (!t || !t.alive || t.down || t.life !== 'alive') this.spectateNext(1);
    const tgt = this.spectator.target;
    if (!tgt) return; // 蓝队全灭：checkElimination 已收局或等待
    // 第三人称跟随相机：目标后方 SPECTATE_DIST、上方 SPECTATE_HEIGHT，看向目标胸部
    const bx = -Math.sin(tgt.yaw), bz = -Math.cos(tgt.yaw);
    const px = tgt.pos.x + bx * CFG.SPECTATE_DIST, pz = tgt.pos.z + bz * CFG.SPECTATE_DIST;
    const py = tgt.pos.y + CFG.SPECTATE_HEIGHT;
    const k = Math.min(1, dt * 6);
    camera.position.x += (px - camera.position.x) * k;
    camera.position.y += (py - camera.position.y) * k;
    camera.position.z += (pz - camera.position.z) * k;
    camera.lookAt(tgt.pos.x, tgt.pos.y + 1.4, tgt.pos.z);
    // 观战提示文案并入 10Hz HUD 节流（downHud），此处不写 DOM
  },
  /* ================================================================
   * v2.1 吃鸡制 · 全灭判定：某队全员 life==='dead' → 提前收局（占点/时间结算保留兜底）
   * v2.8 多队混战：统计存活队伍（有非 dead 成员的队），只剩 1 队 → 该队获胜（吃鸡终局）
   * ================================================================ */
  checkElimination() {
    if (this.phase !== 'playing') return;
    // 存活队伍 = 仍有非死亡成员（含倒地可救，避免误判）
    const aliveTeams = this.teams.filter(t => this.units.some(u => u.team === t && u.life !== 'dead'));
    if (aliveTeams.length === 0) {
      // 全员最终死亡（/kill @e 直接处决等）→ 立即收局；败者=最后死亡者的队伍（另一队胜）
      const lastDead = this.units.filter(u => u.life === 'dead').sort((a, b) => (a.deathAt || 0) - (b.deathAt || 0)).pop();
      this.endMatchByElim(lastDead ? lastDead.team : (this.teams[1] || 'red'));
    } else if (aliveTeams.length === 1 && this.teamCount > 1) {
      // 仅剩一队幸存 → 立即胜（不再等其倒地成员流血倒计时）
      this.endMatchByElim(aliveTeams[0]);
    }
  },
  /* v2.7 任务终局判定矩阵（design/maps/missions-v27.md §3）：
   * v2.8 无时间限制 → 只剩 elim 语义：吃鸡制「最后存活队伍胜」（任务只定主题/指标，不定胜负） */
  missionWinner(trigger, loserTeam) {
    const aliveTeams = this.teams.filter(t => this.units.some(u => u.team === t && u.life !== 'dead'));
    return aliveTeams[0] || (loserTeam === 'red' ? 'blue' : 'red');
  },
  /* 结算主指标文案（按任务；finalScore 始终显示击杀比分作通用参照） */
  missionResultText() {
    const m = this.mission || { id: 'survive', name: '留到最后' };
    const tName = t => (CFG.TEAM_NAMES && CFG.TEAM_NAMES[t]) || t;
    const sum = (fn, sep) => this.teams.map(fn).join(sep);
    if (m.id === 'kills') return '任务：击杀王 · 击杀 ' + sum(t => this.score[t] || 0, ' : ');
    if (m.id === 'control') return '任务：占领据点 · 控制 ' + sum(t => Math.round(this.capTime[t] || 0) + 's', ' : ');
    const alive = t => this.units.filter(u => u.team === t && u.life !== 'dead').length;
    return '任务：留到最后 · 存活 ' + sum(t => tName(t) + ' ' + alive(t), ' · ');
  },
  endMatchByElim(loserTeam) {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    const winner = this.missionWinner('elim', loserTeam);
    const mName = this.mission ? this.mission.name : '';
    const wName = (CFG.TEAM_NAMES && CFG.TEAM_NAMES[winner]) || winner;
    document.getElementById('winnerT').textContent = wName + '获胜 · 任务「' + mName + '」';
    document.getElementById('winnerT').style.color = CFG.teamColor(winner).css;
    const ml = document.getElementById('missionResult');
    if (ml) ml.textContent = this.missionResultText();
    document.getElementById('finalScore').textContent = this.score.blue + ' : ' + this.score.red;
    document.getElementById('matchEnd').style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
    if (typeof AudioFX !== 'undefined' && AudioFX.stopAmbience) AudioFX.stopAmbience(); // 结算停止环境底噪
    Net.broadcastEvent({ k: 'end', b: this.score.blue, r: this.score.red });
  },
  /* ================================================================
   * §4 智能安全出生点（smartSpawn）：评分 + 硬约束 + 兜底链（永不为 null）
   * 替换 World.pickSpawn（重生路径专用；开局首刷保持原样）
   * 空间类距离 ×mapScale（§4.7），交互/战斗/时间/权重类固定。
   * ================================================================ */
  smartSpawn(team, opts) {
    opts = opts || {};
    const MS = CFG.mapScale || 1;
    const sc = v => v * MS;
    const zone = (typeof Mechanics !== 'undefined' && Mechanics.zone) ? Mechanics.zone : null;
    const zoneActive = !!(zone && zone.active);
    const list = (World.spawns[team] || []);
    const player = this.player;
    // 非最终死亡的单位（存活 + 倒地）都算"占用"（出生不重叠）
    const occupy = this.units.filter(u => u.alive || u.down);

    // ---- §4.2 候选集（≤40）：基础出生点 + 8 方向抖动（×mapScale） ----
    const candidates = [];
    const pushCand = (x, z) => {
      x = Math.max(1, Math.min(CFG.WORLD - 1, x));
      z = Math.max(1, Math.min(CFG.WORLD - 1, z));
      if (!World.walkable(x, z)) return;
      candidates.push({ x, z, y: World.heightAt(x, z) });
    };
    for (const sp of list) {
      pushCand(sp.x, sp.z);
      const j = sc(CFG.SPAWN_JITTER);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        pushCand(sp.x + Math.cos(a) * j, sp.z + Math.sin(a) * j);
      }
      if (candidates.length >= 40) break;
    }

    // ---- §4.3 安全分 + 硬约束 ----
    const score = c => {
      let s = 0;
      // 队友加成（teammateBonus）：距离越近分越高（玩家 ×1.5，§4.6）
      let minTeammate = Infinity;
      for (const u of occupy) {
        if (u.team !== team) continue;
        const d = U.dist(c.x, c.z, u.pos.x, u.pos.z);
        if (d < minTeammate) minTeammate = d;
      }
      const TR = sc(CFG.TEAM_RANGE);
      s += minTeammate === Infinity ? 0 : U.clamp((TR - minTeammate) / TR, 0, 1) * CFG.W_TEAMMATE * (opts.player ? 1.5 : 1);
      // 敌方接近惩罚（enemyProxPenalty）：最近敌人最重要（玩家 ×1.5）
      let minEnemy = Infinity;
      for (const u of occupy) {
        if (u.team === team) continue;
        const d = U.dist(c.x, c.z, u.pos.x, u.pos.z);
        if (d < minEnemy) minEnemy = d;
      }
      const ER = sc(CFG.ENEMY_RANGE);
      s -= minEnemy === Infinity ? 0 : U.clamp((ER - minEnemy) / ER, 0, 1) * CFG.W_ENEMY;
      // 敌方视线惩罚（enemyLosPenalty）：被几个存活敌人看见（玩家 ×1.5）
      let los = 0;
      for (const u of occupy) {
        if (u.team === team) continue;
        const eye = new THREE.Vector3(u.pos.x, u.pos.y + 1.5, u.pos.z);
        const chest = new THREE.Vector3(c.x, c.y + 1, c.z);
        if (!World.rayBlocked(eye, chest)) los++;
      }
      s -= los * CFG.W_LOS * (opts.player ? 1.5 : 1);
      // 圈边惩罚（edgePenalty）
      if (zoneActive && zone.isOutside(c.x, c.z) === false) {
        const dEdge = zone.curR - Math.sqrt(U.dist2(c.x, c.z, zone.center.x, zone.center.z));
        if (dEdge < sc(CFG.EDGE_MARGIN)) s -= CFG.W_EDGE;
      }
      // 抖动：防"复活点被预瞄死"的确定性
      s += U.rand(0, 5);
      return s;
    };
    const hardOk = c => {
      // 硬约束②：圈激活 → 绝不出圈外（用户硬性要求，权重再高也顶不过硬剔除）
      if (zoneActive && zone.isOutside(c.x, c.z)) return false;
      // 硬约束③：与任意存活/倒地单位水平距离 ≥ SPAWN_MIN_DIST（固定，碰撞级）
      for (const u of occupy) {
        if (U.dist2(c.x, c.z, u.pos.x, u.pos.z) < CFG.SPAWN_MIN_DIST * CFG.SPAWN_MIN_DIST) return false;
      }
      // 硬约束④（§4.6）：AI 重生不与存活玩家贴脸（红队不在玩家脸上刷，×mapScale）
      if (player && player.alive && player.team !== team &&
          U.dist2(c.x, c.z, player.pos.x, player.pos.z) < sc(CFG.SPAWN_NO_PLAYER) * sc(CFG.SPAWN_NO_PLAYER)) return false;
      return true;
    };
    let best = null, bestScore = -1e9;
    for (const c of candidates) {
      if (!hardOk(c)) continue;
      const sc2 = score(c);
      if (sc2 > bestScore) { bestScore = sc2; best = c; }
    }
    if (best) return best;

    // ---- §4.4 兜底链（safety 永远不返回 null） ----
    // ② 无候选 → 以最近存活队友为圆心，环形采样圈内最近可走点（复用 escapeDest 环形逻辑；半径取 curR 分数比例）
    if (zoneActive) {
      const ringPt = (ax, az, rr) => {
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          const px = Math.max(1, Math.min(CFG.WORLD - 1, ax + Math.cos(a) * rr));
          const pz = Math.max(1, Math.min(CFG.WORLD - 1, az + Math.sin(a) * rr));
          if (World.walkable(px, pz) && !zone.isOutside(px, pz)) return { x: px, z: pz, y: World.heightAt(px, pz) };
        }
        return null;
      };
      // 圆心：最近存活队友（无则玩家/圈心）
      let cx = zone.center.x, cz = zone.center.z, foundAnchor = false;
      for (const u of occupy) {
        if (u.team !== team) continue;
        if (player && player.team === team && u === player) continue;
        cx = u.pos.x; cz = u.pos.z; foundAnchor = true; break;
      }
      const R = Math.max(1, zone.curR);
      for (let d = 0; d <= 3; d++) {
        const rr = R * (1 - d * 0.25);
        const p = ringPt(cx, cz, rr);
        if (p) return p;
      }
      // 圈心本身可走 → 直接圈心（保底圈内出生）
      if (World.walkable(zone.center.x, zone.center.z)) return { x: zone.center.x, z: zone.center.z, y: World.heightAt(zone.center.x, zone.center.z) };
    }
    // ③ 圈未激活 → 距所有敌人最远的 World.spawns[team] 原始点
    {
      let spBest = null, spD = -1;
      for (const sp of list) {
        let minE = Infinity;
        for (const u of occupy) {
          if (u.team === team) continue;
          const d = U.dist(sp.x, sp.z, u.pos.x, u.pos.z);
          if (d < minE) minE = d;
        }
        if (minE > spD) { spD = minE; spBest = sp; }
      }
      if (spBest) return spBest;
    }
    // ④ 绝对兜底 → World.pickSpawn（现状行为，保底不崩）
    const s = World.pickSpawn(team);
    return { x: s.x, y: s.y, z: s.z };
  },
  areaDamage(pos, radius, maxDmg, owner, team, wallBlock) {
    if (Net.connected && !Net.isHost) return; // 非房主客户端只做特效，伤害由房主裁决
    const eye = wallBlock ? new THREE.Vector3(pos.x, (pos.y || 0) + 1, pos.z) : null;
    for (const u of this.units) {
      // §9.1 边例 2：倒地者（alive=false）也必须吃区域伤害（手雷/迫击炮/炮击可处决倒地者）
      if (u.life === 'dead') continue;
      // 爆炸物伪友军伤害：可伤害任何人——队友与投掷者自己（游戏设计取舍，文档已注明）
      const d = Math.sqrt(U.dist2(pos.x, pos.z, u.pos.x, u.pos.z));
      if (d > radius) continue;
      // v1.2：炮击可被掩体遮挡（wallBlock=true 专用；默认 false 不影响手雷/迫击炮既有调用）
      if (wallBlock && eye) {
        const chest = new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z);
        if (World.rayBlocked(eye, chest)) continue;
      }
      this.applyDamage(u, Math.round(maxDmg * (1 - d / radius)), owner, false);
    }
  },
  checkEnd() {
    // v2.8 无时间限制：胜负只由吃鸡淘汰（checkElimination）决定；本函数保留防回归
  },
  endMatch() {
    if (this.phase !== 'playing') return;
    this.phase = 'ended';
    const win = this.missionWinner('elim');
    const mName = this.mission ? this.mission.name : '';
    const wName = (CFG.TEAM_NAMES && CFG.TEAM_NAMES[win]) || win;
    document.getElementById('winnerT').textContent = wName + '获胜 · 任务「' + mName + '」';
    document.getElementById('winnerT').style.color = CFG.teamColor(win).css;
    const ml = document.getElementById('missionResult');
    if (ml) ml.textContent = this.missionResultText();
    document.getElementById('finalScore').textContent = this.teams.map(t => this.score[t] || 0).join(' : ');
    document.getElementById('matchEnd').style.display = 'flex';
    if (document.pointerLockElement) document.exitPointerLock();
    if (typeof AudioFX !== 'undefined' && AudioFX.stopAmbience) AudioFX.stopAmbience(); // 结算停止环境底噪
    Net.broadcastEvent({ k: 'end', b: this.score.blue, r: this.score.red });
  },

  /* ---------- 对讲机指挥：玩家向蓝队下发命令 ---------- */
  squadCommand(cmd) {
    if (this.phase !== 'playing' || this.player.dead || this.player.down) return; // §5.1 倒地玩家不能指挥
    const sq = this.squads.blue;
    if (!sq || !sq.command) return;
    sq.command(cmd);
    AudioFX.radio();
  },

  /* ---------- 迫击炮（第一人称：鼠标左右转方位，滚轮调仰角/射程） ---------- */
  toggleMortar() {
    if (this.phase !== 'playing' || this.player.dead || this.player.down) return; // §2.5 倒地禁迫击炮
    this.mortarMode = !this.mortarMode;
    UI.mortarUI(this.mortarMode);
    document.getElementById('aimRing').style.display = this.mortarMode ? 'block' : 'none';
    if (this.player) this.player.mesh.grp.visible = false; // 第一人称视角，不需要看自己
    if (this.mortarMode) {
      for (const k in PlayerGun.models) PlayerGun.models[k].visible = false;
      this.mortarYaw = this.player.yaw;   // 初始朝向 = 玩家当前朝向
      this.mortarAngle = 45;              // 初始仰角 45°（中距离）
      this.buildMortarMesh();
      this.buildMortarMarker();
    } else {
      PlayerGun.models[PlayerGun.cur].visible = true;
      this.destroyMortarMesh();
      this.destroyMortarMarker();
    }
    AudioFX.ui();
  },
  buildMortarMesh() {
    const g = new THREE.Group();
    const dark = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const dark2 = new THREE.MeshLambertMaterial({ color: 0x23272c });
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.22, 1.0), dark);
    base.position.y = 0.3;
    g.add(base);
    // 炮管：几何体平移到底部为 pivot，绕 X 旋转实现仰角
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.8, 10), dark2);
    barrel.geometry.translate(0, 0.9, 0);
    barrel.position.y = 0.42;
    g.add(barrel);
    // 两脚架
    const legMat = new THREE.MeshLambertMaterial({ color: 0x5a5f66 });
    const l1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 6), legMat);
    l1.position.set(0.25, 0.35, 0.2); l1.rotation.z = -0.5;
    const l2 = l1.clone(); l2.position.set(-0.25, 0.35, 0.2); l2.rotation.z = 0.5;
    g.add(l1, l2);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    World.scene.add(g);
    this.mortarMesh = g;
    this.mortarBarrel = barrel;
  },
  destroyMortarMesh() {
    if (this.mortarMesh) { World.scene.remove(this.mortarMesh); this.mortarMesh = null; this.mortarBarrel = null; }
  },
  buildMortarMarker() {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.0, 24, 1),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    g.add(ring);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.4 }));
    beam.position.y = 3;
    g.add(beam);
    World.scene.add(g);
    this.mortarMarker = g;
  },
  destroyMortarMarker() {
    if (this.mortarMarker) { World.scene.remove(this.mortarMarker); this.mortarMarker = null; }
  },
  updateMortar(dt) {
    if (!this.mortarMode) return;
    this.mortarCd = Math.max(0, this.mortarCd - dt);
    // 射程 R = V²·sin(2θ)/g，θ 越大射程越近（高抛）
    const rad = this.mortarAngle * Math.PI / 180;
    let R = this.MORTAR_V * this.MORTAR_V * Math.sin(2 * rad) / CFG.GRAV;
    R = U.clamp(R, 40, 420);
    const px = this.player.pos.x, pz = this.player.pos.z;
    const tx = U.clamp(px + Math.sin(this.mortarYaw) * R, 2, CFG.WORLD - 2);
    const tz = U.clamp(pz + Math.cos(this.mortarYaw) * R, 2, CFG.WORLD - 2);
    this.mortarTarget = new THREE.Vector3(tx, World.heightAt(tx, tz), tz);
    // 迫击炮实体跟随玩家，炮管对向方位与仰角（竖直向上 = -90°）
    if (this.mortarMesh) {
      this.mortarMesh.position.set(px, this.player.pos.y, pz);
      this.mortarMesh.rotation.y = this.mortarYaw;
      if (this.mortarBarrel) this.mortarBarrel.rotation.x = (this.mortarAngle - 90) * Math.PI / 180;
    }
    // 落点标记
    if (this.mortarMarker) this.mortarMarker.position.set(tx, 0.1, tz);
    UI.mortarUI(true);
  },
  fireMortar() {
    if (this.mortarCd > 0 || this.mortarShots <= 0 || !this.mortarTarget) return;
    this.mortarCd = CFG.MORTAR_CD; this.mortarShots--;
    const px = this.player.pos.x, pz = this.player.pos.z;
    const from = new THREE.Vector3(px, this.player.pos.y + 1.1, pz); // 从炮口发射
    const to = this.mortarTarget.clone();
    to.y = World.heightAt(to.x, to.z);
    const dist = Math.sqrt(U.dist2(from.x, from.z, to.x, to.z));
    const t0 = 2.6;
    const arc = dist * Math.tan(this.mortarAngle * Math.PI / 180) * 0.28 + 12; // 弧高随仰角
    Projectiles.spawn('mortar', from, null, this.player.team, this.player, { target: to, t0, arc });
    Net.broadcastEvent({ k: 'mortar', x: to.x, z: to.z });
    AudioFX.mortar();
    UI.banner('迫击炮发射 — ' + Math.round(dist) + 'm 落点', '#ffd166', 1.5);
  },
  aiMortarFire() {
    // v2.8 多队：敌方 AI 队（非蓝队，优先红队）呼叫迫击炮压迫蓝方玩家
    const foe = (this.squads.red && this.squads.red.members.length) ? 'red'
      : this.teams.find(t => t !== 'blue' && this.squads[t] && this.squads[t].members.length);
    if (!foe) return;
    const foes = this.squads[foe].members;
    const candidates = this.units.filter(u => u.alive && u.team === 'blue');
    if (!candidates.length) return;
    const target = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
    // v2.9.1 修复发射点硬编码 (182,182)：desert 510 下该点到远端玩家超迫击炮射程 → 玩家反方向 120m（敌方侧，飞行距离=120+玩家距中心，恒在射程内）
    const cx = CFG.WORLD / 2, cz = CFG.WORLD / 2;
    const ddx = target.pos.x - cx, ddz = target.pos.z - cz;
    const dl = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
    const from = new THREE.Vector3(cx + ddx / dl * 120, 2, cz + ddz / dl * 120);
    const to = new THREE.Vector3(target.pos.x, 0, target.pos.z);
    to.y = World.heightAt(to.x, to.z);
    const dist = Math.sqrt(U.dist2(from.x, from.z, to.x, to.z));
    const t0 = 2.6, arc = dist / 3.4 + 18;
    Projectiles.spawn('mortar', from, null, foe, foes[0], { target: to, t0, arc });
    AudioFX.mortar();
    UI.showIncoming(to.x, to.z);
    Net.broadcastEvent({ k: 'incoming', x: to.x, z: to.z });
  },
  update(dt) {
    if (this.phase === 'playing') {
      // v2.8 无时间限制：胜负只由吃鸡淘汰决定（删除了 time<=0 → endMatch 结算）
      // 玩家死亡 → 观战模式（v2.1 吃鸡制：无重生，第三人称跟随存活 AI 队友）
      if (this.dead) this.updateSpectate(dt);
      // 倒地/流血/救援/无敌帧 tick（原 AI 重生循环已删除——全员淘汰制）
      this.tickDown(dt);
      // 小队 AI 更新
      for (const k in this.squads) this.squads[k].update(dt);
      // 红队迫击炮
      this.aiMortarCd -= dt;
      if (this.aiMortarCd <= 0 && this.phase === 'playing') { this.aiMortarFire(); this.aiMortarCd = U.rand(28, 46); }
      // 据点占领
      if (this.caps.length) this.updateCaps(dt);
      // v1.2：地图机制 tick（探照灯/沙暴/空投炮击；Mechanics 未加载 → 无操作）
      if (typeof Mechanics !== 'undefined' && Mechanics.tick) Mechanics.tick(dt);
      // 更新单位视觉
      for (const u of this.units) u.updateVisual(dt);
      this.player.updateVisual(dt);
      // HUD（10Hz 节流，避免每帧写 DOM 触发 layout thrashing）
      this.hudT = (this.hudT || 0) + dt;
      if (this.hudT >= 0.1) {
        this.hudT = 0;
        UI.updateHealth();
        UI.timer();
        UI.teams();
        UI.updateAmmo();
        this.downHud(); // 倒地/救援进度 UI（§8.3）
      }
      if (this.mortarMode) this.updateMortar(dt);
    }
  }
};
function now_s() { return performance.now() / 1000; }
function requestPointerLockSafe() {
  const el = renderer.domElement;
  try { el.requestPointerLock(); } catch (e) { }
}

/* ---------- AI 大脑 ---------- */
