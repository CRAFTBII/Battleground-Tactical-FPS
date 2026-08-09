/* ============================================
 * 战地突击 · js/items.js — 3D 物品模型 + 地面掉落实体
 * --------------------------------------------
 * 物品类型：ammo(弹药箱,带武器参数) / medkit(医疗包) / armorkit(护甲包)
 *          / grenade(手雷) / smoke(烟雾)
 * 掉落来源：击杀 AI（弹药+医疗包） / 玩家 Q 丢弃当前槽物品
 * 拾取：靠近自动拾取（Minecraft 风格，无按键）
 * 模型：程序化几何（box/cylinder/cross），武器复用 BuildingLib/WEAPONS_DATA
 * ============================================ */
const Items = {
  list: [],
  models: {}, // 各类型静态模型（克隆用）
  init() {
    // 弹药箱：小方盒 + 顶部提手（按武器配色）
    const mkAmmo = color => {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.36), new THREE.MeshLambertMaterial({ color }));
      box.position.y = 0.16;
      g.add(box);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.08, 0.24), new THREE.MeshLambertMaterial({ color: 0x3a3f45 }));
      cap.position.y = 0.36;
      g.add(cap);
      return g;
    };
    this.models.ammo = {
      pistol: mkAmmo(0x8a8f96), rifle: mkAmmo(0x4a4f55), sniper: mkAmmo(0x5a5f66), shotgun: mkAmmo(0x6b4a3a)
    };
    // 医疗包：白盒 + 红十字
    const med = new THREE.Group();
    const mbox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.3, 0.4), new THREE.MeshLambertMaterial({ color: 0xf2f4f6 }));
    mbox.position.y = 0.15; med.add(mbox);
    const redM = new THREE.MeshLambertMaterial({ color: 0xe03a3a });
    const h1 = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.02), redM); h1.position.set(0, 0.15, 0.203); med.add(h1);
    const h2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.02), redM); h2.position.set(0, 0.15, 0.203); med.add(h2);
    this.models.medkit = med;
    // 护甲包：深灰盒 + 战术片
    const arm = new THREE.Group();
    const abox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.42), new THREE.MeshLambertMaterial({ color: 0x2a2e34 }));
    abox.position.y = 0.13; arm.add(abox);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.3), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
    plate.position.y = 0.3; arm.add(plate);
    this.models.armorkit = arm;
    // 手雷：小圆球 + 拉环
    const grn = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshLambertMaterial({ color: 0x3a5f3a }));
    body.position.y = 0.14; grn.add(body);
    this.models.grenade = grn;
    // 烟雾弹：矮罐
    const smk = new THREE.Group();
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.24, 8), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
    can.position.y = 0.12; smk.add(can);
    this.models.smoke = smk;
    // 战利品盒（PUBG 风格）：军绿方箱 + 深色边框 + 锁扣
    const lb = new THREE.Group();
    const lbBody = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.55, 0.8), new THREE.MeshLambertMaterial({ color: 0x5a6b4a }));
    lbBody.position.y = 0.28; lb.add(lbBody);
    const lbLid = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.1, 0.84), new THREE.MeshLambertMaterial({ color: 0x6d7f58 }));
    lbLid.position.y = 0.59; lb.add(lbLid);
    const lbTrim = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.08), new THREE.MeshLambertMaterial({ color: 0x3a4430 }));
    lbTrim.position.set(0, 0.28, 0.36); lb.add(lbTrim);
    const lbTrim2 = lbTrim.clone(); lbTrim2.position.z = -0.36; lb.add(lbTrim2);
    const lbLock = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), new THREE.MeshLambertMaterial({ color: 0x2a2e34 }));
    lbLock.position.set(0, 0.28, 0.42); lb.add(lbLock);
    this.models.lootbox = lb;
  },
  // 生成一个掉落实体（返回 null 失败）
  spawn(type, x, y, z, amt, weapon) {
    let base = this.models[type];
    if (type === 'ammo') base = weapon && this.models.ammo[weapon] ? this.models.ammo[weapon] : null;
    if (!base) return null;
    const model = base.clone();
    model.position.set(x, y + 0.3, z);
    World.scene.add(model);
    const it = { type, mesh: model, amt: amt || 1, weapon: weapon || null, t: U.rand(0, 6), life: 90 };
    this.list.push(it);
    return it;
  },
  // 退出对局/换局清理：掉落物网格直接挂场景根（不在 World.objects），须手动移除
  clear() {
    for (const it of this.list) World.scene.remove(it.mesh);
    this.list.length = 0;
  },
  // 击杀掉落：PUBG 式战利品盒（尸体处一个盒子，含全部 loot，一次拾取）
  dropForUnit(u) {
    if (!u || !u.loot) return;
    const p = u.pos;
    const loot = { ammo: {}, armor: 0, medkit: 0 };
    for (const w in u.loot.ammo) if (u.loot.ammo[w] > 0) loot.ammo[w] = u.loot.ammo[w];
    if (u.loot.armor > 10) loot.armor = Math.round(u.loot.armor);
    if (u.loot.medkit) loot.medkit = u.loot.medkit;
    if (!Object.keys(loot.ammo).length && !loot.armor && !loot.medkit) return null;
    return this.spawnLootbox(p.x, p.y, p.z, loot);
  },
  // 生成战利品盒（含 loot 数据）
  spawnLootbox(x, y, z, loot) {
    const base = this.models.lootbox;
    if (!base) return null;
    const model = base.clone();
    model.position.set(x, y + 0.3, z);
    World.scene.add(model);
    const it = { type: 'lootbox', mesh: model, loot: loot || { ammo: {}, armor: 0 }, t: U.rand(0, 6), life: 120, claimedBy: null };
    this.list.push(it);
    return it;
  },
  // AI 拾取战利品盒：弹药进 AI 备弹、医疗包进 AI、护甲修 AI
  pickupFor(it, unit) {
    if (it.type !== 'lootbox' || !unit || !unit.ai) return;
    const ai = unit.ai;
    if (it.loot) {
      for (const w in it.loot.ammo) {
        if (it.loot.ammo[w] > 0) ai.reserveMap[w] = (ai.reserveMap[w] || 0) + it.loot.ammo[w];
      }
      if (it.loot.medkit > 0) ai.medkits += it.loot.medkit;
      if (it.loot.armor > 0 && unit.armor < 100) unit.armor = Math.min(100, unit.armor + it.loot.armor);
      // v1.4 战术补给（ai-tactics.md §9 联调项 5/6）：带包用包 / 穿烟推进——只加"决策资源"，不改手感
      if (it.loot.armor > 0) ai.armorkits = (ai.armorkits || 0) + 1; // ⑤ 护甲包（捡甲同时带包，用包时机由战术层决定）
      ai.smokes = (ai.smokes || 0) + 1;                              // ④ 烟雾弹（lootbox 拾取获得）
    }
    World.scene.remove(it.mesh);
  },
  // 玩家 Q 丢弃当前物品 → 掉落实体
  discard(type, x, y, z, amt, weapon) { this.spawn(type, x, y, z, amt, weapon); },
  update(dt) {
    const p = Game && Game.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const it = this.list[i];
      it.life -= dt;
      if (it.life <= 0) { World.scene.remove(it.mesh); this.list.splice(i, 1); continue; }
      // 浮动（PUBG 盒子轻微 bob，不旋转）+ 小物品旋转
      it.t += dt;
      if (it.type === 'lootbox') {
        it.mesh.position.y = it.mesh.position.y + Math.sin(it.t * 1.5) * 0.01;
      } else {
        it.mesh.position.y = it.mesh.position.y + Math.sin(it.t * 2) * 0.008;
        it.mesh.rotation.y += dt * 2;
      }
      // 自动拾取：玩家 2.2m 内（盒子大一点，判定放宽）
      if (p && p.alive) {
        const dx = it.mesh.position.x - p.pos.x, dz = it.mesh.position.z - p.pos.z;
        if (dx * dx + dz * dz < (it.type === 'lootbox' ? 5.3 : 4)) { this.pickup(it); this.list.splice(i, 1); }
      }
    }
  },
  pickup(it) {
    if (it.type === 'lootbox') {
      // PUBG 盒子：一次性拾取全部内容
      const parts = [];
      if (it.loot) {
        for (const w in it.loot.ammo) {
          if (it.loot.ammo[w] > 0) { PlayerGun.reserves[w] += it.loot.ammo[w]; parts.push(WEAPONS[w].name + ' ×' + it.loot.ammo[w]); }
        }
        if (it.loot.medkit > 0) { PlayerGun.medkits += it.loot.medkit; parts.push('医疗包 ×' + it.loot.medkit); }
        if (it.loot.armor > 0 && PlayerGun.armor < 100) {
          const add = Math.min(100 - PlayerGun.armor, it.loot.armor);
          if (add > 0) { PlayerGun.armor += add; parts.push('护甲 +' + Math.round(add)); UI.armorBar(PlayerGun.armor); }
        }
      }
      UI.toast('开启战利品盒：' + (parts.length ? parts.join('、') : '空盒'));
    } else if (it.type === 'ammo' && it.weapon) {
      PlayerGun.reserves[it.weapon] += it.amt;
      UI.toast('拾取 ' + WEAPONS[it.weapon].name + ' 弹药 ×' + it.amt);
    } else if (it.type === 'medkit') {
      PlayerGun.medkits += it.amt;
      UI.toast('拾取 医疗包 ×' + it.amt);
    } else if (it.type === 'armorkit') {
      const before = PlayerGun.armor;
      PlayerGun.armor = Math.min(100, PlayerGun.armor + it.amt);
      UI.armorBar(PlayerGun.armor);
      UI.toast('拾取 护甲 +' + (PlayerGun.armor - before));
    } else if (it.type === 'grenade') { PlayerGun.grenades += it.amt; UI.toast('拾取 手雷 ×' + it.amt); }
    else if (it.type === 'smoke') { PlayerGun.smokes += it.amt; UI.toast('拾取 烟雾弹 ×' + it.amt); }
    World.scene.remove(it.mesh);
    if (typeof UI !== 'undefined' && UI.slots) UI.slots(PlayerGun.cur);
  }
};
