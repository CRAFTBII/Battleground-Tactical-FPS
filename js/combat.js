/* ============================================
 * 战地突击 · combat.js（由 index.html 内联脚本拆分）
 * ============================================ */

let UNIT_ID = 1;

const FX = {
  tracers: [], smokes: [], parts: [], shock: [], flashes: [],
  shake: 0, muzzleLight: null,

  init(scene) {
    this.scene = scene;
    this.flashTex = makeRadialTex();
    this.smokeTex = makeSmokeTex();
    // 共享几何体（复用，避免每次射击/爆炸 new 几何体导致 GPU buffer 泄漏）
    this.tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true);
    this.partGeo = new THREE.BoxGeometry(1, 1, 1);
    this.ringGeo = new THREE.RingGeometry(0.2, 1, 26, 1);
    this.muzzleLight = new THREE.PointLight(0xffcc66, 0, 14);
    scene.add(this.muzzleLight);
  },
  tracer(from, to, color) {
    const mat = new THREE.MeshBasicMaterial({ color: color || 0xffe08a, transparent: true, opacity: 0.9 });
    const len = from.distanceTo(to);
    const m = new THREE.Mesh(this.tracerGeo, mat); // 共享几何体，长度用缩放
    m.scale.set(0.02, len, 0.02);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    // 用四元数把局部 Y（长轴）对齐 from→to —— lookAt+欧拉叠加在 scale 下会把长轴转到固定方向
    const dir = new THREE.Vector3().subVectors(to, from).normalize();
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    this.scene.add(m);
    this.tracers.push({ m, t: 0, life: 0.09 });
  },
  muzzle(pos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xfff2b0, transparent: true, depthWrite: false }));
    s.position.copy(pos); s.scale.setScalar(1.1);
    this.scene.add(s);
    this.flashes.push({ s, t: 0, life: 0.05 });
    this.muzzleLight.position.copy(pos);
    this.muzzleLight.intensity = 5;
    this.muzzleLight.decay = 3;
  },
  explosion(pos, r) {
    // 冲击环（共享单位环几何体，半径用缩放）
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffa050, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos); ring.position.y += 0.1;
    ring.scale.setScalar(r);
    this.scene.add(ring);
    this.shock.push({ m: ring, t: 0, life: 0.5, r0: r });
    // 火球
    const fb = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, color: 0xff8c2e, transparent: true, depthWrite: false }));
    fb.position.copy(pos); fb.scale.setScalar(r * 1.1);
    this.scene.add(fb);
    this.flashes.push({ s: fb, t: 0, life: 0.28 });
    // 碎片粒子
    for (let i = 0; i < 22; i++) {
      this.spawnPart(pos, new THREE.Vector3(U.rand(-1, 1), U.rand(0.3, 1.6), U.rand(-1, 1)).normalize().multiplyScalar(U.rand(3, 9)),
        U.rand(0.3, 0.7), 0xffa050, U.rand(0.25, 0.5));
    }
    this.shakePulse(Math.min(0.5, r * 0.09));
    AudioFX.explosion(pos);
  },
  smokeCloud(pos) {
    const g = new THREE.Group();
    const mat = () => new THREE.SpriteMaterial({ map: this.smokeTex, color: 0x9aa2ab, transparent: true, opacity: 0.55, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(mat());
      const a = U.rand(0, Math.PI * 2), rr = U.rand(0, 1.6);
      s.position.set(pos.x + Math.cos(a) * rr, pos.y + U.rand(0.2, 1.6), pos.z + Math.sin(a) * rr);
      s.scale.setScalar(U.rand(1.6, 2.6));
      g.add(s);
    }
    g.position.copy(pos);
    this.scene.add(g);
    this.smokes.push({ g, pos: pos.clone(), r: 1.2, t: 0, life: CFG.SMOKE_TIME });
  },
  spawnPart(pos, vel, size, color, life) {
    const m = new THREE.Mesh(this.partGeo, new THREE.MeshBasicMaterial({ color })); // 共享几何体
    m.scale.setScalar(size);
    m.position.copy(pos); m.castShadow = false;
    this.scene.add(m);
    this.parts.push({ m, vel, t: 0, life, grav: 14 });
  },
  blood(pos) { for (let i = 0; i < 8; i++) this.spawnPart(pos, new THREE.Vector3(U.rand(-1, 1), U.rand(0, 1.5), U.rand(-1, 1)).normalize().multiplyScalar(U.rand(1, 4)), 0.09, 0x8a1f1f, 0.35); },
  dirt(pos) { for (let i = 0; i < 10; i++) this.spawnPart(pos, new THREE.Vector3(U.rand(-1, 1), U.rand(0.2, 1.2), U.rand(-1, 1)).normalize().multiplyScalar(U.rand(2, 6)), 0.14, 0x6b645c, 0.4); },
  shakePulse(a) { this.shake = Math.min(0.8, this.shake + a); },
  update(dt) {
    // 所有动态创建的 material 在生命周期结束时 dispose（geometry 为共享，不 dispose）
    this.tracers = this.tracers.filter(t => {
      t.t += dt; t.m.material.opacity = 0.9 * (1 - t.t / t.life);
      if (t.t >= t.life) { this.scene.remove(t.m); t.m.material.dispose(); return false; } return true;
    });
    this.flashes = this.flashes.filter(t => {
      t.t += dt; t.s.material.opacity = 1 - t.t / t.life;
      if (t.t >= t.life) { this.scene.remove(t.s); t.s.material.dispose(); return false; } return true;
    });
    if (this.muzzleLight) this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 40);
    this.shock = this.shock.filter(t => {
      t.t += dt; const k = t.t / t.life;
      t.m.scale.setScalar(t.r0 * (1 + k * 2.2));
      t.m.material.opacity = 0.9 * (1 - k);
      if (t.t >= t.life) { this.scene.remove(t.m); t.m.material.dispose(); return false; } return true;
    });
    this.parts = this.parts.filter(p => {
      p.t += dt; p.vel.y -= p.grav * dt;
      p.m.position.addScaledVector(p.vel, dt);
      const gy = World.heightAt(p.m.position.x, p.m.position.z, p.m.position.y);
      if (p.m.position.y < gy) { p.m.position.y = gy; p.vel.y *= -0.3; p.vel.x *= 0.5; p.vel.z *= 0.5; }
      if (p.t >= p.life) { this.scene.remove(p.m); p.m.material.dispose(); return false; } return true;
    });
    this.smokes = this.smokes.filter(s => {
      s.t += dt; const k = s.t / s.life;
      s.r = 1.2 + k * 3.2;
      s.g.position.y = s.pos.y + k * 1.6;
      s.g.children.forEach(c => c.material.opacity = 0.55 * (1 - k) * (0.7 + 0.3 * Math.sin(c.position.x * 3 + c.position.z)));
      if (s.t >= s.life) { this.scene.remove(s.g); s.g.children.forEach(c => c.material.dispose()); return false; } return true;
    });
    this.shake *= Math.max(0, 1 - dt * 6);
  }
};
function makeRadialTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,220,120,0.8)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}
function makeSmokeTex() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

/* ---------- 单位（人形 = 程序化几何组合） ---------- */
class Unit {
  constructor(team, opts) {
    opts = opts || {};
    this.id = opts.id || ('u' + (UNIT_ID++));
    this.team = team;
    this.name = opts.name || (team === 'blue' ? '蓝方队员' : '红方队员');
    this.hp = CFG.PLAYER_HP; this.alive = true; this.dead = false;
    // 倒地/复活机制字段（design/maps/respawn-rework.md §8.2）
    this.life = 'alive';   // 'alive' | 'down' | 'dead'（规范态）
    this.down = false;     // 倒地标记（down 时 alive=false 兼容旧读法）
    this.downHp = 0;       // 倒地执行池（DOWN 时 = CFG.DOWN_HP；敌方武器/环境伤害扣此池）
    this.bleedT = 0;       // 剩余流血秒数（归零 → 流血致死）
    this.reviveT = 0;      // 救援进度（0=空闲；>=REVIVE_TIME=完成）
    this.reviver = null;   // 正在救援我的单位
    this.spawnProtT = 0;   // 出生无敌帧剩余（>0 时免疫敌方武器伤害）
    this.spawnAt = null;   // 出生点（无敌帧 10m 半径判定用）
    this.downAt = 0;       // 倒地时刻（渲染/计时用）
    this.pos = new THREE.Vector3(opts.x || 0, opts.y || 0, opts.z || 0);
    this.yaw = opts.yaw || (team === 'blue' ? Math.PI / 4 : -Math.PI * 0.75);
    this.pitch = 0; this.vel = new THREE.Vector3();
    this.weapon = opts.weapon || 'rifle';
    this.armor = opts.armor !== undefined ? opts.armor : U.randi(30, 100); // 护甲 0-100（AI 随机初始化）
    this.loot = null; // 死亡时可搜刮物（killUnit 填充）
    this.kills = 0; this.deaths = 0;
    this.isPlayer = !!opts.player;
    this.ai = null; this.remote = !!opts.remote;
    this.walkT = 0;
    this.jumpAnim = null; // AI 翻越矮掩体：{ y0, h, t, dur, skipCollider }
    this.usingModel = false; this.modelParts = null; this.disposed = false; // GLTF 模型替换标记
    this.buildMesh(opts.label);
  }
  buildMesh(label) {
    const grp = new THREE.Group();
    const bodyM = new THREE.MeshLambertMaterial({ color: CFG.teamColor(this.team).hex }); // 队色单一数据源（accessibility P0）
    const darkM = new THREE.MeshLambertMaterial({ color: 0x26303c });
    const skinM = new THREE.MeshLambertMaterial({ color: 0xd9a884 });
    const mk = (w, h, d, m) => { const x = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); x.castShadow = true; return x; };
    const torso = mk(0.52, 0.62, 0.3, bodyM); torso.position.y = 1.05;
    const head = mk(0.3, 0.3, 0.3, skinM); head.position.y = 1.54;
    const helm = mk(0.34, 0.1, 0.34, darkM); helm.position.y = 1.68;
    const gun = mk(0.09, 0.11, 0.78, darkM); gun.position.set(0.2, 0.92, 0.34);
    const la = mk(0.14, 0.55, 0.14, bodyM); la.position.set(0.36, 1.18, 0);
    const ra = la.clone(); ra.position.x = -0.36;
    const ll = mk(0.18, 0.78, 0.18, darkM); ll.position.set(0.13, 0.39, 0);
    const rl = ll.clone(); rl.position.x = -0.13;
    grp.add(torso, head, helm, gun, la, ra, ll, rl);
    this.mesh = { grp, torso, head, la, ra, ll, rl, gun };
    World.scene.add(grp);
    // 头顶标识牌（MC 风格：彩色半透明队色底 + 形状编码图标 + 名字文字；accessibility §4.3 形状编码保留）
    {
      const tc = CFG.teamColor(this.team);
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      const pad = 6, bw = 256 - pad * 2, bh = 64 - pad * 2;
      // 半透明队色底牌
      g.globalAlpha = 0.4; g.fillStyle = tc.css; g.fillRect(pad, pad, bw, bh); g.globalAlpha = 1;
      g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeRect(pad, pad, bw, bh);
      // 左侧形状编码图标（蓝圆/红方/绿菱/黄三角/中立空心圆）
      g.save(); g.translate(40, 32);
      const R = 17; g.globalAlpha = 0.92; g.fillStyle = tc.css; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 3;
      if (tc.shape === 'dashed') { g.fillRect(-R, -R, R * 2, R * 2); g.strokeRect(-R, -R, R * 2, R * 2); }
      else if (tc.shape === 'dotted') { g.beginPath(); g.moveTo(0, -R); g.lineTo(R, 0); g.lineTo(0, R); g.lineTo(-R, 0); g.closePath(); g.fill(); g.stroke(); }
      else if (tc.shape === 'cross') { g.beginPath(); g.moveTo(0, -R); g.lineTo(R * 0.92, R * 0.8); g.lineTo(-R * 0.92, R * 0.8); g.closePath(); g.fill(); g.stroke(); }
      else { g.beginPath(); g.arc(0, 0, R, 0, 7); if (tc.shape === 'hollow') g.stroke(); else { g.fill(); g.stroke(); } }
      g.restore();
      // 名字文字（白色 + 黑描边，保证任意底色可读）。优先 label，回退 Unit.name（本地玩家/AI 均有值）
      const nm = label || this.name;
      if (nm) {
        g.font = 'bold 30px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
        g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(nm, 70, 34);
        g.fillStyle = '#ffffff'; g.fillText(nm, 70, 34);
      }
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
      tag.scale.set(1, 0.2, 0.3); tag.position.y = 1.0;
      grp.add(tag);
    }
    // 异步加载切割模型替换方块人（失败自动回退方块人）
    if (typeof ModelLib !== 'undefined' && ModelLib.enabled()) this.tryLoadModel();
  }
  tryLoadModel() {
    ModelLib.load().then(() => {
      if (this.disposed) return;
      const inst = ModelLib.cloneForUnit();
      if (!inst || !this.mesh || !this.mesh.grp) return;
      const grp = this.mesh.grp;
      for (let i = grp.children.length - 1; i >= 0; i--) {
        if (grp.children[i].isSprite) continue; // 保留头顶名字
        grp.remove(grp.children[i]);
      }
      grp.add(inst.scene);
      this.usingModel = true;
      this.modelParts = inst.parts;
    });
  }
  setPose() {
    const MODEL_Y = 0.45; // 人物模型整体上移（视觉抬高，脚离地一点）；倒地尸体不抬（贴地）
    const p = this.mesh.grp;
    // GLTF 士兵模型脚底在 y=-0.57（split-glb 未对齐脚底）→ 活体抬升 0.57 防半截入土；
    // 倒地/方块人脚在原点不补（倒地尸体贴地）
    const groundOff = (this.usingModel && this.modelParts && this.alive) ? 0.57 : 0;
    // 潜伏伏地：模型压扁 + 贴地（缩小被弹面积视觉化）
    const prone = !!(this.ai && this.ai.prone);
    if (prone && this.alive) p.scale.y = 0.45; else p.scale.y = 1;
    p.position.set(this.pos.x, this.pos.y + groundOff + MODEL_Y + (prone && this.alive ? -0.28 : 0), this.pos.z);
    p.rotation.y = this.yaw;
    const moving = this.ai && this.ai.moving || (this.vel.lengthSq() > 0.5);
    // GLTF 模型：程序化关节走路动画（腿/臂绕 pivot 摆动 + 弹跳）
    if (this.usingModel && this.modelParts) {
      const mp = this.modelParts;
      if (!this.alive) {
        p.rotation.x = Math.PI / 2 * Math.min(1, (Date.now() - this.deathAt) / 400); // 倒地
        p.position.y = this.pos.y;
        return;
      }
      if (moving) {
        const sprint = this.ai && this.ai.sprinting;
        this.walkT += sprint ? 0.26 : 0.14; // 疾跑步伐更快
        const ph = this.walkT * (sprint ? 3.4 : 2.3);
        mp.legL.rotation.x = Math.sin(ph) * (sprint ? 0.75 : 0.55);
        mp.legR.rotation.x = -Math.sin(ph) * (sprint ? 0.75 : 0.55);
        mp.armL.rotation.x = -Math.sin(ph) * (sprint ? 0.6 : 0.4);
        mp.armR.rotation.x = Math.sin(ph) * (sprint ? 0.6 : 0.4);
        p.position.y = this.pos.y + groundOff + MODEL_Y + (prone ? -0.28 : 0) + Math.abs(Math.sin(ph)) * (sprint ? 0.14 : 0.09); // 疾跑弹跳更高
        p.rotation.x = sprint ? 0.14 : 0; // 冲锋前倾（持枪奔跑姿态）
      } else {
        this.walkT = 0;
        mp.legL.rotation.x = 0; mp.legR.rotation.x = 0;
        mp.armL.rotation.x = 0.12; mp.armR.rotation.x = -0.12; // 持枪待机
        p.position.y = this.pos.y + groundOff + MODEL_Y + (prone ? -0.28 : 0);
        p.rotation.x = 0; // 复活复位（死亡时置 PI/2，重生后必须归零，否则躺尸）
      }
      return;
    }
    // 方块人 fallback
    const sprint = this.ai && this.ai.sprinting;
    if (moving) this.walkT += sprint ? 0.18 : 0.09; else this.walkT = 0;
    const sw = Math.sin(this.walkT * (sprint ? 9 : 6)) * (moving ? (sprint ? 0.75 : 0.5) : 0);
    this.mesh.ll.rotation.x = sw; this.mesh.rl.rotation.x = -sw;
    this.mesh.la.rotation.x = -sw * 0.7; this.mesh.ra.rotation.x = sw * 0.7;
    if (sprint && moving) p.rotation.x = 0.14; // 冲锋前倾
    else if (!this.alive) p.rotation.x = Math.PI / 2 * Math.min(1, (Date.now() - this.deathAt) / 300);
    else p.rotation.x = 0; // 复活复位（方块人）
  }
  updateVisual(dt) {
    if (this.jumpAnim) { // AI 翻越跳跃弧线
      this.jumpAnim.t += dt;
      const k = Math.min(1, this.jumpAnim.t / this.jumpAnim.dur);
      this.pos.y = this.jumpAnim.y0 + Math.sin(k * Math.PI) * this.jumpAnim.h;
      if (k >= 1) this.jumpAnim = null;
    } else if (!this.isPlayer) {
      // 玩家单位的高度由 PC.update（跳跃/重力）管理；AI/远端单位贴地即可
      this.pos.y = World.heightAt(this.pos.x, this.pos.z, this.pos.y);
    }
    this.setPose();
  }
  dispose() { this.disposed = true; World.scene.remove(this.mesh.grp); }
}

/* ---------- 武器数据表 ----------
 * rationale：
 * 手枪 25×4=100 —— 4 发击杀，半自动高精度，作为兜底武器（TTK≈0.6s）
 * 步枪 17×6=102 —— 6 发击杀，600rpm 全自动，TTK≈0.5s，中距离主力
 * 狙击 90 点胸 —— 两枪击杀，爆头 ×2 秒杀，射速惩罚 30rpm
 * 霰弹 9×8 弹丸 —— 近距 72 点，15m 外衰减到 1/4，绝无中远距离优势 */
const WEAPONS = {
  pistol:  { name: 'P-9 手枪',   dmg: 25, mag: 12, reserve: 48, rpm: 360, spread: 0.014, reloadT: 1.4, auto: false, range: 90,  head: 2, pellets: 1, fall: 0.7, aimFov: 58, aimPos: [0.02, -0.13, -0.34] },
  rifle:   { name: 'AR-15 步枪', dmg: 17, mag: 30, reserve: 90, rpm: 600, spread: 0.02,  reloadT: 2.2, auto: true,  range: 160, head: 2, pellets: 1, fall: 0.65, aimFov: 48, aimPos: [0, -0.15, -0.38] },
  sniper:  { name: 'M24 狙击枪', dmg: 90, mag: 5,  reserve: 15, rpm: 30,  spread: 0.001, reloadT: 3.0, auto: false, range: 400, head: 2, pellets: 1, fall: 1, aimFov: 22, aimPos: [0, -0.16, -0.40] },
  shotgun: { name: 'SPAS-12 霰弹', dmg: 9, mag: 8, reserve: 24, rpm: 55, spread: 0.085, reloadT: 2.6, auto: false, range: 42,  head: 1.5, pellets: 8, fall: 0.25, aimFov: 55, aimPos: [0, -0.14, -0.36] }
};

/* ---------- 投射物（手雷 / 烟雾弹 / 迫击炮弹） ---------- */
const Projectiles = {
  list: [],
  spawn(type, pos, vel, team, owner, opts) {
    opts = opts || {};
    let mesh;
    if (type === 'grenade') mesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshLambertMaterial({ color: 0x2f5a2f }));
    else if (type === 'smoke') mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.24, 8), new THREE.MeshLambertMaterial({ color: 0x8a8f96 }));
    else mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 1.1, 8), new THREE.MeshBasicMaterial({ color: 0xff8c2e })); // 迫击炮弹：加大 + 自发光，弹道醒目
    mesh.position.copy(pos);
    World.scene.add(mesh);
    if (type === 'mortar') {
      this.list.push({ type, mesh, pos: pos.clone(), vel: new THREE.Vector3(), team, owner,
        fuse: 99, t: 0, bounces: 0, air: true,
        origin: pos.clone(), target: opts.target ? opts.target.clone() : pos.clone(),
        t0: opts.t0 || 2.6, flight: opts.t0 || 2.6, arc: opts.arc || 20 });
    } else {
      this.list.push({ type, mesh, pos: pos.clone(), vel: vel.clone(), team, owner,
        fuse: type === 'grenade' ? 2.8 : 0.9, t: 0, bounces: 0, air: false,
        origin: null, target: null, t0: 1, flight: 0, arc: 0 });
    }
  },
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      if (p.air) { // 迫击炮弹：按固定飞行时间弹道
        p.flight -= dt;
        const t01 = 1 - U.clamp(p.flight / p.t0, 0, 1);
        p.mesh.position.lerpVectors(p.origin, p.target, t01);
        p.mesh.position.y = p.origin.y + (p.target.y - p.origin.y) * t01 + Math.sin(t01 * Math.PI) * p.arc;
        p.pos.copy(p.mesh.position);
        if (p.flight <= 0) { this.explode(p); this.list.splice(i, 1); continue; }
        continue;
      }
      p.vel.y -= CFG.GRAV * dt;
      const prevX = p.pos.x, prevZ = p.pos.z, prevY = p.pos.y;
      p.pos.addScaledVector(p.vel, dt);
      // 墙体碰撞：检测移动后位置是否陷入 AABB（高度覆盖）→ 反弹/停住，杜绝穿墙
      let hitWall = false;
      for (const c of World.colliders) {
        if (c.max.y < 0.8) continue;
        if (p.pos.x > c.min.x && p.pos.x < c.max.x && p.pos.z > c.min.z && p.pos.z < c.max.z && p.pos.y > c.min.y && p.pos.y < c.max.y) {
          hitWall = true; break;
        }
      }
      if (hitWall) {
        p.pos.x = prevX; p.pos.z = prevZ; p.pos.y = prevY; // 退回上一步
        p.vel.x *= -0.25; p.vel.z *= -0.25;
        if (p.type === 'smoke') { this.explode(p); this.list.splice(i, 1); continue; }
      }
      p.mesh.position.copy(p.pos);
      p.mesh.rotation.x += dt * 8; p.mesh.rotation.z += dt * 5;
      const gy = World.heightAt(p.pos.x, p.pos.z, p.pos.y);
      if (p.pos.y <= gy + 0.05) {
        p.pos.y = gy + 0.05;
        if (p.type === 'grenade') {
          if (p.bounces < 2 && Math.abs(p.vel.y) > 1.2) { p.vel.y *= -0.45; p.vel.x *= 0.55; p.vel.z *= 0.55; p.bounces++; }
          else { p.vel.set(0, 0, 0); }
        } else {
          this.explode(p); this.list.splice(i, 1); continue;
        }
      }
      if (p.t >= p.fuse) { this.explode(p); this.list.splice(i, 1); }
    }
  },
  explode(p) {
    World.scene.remove(p.mesh);
    p.mesh.geometry.dispose(); p.mesh.material.dispose(); // 释放 GPU 资源，防泄漏
    if (p.type === 'grenade') {
      Game.areaDamage(p.pos, 5, 100, p.owner, p.team);
      FX.explosion(p.pos, 5);
    } else if (p.type === 'smoke') {
      FX.smokeCloud(p.pos);
      AudioFX.smoke(p.pos);
    } else {
      Game.areaDamage(p.pos, 6, 65, p.owner, p.team);
      FX.explosion(p.pos, 6);
      if (Game.player && U.dist(p.pos.x, p.pos.z, Game.player.pos.x, Game.player.pos.z) < 40) FX.shakePulse(0.4);
      if (Net.isHost || !Net.connected) Net.broadcastEvent && Net.broadcastEvent({ k: 'boom', x: p.pos.x, y: p.pos.y, z: p.pos.z, r: 6 });
    }
  }
};

/* ---------- 命中结算（玩家与 AI 共用） ----------
 * 返回命中目标或 null；负责伤害、特效、命中反馈 */
function resolveShot(shooter, origin, dir, weaponName, isPlayerShooter) {
  const W = WEAPONS[weaponName];
  const dirN = dir.clone().normalize();
  let best = null, bestT = Infinity;
  for (const u of Game.units) {
    // 存活与倒地均可被命中（倒地者是可被补枪处决的"活靶"；最终死亡才不可命中）
    if ((!u.alive && !u.down) || u.team === shooter.team || u === shooter) continue;
    const headP = new THREE.Vector3(u.pos.x, u.pos.y + 1.55, u.pos.z);
    const bodyP = new THREE.Vector3(u.pos.x, u.pos.y + 0.95, u.pos.z);
    const h = raySphere(origin, dirN, headP, 0.24);
    const b = raySphere(origin, dirN, bodyP, 0.55);
    const ht = h ? raySphereT(origin, dirN, headP, 0.24) : Infinity;
    const bt = b ? raySphereT(origin, dirN, bodyP, 0.55) : Infinity;
    const t = Math.min(ht, bt);
    if (t < bestT) { bestT = t; best = { unit: u, head: ht < bt, t }; }
  }
  let hitPos = best ? origin.clone().addScaledVector(dirN, best.t) : null;
  if (hitPos && best.t > (W.range * 1.4)) { best = null; hitPos = null; }
  // 世界遮挡检查
  if (hitPos) {
    const blk = World.rayBlocked(origin, hitPos);
    if (blk) { hitPos = blk; best = null; }
  }
  if (best) {
    const dist = origin.distanceTo(hitPos);
    let dmg = W.dmg;
    if (W.pellets > 1) {
      const k = dist < 8 ? 1 : dist < 18 ? 0.5 : 0.25;
      dmg = W.dmg * k;
    } else {
      const f = dist > W.range ? W.fall : 1;
      dmg *= f;
    }
    if (best.head) dmg *= W.head;
    Game.applyDamage(best.unit, dmg, shooter, best.head);
    FX.blood(hitPos);
    if (isPlayerShooter) {
      if (best.head) UI.showHit(true); else UI.showHit(false);
      AudioFX.hit();
    }
  } else if (hitPos) {
    FX.dirt(hitPos);
    if (typeof AudioFX !== 'undefined' && AudioFX.impact) AudioFX.impact(hitPos); // 墙面/地面命中撞击声
  }
  // 敌方子弹未命中玩家且弹道近距离擦过 → 子弹呼啸（near-miss，FPS 灵魂音效）
  const hitPlayer = best && best.unit === Game.player;
  if (!isPlayerShooter && !hitPlayer && Game.player && Game.player.alive && !Game.player.down) {
    const pp = Game.player.pos;
    const rel = new THREE.Vector3(pp.x, pp.y + 1.2, pp.z).sub(origin);
    const tNear = Math.max(0, rel.dot(dirN));
    if (tNear > 0 && tNear < (W.range || 60)) {
      const cp = origin.clone().addScaledVector(dirN, tNear);
      const missDist = cp.distanceTo(new THREE.Vector3(pp.x, pp.y + 1.2, pp.z));
      if (missDist < 1.8 && typeof AudioFX !== 'undefined' && AudioFX.nearMiss) AudioFX.nearMiss(cp, missDist);
    }
  }
  return best;
}
function raySphereT(origin, dir, center, r) {
  const oc = new THREE.Vector3().subVectors(origin, center);
  const b = oc.dot(dir), c = oc.dot(oc) - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 0.1 ? t : Infinity;
}

/* ---------- 玩家枪械状态与开火 ---------- */
const HIP_WEAPON_POS = [0.26, -0.24, -0.5]; // 腰射位（右下角持枪）
const PlayerGun = {
  cur: 'rifle', mags: {}, reserves: {}, reloading: false, reloadEnd: 0,
  lastShot: 0, meleeCd: 0, gCd: 0, smokeCd: 0,
  models: {}, aimT: 0, armor: 100, // 开镜动画进度 0=腰射 1=开镜；护甲 0-100
  medkits: 5, armorkits: 0, grenades: 3, smokes: 2, // 消耗品：医疗包开局 5 个
  init(camera) {
    for (const w in WEAPONS) { this.mags[w] = WEAPONS[w].mag; this.reserves[w] = WEAPONS[w].reserve; }
    this.armor = 100; this.medkits = CFG.PLAYER_START_MEDKITS; this.armorkits = 0; this.grenades = 3; this.smokes = 2;
    this.buildModels(camera);
  },
  buildModels(camera) {
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x23272c });
    const mk = (g, w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
    const barrel = (g, r, len, m, x, y, z) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m); c.rotation.x = Math.PI / 2; c.position.set(x, y, z); g.add(c); };
    const mkG = () => { const g = new THREE.Group(); camera.add(g); g.position.set(HIP_WEAPON_POS[0], HIP_WEAPON_POS[1], HIP_WEAPON_POS[2]); g.visible = false; return g; };
    // 武器模型：优先玩家自建真实 GLB（buildRealWeapon）→ 回退 WEAPONS_DATA → 方块
    const build = (w, block) => {
      const g = mkG();
      let m = null;
      if (typeof buildRealWeapon === 'function') m = buildRealWeapon(w);
      if (!m && (typeof ModelLib !== 'undefined' && ModelLib.enabled())) m = ModelLib.buildWeaponMesh(w);
      if (m) g.add(m);
      else block(g);
      this.models[w] = g;
      if (typeof WeaponAnim !== 'undefined') WeaponAnim.attach(g, w); // 挂枪栓/抛壳/换弹钩子
    };
    build('pistol', g => {
      mk(g, 0.07, 0.1, 0.2, mat, 0, 0, 0); barrel(g, 0.022, 0.14, dark, 0, 0.02, -0.16); mk(g, 0.06, 0.16, 0.06, dark, 0, -0.12, 0.02);
    });
    build('rifle', g => {
      mk(g, 0.07, 0.1, 0.5, mat, 0, 0, 0); barrel(g, 0.016, 0.22, dark, 0, 0.03, -0.34);
      mk(g, 0.07, 0.16, 0.07, dark, 0, -0.12, 0.16); mk(g, 0.06, 0.1, 0.1, dark, 0, 0, 0.24);
      mk(g, 0.05, 0.035, 0.16, dark, 0, 0.07, 0.05); mk(g, 0.03, 0.03, 0.1, dark, 0, 0.06, -0.28);
    });
    build('sniper', g => {
      mk(g, 0.06, 0.09, 0.72, mat, 0, 0, 0); barrel(g, 0.014, 0.3, dark, 0, 0.03, -0.48);
      mk(g, 0.05, 0.16, 0.06, dark, 0, -0.11, 0.22); barrel(g, 0.03, 0.24, dark, 0, 0.09, 0.05);
    });
    build('shotgun', g => {
      mk(g, 0.08, 0.11, 0.46, mat, 0, 0, 0); barrel(g, 0.03, 0.24, dark, 0, 0.03, -0.33);
      mk(g, 0.09, 0.14, 0.08, dark, 0, -0.13, 0.12); mk(g, 0.07, 0.06, 0.2, dark, 0, 0.09, -0.1);
    });
    this.setCur('rifle');
  },
  setCur(w) {
    this.cur = w;
    const isWeapon = !!WEAPONS[w];
    for (const k in this.models) this.models[k].visible = isWeapon && (k === w);
    this.reloading = false;
    this.aimT = 0; Game.scoped = false; // 切枪强制收镜
    UI.scope(false); UI.aim(false); // 清镜筒 overlay 与准星状态
    UI.slots(w);
  },
  reload() {
    const W = WEAPONS[this.cur];
    if (!W) return; // 非武器槽（医疗包等）不换弹
    if (this.reloading || this.mags[this.cur] >= W.mag || this.reserves[this.cur] <= 0) return;
    this.reloading = true; this.reloadEnd = performance.now() / 1000 + W.reloadT;
    this.aimT = 0; Game.scoped = false; // 换弹强制收镜
    AudioFX.reload();
    if (typeof WeaponAnim !== 'undefined') WeaponAnim.startReload(this.cur, this.models[this.cur]); // 弹匣脱落
    UI.reload(W.reloadT);
  },
  update(dt, keys, cam) {
    const now = performance.now() / 1000;
    if (this.reloading && now >= this.reloadEnd) {
      const W = WEAPONS[this.cur], need = W.mag - this.mags[this.cur];
      const take = Math.min(need, this.reserves[this.cur]);
      this.mags[this.cur] += take; this.reserves[this.cur] -= take;
      this.reloading = false;
      if (typeof WeaponAnim !== 'undefined') WeaponAnim.finishReload(this.cur, this.models[this.cur]); // 推入新匣
    }
    this.meleeCd -= dt; this.gCd -= dt; this.smokeCd -= dt;
    // 玩家倒地禁射击/禁开镜（§2.5；Game.player 可能在开局前为空 → 防御）
    const pDown = !!(Game.player && Game.player.down);
    // 自动开火
    const _W0 = WEAPONS[this.cur];
    if (_W0 && _W0.auto && keys.has('Mouse0') && !Game.mortarMode && Game.phase === 'playing' && !pDown) this.tryFire(cam);
    // 开镜：所有枪右键瞄准（腰射→开镜平滑动画，动枪位置模拟抵肩瞄准；无黑边遮罩）
    const wantAim = keys.has('Mouse2') && !this.reloading && !Game.mortarMode && Game.phase === 'playing' && !pDown;
    const aimSpeed = wantAim ? 10 : 8; // 开镜快、收镜略慢（手感）
    this.aimT = U.clamp(this.aimT + (wantAim ? dt * aimSpeed : -dt * aimSpeed), 0, 1);
    const scopedNow = this.aimT > 0.5;
    if (scopedNow !== Game.scoped) {
      // 狙击 = 镜内视野（SVG 镜筒+刻度，隐藏普通准星）；其他枪 = 抵肩（准星缩小）
      if (this.cur === 'sniper') UI.scope(scopedNow);
      else UI.aim(scopedNow);
    }
    Game.scoped = scopedNow;
    const W = WEAPONS[this.cur];
    const hipPos = HIP_WEAPON_POS;
    const aimPos = W ? W.aimPos : null;
    const g = this.models[this.cur];
    if (g && aimPos) { // 非武器槽（医疗包等）无模型无开镜位 → 跳过持枪动画
      const e = U.easeOut(this.aimT);
      g.position.set(
        hipPos[0] + (aimPos[0] - hipPos[0]) * e,
        hipPos[1] + (aimPos[1] - hipPos[1]) * e,
        hipPos[2] + (aimPos[2] - hipPos[2]) * e
      );
      // 狙击开镜 = 镜内视野：镜头完全到位后隐藏枪模型（瞄准镜画面里不该有自己的枪管挡视线），收镜过半才恢复（避免枪在中央突兀出现）
      if (this.cur === 'sniper') g.visible = this.aimT < 0.5;
    }
    if (Game.mortarMode) { cam.fov = 60; }
    else {
      const targetFov = W ? (70 + (W.aimFov - 70) * U.easeOut(this.aimT)) : 70;
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 12);
    }
    cam.updateProjectionMatrix();
  },
  tryFire(cam) {
    if (Game.mortarMode || Game.phase !== 'playing' || Game.player.dead || Game.player.down || !PC.locked) return;
    const W = WEAPONS[this.cur];
    if (!W) return; // 非武器槽（医疗包/护甲包/手雷等）不射击
    const now = performance.now() / 1000;
    if (this.reloading || now - this.lastShot < 60 / W.rpm) return;
    if (this.mags[this.cur] <= 0) {
      // 无弹：有备弹 → 换弹；弹尽粮绝 → 刺刀近战（F 键挥击同款）
      if ((this.reserves[this.cur] || 0) > 0) { this.reload(); AudioFX.ui(); return; }
      this.melee();
      UI.toast('弹药耗尽 · 刺刀攻击');
      return;
    }
    this.lastShot = now;
    this.mags[this.cur]--;
    // §4.5：开火即清出生无敌帧（防"无敌窗白嫖对枪"）
    if (Game.player.spawnProtT > 0) Game.player.spawnProtT = 0;
    cam.updateMatrixWorld(true); // 刷新本帧相机矩阵，弹道/准星严格跟随当前视角（否则滞后一帧）
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const aimBonus = this.aimT > 0.5 ? 0.4 : 1; // 开镜：散布缩至 40%，腰射 vs 开镜的精度差异
    for (let p = 0; p < W.pellets; p++) {
      const d = dir.clone();
      d.x += U.rand(-W.spread, W.spread) * aimBonus; d.y += U.rand(-W.spread, W.spread) * aimBonus; d.z += U.rand(-W.spread, W.spread) * aimBonus;
      const hit = resolveShot(Game.player, cam.position.clone(), d, this.cur, true);
      if (hit) Net.broadcastEvent({ k: 'shot', w: this.cur, hx: hit.unit ? hit.unit.id : null, head: hit.head });
    }
    // 曳光 + 枪口（按当前枪实际位置动态算：腰射右下、开镜居中，枪口在枪前 -len/2）
    const wlen = (typeof ModelLib !== 'undefined' && ModelLib.WEAPON_LEN) ? (ModelLib.WEAPON_LEN[this.cur] || 0.6) : 0.6;
    const gPos = this.models[this.cur] ? this.models[this.cur].position : new THREE.Vector3(HIP_WEAPON_POS[0], HIP_WEAPON_POS[1], HIP_WEAPON_POS[2]);
    const muzzleW = cam.localToWorld(new THREE.Vector3(gPos.x, gPos.y, gPos.z - wlen / 2 - 0.03));
    const end = cam.position.clone().addScaledVector(dir, 60);
    FX.tracer(muzzleW, end, this.cur === 'sniper' ? 0xfff0c0 : 0xffe08a);
    FX.muzzle(muzzleW);
    // 后座
    PC.recoil += 0.011 + (this.cur === 'sniper' ? 0.03 : this.cur === 'shotgun' ? 0.02 : 0);
    FX.shakePulse(this.cur === 'sniper' ? 0.18 : 0.08);
    AudioFX.shot(this.cur);
    if (typeof WeaponAnim !== 'undefined') WeaponAnim.fire(this.cur, this.models[this.cur]); // 拉栓 + 抛壳
    Net.broadcastEvent({ k: 'fire', id: Game.player.id, w: this.cur, x: Game.player.pos.x, y: Game.player.pos.y, z: Game.player.pos.z, yaw: Game.player.yaw });
  },
  melee() {
    if (this.meleeCd > 0 || Game.mortarMode || Game.phase !== 'playing' || Game.player.down) return;
    this.meleeCd = 0.38;
    AudioFX.shot('melee');
    PC.recoil += 0.02;
    const dir = camera.getWorldDirection(new THREE.Vector3());
    let hit = null, bestT = 2.4; // 近战范围 2.4m（v2.2 加强，冲刺近身容易得手）
    for (const u of Game.units) {
      // 倒地敌人也可被近战处决（活靶语义）
      if ((!u.alive && !u.down) || u.team === Game.player.team || u === Game.player) continue;
      const to = new THREE.Vector3(u.pos.x, u.pos.y + 1, u.pos.z).sub(camera.position);
      const d = to.length();
      if (d < bestT && to.normalize().dot(dir) > 0.5) { bestT = d; hit = u; }
    }
    if (hit) { Game.applyDamage(hit, 75, Game.player, false); FX.blood(new THREE.Vector3(hit.pos.x, hit.pos.y + 1.2, hit.pos.z)); AudioFX.hit(); UI.showHit(false); }
    // 挥击特效
    const e = camera.localToWorld(new THREE.Vector3(0.2, -0.15, -1));
    FX.tracer(e, e.clone().addScaledVector(dir, 1.8), 0xffffff);
  },
  throwGrenade() {
    if (this.grenades === undefined) this.grenades = 0; // 防御：未初始化兜底
    if (this.gCd > 0 || Game.mortarMode || Game.phase !== 'playing' || Game.player.dead || Game.player.down) return;
    if (this.grenades <= 0) { UI.toast('手雷不足'); AudioFX.ui(); return; } // 数量检查（修复：0 也能扔）
    this.grenades--; // 消耗
    this.gCd = 1.0;
    const origin = camera.localToWorld(new THREE.Vector3(0, -0.2, -0.8));
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(16); vel.y += 4;
    Projectiles.spawn('grenade', origin, vel, Game.player.team, Game.player);
    Net.broadcastEvent({ k: 'throw', t: 'grenade', x: origin.x, y: origin.y, z: origin.z, vx: vel.x, vy: vel.y, vz: vel.z });
    AudioFX.ui();
    UI.slots(this.cur);
  },
  throwSmoke() {
    if (this.smokes === undefined) this.smokes = 0; // 防御：未初始化兜底
    if (this.smokeCd > 0 || Game.mortarMode || Game.phase !== 'playing' || Game.player.dead || Game.player.down) return;
    if (this.smokes <= 0) { UI.toast('烟雾弹不足'); AudioFX.ui(); return; }
    this.smokes--;
    this.smokeCd = 1.0;
    const origin = camera.localToWorld(new THREE.Vector3(0, -0.2, -0.8));
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const vel = dir.clone().multiplyScalar(15); vel.y += 3.5;
    Projectiles.spawn('smoke', origin, vel, Game.player.team, Game.player);
    Net.broadcastEvent({ k: 'throw', t: 'smoke', x: origin.x, y: origin.y, z: origin.z, vx: vel.x, vy: vel.y, vz: vel.z });
    AudioFX.ui();
    UI.slots(this.cur);
  },
  /* 医疗包：使用回血 50（每局 5 个，击杀/掉落补充） */
  useMedkit() {
    if (this.medkits === undefined) this.medkits = 0; // 防御：未初始化兜底
    if (this.medkits <= 0 || Game.player.dead || Game.player.down || Game.phase !== 'playing') return;
    // v2.5 防御：hp 净化——若已被污染为 NaN 先归位满血，再回血（防 NaN 传播到 UI）
    if (!Number.isFinite(Game.player.hp)) Game.player.hp = CFG.PLAYER_HP;
    const hp = Game.player.hp;
    if (hp >= CFG.PLAYER_HP) { UI.toast('生命已满'); return; }
    this.medkits--;
    Game.player.hp = Math.min(CFG.PLAYER_HP, hp + 50);
    UI.updateHealth();
    UI.toast('使用医疗包 生命 +' + (Game.player.hp - hp));
    AudioFX.heal ? AudioFX.heal() : AudioFX.ui();
    UI.slots(this.cur);
  },
  /* 护甲包：修复护甲 +50 */
  useArmorkit() {
    if (this.armorkits === undefined) this.armorkits = 0; // 防御：未初始化兜底
    if (this.armorkits <= 0 || Game.player.dead || Game.player.down) return;
    if (this.armor >= 100) { UI.toast('护甲已满'); return; }
    const before = this.armor;
    this.armor = Math.min(100, this.armor + 50);
    // v2.5 修复护甲双字段：护甲包同时同步战斗护甲（Unit.armor，伤害实际扣的是它）——
    // 此前只加背包侧 → 玩家用甲后减伤没变，护甲包实际无效
    if (Game.player && Game.player.armor !== undefined) {
      Game.player.armor = Math.min(100, Game.player.armor + 50);
      UI.armorBar(Game.player.armor);
    }
    this.armorkits--;
    UI.armorBar(this.armor);
    UI.toast('使用护甲包 护甲 +' + (this.armor - before));
    AudioFX.ui();
    UI.slots(this.cur);
  },
  /* Q 丢弃当前槽物品到地面（Minecraft 风格） */
  discard() {
    if (Game.player.dead || Game.player.down || Game.phase !== 'playing' || typeof Items === 'undefined') return;
    const gPos = this.models[this.cur] ? this.models[this.cur].position : new THREE.Vector3(0, 1.5, -1);
    const wPos = camera.localToWorld(gPos.clone());
    const drop = { pistol: ['ammo', 'pistol'], rifle: ['ammo', 'rifle'], sniper: ['ammo', 'sniper'], shotgun: ['ammo', 'shotgun'] };
    if (drop[this.cur]) {
      const [type, w] = drop[this.cur];
      if (this.reserves[w] <= 0) { UI.toast('没有可丢弃的 ' + WEAPONS[w].name + ' 弹药'); return; }
      const amt = Math.min(15, this.reserves[w]);
      this.reserves[w] -= amt;
      Items.discard(type, wPos.x, wPos.y, wPos.z, amt, w);
      UI.toast('丢弃 ' + WEAPONS[w].name + ' 弹药 ×' + amt);
    } else if (this.cur === 'medkit') {
      if (this.medkits <= 0) return;
      this.medkits--; Items.discard('medkit', wPos.x, wPos.y, wPos.z, 1);
      UI.toast('丢弃 医疗包 ×1');
    } else if (this.cur === 'armorkit') {
      if (this.armorkits <= 0) return;
      this.armorkits--; Items.discard('armorkit', wPos.x, wPos.y, wPos.z, 50);
      UI.toast('丢弃 护甲包 ×1');
    } else if (this.cur === 'grenade') {
      if (this.grenades <= 0) return;
      this.grenades--; Items.discard('grenade', wPos.x, wPos.y, wPos.z, 1);
      UI.toast('丢弃 手雷 ×1');
    } else if (this.cur === 'smoke') {
      if (this.smokes <= 0) return;
      this.smokes--; Items.discard('smoke', wPos.x, wPos.y, wPos.z, 1);
      UI.toast('丢弃 烟雾弹 ×1');
    }
    UI.slots(this.cur);
  }
};

/* ---------- 第一人称控制器 ---------- */
const PC = {
  yaw: 0, pitch: 0, recoil: 0, locked: false, vy: 0, onGround: true, footT: 0, sens: 0.22,
  keys: new Set(), prone: false, // 潜伏（Ctrl 按住）：相机降低 + 移动变慢 + AI 更难命中
  init() {
    document.addEventListener('mousemove', e => {
      if (!this.locked || Game.phase !== 'playing') return;
      // v2.10 视角防倒置：sens 被污染(NaN,设置清空/外部写入)会让 pitch/yaw 永久 NaN → 相机翻转。
      // 非有限 sens 回退默认；结果非有限丢弃（保持上帧）；已被污染则从 0 重启（防卡视角）
      if (!Number.isFinite(this.yaw)) this.yaw = 0;
      if (!Number.isFinite(this.pitch)) this.pitch = 0;
      const s = Number.isFinite(this.sens) ? this.sens : 0.22;
      if (Game.mortarMode) { // 迫击炮：鼠标左右转方位（视角跟随），上下可观察落点
        Game.mortarYaw -= e.movementX * 0.004;
        this.yaw = Game.mortarYaw;
        const np = U.clamp(this.pitch - e.movementY * s * 0.002, -1.45, 1.45);
        if (Number.isFinite(np)) this.pitch = np;
        return;
      }
      const ny = this.yaw - e.movementX * s * 0.002;
      const np = U.clamp(this.pitch - e.movementY * s * 0.002, -1.45, 1.45);
      if (Number.isFinite(ny)) this.yaw = ny;
      if (Number.isFinite(np)) this.pitch = np;
    });
    // 滚轮：迫击炮模式下调整仰角（向上滚 = 更高角度 = 射程更近）
    document.addEventListener('wheel', e => {
      if (this.locked && Game.mortarMode && Game.phase === 'playing') {
        Game.mortarAngle = U.clamp(Game.mortarAngle - Math.sign(e.deltaY) * 3, 20, 78);
        e.preventDefault();
      } else if (this.locked && !Game.mortarMode && Game.phase === 'playing') {
        // 滚轮切换热键槽（Minecraft 风格循环）
        const order = ['pistol', 'rifle', 'sniper', 'shotgun', 'medkit', 'armorkit', 'grenade', 'smoke'];
        const i = order.indexOf(PlayerGun.cur);
        if (i >= 0) {
          const next = (i + (e.deltaY > 0 ? 1 : order.length - 1)) % order.length;
          PlayerGun.setCur(order[next]);
          e.preventDefault();
        }
      }
    }, { passive: false });
    document.addEventListener('keydown', e => {
      this.keys.add(e.code);
      const a = Settings.actionByCode(e.code);
      if (!a) return;
      // v2.1 吃鸡制观战：玩家阵亡后 交互/丢弃 键切换跟随的 AI 队友（优先于其他按键，防死亡时误触发交互）
      if (Game.player && Game.player.dead && Game.spectator) {
        if (a === 'interact') { Game.spectateNext(1); e.preventDefault(); return; }
        if (a === 'discard' && !e.ctrlKey && !e.metaKey) { Game.spectateNext(-1); e.preventDefault(); return; }
      }
      switch (a) {
        case 'reload': PlayerGun.reload(); break;
        case 'slot1': PlayerGun.setCur('pistol'); break;
        case 'slot2': PlayerGun.setCur('rifle'); break;
        case 'slot3': PlayerGun.setCur('sniper'); break;
        case 'slot4': PlayerGun.setCur('shotgun'); break;
        case 'slot5': PlayerGun.setCur('medkit'); break;
        case 'slot6': PlayerGun.setCur('armorkit'); break;
        case 'slot7': PlayerGun.setCur('grenade'); break;
        case 'slot8': PlayerGun.setCur('smoke'); break;
        case 'melee': PlayerGun.melee(); break;
        case 'grenade': PlayerGun.throwGrenade(); break;
        case 'smoke': PlayerGun.throwSmoke(); break;
        case 'discard': if (!e.ctrlKey && !e.metaKey) { PlayerGun.discard(); e.preventDefault(); } break; // Q 丢弃（防 Ctrl+Q 关页）
        case 'mortar': Game.toggleMortar(); break;
        // E 键优先级（respawn-rework §2.2）：①救援 > ②Mechanics.interact > ③搜刮尸体
        case 'interact': {
          if (Game.player && !Game.player.dead && !Game.player.down) {
            const rt = Game.findReviveTargetForPlayer();
            if (rt) {
              // hold-to-revive：房主/单机直接开始；客户端发 revive_req 由房主裁决
              if (Net.connected && !Net.isHost) Net.sendState({ t: 'revive_req', target: rt.id });
              else if (!Game.startRevive(Game.player, rt)) UI.toast('医疗包不足，无法救援！'); // v2.4 救援耗包
            } else if (typeof Mechanics !== 'undefined' && Mechanics.dispatch && Mechanics.dispatch('interact')) {
              // 机制交互（探照灯断电面板 / 空投箱拾取）已处理
            } else {
              const corpse = Backpack.nearestCorpse();
              if (corpse) {
                const r = Backpack.lootCorpse(corpse);
                UI.toast('搜刮：' + r.msg);
                AudioFX.ui();
              }
            }
          }
          break;
        }
        // 背包开合（仓库互通；仅对局中）
        case 'inventory': if (Game.phase === 'playing' && !Game.player.dead && typeof UI !== 'undefined') UI.toggleInventory(); break;
        // 对讲机命令（蓝队指挥）：集合 / 自由 / 进攻 / 防守（浏览器 F1-F4 被系统占用）
        case 'cmdGroup': Game.squadCommand('group'); break;
        case 'cmdFree': Game.squadCommand('free'); break;
        case 'cmdAttack': Game.squadCommand('attack'); break;
        case 'cmdDefend': Game.squadCommand('defend'); break;
        case 'scoreboard': UI.scoreboard(true); e.preventDefault(); break;
      }
    });
    document.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      const a = Settings.actionByCode(e.code);
      if (!a) return;
      // 释放 交互键 → 取消救援（hold-to-revive，§2.2）
      if (a === 'interact') {
        const t = Game.playerReviveTarget;
        if (t) {
          if (Net.connected && !Net.isHost) Net.sendState({ t: 'revive_cancel', target: t.id });
          else Game.cancelRevive(Game.player, t);
        }
      }
      if (a === 'scoreboard') UI.scoreboard(false);
    });
    document.addEventListener('mousedown', e => {
      if (!this.locked || Game.phase !== 'playing') return;
      if (e.button === 0) {
        if (Game.mortarMode) Game.fireMortar();
        else if (PlayerGun.cur === 'medkit') PlayerGun.useMedkit();      // 选中医疗包 → 左键使用
        else if (PlayerGun.cur === 'armorkit') PlayerGun.useArmorkit();  // 选中护甲包 → 左键使用
        else if (PlayerGun.cur === 'grenade') PlayerGun.throwGrenade();  // 选中手雷 → 左键扔
        else if (PlayerGun.cur === 'smoke') PlayerGun.throwSmoke();      // 选中烟雾 → 左键扔
        else PlayerGun.tryFire(camera);
      }
      this.keys.add(e.button === 0 ? 'Mouse0' : 'Mouse2');
    });
    document.addEventListener('mouseup', e => this.keys.delete(e.button === 0 ? 'Mouse0' : 'Mouse2'));
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === renderer.domElement; });
  },
  // 圆形移动 + 碰撞解析（圆 vs AABB）+ 世界边界（正常/倒地爬行共用）
  _moveResolve(p) {
    const R = 0.45;
    const feet = p.pos.y || 0;   // v1.5：按脚底高度判定竖直重叠 —— 楼板/屋顶板不再当实心墙（World.blocksAt）
    for (const c of World.colliders) {
      if (!World.blocksAt(c, feet)) continue;
      const cx = U.clamp(p.pos.x, c.min.x, c.max.x), cz = U.clamp(p.pos.z, c.min.z, c.max.z);
      const dx = p.pos.x - cx, dz = p.pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < R * R) {
        if (d2 > 0.0001) { const d = Math.sqrt(d2); p.pos.x = cx + dx / d * R; p.pos.z = cz + dz / d * R; }
        else {
          const pxl = p.pos.x - c.min.x, pxr = c.max.x - p.pos.x, pzl = p.pos.z - c.min.z, pzr = c.max.z - p.pos.z;
          const m = Math.min(pxl, pxr, pzl, pzr);
          if (m === pxl) p.pos.x = c.min.x - R; else if (m === pxr) p.pos.x = c.max.x + R;
          else if (m === pzl) p.pos.z = c.min.z - R; else p.pos.z = c.max.z + R;
        }
      }
    }
    p.pos.x = U.clamp(p.pos.x, 1.5, CFG.WORLD - 1.5); p.pos.z = U.clamp(p.pos.z, 1.5, CFG.WORLD - 1.5);
  },
  update(dt) {
    if (!this.locked || Game.phase !== 'playing' || Game.player.dead) return;
    const p = Game.player;
    // §2.5 倒地爬行：降速 CRAWL_SPEED、禁跳/冲刺/射击/开镜/迫击炮、视角 0.8m 低姿态、可转向
    if (p.down) {
      let f = 0, s = 0;
      if (this.keys.has(Settings.key('moveF'))) f += 1;
      if (this.keys.has(Settings.key('moveB'))) f -= 1;
      if (this.keys.has(Settings.key('moveR'))) s += 1;
      if (this.keys.has(Settings.key('moveL'))) s -= 1;
      const speed = CFG.CRAWL_SPEED;
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      const mx = (-sin * f + cos * s) * speed, mz = (-cos * f - sin * s) * speed;
      p.pos.x += mx * dt; p.pos.z += mz * dt;
      this._moveResolve(p);
      p.yaw = this.yaw;
      p.pos.y = World.heightAt(p.pos.x, p.pos.z, p.pos.y);
      camera.position.set(p.pos.x, p.pos.y + 0.8, p.pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = Number.isFinite(this.yaw) ? this.yaw : 0;
      camera.rotation.x = Number.isFinite(this.pitch) ? this.pitch : 0;
      this.recoil = Math.max(0, this.recoil - dt * 2.2);
      return;
    }
    this.prone = this.keys.has(Settings.key('prone')); // 潜伏键按住潜伏
    let f = 0, s = 0;
    if (this.keys.has(Settings.key('moveF'))) f += 1;
    if (this.keys.has(Settings.key('moveB'))) f -= 1;
    if (this.keys.has(Settings.key('moveR'))) s += 1;
    if (this.keys.has(Settings.key('moveL'))) s -= 1;
    const sprint = this.keys.has(Settings.key('sprint')) && f > 0 && !this.prone; // 潜伏时不能疾跑
    const speed = (sprint ? CFG.SPRINT : CFG.WALK) * (Game.mortarMode ? 0 : 1) * (this.prone ? 0.45 : 1); // 潜伏爬行 45% 速度
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = (-sin * f + cos * s) * speed, mz = (-cos * f - sin * s) * speed;
    if (Game.mortarMode) { mx = 0; mz = 0; }
    // 碰撞解析（圆 vs AABB）
    p.pos.x += mx * dt; p.pos.z += mz * dt;
    this._moveResolve(p);
    // 跳跃与重力
    const gy = World.heightAt(p.pos.x, p.pos.z, p.pos.y);
    if (this.keys.has(Settings.key('jump')) && p.pos.y <= gy + 0.01) { this.vy = CFG.JUMP; this.onGround = false; }
    if (p.pos.y > gy + 0.01 || this.vy > 0) {
      this.vy -= CFG.GRAV * dt;
      p.pos.y += this.vy * dt;
      if (p.pos.y <= gy) { p.pos.y = gy; this.vy = 0; this.onGround = true; }
    } else { p.pos.y = gy; this.vy = 0; this.onGround = true; }
    p.yaw = this.yaw;
    if (Game.mortarMode) {
      // 迫击炮模式：视角照常跟随（观察落点标记），不移动不摆武器
      camera.position.set(p.pos.x, p.pos.y + CFG.EYE, p.pos.z);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = Number.isFinite(this.yaw) ? this.yaw : 0;
      camera.rotation.x = (Number.isFinite(this.pitch) ? this.pitch : 0) + (Number.isFinite(this.recoil) ? this.recoil : 0);
      this.recoil = Math.max(0, this.recoil - dt * 2.2);
      return;
    }
    // 脚步
    if ((mx || mz)) {
      this.footT += dt * (sprint ? 2.4 : 1.6);
      if (this.footT > 1) { this.footT = 0; AudioFX.foot(); }
    }
    // 相机（潜伏时视角压低到 0.55m 伏地高度）
    camera.position.set(p.pos.x, p.pos.y + (this.prone ? 0.55 : CFG.EYE), p.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = Number.isFinite(this.yaw) ? this.yaw : 0;
    camera.rotation.x = (Number.isFinite(this.pitch) ? this.pitch : 0) + (Number.isFinite(this.recoil) ? this.recoil : 0);
    this.recoil = Math.max(0, this.recoil - dt * 2.2);
    if (FX.shake > 0.01) {
      camera.position.x += U.rand(-FX.shake, FX.shake) * 0.12;
      camera.position.y += U.rand(-FX.shake, FX.shake) * 0.12;
    }
    // 武器摆动
    for (const k in PlayerGun.models) {
      const g = PlayerGun.models[k];
      const bob = Math.sin(this.footT * Math.PI * 2) * (mx || mz ? 0.008 : 0);
      g.position.set(0.26 + bob, -0.24 - Math.abs(Math.cos(this.footT * Math.PI)) * 0.006, -0.5 + this.recoil * 0.25);
    }
  }
};
