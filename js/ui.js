/* ============================================
 * 战地突击 · ui.js（由 index.html 内联脚本拆分）
 * ============================================ */

/* ---------- 物品贴图（MC 风格像素画，canvas 生成 dataURL） ---------- */
const Icon = {
  cache: {},
  // 16×16 像素画：rows 为 16 行字符串，每字符一个色键
  draw(key, rows, palette, scale) {
    if (this.cache[key]) return this.cache[key];
    try {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const g = c.getContext('2d');
      for (let y = 0; y < 16; y++) {
        const row = rows[y];
        if (!row) continue;
        for (let x = 0; x < 16 && x < row.length; x++) {
          const ch = row[x];
          if (ch === ' ' || !palette[ch]) continue;
          g.fillStyle = palette[ch];
          g.fillRect(x, y, 1, 1);
        }
      }
      this.cache[key] = c.toDataURL();
      return this.cache[key];
    } catch (e) { return ''; }
  },
  // 物品图标（背包/热键栏通用）
  get(k) {
    // 弹药箱：深色箱 + 亮色带（按武器配色）
    const ammoRows = [
      '................',
      '................',
      '..#############.',
      '.#HHHHHHHHHHHH#.',
      '.#DDDDDDDDDDDD#.',
      '.#HHHHHHHHHHHH#.',
      '.#CCCCCCCCCCCC#.',
      '.#CCCCCCCCCCCC#.',
      '.#CCCCCCCCCCCC#.',
      '.#DDDDDDDDDDDD#.',
      '.#HHHHHHHHHHHH#.',
      '..#############.',
      '................',
      '................',
      '................',
      '................'
    ];
    if (k === 'ammo-pistol') return this.draw('ammo-pistol', ammoRows, { H: '#8a8f96', D: '#5a5f66', C: '#b8bdc4', '#': '#2a2e34' });
    if (k === 'ammo-rifle') return this.draw('ammo-rifle', ammoRows, { H: '#4a4f55', D: '#2f3338', C: '#6b7076', '#': '#1c1f24' });
    if (k === 'ammo-sniper') return this.draw('ammo-sniper', ammoRows, { H: '#5a5f66', D: '#393d42', C: '#80858c', '#': '#22252a' });
    if (k === 'ammo-shotgun') return this.draw('ammo-shotgun', ammoRows, { H: '#6b4a3a', D: '#46312a', C: '#8a6350', '#': '#2e2018' });
    // 医疗包：白盒 + 红十字
    if (k === 'medkit') return this.draw('medkit', [
      '................', '..############..', '.#WWWWWWWWWWWW#.', '.#WWWWWWWWWWWW#.',
      '.#WWWWWWWWWWWW#.', '.#WWRRRRRRWWWW#.', '.#WWWRRRRWWWWW#.', '.#WWWWRRWWWWWW#.',
      '.#WWWWRRWWWWWW#.', '.#WWWRRRRWWWWW#.', '.#WWRRRRRRWWWW#.', '.#WWWWWWWWWWWW#.',
      '.#WWWWWWWWWWWW#.', '..############..', '................', '................'
    ], { W: '#f2f4f6', R: '#e03a3a', '#': '#9aa0a8' });
    // 护甲包：灰盒 + 亮片
    if (k === 'armorkit') return this.draw('armorkit', [
      '................', '..#############.', '.#DDDDDDDDDDDD#.', '.#DDDDDDDDDDDD#.',
      '.#DCCCCCCCCCCD#.', '.#DCCCCCCCCCCD#.', '.#DCCCCCCCCCCD#.', '.#DCCCCCCCCCCD#.',
      '.#DCCCCCCCCCCD#.', '.#DCCCCCCCCCCD#.', '.#DDDDDDDDDDDD#.', '.#HHHHHHHHHHHH#.',
      '..#############.', '................', '................', '................'
    ], { D: '#2a2e34', C: '#4a4f55', H: '#8a8f96', '#': '#14161a' });
    // 手雷：绿球 + 拉环
    if (k === 'grenade') return this.draw('grenade', [
      '................', '................', '......GG........', '.....GGG........',
      '....GGGGGG......', '...GGGGGGGG.....', '..GGGGGGGGGG....', '..GGGGGGGGGG....',
      '..GGGGGGGGGG....', '...GGGGGGGG.....', '....GGGGGG......', '................',
      '................', '................', '................', '................'
    ], { G: '#3a5f3a' });
    // 烟雾弹：灰罐
    if (k === 'smoke') return this.draw('smoke', [
      '................', '................', '.....GGGG.......', '.....GYYG.......',
      '.....GYYG.......', '.....GGGG.......', '....GYYYYG......', '...GYYYYYYG.....',
      '...GYYYYYYG.....', '...GYYYYYYG.....', '...GYYYYYYG.....', '....GYYYYG......',
      '.....GGGG.......', '................', '................', '................'
    ], { G: '#6b7076', Y: '#aab0b6' });
    return '';
  }
};

class Squad {
  constructor(team, members) {
    this.team = team; this.members = members;
    this.order = 'attack'; this.orderT = 0; // 当前命令 + 冷却（防刷屏重发）
    this.objective = null;
    this.leader = null; this.leaderName = '';
    this.groups = []; // 分队：每队 { name, members[], target }
    this.autoT = U.rand(18, 26); // 玩家长时间不下令 → AI 队长自动接管（对讲机"队长下令"）
    this.makeLeader();
    this.makeGroups();
  }
  // 随机选 1 名 AI 当队长（召集/带路）；name 含 ★ 的是 spawnAI 预定的队长
  // §8.5：队长必须是存活且未倒地的成员
  makeLeader() {
    const ai = this.members.filter(m => !m.isPlayer && m.alive && !m.down);
    if (!ai.length) return;
    this.leader = ai.find(m => (m.name || '').indexOf('★') >= 0) ||
      ai[Math.floor(Math.random() * ai.length)];
    if (this.leader && this.leader.name && this.leader.name.indexOf('★') < 0) this.leader.name = '★ ' + this.leader.name;
    this.leaderName = (this.leader && this.leader.name) || '队长';
  }
  // §8.5 队长倒地 → 换存活者；原队长救起后不抢回（防队长频繁换人）
  ensureLeader() {
    const alive = this.members.filter(m => !m.isPlayer && m.alive && !m.down);
    if (!alive.length) return;
    if (!this.leader || this.leader.down || !this.leader.alive) {
      const old = this.leader;
      this.leader = alive.find(m => (m.name || '').indexOf('★') >= 0 && m !== old) ||
        alive[Math.floor(Math.random() * alive.length)];
      // 旧队长名字去掉 ★（避免两个 ★ 名牌）
      if (old && old.name && old !== this.leader) old.name = old.name.replace('★ ', '');
      if (this.leader && this.leader.name && this.leader.name.indexOf('★') < 0) this.leader.name = '★ ' + this.leader.name;
      this.leaderName = (this.leader && this.leader.name) || '队长';
    }
  }
  // 蓝队 AI 分 3 组（Alpha/Bravo/Charlie），进攻时各配不同目标
  makeGroups() {
    const ai = this.members.filter(m => !m.isPlayer);
    const names = ['Alpha', 'Bravo', 'Charlie'];
    this.groups = names.map((n, gi) => ({ name: n, members: [], target: null }));
    ai.forEach((m, i) => this.groups[i % 3].members.push(m));
  }
  // 玩家下发命令（对讲机）：group 集合 / free 自由 / attack 进攻 / defend 防守
  command(cmd, fromLeader) {
    if (this.team !== 'blue') return;
    if (this.order === cmd && this.orderT > 0) return; // 冷却防刷
    this.order = cmd; this.orderT = 1.5;
    this.autoT = U.rand(18, 26); // 玩家或队长下令都重置接管计时
    this.cmdFrom = fromLeader ? this.leaderName : null; // 记录命令来源（队长/玩家）
    const u = this.members.find(m => m.isPlayer) || Game.player;
    const ex = this.enemyCenter();
    if (cmd === 'group') this.objective = u ? { x: u.pos.x, z: u.pos.z } : null;      // 集合到玩家
    else if (cmd === 'attack') this.objective = ex ? { x: ex.x, z: ex.z } : null;    // 进攻红方质心
    else if (cmd === 'defend') this.objective = this.defendPt();                      // 防守蓝方据点
    else this.objective = null;                                                        // 自由行动
    // 命令下达：队长优先带路，其余成员清旧路径立即响应
    for (const m of this.members) {
      if (m.ai) { m.ai.orderPt = null; m.ai.path = []; m.ai.repathT = 0; }
    }
    // 分队目标（v2.9.5：两三人小队散到地图各处——attack 各攻一个红方据点/区域，defend 各守一个蓝方据点）
    if (cmd === 'attack' && ex) {
      // 红方侧据点（owner==='red' 或未占领）优先；不足按红方半场四象限补
      const redCaps = (Game.caps || []).filter(c => c.owner !== 'blue');
      this.groups.forEach((g, gi) => {
        if (redCaps[gi]) g.target = { x: redCaps[gi].x, z: redCaps[gi].z }; // 各攻一个红方据点
        else {
          // 按红方半场（地图下半）区域散开：象限偏移
          const q = [[-1, -1], [0, 1.3], [1, -1]][gi % 3];
          g.target = { x: U.clamp(ex.x + q[0] * 60, 20, CFG.WORLD - 20), z: U.clamp(ex.z + q[1] * 45, 20, CFG.WORLD - 20) };
        }
      });
    } else if (cmd === 'defend') {
      // 各守一个蓝方据点（owner 非 red）
      const own = (Game.caps || []).filter(c => c.owner !== 'red');
      this.groups.forEach((g, gi) => {
        g.target = own[gi] ? { x: own[gi].x, z: own[gi].z } : this.objective;
      });
    } else {
      this.groups.forEach(g => g.target = null);
    }
    UI.radio(this);
  }
  // AI 队长接管：玩家长时间（~20s）不下令，队长随机下令（偏进攻）
  // §5.1：玩家倒地也要接管（倒地不能指挥）
  leaderTakeover() {
    if (this.team !== 'blue' || !this.leader || !Game.player || Game.player.dead || Game.player.down) return;
    const r = Math.random();
    const cmd = r < 0.5 ? 'attack' : r < 0.75 ? 'group' : 'defend';
    this.command(cmd, true);
  }
  // §7.2 散兵线侧向偏移（空间类 ×mapScale）：目标点沿垂直前进方向偏移（AIBrain.spreadOffset 同源）
  spreadDest(m, dest) {
    if (!m || !dest || !m.ai) return dest;
    const off = m.ai.spreadOffset ? m.ai.spreadOffset() : ((m.ai.formationIdx % 3 - 1) * 8 * (CFG.mapScale || 1));
    if (!off) return dest;
    const dx = dest.x - m.pos.x, dz = dest.z - m.pos.z;
    const dd = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dest.x + (-dz / dd) * off, z: dest.z + (dx / dd) * off };
  }
  // §5.2 布防掩护：玩家最终死亡 → ≤2 名非狙击/非在读条 AI 占 pt 周围掩体（8~15m×mapScale，protectT=8s）
  prepareCover(pt) {
    if (!pt) return;
    const MS = CFG.mapScale || 1;
    const candidates = this.members.filter(m => m.ai && m.alive && !m.down && m.ai.role !== 'sniper' && m.ai.state !== 'revive');
    // 优先支援兵/突击手
    candidates.sort((a, b) => ((b.ai.role === 'support' ? 1 : 0) + (b.ai.role === 'assault' ? 0.5 : 0)) - ((a.ai.role === 'support' ? 1 : 0) + (a.ai.role === 'assault' ? 0.5 : 0)));
    const picks = candidates.slice(0, 2);
    const near = (Game.coverPts || []).filter(p => {
      const d = Math.sqrt(U.dist2(p.x, p.z, pt.x, pt.z));
      return d >= 8 * MS && d <= 15 * MS;
    });
    picks.forEach((m, i) => {
      const cover = near[i] || near[0] || m.ai.nearestCoverPt() || pt;
      m.ai.orderPt = cover;
      m.ai.protectT = 8;   // 掩护态：据守掩体、对靠近 pt 的敌人开火、不主动冲锋
      m.ai.path = []; m.ai.repathT = 0;
    });
  }
  // §5.3 队长重新集结：≥2 名成员刚归队（救起/重生）→ 目标重设为红方质心
  reformAll() {
    const regrouped = this.members.filter(m => m.alive && !m.down && m.ai && m.ai.regroup);
    if (regrouped.length < 2) return;
    const ex = this.enemyCenter();
    if (ex) this.objective = { x: ex.x, z: ex.z };
    for (const m of this.members) if (m.ai) { m.ai.orderPt = null; m.ai.path = []; m.ai.repathT = 0; }
  }
  // §5.4 波次守势：进攻命令下存活率 < 阈值 → 剩余成员占掩体据守，不冲点
  waveHold() {
    const alive = this.members.filter(m => m.alive && !m.down).length;
    const total = this.members.length || 1;
    if (this.order === 'attack' && alive / total < CFG.WAVE_HOLD_RATIO) {
      if (!this._holding) {
        this._holding = true;
        const ex = this.enemyCenter() || this.objective;
        for (const m of this.members) {
          if (!m.ai || !m.alive || m.down) continue;
          const cp = this._nearestCoverTo(ex);
          m.ai.orderPt = cp || ex;
          m.ai.path = []; m.ai.repathT = 0;
          m.ai.protectT = 8;
        }
      }
    }
  }
  // §5.4 波次恢复：存活率回升（被救起/重生补充）→ 恢复进攻推进
  waveResume() {
    const alive = this.members.filter(m => m.alive && !m.down).length;
    const total = this.members.length || 1;
    if (this._holding && alive / total >= CFG.WAVE_HOLD_RATIO + 0.15) {
      this._holding = false;
      const ex = this.enemyCenter();
      if (ex) this.objective = { x: ex.x, z: ex.z };
      for (const m of this.members) if (m.ai) { m.ai.orderPt = null; m.ai.protectT = 0; m.ai.path = []; m.ai.repathT = 0; }
    }
  }
  _nearestCoverTo(pt) {
    if (!pt) return null;
    let best = null, bestD = 1e9;
    for (const p of (Game.coverPts || [])) {
      const d2 = U.dist2(p.x, p.z, pt.x, pt.z);
      if (d2 < bestD) { bestD = d2; best = p; }
    }
    return best;
  }
  enemyCenter() {
    // v2.7 象限出生修正：红队对角分布（Q2+Q3）下全队质心退化为地图中心——「进攻」命令会冲向中心打空气。
    // 改为「距本方玩家最近的敌方单位」作进攻锚点：语义=找到最近的敌人打，且必然落在敌方象限。
    const u = this.members.find(m => m.isPlayer) || Game.player;
    const es = Game.units.filter(m => m.alive && m.team !== this.team &&
      Number.isFinite(m.pos.x) && Number.isFinite(m.pos.z));
    if (!es.length || !u || !Number.isFinite(u.pos.x)) return null;
    let best = null, bd = Infinity;
    for (const e of es) {
      const d = U.dist2(u.pos.x, u.pos.z, e.pos.x, e.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best ? { x: best.pos.x, z: best.pos.z } : null;
  }
  defendPt() {
    // 防守蓝方据点：取最近被占/被争夺的据点，无则守出生区
    const own = (Game.caps || []).filter(c => c.owner !== 'red').sort((a, b) =>
      U.dist2(a.x, a.z, Game.player.pos.x, Game.player.pos.z) - U.dist2(b.x, b.z, Game.player.pos.x, Game.player.pos.z))[0];
    return own ? { x: own.x, z: own.z } : { x: 70, z: 70 };
  }
  // 每成员的指挥目标：按命令类型 + 分队 + 队长职责
  memberDest(m) {
    const u = m;
    if (this.order === 'group') return this.objective;                    // 全员集合
    if (this.order === 'free') return null;                               // 自由行动
    // attack / defend：队长直扑主目标，各组去各自分配目标（散到地图各处）
    if (m === this.leader) return this.objective;
    const g = this.groups.find(gr => gr.members.includes(m));
    const t = (g && g.target) || this.objective;
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) return null;
    // §7.3 防守环绕：defend 命令下组内成员绕据点圆周边站位（半径 CAP_R + 4m×mapScale，不扎堆旗杆）
    if (this.order === 'defend' && t && g && g.members.length > 1) {
      const mIdx = g.members.indexOf(m);
      const angle = mIdx / g.members.length * Math.PI * 2;
      const r = (CFG.CAP_R || 6) + 4 * (CFG.mapScale || 1);
      return { x: t.x + Math.cos(angle) * r, z: t.z + Math.sin(angle) * r };
    }
    return t;
  }
  /* 给三个分队分配不同的进攻目标：两个据点 + 一个侧翼，避免全队挤在一个点 */
  _assignTargets(ex, ez) {
    const caps = Game.caps || [];
    const ti = Math.max(0, (Game.teams || []).indexOf(this.team));
    const pool = caps.filter(c => c.owner !== this.team);
    const finiteE = Number.isFinite(ex) && Number.isFinite(ez);
    const W = (typeof CFG !== 'undefined' && CFG.WORLD) || 300;
    this.groups.forEach((g, gi) => {
      if (gi === 2 && finiteE) {
        const ang = ti * 0.8 + 0.7;
        const tx = U.clamp(ex + Math.cos(ang) * 26, 15, W - 15);
        const tz = U.clamp(ez + Math.sin(ang) * 26, 15, W - 15);
        if (typeof World !== 'undefined' && World.walkable && !World.walkable(tx, tz)) {
          const c = pool[0] || caps[0];
          g.target = c ? { x: c.x, z: c.z } : null;
        } else g.target = { x: tx, z: tz };
        return;
      }
      if (pool.length) {
        const c = pool[(gi + ti) % pool.length];
        g.target = { x: c.x, z: c.z };
      } else if (finiteE && caps.length) {
        // 所有据点已属于本方：转为扑向敌人/巡弋
        g.target = { x: U.clamp(ex + (gi - 1) * 22, 15, W - 15), z: U.clamp(ez + (gi - 1) * 14, 15, W - 15) };
      } else if (caps.length) {
        const c = caps[gi % caps.length];
        g.target = { x: c.x, z: c.z };
      }
    });
  }

  update(dt) {
    this.orderT = Math.max(0, this.orderT - dt);
    // §8.5：队长倒地 → 自动换存活者
    this.ensureLeader();
    // AI 队长接管计时：玩家长时间不下令 → 队长下令（"队长不一定要是玩家"）
    if (this.team === 'blue') {
      this.autoT -= dt;
      if (this.autoT <= 0) this.leaderTakeover();
    }
    // §5.3/§5.4：2s 节流检查归队集结与波次守势/恢复
    this._waveT = (this._waveT || 0) + dt;
    if (this._waveT >= 2) {
      this._waveT = 0;
      this.reformAll();
      this.waveHold();
      this.waveResume();
    }
    const enemies = Game.units.filter(u => u.alive && u.team !== this.team &&
      Number.isFinite(u.pos.x) && Number.isFinite(u.pos.z));
    if (enemies.length === 0) { this.members.forEach(m => m.ai.update(dt, this)); return; }
    let ex = 0, ez = 0;
    for (const e of enemies) { ex += e.pos.x; ez += e.pos.z; }
    ex /= enemies.length; ez /= enemies.length;
    if (!Number.isFinite(ex) || !Number.isFinite(ez)) { ex = CFG.WORLD / 2; ez = CFG.WORLD / 2; }
    // 没有玩家指挥（红队/自由状态）→ 自动战术；有指挥 → 用 memberDest
    const playerCmd = this.team === 'blue' && this.order !== 'free';
    this._targetT = (this._targetT || 0) - dt;
    if (!playerCmd) {
      if (this.orderT <= 0) {
        this.orderT = U.rand(7, 12);
        const r = Math.random();
        this.tactic = r < 0.3 ? 'flankL' : r < 0.55 ? 'flankR' : 'advance';
        this.objective = { x: ex, z: ez };
        this._assignTargets(ex, ez);
        const side = this.tactic === 'flankL' ? -1 : this.tactic === 'flankR' ? 1 : 0;
        const flankers = this.members.filter(m => m.alive && m.ai.role !== 'sniper').slice(0, 2);
        flankers.forEach((m, i) => {
          const perp = side || (i === 0 ? -1 : 1);
          m.ai.orderPt = { x: ex + perp * 26, z: ez + perp * 18 };
        });
      } else if (this._targetT <= 0) {
        this._targetT = U.rand(6, 10);
        this.objective = { x: ex, z: ez };
        this._assignTargets(ex, ez);
      }
    } else if (this.order === 'attack' && this._targetT <= 0) {
      // 蓝队 attack：定期换目标，避免全队占完一个点后原地发呆
      this._targetT = U.rand(8, 12);
      this.objective = { x: ex, z: ez };
      this._assignTargets(ex, ez);
    }
    for (const m of this.members) m.ai.update(dt, this);
  }
}

/* ---------- HUD / UI ---------- */
const UI = {
  els: {},
  init() {
    this.els.hpFill = document.getElementById('hpFill');
    this.els.hpText = document.getElementById('hpText');
    this.els.ammoCur = document.getElementById('ammoCur');
    this.els.ammoRes = document.getElementById('ammoRes');
    this.els.reloadTag = document.getElementById('reloadTag');
    this.els.aliveB = document.getElementById('aliveB');
    this.els.aliveR = document.getElementById('aliveR');
    this.els.timerT = document.getElementById('timerT');
    this.els.banner = document.getElementById('banner');
    this.els.killfeed = document.getElementById('killfeed');
    this.els.hitmarker = document.getElementById('hitmarker');
    this.els.vignette = document.getElementById('vignette');
    this.els.crosshair = document.getElementById('crosshair');
    this.els.scopeSVG = document.getElementById('scopeSVG');
    this.els.lowhp = document.getElementById('lowhp');
    this.els.mortarUI = document.getElementById('mortarUI');
    this.els.sbRows = document.getElementById('sbRows');
    this.els.scoreboard = document.getElementById('scoreboard');
    this.els.fps = document.getElementById('fps');
    this.els.radioState = document.getElementById('radioState');
    this.els.radioFeed = document.getElementById('radioFeed');
    this.els.radioHints = document.getElementById('radioHints');
    this.els.wpnName = document.getElementById('wpnName');
    this.els.armorFill = document.getElementById('armorFill');
    this.els.invPanel = document.getElementById('invPanel');
    this.els.invAcc = document.getElementById('invAcc');
    this.els.invArmor = document.getElementById('invArmor');
    this.els.invBag = document.getElementById('invBag');
    this.els.invStore = document.getElementById('invStore');
    this.els.toast = document.getElementById('toast');
    this.els.accStatus = document.getElementById('accStatus');
    this.els.accMsg = document.getElementById('accMsg');
    this.els.btnLogout = document.getElementById('btnLogout');
    this.els.zoneVignette = document.getElementById('zoneVignette');
  },
  updateHealth() {
    // v2.5 防御：hp 非有限数（NaN/Infinity）→ 显示 0，UI 永不出现 "NaN%"
    const hp = Number.isFinite(Game.player.hp) ? Math.max(0, Math.round(Game.player.hp)) : 0;
    this.els.hpFill.style.width = hp + '%';
    this.els.hpFill.style.background = hp > 50 ? 'linear-gradient(90deg,#2ecc71,#7ce58a)' : hp > 25 ? 'linear-gradient(90deg,#f1c40f,#ffe28a)' : 'linear-gradient(90deg,#e74c3c,#ff7b6b)';
    this.els.hpText.textContent = hp;
  },
  armorBar(v) {
    if (!this.els.armorFill) return;
    this.els.armorFill.style.width = Math.max(0, Math.min(100, v)) + '%';
  },
  // 轻提示（搜刮反馈等）
  toast(msg) {
    if (!this.els.toast) return;
    this.els.toast.textContent = msg;
    this.els.toast.className = 'show';
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => { this.els.toast.className = ''; }, 2000);
  },
  // 背包面板开关（B 键）
  toggleInventory() {
    if (Game.phase !== 'playing') return;
    this.inventoryOpen = !this.inventoryOpen;
    this.els.invPanel.style.display = this.inventoryOpen ? 'block' : 'none';
    if (this.inventoryOpen) {
      this.inventory();
      if (PC.locked && document.exitPointerLock) document.exitPointerLock(); // 面板打开释放鼠标
    } else {
      if (!PC.locked) requestPointerLockSafe(); // 关闭后重新锁定
    }
  },
  // 渲染背包面板（v3.0：仅随身背包，无账号/个人仓库）
  inventory() {
    if (!this.els.invPanel) return;
    this.els.invAcc.textContent = '随身物资 · 每局统一初始';
    this.els.invArmor.innerHTML = '🛡 护甲：<b>' + Math.round(PlayerGun.armor) + '</b>/100' +
      (PlayerGun.armorkits > 0 ? ' ｜ 护甲包：<b>' + PlayerGun.armorkits + '</b> 个 <button onclick="UI.useArmor()">修复</button>' : '');
    // 物品槽定义：'ammo-xxx' 弹药 / 'medkit' / 'armorkit' / 'grenade' / 'smoke'
    const slots = [
      { k: 'ammo-pistol', ic: Icon.get('ammo-pistol'), nm: '手枪弹' }, { k: 'ammo-rifle', ic: Icon.get('ammo-rifle'), nm: '步枪弹' },
      { k: 'ammo-sniper', ic: Icon.get('ammo-sniper'), nm: '狙击弹' }, { k: 'ammo-shotgun', ic: Icon.get('ammo-shotgun'), nm: '霰弹药' },
      { k: 'medkit', ic: Icon.get('medkit'), nm: '医疗包' }, { k: 'armorkit', ic: Icon.get('armorkit'), nm: '护甲包' },
      { k: 'grenade', ic: Icon.get('grenade'), nm: '手雷' }, { k: 'smoke', ic: Icon.get('smoke'), nm: '烟雾弹' }
    ];
    const cKey = { medkit: 'medkits', armorkit: 'armorkits', grenade: 'grenades', smoke: 'smokes' };
    const bagVal = k => k.startsWith('ammo-') ? (PlayerGun.reserves[k.slice(5)] || 0) : (PlayerGun[cKey[k]] || 0);
    const cell = (k, ic, nm, v) =>
      '<div class="invCell' + (v > 0 ? '' : ' empty') + '" title="' + nm + (v > 0 ? '（数量 ' + v + '）' : '') + '">' +
      (ic ? '<img class="tic" src="' + ic + '" alt="">' : '<span class="ic">?</span>') +
      '<span class="nm">' + nm + '</span>' +
      (v > 0 ? '<span class="st">' + v + '</span>' : '') + '</div>';
    // 随身背包格（局内携带，3×4=12 格：8 物品 + 4 空位）
    this.els.invBag = document.getElementById('invBag');
    if (this.els.invBag) {
      const bagSlots = slots.concat(
        [{ k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }]);
      this.els.invBag.innerHTML = bagSlots.map(s =>
        s.k ? cell(s.k, s.ic, s.nm, bagVal(s.k)) :
          '<div class="invCell empty"><span class="nm">空</span></div>').join('');
    }
    // 仓库列已移除：隐藏仓库格与转移按钮
    this.els.invStore = document.getElementById('invStore');
    if (this.els.invStore) this.els.invStore.style.display = 'none';
    const storeTitle = document.querySelector('#invPanel .invSec:nth-child(2) .invSecTitle');
    if (storeTitle) storeTitle.style.display = 'none';
    const btns = document.querySelectorAll('.invStoreBtns button');
    btns.forEach(b => b.style.display = 'none');
  },
  useArmor() { Backpack.useArmorPack(); },
  aim(on) {
    // 开镜反馈：准星缩放收紧（COD 风），收镜恢复；缩放优于改 width/height（平滑且不破坏结构）
    if (!this.els.crosshair) return;
    this.els.crosshair.style.transform = 'translate(-50%,-50%) scale(' + (on ? 0.55 : 1) + ')';
    this.els.crosshair.style.opacity = on ? '1' : '0.92';
  },
  scope(on) {
    // 狙击镜：显示镜筒边框+mil-dot 分划（镜内自带准星，隐藏普通准星防双星）
    if (!this.els.scopeSVG) return;
    this.els.scopeSVG.style.display = on ? 'block' : 'none';
    if (this.els.crosshair) this.els.crosshair.style.display = on ? 'none' : '';
  },
  reload(t) {
    // PlayerGun.reload 调这里，开始换弹时即时反馈"换弹中..."
    this.els.reloadTag.textContent = '换弹中... ' + t.toFixed(1) + 's';
  },
  flashDmg() {
    this.els.vignette.style.opacity = 1;
    setTimeout(() => this.els.vignette.style.opacity = 0, 220);
  },
  // v1.3：圈外电蓝 vignette（art/zone-visual §3）——独立于受击红闪 #vignette
  zoneVignette(opacity) {
    if (!this.els.zoneVignette) return;
    this.els.zoneVignette.style.opacity = Math.max(0, Math.min(0.45, opacity || 0));
  },
  updateAmmo() {
    const g = PlayerGun, w = WEAPONS[g.cur];
    this.els.ammoCur.textContent = g.mags[g.cur];
    this.els.ammoRes.textContent = '/ ' + g.reserves[g.cur];
    if (this.els.wpnName) {
      const wpnEl = this.els.wpnName;
      const WEAPON_NAMES = {
        pistol: { name: 'P-9 手枪', ico: '🔫' },
        rifle: { name: 'AR-15 步枪', ico: '🔫' },
        sniper: { name: 'SR-98 狙击', ico: '🎯' },
        shotgun: { name: 'SG-12 霰弹', ico: '💥' },
        medkit: { name: '医疗包', ico: '⛑' },
        armorkit: { name: '护甲包', ico: '🛡' },
        grenade: { name: '手雷', ico: '💣' },
        smoke: { name: '烟雾弹', ico: '🌫' },
        mortar: { name: '迫击炮', ico: '💣' }
      };
      const meta = WEAPON_NAMES[g.cur] || (w && w.name ? { name: w.name, ico: '🔫' } : { name: g.cur, ico: '🔫' });
      wpnEl.textContent = meta.ico + ' ' + meta.name;
    }
    if (g.reloading) {
      const left = Math.max(0, g.reloadEnd - performance.now() / 1000);
      this.els.reloadTag.textContent = '换弹中... ' + left.toFixed(1) + 's';
    } else {
      this.els.reloadTag.textContent = (g.mags[g.cur] === 0 && g.reserves[g.cur] > 0) ? '按 R 换弹' : '';
    }
  },
  lowhp(on) { this.els.lowhp.style.opacity = on ? 0.65 : 0; this.els.lowhp.classList.toggle('pulse', !!on); },
  slots(cur) {
    // 首次渲染：.ic emoji → MC 像素贴图（武器用 Icon 弹药图标，消耗品用对应图标）
    if (!this._slotIcons) {
      this._slotIcons = true;
      document.querySelectorAll('.slot').forEach(el => {
        const w = el.dataset.w, ic = el.querySelector('.ic');
        if (!ic) return;
        const img = document.createElement('img');
        img.className = 'tic';
        img.alt = '';
        const map = { pistol: 'ammo-pistol', rifle: 'ammo-rifle', sniper: 'ammo-sniper', shotgun: 'ammo-shotgun',
          medkit: 'medkit', armorkit: 'armorkit', grenade: 'grenade', smoke: 'smoke' };
        const src = map[w] ? Icon.get(map[w]) : (w === 'mortar' ? '' : '');
        if (src) { img.src = src; ic.replaceWith(img); }
      });
    }
    document.querySelectorAll('.slot').forEach(el => {
      el.classList.toggle('on', el.dataset.w === cur);
      const w = el.dataset.w;
      if (w === 'mortar') { el.querySelector('.cnt').textContent = '×' + Game.mortarShots; return; }
      if (WEAPONS[w]) { // 武器槽：弹匣·备弹
        el.classList.toggle('low', (PlayerGun.mags[w] || 0) === 0 && (PlayerGun.reserves[w] || 0) === 0);
        el.querySelector('.cnt').textContent = (PlayerGun.mags[w] || 0) + '·' + (PlayerGun.reserves[w] || 0);
      } else { // 消耗品槽：计数（槽 key 是单数，字段是复数——映射后取值）
        const cMap = { medkit: 'medkits', armorkit: 'armorkits', grenade: 'grenades', smoke: 'smokes' };
        const n = PlayerGun[cMap[w]] || 0;
        el.classList.toggle('low', n === 0);
        el.querySelector('.cnt').textContent = '×' + n;
      }
    });
    // 当前槽选中高亮 + 左键使用提示
    const sel = document.querySelector('.slot[data-w="' + cur + '"]');
    if (sel && WEAPONS[cur] === undefined && cur !== 'mortar') {
      const names = { medkit: '使用回血', armorkit: '使用修甲', grenade: '投掷', smoke: '投掷' };
      sel.title = (names[cur] || '使用') + '（左键）';
    }
  },
  timer() { if (this.els.timerT) this.els.timerT.textContent = U.fmtT(Game.time); },
  // 对讲机：更新队伍状态徽章 + 命令反馈（squad 下发命令时调用）
  radio(squad) {
    const ORDER_NAMES = { group: '集合', free: '自由行动', attack: '进攻', defend: '防守' };
    const s = this.els.radioState, f = this.els.radioFeed;
    if (!s || !f) return;
    const n = ORDER_NAMES[squad.order] || squad.order;
    const fromLeader = squad.cmdFrom; // 命令来源：队长名（AI 接管）或 null（玩家）
    s.textContent = '📻 ' + (fromLeader ? fromLeader + ' 下令' : '蓝队') + ' · ' + n;
    s.className = 'on';
    // 分队反馈（蓝队进攻时显示分组目标）
    let msg = (fromLeader ? '队长命令：' : '命令确认：') + n;
    if (squad.team === 'blue' && squad.order === 'attack') {
      msg += '｜三小队分头行动：' + squad.groups.map(g => g.name).join('/');
    }
    if (squad.order === 'group' && squad.leader) msg += '｜' + squad.leaderName + ' 带队集结';
    f.textContent = msg;
    f.className = 'show';
    clearTimeout(this._radioT);
    this._radioT = setTimeout(() => { f.className = ''; }, 2600);
    // 联动推入信息瀑布（队长命令高亮）
    if (typeof Ticker !== 'undefined' && Ticker.radio) Ticker.radio(msg);
  },
  teams() {
    // v2.8 多队：左侧蓝队（你）存活/击杀；右侧"敌方"= 非蓝队合计（多队下不逐队占 HUD）
    const b = Game.units.filter(u => u.team === 'blue' && u.alive).length;
    const r = Game.units.filter(u => u.team !== 'blue' && u.alive).length;
    this.els.aliveB.textContent = b;
    this.els.aliveR.textContent = r;
    // 比分与据点状态
    const sb = document.getElementById('scoreB'), sr = document.getElementById('scoreR');
    if (sb) {
      sb.textContent = Game.score.blue || 0;
      sr.textContent = Game.teams.filter(t => t !== 'blue').reduce((s, t) => s + (Game.score[t] || 0), 0);
    }
    const cs = document.getElementById('capStat');
    if (cs && Game.caps && Game.caps.length) {
      cs.innerHTML = Game.caps.map(c =>
        '<span style="color:' + CFG.teamColor(c.owner || 'neutral').css + '">' + c.id + (c.owner ? '●' : '○') + '</span>'
      ).join(' ');
    }
  },
  killfeed(a, t, head, cause) {
    const d = document.createElement('div');
    d.className = 'kf';
    const w = head ? '💀 爆头 ' : '';
    // cause：'bleed' 流血身亡 / 'zone' 圈外阵亡（最终死亡 killfeed 两级语义，R6）
    const c = cause === 'bleed' ? '（流血身亡）' : cause === 'zone' ? '（圈外阵亡）' : '';
    d.innerHTML = '<span class="p">' + esc(a) + '</span> ' + w + '击杀了 <span class="e">' + esc(t) + '</span>' + c;
    this.els.killfeed.prepend(d);
    setTimeout(() => d.remove(), 4200);
    // 联动推入信息瀑布
    if (typeof Ticker !== 'undefined' && Ticker.kill) Ticker.kill(a, t, head);
  },
  // R6：击倒 killfeed（与"击杀"两级信息）
  downfeed(a, t) {
    const d = document.createElement('div');
    d.className = 'kf';
    d.innerHTML = '<span class="p">' + esc(a) + '</span> 击倒了 <span class="e">' + esc(t) + '</span> ⚠';
    this.els.killfeed.prepend(d);
    setTimeout(() => d.remove(), 4200);
  },
  // 救援进度条（hold-to-revive，§2.2）：p ∈ [0,1]
  reviveBar(p) {
    const el = document.getElementById('reviveBar');
    if (el) el.style.width = U.clamp(p, 0, 1) * 100 + '%';
  },
  banner(msg, color, dur) {
    this.els.banner.textContent = msg;
    this.els.banner.style.color = color || '#ffd166';
    this.els.banner.style.opacity = 1;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.els.banner.style.opacity = 0, (dur || 2) * 1000);
  },
  showHit(kill) {
    this.els.hitmarker.classList.toggle('kill', kill);
    this.els.hitmarker.style.opacity = 1;
    clearTimeout(this._ht);
    this._ht = setTimeout(() => this.els.hitmarker.style.opacity = 0, 130);
  },
  scoreboard(show) {
    if (!show) { this.els.scoreboard.style.display = 'none'; return; }
    const rows = Game.units.slice().sort((a, b) => b.kills - a.kills);
    this.els.sbRows.innerHTML = rows.map(u =>
      '<div style="color:' + CFG.teamColor(u.team).css + '"><span class="n">' + esc(u.name) + (u === Game.player ? ' (你)' : u.ai ? ' [AI]' : ' [玩家]') + '</span><span class="k">' + u.kills + '</span><span class="d">' + u.deaths + '</span></div>'
    ).join('');
    this.els.scoreboard.style.display = 'block';
  },
  mortarUI(show) {
    this.els.mortarUI.style.display = show ? 'block' : 'none';
    if (show) {
      const m = Game;
      let yawDeg = ((m.mortarYaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) * 180 / Math.PI;
      let dist = 0;
      if (m.mortarTarget && m.player) dist = Math.round(Math.sqrt(U.dist2(m.player.pos.x, m.player.pos.z, m.mortarTarget.x, m.mortarTarget.z)));
      this.els.mortarUI.innerHTML = '<b>迫击炮</b><br>鼠标左右 = 方位 · 滚轮 = 仰角 · 左键开火<br>' +
        '方位 ' + Math.round(yawDeg) + '° · 仰角 ' + m.mortarAngle.toFixed(0) + '° · 距离 ' + dist + 'm<br>' +
        '炮弹 <b>' + m.mortarShots + '</b> · 冷却 ' + m.mortarCd.toFixed(1) + 's<br>按 M / Esc 退出';
    }
  },
  showIncoming(x, z) {
    this.banner('⚠ 炮弹来袭', '#ff6b6b', 2.4);
    AudioFX.incoming();
    this._incoming = { x, z, t: 3 };
  },
  mmIncoming() {
    if (this._incoming) { this._incoming.t -= 1 / 8; if (this._incoming.t <= 0) this._incoming = null; }
    return this._incoming;
  },
  fps(v) { this.els.fps.textContent = v + ' FPS'; }
};
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

/* ---------- Minecraft 风信息瀑布（屏幕左侧中部 · 自上而下滚动） ----------
 * 功能：启动一次性播完帮助；实时显示击杀/对讲机/聊天/系统消息；
 *       内置输入框可发聊天，/ 开头为调试指令（单机或房主有权限）。
 * ============================================================== */
const Ticker = {
  el: null, input: null,
  helpList: [],     // 帮助消息（播放一次）
  helpIdx: 0,
  timer: null,      // 帮助播放计时器
  delay: 3600,      // 每条消息停留时长
  maxMsgs: 7,       // 同屏最多消息数
  // 权限判定：单机 or 房主
  canCmd() {
    if (typeof Net !== 'undefined' && Net.connected) return !!(Net.isHost);
    return true; // 未联网=单机
  },
  init() {
    this.el = document.getElementById('ticker');
    this.input = document.getElementById('chatInput');
    if (!this.el) return;
    // 点击输入框自动释放指针锁定；失焦恢复（仅对局中）
    if (this.input) {
      this.input.addEventListener('focus', () => {
        window.__chatOpen = true; // 抑制 pointerlockchange 误弹暂停
        if (typeof PC !== 'undefined' && PC.locked && document.exitPointerLock) document.exitPointerLock();
      });
      this.input.addEventListener('blur', () => {
        window.__chatOpen = false;
        // 清空聊天期间误入的按键残留（W/A/S/D/空格等会被 PC 的 document keydown 收集）
        if (typeof PC !== 'undefined' && PC.keys && PC.keys.clear) PC.keys.clear();
        // 发送/关闭后恢复鼠标锁定（对局中）
        if (typeof Game !== 'undefined' && Game.phase === 'playing' && !PC.locked && typeof requestPointerLockSafe === 'function') requestPointerLockSafe();
      });
    }
    // T 键快捷打开聊天（鼠标锁定时无法点击输入框，需按键唤起）
    document.addEventListener('keydown', e => {
      if ((e.key === 't' || e.key === 'T') && !e.ctrlKey && !e.metaKey &&
          typeof Game !== 'undefined' && Game.phase === 'playing' &&
          this.input && document.activeElement !== this.input) {
        e.preventDefault();
        e.stopPropagation();
        // 解锁鼠标并聚焦输入框
        if (typeof PC !== 'undefined' && PC.locked && document.exitPointerLock) document.exitPointerLock();
        this.input.focus();
      }
    });
    // 帮助信息：启动播放一次即止
    this.helpList = [
      '<b>战地突击</b> 战术FPS · 在这里展现你的枪法',
      '<b>WASD</b>移动 <b>Shift</b>疾跑 <b>空格</b>跳跃 <b>Ctrl</b>潜伏',
      '<b>,</b>向左侧身 <b>.</b>向右侧身（人物随之侧倾）',
      '<b>1-8</b>切槽 <b>R</b>换弹 <b>F</b>近战 <b>G</b>手雷 <b>H</b>烟雾',
      '<b>E</b>搜刮尸体/交互 · <b>B</b>背包 · <b>Tab</b>记分板 · <b>Esc</b>暂停',
      '对讲机 <b>Z</b>集合 <b>X</b>自由 <b>C</b>进攻 <b>V</b>防守',
      '聊天:按 <b>T</b> 打开输入框，回车发送；<b>/help</b> 查看调试指令',
      '击倒可按 <b>E</b> 处决 · 队友倒地按 <b>E</b> 救援',
    ];
    this.playHelp();
    // 回车发送聊天 / 执行指令 + Tab 命令补全
    if (this.input) {
      this.input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { this.send(this.input.value); return; }
        if (e.key === 'Tab') { e.preventDefault(); this.complete(); return; }
      });
      // 输入时避免触发游戏键位
      this.input.addEventListener('keyup', e => e.stopPropagation());
      this.el.style.pointerEvents = 'auto';
    }
  },
  // Tab 补全：/ 开头补全指令/选择器/人名；否则补全玩家/AI 人名
  complete() {
    if (!this.input) return;
    const v = this.input.value;
    const at = this.input.selectionStart || v.length;
    const line = v.slice(0, at);
    const space = line.lastIndexOf(' ');
    const frag = line.slice(space + 1);
    if (!frag) return;
    const candidates = [];
    const G = (typeof Game !== 'undefined' && Game) ? Game : null;
    const isCmd = frag.charAt(0) === '/';
    if (isCmd) {
      const cmds = ['/kill','/tp','/enablefly','/setinvincible','/give','/win','/speed','/help'];
      candidates.push(...cmds.filter(c => c.startsWith(frag)));
    }
    // 选择器/人名补全（/kill|/tp|/give|/setinvincible 第二参数起）
    const head = line.split(/\s+/)[0] || '';
    if (['/kill','/tp','/give','/setinvincible'].includes(head) && frag && !frag.startsWith('/')) {
      candidates.push('@s','@e','@a','@p');
      if (G && G.units) {
        G.units.forEach(u => { const n = (u.name || '').replace(/^★\s*/, ''); if (n && n.toLowerCase().startsWith(frag.toLowerCase())) candidates.push(n); });
      }
    }
    if (candidates.length === 1) {
      this.input.value = v.slice(0, space + 1) + candidates[0] + ' ';
    } else if (candidates.length > 1 && frag) {
      let c = candidates[0];
      for (let i = 1; i < candidates.length; i++) {
        let j = 0;
        while (j < c.length && j < candidates[i].length && c[j] === candidates[i][j]) j++;
        c = c.slice(0, j);
      }
      if (c.length > frag.length) this.input.value = v.slice(0, space + 1) + c;
      this.add('候选: ' + candidates.slice(0, 8).join('  ') + (candidates.length > 8 ? ' …' : ''), 'sys');
    }
  },
  // 帮助消息：依次掉落，播完即停
  playHelp() {
    if (this.helpIdx >= this.helpList.length) { this.helpIdx = 0; return; }
    this.push(this.helpList[this.helpIdx], 'help');
    this.helpIdx++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.playHelp(), this.delay);
  },
  // 通用推送：type → sys/system | kill | radio | chat | help
  push(html, type) { this.add(html, type); },
  add(html, type) {
    if (!this.el) return;
    while (this.el.querySelectorAll('.tickMsg').length >= this.maxMsgs) {
      const first = this.el.querySelector('.tickMsg');
      if (first) { first.classList.add('old'); setTimeout(() => first.remove(), 600); }
    }
    const d = document.createElement('div');
    d.className = 'tickMsg' + (type && type !== 'sys' ? ' ' + type : ' sys');
    d.innerHTML = html;
    this.el.insertBefore(d, this.input || null);
    requestAnimationFrame(() => { d.classList.add('new'); });
    setTimeout(() => {
      if (d && d.parentNode) {
        d.classList.remove('new'); d.classList.add('old');
        setTimeout(() => { if (d && d.parentNode) d.remove(); }, 600);
      }
    }, this.delay + 600);
    // 帮助播放被打断后不再自动续播
    if (type === 'help') clearTimeout(this.timer);
  },
  // 击杀消息（由 UI.killfeed 联动调用）
  kill(a, t, head) {
    this.add((head ? '💀 <b>爆头</b> ' : '⚔ ') + '<b>' + esc(a) + '</b> 击杀了 <b>' + esc(t) + '</b>', 'kill');
  },
  // 对讲机/队长命令消息
  radio(msg) {
    this.add('📻 ' + msg, 'radio');
  },
  // 玩家聊天消息
  chat(who, msg) {
    this.add('<span class="who">' + esc(who) + '</span>：' + esc(msg), 'chat');
  },
  // 输入框发送：/ 开头=调试指令（需权限）；否则广播聊天
  send(raw) {
    const v = (raw || '').trim();
    if (!v) return;
    if (this.input) this.input.value = '';
    // 发送后立即失焦：清空聊天期间的按键残留、恢复鼠标锁定与游戏操控
    if (this.input) { window.__chatOpen = false; this.input.blur(); }
    if (typeof PC !== 'undefined' && PC.keys && PC.keys.clear) PC.keys.clear();
    if (v.charAt(0) === '/') { this.cmd(v); return; }
    if (!Game.player) { this.add('系统：对局中才能发言', 'sys'); return; }
    if (typeof Net !== 'undefined' && Net.connected && Net.send) {
      Net.send({ t: 'chat', msg: v, who: Game.player.name || '我' });
    }
    this.chat(Game.player.name || '我', v);
  },
  /* ---------- 调试指令（Minecraft 实体选择器语法，单机/房主可用） ----------
   * /kill <选择器>        @s 自己 / @e 全部 / @a 玩家 / 人名
   * /tp  <选择器> x y z   传送（留空坐标 → 传送到玩家自己处）
   * /enablefly <bool>     飞行开关（@s 玩家自身）
   * /win <队伍>           直接结束对局并指定胜者（blue/red/队伍名/id）
   * /speed <int>          玩家移动速度倍率（1 恢复）
   * /help                 查看所有指令
   * ================================================================ */
  // 实体选择器 → 单位数组；未命中返回 null
  resolve(target) {
    const G = (typeof Game !== 'undefined' && Game) ? Game : null;
    if (!G || !G.units) return null;
    const t = (target || '').trim();
    if (!t) return null;
    if (t === '@s') return [G.player].filter(Boolean);
    if (t === '@p') return [G.player].filter(Boolean);
    if (t === '@e') return G.units.filter(u => u.life !== 'dead');
    if (t === '@a') return G.units.filter(u => !u.ai && u.life !== 'dead');
    // 人名匹配（★ x 前缀人名也支持输入时省略 ★）
    const name = t.replace(/^★\s*/, '').toLowerCase();
    const hit = G.units.filter(u => (u.life !== 'dead') && (u.name || '').toLowerCase().replace(/^★\s*/, '') === name);
    return hit.length ? hit : null;
  },
  cmd(line) {
    const G = (typeof Game !== 'undefined' && Game) ? Game : null;
    const PC2 = (typeof PC !== 'undefined' && PC) ? PC : null;
    if (!this.canCmd()) { this.add('系统：<b>无权限</b>（需单机或房主）', 'sys'); return; }
    const p = line.slice(1).trim().split(/\s+/);
    const c = (p[0] || '').toLowerCase();
    switch (c) {
      case 'help':
        this.add('指令：<b>/kill</b> [选择器] · <b>/tp</b> [选择器] [x y z] · <b>/enablefly</b> [bool] · <b>/win</b> [队伍] · <b>/speed</b> [倍率] · <b>/setinvincible</b> [选择器] · <b>/give</b> [选择器] [物资id]', 'sys');
        break;
      case 'kill': {
        if (!G || !G.player) { this.add('系统：对局中才可用', 'sys'); break; }
        const sel = this.resolve(p[1]);
        if (!sel || sel.length === 0) { this.add('系统：选择器无目标（/kill @s 自己 · @e 全部 · @a 玩家 · 人名）', 'sys'); break; }
        const names = sel.map(u => u.name || '目标');
        // 走完整死亡事件链：hp=0 → downOrKill（击倒→处决/直接死亡）→ killUnit（计分/击杀UI/战利品/观战/全灭判定）
        sel.forEach(u => { if (u.life === 'dead') return; u.hp = 0; G.downOrKill(u, G.player, false); });
        if (typeof MiniMap !== 'undefined' && MiniMap.draw) MiniMap.draw();
        this.add('系统：已击杀 <b>' + esc(names.join('、')) + '</b>', 'sys');
        break;
      }
      case 'tp': {
        if (!G || !G.units) { this.add('系统：对局中才可用', 'sys'); break; }
        const sel = this.resolve(p[1]);
        if (!sel || sel.length === 0) { this.add('用法: /tp [@s|@e|@a|人名] x y z（留空坐标=传送到玩家）', 'sys'); break; }
        let X, Y, Z;
        if (p[2] !== undefined && !isNaN(parseFloat(p[2]))) {
          X = parseFloat(p[2]); Y = parseFloat(p[3]) !== undefined ? parseFloat(p[3]) : World.heightAt(X, sel[0].pos.z); Z = parseFloat(p[4]) !== undefined ? parseFloat(p[4]) : sel[0].pos.z;
        } else {
          X = G.player.pos.x; Y = G.player.pos.y; Z = G.player.pos.z; // 无坐标 → 传送到玩家处
        }
        X = U.clamp(X, 1, CFG.WORLD - 1); Z = U.clamp(Z, 1, CFG.WORLD - 1);
        if (Y === undefined || isNaN(Y)) Y = World.heightAt(X, Z);
        sel.forEach(u => { u.pos.set(X, Y, Z); if (typeof MiniMap !== 'undefined' && MiniMap.draw) MiniMap.draw(); });
        this.add('系统：已传送 <b>' + esc(sel.length) + '</b> 个目标 → ' + Math.round(X) + ',' + Math.round(Y) + ',' + Math.round(Z), 'sys');
        break;
      }
      case 'enablefly': {
        if (!PC2) { this.add('系统：控制器未就绪', 'sys'); break; }
        const arg = (p[1] || '').toLowerCase();
        const want = arg === 'true' || arg === '1' || arg === 'on' ? true
          : arg === 'false' || arg === '0' || arg === 'off' ? false : !PC2.fly;
        PC2.fly = want;
        this.add('系统：飞行已' + (want ? '<b>开启</b>（空格上浮 · Shift下潜）' : '<b>关闭</b>'), 'sys');
        break;
      }
      case 'speed': {
        if (!PC2) { this.add('系统：控制器未就绪', 'sys'); break; }
        const n = parseInt(p[1], 10);
        if (isNaN(n) || n <= 0) { this.add('用法: /speed [倍率]（如 1 恢复 · 2 两倍速）', 'sys'); break; }
        PC2.speedMul = n;
        // 同步 Game.player.moveMul 兼容旧读法（若有）
        if (G && G.player) G.player.moveMul = n;
        this.add('系统：移动速度 x<b>' + n + '</b>', 'sys');
        break;
      }
      case 'setinvincible':
      case 'invincible': {
        if (!G || !G.units) { this.add('系统：对局中才可用', 'sys'); break; }
        const sel = this.resolve(p[1]);
        if (!sel || sel.length === 0) { this.add('用法: /setinvincible [@s|@e|@a|人名]', 'sys'); break; }
        // 无参数二值时切换；显式 true/false 设定
        const arg = (p[2] || '').toLowerCase();
        const want = arg === 'true' || arg === '1' || arg === 'on' ? true
          : arg === 'false' || arg === '0' || arg === 'off' ? false
          : !(sel[0].invincible); // 默认切换
        sel.forEach(u => { u.invincible = want; });
        this.add('系统：<b>' + esc(sel.length) + '</b> 个目标无敌' + (want ? '开启' : '关闭'), 'sys');
        break;
      }
      case 'give': {
        if (!G || !G.units) { this.add('系统：对局中才可用', 'sys'); break; }
        const sel = this.resolve(p[1]);
        if (!sel || sel.length === 0) { this.add('用法: /give [@s|@e|@a|人名] [物资id]', 'sys'); break; }
        const id = (p[2] || '').toLowerCase();
        // 物资表：ammo-pistol/rifle/sniper/shotgun / medkit / armorkit / grenade / smoke
        if (!['ammo-pistol','ammo-rifle','ammo-sniper','ammo-shotgun','medkit','armorkit','grenade','smoke'].includes(id)) {
          this.add('物资id: ammo-pistol/ammo-rifle/ammo-sniper/ammo-shotgun · medkit · armorkit · grenade · smoke', 'sys');
          break;
        }
        sel.forEach(u => {
          if (u === G.player) { // 玩家走 PlayerGun 背包
            if (id.startsWith('ammo-')) { const w = id.slice(5); if (PlayerGun.reserves[w] !== undefined) PlayerGun.reserves[w] += 60; }
            else if (id === 'medkit') PlayerGun.medkits += 5;
            else if (id === 'armorkit') PlayerGun.armorkits += 2;
            else if (id === 'grenade') PlayerGun.grenades += 3;
            else if (id === 'smoke') PlayerGun.smokes += 2;
            if (typeof UI !== 'undefined' && UI.slots) UI.slots(PlayerGun.cur);
          } else if (u.ai) { // AI 走 ai 资源
            if (id.startsWith('ammo-')) { const w = id.slice(5); if (!u.ai.reserveMap) u.ai.reserveMap = {}; u.ai.reserveMap[w] = (u.ai.reserveMap[w] || 0) + 60; }
            else if (id === 'medkit') u.ai.medkits = (u.ai.medkits || 0) + 3;
            else if (id === 'armorkit') u.armor = Math.min(100, u.armor + 50);
            else if (id === 'grenade') u.grenades = (u.grenades || 0) + 3;
            else if (id === 'smoke') u.smokes = (u.smokes || 0) + 2;
          }
        });
        if (typeof UI !== 'undefined' && UI.updateAmmo) UI.updateAmmo();
        this.add('系统：已给 <b>' + esc(sel.length) + '</b> 个目标发放 <b>' + esc(id) + '</b>', 'sys');
        break;
      }
      case 'win': {
        if (!G) { this.add('系统：对局未开始', 'sys'); break; }
        const target = (p[1] || '').toLowerCase();
        let team = null;
        if (!target) team = 'blue';
        else {
          for (const t of G.teams) {
            if (t === target || ((CFG.TEAM_NAMES && CFG.TEAM_NAMES[t] || '').toLowerCase() === target)) { team = t; break; }
          }
          if (!team) team = G.teams.includes(target) ? target : ('red' === target ? 'red' : null); // 红/蓝直配
          if (!team) { this.add('可用队伍：' + G.teams.join('/'), 'sys'); break; }
        }
        // 按吃鸡语义：指定队之外全员淘汰 → 该队获胜（endMatchByElim 参数=败者）
        const loser = G.teams.find(t => t !== team) || (team === 'blue' ? 'red' : 'blue');
        G.units.forEach(u => { if (u.life !== 'dead' && u.team !== team) { u.hp = 0; u.alive = false; u.life = 'dead'; u.dead = true; } });
        if (typeof MiniMap !== 'undefined' && MiniMap.draw) MiniMap.draw();
        this.add('系统：队伍 <b>' + esc(team) + '</b> 获胜！', 'sys');
        G.endMatchByElim(loser); // 决赛终局（吃鸡胜负）
        break;
      }
      default:
        this.add('未知指令 <b>' + esc(c) + '</b>，输入 /help 查看：<b>/kill /tp /enablefly /win /speed</b>', 'sys');
    }
  }
};

/* ---------- 小地图（动态层） ---------- */
const MiniMap = {
  t: 0,
  // 默认「玩家居中 + 北恒上」；?rotate=1 启用「朝向恒上」旋转模式（玩家仍居中）。v1.11.2
  rotate: false,
  draw() {
    this.t++;
    if (this.t % 2) return; // 8Hz
    const c = document.getElementById('mm'), g = c.getContext('2d');
    const s = 188 / CFG.WORLD;
    const cx = 94, cy = 94; // 小地图中心
    const alive = !!(Game.player && Game.player.alive);
    // 模式：默认「玩家居中 + 北恒上」；?rotate=1 启用「朝向恒上」旋转（玩家仍居中）
    const followRotate = (typeof location !== 'undefined' && /[?&]rotate=1/.test(location.search));
    const rotating = followRotate && alive;
    const centered = alive; // 存活时相机以玩家为中心（玩家居中）
    const camX = centered ? Game.player.pos.x : CFG.WORLD / 2;
    const camZ = centered ? Game.player.pos.z : CFG.WORLD / 2;
    // 旋转角：朝向恒上。canvas rotate 顺时针，取 -(π+yaw) 保证世界相对玩家手性正确
    const phi = rotating ? (-Math.PI - Game.player.yaw) : 0;
    g.clearRect(0, 0, 188, 188);
    // 始终铺底色：居中/旋转时世界边缘会露出底图外区域
    g.fillStyle = World.minimapBg || '#202a33'; g.fillRect(0, 0, 188, 188);
    // 静态底图（离屏缓存）。统一变换：相机居中 + 可选旋转，确保与标记 project() 完全一致
    g.save();
    g.translate(cx, cy);
    if (rotating) g.rotate(phi);
    g.translate(-camX * s, -camZ * s);
    g.drawImage(World.minimapStatic, 0, 0);
    g.restore();
    // 世界坐标 → 小地图像素：先减相机（居中），可选旋转（朝向恒上）；标记字形保持正立
    const project = (wx, wz) => {
      let x = wx * s - camX * s, y = wz * s - camZ * s;
      if (rotating) {
        const co = Math.cos(phi), si = Math.sin(phi);
        const rx = x * co - y * si, ry = x * si + y * co;
        x = rx; y = ry;
      }
      return [cx + x, cy + y];
    };

    // 朝向罗盘：北 = 世界 -Z。旋转时 N 落到真实北方向（随地图转）；非旋转时固定在顶部
    if (rotating) {
      const [nx, ny] = project(CFG.WORLD / 2, 0);
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('N', nx, ny);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillText('N', 94, 2);
    }

    // 玩家为中心的距离环（25m / 50m）：始终以玩家（小地图中心）为原点，辅助迫击炮/烟雾/救援距离判断
    if (alive) {
      const pr = 25 * s, pr2 = 50 * s;
      g.strokeStyle = 'rgba(255,255,255,0.10)'; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, pr, 0, 7); g.stroke();
      g.beginPath(); g.arc(cx, cy, pr2, 0, 7); g.stroke();
    }

    // v1.3：缩圈（画在最底层，据点/单位/机制标记叠在圈上；art/zone-visual §2）
    if (typeof Mechanics !== 'undefined' && Mechanics.zone && Mechanics.zone.active) {
      const z = Mechanics.zone;
      const [zx, zz] = project(z.center.x, z.center.z);
      // 当前圈：白实线 + 极淡填充
      g.strokeStyle = '#f0f4f8'; g.lineWidth = 1.5;
      g.beginPath(); g.arc(zx, zz, Math.max(0, z.curR * s), 0, 7); g.stroke();
      g.fillStyle = 'rgba(240,244,248,0.05)';
      g.beginPath(); g.arc(zx, zz, Math.max(0, z.curR * s), 0, 7); g.fill();
      // 预告圈：电蓝虚线（下阶段落点；最终阶段无预告圈）
      if (z.phaseIdx < z.phases.length - 1) {
        g.strokeStyle = '#2f7fe8'; g.lineWidth = 1.2;
        g.setLineDash && g.setLineDash([5, 4]);
        g.beginPath(); g.arc(zx, zz, Math.max(0, z.phases[z.phaseIdx + 1].r * s), 0, 7); g.stroke();
        g.setLineDash && g.setLineDash([]);
      }
    }
    // 据点（A-I 分区）—— §4.3 形状编码：蓝=实心圆 / 非蓝队=方块 / 中立=空心圆（v2.8 多队）
    // v1.10.4：据点叠加层半透明，露出底图道路/墙体，减少遮挡
    if (Game.caps) for (const cp of Game.caps) {
      const col = CFG.teamColor(cp.owner || 'neutral');
      const [cpx, cpz] = project(cp.x, cp.z), r = Math.max(4, cp.r * s);
      g.lineWidth = 1.5; g.strokeStyle = col.css;
      if (col.shape === 'hollow') {
        g.globalAlpha = 0.6;
        g.beginPath(); g.arc(cpx, cpz, r, 0, 7); g.stroke();
        g.globalAlpha = 1;
      } else if (col.shape === 'dashed') { // 非蓝队：半透明实心方块 + 白描边
        g.globalAlpha = 0.5;
        g.fillStyle = col.css;
        g.fillRect(cpx - r, cpz - r, r * 2, r * 2);
        g.globalAlpha = 1;
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.strokeRect(cpx - r, cpz - r, r * 2, r * 2);
      } else {                            // 蓝方：半透明实心圆
        g.globalAlpha = 0.5;
        g.fillStyle = col.css;
        g.beginPath(); g.arc(cpx, cpz, r, 0, 7); g.fill();
        g.globalAlpha = 1;
      }
      // 据点字母（深描边保证任意底色可读，保持不透明）
      g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = 2.5; g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.strokeText(cp.id, cpx, cpz);
      g.fillStyle = '#ffffff'; g.fillText(cp.id, cpx, cpz);
    }
    // v1.4/v1.6：四地标标记（base/refinery/stadium/megatower）——金色菱形 + 字母标签，与据点分层
    if (World.mapDef && World.mapDef.buildings) {
      const LM = { base: 'B', refinery: 'R', stadium: 'S', megatower: 'M' };
      for (const b of World.mapDef.buildings) {
        if (!b || !b.key || !LM[b.key]) continue;
        const [lx, lz] = project(b.x + (b.w || 0) / 2, b.z + (b.d || 0) / 2);
        g.fillStyle = '#ffd166';
        g.strokeStyle = '#7a5c1a';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(lx, lz - 3.5);
        g.lineTo(lx + 3, lz);
        g.lineTo(lx, lz + 3.5);
        g.lineTo(lx - 3, lz);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = '#3a2c08'; g.font = 'bold 7px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(LM[b.key], lx, lz);
      }
    }
    // 烟雾
    for (const sm of FX.smokes) {
      const [sx, sz] = project(sm.pos.x, sm.pos.z);
      g.fillStyle = 'rgba(180,185,190,' + (0.5 * (1 - sm.t / sm.life)) + ')';
      g.beginPath(); g.arc(sx, sz, sm.r * s, 0, 7); g.fill();
    }
    // 迫击炮落点
    if (Game.mortarMode && Game.mortarTarget) {
      const [mx, mz] = project(Game.mortarTarget.x, Game.mortarTarget.z);
      g.strokeStyle = '#ffd166'; g.lineWidth = 2;
      g.beginPath(); g.arc(mx, mz, 5, 0, 7); g.stroke();
    }
    // 来袭预警
    const inc = UI.mmIncoming();
    if (inc) {
      const [ix, iz] = project(inc.x, inc.z);
      g.strokeStyle = '#ff6b6b'; g.lineWidth = 2;
      g.beginPath(); g.arc(ix, iz, 8 + (3 - inc.t) * 2, 0, 7); g.stroke();
    }
    // v1.2：机制标记（探照灯曝露 ping / 空投信标 / 炮击警示）
    if (typeof Mechanics !== 'undefined' && Mechanics.marks) {
      for (const mk of Mechanics.marks) {
        const [kx, kz] = project(mk.x, mk.z);
        const k = Math.min(1, mk.t / mk.life);
        g.globalAlpha = 1 - k * 0.6;
        g.strokeStyle = mk.color; g.lineWidth = 2;
        g.beginPath(); g.arc(kx, kz, (mk.size || 6) * (0.8 + k * 0.6), 0, 7); g.stroke();
        g.globalAlpha = 1;
      }
    }
    // 单位 —— §4.3：蓝=实心圆 / 非蓝队=实心方块（形状编码，颜色随队；v2.8 多队）
    for (const u of Game.units) {
      if (!u.alive) continue;
      const [px, pz] = project(u.pos.x, u.pos.z);
      const isPlayer = (u === Game.player);
      if (u.team === 'blue') {
        g.fillStyle = isPlayer ? '#00e0ff' : CFG.teamColor('blue').css;
        g.beginPath(); g.arc(px, pz, isPlayer ? 5 : 3.5, 0, 7); g.fill();
      } else { // 敌方：方块 + 队伍色（形状编码，不依赖颜色）
        const r = 3.5;
        g.fillStyle = CFG.teamColor(u.team).css;
        g.fillRect(px - r, pz - r, r * 2, r * 2);
      }
      if (isPlayer) {
        g.strokeStyle = '#ffffff'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(px - 7, pz); g.lineTo(px + 7, pz); g.stroke();
        g.beginPath(); g.moveTo(px, pz - 7); g.lineTo(px, pz + 7); g.stroke();
      }
    }
    // §8.6 倒地队友标记（蓝色脉冲十字，仅蓝队）+ 出生无敌帧白圈
    for (const u of Game.units) {
      if (u.down && u.team === 'blue') {
        const [px, pz] = project(u.pos.x, u.pos.z);
        const pulse = 3 + Math.sin(performance.now() / 300 + (u.id ? u.id.length : 0)) * 1.5;
        g.strokeStyle = '#00e0ff'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(px - pulse, pz); g.lineTo(px + pulse, pz); g.stroke();
        g.beginPath(); g.moveTo(px, pz - pulse); g.lineTo(px, pz + pulse); g.stroke();
      }
      if (u.spawnProtT > 0) {
        const [px, pz] = project(u.pos.x, u.pos.z);
        g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(px, pz, 4.5, 0, 7); g.stroke();
      }
    }
    // 玩家朝向：旋转模式下朝向恒为「上」，画一段向上短箭头；非旋转模式按下方向量画
    if (alive) {
      const [px, pz] = project(Game.player.pos.x, Game.player.pos.z);
      g.strokeStyle = '#fff'; g.lineWidth = 1.5;
      if (rotating) {
        g.beginPath(); g.moveTo(px, pz); g.lineTo(px, pz - 10); g.stroke();
      } else {
        g.beginPath(); g.moveTo(px, pz);
        g.lineTo(px + Math.sin(Game.player.yaw) * 9, pz + Math.cos(Game.player.yaw) * 9);
        g.stroke();
      }
    }
  }
};
