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
    const es = Game.units.filter(m => m.alive && m.team !== this.team);
    if (!es.length) return null;
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
    // §7.3 防守环绕：defend 命令下组内成员绕据点圆周边站位（半径 CAP_R + 4m×mapScale，不扎堆旗杆）
    if (this.order === 'defend' && t && g && g.members.length > 1) {
      const mIdx = g.members.indexOf(m);
      const angle = mIdx / g.members.length * Math.PI * 2;
      const r = (CFG.CAP_R || 6) + 4 * (CFG.mapScale || 1);
      return { x: t.x + Math.cos(angle) * r, z: t.z + Math.sin(angle) * r };
    }
    return t;
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
    const enemies = Game.units.filter(u => u.alive && u.team !== this.team);
    if (enemies.length === 0) { this.members.forEach(m => m.ai.update(dt, this)); return; }
    let ex = 0, ez = 0;
    for (const e of enemies) { ex += e.pos.x; ez += e.pos.z; }
    ex /= enemies.length; ez /= enemies.length;
    // 没有玩家指挥（红队/自由状态）→ 原有自动战术；有指挥 → 用 memberDest
    const playerCmd = this.team === 'blue' && this.order !== 'free';
    if (!playerCmd) {
      if (this.orderT <= 0) {
        this.orderT = U.rand(7, 12);
        const r = Math.random();
        this.tactic = r < 0.3 ? 'flankL' : r < 0.55 ? 'flankR' : 'advance';
        this.objective = { x: ex, z: ez };
        const side = this.tactic === 'flankL' ? -1 : this.tactic === 'flankR' ? 1 : 0;
        const flankers = this.members.filter(m => m.alive && m.ai.role !== 'sniper').slice(0, 2);
        flankers.forEach((m, i) => {
          const perp = side || (i === 0 ? -1 : 1);
          m.ai.orderPt = { x: ex + perp * 26, z: ez + perp * 18 };
        });
      }
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
  // 渲染背包面板（Minecraft 式格子：随身背包 ↔ 个人仓库 分离）
  inventory() {
    if (!this.els.invPanel) return;
    const st = (typeof Accounts !== 'undefined' && Accounts.storage) ? Accounts.storage() : null;
    this.els.invAcc.textContent = st ? '账号：' + Accounts.current : '游客（无仓库）';
    this.els.invArmor.innerHTML = '🛡 护甲：<b>' + Math.round(PlayerGun.armor) + '</b>/100' +
      (st ? ' ｜ 仓库护甲包：<b>' + (st.armorkits || 0) + '</b> 个 <button onclick="UI.useArmor()">修复</button>' : '');
    // 物品槽定义：type 决定背包值来源；'ammo-xxx' 弹药 / 'medkit' / 'armorkit' / 'grenade' / 'smoke'
    const slots = [
      { k: 'ammo-pistol', ic: Icon.get('ammo-pistol'), nm: '手枪弹' }, { k: 'ammo-rifle', ic: Icon.get('ammo-rifle'), nm: '步枪弹' },
      { k: 'ammo-sniper', ic: Icon.get('ammo-sniper'), nm: '狙击弹' }, { k: 'ammo-shotgun', ic: Icon.get('ammo-shotgun'), nm: '霰弹药' },
      { k: 'medkit', ic: Icon.get('medkit'), nm: '医疗包' }, { k: 'armorkit', ic: Icon.get('armorkit'), nm: '护甲包' },
      { k: 'grenade', ic: Icon.get('grenade'), nm: '手雷' }, { k: 'smoke', ic: Icon.get('smoke'), nm: '烟雾弹' }
    ];
    const cKey = { medkit: 'medkits', armorkit: 'armorkits', grenade: 'grenades', smoke: 'smokes' };
    const bagVal = k => k.startsWith('ammo-') ? (PlayerGun.reserves[k.slice(5)] || 0) : (PlayerGun[cKey[k]] || 0);
    const storeVal = k => {
      if (!st) return 0;
      return k.startsWith('ammo-') ? (st.ammo[k.slice(5)] || 0) : (k === 'armorkit' ? (st.armorkits || 0) : (st[cKey[k]] || 0));
    };
    const cell = (k, ic, nm, v) =>
      '<div class="invCell' + (v > 0 ? '' : ' empty') + '" onclick="UI.transfer(\'' + k + '\')" title="' + nm + (v > 0 ? '（点击转移）' : '') + '">' +
      (ic ? '<img class="tic" src="' + ic + '" alt="">' : '<span class="ic">?</span>') +
      '<span class="nm">' + nm + '</span>' +
      (v > 0 ? '<span class="st">' + v + '</span>' : '') + '</div>';
    // 背包格（局内携带，3×4=12 格：8 物品 + 4 空位）
    this.els.invBag = document.getElementById('invBag');
    if (this.els.invBag) {
      const bagSlots = slots.concat(
        [{ k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }]);
      this.els.invBag.innerHTML = bagSlots.map(s =>
        s.k ? cell(s.k, s.ic, s.nm, bagVal(s.k)) :
          '<div class="invCell empty"><span class="nm">空</span></div>').join('');
    }
    // 仓库格（账号存储，3×4=12 格：8 物品 + 4 空位）
    this.els.invStore = document.getElementById('invStore');
    if (this.els.invStore) {
      const storeSlots = slots.concat(
        [{ k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }, { k: '', ic: '', nm: '' }]);
      this.els.invStore.innerHTML = storeSlots.map(s =>
        s.k ? cell(s.k, s.ic, s.nm, storeVal(s.k)) :
          '<div class="invCell empty"><span class="nm">空</span></div>').join('');
    }
    // 游客无仓库：禁用转移按钮
    const btns = document.querySelectorAll('.invStoreBtns button');
    btns.forEach(b => b.style.display = st ? '' : 'none');
  },
  // 背包↔仓库 转移（Minecraft 箱子手感）：ammo 全部转移；消耗品逐格
  transfer(k) {
    if (k.startsWith('ammo-')) {
      const w = k.slice(5);
      const st = (typeof Accounts !== 'undefined' && Accounts.storage) ? Accounts.storage() : null;
      if (!st) return;
      const bag = PlayerGun.reserves[w] || 0, store = st.ammo[w] || 0;
      if (bag > 0) { PlayerGun.reserves[w] = 0; st.ammo[w] = store + bag; } // 背包→仓库
      else if (store > 0) { const take = Math.min(store, 120); st.ammo[w] = store - take; PlayerGun.reserves[w] = take; } // 120 发/组（MC 堆叠）
      Accounts.save(); this.inventory(); UI.slots(PlayerGun.cur);
      return;
    }
    // 消耗品/护甲
    const st = (typeof Accounts !== 'undefined' && Accounts.storage) ? Accounts.storage() : null;
    if (!st) return;
    if (k === 'medkit') {
      if (PlayerGun.medkits > 0) { st.medkits = (st.medkits || 0) + PlayerGun.medkits; PlayerGun.medkits = 0; }
      else if ((st.medkits || 0) > 0) { const t = Math.min(st.medkits, 5); st.medkits -= t; PlayerGun.medkits = t; }
    } else if (k === 'armorkit') {
      // 护甲包统一按"个"（修复：v2.8 点数↔个 单位混乱导致点击消失）
      if (PlayerGun.armorkits > 0) { st.armorkits = (st.armorkits || 0) + PlayerGun.armorkits; PlayerGun.armorkits = 0; }
      else if ((st.armorkits || 0) > 0) { const t = Math.min(st.armorkits, 5); st.armorkits -= t; PlayerGun.armorkits = t; }
    } else if (k === 'grenade') {
      if (PlayerGun.grenades > 0) { st.grenades = (st.grenades || 0) + PlayerGun.grenades; PlayerGun.grenades = 0; }
      else if ((st.grenades || 0) > 0) { const t = Math.min(st.grenades, 5); st.grenades -= t; PlayerGun.grenades = t; }
    } else if (k === 'smoke') {
      if (PlayerGun.smokes > 0) { st.smokes = (st.smokes || 0) + PlayerGun.smokes; PlayerGun.smokes = 0; }
      else if ((st.smokes || 0) > 0) { const t = Math.min(st.smokes, 5); st.smokes -= t; PlayerGun.smokes = t; }
    }
    Accounts.save(); this.inventory(); UI.slots(PlayerGun.cur);
  },
  // 全部取出/存入（仓库↔背包 弹药与消耗品）
  storeTakeAll(toBag) {
    const st = (typeof Accounts !== 'undefined' && Accounts.storage) ? Accounts.storage() : null;
    if (!st) return;
    if (toBag) {
      for (const w in WEAPONS) {
        const t = st.ammo[w] || 0;
        if (t > 0) {
          const room = Math.max(0, 120 - (PlayerGun.reserves[w] || 0)); // 120 发/组堆叠上限
          const take = Math.min(t, room);
          st.ammo[w] = t - take;
          PlayerGun.reserves[w] += take;
        }
      }
      if ((st.medkits || 0) > 0) { PlayerGun.medkits += st.medkits; st.medkits = 0; }
      if ((st.grenades || 0) > 0) { PlayerGun.grenades += st.grenades; st.grenades = 0; }
      if ((st.smokes || 0) > 0) { PlayerGun.smokes += st.smokes; st.smokes = 0; }
      if ((st.armorkits || 0) > 0) { PlayerGun.armorkits += st.armorkits; st.armorkits = 0; } // 护甲包（个）
      UI.toast('仓库 → 背包：全部取出');
    } else {
      for (const w in WEAPONS) { const t = PlayerGun.reserves[w] || 0; if (t > 0) { PlayerGun.reserves[w] = 0; st.ammo[w] = (st.ammo[w] || 0) + t; } }
      if (PlayerGun.medkits > 0) { st.medkits = (st.medkits || 0) + PlayerGun.medkits; PlayerGun.medkits = 0; }
      if (PlayerGun.grenades > 0) { st.grenades = (st.grenades || 0) + PlayerGun.grenades; PlayerGun.grenades = 0; }
      if (PlayerGun.smokes > 0) { st.smokes = (st.smokes || 0) + PlayerGun.smokes; PlayerGun.smokes = 0; }
      if (PlayerGun.armorkits > 0) { st.armorkits = (st.armorkits || 0) + PlayerGun.armorkits; PlayerGun.armorkits = 0; } // 护甲包（个）
      UI.toast('背包 → 仓库：全部存入');
    }
    Accounts.save(); this.inventory(); UI.slots(PlayerGun.cur);
  },
  useArmor() { Backpack.useArmorPack(); },
  aim(on) {
    // 开镜反馈：准星缩小变细（模拟瞄具视野收紧），收镜恢复
    if (!this.els.crosshair) return;
    this.els.crosshair.style.width = on ? '12px' : '22px';
    this.els.crosshair.style.height = on ? '12px' : '22px';
    this.els.crosshair.style.opacity = on ? '1' : '0.9';
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
  lowhp(on) { this.els.lowhp.style.opacity = on ? 0.65 : 0; },
  updateAmmo() {
    const g = PlayerGun, w = WEAPONS[g.cur];
    this.els.ammoCur.textContent = g.mags[g.cur];
    this.els.ammoRes.textContent = '/ ' + g.reserves[g.cur];
    if (g.reloading) {
      const left = Math.max(0, g.reloadEnd - performance.now() / 1000);
      this.els.reloadTag.textContent = '换弹中... ' + left.toFixed(1) + 's';
    } else {
      this.els.reloadTag.textContent = (g.mags[g.cur] === 0 && g.reserves[g.cur] > 0) ? '按 R 换弹' : '';
    }
  },
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
