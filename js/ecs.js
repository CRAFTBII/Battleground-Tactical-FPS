/* ============================================
 * 战地突击 · js/ecs.js — 轻量 ECS 引擎
 * --------------------------------------------
 * 采用 ECS(实体-组件-系统)思想组织更新循环：
 *  - 系统(system)独立注册，各自处理一类逻辑(输入/物理/投射物/AI/特效/网络)
 *  - 实体(entity)为纯数据(Game.player / Game.units / ProxyList)
 *  - 系统不互相阻塞：聊天/面板打开仅关闭「玩家输入系统」，其余(物理/AI/特效)照常推进
 * ============================================ */
const Engine = {
  systems: [],
  // 玩家输入总开关：聊天/面板打开时置 false，仅停玩家操作，物理照常
  playerControl: true,
  // 全局暂停（暂停菜单）：此时所有系统停
  paused: false,
  register(s) { this.systems.push(s); },
  tick(dt) {
    if (this.paused) return;
    for (const s of this.systems) {
      if (s.enabled === false) continue;
      s.update(dt);
    }
  }
};

/* ---------- 输入系统：仅玩家视角/移动/射击意图 ---------- */
const InputSystem = {
  enabled: true,
  update(dt) {
    // 聊天/面板打开：不操控角色（PC.update 内部会跳过输入，仅推重力/落地/相机）
    if (Engine.playerControl) {
      PC.update(dt);
      PlayerGun.update(dt, PC.keys, camera);
    } else {
      // 聊天空闲：仍推 PC 物理(重力落地)，但不处理武器输入/开镜动画
      PC.update(dt);
    }
  }
};

/* ---------- 物理/战斗系统：玩家与单位状态、命中、掉落物 ---------- */
const CombatSystem = {
  enabled: true,
  update(dt) {
    Projectiles.update(dt);
    if (typeof Items !== 'undefined' && Items.update) Items.update(dt);
    Game.update(dt);
    MiniMap.draw();
  }
};

/* ---------- 网络系统：收发同步，独立于输入 ---------- */
const NetSystem = {
  enabled: true,
  update(dt) { Net.tick(dt); }
};

/* ---------- 特效/动画系统：粒子、武器动画 ---------- */
const FXSystem = {
  enabled: true,
  update(dt) {
    FX.update(dt);
    if (typeof WeaponAnim !== 'undefined' && WeaponAnim.update) WeaponAnim.update(dt);
  }
};

// 注册顺序 = 每帧执行顺序（输入→战斗→网络→特效）
Engine.register(InputSystem);
Engine.register(CombatSystem);
Engine.register(NetSystem);
Engine.register(FXSystem);