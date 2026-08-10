/* ============================================
 * 战地突击 · js/accounts.js — 局内背包（无账号系统）
 * --------------------------------------------
 * v3.0：移除账号/个人仓库（localStorage 仓库互通已删除）。
 * 每次开局由 Backpack.resetToDefault() 统一发放初始物资；
 * 背包面板只展示随身携带，保留搜刮尸体/护甲包修复功能。
 * ============================================ */
const Backpack = {
  open: false, // B 键面板开关
  pickT: 0, // 搜刮提示冷却
  lastLootT: 0, // 最近搜刮反馈

  // 开局统一初始物资（不依赖任何账号/存储，每次固定）
  resetToDefault() {
    for (const w in WEAPONS) {
      PlayerGun.mags[w] = WEAPONS[w].mag;
      PlayerGun.reserves[w] = WEAPONS[w].reserve; // 统一满配初始备弹
    }
    PlayerGun.armor = 100;
    PlayerGun.medkits = typeof CFG !== 'undefined' && CFG.PLAYER_START_MEDKITS ? CFG.PLAYER_START_MEDKITS : 5;
    PlayerGun.armorkits = 0;
    PlayerGun.grenades = 3;
    PlayerGun.smokes = 2;
    if (typeof UI !== 'undefined' && UI.armorBar) UI.armorBar(PlayerGun.armor);
  },

  // 使用背部护甲包修复自身护甲（1 包 = 25 护甲点，消耗随身 armorkits）
  useArmorPack() {
    if (!(PlayerGun.armorkits > 0) || PlayerGun.armor >= 100) return false;
    PlayerGun.armorkits--;
    PlayerGun.armor = Math.min(100, PlayerGun.armor + 25);
    if (typeof UI !== 'undefined') {
      UI.armorBar(PlayerGun.armor);
      UI.inventory();
    }
    return true;
  },

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
    if (typeof UI !== 'undefined') {
      UI.armorBar(PlayerGun.armor);
      UI.inventory();
    }
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