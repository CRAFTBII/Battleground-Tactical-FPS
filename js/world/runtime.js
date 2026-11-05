/*
 * v4 WorldRuntime — 对旧游戏暴露 World / MapRegistry 兼容接口。
 * 场景、物理、导航、出生、据点全部由 MapSpec 驱动；旧 AABB 列表只作为兼容层。
 */

import { createPhysics } from './physics.js';
import { createNav } from './nav.js';
import { BUILDING_DIMS, createMapRegistry } from './maps.js';
import { createBuildingFactory, PROC_DIMS } from './buildings.js';

export function createWorldRuntime(RAPIER) {
  const THREE = window.THREE;
  const physics = createPhysics(RAPIER);
  const nav = createNav(physics);
  const MapRegistry = createMapRegistry();
  const _v = () => new THREE.Vector3();

  const World = {
    mapId: null,
    mapDef: null,
    scene: null,
    objects: [],
    colliders: [],       // 兼容旧 AI/掩体/弹药逻辑的 AABB 列表
    platforms: [],
    overhead: [],
    anchors: [],
    props: [],
    spawns: {},
    capturePoints: [],
    capMeshes: [],
    minimapBg: '#202a33',
    minimapStatic: null,
    nav,
    physics,
    stats: { trimeshes: 0, cuboids: 0, navCells: 0, navBlocked: 0 },

    _group: null,
    _envLights: null,
    _footprints: [],
    _flatRects: [],
    _trees: [],
    _proc: null,
    _terrainH: null,
    _matCache: {},

    /* ---------- 生命周期 ---------- */
    init(scene, bootMapId) {
      if (!scene) throw new Error('World.init 需要一个 THREE.Scene');
      this.scene = scene;
      this._initEnv();
      const def = MapRegistry.get(bootMapId || MapRegistry.defaultId);
      this.load(scene, def);
      return this;
    },

    load(scene, def) {
      scene = scene || this.scene;
      if (!scene) throw new Error('World.load 在 World.init 之前被调用');
      this.scene = scene;
      if (!this._envLights) this._initEnv();
      if (!def) def = MapRegistry.get(this.mapId || MapRegistry.defaultId);

      this.unload();

      const CFG = window.CFG;
      if (CFG) {
        CFG.WORLD = def.size;
        CFG.mapScale = Math.max(0.8, Math.min(1.5, def.size / 300));
      }
      // 自动沿街补建筑：只补空地，不覆盖已有建筑/据点/出生点/道路
      def = this._withAutoBuildings(def);
      this.mapId = def.id;
      this.mapDef = def;
      this._footprints = [];
      this.colliders = [];
      this.anchors = [];
      this.props = [];
      this.capturePoints = [];
      this.capMeshes = [];
      this.spawns = {};
      this._trees = [];

      this._applyEnv(def.env || {});
      this._proc = createBuildingFactory(THREE, physics, def.id);
      this._flatRects = this._collectFlatRects(def);
      const group = new THREE.Group();
      group.name = 'map:' + def.id;
      scene.add(group);
      this._group = group;
      this.objects = this._envLights.concat([group]);

      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      physics.reset();
      // 地面（物理）：一个厚板，允许边界外一点余量；地形 trimesh 叠在它上面
      physics.addCuboid(def.size / 2, 0.5, def.size / 2, def.size / 2, -0.5, def.size / 2);

      this._buildGround(def);
      this._buildTerrain(def);
      this._buildHorizon(def);
      this._buildRoads(def);
      this._buildProps(def.props || []);
      this._buildBuildings(def.buildings || []);
      this._buildTrees(def);
      this._buildNature(def);
      this._buildCars(def);
      this._buildLamps(def);
      this._buildBoundary(def.size);
      physics.finalize();

      this._buildCapturePoints(def.capturePoints || []);
      this._buildSpawns(def.spawns || {});
      this._buildMinimap(def);

      const ns = nav.build(def.size, this._footprints);
      this.stats = Object.assign({}, physics.stats(), { navCells: ns.cells, navBlocked: ns.blocked });

      // 旧 AI 依赖的全局函数
      window.findPath = (sx, sz, tx, tz) => nav.findPath(sx, sz, tx, tz);
      window.gridLineClear = (a, b) => nav.gridLineClear(a, b);

      try {
        if (window.Mechanics && window.Mechanics.init) window.Mechanics.init(def);
      } catch (e) {
        console.warn('[World] Mechanics.init 失败（跳过）：' + (e && e.message || e));
      }

      this.updateSun(def.size / 2, def.size / 2);
      const ms = Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - t0);
      console.log('[World] 地图就绪 ' + def.name + ' (' + def.id + ') ' + def.size + 'm · ' +
        this.stats.trimeshes + ' trimesh / ' + this.stats.cuboids + ' cuboid · nav ' +
        this.stats.navCells + ' cells (' + this.stats.navBlocked + ' blocked) · ' + ms + 'ms');
      return this;
    },

    unload() {
      if (this._group) {
        if (this.scene) this.scene.remove(this._group);
        this._group.traverse(o => {
          if (o.geometry) { try { o.geometry.dispose(); } catch (e) { } }
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              if (!m) continue;
              try { m.map && m.map.dispose && m.map.dispose(); } catch (e) { }
              try { m.dispose(); } catch (e) { }
            }
          }
        });
        this._group = null;
      }
      this.objects = this._envLights ? this._envLights.slice() : [];
      this.colliders = [];
      this.capturePoints = [];
      this.capMeshes = [];
      this.spawns = {};
      this._footprints = [];
      this._flatRects = [];
      this._trees = [];
      this._proc = null;
      this._terrainH = null;
      this.mapId = null;
      this.mapDef = null;
      this.minimapStatic = null;
      return this;
    },

    /* ---------- 环境/光照 ---------- */
    _initEnv() {
      const scene = this.scene;
      this._envLights = [];
      // 跟随相机的单盏补光：玩家进室内时照亮近处墙面/地面，灯数固定 1，避免每栋楼一盏灯拖帧
      if (!this._fillLight) {
        const cam = scene.children.find(o => o && o.isCamera);
        if (cam) {
          const fl = new THREE.PointLight(0xffe2b0, 2.8, 19, 1.3);
          fl.position.set(0, 0, 0);
          cam.add(fl);
          this._fillLight = fl;
        }
      }
      const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3d4a3a, 0.95);
      hemi.name = 'env:hemi';
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xfff2d8, 1.25);
      sun.name = 'env:sun';
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const sc = sun.shadow.camera;
      sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 1; sc.far = 320;
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.035;
      scene.add(sun);
      scene.add(sun.target);
      const amb = new THREE.AmbientLight(0x8899aa, 0.22);
      amb.name = 'env:ambient';
      amb.isAmbientLight = true;
      scene.add(amb);
      this._env = { hemi, sun, ambient: amb };
      this._envLights.push(hemi, sun, sun.target, amb);
    },

    _applyEnv(env) {
      const scene = this.scene;
      const sky = env.sky !== undefined ? env.sky : 0x8fb4cc;
      const fog = env.fog !== undefined ? env.fog : sky;
      scene.background = new THREE.Color(sky);
      scene.fog = new THREE.Fog(fog, env.fogNear || 140, env.fogFar || 480);
      const e = this._env;
      if (!e) return;
      e.hemi.color.setHex(env.hemiSky !== undefined ? env.hemiSky : 0xdfeaff);
      e.hemi.groundColor.setHex(env.hemiGround !== undefined ? env.hemiGround : 0x3d4a3a);
      e.hemi.intensity = env.hemiIntensity !== undefined ? env.hemiIntensity : 0.95;
      e.sun.color.setHex(env.sun !== undefined ? env.sun : 0xfff2d8);
      e.sun.intensity = env.sunIntensity !== undefined ? env.sunIntensity : 1.25;
      e.ambient.color.setHex(env.ambient !== undefined ? env.ambient : 0x8899aa);
      e.ambient.intensity = Math.max(0.32, env.ambientIntensity !== undefined ? env.ambientIntensity : 0.22);
    },

    updateSun(x, z) {
      if (!this._env || !this._env.sun) return;
      const sun = this._env.sun;
      sun.position.set(x + 55, 95, z + 38);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld(true);
    },

    /* ---------- 地图内容 ---------- */
    _withAutoBuildings(def) {
      const list = (def.buildings || []).slice();
      const dimsOf = p => p.key ? BUILDING_DIMS[p.key] : PROC_DIMS[p.type];
      const footOf = p => {
        const d = dimsOf(p);
        if (!d) return null;
        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        const hx = c * d.w / 2 + s * d.d / 2, hz = s * d.w / 2 + c * d.d / 2;
        return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
      };
      const ov = (a, b, m) => {
        m = m || 0;
        return a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;
      };
      const existing = list.map(footOf).filter(Boolean);
      for (const p of (def.props || [])) {
        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        existing.push({ x0: p.x - (c * p.w / 2 + s * p.d / 2), x1: p.x + (c * p.w / 2 + s * p.d / 2),
          z0: p.z - (s * p.w / 2 + c * p.d / 2), z1: p.z + (s * p.w / 2 + c * p.d / 2) });
      }
      const roadRects = (def.roads || []).map(r => ({ x0: r.x - r.w / 2 - 2, x1: r.x + r.w / 2 + 2, z0: r.z - r.d / 2 - 2, z1: r.z + r.d / 2 + 2 }));
      const capPts = def.capturePoints || [];
      const spawnPts = Object.values(def.spawns || {}).flat();
      const fits = f => {
        if (f.x0 < 8 || f.z0 < 8 || f.x1 > def.size - 8 || f.z1 > def.size - 8) return false;
        if (existing.some(e => ov(e, f, 2.0))) return false;
        if (roadRects.some(e => ov(e, f, 0))) return false;
        for (const cp of capPts) {
          const dx = Math.max(f.x0 - cp.x, 0, cp.x - f.x1);
          const dz = Math.max(f.z0 - cp.z, 0, cp.z - f.z1);
          if (Math.hypot(dx, dz) < (cp.r || 6) + 3) return false;
        }
        for (const sp of spawnPts) {
          const dx = Math.max(f.x0 - sp.x, 0, sp.x - f.x1);
          const dz = Math.max(f.z0 - sp.z, 0, sp.z - f.z1);
          if (Math.hypot(dx, dz) < 14) return false;
        }
        return true;
      };
      const types = def.id === 'port'
        ? ['shed', 'warehouse', 'cottage', 'townhouse']
        : def.id === 'desert'
          ? ['shed', 'cottage', 'townhouse', 'shop']
          : ['shed', 'cottage', 'townhouse', 'shop'];
      let a = (def.id === 'port' ? 23 : def.id === 'desert' ? 41 : 11) >>> 0;
      const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
      let made = 0;
      const tryAdd = (type, x, z, ry) => {
        if (made >= 20) return false;
        const p = { type, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, ry };
        const f = footOf(p);
        if (!f || !fits(f)) return false;
        list.push(p); existing.push(f); made++;
        return true;
      };
      const pickType = i => types[Math.floor(rnd() * types.length + i) % types.length];
      for (const r of (def.roads || [])) {
        if (Math.min(r.w, r.d) >= 30) continue;
        const horizontal = r.w >= r.d;
        const len = horizontal ? r.w : r.d;
        if (len < 55) continue;
        const step = 24;
        const n = Math.max(2, Math.floor(len / step));
        for (let i = 0; i < n; i++) {
          const t = (i + 0.5) / n;
          for (const side of [-1, 1]) {
            let type = pickType(i);
            let d = PROC_DIMS[type];
            if (!d) continue;
            let x, z, ry;
            if (horizontal) {
              x = r.x - r.w / 2 + r.w * t;
              z = r.z + side * (r.d / 2 + 2 + 7 + d.d / 2);
              ry = side < 0 ? 0 : Math.PI;
            } else {
              z = r.z - r.d / 2 + r.d * t;
              x = r.x + side * (r.w / 2 + 2 + 7 + d.w / 2);
              ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
            }
            if (tryAdd(type, x, z, ry)) continue;
            // 大建筑放不下时退到小屋
            for (const alt of ['cottage', 'shed']) {
              d = PROC_DIMS[alt];
              if (horizontal) z = r.z + side * (r.d / 2 + 2 + 7 + d.d / 2);
              else x = r.x + side * (r.w / 2 + 2 + 7 + d.w / 2);
              if (tryAdd(alt, x, z, ry)) break;
            }
          }
        }
      }
      return Object.assign({}, def, { buildings: list });
    },

    _buildGround(def) {
      const env = def.env || {};
      // v4.1：旧实现把地面放在世界原点，但地图范围是 0..size → 东/南侧会露出天空。
      // 这里用远超地图的底板并居中到 size/2，保证任何视角都不会看到“地表缺失”。
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(def.size + 1400, def.size + 1400),
        new THREE.MeshLambertMaterial({
          color: env.ground !== undefined ? env.ground : 0x4a6b3c,
          side: THREE.DoubleSide
        })
      );
      g.rotation.x = -Math.PI / 2;
      g.position.set(def.size / 2, -0.09, def.size / 2);
      g.receiveShadow = true;
      g.name = 'ground';
      this._group.add(g);
    },

    /* 建筑/道路/据点/出生区之外保持平地；其余区域生成缓坡 */
    _collectFlatRects(def) {
      const rects = [];
      const add = (x, z, w, d, pad) => {
        rects.push({ x0: x - w / 2 - pad, x1: x + w / 2 + pad, z0: z - d / 2 - pad, z1: z + d / 2 + pad });
      };
      for (const r of (def.roads || [])) add(r.x, r.z, r.w, r.d, 3.0);
      for (const p of (def.buildings || [])) {
        const dims = p.key ? BUILDING_DIMS[p.key] : PROC_DIMS[p.type];
        if (!dims) continue;
        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        add(p.x, p.z, c * dims.w + s * dims.d, s * dims.w + c * dims.d, 3.0);
      }
      for (const p of (def.props || [])) {
        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        add(p.x, p.z, c * p.w + s * p.d, s * p.w + c * p.d, 1.5);
      }
      for (const cp of (def.capturePoints || [])) add(cp.x, cp.z, (cp.r || 6) * 2, (cp.r || 6) * 2, 6);
      for (const list of Object.values(def.spawns || {})) {
        for (const sp of list) add(sp.x, sp.z, 20, 20, 6);
      }
      return rects;
    },

    _buildTerrain(def) {
      const S = def.size;
      const env = def.env || {};
      const N = 100;
      const step = S / N;
      const flat = this._flatRects;
      const amp = env.terrainAmp !== undefined ? env.terrainAmp : 1.35;
      const noise = (x, z) =>
        Math.sin(x * 0.033 + 1.7) * Math.cos(z * 0.041 - 0.6) +
        0.55 * Math.sin((x + z) * 0.021 + 2.1) +
        0.3 * Math.cos((x - z) * 0.053);

      const h = (x, z) => {
        let dmin = Infinity;
        for (let i = 0; i < flat.length; i++) {
          const r = flat[i];
          const dx = Math.max(r.x0 - x, 0, x - r.x1);
          const dz = Math.max(r.z0 - z, 0, z - r.z1);
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < dmin) dmin = d;
        }
        const k = Math.max(0, Math.min(1, (dmin - 1.2) / 11));
        const smooth = k * k * (3 - 2 * k);
        const edge = Math.min(x, z, S - x, S - z);
        const ef = Math.max(0, Math.min(1, (edge - 4) / 10));
        const n = 0.5 + 0.5 * noise(x, z);
        return amp * n * smooth * ef;
      };
      this._terrainH = h;

      const V = N + 1;
      const pos = new Float32Array(V * V * 3);
      const col = new Float32Array(V * V * 3);
      const cBase = new THREE.Color(env.ground !== undefined ? env.ground : 0x4a6b3c);
      const cHigh = new THREE.Color(env.ground2 !== undefined ? env.ground2 : 0x6f7d4b);
      const tmp = new THREE.Color();
      for (let iz = 0; iz < V; iz++) {
        const z = iz * step;
        for (let ix = 0; ix < V; ix++) {
          const x = ix * step;
          const y = h(x, z);
          const i = (iz * V + ix) * 3;
          pos[i] = x; pos[i + 1] = y; pos[i + 2] = z;
          const k = Math.max(0, Math.min(1, y / Math.max(0.001, amp)));
          tmp.copy(cBase).lerp(cHigh, 0.18 + k * 0.45);
          const v = 0.92 + 0.08 * ((Math.sin(x * 0.9 + z * 1.3) + 1) * 0.5);
          col[i] = tmp.r * v; col[i + 1] = tmp.g * v; col[i + 2] = tmp.b * v;
        }
      }
      const idx = new Uint32Array(N * N * 6);
      let o = 0;
      for (let iz = 0; iz < N; iz++) {
        for (let ix = 0; ix < N; ix++) {
          const a = iz * V + ix, b = a + 1, c = a + V, d = c + 1;
          idx[o++] = a; idx[o++] = c; idx[o++] = b;
          idx[o++] = b; idx[o++] = c; idx[o++] = d;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.setIndex(Array.from(idx));
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      mesh.name = 'terrain';
      mesh.receiveShadow = true;
      this._group.add(mesh);
      physics.addTrimesh(pos, idx);
      this._terrainMesh = mesh;
    },

    _buildHorizon(def) {
      const S = def.size;
      const env = def.env || {};
      const fog = new THREE.Color(env.fog !== undefined ? env.fog : 0x8fb4cc);
      const base = new THREE.Color(env.ground2 !== undefined ? env.ground2 : 0x6f7d4b);
      const center = S / 2;
      const geo = new THREE.SphereGeometry(1, 10, 7);
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2 + (i % 4) * 0.05;
        const r = S * (1.02 + (i % 5) * 0.14);
        const hgt = 22 + (i * 37 % 46);
        const rad = 75 + (i * 53 % 80);
        const c = base.clone().lerp(fog, 0.42 + (i % 4) * 0.07);
        const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: c }));
        m.scale.set(rad, hgt * 0.72, rad * (0.75 + (i % 3) * 0.12));
        m.position.set(center + Math.cos(a) * r, hgt * 0.04, center + Math.sin(a) * r);
        m.rotation.y = a;
        this._group.add(m);
      }
    },

    _buildRoads(def) {
      const list = def.roads || [];
      const walkMat = new THREE.MeshLambertMaterial({ color: 0x9b998f });
      const curbMat = new THREE.MeshLambertMaterial({ color: 0x3d4144 });
      for (const r of list) {
        const horizontal = r.w >= r.d;
        const plaza = Math.min(r.w, r.d) >= 30;
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(r.w, r.d),
          new THREE.MeshLambertMaterial({ color: r.color !== undefined ? r.color : 0x5b5f62 })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(r.x, plaza ? 0.028 : 0.038, r.z);
        m.receiveShadow = true;
        this._group.add(m);
        if (plaza) {
          // 广场边框
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(Math.min(r.w, r.d) / 2 - 0.6, Math.min(r.w, r.d) / 2, 4, 1),
            new THREE.MeshBasicMaterial({ color: 0xb9b3a4, side: THREE.DoubleSide })
          );
          ring.rotation.x = -Math.PI / 2;
          ring.rotation.z = Math.PI / 4;
          ring.position.set(r.x, 0.05, r.z);
          this._group.add(ring);
          continue;
        }
        // 人行道/路缘
        if (horizontal) {
          for (const sz of [-1, 1]) {
            const z = r.z + sz * (r.d / 2 + 1.0);
            const sw = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.14, 2.0), walkMat);
            sw.position.set(r.x, 0.07, z);
            sw.receiveShadow = true;
            this._group.add(sw);
            const curb = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.18, 0.16), curbMat);
            curb.position.set(r.x, 0.09, r.z + sz * (r.d / 2 + 0.08));
            this._group.add(curb);
          }
          // 中心线
          const line = new THREE.Mesh(
            new THREE.PlaneGeometry(Math.max(4, r.w - 6), 0.18),
            new THREE.MeshBasicMaterial({ color: 0xd9c56a })
          );
          line.rotation.x = -Math.PI / 2;
          line.position.set(r.x, 0.052, r.z);
          this._group.add(line);
        } else {
          for (const sx of [-1, 1]) {
            const x = r.x + sx * (r.w / 2 + 1.0);
            const sw = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, r.d), walkMat);
            sw.position.set(x, 0.07, r.z);
            sw.receiveShadow = true;
            this._group.add(sw);
            const curb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, r.d), curbMat);
            curb.position.set(r.x + sx * (r.w / 2 + 0.08), 0.09, r.z);
            this._group.add(curb);
          }
          const line = new THREE.Mesh(
            new THREE.PlaneGeometry(0.18, Math.max(4, r.d - 6)),
            new THREE.MeshBasicMaterial({ color: 0xd9c56a })
          );
          line.rotation.x = -Math.PI / 2;
          line.position.set(r.x, 0.052, r.z);
          this._group.add(line);
        }
      }
    },

    _buildProps(props) {
      for (const p of props) {
        const gy = this._terrainH ? this._terrainH(p.x, p.z) : 0;
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(p.w, p.h, p.d),
          new THREE.MeshLambertMaterial({ color: p.color !== undefined ? p.color : 0x6b5a3e })
        );
        box.position.set(p.x, gy + p.h / 2, p.z);
        box.rotation.y = p.ry || 0;
        box.castShadow = true;
        box.receiveShadow = true;
        this._group.add(box);
        this.props.push(box);

        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry || 0);
        const desc = RAPIER.ColliderDesc.cuboid(p.w / 2, p.h / 2, p.d / 2)
          .setTranslation(p.x, gy + p.h / 2, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        physics.addCuboidDesc(desc);

        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        const hx = c * p.w / 2 + s * p.d / 2;
        const hz = s * p.w / 2 + c * p.d / 2;
        this._footprints.push({ x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz });
        this.colliders.push({
          min: new THREE.Vector3(p.x - hx, gy, p.z - hz),
          max: new THREE.Vector3(p.x + hx, gy + p.h, p.z + hz)
        });
      }
    },

    _buildTrees(def) {
      const S = def.size;
      const env = def.env || {};
      const seed = (def.id === 'suburb' ? 7 : def.id === 'port' ? 19 : 31);
      const rnd = (() => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
      const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a4630 });
      const leafA = new THREE.MeshLambertMaterial({ color: env.ground2 !== undefined ? env.ground2 : 0x4f6b3d });
      const leafB = new THREE.MeshLambertMaterial({ color: def.id === 'desert' ? 0x7a7a48 : 0x3d5a35 });
      const inRoad = (x, z) => (def.roads || []).some(r => x > r.x - r.w / 2 - 2 && x < r.x + r.w / 2 + 2 && z > r.z - r.d / 2 - 2 && z < r.z + r.d / 2 + 2);
      const inFoot = (x, z) => this._footprints.some(f => x > f.x0 - 1.2 && x < f.x1 + 1.2 && z > f.z0 - 1.2 && z < f.z1 + 1.2);
      const inCap = (x, z) => (def.capturePoints || []).some(c => Math.hypot(x - c.x, z - c.z) < (c.r || 6) + 5);
      const inSpawn = (x, z) => Object.values(def.spawns || {}).some(list => list.some(s => Math.hypot(x - s.x, z - s.z) < 12));
      let made = 0;
      for (let i = 0; i < 760 && made < 64; i++) {
        const x = 8 + rnd() * (S - 16);
        const z = 8 + rnd() * (S - 16);
        if (inRoad(x, z) || inFoot(x, z) || inCap(x, z) || inSpawn(x, z)) continue;
        if (this._trees.some(t => Math.hypot(t.x - x, t.z - z) < 3.2)) continue;
        const y = this._terrainH ? this._terrainH(x, z) : 0;
        const sc = 0.9 + rnd() * 0.9;
        const g = new THREE.Group();
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * sc, 0.24 * sc, 2.3 * sc, 6), trunkMat);
        trunk.position.y = 1.15 * sc;
        const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.35 * sc, 2.4 * sc, 7), leafA);
        c1.position.y = 2.9 * sc;
        const c2 = new THREE.Mesh(new THREE.ConeGeometry(1.0 * sc, 1.9 * sc, 7), leafB);
        c2.position.y = 4.0 * sc;
        trunk.castShadow = c1.castShadow = c2.castShadow = true;
        trunk.receiveShadow = c1.receiveShadow = c2.receiveShadow = true;
        g.add(trunk, c1, c2);
        g.position.set(x, y, z);
        g.rotation.y = rnd() * Math.PI;
        this._group.add(g);
        physics.addCylinderCollider(1.2 * sc, 0.24 * sc, x, y + 1.2 * sc, z);
        this._footprints.push({ x0: x - 0.36, x1: x + 0.36, z0: z - 0.36, z1: z + 0.36 });
        this._trees.push({ x, z, y, scale: sc });
        made++;
      }
    },

    _buildNature(def) {
      const S = def.size;
      const env = def.env || {};
      const isDesert = def.id === 'desert';
      const rnd = (() => { let a = (isDesert ? 101 : 57); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
      const bushMat = new THREE.MeshLambertMaterial({ color: isDesert ? 0x8a8a52 : 0x466b3a });
      const bush2Mat = new THREE.MeshLambertMaterial({ color: isDesert ? 0x9a945c : 0x567a45 });
      const rockMat = new THREE.MeshLambertMaterial({ color: isDesert ? 0x9a8866 : 0x7a7d78 });
      const inRoad = (x, z) => (def.roads || []).some(r => x > r.x - r.w / 2 - 1 && x < r.x + r.w / 2 + 1 && z > r.z - r.d / 2 - 1 && z < r.z + r.d / 2 + 1);
      const inFoot = (x, z) => this._footprints.some(f => x > f.x0 - 0.8 && x < f.x1 + 0.8 && z > f.z0 - 0.8 && z < f.z1 + 0.8);
      const inCap = (x, z) => (def.capturePoints || []).some(c => Math.hypot(x - c.x, z - c.z) < (c.r || 6) + 3);
      const inSpawn = (x, z) => Object.values(def.spawns || {}).some(list => list.some(s => Math.hypot(x - s.x, z - s.z) < 10));
      let bushes = 0, rocks = 0;
      for (let i = 0; i < 420 && (bushes < 34 || rocks < 20); i++) {
        const x = 8 + rnd() * (S - 16);
        const z = 8 + rnd() * (S - 16);
        if (inRoad(x, z) || inFoot(x, z) || inCap(x, z) || inSpawn(x, z)) continue;
        const y = this._terrainH ? this._terrainH(x, z) : 0;
        const wantRock = rocks < 20 && (bushes >= 34 || rnd() < 0.36);
        if (wantRock) {
          const sc = 0.45 + rnd() * 0.9;
          const r = new THREE.Mesh(new THREE.DodecahedronGeometry(sc, 0), rockMat);
          r.position.set(x, y + sc * 0.45, z);
          r.rotation.set(rnd() * 0.5, rnd() * 3, rnd() * 0.5);
          r.scale.y = 0.62;
          r.castShadow = true; r.receiveShadow = true;
          this._group.add(r);
          physics.addBoxCollider(sc * 1.4, sc * 0.8, sc * 1.4, x, y + sc * 0.35, z, 0);
          this._footprints.push({ x0: x - sc * 0.7, x1: x + sc * 0.7, z0: z - sc * 0.7, z1: z + sc * 0.7 });
          rocks++;
        } else if (bushes < 34) {
          const sc = 0.55 + rnd() * 0.65;
          const g = new THREE.Group();
          const b1 = new THREE.Mesh(new THREE.SphereGeometry(sc, 6, 5), bushMat);
          b1.position.y = sc * 0.55; b1.scale.y = 0.72;
          const b2 = new THREE.Mesh(new THREE.SphereGeometry(sc * 0.7, 6, 5), bush2Mat);
          b2.position.set(sc * 0.45, sc * 0.4, -sc * 0.2); b2.scale.y = 0.7;
          b1.castShadow = b2.castShadow = true;
          g.add(b1, b2);
          g.position.set(x, y, z);
          g.rotation.y = rnd() * 3;
          this._group.add(g);
          bushes++;
        }
      }
    },

    _buildCars(def) {
      const palette = def.id === 'port'
        ? [0x5a6a72, 0x7a4a3e, 0x3f5a68, 0x8a8a7a, 0x4a4a52]
        : def.id === 'desert'
          ? [0x9a7a4a, 0x7a5a3a, 0x6a6a5a, 0x8a4a3a]
          : [0x6a7a8a, 0x8a4a3a, 0xd0c8b8, 0x4a5a4a, 0x5a4a3a];
      const wheelMat = new THREE.MeshLambertMaterial({ color: 0x202226 });
      const glassMat = new THREE.MeshLambertMaterial({ color: 0x8fb0c0 });
      const rnd = (() => { let a = (def.id === 'port' ? 77 : def.id === 'desert' ? 91 : 43); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
      let made = 0;
      for (const r of (def.roads || [])) {
        if (Math.min(r.w, r.d) >= 30) continue;
        const horizontal = r.w >= r.d;
        const len = horizontal ? r.w : r.d;
        if (len < 45) continue;
        const count = Math.min(3, Math.floor(len / 55));
        for (let i = 0; i < count; i++) {
          const t = (i + 0.5) / count;
          const side = (i % 2 ? 1 : -1);
          const x = horizontal ? r.x - r.w / 2 + r.w * t : r.x + side * (r.w / 2 - 1.6);
          const z = horizontal ? r.z + side * (r.d / 2 - 1.6) : r.z - r.d / 2 + r.d * t;
          if (this._footprints.some(f => x > f.x0 - 0.6 && x < f.x1 + 0.6 && z > f.z0 - 0.6 && z < f.z1 + 0.6)) continue;
          if ((def.capturePoints || []).some(c => Math.hypot(x - c.x, z - c.z) < (c.r || 6) + 2)) continue;
          const y = this._terrainH ? this._terrainH(x, z) : 0;
          const g = new THREE.Group();
          const color = palette[(made + i) % palette.length];
          const bodyMat = new THREE.MeshLambertMaterial({ color });
          const body = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.62, 1.85), bodyMat);
          body.position.y = 0.62;
          const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.52, 1.7), bodyMat);
          cab.position.set(-0.15, 1.15, 0);
          const glass = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.34, 1.72), glassMat);
          glass.position.set(-0.15, 1.22, 0);
          body.castShadow = cab.castShadow = glass.castShadow = true;
          g.add(body, cab, glass);
          for (const wx of [-1.25, 1.25]) {
            for (const wz of [-0.86, 0.86]) {
              const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 8), wheelMat);
              w.rotation.x = Math.PI / 2;
              w.position.set(wx, 0.34, wz);
              g.add(w);
            }
          }
          g.position.set(x, y, z);
          g.rotation.y = horizontal ? 0 : Math.PI / 2;
          this._group.add(g);
          physics.addBoxCollider(4.3, 1.35, 2.0, x, y + 0.68, z, horizontal ? 0 : Math.PI / 2);
          this._footprints.push(horizontal
            ? { x0: x - 2.2, x1: x + 2.2, z0: z - 1.1, z1: z + 1.1 }
            : { x0: x - 1.1, x1: x + 1.1, z0: z - 2.2, z1: z + 2.2 });
          this.colliders.push({
            min: new THREE.Vector3(x - 2.2, y, z - 1.1),
            max: new THREE.Vector3(x + 2.2, y + 1.4, z + 1.1)
          });
          made++;
        }
      }
    },

    _buildLamps(def) {
      const S = def.size;
      const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f44 });
      const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0 });
      let made = 0;
      const blocked = (x, z) => this._footprints.some(f => x > f.x0 - 0.8 && x < f.x1 + 0.8 && z > f.z0 - 0.8 && z < f.z1 + 0.8);
      for (const r of (def.roads || [])) {
        if (Math.min(r.w, r.d) >= 30) continue;
        const horizontal = r.w >= r.d;
        const len = horizontal ? r.w : r.d;
        if (len < 50) continue;
        const count = Math.min(4, Math.floor(len / 42));
        for (let i = 0; i < count; i++) {
          const t = (i + 0.7) / count;
          const x = horizontal ? r.x - r.w / 2 + r.w * t : r.x + r.w / 2 + 2.4;
          const z = horizontal ? r.z + r.d / 2 + 2.4 : r.z - r.d / 2 + r.d * t;
          if (x < 3 || z < 3 || x > S - 3 || z > S - 3) continue;
          if (blocked(x, z)) continue;
          const y = this._terrainH ? this._terrainH(x, z) : 0;
          const g = new THREE.Group();
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 4.8, 6), poleMat);
          pole.position.y = 2.4;
          const arm = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.1, 0.1), poleMat);
          arm.position.set(0.45, 4.75, 0);
          const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.32), lampMat);
          lamp.position.set(0.95, 4.68, 0);
          pole.castShadow = true;
          g.add(pole, arm, lamp);
          g.position.set(x, y, z);
          g.rotation.y = horizontal ? 0 : Math.PI / 2;
          this._group.add(g);
          physics.addCylinderCollider(2.4, 0.14, x, y + 2.4, z);
          this._footprints.push({ x0: x - 0.25, x1: x + 0.25, z0: z - 0.25, z1: z + 0.25 });
          if (++made >= 18) return;
        }
      }
    },

    _buildBuildings(list) {
      for (const p of list) {
        if (p.type) {
          const res = this._proc.build(p.type, p.x, p.z, p.ry || 0, (p.x * 131 + p.z * 17) | 0);
          this._group.add(res.group);
          this._footprints.push(res.footprint);
          this.colliders.push({
            min: new THREE.Vector3(res.footprint.x0, 0, res.footprint.z0),
            max: new THREE.Vector3(res.footprint.x1, res.height, res.footprint.z1)
          });
          continue;
        }
        const glb = (window.AssetLoader && AssetLoader.building) ? AssetLoader.building(p.key) : null;
        if (!glb) {
          console.warn('[World] 缺少建筑资产 ' + p.key + '，使用占位盒');
          this._buildPlaceholder(p);
          continue;
        }
        const root = window.GLB.scene(glb, { castShadow: true, receiveShadow: true });
        root.position.set(p.x, 0, p.z);
        root.rotation.y = p.ry || 0;
        this._group.add(root);
        root.updateMatrixWorld(true);
        // 内部可见：单面材质从室内看会被背面剔除，表现为“里面一片灰/空”
        root.traverse(o => {
          if (!o.isMesh || !o.material) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach(m => { if (m) m.side = THREE.DoubleSide; });
        });


        const navGroup = root.getObjectByName('NAV__' + p.key);
        if (navGroup) navGroup.visible = false;

        const colGroup = root.getObjectByName('COL__' + p.key);
        let box = null;
        if (colGroup) {
          colGroup.visible = false;
          colGroup.traverse(o => {
            if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
            const geo = o.geometry.clone();
            geo.applyMatrix4(o.matrixWorld);
            const pos = new Float32Array(geo.attributes.position.array);
            const index = geo.index ? new Uint32Array(geo.index.array) : (() => {
              const a = new Uint32Array(pos.length / 3);
              for (let i = 0; i < a.length; i++) a[i] = i;
              return a;
            })();
            if (index.length < 3) return;
            physics.addTrimesh(pos, index);
            geo.computeBoundingBox();
            const bb = geo.boundingBox;
            if (!bb) return;
            this.colliders.push({
              min: new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
              max: new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z)
            });
            if (!box) box = { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z };
            else {
              box.x0 = Math.min(box.x0, bb.min.x); box.x1 = Math.max(box.x1, bb.max.x);
              box.z0 = Math.min(box.z0, bb.min.z); box.z1 = Math.max(box.z1, bb.max.z);
            }
            geo.dispose();
          });
        }
        if (box) this._footprints.push(box);
        else {
          const dims = BUILDING_DIMS[p.key] || { w: 10, d: 10 };
          const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
          const hx = c * dims.w / 2 + s * dims.d / 2;
          const hz = s * dims.w / 2 + c * dims.d / 2;
          this._footprints.push({ x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz });
        }

        root.traverse(o => {
          if (!o.name || o.name.indexOf('ANCHOR__') !== 0) return;
          const wp = new THREE.Vector3();
          o.getWorldPosition(wp);
          this.anchors.push({ name: o.name, x: wp.x, y: wp.y, z: wp.z, extras: o.userData && o.userData.extras });
        });
      }
    },

    _buildPlaceholder(p) {
      const dims = BUILDING_DIMS[p.key] || { w: 10, h: 5, d: 10 };
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(dims.w, dims.h, dims.d),
        new THREE.MeshLambertMaterial({ color: 0x7a6a55 })
      );
      m.position.set(p.x, dims.h / 2, p.z);
      m.rotation.y = p.ry || 0;
      m.castShadow = true; m.receiveShadow = true;
      this._group.add(m);
      physics.addCuboid(dims.w / 2, dims.h / 2, dims.d / 2, p.x, dims.h / 2, p.z);
      this._footprints.push({ x0: p.x - dims.w / 2, x1: p.x + dims.w / 2, z0: p.z - dims.d / 2, z1: p.z + dims.d / 2 });
      this.colliders.push({
        min: new THREE.Vector3(p.x - dims.w / 2, 0, p.z - dims.d / 2),
        max: new THREE.Vector3(p.x + dims.w / 2, dims.h, p.z + dims.d / 2)
      });
    },

    _buildBoundary(size) {
      const mat = new THREE.MeshLambertMaterial({ color: 0x55595c });
      const mk = (w, d, x, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 3.2, d), mat);
        m.position.set(x, 1.6, z);
        m.castShadow = true; m.receiveShadow = true;
        this._group.add(m);
        physics.addCuboid(w / 2, 1.6, d / 2, x, 1.6, z);
      };
      mk(size, 1.2, size / 2, 0.35);
      mk(size, 1.2, size / 2, size - 0.35);
      mk(1.2, size, 0.35, size / 2);
      mk(1.2, size, size - 0.35, size / 2);
    },

    _buildCapturePoints(list) {
      const neutral = (window.CFG && CFG.teamColor) ? CFG.teamColor('neutral').hex : 0x707880;
      for (const cp of list) {
        const g = new THREE.Group();
        const gy = this._terrainH ? this._terrainH(cp.x, cp.z) : 0;
        g.position.set(cp.x, gy, cp.z);
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(Math.max(1, cp.r - 0.35), cp.r, 48),
          new THREE.MeshBasicMaterial({ color: neutral, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.07;
        const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.07, 0.07, 4.2, 8),
          new THREE.MeshLambertMaterial({ color: 0x343a40 })
        );
        pole.position.y = 2.1;
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(1.5, 0.9),
          new THREE.MeshLambertMaterial({ color: neutral, side: THREE.DoubleSide, transparent: true, opacity: 0.88 })
        );
        flag.position.set(0.79, 3.6, 0);
        g.add(ring, pole, flag);
        this._group.add(g);
        this.capturePoints.push({ id: cp.id, x: cp.x, z: cp.z, r: cp.r || 6, band: !!cp.band });
        this.capMeshes.push({ ring, pole, flag, group: g });
      }
    },

    _buildSpawns(spawns) {
      for (const team of Object.keys(spawns)) {
        this.spawns[team] = (spawns[team] || []).map(s => ({
          x: s.x, z: s.z, y: physics.heightAt(s.x, s.z)
        }));
      }
      if (!this.spawns.blue || !this.spawns.blue.length) {
        this.spawns.blue = [{ x: this.mapDef.size * 0.18, z: this.mapDef.size * 0.82, y: 0 }];
      }
      if (!this.spawns.red || !this.spawns.red.length) {
        this.spawns.red = [{ x: this.mapDef.size * 0.82, z: this.mapDef.size * 0.18, y: 0 }];
      }
    },

    _buildMinimap(def) {
      if (typeof document === 'undefined') return;
      const S = 188;
      const cv = document.createElement('canvas');
      cv.width = S; cv.height = S;
      const g = cv.getContext('2d');
      const env = def.env || {};
      this.minimapBg = env.groundCss || '#33472b';
      g.fillStyle = this.minimapBg;
      g.fillRect(0, 0, S, S);
      const toPx = v => v / def.size * S;

      for (const r of (def.roads || [])) {
        g.fillStyle = '#' + ((r.color !== undefined ? r.color : 0x55595c) >>> 0).toString(16).padStart(6, '0');
        g.fillRect(toPx(r.x - r.w / 2), toPx(r.z - r.d / 2), toPx(r.w), toPx(r.d));
      }
      // 建筑 footprint（使用 COL 实际包围盒，旋转也正确）
      for (const f of this._footprints) {
        if ((f.x1 - f.x0) < 1.5 && (f.z1 - f.z0) < 1.5) continue; // 树/灯柱不画成建筑
        const x = toPx(f.x0), z = toPx(f.z0);
        const w = Math.max(1.5, toPx(f.x1 - f.x0)), d = Math.max(1.5, toPx(f.z1 - f.z0));
        g.fillStyle = 'rgba(24,30,36,0.78)';
        g.fillRect(x, z, w, d);
        g.strokeStyle = 'rgba(210,225,240,0.28)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, z + 0.5, Math.max(0, w - 1), Math.max(0, d - 1));
      }
      // 树
      g.fillStyle = 'rgba(38,74,40,0.8)';
      for (const t of this._trees) {
        g.beginPath();
        g.arc(toPx(t.x), toPx(t.z), 1.2, 0, 7);
        g.fill();
      }
      // 边界
      g.strokeStyle = 'rgba(240,244,248,0.28)';
      g.lineWidth = 2;
      g.strokeRect(1, 1, S - 2, S - 2);
      // 据点
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const cp of this.capturePoints) {
        const x = toPx(cp.x), z = toPx(cp.z), r = Math.max(4, toPx(cp.r));
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 1.2;
        g.beginPath(); g.arc(x, z, r, 0, 7); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.92)';
        g.font = 'bold 9px sans-serif';
        g.fillText(cp.id, x, z);
      }
      this.minimapStatic = cv;
    },

    /* ---------- 旧接口 ---------- */
    heightAt(x, z, currentY) {
      return physics.heightAt(x, z, currentY);
    },

    ceilingAt(x, z, fromY) {
      return physics.ceilingAt(x, z, fromY);
    },

    walkable(x, z) {
      const def = this.mapDef;
      if (!def) return false;
      if (!(x > 1.2 && z > 1.2 && x < def.size - 1.2 && z < def.size - 1.2)) return false;
      for (const f of this._footprints) {
        if (x > f.x0 - 0.55 && x < f.x1 + 0.55 && z > f.z0 - 0.55 && z < f.z1 + 0.55) return false;
      }
      return physics.walkablePoint(x, z);
    },

    blocksAt(c, feetY) {
      if (!c) return false;
      const h = (window.CFG && CFG.PLAYER_HEIGHT) || 2.0;
      const feet = feetY || 0;
      return c.max.y > feet + 0.18 && c.min.y < feet + h - 0.12;
    },

    rayBlocked(from, to) {
      return physics.segmentBlocked(from, to);
    },

    segmentBlocked(from, to) {
      return physics.segmentBlocked(from, to);
    },

    pointBlocked(x, y, z) {
      const hit = physics.ray({ x, y: y + 0.001, z }, { x: 0, y: -1, z: 0 }, 0.002);
      return !!hit;
    },

    pickSpawn(team) {
      const def = this.mapDef;
      const list = (this.spawns && this.spawns[team]) || (this.spawns && this.spawns.blue) || [];
      const size = def ? def.size : 300;
      const fallback = { x: size / 2, y: 0, z: size / 2 };
      if (!list.length) return fallback;
      const valid = list.filter(s => this.walkable(s.x, s.z) && this.heightAt(s.x, s.z) < 1.2);
      const pool = valid.length ? valid : list;
      const s = pool[Math.floor(Math.random() * pool.length)];
      return { x: s.x, y: this.heightAt(s.x, s.z), z: s.z };
    },

    /** 玩家专用：Rapier 角色控制器（自动台阶/贴墙/落地），y 也由控制器负责。 */
    movePlayer(obj, dx, dy, dz) {
      const p = obj && obj.pos ? obj.pos : obj;
      if (!p) return null;
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
      if (!Number.isFinite(p.y)) p.y = 0;
      const res = physics.movePlayer({ x: p.x, y: p.y, z: p.z }, dx || 0, dy || 0, dz || 0);
      if (!res) return null;
      const size = this.mapDef ? this.mapDef.size : 300;
      p.x = Math.max(1.5, Math.min(size - 1.5, res.x));
      p.y = res.y;
      p.z = Math.max(1.5, Math.min(size - 1.5, res.z));
      return res;
    },

    teleportPlayer(obj) {
      const p = obj && obj.pos ? obj.pos : obj;
      if (p) physics.teleportPlayer(p);
    },

    /**
     * 胶囊体移动（AI/兜底）。obj 可以是 {pos:Vector3} 或 Vector3。
     * 只处理水平位移；y 仅在台阶抬升时改写，跳跃/重力仍由旧逻辑管理。
     */
    moveActor(obj, dx, dz) {
      const p = obj && obj.pos ? obj.pos : obj;
      if (!p) return null;
      if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
      const CFG = window.CFG || {};
      const radius = CFG.PLAYER_RADIUS || 0.35;
      const height = CFG.PLAYER_CAPSULE_HEIGHT || CFG.PLAYER_HEIGHT || 2.0;
      const step = CFG.PLAYER_STEP || 0.45;
      if (!Number.isFinite(p.y)) p.y = 0;
      // AI 数量多：用射线近似胶囊，玩家保留完整 capsule sweep（手感/门洞关键）
      const res = (obj && obj.ai)
        ? physics.moveRayActor({ x: p.x, y: p.y, z: p.z }, dx, dz, radius, height)
        : physics.moveCapsule({ x: p.x, y: p.y, z: p.z }, dx, dz, radius, height, step);
      const size = this.mapDef ? this.mapDef.size : 300;
      p.x = Math.max(1.5, Math.min(size - 1.5, res.x));
      p.z = Math.max(1.5, Math.min(size - 1.5, res.z));
      p.y = res.y;
      return res;
    },

    sharedMat(name, scale, color) {
      const key = 's:' + name + ':' + (scale || 1) + ':' + (color || 0);
      if (!this._matCache[key]) this._matCache[key] = new THREE.MeshLambertMaterial({ color: color || 0x6a6f74 });
      return this._matCache[key];
    },

    basicMat(name, color) {
      const key = 'b:' + name + ':' + (color || 0);
      if (!this._matCache[key]) this._matCache[key] = new THREE.MeshBasicMaterial({ color: color || 0xffffff });
      return this._matCache[key];
    },

    // 旧 models.js 接口占位：v4 地图不走旧 building builder
    buildBuilding() { return null; },
    placeModelBuilding() { return null; },
    syncBuildingMeta() { }
  };

  return { World, MapRegistry };
}
