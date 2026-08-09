/* ============================================
 * 战地突击 · js/accounts.js — 账号系统 + 个人仓库 + 背包
 * --------------------------------------------
 * 存储：localStorage（纯前端离线方案；无服务端）。
 *   bg_accounts : { "<name>": { ph:<hash>, st:{ ammo:{pistol..}, armor:<0-100> } } }
 *   bg_session  : "<name>"  当前登录账号
 * 密码哈希：djb2 变体（防明文落盘；本地模拟用途，非安全级——文档注明）
 * 背包：局内玩家持有（PlayerGun.mags/reserves + armor），B 键面板仓库↔背包互转
 * ============================================ */
const Accounts = {
  KEY: 'bg_accounts', SESSION: 'bg_session',
  current: null, data: {},
  hash(pwd) {
    let h = 5381;
    for (let i = 0; i < pwd.length; i++) h = ((h << 5) + h + pwd.charCodeAt(i)) >>> 0;
    return 'h' + h.toString(16);
  },
  load() {
    try { this.data = JSON.parse(localStorage.getItem(this.KEY) || '{}'); } catch (e) { this.data = {}; }
    this.current = localStorage.getItem(this.SESSION) || null;
    // 校验 current 仍存在
    if (this.current && !this.data[this.current]) { this.current = null; }
    // 旧数据迁移（v2.8 armor 点数 → v2.9.3 armorkits 个）
    for (const name in this.data) {
      const st = this.data[name].st;
      if (st && st.armorkits === undefined && st.armor !== undefined) {
        st.armorkits = Math.floor(st.armor / 25);
        delete st.armor;
      }
    }
  },
  save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch (e) { console.warn('[Accounts] 存储失败', e.message); }
  },
  exists(name) { return !!this.data[name]; },
  register(name, pwd) {
    name = (name || '').trim();
    if (name.length < 2 || name.length > 16) return { ok: false, msg: '名称需 2-16 字符' };
    if (!pwd || pwd.length < 4) return { ok: false, msg: '密码至少 4 位' };
    if (this.exists(name)) return { ok: false, msg: '该名称已注册，请直接登录' };
    this.data[name] = { ph: this.hash(pwd), st: this.defaultStorage() };
    this.save();
    this.login(name, pwd);
    return { ok: true, msg: '注册成功' };
  },
  login(name, pwd) {
    name = (name || '').trim();
    const acc = this.data[name];
    if (!acc) return { ok: false, msg: '账号不存在，请先注册' };
    if (acc.ph !== this.hash(pwd)) return { ok: false, msg: '密码错误' };
    this.current = name;
    try { localStorage.setItem(this.SESSION, name); } catch (e) { }
    return { ok: true, msg: '登录成功' };
  },
  logout() {
    this.current = null;
    try { localStorage.removeItem(this.SESSION); } catch (e) { }
  },
  defaultStorage() {
    return {
      ammo: { pistol: 96, rifle: 120, sniper: 30, shotgun: 48 }, // 新手默认仓库弹药
      armorkits: 4, // 护甲包（1 个 = 25 护甲点）
      medkits: 5, grenades: 3, smokes: 2 // 消耗品库存
    };
  },
  // 当前账号仓库（未登录返回 null → 界面隐藏仓库操作）
  storage() {
    if (!this.current || !this.data[this.current]) return null;
    return this.data[this.current].st;
  }
};

/* ---------- 局内背包（玩家当前持有，含仓库互通） ---------- */
const Backpack = {
  open: false, // B 键面板开关
  pickT: 0, // 搜刮提示冷却
  lastLootT: 0, // 最近搜刮反馈
  // 开局：从仓库加载初始弹药（无账号 → 默认满配）
  initFromStorage() {
    const st = Accounts.storage();
    for (const w in WEAPONS) {
      if (st && st.ammo && st.ammo[w] !== undefined) PlayerGun.reserves[w] = st.ammo[w];
      else PlayerGun.reserves[w] = WEAPONS[w].reserve;
      PlayerGun.mags[w] = WEAPONS[w].mag;
    }
    // 消耗品：仓库有则用之（修复：v2.9 仓库存的医疗包/手雷/烟雾开局读不回来）
    if (st) {
      PlayerGun.medkits = st.medkits !== undefined ? st.medkits : CFG.PLAYER_START_MEDKITS;
      PlayerGun.grenades = st.grenades !== undefined ? st.grenades : 3;
      PlayerGun.smokes = st.smokes !== undefined ? st.smokes : 2;
      PlayerGun.armorkits = st.armorkits !== undefined ? st.armorkits : 0;
      PlayerGun.armor = st.armor !== undefined ? st.armor : 100;
      UI.armorBar(PlayerGun.armor);
    }
  },
  // 从仓库取弹药到背包（返回是否成功）
  takeAmmo(w) {
    const st = Accounts.storage();
    if (!st) return false;
    const take = Math.min(st.ammo[w] || 0, WEAPONS[w].reserve);
    if (take <= 0) return false;
    st.ammo[w] -= take;
    PlayerGun.reserves[w] += take;
    this.commit();
    return true;
  },
  // 从背包存弹药到仓库
  storeAmmo(w) {
    const st = Accounts.storage();
    if (!st) return false;
    const store = PlayerGun.reserves[w];
    if (store <= 0) return false;
    PlayerGun.reserves[w] = 0;
    st.ammo[w] = (st.ammo[w] || 0) + store;
    this.commit();
    return true;
  },
  // 用仓库护甲包修复自身护甲
  useArmorPack() {
    const st = Accounts.storage();
    if (!st || !(st.armorkits || 0) || PlayerGun.armor >= 100) return false;
    const need = Math.ceil((100 - PlayerGun.armor) / 25); // 1 个护甲包 = 25 护甲点
    const use = Math.min(need, st.armorkits);
    st.armorkits -= use;
    PlayerGun.armor = Math.min(100, PlayerGun.armor + use * 25);
    this.commit();
    UI.armorBar(PlayerGun.armor);
    return true;
  },
  commit() { Accounts.save(); UI.inventory(); },
  // 搜刮尸体（killUnit 时记录在 u.loot）
  lootCorpse(u) {
    if (!u || !u.loot) return { ok: false, msg: '已搜刮' };
    const l = u.loot;
    let gained = [];
    if (l.ammo) for (const w in l.ammo) {
      if (l.ammo[w] > 0) { PlayerGun.reserves[w] += l.ammo[w]; gained.push(WEAPONS[w].name + ' ×' + l.ammo[w]); }
    }
    if (l.armor && PlayerGun.armor < 100) {
      const add = Math.min(100 - PlayerGun.armor, l.armor);
      if (add > 0) { PlayerGun.armor += add; gained.push('护甲 +' + Math.round(add)); }
    }
    u.loot = null;
    UI.armorBar(PlayerGun.armor);
    UI.inventory();
    return { ok: true, msg: gained.length ? gained.join('、') : '一无所获' };
  },
  // 检测最近可搜刮尸体（返回 Unit 或 null）
  nearestCorpse(maxD) {
    maxD = maxD || 3.2;
    const p = Game.player;
    let best = null, bd = maxD * maxD;
    for (const u of Game.units) {
      if (u.alive || !u.loot) continue;
      const d2 = U.dist2(p.pos.x, p.pos.z, u.pos.x, u.pos.z);
      if (d2 < bd) { bd = d2; best = u; }
    }
    return best;
  }
};
