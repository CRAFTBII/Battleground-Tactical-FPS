/* ============================================
 * 战地突击 · mg.js — 固定机枪位
 * 地图关键位置 3 挺固定机枪（三脚架 + 枪身 + 弹箱）
 * 交互：靠近 2.5m 按 E 进入/退出；进入后鼠标控制转向，左键连射
 * 机制：无限弹药 + 过热（连续射击过热停 2.5s）——限制持续压制
 * 限制：机枪模式不能移动/开镜/换弹/切枪/扔雷/潜伏
 * ============================================ */
const MG = {
  POS: [ // 机枪位（世界坐标 + 初始朝向角 rad，面向地图中央）
    { x: 162, z: 138, yaw: U.angTo(162, 138, 150, 150) },
    { x: 96,  z: 96,  yaw: U.angTo(96, 96, 150, 150) },
    { x: 228, z: 240, yaw: U.angTo(228, 240, 150, 150) }
  ],
  meshes: [],   // 每挺机枪模型组
  active: null, // 当前使用的机枪索引（null = 未使用）
  yaw: 0, pitch: 0,        // 机枪瞄准角
  fireT: 0, heat: 0,       // 射速节流 + 过热 0-100
  overheated: false, coolT: 0,
  nearIdx: -1,             // 玩家附近机枪索引（-1 无）
  _nearT: 0,
  exitCd: 0,

  init() {
    if (this.meshes.length) return;
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x4a5a3a });   // 军绿枪身
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2e33 });     // 枪管/脚架
    const boxMat = new THREE.MeshLambertMaterial({ color: 0x5f5a4a });   // 弹箱木色
    for (const p of this.POS) {
      const g = new THREE.Group();
      // 底座板
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.9), dark);
      base.position.y = 0.16;
      g.add(base);
      // 三脚架两前腿 + 后腿
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), dark);
      const l1 = leg.clone(); l1.position.set(0.32, 0.35, 0.28); l1.rotation.x = 0.45;
      const l2 = leg.clone(); l2.position.set(-0.32, 0.35, 0.28); l2.rotation.x = 0.45;
      const l3 = leg.clone(); l3.position.set(0, 0.35, -0.3); l3.rotation.x = -0.5;
      g.add(l1, l2, l3);
      // 枪身（绕 Y 旋转朝目标）
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.7), gunMat);
      body.position.set(0, 0.62, -0.1);
      g.add(body);
      // 枪管（前伸）
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.8, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.66, -0.62);
      g.add(barrel);
      // 弹箱
      const ammoBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.3), boxMat);
      ammoBox.position.set(0, 0.42, 0.28);
      g.add(ammoBox);
      // 枪口火光节点（射击时闪）
      const flash = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0 }));
      flash.position.set(0, 0.66, -1.02);
      g.add(flash);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const gy = World.heightAt(p.x, p.z);
      g.position.set(p.x, gy, p.z);
      g.rotation.y = p.yaw;
      World.scene.add(g);
      this.meshes.push({ group: g, flash });
    }
    // 机枪碰撞盒（小底座，人可绕行）
    for (const p of this.POS) {
      World.colliders.push({ min: new THREE.Vector3(p.x - 0.55, 0, p.z - 0.5), max: new THREE.Vector3(p.x + 0.55, 0.85, p.z + 0.5) });
    }
  },

  // 玩家交互：靠近按 E 进入/退出（返回 true 表示消耗了 E 键）
  tryUse() {
    if (Game.phase !== 'playing' || Game.player.dead) return false;
    if (this.active !== null) { this.exit(); return true; }
    const p = Game.player.pos;
    for (let i = 0; i < this.POS.length; i++) {
      const m = this.POS[i];
      const dx = m.x - p.x, dz = m.z - p.z;
      if (dx * dx + dz * dz < 6.25) { // 2.5m
        this.enter(i);
        return true;
      }
    }
    return false;
  },

  enter(i) {
    this.active = i;
    const m = this.POS[i];
    this.yaw = m.yaw; this.pitch = 0;
    this.heat = 0; this.overheated = false; this.coolT = 0; this.fireT = 0;
    Game.player.pos.x = m.x; Game.player.pos.z = m.z; // 锁定玩家位置
    PC.prone = false; PlayerGun.aimT = 0; Game.scoped = false;
    UI.scope(false); UI.aim(false);
    for (const k in PlayerGun.models) PlayerGun.models[k].visible = false;
    if (Game.player.mesh.grp) Game.player.mesh.grp.visible = false;
    AudioFX.ui();
    UI.mgUI(true);
    this.exitCd = 0.3;
  },

  exit() {
    this.active = null;
    Game.player.mesh.grp.visible = false; // 第一人称自网格本就隐藏
    PlayerGun.models[PlayerGun.cur].visible = true;
    UI.mgUI(false);
    this.exitCd = 0.4;
    AudioFX.ui();
  },

  // 左键射击（连射 700rpm + 过热）
  fire() {
    if (this.active === null || this.overheated || this.fireT > 0) return;
    const now = performance.now() / 1000;
    this.fireT = 0.085; // 约 700 发/分
    this.heat += 11;
    if (this.heat >= 100) { this.overheated = true; this.coolT = 2.5; UI.toast('机枪过热，冷却中…'); return; }
    const m = this.POS[this.active];
    const from = new THREE.Vector3(m.x, World.heightAt(m.x, m.z) + 1.0, m.z);
    const dir = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)).normalize();
    // 命中判定（射线 vs 单位胸口）
    const end = from.clone().addScaledVector(dir, 300);
    let hitU = null, bestT = 300;
    for (const u of Game.units) {
      if (!u.alive || u.team === Game.player.team || u === Game.player) continue;
      const chest = new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z);
      const d = chest.distanceTo(from);
      if (d < bestT && !World.rayBlocked(from, chest)) { bestT = d; hitU = u; }
    }
    const hitEnd = hitU ? new THREE.Vector3(hitU.pos.x, hitU.pos.y + 1, hitU.pos.z) : end;
    if (!World.rayBlocked(from, hitEnd)) {
      FX.tracer(from, hitEnd, 0xffc080);
      if (hitU) {
        Game.applyDamage(hitU, 14, Game.player, false);
        FX.blood(new THREE.Vector3(hitU.pos.x, hitU.pos.y + 1.2, hitU.pos.z));
        UI.showHit(false);
        AudioFX.hit();
      }
    }
    // 枪口火光 + 音效
    const mesh = this.meshes[this.active];
    mesh.flash.material.opacity = 0.9;
    AudioFX.shot('rifle');
    Net.broadcastEvent && Net.broadcastEvent({ k: 'fire', id: Game.player.id, w: 'rifle', x: from.x, y: from.y, z: from.z, yaw: this.yaw });
    if (PC.recoil !== undefined) PC.recoil += 0.01;
  },

  update(dt) {
    this.fireT = Math.max(0, this.fireT - dt);
    // 过热恢复
    if (this.overheated) {
      this.coolT -= dt;
      this.heat = Math.max(0, this.heat - 45 * dt);
      if (this.coolT <= 0) { this.overheated = false; UI.toast('机枪冷却完成'); }
    } else {
      this.heat = Math.max(0, this.heat - 14 * dt);
    }
    // 枪口火光衰减
    for (const mesh of this.meshes) mesh.flash.material.opacity = Math.max(0, mesh.flash.material.opacity - dt * 9);
    if (this.active === null) return;
    // 锁定相机在机枪位（1.35m 眼睛高度，与潜伏无关）
    const m = this.POS[this.active];
    const gy = World.heightAt(m.x, m.z);
    camera.position.set(m.x, gy + 1.35, m.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    // 机枪模型转向跟随
    const mesh = this.meshes[this.active];
    mesh.group.rotation.y = this.yaw;
    // 死亡/菜单强制退出
    if (Game.player.dead || Game.phase !== 'playing' || !PC.locked) this.exit();
  },

  // 鼠标控制转向（PC mousemove 调用）
  onMouse(dx, dy) {
    if (this.active === null) return;
    this.yaw -= dx * 0.003; // 方位（限位 ±60° 绕初始朝向）
    const base = this.POS[this.active].yaw;
    this.yaw = U.clamp(this.yaw, base - 1.05, base + 1.05);
    this.pitch = U.clamp(this.pitch - dy * 0.002, -0.25, 0.45); // 俯仰 -15°~+25°
  },

  // 靠近检测（UI 提示 [E] 使用机枪）
  nearCheck(dt) {
    if (Game.phase !== 'playing' || Game.player.dead || this.active !== null) return;
    this._nearT -= dt;
    if (this._nearT > 0) return;
    this._nearT = 0.3;
    this.nearIdx = -1;
    const p = Game.player.pos;
    for (let i = 0; i < this.POS.length; i++) {
      const m = this.POS[i];
      const dx = m.x - p.x, dz = m.z - p.z;
      if (dx * dx + dz * dz < 6.25) { this.nearIdx = i; break; }
    }
    const hint = document.getElementById('mgHint');
    if (hint) hint.style.display = this.nearIdx >= 0 ? 'block' : 'none';
  }
};
