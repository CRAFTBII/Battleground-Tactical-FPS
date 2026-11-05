/*
 * v4 WorldRuntime — 对旧游戏暴露 World / MapRegistry 兼容接口。
 * 场景、物理、导航、出生、据点全部由 MapSpec 驱动；旧 AABB 列表只作为兼容层。
 */

import { createPhysics } from './physics.js';
import { createNav } from './nav.js';
import { BUILDING_DIMS, createMapRegistry } from './maps.js';

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
      this.mapId = def.id;
      this.mapDef = def;
      this._footprints = [];
      this.colliders = [];
      this.anchors = [];
      this.props = [];
      this.capturePoints = [];
      this.capMeshes = [];
      this.spawns = {};

      this._applyEnv(def.env || {});
      const group = new THREE.Group();
      group.name = 'map:' + def.id;
      scene.add(group);
      this._group = group;
      this.objects = this._envLights.concat([group]);

      const t0 = (window.performance && performance.now) ? performance.now() : Date.now();
      physics.reset();
      // 地面（物理）：一个厚板，允许边界外一点余量
      physics.addCuboid(def.size / 2, 0.5, def.size / 2, def.size / 2, -0.5, def.size / 2);

      this._buildGround(def);
      this._buildRoads(def);
      this._buildProps(def.props || []);
      this._buildBuildings(def.buildings || []);
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
      this.mapId = null;
      this.mapDef = null;
      this.minimapStatic = null;
      return this;
    },

    /* ---------- 环境/光照 ---------- */
    _initEnv() {
      const scene = this.scene;
      this._envLights = [];
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
      e.ambient.intensity = env.ambientIntensity !== undefined ? env.ambientIntensity : 0.22;
    },

    updateSun(x, z) {
      if (!this._env || !this._env.sun) return;
      const sun = this._env.sun;
      sun.position.set(x + 55, 95, z + 38);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld(true);
    },

    /* ---------- 地图内容 ---------- */
    _buildGround(def) {
      const env = def.env || {};
      const g = new THREE.Mesh(
        new THREE.PlaneGeometry(def.size + 160, def.size + 160),
        new THREE.MeshLambertMaterial({ color: env.ground !== undefined ? env.ground : 0x4a6b3c })
      );
      g.rotation.x = -Math.PI / 2;
      g.receiveShadow = true;
      g.name = 'ground';
      this._group.add(g);
    },

    _buildRoads(def) {
      const list = def.roads || [];
      for (const r of list) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(r.w, r.d),
          new THREE.MeshLambertMaterial({ color: r.color !== undefined ? r.color : 0x5b5f62 })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(r.x, 0.018, r.z);
        m.receiveShadow = true;
        this._group.add(m);
      }
    },

    _buildProps(props) {
      for (const p of props) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(p.w, p.h, p.d),
          new THREE.MeshLambertMaterial({ color: p.color !== undefined ? p.color : 0x6b5a3e })
        );
        box.position.set(p.x, p.h / 2, p.z);
        box.rotation.y = p.ry || 0;
        box.castShadow = true;
        box.receiveShadow = true;
        this._group.add(box);
        this.props.push(box);

        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry || 0);
        const desc = RAPIER.ColliderDesc.cuboid(p.w / 2, p.h / 2, p.d / 2)
          .setTranslation(p.x, p.h / 2, p.z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        physics.addCuboidDesc(desc);

        const c = Math.abs(Math.cos(p.ry || 0)), s = Math.abs(Math.sin(p.ry || 0));
        const hx = c * p.w / 2 + s * p.d / 2;
        const hz = s * p.w / 2 + c * p.d / 2;
        this._footprints.push({ x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz });
        this.colliders.push({
          min: new THREE.Vector3(p.x - hx, 0, p.z - hz),
          max: new THREE.Vector3(p.x + hx, p.h, p.z + hz)
        });
      }
    },

    _buildBuildings(list) {
      for (const p of list) {
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
        g.position.set(cp.x, 0, cp.z);
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
        const x = toPx(f.x0), z = toPx(f.z0);
        const w = Math.max(1.5, toPx(f.x1 - f.x0)), d = Math.max(1.5, toPx(f.z1 - f.z0));
        g.fillStyle = 'rgba(24,30,36,0.78)';
        g.fillRect(x, z, w, d);
        g.strokeStyle = 'rgba(210,225,240,0.28)';
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, z + 0.5, Math.max(0, w - 1), Math.max(0, d - 1));
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

    /**
     * 胶囊体移动（玩家/AI 共用）。obj 可以是 {pos:Vector3} 或 Vector3。
     * 只处理水平位移；y 仅在台阶抬升时改写，跳跃/重力仍由旧逻辑管理。
     */
    moveActor(obj, dx, dz) {
      const p = obj && obj.pos ? obj.pos : obj;
      if (!p) return null;
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
