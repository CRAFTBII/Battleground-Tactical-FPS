/* ============================================
 * 战地突击 · js/mechanics.js — 地图机制引擎（v1.2 地图特色化）
 * --------------------------------------------
 * 每张地图独一无二玩法的运行时。由 World.load 末尾调用 Mechanics.init(mapDef)；
 * 主循环由 Game.update 调用 Mechanics.tick(dt)；玩家交互（E）走 Mechanics.dispatch('interact')。
 *
 * Schema（与设计侧契约；缺字段/未知 type 一律容错跳过不崩）：
 *   mapDef.mechanics = {
 *     <mapId>: { type:'searchlight', lights[], powerPanels[], expose{} },   // 夜港
 *     <mapId>: { type:'sandstorm', cycle{fog{storm,calm}}, exposeDmg, tower{} }, // 荒漠
 *     <mapId>: { type:'airdrop', intervalSec, drops[], crate{}, arty{zone,warnSec,dmg,radius} } // 城郊
 *   }
 * 也兼容直接形式 mapDef.mechanics = { type:... }（测试/联调注入）。
 *
 * 权威模型：房主/单机（!Net.connected || Net.isHost）跑完整模拟；客户端只播广播事件。
 * 关键事件复用现有 event 通道：Net.broadcastEvent({k:'m_storm'|'m_airdrop'|'m_pwr'|'m_arty'})。
 * 架构文档：docs/architecture/mechanics-architecture.md
 * ============================================ */
const Mechanics = {
  active: false, kind: null, cfg: {}, mapDef: null,
  objs: [],            // 本机制创建的场景对象（dispose 用）
  exposedIds: new Set(), // 当前被曝露的单位 id（探照灯/沙暴）
  marks: [],           // 小地图叠加标记 {x,z,t,life,color,size}
  _exposeMarkT: {},    // 单位 -> 上次曝露标记时刻（防刷屏）

  /* ============ 生命周期 ============ */
  init(mapDef) {
    this.dispose();
    this.mapDef = mapDef || null;
    this.active = false; this.kind = null; this.cfg = {};
    // v1.3：缩圈为独立子系统（与既有 type 机制叠加；数据走 mapDef.zone 顶层契约）
    // 缺 zone / 缺字段 → 容错跳过不开圈（向后兼容）
    this.zone.init(mapDef && mapDef.zone, mapDef);
    if (!mapDef || typeof THREE === 'undefined' || !World.scene) return this;
    let cfg = mapDef.mechanics;
    if (!cfg) return this;
    // 兼容按地图 id 分键（契约形式）与直接形式
    if (!cfg.type && mapDef.id && cfg[mapDef.id]) cfg = cfg[mapDef.id];
    if (!cfg || typeof cfg !== 'object' || !cfg.type) return this;
    try {
      this.cfg = cfg; this.kind = cfg.type;
      if (cfg.type === 'searchlight') this._initSearchlight(cfg);
      else if (cfg.type === 'sandstorm') this._initSandstorm(cfg);
      else if (cfg.type === 'airdrop') this._initAirdrop(cfg);
      else { console.warn('[Mechanics] 未知机制 type "' + cfg.type + '"，跳过'); return this; }
      this.active = true;
      console.log('[Mechanics] 地图 "' + (mapDef.name || mapDef.id) + '" 机制初始化: ' + cfg.type);
    } catch (e) {
      this.active = false;
      console.warn('[Mechanics] 机制初始化失败（容错跳过）: ' + (e && e.message));
    }
    return this;
  },
  dispose() {
    this.zone.dispose();
    for (const o of this.objs) { if (World.scene) World.scene.remove(o); o.traverse && o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); }
    this.objs = []; this.exposedIds.clear(); this.marks = []; this._exposeMarkT = {};
    this.active = false; this.kind = null; this.cfg = {}; this.mapDef = null;
    return this;
  },
  /* 描述当前机制（报告/测试用） */
  describe() {
    const s = this.state || {};
    const z = this.zone;
    return { kind: this.kind, active: this.active,
      lights: s.lights ? s.lights.length : 0,
      panels: s.powerPanels ? s.powerPanels.length : 0,
      powerOn: s.power !== false,
      storm: s.storm || false, stormFade: s.fade !== undefined ? +s.fade.toFixed(2) : 0,
      crates: s.crates ? s.crates.length : 0,
      artyWarn: s.arty && s.arty.warn ? true : false,
      exposed: this.exposedIds.size,
      zone: z.active ? { active: true, phases: z.phases.length, phaseIdx: z.phaseIdx, curR: +z.curR.toFixed(1), targetR: +z.targetR.toFixed(1), dmgPerSec: z.dmgPerSec, elapsed: +z.elapsed.toFixed(1) } : { active: false } };
  },

  /* ============ 主循环 ============ */
  tick(dt) {
    this.zone.tick(dt); // v1.3：缩圈独立子系统（与既有机制叠加；未激活时零开销）
    if (!this.active || !this.kind) return;
    try {
      const host = !Net.connected || Net.isHost;
      this._updateVisual(dt);          // 视觉平滑（所有端）
      if (host) this._sim(dt);         // 权威模拟（房主/单机）
    } catch (e) { console.warn('[Mechanics] tick 异常（容错）: ' + (e && e.message)); }
  },
  _updateVisual(dt) {
    if (this.kind === 'searchlight') this._slUpdateVisual(dt);
    else if (this.kind === 'sandstorm') this._ssUpdateVisual(dt);
    else if (this.kind === 'airdrop') this._adUpdateVisual(dt);
  },
  _sim(dt) {
    if (this.kind === 'searchlight') this._slSim(dt);
    else if (this.kind === 'sandstorm') this._ssSim(dt);
    else if (this.kind === 'airdrop') this._adSim(dt);
    // 标记老化
    for (let i = this.marks.length - 1; i >= 0; i--) { this.marks[i].t += dt; if (this.marks[i].t >= this.marks[i].life) this.marks.splice(i, 1); }
  },

  /* ============ 通用辅助 ============ */
  isExposed(u) { return u && this.exposedIds.has(u.id); },
  stormActive() { return this.kind === 'sandstorm' && !!(this.state && this.state.storm); },
  _mark(x, z, color, life, size) { this.marks.push({ x, z, t: 0, life: life || 4, color: color || '#ffd166', size: size || 6 }); },
  _heal(u, amt) { if (!u || !u.alive) return; if (!Number.isFinite(u.hp)) u.hp = CFG.PLAYER_HP; u.hp = Math.min(CFG.PLAYER_HP, u.hp + amt); if (u.isPlayer && u === Game.player) UI.updateHealth(); },
  _damage(u, dmg) { if (u && u.alive) Game.applyDamage(u, dmg, null, false); },
  _bannerPlayer(msg, color, dur) { if (Game.player && Game.player.alive && UI.banner) UI.banner(msg, color || '#ffd166', dur || 2); },
  _host() { return !Net.connected || Net.isHost; },
  _broadcast(e) { if (typeof Net !== 'undefined' && Net.broadcastEvent) Net.broadcastEvent(e); },

  /* ================================================================
   * 机制①：searchlight 探照灯（夜港）
   * ----------------------------------------------------------------
   * lights[]: 每盏 { x,z, y?, range?, halfAngle?(度), speed?(度/秒), dir?(1|-1), color? }
   * powerPanels[]: { x,z, r?, cd?(断电秒), cost?(代价分) } — E 交互断电，灯灭 cd 秒
   * expose{}: { range?(覆盖半径), markT?(曝露标记秒), color? }
   * 效果：光锥旋转扫描，玩家/AI 在锥内 → 曝露（小地图 ping + 标记）；断电后灯灭。
   * ================================================================ */
  _initSearchlight(cfg) {
    const s = this.state = { lights: [], powerPanels: [], power: true, offT: 0, exposed: {}, teamCool: { blue: 0, red: 0 } };
    const ex = cfg.expose || {};
    this._exCfg = { range: ex.range || cfg.range || 42, markT: ex.markT || 4, color: ex.color || '#ffd166' };
    // 数值对齐设计 §2.2/§5：断电期 30s（offSec）、断电/抢修冷却 45s（coolSec，按队计）
    this._pwrOffSec = (cfg.offSec !== undefined ? cfg.offSec : (cfg.powerOffSec !== undefined ? cfg.powerOffSec : 30));
    this._pwrCoolSec = (cfg.coolSec !== undefined ? cfg.coolSec : 45);
    s.powerPanels = (cfg.powerPanels || []).map(p => Object.assign({ x: p.x, z: p.z, r: p.r || 3, cost: p.cost || 0 }, p));
    // 环境光钩子（art P1）：断电 ambient 0.46→0.32（≥0.30 红线），恢复还原；雾不动
    const amb = World.objects.find(o => o && o.isAmbientLight);
    this._ambient = amb || null;
    this._ambientBase = amb ? amb.intensity : 0.46;
    this._applyAmbient(s.power !== false);
    s.lights = (cfg.lights || []).map((l, i) => {
      const y = l.y !== undefined ? l.y : 9;
      const light = {
        x: l.x, z: l.z, y: y,
        range: l.range || this._exCfg.range,
        halfAngle: (l.halfAngle !== undefined ? l.halfAngle : 18) * Math.PI / 180, // 锥半宽
        // 扫描模式：设计数据用 yawDeg(中位)+sweepDeg(半幅) 往复；schema 默认 spin 连续旋转
        mode: (l.sweepDeg !== undefined || l.yawDeg !== undefined) ? 'sweep' : 'spin',
        center: (l.yawDeg !== undefined ? l.yawDeg : 0) * Math.PI / 180,
        sweep: (l.sweepDeg !== undefined ? l.sweepDeg : 0) * Math.PI / 180,
        speed: (l.speed !== undefined ? l.speed : 26) * Math.PI / 180,
        dir: l.dir || 1,
        color: l.color !== undefined ? l.color : 0xffe9a8,
        angle: (l.angle !== undefined ? l.angle : (l.yawDeg !== undefined ? l.yawDeg : 0)) * Math.PI / 180,
        _t: 0
      };
      // 视觉：灯杆 + 光锥（扇形）
      const grp = new THREE.Group();
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), World.basicMat ? World.basicMat('slLamp', light.color) : new THREE.MeshBasicMaterial({ color: light.color }));
      lamp.position.set(0, 0, 0);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, y - 1, 6), World.sharedMat ? World.sharedMat('pole', 1, 0x4a4f55) : new THREE.MeshLambertMaterial({ color: 0x4a4f55 }));
      pole.position.y = (y - 1) / 2;
      grp.add(lamp, pole);
      const cone = this._makeSector(light.range, light.halfAngle, light.color);
      cone.position.y = 0.15;
      grp.add(cone);
      grp.position.set(l.x, 0, l.z);
      World.scene.add(grp);
      this.objs.push(grp);
      light.grp = grp; light.cone = cone;
      return light;
    });
    // 断电后面板冷却显示（无独立 mesh，冷却用 HUD 提示）
    return s;
  },
  _makeSector(radius, halfAngle, color) {
    const seg = 20, a0 = -halfAngle, a1 = halfAngle;
    const pos = new Float32Array((seg + 2) * 3), idx = new Uint16Array(seg * 3);
    pos[0] = 0; pos[1] = 0; pos[2] = 0;
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * i / seg;
      pos[(i + 1) * 3] = Math.sin(a) * radius;
      pos[(i + 1) * 3 + 1] = 0;
      pos[(i + 1) * 3 + 2] = Math.cos(a) * radius;
      if (i < seg) { idx[i * 3] = 0; idx[i * 3 + 1] = i + 1; idx[i * 3 + 2] = i + 2; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; // 扇形在 XZ 平面，+Z 为 0° 方向（与 yaw 约定一致）
    return m;
  },
  _slUpdateVisual(dt) {
    const s = this.state; if (!s) return;
    // 光锥跟随旋转；断电时隐藏
    for (const l of s.lights) {
      if (l.cone) l.cone.visible = s.power;
      if (l.grp) l.grp.rotation.y = s.power ? l.angle : 0;
    }
  },
  _applyAmbient(on) {
    // 断电环境光切换（art P1）：off 时降至 ~0.32，但不下探 0.30 红线（防其他图 ambient 更暗时反而变亮）
    if (!this._ambient) return;
    this._ambient.intensity = on ? this._ambientBase : Math.max(0.30, Math.min(this._ambientBase, 0.32));
  },
  _slSim(dt) {
    const s = this.state; if (!s || !s.lights.length) return;
    // 断电自动恢复（断电期 30s 到点恢复供电）
    if (!s.power) {
      s.offT -= dt;
      if (s.offT <= 0) { s.power = true; this._applyAmbient(true); this._bannerPlayer('🔌 探照灯已恢复供电', '#9fb3c8', 2); this._broadcast({ k: 'm_pwr', on: true }); }
    }
    // 队级冷却（断电/抢修共用 45s，防止同队反复开关灯刷优势）
    for (const t in s.teamCool) s.teamCool[t] = Math.max(0, (s.teamCool[t] || 0) - dt);
    if (!s.power) return;
    // 旋转 + 曝露检测
    const ex = this._exCfg;
    for (const l of s.lights) {
      if (l.mode === 'sweep') { l._t += l.speed * l.dir * dt; l.angle = l.center + Math.sin(l._t) * l.sweep; }
      else l.angle += l.speed * l.dir * dt;
      // 扇形朝向：THREE 里 yaw 0=+Z，正方向顺时针；与移动 yaw 约定一致
      const dirX = Math.sin(l.angle), dirZ = Math.cos(l.angle);
      const la = Math.atan2(dirX, dirZ); // 光锥中线方位（与 U.angTo 同约定）
      for (const u of Game.units) {
        if (!u.alive) continue;
        const dx = u.pos.x - l.x, dz = u.pos.z - l.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > l.range * l.range) continue;
        const ua = Math.atan2(dx, dz);
        let diff = ua - la;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) <= l.halfAngle + 0.05) {
          // 曝露：小地图 ping + 标记 + 单位标记（玩家短暂提示）
          this.exposedIds.add(u.id);
          this._mark(l.x + dirX * d2 / l.range * 4, l.z + dirZ * d2 / l.range * 4, ex.color, ex.markT, 7);
          if (u.isPlayer && u === Game.player) {
            const now = performance.now() / 1000;
            if (!this._exposeMarkT[u.id] || now - this._exposeMarkT[u.id] > 6) {
              this._exposeMarkT[u.id] = now;
              this._bannerPlayer('⚠ 你被探照灯锁定！', '#ffd166', 2);
            }
          }
        }
      }
    }
    // 清理不在锥内的曝露标记
    for (const id of Array.from(this.exposedIds)) {
      const u = Game.units.find(x => x.id === id);
      if (!u || !u.alive) { this.exposedIds.delete(id); continue; }
      let still = false;
      for (const l of s.lights) {
        const dx = u.pos.x - l.x, dz = u.pos.z - l.z;
        if (dx * dx + dz * dz > l.range * l.range) continue;
        const ua = Math.atan2(dx, dz), la = Math.atan2(Math.sin(l.angle), Math.cos(l.angle));
        let diff = ua - la; while (diff > Math.PI) diff -= Math.PI * 2; while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) <= l.halfAngle + 0.05) { still = true; break; }
      }
      if (!still) this.exposedIds.delete(id);
    }
  },

  /* ================================================================
   * 机制②：sandstorm 沙暴（荒漠）
   * ----------------------------------------------------------------
   * cycle{ interval?(平静秒), dur?(风暴秒), fog{ storm:{near,far,color}, calm:{near,far,color} } }
   * exposeDmg: 风暴中暴露者每秒伤害（默认 4）
   * tower{ x,z, r?, heal? } — 水塔占领回血（范围内人数多的一队持续回血）
   * 效果：周期性沙暴；雾 near/far/color 插值；视野与 AI 命中骤降；暴露者持续伤害。
   * ================================================================ */
  _initSandstorm(cfg) {
    const sceneFog = World.scene.fog;
    const baseFog = sceneFog ? { near: sceneFog.near, far: sceneFog.far, color: sceneFog.color.getHex ? sceneFog.color.getHex() : sceneFog.color } : { near: 80, far: 340, color: 0x8fb4cc };
    const cy = cfg.cycle || {};
    // 兼容两种形态：schema `cycle.fog{storm,calm}` 与设计数据顶层 `fog{storm,calm}`；`dur/interval` 与 `stormSec/calmSec`
    const fogCfg = cfg.fog || cy.fog || {};
    const storm = fogCfg.storm || {};
    const calm = fogCfg.calm || {};
    const s = this.state = {
      interval: cy.interval !== undefined ? cy.interval : (cy.calmSec !== undefined ? cy.calmSec : 60),
      dur: cy.dur !== undefined ? cy.dur : (cy.stormSec !== undefined ? cy.stormSec : 22),
      calmFog: { near: calm.near !== undefined ? calm.near : baseFog.near, far: calm.far !== undefined ? calm.far : baseFog.far, color: calm.color !== undefined ? calm.color : baseFog.color },
      stormFog: { near: storm.near !== undefined ? storm.near : 8, far: storm.far !== undefined ? storm.far : 55, color: storm.color !== undefined ? storm.color : 0xcaa06a },
      storm: false, t: 0, fade: 0, fadeDir: 0,
      fadeDur: cy.fadeDur !== undefined ? cy.fadeDur : 2.5,
      exposeDmg: cfg.exposeDmg !== undefined ? cfg.exposeDmg : 4,
      stormTickT: 0,
      towerTickT: 0,
      tower: cfg.tower ? { x: cfg.tower.x, z: cfg.tower.z, r: cfg.tower.r || 8, heal: (cfg.tower.heal !== undefined ? cfg.tower.heal : cfg.tower.healPerSec) || 8, y: cfg.tower.y || 0, progress: 0, owner: null } : null,
      shelter: [],
      footprints: []
    };
    // 预计算庇护区（建筑/掩体 AABB 外扩 2m，风暴中暴露判定用）
    const seen = new Set();
    for (const c of World.colliders) {
      if (c.max.y < 1.0) continue;
      const key = Math.round(c.min.x * 4) + '_' + Math.round(c.min.z * 4) + '_' + Math.round(c.max.x * 4) + '_' + Math.round(c.max.z * 4);
      if (seen.has(key)) continue; seen.add(key);
      s.shelter.push({ x0: c.min.x - 2, x1: c.max.x + 2, z0: c.min.z - 2, z1: c.max.z + 2 });
    }
    // 建筑 footprint 庇护区（设计 §3.1「建筑内部=庇护」；proc x/z=中心，model x/z=角点，各 +0.5 内墙边）
    // v1.3：bridge 是开敞结构（桥下地面开阔），不是庇护——跳过，防桥下沙暴误判庇护（QA BLOCKER ⑥）
    if (this.mapDef && Array.isArray(this.mapDef.buildings)) {
      for (const b of this.mapDef.buildings) {
        if (!b || !(b.w > 0) || !(b.d > 0)) continue;
        if (b.key === 'bridge') continue; // 桥面/桥下不构成庇护（其高空 collider 已在 World.overhead 分流）
        const x0 = b.type === 'proc' ? b.x - b.w / 2 : b.x;
        const z0 = b.type === 'proc' ? b.z - b.d / 2 : b.z;
        s.footprints.push({ x0: x0 - 0.5, x1: x0 + b.w + 0.5, z0: z0 - 0.5, z1: z0 + b.d + 0.5 });
      }
    }
    if (s.tower) {
      // 水塔视觉：底环 + 塔罐
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(s.tower.r - 1.2, s.tower.r, 24, 1), new THREE.MeshBasicMaterial({ color: 0x3f9fd8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false, fog: false })); // fog:false：机制环不吃雾（art/zone-visual §6）
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
      const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 4.4, 6), World.sharedMat ? World.sharedMat('pole', 1, 0x4a4f55) : new THREE.MeshLambertMaterial({ color: 0x4a4f55 }));
      legs.position.y = 2.2; g.add(legs);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 1.6, 10), World.sharedMat ? World.sharedMat('metal', 2) : new THREE.MeshLambertMaterial({ color: 0x6a7a8a }));
      tank.position.y = 5.2; g.add(tank);
      g.position.set(s.tower.x, s.tower.y || 0, s.tower.z);
      World.scene.add(g); this.objs.push(g);
    }
    return s;
  },
  _ssUpdateVisual(dt) {
    const s = this.state; if (!s || !World.scene.fog) return;
    // 雾插值（风暴淡入/淡出）：fade 0=平静 1=风暴，恒从 calmFog 插到 stormFog，双向一致
    if (s.fadeDir !== 0) {
      s.fade = Math.max(0, Math.min(1, s.fade + s.fadeDir * dt / s.fadeDur));
      const k = s.fade;
      World.scene.fog.near = U.lerp(s.calmFog.near, s.stormFog.near, k);
      World.scene.fog.far = U.lerp(s.calmFog.far, s.stormFog.far, k);
      const c = new THREE.Color(s.calmFog.color).lerp(new THREE.Color(s.stormFog.color), k);
      World.scene.fog.color.copy(c);
      if (s.fade >= 1) s.fadeDir = 0;
    }
  },
  _ssSim(dt) {
    const s = this.state; if (!s) return;
    s.t += dt;
    if (!s.storm) {
      if (s.t >= s.interval) {
        s.storm = true; s.t = 0; s.fade = 0; s.fadeDir = 1;
        this._bannerPlayer('🌪 沙暴来袭 — 视野骤降，寻找掩护！', '#d9a84a', 3);
        this._broadcast({ k: 'm_storm', storm: true });
      }
    } else {
      if (s.t >= s.dur) {
        s.storm = false; s.t = 0; s.fade = 1; s.fadeDir = -1;
        this._bannerPlayer('🌤 沙暴平息', '#9fb3c8', 2);
        this._broadcast({ k: 'm_storm', storm: false });
      }
    }
    // 暴露伤害（2Hz 采样庇护区，避免每帧全 colliders 扫描）
    s.stormTickT -= dt;
    if (s.storm && s.stormTickT <= 0) {
      s.stormTickT = 0.5;
      for (const u of Game.units) {
        if (!u.alive) continue;
        if (this._inShelter(u.pos.x, u.pos.z)) { this.exposedIds.delete(u.id); continue; }
        this.exposedIds.add(u.id);
        this._damage(u, s.exposeDmg * 0.5);
      }
    }
    // 水塔占领推进 + 占领方回血（2Hz，与伤害块同节流 → 速率严格 5HP/s，防 150/s 无敌回血）
    if (s.tower) {
      s.towerTickT -= dt;
      if (s.towerTickT <= 0) {
        s.towerTickT = 0.5;
        const tw = s.tower;
        let nb = 0, nr = 0;
        for (const u of Game.units) {
          if (!u.alive) continue;
          if (U.dist2(u.pos.x, u.pos.z, tw.x, tw.z) > tw.r * tw.r) continue;
          if (u.team === 'blue') nb++; else nr++;
        }
        // 占领推进（复用据点进度模式：多数方推进 / 无人衰减；单人 ≈12s 占塔，设计 §3.2）
        if (nb > 0 && nr === 0) tw.progress = Math.min(100, (tw.progress || 0) + nb * 4);
        else if (nr > 0 && nb === 0) tw.progress = Math.min(100, (tw.progress || 0) + nr * 4);
        else if (nb === 0 && nr === 0) tw.progress = Math.max(0, (tw.progress || 0) - 1.2);
        if (tw.progress >= 100) {
          const owner = nb > nr ? 'blue' : 'red';
          if (tw.owner !== owner) {
            tw.owner = owner;
            this._bannerPlayer('💧 水塔被' + (owner === 'blue' ? '蓝' : '红') + '方占领！', owner === 'blue' ? '#5aa9ff' : '#ff8a8a', 2.5);
            this._broadcast({ k: 'cap', id: 'tower', owner });
          }
        }
        // 占领方圈内回血：5HP/s（2Hz → 每次 2.5HP；敌方圈内不回血）
        if (tw.owner) for (const u of Game.units) {
          if (!u.alive || u.team !== tw.owner) continue;
          if (U.dist2(u.pos.x, u.pos.z, tw.x, tw.z) <= tw.r * tw.r) this._heal(u, tw.heal * 0.5);
        }
      }
    }
  },
  _inShelter(x, z) {
    const s = this.state; if (!s) return false;
    // ① 水塔圈内 = 庇护（设计 §3.1：圈内不受灼伤）
    if (s.tower && U.dist2(x, z, s.tower.x, s.tower.z) <= s.tower.r * s.tower.r) return true;
    // ② 建筑 footprint 内部 = 庇护（防「主堡中心裸露」）
    for (const f of s.footprints) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return true;
    // ③ 碰撞体外扩 2m = 庇护（掩体后/墙边）
    for (const sh of s.shelter) if (x >= sh.x0 && x <= sh.x1 && z >= sh.z0 && z <= sh.z1) return true;
    return false;
  },

  /* ================================================================
   * 机制③：airdrop 空投 + arty 炮击（城郊）
   * ----------------------------------------------------------------
   * intervalSec: 空投间隔（默认 50）
   * drops[]: 投放点 {x,z} 或 [x,z]
   * crate{ radius?, heal?, ammo?, fallSec? } — 落地后 E 拾取（回血 + 补弹药）
   * arty{ zone:{x,z,r} 或 [{x,z,r}], warnSec?(4), dmg?(90), radius?(8), interval?(40) }
   * 效果：定时空投补给箱（信标+降落+拾取）；周期性炮击（警示区 4s + 延迟伤害）。
   * ================================================================ */
  _initAirdrop(cfg) {
    const s = this.state = { crates: [], airdropT: 0, nextDrop: cfg.intervalSec !== undefined ? cfg.intervalSec : 50, dropPts: [], arty: null, artyT: 0, nextArty: 40 };
    const W = CFG.WORLD || 300;
    // 投放点：显式 drops 或随机两点
    const drops = Array.isArray(cfg.drops) ? cfg.drops : [];
    if (drops.length) s.dropPts = drops.map(d => Array.isArray(d) ? { x: d[0], z: d[1] } : { x: d.x, z: d.z });
    else s.dropPts = [{ x: W * 0.5, z: W * 0.5 }, { x: W * 0.25, z: W * 0.75 }, { x: W * 0.75, z: W * 0.25 }];
    // crate：支持绝对 ammo 与比例 ammoPct 两种形态
    this._crateCfg = Object.assign({ radius: 2.2, heal: 40, ammo: 60, ammoPct: null, fallSec: 3 }, cfg.crate || {});
    // 炮击
    const a = cfg.arty;
    if (a && a.zone) {
      const zl = Array.isArray(a.zone) ? a.zone : [a.zone];
      s.arty = {
        zones: zl.map(z => ({ x: z.x, z: z.z, r: z.r || (a.radius || 8) })),
        warnSec: a.warnSec !== undefined ? a.warnSec : 4,
        dmg: a.dmg !== undefined ? a.dmg : 90,
        radius: a.radius !== undefined ? a.radius : 8,
        interval: a.interval !== undefined ? a.interval : (a.intervalSec !== undefined ? a.intervalSec : 40),
        warn: null, warnT: 0, ring: null
      };
      s.nextArty = s.arty.interval * (0.6 + Math.random() * 0.8);
    }
    return s;
  },
  _adUpdateVisual(dt) {
    const s = this.state; if (!s) return;
    // 空投箱降落动画 + 炮击警示环闪烁
    for (let i = s.crates.length - 1; i >= 0; i--) {
      const c = s.crates[i];
      if (!c.landed) {
        c.fallT += dt;
        const k = Math.min(1, c.fallT / this._crateCfg.fallSec);
        c.mesh.position.y = U.lerp(60, c.y, k);
        if (k >= 1) { c.landed = true; c.mesh.position.y = c.y; }
      }
    }
    if (s.arty && s.arty.warn && s.arty.ring) {
      const k = s.arty.warnT / s.arty.warnSec;
      s.arty.ring.material.opacity = 0.25 + 0.4 * Math.abs(Math.sin(k * Math.PI * 6));
      s.arty.ring.scale.setScalar(1 + k * 0.15);
    }
  },
  _adSim(dt) {
    const s = this.state; if (!s) return;
    // 空投定时
    s.airdropT += dt;
    if (s.airdropT >= s.nextDrop) {
      s.airdropT = 0;
      s.nextDrop = (this.cfg.intervalSec !== undefined ? this.cfg.intervalSec : 50) + Math.random() * 12;
      const pt = s.dropPts[Math.floor(Math.random() * s.dropPts.length)];
      const y = World.heightAt(pt.x, pt.z);
      this._spawnCrate(pt.x, pt.z, y);
      this._broadcast({ k: 'm_airdrop', x: pt.x, z: pt.z });
      this._bannerPlayer('📦 空投补给已投放 — 快去找！', '#7ec8ff', 3);
    }
    // 炮击定时
    if (s.arty) {
      if (s.arty.warn) {
        s.arty.warnT -= dt;
        if (s.arty.warnT <= 0) {
          const w = s.arty.warn;
          s.arty.warn = null;
          if (s.arty.ring) { World.scene.remove(s.arty.ring); this.objs = this.objs.filter(o => o !== s.arty.ring); s.arty.ring = null; }
          // 落弹：环境伤害 + 可被掩体遮挡（wallBlock=true，设计 §4.2「可被掩体遮挡」）
          Game.areaDamage(new THREE.Vector3(w.x, World.heightAt(w.x, w.z), w.z), s.arty.radius, s.arty.dmg, null, null, true);
          this._broadcast({ k: 'boom', x: w.x, y: World.heightAt(w.x, w.z), z: w.z, r: s.arty.radius });
          this._bannerPlayer('💥 炮击命中！', '#ff6b6b', 1.5);
          s.nextArty = s.arty.interval * (0.6 + Math.random() * 0.8);
        }
      } else {
        s.artyT += dt;
        if (s.artyT >= s.nextArty) {
          s.artyT = 0;
          const z = s.arty.zones[Math.floor(Math.random() * s.arty.zones.length)];
          // 落点：zone 内随机（圆形均匀）；警示圈半径 = 爆炸半径 radius（非整区，设计 §4.2）
          const ang = Math.random() * Math.PI * 2, rr = z.r * Math.sqrt(Math.random());
          const px = U.clamp(z.x + Math.cos(ang) * rr, 2, CFG.WORLD - 2);
          const pz = U.clamp(z.z + Math.sin(ang) * rr, 2, CFG.WORLD - 2);
          const R = s.arty.radius;
          s.arty.warn = { x: px, z: pz, r: R };
          s.arty.warnT = s.arty.warnSec;
          const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.6, R, 24, 1), new THREE.MeshBasicMaterial({ color: 0xff4757, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false })); // fog:false：警示环不吃雾
          ring.rotation.x = -Math.PI / 2; ring.position.set(px, 0.15, pz);
          World.scene.add(ring); this.objs.push(ring); s.arty.ring = ring;
          this._mark(px, pz, '#ff4757', s.arty.warnSec, 12);
          this._bannerPlayer('⚠ 炮击警告 — 离开红圈！', '#ff6b6b', 2);
          this._broadcast({ k: 'm_arty', x: px, z: pz, r: R, warn: true });
        }
      }
    }
  },
  _spawnCrate(x, z, y) {
    const s = this.state; if (!s) return;
    const g = new THREE.Group();
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), World.sharedMat ? World.sharedMat('crate', 1, 0x8a6f4a) : new THREE.MeshLambertMaterial({ color: 0x8a6f4a }));
    crate.position.y = 0.6; g.add(crate);
    // 降落伞
    const chute = new THREE.Mesh(new THREE.ConeGeometry(1.1, 0.9, 8), World.basicMat ? World.basicMat('chute', 0xe8eef4) : new THREE.MeshBasicMaterial({ color: 0xe8eef4 }));
    chute.position.y = 1.8; g.add(chute);
    // 信标光柱
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 40, 6), new THREE.MeshBasicMaterial({ color: 0x7ec8ff, transparent: true, opacity: 0.35 }));
    beam.position.y = 20; g.add(beam);
    g.position.set(x, y, z);
    World.scene.add(g); this.objs.push(g);
    this._mark(x, z, '#7ec8ff', 8, 8);
    s.crates.push({ mesh: g, x, z, y, landed: false, fallT: 0 });
  },
  _pickupCrate(c) {
    const s = this.state; if (!s) return;
    World.scene.remove(c.mesh);
    c.mesh.traverse && c.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    this.objs = this.objs.filter(o => o !== c.mesh);
    s.crates = s.crates.filter(x => x !== c);
    // 拾取效果：回血 + 补弹药（房主权威；客户端经事件广播处理）
    if (Game.player) {
      this._heal(Game.player, this._crateCfg.heal);
      for (const w in PlayerGun.reserves) {
        const max = WEAPONS[w].reserve * 4;
        const add = this._crateCfg.ammoPct ? Math.round(WEAPONS[w].reserve * this._crateCfg.ammoPct) : (this._crateCfg.ammo || 60);
        PlayerGun.reserves[w] = Math.min(max, (PlayerGun.reserves[w] || 0) + add);
      }
      if (UI.updateAmmo) UI.updateAmmo();
    }
    this._bannerPlayer('📦 已拾取空投：' + this._crateCfg.heal + ' 生命 + 弹药', '#7ec8ff', 2.5);
  },

  /* ================================================================
   * 玩家交互（E 键）：断电 / 拾取空投
   * ================================================================ */
  dispatch(action, arg) {
    if (!this.active || action !== 'interact') return false;
    try {
      if (this.kind === 'searchlight') {
        const s = this.state; if (!s) return false;
        const p = Game.player; if (!p) return false;
        const team = p.team === 'red' ? 'red' : 'blue';
        if ((s.teamCool[team] || 0) > 0) { this._bannerPlayer('⏳ 该队电源操作冷却中 ' + Math.ceil(s.teamCool[team]) + 's', '#9fb3c8', 1.5); return false; }
        // 就近配电箱（2m 内；任一箱均可断电/抢修）
        let near = null;
        for (const panel of s.powerPanels) {
          if (U.dist2(p.pos.x, p.pos.z, panel.x, panel.z) <= (panel.r || 3) * (panel.r || 3)) { near = panel; break; }
        }
        if (!near) return false;
        if (s.power === true) {
          // 断电：全图灯灭 30s；断电方入冷却 45s（设计 §2.2）
          s.power = false; s.offT = this._pwrOffSec;
          s.teamCool[team] = this._pwrCoolSec;
          this._applyAmbient(false);
          if (near.cost) Game.score[team] = Math.max(0, (Game.score[team] || 0) - near.cost);
          this._bannerPlayer('🔌 全港断电 ' + this._pwrOffSec + 's — 对方可抢修！', '#ffd166', 2.5);
          this._broadcast({ k: 'm_pwr', on: false });
          return true;
        } else {
          // 抢修：任意一方（含断电方）到任一配电箱 → 立即恢复供电；抢修方入冷却 45s
          s.power = true; s.offT = 0;
          s.teamCool[team] = this._pwrCoolSec;
          this._applyAmbient(true);
          this._bannerPlayer('⚡ 供电已抢修恢复！', '#7ec8ff', 2.5);
          this._broadcast({ k: 'm_pwr', on: true });
          return true;
        }
      } else if (this.kind === 'airdrop') {
        const s = this.state; if (!s) return false;
        const p = Game.player; if (!p) return false;
        for (const c of s.crates) {
          if (!c.landed) continue;
          if (U.dist2(p.pos.x, p.pos.z, c.x, c.z) > this._crateCfg.radius * this._crateCfg.radius) continue;
          this._pickupCrate(c);
          this._broadcast({ k: 'm_airdrop', x: c.x, z: c.z, pick: true });
          return true;
        }
      }
      return false;
    } catch (e) { console.warn('[Mechanics] dispatch 异常: ' + (e && e.message)); return false; }
  },

  /* ================================================================
   * 联机事件应用（客户端；房主直接模拟）
   * ================================================================ */
  onEvent(e) {
    if (!e) return;
    try {
      if (e.k === 'm_storm') {
        if (this.kind === 'sandstorm' && this.state) {
          this.state.storm = !!e.storm; this.state.t = 0;
          this.state.fadeDir = e.storm ? 1 : -1;
          if (!e.storm) this.state.fade = 1;
        }
      } else if (e.k === 'm_airdrop') {
        if (this.kind === 'airdrop' && this.state) {
          if (e.pick) { /* 客户端移除最近已落地箱（视觉） */
            const s = this.state;
            for (let i = s.crates.length - 1; i >= 0; i--) {
              const c = s.crates[i];
              if (c.landed && Math.abs(c.x - e.x) < 2 && Math.abs(c.z - e.z) < 2) {
                World.scene.remove(c.mesh); this.objs = this.objs.filter(o => o !== c.mesh);
                s.crates.splice(i, 1); break;
              }
            }
          } else if (!this._host()) this._spawnCrate(e.x, e.z, World.heightAt(e.x, e.z));
        }
      } else if (e.k === 'm_pwr') {
        if (this.kind === 'searchlight' && this.state) { this.state.power = !!e.on; this._applyAmbient(!!e.on); }
      } else if (e.k === 'm_arty') {
        if (this.kind === 'airdrop' && this.state && this.state.arty) {
          const s = this.state, a = s.arty;
          if (e.warn) {
            a.warn = { x: e.x, z: e.z, r: e.r || a.radius };
            a.warnT = a.warnSec;
            const ring = new THREE.Mesh(new THREE.RingGeometry((e.r || a.radius) - 0.6, (e.r || a.radius), 24, 1), new THREE.MeshBasicMaterial({ color: 0xff4757, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false, fog: false })); // fog:false：警示环不吃雾
            ring.rotation.x = -Math.PI / 2; ring.position.set(e.x, 0.15, e.z);
            World.scene.add(ring); this.objs.push(ring); a.ring = ring;
          }
        }
      } else if (e.k === 'm_zone') {
        this.zone.onEvent(e); // v1.3：缩圈阶段/半径同步（客户端渲染圈）
      }
    } catch (err) { console.warn('[Mechanics] onEvent 异常: ' + (err && err.message)); }
  }
};

/* ================================================================
 * 机制④（v1.3）：zone 缩圈 — 独立子系统（与既有 type 机制叠加）
 * ----------------------------------------------------------------
 * 数据契约（mapDef.zone 顶层；缺 zone / 缺字段 → 容错跳过不开圈）：
   *   zone: {
   *     center: { x, z },                        // 圈心（缺省地图中心）
   *     phases: [ { atSec, r, dmgPerSec } ],     // atSec=对局开始后绝对秒；首阶段起始圈，后续到点缩
   *     warnSec?: 10,                            // 阶段警示提前秒
   *     color?: 0x3f9fd8, shrinkSec?: 2          // 圈色 / 收缩过渡秒（设计 v1.3 默认 2s）
   *   }
 * 语义：到 atSec 立即开始收缩（curR lerp → next.r）+ dmgPerSec 切到下一阶段（紧迫感即时生效）；
 *       圈外（dist > curR）单位每秒 dmgPerSec（2Hz 节流），owner=null 环境伤害、不产分。
 * 权威：房主/单机（Mechanics._host()）跑 _sim；阶段推进广播 m_zone；
 *       客户端按事件渲染圈（本地 shrink lerp 视觉，不重复裁决伤害）。
 * ================================================================ */
Mechanics.zone = {
  active: false, center: { x: 0, z: 0 }, phases: [],
  warnSec: 10, color: 0x3f9fd8, shrinkSec: 2,
  elapsed: 0, phaseIdx: 0, targetR: 0, curR: 0, dmgPerSec: 0,
  shrinkT: 0, shrinking: false, _shrinkFrom: 0,
  warned: {}, dmgT: 0, outBannerT: 0, _vT: 0,
  objs: [], ring: null, glow: null, preview: null, _builtR: -1, _builtPhase: -1,

  /* ---- 生命周期 ---- */
  init(cfg, mapDef) {
    this.dispose();
    if (!cfg || !cfg.center || !Array.isArray(cfg.phases) || !cfg.phases.length) return this;
    const W = (CFG && CFG.WORLD) || 300;
    const cx = typeof cfg.center.x === 'number' ? cfg.center.x : W / 2;
    const cz = typeof cfg.center.z === 'number' ? cfg.center.z : W / 2;
    const phases = cfg.phases.map((p, i) => ({
      atSec: p.atSec !== undefined ? p.atSec : (i ? Number.MAX_SAFE_INTEGER : 0),
      r: p.r !== undefined ? p.r : W * 0.62,
      dmgPerSec: p.dmgPerSec !== undefined ? p.dmgPerSec : 0
    }));
    phases.sort((a, b) => a.atSec - b.atSec);
    if (phases[0].atSec > 0) phases[0].atSec = 0;
    this.active = true;
    this.center = { x: cx, z: cz };
    this.phases = phases;
    this.warnSec = cfg.warnSec !== undefined ? cfg.warnSec : 10;
    this.color = cfg.color !== undefined ? cfg.color : 0x3f9fd8;
    this.shrinkSec = cfg.shrinkSec !== undefined ? cfg.shrinkSec : 2; // 设计 v1.3 默认 2s 收缩
    this.elapsed = 0; this.phaseIdx = 0; this.warned = {}; this.dmgT = 0; this.outBannerT = 0;
    this.targetR = phases[0].r; this.curR = phases[0].r; this.dmgPerSec = phases[0].dmgPerSec;
    this.shrinking = false; this.shrinkT = 0;
    this._buildVisual();
    console.log('[Mechanics] 缩圈初始化: ' + phases.length + ' 阶段 | 初始半径 ' + this.curR.toFixed(1) + ' | 中心 (' + cx.toFixed(1) + ',' + cz.toFixed(1) + ')');
    return this;
  },
  dispose() {
    for (const o of this.objs) { if (World.scene) World.scene.remove(o); o.traverse && o.traverse(c => { if (c.geometry) c.geometry.dispose(); }); }
    this.objs = []; this.ring = null; this.glow = null; this.preview = null;
    if (typeof UI !== 'undefined' && UI.zoneVignette) UI.zoneVignette(0); // 圈外警示复位
    this.active = false; this.phases = []; this.warned = {};
    return this;
  },

  /* ---- 视觉（art/zone-visual.md）：白实线当前圈 + 白辉光 + 电蓝虚线预告圈 ----
   * 全 MeshBasicMaterial + fog:false（沙暴雾 far=70 不吃圈；夜港断电 Basic 不受光）。
   * 性能：亮线/辉光仅在 curR 变化 >0.5m（收缩期）时重建 RingGeometry（seg 按 R 自适应），
   *       非收缩期零重建；预告圈仅阶段推进时重建——不每帧重建。 */
  _buildVisual() {
    if (!World.scene) return;
    const g = new THREE.Group();
    g.position.set(this.center.x, 0.18, this.center.z); // 略高于据点环(0.06)/炮击环(0.15)，避免 z-fighting
    const ring = this._makeRingMesh(0xf0f4f8, 0.85, 0.5);   // 当前圈：白实线（宽 1m）
    const glow = this._makeRingMesh(0xf0f4f8, 0.12, 2.2);   // 白辉光层（宽 4.4m，无后处理下的边缘光效替代）
    const preview = new THREE.Group();                       // 预告圈：电蓝虚线（24 弧段）
    g.add(ring, glow, preview);
    World.scene.add(g);
    this.objs.push(g);
    this.ring = ring; this.glow = glow; this.preview = preview;
    this._builtR = -1; this._builtPhase = -1;
    this._updateRing();
    this._vT = 0;
  },
  _makeRingMesh(color, opacity, halfW) {
    const m = new THREE.Mesh(new THREE.RingGeometry(1 - halfW, 1 + halfW, 4, 1),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  },
  /* 按当前半径重建亮线+辉光（绝对环宽；seg 按 R 自适应：clamp(ceil(2πR/4), 64, 192)） */
  _rebuildRings() {
    const R = Math.max(0.5, this.curR);
    const seg = U.clamp(Math.ceil(2 * Math.PI * R / 4), 64, 192);
    const mk = (mesh, halfW) => {
      const g = new THREE.RingGeometry(R - halfW, R + halfW, seg, 1);
      mesh.geometry.dispose(); mesh.geometry = g;
    };
    mk(this.ring, 0.5);
    mk(this.glow, 2.2);
    this._builtR = R;
  },
  /* 预告圈：电蓝虚线（24 弧段，每段 12° 实 + 3° 空），半径=下阶段 r；最终阶段无预告圈隐藏 */
  _rebuildPreview() {
    const p = this.preview;
    for (let i = p.children.length - 1; i >= 0; i--) { const c = p.children[i]; p.remove(c); if (c.geometry) c.geometry.dispose(); }
    const next = this.phases[this.phaseIdx + 1];
    if (!next) { p.visible = false; this._builtPhase = this.phaseIdx; return; }
    p.visible = true;
    const R2 = Math.max(0.5, next.r);
    const segs = 24, segAng = Math.PI * 2 / segs, on = segAng * 0.8;
    for (let i = 0; i < segs; i++) p.add(this._makeArcSeg(R2, i * segAng, i * segAng + on, 0x2f7fe8, 0.9));
    this._builtPhase = this.phaseIdx;
  },
  _makeArcSeg(R, a0, a1, color, opacity) {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, R + 0.6, a0, a1, false);
    shape.absarc(0, 0, R - 0.6, a1, a0, true);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2;
    return m;
  },
  /* 半径/阶段变化才重建（收缩期每帧最多一次；非收缩期零重建） */
  _updateRing() {
    if (Math.abs(this.curR - this._builtR) > 0.5) this._rebuildRings();
    if (this.phaseIdx !== this._builtPhase) this._rebuildPreview();
  },

  /* ---- 主循环：视觉（所有端）+ 模拟（仅房主） ---- */
  tick(dt) {
    if (!this.active) return;
    try {
      this._updateVisual(dt);
      if (Mechanics._host()) this._sim(dt);
    } catch (e) { console.warn('[Mechanics] zone tick 异常（容错）: ' + (e && e.message)); }
  },
  /* 收缩 lerp：房主 _sim 推进 + 客户端 m_zone 事件推进，两端一致平滑 */
  _updateVisual(dt) {
    if (this.shrinking) {
      this.shrinkT += dt;
      const k = Math.min(1, this.shrinkT / this.shrinkSec);
      this.curR = U.lerp(this._shrinkFrom, this.targetR, k);
      if (k >= 1) { this.shrinking = false; this.curR = this.targetR; }
    }
    this._updateRing();
    // 圈外电蓝 vignette（art/zone-visual §3）：强度随圈外距离递增，0.2s 节流写 DOM
    this._vT += dt;
    if (this._vT >= 0.2) { this._vT = 0; this._updateVignette(); }
  },
  _updateVignette() {
    if (typeof UI === 'undefined' || !UI.zoneVignette || !Game.player) return;
    const p = Game.player;
    if (!p.alive) { UI.zoneVignette(0); return; }
    const dOut = Math.sqrt(U.dist2(p.pos.x, p.pos.z, this.center.x, this.center.z)) - this.curR;
    UI.zoneVignette(dOut > 0 ? U.clamp(dOut / 60, 0.12, 0.45) : 0);
  },
  _sim(dt) {
    const s = this;
    s.elapsed += dt;
    // 阶段推进：到 atSec 立即收缩 + 伤害递增（紧迫感即时生效）
    if (s.phaseIdx < s.phases.length - 1) {
      const next = s.phases[s.phaseIdx + 1];
      if (!s.shrinking && s.elapsed >= next.atSec) {
        s.shrinking = true; s.shrinkT = 0;
        s._shrinkFrom = s.curR; s.targetR = next.r;
        s.dmgPerSec = next.dmgPerSec;
        s.phaseIdx++;
        s._banner('⚠ 安全区收缩 — 圈外伤害提升至 ' + next.dmgPerSec + '/s', '#5aa9ff', 2.5);
        s._broadcast({ k: 'm_zone', phase: s.phaseIdx, r: s.targetR, from: s._shrinkFrom, cx: s.center.x, cz: s.center.z, dmgPerSec: s.dmgPerSec });
      }
      // warnSec 提前警示（每阶段一次）
      if (!s.warned[s.phaseIdx] && !s.shrinking && s.elapsed >= next.atSec - s.warnSec) {
        s.warned[s.phaseIdx] = true;
        s._banner('⚠ 安全区即将收缩！', '#5aa9ff', 2.5);
        s._broadcast({ k: 'm_zone', warn: true, phase: s.phaseIdx + 1 });
      }
    }
    // 圈外伤害（2Hz 节流 → 速率严格 dmgPerSec/s；owner=null 环境伤害不产分）
    s.dmgT -= dt;
    if (s.dmgPerSec > 0 && s.dmgT <= 0) {
      s.dmgT = 0.5;
      const R2 = s.curR * s.curR, cx = s.center.x, cz = s.center.z;
      for (const u of Game.units) {
        if (!u.alive) continue;
        if (U.dist2(u.pos.x, u.pos.z, cx, cz) <= R2) continue;
        Game.applyDamage(u, s.dmgPerSec * 0.5, null, false); // 环境伤害：attacker=null
      }
    }
    // 玩家圈外周期警示（2.5s 节流防刷屏）
    s.outBannerT -= dt;
    if (Game.player && Game.player.alive && s.outBannerT <= 0) {
      const p = Game.player;
      if (U.dist2(p.pos.x, p.pos.z, s.center.x, s.center.z) > s.curR * s.curR) {
        s.outBannerT = 2.5;
        s._banner('⚠ 你已在圈外 — 向安全区移动！', '#ff6b6b', 2);
      }
    }
  },

  /* ---- 联机：客户端按房主事件渲染圈（不裁决伤害） ---- */
  onEvent(e) {
    if (!this.active) return;
    if (e.phase !== undefined) {
      this.phaseIdx = e.phase;
      this.dmgPerSec = e.dmgPerSec !== undefined ? e.dmgPerSec : this.dmgPerSec;
      if (e.cx !== undefined) this.center = { x: e.cx, z: e.cz };
      this._builtPhase = -1; // 阶段变化 → 预告圈重建（下阶段落点更新）
    }
    if (e.r !== undefined) {
      this.shrinking = true; this.shrinkT = 0;
      this._shrinkFrom = e.from !== undefined ? e.from : this.curR;
      this.targetR = e.r;
    }
    if (e.warn) { this._banner('⚠ 安全区即将收缩！', '#5aa9ff', 2.5); }
  },
  /* 供 AI/UI 查询：单位是否在圈外 */
  isOutside(x, z) {
    if (!this.active) return false;
    const R = this.curR;
    return U.dist2(x, z, this.center.x, this.center.z) > R * R;
  },
  /* 圈内最近可达点（AI 进圈目标；无解返回圈心本身，A* 兜底直线逼近） */
  escapeDest(x, z) {
    if (!this.active) return null;
    const cx = this.center.x, cz = this.center.z;
    if (U.dist2(x, z, cx, cz) <= this.curR * this.curR) return null;
    // 向圈心方向采样可达点（从圈心往外找最近可走格，防圈心被建筑占死）
    const R = Math.max(1, this.curR);
    for (let d = 0; d <= 3; d++) {
      const rr = R * (1 - d * 0.25);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const px = cx + Math.cos(a) * rr, pz = cz + Math.sin(a) * rr;
        if (World.walkable(px, pz)) return { x: px, z: pz };
      }
    }
    return { x: cx, z: cz };
  },

  _banner(msg, color, dur) { if (Game.player && Game.player.alive && UI.banner) UI.banner(msg, color, dur); },
  _broadcast(e) { if (typeof Net !== 'undefined' && Net.broadcastEvent) Net.broadcastEvent(e); }
};

if (typeof window !== 'undefined') window.Mechanics = Mechanics;
