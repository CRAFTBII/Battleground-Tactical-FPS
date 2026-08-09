/* ============================================
 * 战地突击 · ai.js（由 index.html 内联脚本拆分）
 * ============================================ */

class AIBrain {
  constructor(unit, role) {
    this.unit = unit; // AI 大脑反向持有其单位
    this.role = role; // 战术角色（respawn-rework §6.1）：'assault' | 'sniper' | 'medic' | 'support'
    this.state = 'advance';
    this.path = []; this.pathI = 0; this.repathT = 0;
    this.target = null;
    this.fireT = 0; this.burst = 0; this.burstT = 0;
    this.lastDmgT = -99; this.dmgSrc = null; this.dodgeT = 0; this.dodgeDir = 1;
    this.grenadeCd = U.rand(8, 16); this.losT = 0; this.canSee = false;
    this.moving = false; this.sprinting = false; this.orderPt = null; this.thinkT = 0;
    this.medkits = (role === 'medic') ? CFG.AI_MEDIC_MEDKITS : CFG.AI_MEDKITS; this.healCd = 0; // v2.4 分配：医疗兵 8 / 他人 4（救援耗包后更紧张 → 依赖捡箱）
    // 倒地/救援/处决/归队字段（respawn-rework §8.4）
    this.reviveTarget = null;   // 正在救援的倒地队友
    this.execTarget = null;     // 准备处决的倒地敌人
    this.regroup = false;       // 刚救起/重生 → 归队标记（§5.3）
    this.formationIdx = 0;      // 分散偏移序号（§7.2）
    this.protectT = 0;          // 掩护态剩余（prepareCover/waveHold 据守，§5.2/§5.4）
    // v1.4 战术层字段（design/maps/ai-tactics.md §1；全部是"决策维度"，不碰手感数值）
    this.exposedT = 0;    // ② 连续被曝露秒数（探照灯/沙暴）
    this.retreatT = 0;    // ③ 边打边退冷却（防每帧改目标）
    this.smokeCd = 0;     // ④ 投烟冷却
    this.smokes = 0;      // ④ AI 烟雾弹数量（初始 0，lootbox 拾取获得）
    this.armorkits = 0;   // ⑤ AI 护甲包数量（初始 0，lootbox 拾取获得）
    this.armorCd = 0;     // ⑤ 用护甲包冷却
    this.evadeT = 0;      // ① 沙暴/探照灯庇护转移冷却
    this._tacDest = null; // 当前帧战术移动目标（tacticalDest 计算；战斗不打断）
    this._smokeT = 0;     // ④ 投烟后穿烟推进计时
    this._prevTarget = null; // ④ engage 转点检测（目标切换 → 投烟窗口）
    this.prone = false; // 潜伏伏地：低血且无敌人视线时趴下（减少被命中、等待回血/队友）
    // 弹匣系统：mag=当前弹匣余量，reserveMap=各枪备弹；打空弹匣停 5s（reloading 倒计时）
    // 注意：mag 按实际武器（unit.weapon）初始化，role 已是战术角色
    this.mag = WEAPONS[unit.weapon] ? WEAPONS[unit.weapon].mag : 30;
    this.reserveMap = {};
    for (const w in WEAPONS) this.reserveMap[w] = WEAPONS[w].reserve;
    if (role === 'support') for (const w in WEAPONS) this.reserveMap[w] *= 2; // 支援兵 2 倍备弹（§6.4）
    this.reloading = 0; // >0 表示换弹停顿中（打空弹匣后 5s）
    this.lootTarget = null; // 战利品盒实体（击杀掉落 / 低弹药寻盒）
    this.lootCd = 0;       // 寻盒节流
    // v2.2 仇恨机制：谁打我（或打队友）我优先解决谁；每 HATE_REFRESH 秒衰减刷新一次
    this.hateMap = {};     // enemyId → 仇恨值
    this.hateT = U.rand(0, 2); // 刷新计时错开，防全队同帧衰减
    this.reset();
  }
  reset() { this.state = 'advance'; this.path = []; this.target = null; this.fireT = 0; this.burst = 0; this.lastDmgT = -99; this.healCd = 0;
    // 清倒地/处决引用（regroup 保留：§5.3 在 reset 前置 regroup，reset 后 followOrder 消费）
    this.reviveTarget = null; this.execTarget = null;
    // 清视线记忆（重生/被救起 = 全新状态；防 losT 节流残留 canSee 导致"复活后仍当交火"）
    this.canSee = false; this.losT = 0; this.target = null;
    // v2.2 清仇恨（被救起 = 全新状态，不带着旧恨入场）
    this.hateMap = {};
    // v1.4：冷却类复位（弹药/护甲包为"携带资源"，重生保留）
    this.exposedT = 0; this.retreatT = 0; this.smokeCd = 0; this.armorCd = 0; this.evadeT = 0; this._smokeT = 0; this._prevTarget = null; this._tacDest = null; }
  eyePos(u) { return new THREE.Vector3(u.pos.x, u.pos.y + 1.5, u.pos.z); }
  // v2.2 记仇：hate 值累加（红队 ×HATE_RED_MULT 在注入侧已乘，这里只累加）
  addHate(enemy, val) {
    if (!enemy || enemy.team === this.unit.team) return;
    this.hateMap[enemy.id] = (this.hateMap[enemy.id] || 0) + val;
  }
  // v2.2 仇恨衰减刷新：每 HATE_REFRESH 秒 ×decay（红队更慢遗忘），低于 HATE_FLOOR 清除
  tickHate(dt) {
    this.hateT -= dt;
    if (this.hateT > 0) return;
    this.hateT = CFG.HATE_REFRESH;
    const decay = this.unit.team !== 'blue' ? CFG.HATE_RED_DECAY : CFG.HATE_DECAY;
    for (const id in this.hateMap) {
      this.hateMap[id] *= decay;
      if (this.hateMap[id] < CFG.HATE_FLOOR) delete this.hateMap[id];
    }
  }

  perceive(dt) {
    // 每 0.2s 重算一次视线；v1.4 战术⑥：多目标评分（距离 + 残血 −12 + 曝露 −6）选目标
    this.losT -= dt;
    if (this.losT > 0) return;
    this.losT = 0.2;
    const u = this.unit;
    let best = null, bestScore = 1e9;
    const eye = this.eyePos(u);
    for (const e of Game.units) {
      if (!e.alive || e.team === u.team) continue;
      if (e.spawnProtT > 0) continue; // §4.5：AI 不预瞄出生无敌帧目标（配合表现）
      const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, e.pos.x, e.pos.z));
      if (d > 90) continue;
      const chest = new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
      if (World.rayBlocked(eye, chest)) continue;
      const sc = this.scoreTarget(e, d);
      if (sc < bestScore) { bestScore = sc; best = e; }
    }
    // 换目标节流：评分差 <4 不换（防 0.2s 高频切换；距离仍是主权重）
    if (best && this.target && this.target !== best && this.target.alive) {
      const curSc = this.scoreTarget(this.target);
      if (curSc - bestScore < 4) best = this.target;
    }
    this.target = best; this.canSee = !!best;
  }

  update(dt, squad) {
    const u = this.unit;
    // §2.5 倒地 AI：专用爬行分支（不射击/不感知攻击），其余字段冻结
    if (u.down) { this.downUpdate(dt, squad); return; }
    if (!u.alive) return;
    this.perceive(dt);
    this.reloading = Math.max(0, this.reloading - dt); // 换弹停顿倒计时
    // 换弹完成：v2.3 AI 弹药无限——弹匣永远补满，不消耗备弹池
    // （reserveMap 仅保留给掉箱计算/UI 显示；AI 不会再因弹药耗尽变成活靶子，手感约束仍是 acc/射速/换弹停顿）
    if (this.reloading <= 0 && this.mag <= 0) {
      const W2 = WEAPONS[u.weapon];
      if (W2) this.mag = W2.mag;
    }
    /* ---- v1.4 战术层计时（ai-tactics.md §1；只改决策维度，不碰手感数值）---- */
    this.evadeT = Math.max(0, this.evadeT - dt);
    this.retreatT = Math.max(0, this.retreatT - dt);
    this.smokeCd = Math.max(0, this.smokeCd - dt);
    this.armorCd = Math.max(0, this.armorCd - dt);
    this._smokeT = Math.max(0, this._smokeT - dt);
    this.protectT = Math.max(0, this.protectT - dt); // 掩护态倒计时（§5.2/§5.4）
    this.tickHate(dt); // v2.2 仇恨衰减刷新（每 HATE_REFRESH 秒）
    // ② 曝露计时（探照灯/沙暴共用 Mechanics.isExposed；离开光锥/庇护即清零）
    const exposedNow = (typeof Mechanics !== 'undefined' && Mechanics.isExposed) ? Mechanics.isExposed(u) : false;
    this.exposedT = exposedNow ? this.exposedT + dt : 0;
    // ⑤ 护甲包：armor<50 且带包且冷却到且不打断当前对枪（+50 armor，对齐玩家 useArmorkit）
    if (u.armor < 50 && this.armorkits > 0 && this.armorCd <= 0 && (!this.canSee || this.burst <= 0)) {
      u.armor = Math.min(100, u.armor + 50);
      this.armorkits--;
      this.armorCd = 8; // [PLAYTEST] 6~12
    }
    // 潜伏：低血（<35）且无敌人视线 → 伏地苟（不吃药时保命）；有敌人或血量恢复站起
    if (u.hp < 35 && !this.canSee && this.medkits <= 0) this.prone = true;
    else if (this.canSee || u.hp > 65) this.prone = false;
    // 医疗包：血量 <40 且无敌人视线（安全时机）→ 用包回血 50
    this.healCd -= dt;
    if (this.medkits > 0 && u.hp < 40 && !this.canSee && this.healCd <= 0) {
      if (!Number.isFinite(u.hp)) u.hp = CFG.PLAYER_HP; // v2.5 防御：防 NaN 传播
      u.hp = Math.min(CFG.PLAYER_HP, u.hp + 50);
      this.medkits--;
      this.healCd = 8; // 8s 冷却防连续用
      if (u.team !== 'blue') Net.broadcastEvent({ k: 'heal', id: u.id, hp: u.hp });
    }
    // ---- 救援/处决目标发现（respawn-rework §6.3/§2.4；perceive 之后、状态判定之前）----
    // v2.4 救援消耗医疗包：AI 没包不锁定救援目标（避免白跑一趟救不了）
    if (this.medkits <= 0) { this.reviveTarget = null; }
    else if (!this.reviveTarget || !this.reviveTarget.down) {
      const rt = this.findReviveTarget();
      if (rt) {
        // v2.1 淘汰制：救援优先级全面上调。医疗兵救人不看命令也不看近敌（§6.3）；
        // v2.2+v2.4 修正：红队全兵种同医疗兵口径（锁定条件与状态判定一致——红队有敌在旁也锁目标去救）
        const nearEnemy = this.canSee && this.target && U.dist2(u.pos.x, u.pos.z, this.target.pos.x, this.target.pos.z) < 10 * 10;
        if (this.role === 'medic' || u.team !== 'blue' || !nearEnemy) this.reviveTarget = rt;
      }
    }
    if (!this.execTarget || !this.execTarget.down) this.execTarget = this.findExecTarget();
    // 受伤躲避（含被玩家打的反应；dodge 仍最高优先，§8.4）
    if (now_s() - this.lastDmgT < 1.6) {
      this.state = 'dodge';
      if (this.dodgeT <= 0) {
        // 红队 dodge 更短 → 更快回攻（§6.1 行为层）
        this.dodgeT = 1.1 - (u.team !== 'blue' ? CFG.RED_DODGE_SHORTEN : 0);
        this.dodgeDir *= -1;
      }
    } else if (this.reviveTarget && this.reviveTarget.down && (this.role === 'medic' || u.team !== 'blue' || !this.canSee)) {
      // v2.2 红队全兵种救援优先（同医疗兵）：有倒地队友就冲去救，即使有敌在场——
      // 玩家击倒红队 AI 后必须快速处决或压制救援者，否则白打（"红队也有救援机制" + 难度上调）
      this.state = 'revive';
    } else if (this.canSee) {
      this.state = 'engage';
    } else if (this.reviveTarget && this.reviveTarget.down) {
      this.state = 'revive';  // §8.4 叶状态：插在 canSee→engage 之后、advance 之前
    } else if (this.execTarget && this.execTarget.down) {
      this.state = 'execute'; // 无活敌时补枪倒地敌人
    } else {
      this.state = 'advance';
    }
    this.moving = false;
    this.sprinting = false; // 每帧复位，仅 followOrder 疾跑命令下置真

    // 与队友分离
    for (const o of squad.members) {
      if (o === u || !o.alive) continue;
      const d2 = U.dist2(u.pos.x, u.pos.z, o.pos.x, o.pos.z);
      if (d2 < 2.4) { const d = Math.sqrt(d2) || 0.01; u.pos.x += (u.pos.x - o.pos.x) / d * dt * 0.6; u.pos.z += (u.pos.z - o.pos.z) / d * dt * 0.6; }
    }

    /* ---- v1.4 战术移动目标（环境压力/自保；战斗不打断——engage 分支仍 tryShoot）----
     * revive/execute 读条/补枪期间整体跳过（§6.3 读条期间战术层让位） */
    this._tacDest = (this.state === 'revive' || this.state === 'execute') ? null : (this.tacticalDest() || null);

    if (this.state === 'dodge') {
      this.dodgeT -= dt;
      const ang = this.dodgeDir * Math.PI / 2;
      const nx = Math.cos(ang), nz = Math.sin(ang);
      this.moveTo(u.pos.x + nx * 4, u.pos.z + nz * 4, dt, 3.6);
      if (this.dodgeT <= 0) { this.lastDmgT = -99; this.state = 'advance'; }
    } else if (this.state === 'revive') {
      this.tryRevive(dt);
    } else if (this.state === 'execute') {
      this.executeDowned(dt);
    } else if (this.state === 'engage' && this.target) {
      const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, this.target.pos.x, this.target.pos.z));
      u.yaw = U.angTo(u.pos.x, u.pos.z, this.target.pos.x, this.target.pos.z);
      const pwrOff = this._pwrOff();
      // ④ 转点投烟（目标切换且非 burst 中）：开阔地+被敌射界覆盖+带烟 → 投烟并穿烟推进
      if (this._prevTarget !== this.target && this.burst <= 0) this.maybeThrowSmoke();
      // §6.1 红队偏进攻：突击手逼近概率 +10%（行为层，不改命中/射速/移速）
      const assertP = (u.team !== 'blue' && this.role === 'assault') ? CFG.RED_ASSERTIVE : 0;
      // 战术移动偏向（射击节奏不动：tryShoot 照常；仅在 burst 间隙改走位）
      if (this._smokeT > 0) {
        this.moveTo(this.target.pos.x, this.target.pos.z, dt, 2.2); // 穿烟推进
        this.moving = true;
      } else if (this._tacDest) {
        if (this.burst <= 0) { this.moveTo(this._tacDest.d.x, this._tacDest.d.z, dt, 2.0); this.moving = true; }
      } else if (this.burst <= 0) {
        // ② 断电推进：横移概率减半 + 非狙击向目标逼近（行为层，不改命中/射速/移速）
        if (pwrOff && this.role !== 'sniper' && U.rand() < 0.10 + assertP) { this.moveTo(this.target.pos.x, this.target.pos.z, dt, 2.2); this.moving = true; }
        else if (U.rand() < ((pwrOff ? 0.025 : 0.05) + assertP)) { const a = U.rand(0, 1) < 0.5 ? 1 : -1; this.moveTo(u.pos.x + a * 2, u.pos.z + a * 2, dt, 1.6); this.moving = true; }
      }
      // 射击（换弹停顿中 tryShoot 自动跳过）
      this.tryShoot(dt);
      // 手雷：敌人集群或近距压制（② 断电期窗口放宽 6~30m，集群压制更积极）
      this.grenadeCd -= dt;
      const gMin = pwrOff ? 6 : 8, gMax = pwrOff ? 30 : 26;
      if (this.grenadeCd <= 0 && d > gMin && d < gMax && this.canSee) {
        this.throwGrenadeAt(this.target);
        this.grenadeCd = U.rand(10, 18);
      }
    } else {
      // 无敌人：战术目标（沙暴庇护/避光）优先于捡盒与命令
      if (this._tacDest) {
        if (Math.sqrt(U.dist2(u.pos.x, u.pos.z, this._tacDest.d.x, this._tacDest.d.z)) > 1) {
          this.moveTo(this._tacDest.d.x, this._tacDest.d.z, dt, 3.6);
          this.moving = true;
          this._prevTarget = this.target;
          return;
        }
      }
      // v1.3：圈外时不捡盒——缩圈目标优先（进圈保命 > 搜刮）
      if (!this.zoneDest() && this.tryLoot(dt)) { this._prevTarget = this.target; return; }
      this.followOrder(squad, dt);
    }
    this._prevTarget = this.target;
  }

  /* ================================================================
   * respawn-rework：倒地/救援/处决/归队/分散（design/maps/respawn-rework.md §2/§5/§7）
   * ================================================================ */

  /* §2.5 倒地专用：向最近掩体/最近存活队友方向爬行（CRAWL_SPEED），不射击不感知 */
  downUpdate(dt, squad) {
    const u = this.unit;
    let target = null, bestD = 1e9;
    // 最近存活队友（优先投奔队友，可能被救）
    if (squad && squad.members) {
      for (const o of squad.members) {
        if (o === u || !o.alive || o.down) continue;
        const d2 = U.dist2(u.pos.x, u.pos.z, o.pos.x, o.pos.z);
        if (d2 < bestD) { bestD = d2; target = o; }
      }
    }
    // 最近掩体
    const cp = this.nearestCoverPt();
    if (cp) {
      const d2 = U.dist2(u.pos.x, u.pos.z, cp.x, cp.z);
      if (d2 < bestD) { bestD = d2; target = cp; }
    }
    if (!target) return;
    const d = Math.sqrt(bestD);
    if (d > 1) {
      u.yaw = U.angTo(u.pos.x, u.pos.z, target.x, target.z);
      this.moveTo(target.x, target.z, dt, CFG.CRAWL_SPEED);
      this.moving = true;
    }
  }

  /* §2.3 搜索倒地队友：医疗兵 80m×mapScale / 红队全兵种 40m×mapScale（v2.2 救援优先）/ 蓝队非医疗 12m（固定） */
  findReviveTarget() {
    const u = this.unit;
    const MS = CFG.mapScale || 1;
    const range = (this.role === 'medic') ? CFG.MEDIC_REVIVE_RANGE * MS
      : (u.team !== 'blue') ? CFG.MEDIC_REVIVE_RANGE * 0.5 * MS
      : CFG.DEFAULT_REVIVE_RANGE;
    const R2 = range * range;
    let best = null, bestD = R2;
    for (const e of Game.units) {
      if (!e || e === u || e.team !== u.team) continue;
      if (!e.down || e.life !== 'down' || e.reviver) continue;
      const d2 = U.dist2(u.pos.x, u.pos.z, e.pos.x, e.pos.z);
      if (d2 <= bestD) { bestD = d2; best = e; }
    }
    return best;
  }

  /* §2.4 搜索 25m 内可见倒地敌人（战斗类固定，与 acc 模型绑定；无活敌时才处决） */
  findExecTarget() {
    const u = this.unit;
    const R2 = 25 * 25;
    let best = null, bestD = R2;
    const eye = this.eyePos(u);
    for (const e of Game.units) {
      if (!e || e.team === u.team || e === u) continue;
      if (!e.down || e.life !== 'down') continue;
      const d2 = U.dist2(u.pos.x, u.pos.z, e.pos.x, e.pos.z);
      if (d2 > R2) continue;
      const chest = new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z);
      if (World.rayBlocked(eye, chest)) continue;
      if (d2 < bestD) { bestD = d2; best = e; }
    }
    return best;
  }

  /* §2.3/§2.1 revive 态：靠近 → 停步 → 读条；中断（受伤/看见敌/离开/被抢）→ cancelRevive */
  tryRevive(dt) {
    const u = this.unit, t = this.reviveTarget;
    if (!t || !t.down || t.life !== 'down') { this.reviveTarget = null; return; }
    if (t.reviver && t.reviver !== u) { this.reviveTarget = null; return; } // 被他人锁定
    // 中断：救援者受伤 / 看见敌方（有更急的战斗）。v2.1：医疗兵读条中不因「看见敌人」中断（扛着救）；
    // v2.2：红队全兵种同医疗兵口径（红队救人心切，只受击打断）——救援者暴露 = 玩家可反制的代价
    if (now_s() - this.lastDmgT < 1.6 || (this.role !== 'medic' && u.team !== 'red' && this.canSee && this.target)) { Game.cancelRevive(u, t); return; }
    const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, t.pos.x, t.pos.z));
    if (d > CFG.REVIVE_RANGE) {
      // 赶路阶段：持续靠近，不设放弃阈值（v2.2 修复：旧逻辑 d>REVIVE_RANGE*3 直接 cancel，
      // 导致 40m/80m 半径发现的倒地队友永远救不到——救援实际只对 7.5m 内生效。
      // 救援目标在赶路途中失效由下帧 reviveTarget 校验/中断条件处理）
      u.yaw = U.angTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
      this.moveTo(t.pos.x, t.pos.z, dt, 3.6);
      this.moving = true;
      return;
    }
    // 站定读条
    if (!t.reviver) { t.reviver = u; t.reviveT = 0; }
    u.yaw = U.angTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
    t.reviveT += dt;
    if (t.reviveT >= CFG.REVIVE_TIME) Game.completeRevive(u, t);
  }

  /* §2.4 execute 态：无活敌时逼近倒地敌人并射击（正常 acc 模型，移动最小化） */
  executeDowned(dt) {
    const u = this.unit, t = this.execTarget;
    if (!t || !t.down || t.life !== 'down') { this.execTarget = null; return; }
    const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, t.pos.x, t.pos.z));
    if (d > 25) { this.execTarget = null; return; } // §2.4/§9.1边例8：不追出 25m（战斗类固定）
    if (d > 8) {
      u.yaw = U.angTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
      this.moveTo(t.pos.x, t.pos.z, dt, 3.6);
      this.moving = true;
      return;
    }
    // 射击倒地者（target 临时指向倒地者；resolveShot 已兼容 down 目标）
    const saved = this.target;
    this.target = t;
    u.yaw = U.angTo(u.pos.x, u.pos.z, t.pos.x, t.pos.z);
    this.tryShoot(dt);
    this.target = saved;
  }

  /* §5.3 归队：刚救起/重生 → 先回 memberDest/目标点；到达后清 regroup */
  respawnDuty(squad, dt) {
    const u = this.unit;
    let dest = null;
    if (typeof squad.memberDest === 'function') dest = squad.memberDest(u);
    if (!dest) dest = this.orderPt || squad.objective;
    if (!dest && squad.enemyCenter) dest = squad.enemyCenter(); // free 命令下以敌方质心为集结目标
    if (!dest) { this.regroup = false; return false; }
    const zoneD = this.zoneDest();
    if (zoneD) dest = zoneD; // 圈外先进圈（既有优先级）
    const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, dest.x, dest.z));
    if (d < 6) { this.regroup = false; return false; }
    this._moveToDest(dest, dt, squad, true);
    return true;
  }

  /* §7.2 散兵线侧向偏移（空间类 ×mapScale）：(idx%3 - 1) * 8m */
  spreadOffset() {
    const idx = this.formationIdx !== undefined ? this.formationIdx : (this.spawnIdx || 0);
    return (idx % 3 - 1) * 8 * (CFG.mapScale || 1);
  }

  /* 移动核心（路径 + moveTo；followOrder / respawnDuty 共用） */
  _moveToDest(dest, dt, squad, forceSprint) {
    const u = this.unit;
    const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, dest.x, dest.z));
    if (d < 6) return;
    const isSprint = forceSprint || squad.order === 'attack' || squad.order === 'group';
    this.sprinting = isSprint;
    this.repathT -= dt;
    const nextWp = this.path[this.pathI];
    const pathBroken = this.pathI >= this.path.length || (nextWp && !gridLineClear(u.pos, nextWp));
    if (pathBroken) {
      if (this.repathT <= 0) {
        this.repathT = 0.6;
        this.path = findPath(u.pos.x, u.pos.z, dest.x, dest.z);
        this.pathI = 1;
        if (!this.path.length && d > 30 && World.walkable(dest.x, dest.z)) {
          this.path = [{ x: dest.x, z: dest.z }];
          this.pathI = 0;
        }
      } else {
        u.yaw = U.angTo(u.pos.x, u.pos.z, dest.x, dest.z);
        this.moveTo(dest.x, dest.z, dt, isSprint ? 6.2 : 3.6);
        this.moving = true;
        return;
      }
    }
    if (this.pathI >= this.path.length) return;
    const wp = this.path[this.pathI];
    const wpd = Math.sqrt(U.dist2(u.pos.x, u.pos.z, wp.x, wp.z));
    if (wpd < 1.2) this.pathI++;
    if (this.pathI >= this.path.length) return;
    const w = this.path[this.pathI];
    u.yaw = U.angTo(u.pos.x, u.pos.z, w.x, w.z);
    const sp = u.weapon === 'sniper' ? (isSprint ? 5.2 : 2.9) : (isSprint ? 6.2 : 3.6);
    this.moveTo(w.x, w.z, dt, sp);
    this.moving = true;
  }


  /* v1.3：缩圈进圈目标。圈外 AI → 圈内最近可达点（最高优先级寻路目标）；
   * 在圈内 / 未开圈 → null。仅影响非战斗移动（engage/dodge 战斗行为不受扰） */
  zoneDest() {
    if (typeof Mechanics === 'undefined' || !Mechanics.zone || !Mechanics.zone.active) return null;
    const u = this.unit;
    return Mechanics.zone.escapeDest(u.pos.x, u.pos.z);
  }

  /* ================================================================
   * v1.4 战术层（design/maps/ai-tactics.md §1 接入点契约）
   * 全部为"决策层"：只读 Mechanics/World/Game 状态，不新增独立系统。
   * 硬约束：命中率 acc / 视线 0.2s / 受伤反应 1.6s / 射速弹匣 / 移速 / 伤害全不动。
   * ================================================================ */

  /* ---- 战术移动目标汇总（优先级：①沙暴庇护 > ②避光 > ③边打边退 > ⑤撤掩体治疗）---- */
  tacticalDest() {
    const u = this.unit;
    if (typeof Mechanics === 'undefined' || !Mechanics) return null;
    // ① 沙暴庇护（desert 主动；任意图防御性跳过——stormActive 恒 false）
    if (typeof Mechanics.stormActive === 'function' && Mechanics.stormActive()) {
      if (!Mechanics._inShelter(u.pos.x, u.pos.z) && this.evadeT <= 0 && (!this.canSee || this.exposedT > 2)) {
        const sd = this.shelterDest();
        if (sd) { this.evadeT = 0.8; return { d: sd, tag: 'shelter' }; }
        // 无庇护 → 优先进圈（zoneDest）→ 其次最近 coverPts 掩体点
        const zd = this.zoneDest();
        if (zd) return { d: zd, tag: 'zone' };
        const cp = this.nearestCoverPt();
        if (cp && U.dist2(u.pos.x, u.pos.z, cp.x, cp.z) < 144) { this.evadeT = 0.8; return { d: cp, tag: 'cover' }; }
        return null;
      }
    }
    // ② 探照灯避光（port；被曝露连续 >2s → 移向光锥外）
    if (Mechanics.kind === 'searchlight' && Mechanics.isExposed && Mechanics.isExposed(u) && this.exposedT > 2) {
      const ld = this.leaveConeDest();
      if (ld) return { d: ld, tag: 'light' };
    }
    // ③ 缩圈边打边退（圈外 engage 时；受伤 1.6s 内 dodge 状态覆盖本项）
    if (this.canSee && this.retreatT <= 0) {
      const rd = this.retreatInZone();
      if (rd) { this.retreatT = 0.9; return { d: rd, tag: 'retreat' }; }
    }
    // ⑤ 低血 + 敌视线 → 先撤掩体再用药（仅 burst 间隙，战斗不打断）
    if (u.hp < 40 && this.medkits > 0 && this.healCd <= 0 && this.canSee && this.burst <= 0) {
      const cp = this.nearestCoverPt();
      if (cp && U.dist2(u.pos.x, u.pos.z, cp.x, cp.z) < 8 * 8) return { d: cp, tag: 'heal' };
      // 8m 内无掩体 → 向远离敌人视线方向退 6m（边退边等安全，不打断射击）
      if (this.target) {
        const dx = u.pos.x - this.target.pos.x, dz = u.pos.z - this.target.pos.z;
        const dd = Math.sqrt(dx * dx + dz * dz) || 1;
        const tx = u.pos.x + dx / dd * 6, tz = u.pos.z + dz / dd * 6; // [PLAYTEST] 4~8
        if (World.walkable(tx, tz)) return { d: { x: tx, z: tz }, tag: 'heal' };
      }
    }
    return null;
  }

  /* ---- ① 最近庇护点：footprint / collider 外扩 2m 庇护矩形内的最近可走点（12m 搜索 [PLAYTEST] 8~16）---- */
  shelterDest() {
    const u = this.unit;
    if (typeof Mechanics === 'undefined' || !Mechanics.state) return null;
    const s = Mechanics.state;
    const R = 12, R2 = R * R;
    let best = null, bestD = R2;
    // 候选点必须可走；矩形成员即"机制庇护判定"（_inShelter 的 rect 子集，避免每候选全量扫描）
    const tryPt = (x, z) => {
      if (x < 1 || z < 1 || x > CFG.WORLD - 1 || z > CFG.WORLD - 1) return;
      if (!World.walkable(x, z)) return;
      const d2 = U.dist2(u.pos.x, u.pos.z, x, z);
      if (d2 < bestD) { bestD = d2; best = { x, z }; }
    };
    const rects = [];
    if (Array.isArray(s.footprints)) for (const r of s.footprints) {
      if (r.x1 < u.pos.x - R || r.x0 > u.pos.x + R || r.z1 < u.pos.z - R || r.z0 > u.pos.z + R) continue;
      rects.push(r);
    }
    if (Array.isArray(s.shelter)) for (const r of s.shelter) {
      if (r.x1 < u.pos.x - R || r.x0 > u.pos.x + R || r.z1 < u.pos.z - R || r.z0 > u.pos.z + R) continue;
      rects.push(r);
    }
    for (const r of rects) {
      const px = U.clamp(u.pos.x, r.x0, r.x1), pz = U.clamp(u.pos.z, r.z0, r.z1);
      tryPt(px, pz);
      tryPt(r.x0, r.z0); tryPt(r.x1, r.z0); tryPt(r.x0, r.z1); tryPt(r.x1, r.z1);
      tryPt((r.x0 + r.x1) / 2, r.z0); tryPt((r.x0 + r.x1) / 2, r.z1);
      tryPt(r.x0, (r.z0 + r.z1) / 2); tryPt(r.x1, (r.z0 + r.z1) / 2);
    }
    // 水塔圈内 = 庇护（AI 优先选水塔圈若在 12m 内，且水塔回血）
    if (s.tower) {
      const tw = s.tower;
      const dx = u.pos.x - tw.x, dz = u.pos.z - tw.z;
      const dd = Math.sqrt(dx * dx + dz * dz) || 0.01;
      if (dd <= tw.r + R) {
        const rr = Math.min(dd, tw.r) * 0.7;
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2;
          tryPt(tw.x + Math.cos(a) * rr, tw.z + Math.sin(a) * rr);
        }
      }
    }
    return best;
  }

  /* ---- ② 最近光锥外点：对所有灯（range+1m / 锥角外 1m）都不曝露的可走点；断电时返回 null ---- */
  leaveConeDest() {
    const u = this.unit;
    if (typeof Mechanics === 'undefined' || !Mechanics.state || !Mechanics.state.lights) return null;
    const s = Mechanics.state;
    if (s.power === false) return null; // 断电灯灭 → 无光锥
    const lights = s.lights;
    if (!lights.length) return null;
    let best = null, bestD = 1e9;
    const dists = [3, 5, 7, 9, 12];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      for (const rr of dists) {
        const px = u.pos.x + Math.cos(a) * rr, pz = u.pos.z + Math.sin(a) * rr;
        if (px < 1 || pz < 1 || px > CFG.WORLD - 1 || pz > CFG.WORLD - 1) continue;
        if (!World.walkable(px, pz)) continue;
        if (this._inAnyCone(px, pz, lights, 1)) continue; // 还在任一光锥（含 1m 裕量）
        const d2 = U.dist2(u.pos.x, u.pos.z, px, pz);
        if (d2 < bestD) { bestD = d2; best = { x: px, z: pz }; }
      }
    }
    return best;
  }
  // 点是否在任一灯的光锥内（margin 米：range+margin / 锥角外 margin）
  _inAnyCone(x, z, lights, margin) {
    for (const l of lights) {
      const dx = x - l.x, dz = z - l.z;
      if (dx * dx + dz * dz > (l.range + margin) * (l.range + margin)) continue;
      const ua = Math.atan2(dx, dz), la = Math.atan2(Math.sin(l.angle), Math.cos(l.angle));
      let diff = ua - la;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) <= l.halfAngle + 0.05 + margin * 0.12) return true;
    }
    return false;
  }
  // ② 断电窗口（searchlight power=false）
  _pwrOff() {
    return typeof Mechanics !== 'undefined' && Mechanics.kind === 'searchlight' && Mechanics.state && Mechanics.state.power === false;
  }

  /* ---- ③ 圈心方向退却点（向圈心退 retreatStep=5m [PLAYTEST] 4~6；不可达 → escapeDest 沿圈心找最近可走点）---- */
  retreatInZone() {
    const u = this.unit;
    if (typeof Mechanics === 'undefined' || !Mechanics.zone || !Mechanics.zone.active) return null;
    const z = Mechanics.zone;
    if (!z.isOutside(u.pos.x, u.pos.z)) return null;
    const cx = z.center.x, cz = z.center.z;
    const dx = u.pos.x - cx, dz = u.pos.z - cz;
    const dd = Math.sqrt(dx * dx + dz * dz) || 1;
    const step = 5; // [PLAYTEST] 4~6
    const tx = u.pos.x - dx / dd * step, tz = u.pos.z - dz / dd * step;
    if (World.walkable(tx, tz)) return { x: tx, z: tz };
    return z.escapeDest(u.pos.x, u.pos.z); // 退却点被建筑堵 → 沿圈心采样最近可走点
  }

  /* ---- ④ 烟雾掩护：开阔地 + 被敌射界覆盖 + 带烟 → 向移动方向前方 8~14m 投烟并穿烟移动 ---- */
  maybeThrowSmoke() {
    const u = this.unit;
    if (this.smokes <= 0 || this.smokeCd > 0) return;
    if (!this.target || !this.target.alive) return;
    // 触发概率 [PLAYTEST] 0.3~0.7（防全图乱扔）
    if (Math.random() >= 0.5) return;
    // 开阔判定：8m 内无 coverPts 掩体（复用 Game.coverPts）
    if (this.nearestCoverPtDist() < 8 * 8) return;
    // 射界判定：敌人能看到我（rayBlocked(敌眼, 我胸) === null）
    const t = this.target;
    const eEye = new THREE.Vector3(t.pos.x, t.pos.y + 1.5, t.pos.z);
    const myChest = new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z);
    if (World.rayBlocked(eEye, myChest)) return;
    // 投烟点：朝目标方向 8~14m（进攻/转点道具，不是逃跑道具）
    const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z;
    const dd = Math.sqrt(dx * dx + dz * dz) || 1;
    const dist = U.rand(8, 14); // [PLAYTEST] 6~16
    const pt = { x: u.pos.x + dx / dd * dist, z: u.pos.z + dz / dd * dist };
    this.throwSmokeAt(pt);
    this.smokes--;
    this.smokeCd = 12; // [PLAYTEST] 8~18
    this._smokeT = 2.2; // 投烟后穿烟推进窗口
  }
  // ④ 向 pt 投烟雾弹（复用 Projectiles.spawn('smoke',...)）
  throwSmokeAt(pt) {
    const u = this.unit;
    const origin = new THREE.Vector3(u.pos.x, u.pos.y + 1.4, u.pos.z);
    const dx = pt.x - u.pos.x, dz = pt.z - u.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    const dir = new THREE.Vector3(dx / d, 0.35, dz / d);
    const vel = dir.multiplyScalar(Math.min(16, d * 0.8));
    vel.y += 4.5;
    Projectiles.spawn('smoke', origin, vel, u.team, u);
    if (typeof Net !== 'undefined' && Net.broadcastEvent) Net.broadcastEvent({ k: 'throw', t: 'smoke', x: origin.x, y: origin.y, z: origin.z, vx: vel.x, vy: vel.y, vz: vel.z });
  }

  /* ---- ⑤ 最近 coverPts 掩体点 / 距离 ---- */
  nearestCoverPt() {
    const u = this.unit;
    let best = null, bestD = 1e9;
    for (const p of (Game.coverPts || [])) {
      const d2 = U.dist2(u.pos.x, u.pos.z, p.x, p.z);
      if (d2 < bestD) { bestD = d2; best = p; }
    }
    return best;
  }
  nearestCoverPtDist() {
    const u = this.unit;
    let best = 1e9;
    for (const p of (Game.coverPts || [])) {
      const d2 = U.dist2(u.pos.x, u.pos.z, p.x, p.z);
      if (d2 < best) best = d2;
    }
    return best;
  }

  /* ---- ⑥ 目标评分：距离主导 + 残血 −12 + 曝露 −6 + 仇恨加成（越低越优先）---- */
  scoreTarget(e, d) {
    d = (d === undefined) ? Math.sqrt(U.dist2(this.unit.pos.x, this.unit.pos.z, e.pos.x, e.pos.z)) : d;
    let s = d;
    if (e.hp < 30) s -= 12; // [PLAYTEST] 25~35（残血收割）
    if (typeof Mechanics !== 'undefined' && Mechanics.isExposed && Mechanics.isExposed(e)) s -= 6; // [PLAYTEST] 曝露目标
    // v2.2 仇恨：谁在攻击我（或队友）谁优先。100 仇恨 ×0.6 = −60 分 ≈ 60m 距离优势，压过距离主导
    const hate = this.hateMap[e.id];
    if (hate) s -= hate * CFG.HATE_WEIGHT;
    return s;
  }

  // 捡战利品盒：击杀绑定目标优先；v2.3 主动找盒动机 = 缺医疗包 / 缺护甲（AI 弹药无限后弹药不再驱动找箱）。
  // 返回 true 表示本帧在捡盒
  tryLoot(dt) {
    const u = this.unit;
    if (typeof Items === 'undefined' || !Items.list) return false;
    // 1. 绑定目标失效检查（被玩家/其他 AI 捡走、过期）
    let t = this.lootTarget;
    if (t) {
      const still = Items.list.includes(t);
      if (!still || (t.claimedBy && t.claimedBy !== u)) { this.lootTarget = null; t = null; }
    }
    // 2. 无目标：缺医疗包（<阈值）或缺护甲（<阈值且未带包）时找附近无主盒子（节流 3s）
    this.lootCd -= dt;
    if (!t && this.lootCd <= 0) {
      this.lootCd = 3;
      const needMed = this.medkits < CFG.AI_LOOT_MEDKIT_THRESHOLD;
      const needArmor = u.armor < CFG.AI_LOOT_ARMOR_THRESHOLD && !(this.armorkits > 0);
      if (needMed || needArmor) {
        let best = null, bestD = 625; // 25m 半径
        for (const it of Items.list) {
          if (it.type !== 'lootbox' || it.claimedBy) continue;
          const dx = it.mesh.position.x - u.pos.x, dz = it.mesh.position.z - u.pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestD) { best = it; bestD = d2; }
        }
        if (best) { best.claimedBy = u; this.lootTarget = best; t = best; }
      }
    }
    if (!t) return false;
    // 3. 走过去拾取（2m 内）
    const dx = t.mesh.position.x - u.pos.x, dz = t.mesh.position.z - u.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 4) {
      Items.pickupFor(t, u);
      const idx = Items.list.indexOf(t);
      if (idx >= 0) Items.list.splice(idx, 1);
      this.lootTarget = null;
    } else {
      const d = Math.sqrt(d2) || 0.01;
      u.yaw = U.angTo(u.pos.x, u.pos.z, t.mesh.position.x, t.mesh.position.z);
      this.moveTo(t.mesh.position.x, t.mesh.position.z, dt, 3.6);
      this.moving = true;
    }
    return true;
  }

  followOrder(squad, dt) {
    const u = this.unit;
    // §5.3 刚归队（救起/重生）→ 先归队再执行命令
    if (this.regroup) {
      if (this.respawnDuty(squad, dt)) return;
    }
    // v1.3：缩圈目标优先级最高（圈外 AI 优先进圈；squad 命令/分队目标让位）
    let dest = null;
    const zoneD = this.zoneDest();
    if (zoneD) dest = zoneD;
    else {
      // 指挥目标：玩家命令（集合/进攻/防守/自由）优先，无则用 squad 自动目标
      if (typeof squad.memberDest === 'function') dest = squad.memberDest(u);
      if (!dest) dest = this.orderPt || squad.objective;
      // §7.2 行进散兵线：仅对命令目标偏移（zone 目标不可偏移，防推出圈外；defend 走环绕站位）
      if (dest && squad.order !== 'defend' && squad.spreadDest && typeof squad.spreadDest === 'function') dest = squad.spreadDest(u, dest);
    }
    if (!dest) return;
    this._moveToDest(dest, dt, squad, false);
  }

  moveTo(tx, tz, dt, speed) {
    const u = this.unit;
    const dx = tx - u.pos.x, dz = tz - u.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 0.2) return;
    const vx = dx / d * speed, vz = dz / d * speed;
    // 翻越矮掩体：前方 0.9m 处有 0.8~1.8m 高障碍 → 触发跳跃弧线（jumpAnim 驱动 y，碰撞临时忽略该障碍）
    if (!u.jumpAnim) {
      const px = u.pos.x + dx / d * 0.9, pz = u.pos.z + dz / d * 0.9;
      const uf = u.pos.y || 0;   // v1.5：翻越判定同样相对脚底（上了楼才不会去翻楼下的箱子）
      for (const c of World.colliders) {
        if (c.max.y < uf + 0.8 || c.max.y > uf + 1.8) continue;
        if (px > c.min.x && px < c.max.x && pz > c.min.z && pz < c.max.z) {
          u.jumpAnim = { y0: u.pos.y, h: c.max.y + 0.5, t: 0, dur: 0.7, skip: c };
          break;
        }
      }
    }
    u.pos.x += vx * dt; u.pos.z += vz * dt;
    // 音效：AI 脚步（近无声沙沙，14m 内玩家可闻，空间定位；步频随速度，阈值 0.8 → 更连续）
    this._stepT = (this._stepT || 0) + dt * (speed >= 5 ? 2.6 : speed >= 2.5 ? 2.0 : 1.4);
    if (this._stepT > 0.8) {
      this._stepT = 0;
      const P = (typeof Game !== 'undefined' && Game.player) ? Game.player.pos : null;
      if (P && typeof AudioFX !== 'undefined' && AudioFX.foot) {
        const d2 = (u.pos.x - P.x) * (u.pos.x - P.x) + (u.pos.z - P.z) * (u.pos.z - P.z);
        if (d2 < 14 * 14) AudioFX.foot({ x: u.pos.x, y: u.pos.y || 0, z: u.pos.z });
      }
    }
    // 碰撞（跳跃中忽略目标障碍）
    const R = 0.45;
    const feet = u.pos.y || 0;   // v1.5：楼板/屋顶板不再当实心墙（World.blocksAt）
    for (const c of World.colliders) {
      if (!World.blocksAt(c, feet)) continue;
      if (u.jumpAnim && u.jumpAnim.skip === c) continue;
      const cx = U.clamp(u.pos.x, c.min.x, c.max.x), cz = U.clamp(u.pos.z, c.min.z, c.max.z);
      const ddx = u.pos.x - cx, ddz = u.pos.z - cz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < R * R && d2 > 0.0001) { const dd = Math.sqrt(d2); u.pos.x = cx + ddx / dd * R; u.pos.z = cz + ddz / dd * R; }
    }
    u.pos.x = U.clamp(u.pos.x, 1, CFG.WORLD - 1); u.pos.z = U.clamp(u.pos.z, 1, CFG.WORLD - 1);
  }

  tryShoot(dt) {
    const u = this.unit, t = this.target;
    const W = WEAPONS[u.weapon];
    // 换弹停顿：打空弹匣后停 5s（不射击，保持转向）
    if (this.reloading > 0) { this.fireT = 0.1; return; }
    this.fireT -= dt;
    // 射程判定按实际武器（role 已是战术角色；霰弹近战 16m）
    if (u.weapon === 'shotgun' && Math.sqrt(U.dist2(u.pos.x, u.pos.z, t.pos.x, t.pos.z)) > 16) return;
    if (this.fireT > 0) return;
    // 弹匣打空：进入 5s 换弹停顿（备弹足够才换，否则空仓干等）
    if (this.mag <= 0) {
      if ((this.reserveMap[u.weapon] || 0) > 0) this.reloading = 5;
      return;
    }
    if (this.burst <= 0) { this.burst = u.weapon === 'rifle' ? U.randi(3, 6) : 1; this.burstT = U.rand(0.35, 0.8); }
    if (this.burstT > 0) { this.burstT -= dt; return; }
    this.burst--;
    // 命中率模型（v2.2 下调：给玩家近身生存窗口；中距离 ~0.45，近距离 ~0.5）
    const d = Math.sqrt(U.dist2(u.pos.x, u.pos.z, t.pos.x, t.pos.z));
    let acc = U.clamp(0.5 - d / 150, 0.04, 0.55);
    if (u.weapon === 'sniper') acc = U.clamp(0.48 - d / 260, 0.05, 0.55);
    const tSpeed = t.vel.length() || 0;
    acc -= tSpeed * 0.05;
    if (this.dodgeT > 0) acc *= 0.8;
    // 玩家潜伏（Ctrl 趴下）：目标面积极小 → AI 命中减半
    if (t.isPlayer && PC.prone) acc *= 0.5;
    // AI 潜伏伏地：被打目标更小 → 命中降低
    if (t.ai && t.ai.prone) acc *= 0.65;
    // v1.2：沙暴中视野骤降 → AI 命中惩罚（仅 20m 外目标，设计 §3.1/§5；近距离近战不受影响）
    if (typeof Mechanics !== 'undefined' && Mechanics.stormActive && Mechanics.stormActive() && d > 20) acc *= 0.5;
    // 烟雾内瞄准惩罚由 rayBlocked 体现
    const eye = this.eyePos(u);
    const chest = new THREE.Vector3(t.pos.x, t.pos.y + 1, t.pos.z);
    const dir = chest.clone().sub(eye).normalize();
    if (Math.random() < acc) {
      dir.x += U.rand(-0.015, 0.015); dir.y += U.rand(-0.015, 0.015); dir.z += U.rand(-0.015, 0.015);
      resolveShot(u, eye, dir, u.weapon, false);
      // §4.5：AI 开火造成伤害 → 立即清出生无敌帧
      if (u.spawnProtT > 0) u.spawnProtT = 0;
      // 曳光
      const hit = eye.clone().addScaledVector(dir, d);
      FX.tracer(eye, hit, 0xffc080);
      if (U.dist(u.pos.x, u.pos.z, Game.player.pos.x, Game.player.pos.z) < 160) AudioFX.shot(u.weapon, u.pos);
      Net.broadcastEvent({ k: 'fire', id: u.id, w: u.weapon, x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.yaw });
    }
    // 消耗弹匣，打空触发换弹停顿
    this.mag--;
    if (this.mag <= 0) {
      if ((this.reserveMap[u.weapon] || 0) > 0) this.reloading = 5;
      return;
    }
    this.fireT = 60 / W.rpm + U.rand(0.05, 0.25);
    if (this.burst <= 0) this.fireT += U.rand(0.4, 1.1);
  }

  throwGrenadeAt(t) {
    const u = this.unit;
    const origin = new THREE.Vector3(u.pos.x, u.pos.y + 1.4, u.pos.z);
    const dx = t.pos.x - u.pos.x, dz = t.pos.z - u.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    const dir = new THREE.Vector3(dx / d, 0.35, dz / d);
    const vel = dir.multiplyScalar(Math.min(16, d * 0.8));
    vel.y += 4.5;
    Projectiles.spawn('grenade', origin, vel, u.team, u);
    Net.broadcastEvent({ k: 'throw', t: 'grenade', x: origin.x, y: origin.y, z: origin.z, vx: vel.x, vy: vel.y, vz: vel.z });
  }
}

/* ---------- 小队（战术层） ---------- */
