/* ============================================
 * 战地突击 · weaponAnim.js — 开火拉栓 + 抛弹壳 + 换弹动画（驱动玩家自建真实枪栓）
 * 枪栓来源：models/gun_glb_data.js 里玩家做的真实 _bolt.glb（由 buildRealWeapon 建为 name='bolt' 的网格）
 *   - 开火：真实枪栓沿局部 +Z（朝相机=枪托方向）做 sin 曲线往复后坐（拉栓抛壳）
 *   - 换弹：真实枪栓做一次更明显的循环 + 整枪随 wapanim_inner 下沉再回弹
 *   - 弹壳：相机视空间抛出，亮黄铜、带翻滚与局部重力，寿命到回收
 * 纯离线：无 fetch / 无 GLB / 双击 index.html 即玩
 * 接入点：
 *   main.js init()           -> WeaponAnim.init(camera)
 *   combat.js buildModels()  -> WeaponAnim.attach(g, w)
 *   combat.js tryFire()      -> WeaponAnim.fire(cur, models[cur])
 *   combat.js reload() 起点   -> WeaponAnim.startReload(cur, models[cur])
 *   combat.js reload() 完成  -> WeaponAnim.finishReload(cur, models[cur])
 *   main.js loop()           -> WeaponAnim.update(dt)
 * ============================================ */
const WeaponAnim = {
  camera: null,
  shellParent: null,
  groups: [],
  shells: [],
  MAX_SHELLS: 48,
  // 各武器调参：shell=抛壳口(局部)，v=抛壳初速，spin=翻滚角速度，fireDur/reloadDur=循环时长
  cfg: {
    pistol:  { shell: [0.05, 0.06, 0.02], v: 1.2, spin: 18, fireDur: 0.16, reloadDur: 0.5 },
    rifle:   { shell: [0.07, 0.06, 0.04], v: 1.5, spin: 22, fireDur: 0.18, reloadDur: 0.55 },
    sniper:  { shell: [0.06, 0.055, 0.08], v: 1.3, spin: 14, fireDur: 0.22, reloadDur: 0.6 },
    shotgun: { shell: [0.08, 0.06, 0.02], v: 1.4, spin: 12, fireDur: 0.2, reloadDur: 0.5 },
  },
  DIP_AMP: 0.12, // 换弹时整枪下沉幅度（FP 单位）
  init(camera) {
    this.camera = camera;
    this.shellParent = camera; // 弹壳挂相机下，随视角；相机已在 scene 中
    this._shellGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 8);
    this._shellGeo.rotateZ(Math.PI / 2);
    this._shellMat = new THREE.MeshLambertMaterial({ color: 0xffcf4d, emissive: 0x4a3200 });
    this.groups = [];
    this.shells = [];
  },
  // 找到真实枪栓（name='bolt'）与内层组（换弹下沉用）
  attach(group, key) {
    if (!this.camera || !this.cfg[key]) return;
    const bolt = group.getObjectByName('bolt');
    if (!bolt) return; // 该武器无真实枪栓，不挂动画
    const inner = group.getObjectByName('wapanim_inner') || group;
    group.userData.bolt = {
      mesh: bolt,
      rest: bolt.position.clone(),
      travel: (bolt.userData && bolt.userData.travel) || 0.1,
      t: -1, dur: this.cfg[key].fireDur
    };
    group.userData.dip = { inner, t: -1, dur: this.cfg[key].reloadDur, amp: this.DIP_AMP };
    this.groups.push(group);
  },
  // 开火：拉栓循环 + 抛一枚弹壳
  fire(key, group) {
    const b = group && group.userData && group.userData.bolt;
    if (!b) return;
    b.t = 0; b.dur = this.cfg[key].fireDur;
    this._spawnShell(key, group);
    if (typeof AudioFX !== 'undefined' && AudioFX.casing) AudioFX.casing(); // 弹壳落地金属声
  },
  // 换弹开始：枪栓大循环 + 整枪下沉
  startReload(key, group) {
    const b = group && group.userData && group.userData.bolt;
    if (b) { b.t = 0; b.dur = this.cfg[key].reloadDur; }
    const d = group && group.userData && group.userData.dip;
    if (d) { d.t = 0; d.dur = this.cfg[key].reloadDur; }
  },
  // 换弹完成（动画自循环结束，无需额外动作）
  finishReload(key, group) {},
  _spawnShell(key, group) {
    const c = this.cfg[key];
    if (this.shells.length >= this.MAX_SHELLS) {
      const old = this.shells.shift();
      if (old) this.shellParent.remove(old.mesh);
    }
    const m = new THREE.Mesh(this._shellGeo, this._shellMat);
    m.castShadow = true;
    const wp = group.localToWorld(new THREE.Vector3(c.shell[0], c.shell[1], c.shell[2]));
    const lp = this.camera.worldToLocal(wp.clone());
    m.position.copy(lp);
    m.rotation.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
    this.shellParent.add(m);
    const v = new THREE.Vector3(
      0.12 + Math.random() * 0.18,
      0.28 + Math.random() * 0.22,
      0.25 + Math.random() * 0.18
    ).multiplyScalar(c.v);
    const av = new THREE.Vector3(
      (Math.random() - 0.5) * c.spin,
      (Math.random() - 0.5) * c.spin,
      (Math.random() - 0.5) * c.spin
    );
    this.shells.push({ mesh: m, v, av, life: 0, max: 1.8 + Math.random() * 0.6 });
  },
  update(dt) {
    for (const g of this.groups) {
      const b = g.userData.bolt;
      if (b && b.t >= 0) {
        b.t += dt;
        const k = Math.min(b.t / b.dur, 1);
        b.mesh.position.z = b.rest.z + b.travel * Math.sin(Math.PI * k); // 0→1→0 平滑往复
        if (b.t >= b.dur) { b.t = -1; b.mesh.position.z = b.rest.z; }
      }
      const d = g.userData.dip;
      if (d && d.t >= 0) {
        d.t += dt;
        const k = Math.min(d.t / d.dur, 1);
        d.inner.position.y = -d.amp * Math.sin(Math.PI * k); // 下沉再回弹
        if (d.t >= d.dur) { d.t = -1; d.inner.position.y = 0; }
      }
    }
    // 弹壳物理（相机局部近似重力沿 -Y）
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life += dt;
      s.v.y -= 3.2 * dt;
      s.mesh.position.addScaledVector(s.v, dt);
      s.mesh.rotation.x += s.av.x * dt;
      s.mesh.rotation.y += s.av.y * dt;
      s.mesh.rotation.z += s.av.z * dt;
      if (s.life >= s.max) {
        this.shellParent.remove(s.mesh);
        this.shells.splice(i, 1);
      }
    }
  }
};
