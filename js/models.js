/* ============================================
 * 战地突击 · models.js — 士兵模型构建与克隆
 * 数据: models/soldier.glb（标准 glTF 2.0 二进制，由 server.js 通过 HTTP 提供）
 * 构建: 依赖 js/glb.js 解析 + AssetLoader 预加载；不再有 base64 内联数据
 * 失败回退: 任何异常 → ModelLib.ready=false，游戏继续用方块人
 * 开关: URL 加 ?legacy=1 强制方块人
 * ============================================ */
const ModelLib = {
  root: null, matsByName: {}, ready: false, failed: false, _err: '',
  PART_NAMES: ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'gun'],

  enabled() {
    return !/legacy=1/.test(location.search || '');
  },
  /** 加载士兵模型：从已预加载的 models/soldier.glb 构建（节点层级直接来自 glTF）。
   *  失败**不再**回退方块人 —— 记录错误并抛给调用方，由 main.js 显示红条。 */
  load() {
    if (this.ready) return Promise.resolve(this.root);
    if (this._loading) return this._loading;
    this._loading = (async () => {
      try {
        const g = (typeof AssetLoader !== 'undefined') && AssetLoader.soldier();
        if (!g) throw new Error('士兵模型未加载（models/soldier.glb）——请确认已启动 node server.js');
        const sceneRoot = GLB.scene(g, { castShadow: true, receiveShadow: true });
        if (!sceneRoot || !sceneRoot.children.length) throw new Error('soldier.glb 里没有可用的节点');
        // glTF 里 gun 已经是 armR 的子节点，层级不用重建；这里只收集部件引用
        const meshByName = {};
        sceneRoot.traverse(o => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            if (o.material && o.material.name) this.matsByName[o.name] = o.material;
          }
          // 关键：部件要取「节点组」而非 mesh。glTF 里 gun 是 armR 节点的子节点，
          // 只有旋转 armR 这个父节点，挂在其下的 gun 才会跟着动；取到 mesh 就断链了。
          if (this.PART_NAMES.includes(o.name) && !meshByName[o.name]) meshByName[o.name] = o;
        });
        const missing = this.PART_NAMES.filter(n => !meshByName[n]);
        if (missing.length) throw new Error('士兵模型缺少部件: ' + missing.join(',') + '（期望 7 个：' + this.PART_NAMES.join(',') + '）');
        // 校正：模型沿 z 站立且脚在 +z、头在 -z → 绕 X 旋转 +90° 头朝上（+z→-y 脚朝下）
        sceneRoot.rotation.x = Math.PI / 2;
        sceneRoot.scale.setScalar(1.8 / 1.9);
        this.root = sceneRoot;
        this.ready = true;
        this.failed = false;
        console.log('[ModelLib] 士兵模型构建完成，' + this.PART_NAMES.length + ' 部件（来自 soldier.glb）');
        return sceneRoot;
      } catch (e) {
        this.failed = true; this._err = e.message;
        console.error('[ModelLib] 士兵模型加载失败: ' + e.message);
        throw e;   // 让 main.js 的启动错误处理显示红条，不再静默降级
      }
    })();
    return this._loading;
  },
  // 为单位克隆实例：深拷贝几何 + 部件材质共享（7 材质只上传一次）
  cloneForUnit() {
    if (!this.ready || !this.root) return null;
    const c = this.root.clone(true);
    c.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        if (this.matsByName[o.name]) o.material = this.matsByName[o.name];
      }
    });
    const parts = {};
    c.traverse(o => { if (o.name && this.PART_NAMES.includes(o.name)) parts[o.name] = o; });
    return { scene: c, parts };
  },
  // ---- 武器模型（models/guns/<key>.glb；长轴旋转到 Z=枪口朝前，缩放到目标长度） ----
  WEAPON_LEN: { pistol: 0.42, rifle: 0.78, sniper: 1.1, shotgun: 0.9 },
  WEAPON_COLOR: { pistol: 0x4a4f55, rifle: 0x4a4d52, sniper: 0x4a4d52, shotgun: 0x4a4e54 },
  buildWeaponMesh(key) {
    const g = (typeof AssetLoader !== 'undefined') ? AssetLoader.weapon(key) : null;
    if (!g) return null;
    try {
      const geo = GLB.firstGeometry(g);
      geo.computeBoundingBox();
      const sz = geo.boundingBox.getSize(new THREE.Vector3());
      // 精确定向（makeBasis 指定轴目标方向，替代 rotateX/rotateY 猜测）：
      // 目标：枪管朝 -Z（相机前向）、枪高朝 +Y（上）、枪厚朝 X（左右）
      // 数据约定：长轴负端 = 枪口（用户实测 rifle/pistol 长轴正端是枪托）
      if (sz.y >= sz.x && sz.y >= sz.z) {
        geo.applyMatrix4(new THREE.Matrix4().makeBasis(
          new THREE.Vector3(1, 0, 0),   // 原 x(厚) → +X
          new THREE.Vector3(0, 0, 1),   // 原 y(长, +y=枪托) → +Z 后
          new THREE.Vector3(0, -1, 0)   // 原 z(高, 正端=握把底部) → -Y 下
        ));
      } else if (sz.x >= sz.z) {
        // 注意：原版本用 (+X) 作为 y 轴目标，det = -1（镜像/反射），会把三角面绕序翻转，
        // 几何体变成"里朝外"——默认 FrontSide 材质下只渲染背面（用户所见"只渲染了反面"）。
        // 这里改用 -X 作为 y 轴目标，使基矩阵 det = +1（真正的旋转，保持右手系），
        // 枪管仍朝 -Z（前向）、握把底朝下，仅左右镜像，消除里朝外问题。
        geo.applyMatrix4(new THREE.Matrix4().makeBasis(
          new THREE.Vector3(0, 0, 1),   // 原 x(长, +x=枪托) → +Z 后
          new THREE.Vector3(-1, 0, 0),  // 原 y(厚) → -X 左右（修正反射，保持右手系）
          new THREE.Vector3(0, -1, 0)   // 原 z(高, 正端=握把底部) → -Y 下
        ));
      }
      geo.computeBoundingBox();
      const sz2 = geo.boundingBox.getSize(new THREE.Vector3());
      // DoubleSide：武器几何来自 trimesh 烘焙，个别面绕序可能不一致；用 FrontSide 时这些面会被
      // 剔除造成"缺面/只渲染反面"。强制双面渲染，保证枪身完整可见（步枪/手枪/狙击/霰弹统一）。
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: this.WEAPON_COLOR[key] || 0x2a2d33, side: THREE.DoubleSide }));
      mesh.scale.setScalar((this.WEAPON_LEN[key] || 0.6) / sz2.z);
      mesh.castShadow = true;
      return mesh;
    } catch (e) {
      console.warn('[ModelLib] 武器 ' + key + ' 构建失败: ' + e.message);
      return null;
    }
  }
};

// 计算机匣顶 Y：取身体所有顶点 Y 的第 75 百分位，去掉顶部 25% 尖刺(瞄具/枪管)，
// 得到"接收机/机匣"真实顶高。各枪比例一致，狙击/霰弹不会被瞄具顶拉高。
function receiverTopY(inner) {
  const ys = [];
  const v = new THREE.Vector3();
  inner.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(inner.matrixWorld).invert();
  inner.traverse((o) => {
    if (o.isMesh && o.name !== 'bolt' && o.geometry && o.geometry.attributes.position) {
      o.updateWorldMatrix(true, false);
      const m = new THREE.Matrix4().copy(inv).multiply(o.matrixWorld);
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m);
        ys.push(v.y);
      }
    }
  });
  if (!ys.length) return 0;
  ys.sort((a, b) => a - b);
  return ys[Math.floor(0.75 * (ys.length - 1))];
}

/* ============================================
 * buildRealWeapon — 枪身用游戏原生精细模型(models/guns/<key>.glb)，仅叠加玩家真实枪栓
 * 之前把整枪换成 trimesh 拼的 GLB，看起来像拆散的方块；现改回精细枪身 + 真实枪栓。
 * 枪栓几何来自 models/guns/<key>_bolt.glb（HTTP 加载，AssetLoader 预加载）。
 * 返回 Group(root > wapanim_inner > [body, bolt])：
 *   - body：ModelLib.buildWeaponMesh(key)，游戏自带精细武器模型
 *   - bolt（name='bolt'）：玩家做的真实 _bolt.glb，小型化后嵌在机匣右侧偏后，由 WeaponAnim 驱动
 *   - wapanim_inner 供换弹时整体下沉（不干扰 combat.js 对 root 的 HIP/ADS 控制）
 * 失败回退：body 构建失败 → 返回 null，由 combat.js 退回程序化方块枪
 * ============================================ */
function buildRealWeapon(key) {
  if (typeof ModelLib === 'undefined' || !ModelLib.enabled()) return null;
  const bodyMesh = ModelLib.buildWeaponMesh(key);
  if (!bodyMesh) return null;
  const inner = new THREE.Group();
  inner.name = 'wapanim_inner';
  inner.add(bodyMesh);
  const root = new THREE.Group();
  root.add(inner);

  // 枪身包围盒（含缩放），用于定位枪栓
  bodyMesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(bodyMesh);
  if (box.isEmpty()) return root; // 无几何，至少返回枪身
  const center = new THREE.Vector3(); box.getCenter(center);
  const size = new THREE.Vector3(); box.getSize(size);

  // 叠加玩家真实枪栓（models/guns/<key>_bolt.glb）
  const boltGlb = (typeof AssetLoader !== 'undefined') ? AssetLoader.bolt(key) : null;
  if (boltGlb) {
    try {
      const boltGeo = GLB.firstGeometry(boltGlb);
      boltGeo.computeVertexNormals();
      // 以枪栓自身质心居中，便于独立定位
      boltGeo.computeBoundingBox();
      const bc = new THREE.Vector3(); boltGeo.boundingBox.getCenter(bc);
      boltGeo.translate(-bc.x, -bc.y, -bc.z);
      // 非均匀缩放：整体缩小，长度占枪长 ~0.28，横截面(X/Y)约机匣的 0.20，
      // 做成机匣右侧一枚小拉机柄/枪栓钮，避免大滑块挡住中央视野。
      boltGeo.computeBoundingBox();
      const bsz = new THREE.Vector3(); boltGeo.boundingBox.getSize(bsz);
      const sz = (size.z * 0.28) / (bsz.z || 1e-3);          // 长向
      let sx = (size.x * 0.20) / (bsz.x || 1e-3);            // 宽向
      let sy = (size.y * 0.20) / (bsz.y || 1e-3);            // 高向
      const clamp = (v) => Math.min(Math.max(v, sz * 0.3), sz * 2.5); // 防止极端拉伸
      sx = clamp(sx); sy = clamp(sy);
      boltGeo.scale(sx, sy, sz);
      boltGeo.computeVertexNormals();
      boltGeo.computeBoundingBox();
      let bs2 = new THREE.Vector3(); boltGeo.boundingBox.getSize(bs2);

      // 狙击枪 _bolt.glb 原始是零厚度平板（Y 向 extent≈0），直接缩放无法产生厚度。
      // 这里用顶点变换补出最小 Y 厚度，让平板变成立体块，避免"方向躺平/缺半边"。
      const minThk = size.y * 0.06;
      if (bs2.y < minThk) {
        const pos = boltGeo.attributes.position;
        const thk = minThk;
        for (let i = 0; i < pos.count; i++) {
          const y = pos.getY(i);
          const x = pos.getX(i);
          // 以 X 中线为界把平板折成有厚度的脊（上半+，下半-），形成立体感
          pos.setY(i, y + (x >= 0 ? thk / 2 : -thk / 2));
        }
        pos.needsUpdate = true;
        boltGeo.computeVertexNormals();
        boltGeo.computeBoundingBox();
        bs2 = new THREE.Vector3(); boltGeo.boundingBox.getSize(bs2);
      }

      // DoubleSide：枪栓来自 trimesh 布尔拼装，面朝向可能不一致，
      // 用默认 FrontSide 会把背面剔除造成"缺半边"，这里强制双面渲染。
      const boltMesh = new THREE.Mesh(boltGeo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      boltMesh.castShadow = true;
      boltMesh.name = 'bolt';
      // 摆放：机匣右侧偏后。锚点用"机匣顶"(身体顶点 75 百分位) —— 狙击/霰弹不会被
      // 瞄具顶拉高，手枪/步枪也不会因压到中心而埋进枪身。枪栓底部坐在机匣顶、外露一半。
      const recvTop = receiverTopY(inner);
      boltMesh.position.set(
        center.x + size.x * 0.22,                  // 偏右，避开屏幕中央视野
        recvTop + bs2.y * 0.5,                     // 钉在机匣顶、外露一半，清晰可见
        center.z + size.z * 0.05                   // 偏后，像拉机柄
      );
      boltMesh.userData.travel = size.z * 0.10; // 拉栓行程 ~10% 枪长
      inner.add(boltMesh);
    } catch (e) {
      console.warn('[buildRealWeapon] 枪栓挂载失败: ' + e.message);
    }
  }
  return root;
}
// base64 → 类型数组（小端 float32 / uint16）
function f32FromB64(b64) {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Float32Array(buf);
}
function u16FromB64(b64) {
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Uint16Array(buf);
}

/* ============================================
 * BuildingLib — 模型建筑（用户 SCAD → GLB → 内联数据）
 * 数据: models/buildings/<key>.glb（标准 glTF 二进制，带顶点色）
 * 碰撞: 每栋建筑配置碰撞盒列表（SCAD 门洞留空 → 能进门），AABB 格式与 World.colliders 一致
 * 平台: 屋顶/塔台可站立（进入 World.platforms）
 * 坐标: SCAD cube([w,d,h]) 无 center → 模型原点在建筑角
 *       模型轴: x=宽(w) y=深(d) z=高(h)  →  世界轴: x→x, y→z(深), z→y(高)
 * ============================================ */
const BuildingLib = {
  /* v3.2 尺寸契约：GLB extras.battlegame.dims 是单一事实源（AssetLoader.buildingMeta）。
   * 本表为「无 extras 的旧模型」回退值；World.syncBuildingMeta() 会在加载时用 GLB 元数据覆盖。
   * 约定：地图只写 scale（等比系数，缺省 1.0）→ 结构上杜绝非等比拉伸。 */
  REAL_DIMS: {
    apartment: { w: 12.4, d: 11.02, h: 7.58 },
    house: { w: 10.8, d: 8.59, h: 6.32 },
    house_small: { w: 8.38, d: 7.38, h: 3.57 },
    warehouse: { w: 14.34, d: 10.7, h: 6.14 },
    watchtower: { w: 4.2, d: 4.2, h: 8.5 },
    cover: { w: 14.15, d: 5.74, h: 2.1 },
    bunker: { w: 12.4, d: 7.58, h: 4.49 },
    hangar: { w: 40, d: 24, h: 12 },
    pillbox: { w: 12, d: 12, h: 5 },
    tower: { w: 18.6, d: 18.6, h: 100 },
    wall: { w: 37.5, d: 1.4, h: 4.8 },
    bridge: { w: 30, d: 7, h: 10 },
    stairs: { w: 12, d: 12, h: 13 },
    container: { w: 16.2, d: 8.4, h: 5 },
    ruins: { w: 33, d: 16, h: 28.5 },
    base: { w: 86.55, d: 66.68, h: 11.8 },
    refinery: { w: 193, d: 184.5, h: 45.5 },
    stadium: { w: 220, d: 220, h: 32 },
    megatower: { w: 36, d: 36, h: 145.48 },
    complex: { w: 120, d: 80, h: 48 },      // v1.8 超大型综合体（desert 巨无霸，占地 9600㎡）
    /* v1.6 程序化主题建筑（PROC_GEOS 生成几何 + CONFIGS 碰撞；预留 GLB 插槽供用户建模升级） */
    crane: { w: 26, d: 10, h: 16 },        // 龙门吊（港口装卸区标志）
    tankH: { w: 20, d: 9, h: 8 },          // 卧式油罐（炼油区/补给站）
    tankV: { w: 10, d: 10, h: 12 },        // 立式油罐（储油区）
    mast: { w: 6, d: 6, h: 20 },           // 桁架天线塔（荒漠信号/观察）
    guardhouse: { w: 4.18, d: 3.98, h: 3.35 }, // 岗亭（导入 Kit）
    farmhouse: { w: 10.45, d: 10.04, h: 6.22 },
    workshop: { w: 14.65, d: 11.54, h: 6.3 },
    pumpstation: { w: 11.29, d: 8.45, h: 5.51 },
    estate: { w: 80, d: 60, h: 8.5 }
  },

  /* 按等比系数取摆放尺寸；key 未登记则返回 null */
  dimsFor(key, scale) {
    const k = (typeof scale === 'number' && scale > 0) ? scale : 1;
    const m = (typeof AssetLoader !== 'undefined' && AssetLoader.buildingMeta) ? AssetLoader.buildingMeta(key) : null;
    const r = (m && m.dims) || this.REAL_DIMS[key];
    if (!r) return null;
    return { w: r.w * k, d: r.d * k, h: r.h * k };
  },

  /* 校验显式 w/d/h 是否等比（返回最大轴偏差百分比；无真值登记返回 0） */
  aspectDeviation(key, dims) {
    const r = this.REAL_DIMS[key];
    if (!r || !dims || !dims.w || !dims.d || !dims.h) return 0;
    const kx = dims.w / r.w, ky = dims.h / r.h, kz = dims.d / r.d;
    const mn = Math.min(kx, ky, kz), mx = Math.max(kx, ky, kz);
    return mn > 0 ? (mx / mn - 1) * 100 : 0;
  },

  // 每栋建筑：碰撞盒（模型坐标 [x0, y0(深), z0(高), x1, y1(深), z1(高)]）+ 平台（宽/深/高）
  CONFIGS: {
    apartment: { // 16×12×19.1 公寓：后向门洞 2.4×2.6 居中；1.0m 实体墙（v1.6，防 A* 穿墙/墙缝透弹）；楼板 z=4/8/12；屋顶平台
      colliders: [
        // 前墙(y=12 深面，厚 1.0) 完整
        [0, 11, 0, 16, 12, 16],
        // 后墙(y=0，厚 1.0)：门洞 x[6.8,9.2] 高 z[0,2.6] → 三段
        [0, 0, 0, 6.8, 1, 16], [9.2, 0, 0, 16, 1, 16], [6.8, 0, 2.6, 9.2, 1, 16],
        // 左右墙 x=0 / x=16（厚 1.0）
        [0, 0, 0, 1, 12, 16], [15, 0, 0, 16, 12, 16],
        // 楼板 z=4/8/12（0.3 厚）
        [0, 0, 3.85, 16, 12, 4.15], [0, 0, 7.85, 16, 12, 8.15], [0, 0, 11.85, 16, 12, 12.15],
        // 屋顶 z=16（0.6 厚）
        [0, 0, 16, 16, 12, 16.6]
      ],
      platforms: [{ x0: 0, x1: 16, y0: 0, y1: 12, y: 16.6 }]
    },
    house: { // 10.6×8.6×4.3 民居：后向门洞 2.0×2.2；1.0m 实体墙；窗洞不拦；人字顶
      colliders: [
        [0, 7.6, 0, 10.6, 8.6, 4], // 前墙(y=8.6，厚 1.0)
        [0, 0, 0, 4.3, 1, 4], [6.3, 0, 0, 10.6, 1, 4], [4.3, 0, 2.2, 6.3, 1, 4], // 后墙门洞 2.0m
        [0, 0, 0, 1, 8.6, 4], [9.6, 0, 0, 10.6, 8.6, 4], // 左右墙（厚 1.0）
        [0, 0, 4, 10.6, 8.6, 4.3] // 屋顶封盖（碰撞平顶，视觉人字顶在上）
      ]
    },
    warehouse: { // 22×14×9.7 仓库：卷帘门 4.8×5.4 后向；1.0m 实体墙；高窗不拦
      colliders: [
        [0, 13, 0, 22, 14, 8], // 前墙(y=14，厚 1.0)
        [0, 0, 0, 8.6, 1, 8], [13.4, 0, 0, 22, 1, 8], [8.6, 0, 5.4, 13.4, 1, 8], // 后墙卷帘门
        [0, 0, 0, 1, 14, 8], [21, 0, 0, 22, 14, 8], // 左右墙（厚 1.0）
        [0, 0, 8, 22, 14, 8.5] // 屋顶
      ],
      platforms: [{ x0: 0, x1: 22, y0: 0, y1: 14, y: 8.5 }]
    },
    watchtower: { // 4.2×4.2 瞭望塔：四腿 + 平台 z=7 + 栏杆（v1.6 对齐真实几何 4.2，原 4.0 留 0.2m 墙缝）
      colliders: [
        [0, 0, 0, 0.4, 0.4, 7], [3.8, 0, 0, 4.2, 0.4, 7],
        [0, 0, 3.8, 0.4, 4.2, 7], [3.8, 0, 3.8, 4.2, 4.2, 7],
        [0, 0, 7, 4.2, 4.2, 7.4], // 平台
        [0, 0, 7.4, 4.2, 0.3, 8.5], [0, 3.9, 7.4, 4.2, 4.2, 8.5], // 前后栏杆
        [0, 0, 7.4, 0.3, 4.2, 8.5], [3.9, 0, 7.4, 4.2, 4.2, 8.5] // 左右栏杆
      ],
      platforms: [{ x0: 0, x1: 4.2, y0: 0, y1: 4.2, y: 7.4 }]
    },
    cover: { // 掩体组（集装箱/木箱/沙袋/路障）— 低矮
      // v1.6：几何 D-04 归一化把 y 从 -0.6 平移到 0 → 碰撞盒整体 +0.6 对齐真实摆放（路障唇边不再悬空偏移）
      colliders: [
        // 集装箱 6×2.5×2.6 ×2（SCAD translate(0,0),(0,3.2)）
        [0, 0.6, 0, 6, 3.1, 2.6], [0, 3.8, 0, 6, 6.3, 2.6],
        // 木箱 1.3³ ×2 (7.5,0) (9.1,0)
        [7.5, 0.6, 0, 8.8, 1.9, 1.3], [9.1, 0.6, 0, 10.4, 1.9, 1.3],
        // 沙袋堆 (7.5,1.6) 2×3×0.5
        [7.5, 2.2, 0, 10.7, 3.4, 0.5],
        // 路障 3×0.6×1.1 ×2 (11.5,-0.6) (11.5,1.0)
        [11.5, 0, 0, 14.5, 0.6, 1.1], [11.5, 1.6, 0, 14.5, 2.2, 1.1]
      ]
    },

    /* ============ v1.2 新增类型（models/buildings/*.glb）============
     * 尺寸与 GLB 一致（见 tools/glb2bldg_out.js 探测输出）；坐标系：x[0,w] y[0,d](深) z[0,h](高)，
     * 门洞留空（能进门）、屋顶/平台可站（进入 World.platforms）。
     * 注：tower/ruins 的高柱体为纯视觉（碰撞只到平台/残墙高，避免 100m/28m 实体把导航封死）。 */
    bunker: { // 18×14×8 混凝土碉堡：后向门洞 2.2×2.6，1.0m 实体墙（v1.6 防穿墙），屋顶平台
      colliders: [
        [0, 13, 0, 18, 14, 8],                                                  // 前墙（厚 1.0）
        [0, 0, 0, 7.9, 1, 8], [10.1, 0, 0, 18, 1, 8], [7.9, 0, 2.6, 10.1, 1, 8], // 后墙门洞
        [0, 0, 0, 1, 14, 8], [17, 0, 0, 18, 14, 8],                             // 左右墙（厚 1.0）
        [0, 0, 8, 18, 14, 8.4]                                                  // 屋顶
      ],
      platforms: [{ x0: 0, x1: 18, y0: 0, y1: 14, y: 8.4 }]
    },
    hangar: { // 40×24×12 机库：前向卷帘门 8×7，1.0m 实体墙，屋顶平台
      colliders: [
        [0, 23, 0, 16, 24, 12], [24, 23, 0, 40, 24, 12], [16, 23, 7, 24, 24, 12], // 前墙卷帘门（厚 1.0）
        [0, 0, 0, 40, 1, 12],                                                     // 后墙（厚 1.0）
        [0, 0, 0, 1, 24, 12], [39, 0, 0, 40, 24, 12],                             // 左右墙（厚 1.0）
        [0, 0, 12, 40, 24, 12.6]                                                  // 屋顶
      ],
      platforms: [{ x0: 0, x1: 40, y0: 0, y1: 24, y: 12.6 }]
    },
    pillbox: { // 12×12×5 哨楼：后向门洞 2.0×2.2，1.0m 实体墙，屋顶平台
      colliders: [
        [0, 11, 0, 12, 12, 5],                                                    // 前墙（厚 1.0）
        [0, 0, 0, 5, 1, 5], [7, 0, 0, 12, 1, 5], [5, 0, 2.2, 7, 1, 5],             // 后墙门洞
        [0, 0, 0, 1, 12, 5], [11, 0, 0, 12, 12, 5],                               // 左右墙（厚 1.0）
        [0, 0, 5, 12, 12, 5.4]                                                    // 屋顶
      ],
      platforms: [{ x0: 0, x1: 12, y0: 0, y1: 12, y: 5.4 }]
    },
    tower: { // 18.6×18.6×100 摩天楼（battle_tower.scad：实心楼体 18×18×70 + 两级退台 + 天线）
      // v1.5 修正：旧配置写成「四腿+观景平台」，与实体楼体几何不符 → 玩家/子弹能穿墙。
      //           现按真实几何给实心碰撞；天线（z≥90）纯视觉不拦。
      colliders: [
        [0.3, 0.3, 0, 18.3, 18.3, 70],      // 主楼体（含窗台外凸 0.3）
        [2.3, 2.3, 70, 16.3, 16.3, 82],     // 退台一 14×14×12
        [4.3, 4.3, 82, 14.3, 14.3, 90]      // 退台二 10×10×8
      ],
      platforms: [
        { x0: 0.3, x1: 18.3, y0: 0.3, y1: 18.3, y: 70 },
        { x0: 2.3, x1: 16.3, y0: 2.3, y1: 16.3, y: 82 }
      ]
    },
    wall: { // 37.5×1.4×4.8 围墙：中段留 5m 门洞（两段墙）
      colliders: [
        [0, 0, 0, 16.25, 1.4, 4.8],
        [21.25, 0, 0, 37.5, 1.4, 4.8]
      ]
    },
    bridge: { // 30×7×10 过街桥：两端桥墩 + 桥面 + 栏杆；桥下可通行，桥面可站
      colliders: [
        [0, 0, 0, 1.2, 7, 9.6], [28.8, 0, 0, 30, 7, 9.6],                        // 桥墩
        [0, 0, 9.6, 30, 7, 10],                                                  // 桥面
        [0, 0, 10, 30, 0.5, 10.8], [0, 6.5, 10, 30, 7, 10.8],                     // 前后栏杆
        [0, 0, 10, 0.5, 7, 10.8], [29.5, 0, 10, 30, 7, 10.8]                      // 左右栏杆
      ],
      platforms: [{ x0: 0, x1: 30, y0: 0, y1: 7, y: 10 }]
    },
    // 12×12×13 阶梯塔（battle_stairs.scad：楼板 z=0/3/6/9 各 0.5 厚 + 4 段直跑梯 6级×0.5升 + 顶护栏 z=12）
    // v1.5 修正：旧配置是 4 个 3.25m 高的实心整层盒 —— 台阶高度远超 STEP_H(0.8) 与跳跃上限，
    //           玩家根本爬不上去（桥面因此永远够不到）。现按真实几何拆成「楼板(挖梯井) + 逐级踏步」。
    //           可站顶面 = z=9 楼板顶 9.5 → 与 bridge 桥面 10.0 相差 0.5，正好一步跨上（见地图桥梯衔接）。
    stairs: (function () {
      const C = [];
      // 四角立柱 0.4×0.4×12
      for (const px of [0, 11.6]) for (const py of [0, 11.6]) C.push([px, py, 0, px + 0.4, py + 0.4, 12]);
      // 楼板 z=0/3/6/9（0.5 厚）；z>0 的楼板挖出梯井 x[5.8,9.2] y[1.8,8.2]（对齐梯段，否则爬到一半顶到天花板）
      const HX0 = 5.8, HX1 = 9.2, HY0 = 1.8, HY1 = 8.2;
      for (const z of [0, 3, 6, 9]) {
        if (z === 0) { C.push([0, 0, 0, 12, 12, 0.5]); continue; }
        C.push([0, 0, z, HX0, 12, z + 0.5]);          // 梯井西侧
        C.push([HX1, 0, z, 12, 12, z + 0.5]);         // 梯井东侧
        C.push([HX0, 0, z, HX1, HY0, z + 0.5]);       // 梯井南侧
        C.push([HX0, HY1, z, HX1, 12, z + 0.5]);      // 梯井北侧
      }
      // 梯段：x[6,9]，每级 3×1.2×0.5，交替方向（flip）
      [[0, false], [3, true], [6, false], [9, true]].forEach(function (r) {
        const z0 = r[0], flip = r[1];
        for (let i = 0; i <= 5; i++) {
          const y0 = 2 + (flip ? (5 - i) : i) * 1.2;
          C.push([6, y0, z0 + i * 0.5, 9, y0 + 1.2, z0 + i * 0.5 + 0.5]);
        }
      });
      // 顶护栏 z=12~13（挡住失足，不影响通行）
      C.push([0, 0, 12, 12, 0.4, 13], [0, 11.6, 12, 12, 12, 13],
        [0, 0, 12, 0.4, 12, 13], [11.6, 0, 12, 12, 12, 13]);
      return {
        colliders: C,
        platforms: [
          { x0: 0, x1: 12, y0: 0, y1: 12, y: 0.5 },
          { x0: 0, x1: 12, y0: 0, y1: 12, y: 3.5 },
          { x0: 0, x1: 12, y0: 0, y1: 12, y: 6.5 },
          { x0: 0, x1: 12, y0: 0, y1: 12, y: 9.5 }
        ]
      };
    })(),
    container: { // 16.2×8.4×5 货柜组：左右两列双层，中央 2.6~5.8 深通道
      colliders: [
        [0, 0, 0, 8, 2.6, 2.6], [0, 5.8, 0, 8, 8.4, 2.6],
        [0, 0, 2.6, 8, 2.6, 5], [0, 5.8, 2.6, 8, 8.4, 5],
        [9, 0, 0, 16.2, 2.6, 2.6], [9, 5.8, 0, 16.2, 8.4, 2.6],
        [9, 0, 2.6, 16.2, 2.6, 5], [9, 5.8, 2.6, 16.2, 8.4, 5]
      ],
      platforms: [
        { x0: 0, x1: 8, y0: 0, y1: 2.6, y: 5 }, { x0: 0, x1: 8, y0: 5.8, y1: 8.4, y: 5 },
        { x0: 9, x1: 16.2, y0: 0, y1: 2.6, y: 5 }, { x0: 9, x1: 16.2, y0: 5.8, y1: 8.4, y: 5 }
      ]
    },
    ruins: { // 33×16×28.5 残楼：底部碎石沿 + 四向残墙 + 高残塔（碰撞只到 12m，顶部纯视觉）
      colliders: [
        [0, 0, 0, 33, 1.2, 1.0],
        [0, 0, 0, 1.2, 16, 9], [31.8, 0, 0, 33, 16, 7],
        [0, 0, 0, 14, 0.8, 4], [19, 0, 0, 33, 0.8, 5],
        [14, 0, 4, 18, 1.5, 4.8],
        [6, 0, 8, 9, 2.2, 12], [24, 0, 7, 27, 2.0, 10]
      ]
    },

        /* ============ v1.4 四地标（models/buildings/*.glb）— 碰撞箱按 SCAD 源码编写 ============
     * 坐标系 x[0,w] y[0,d](深) z[0,h](高)，尺寸 = 归一化 GLB bbox（tools/glb2bldg_out.js 探测输出）；
     * 运行时按地图 w/d/h 缩放（碰撞尺寸以地图数据为准），门洞留空、平台可站。
     * 全部可进入（真实门洞 + 内部中空 + 楼板楼梯井），由 battle_*.scad 可进入版编译：
     *   - base 前哨基地（GLB 223×184×65）：围墙四门 + 中央 HQ(3层迷宫) + 3营房 + 2机库 + 4哨塔（可爬）
     *   - refinery 炼油厂（GLB 193×184.5×45.5）：主厂房前向大门 + catwalk 检修层 + 2冷却塔 + 3烟囱
     *   - stadium 竞技场（GLB 220×220×32）：外壳环 4 径向隧道门（可进场内 / 场地 / 看台下通道）
     *   - megatower 巨塔（GLB 36×36×145.5）：前墙大门 + 11层楼板(中央楼梯井) + 奇偶层隔间迷宫（可逐层登顶）
     * 注：垂直爬行依赖游戏楼梯/平台机制；碰撞盒为 AABB 近似（圆形 stadium/冷却塔用外接方墙近似）。 */
    base: { // 碰撞箱按 SCAD 编写（103 盒 / 平台 11）：真实门洞 + 内部中空 + 楼板楼梯井
      // v1.5：battle_base.scad 末尾 tank_farm() 用 rotate([0,90,0]) 卧放油罐（r=6），几何伸到 z=-6，
      //       GLB 归一化把整栋楼抬高了 6 —— 基地地坪其实在模型 z=6（碰撞盒 z 全带 +6 偏移）。
      //       sink=6 表示「模型 z=6 才是地坪」：几何下沉 6·sy，碰撞/平台同步减 6（油罐半埋进沙里）。
      sink: 6,
      // v1.8：四面围墙门洞加宽 12→22（scale0.4 后世界宽 8.8m，≥3 nav cells 净空）
      colliders: [
        [1.5, 1.5, 6, 40.5, 4.5, 15],
        [62.5, 1.5, 6, 96.5, 4.5, 15],
        [40.5, 1.5, 14, 62.5, 4.5, 15],
        [106.5, 1.5, 6, 201.5, 4.5, 15],
        [1.5, 178.5, 6, 40.5, 181.5, 15],
        [62.5, 178.5, 6, 96.5, 181.5, 15],
        [40.5, 178.5, 14, 62.5, 181.5, 15],
        [106.5, 178.5, 6, 201.5, 181.5, 15],
        [1.5, 1.5, 6, 4.5, 36.5, 15],
        [1.5, 58.5, 6, 4.5, 86.5, 15],
        [1.5, 36.5, 14, 4.5, 58.5, 15],
        [1.5, 96.5, 6, 4.5, 181.5, 15],
        [218.5, 1.5, 6, 221.5, 36.5, 15],
        [218.5, 58.5, 6, 221.5, 86.5, 15],
        [218.5, 36.5, 14, 221.5, 58.5, 15],
        [218.5, 96.5, 6, 221.5, 181.5, 15],
        [91.5, 76.5, 6, 108.5, 78.5, 34],
        [114.5, 76.5, 6, 131.5, 78.5, 34],
        [108.5, 76.5, 12, 114.5, 78.5, 34],
        [91.5, 104.5, 6, 108.5, 106.5, 34],
        [114.5, 104.5, 6, 131.5, 106.5, 34],
        [108.5, 104.5, 12, 114.5, 106.5, 34],
        [91.5, 76.5, 6, 93.5, 88.5, 34],
        [91.5, 94.5, 6, 93.5, 106.5, 34],
        [91.5, 88.5, 12, 93.5, 94.5, 34],
        [129.5, 76.5, 6, 131.5, 88.5, 34],
        [129.5, 94.5, 6, 131.5, 106.5, 34],
        [129.5, 88.5, 12, 131.5, 94.5, 34],
        [91.5, 76.5, 14, 93.5, 106.5, 15],
        [99.5, 76.5, 14, 131.5, 106.5, 15],
        [93.5, 76.5, 14, 99.5, 78.5, 15],
        [93.5, 84.5, 14, 99.5, 106.5, 15],
        [91.5, 76.5, 23, 93.5, 106.5, 24],
        [99.5, 76.5, 23, 131.5, 106.5, 24],
        [93.5, 76.5, 23, 99.5, 78.5, 24],
        [93.5, 84.5, 23, 99.5, 106.5, 24],
        [91.5, 76.5, 33, 131.5, 106.5, 34],
        [111.5, 76.5, 6, 112.5, 82.5, 33],
        [111.5, 85.5, 6, 112.5, 106.5, 33],
        [111.5, 82.5, 12, 112.5, 85.5, 33],
        [91.5, 91.5, 6, 115.5, 92.5, 33],
        [118.5, 91.5, 6, 131.5, 92.5, 33],
        [115.5, 91.5, 12, 118.5, 92.5, 33],
        [13.5, 43.5, 6, 36.5, 45.5, 18],
        [42.5, 43.5, 6, 65.5, 45.5, 18],
        [36.5, 43.5, 12, 42.5, 45.5, 18],
        [13.5, 55.5, 6, 36.5, 57.5, 18],
        [42.5, 55.5, 6, 65.5, 57.5, 18],
        [36.5, 55.5, 12, 42.5, 57.5, 18],
        [13.5, 43.5, 6, 15.5, 48.5, 18],
        [13.5, 54.5, 6, 15.5, 57.5, 18],
        [13.5, 48.5, 12, 15.5, 54.5, 18],
        [63.5, 43.5, 6, 65.5, 48.5, 18],
        [63.5, 54.5, 6, 65.5, 57.5, 18],
        [63.5, 48.5, 12, 65.5, 54.5, 18],
        [13.5, 43.5, 17, 65.5, 57.5, 18],
        [151.5, 43.5, 6, 174.5, 45.5, 18],
        [180.5, 43.5, 6, 203.5, 45.5, 18],
        [174.5, 43.5, 12, 180.5, 45.5, 18],
        [151.5, 55.5, 6, 174.5, 57.5, 18],
        [180.5, 55.5, 6, 203.5, 57.5, 18],
        [174.5, 55.5, 12, 180.5, 57.5, 18],
        [151.5, 43.5, 6, 153.5, 48.5, 18],
        [151.5, 54.5, 6, 153.5, 57.5, 18],
        [151.5, 48.5, 12, 153.5, 54.5, 18],
        [201.5, 43.5, 6, 203.5, 48.5, 18],
        [201.5, 54.5, 6, 203.5, 57.5, 18],
        [201.5, 48.5, 12, 203.5, 54.5, 18],
        [151.5, 43.5, 17, 203.5, 57.5, 18],
        [13.5, 136.5, 6, 36.5, 138.5, 18],
        [42.5, 136.5, 6, 65.5, 138.5, 18],
        [36.5, 136.5, 12, 42.5, 138.5, 18],
        [13.5, 148.5, 6, 36.5, 150.5, 18],
        [42.5, 148.5, 6, 65.5, 150.5, 18],
        [36.5, 148.5, 12, 42.5, 150.5, 18],
        [13.5, 136.5, 6, 15.5, 141.5, 18],
        [13.5, 147.5, 6, 15.5, 150.5, 18],
        [13.5, 141.5, 12, 15.5, 147.5, 18],
        [63.5, 136.5, 6, 65.5, 141.5, 18],
        [63.5, 147.5, 6, 65.5, 150.5, 18],
        [63.5, 141.5, 12, 65.5, 147.5, 18],
        [13.5, 136.5, 17, 65.5, 150.5, 18],
        [151.5, 147.5, 6, 165.5, 149.5, 22],
        [183.5, 147.5, 6, 197.5, 149.5, 22],
        [165.5, 147.5, 17, 183.5, 149.5, 22],
        [151.5, 119.5, 6, 197.5, 121.5, 22],
        [151.5, 119.5, 6, 153.5, 149.5, 22],
        [195.5, 119.5, 6, 197.5, 149.5, 22],
        [151.5, 119.5, 21, 197.5, 149.5, 22],
        [61.5, 149.5, 6, 75.5, 151.5, 22],
        [93.5, 149.5, 6, 107.5, 151.5, 22],
        [75.5, 149.5, 17, 93.5, 151.5, 22],
        [61.5, 121.5, 6, 107.5, 123.5, 22],
        [61.5, 121.5, 6, 63.5, 151.5, 22],
        [105.5, 121.5, 6, 107.5, 151.5, 22],
        [61.5, 121.5, 21, 107.5, 151.5, 22],
        [1.5, 1.5, 6, 5.5, 5.5, 18],
        [217.5, 1.5, 6, 221.5, 5.5, 18],
        [1.5, 178.5, 6, 5.5, 182.5, 18],
        [217.5, 178.5, 6, 221.5, 182.5, 18],
        [187.5, 89.5, 6, 191.5, 93.5, 56],
        [95.5, 135.5, 6, 107.5, 147.5, 20],
        [113.5, 135.5, 6, 125.5, 147.5, 20],
      ],
      platforms: [
        { x0: 91.5, x1: 131.5, y0: 76.5, y1: 106.5, y: 33 },
        { x0: 91.5, x1: 131.5, y0: 76.5, y1: 106.5, y: 24 },
        { x0: 13.5, x1: 65.5, y0: 43.5, y1: 57.5, y: 17 },
        { x0: 151.5, x1: 203.5, y0: 43.5, y1: 57.5, y: 17 },
        { x0: 13.5, x1: 65.5, y0: 136.5, y1: 150.5, y: 17 },
        { x0: 151.5, x1: 197.5, y0: 119.5, y1: 149.5, y: 21 },
        { x0: 61.5, x1: 107.5, y0: 121.5, y1: 151.5, y: 21 },
        { x0: 0.5, x1: 6.5, y0: 0.5, y1: 6.5, y: 18 },
        { x0: 216.5, x1: 222.5, y0: 0.5, y1: 6.5, y: 18 },
        { x0: 0.5, x1: 6.5, y0: 177.5, y1: 183.5, y: 18 },
        { x0: 216.5, x1: 222.5, y0: 177.5, y1: 183.5, y: 18 },
      ]
    }
,
    refinery: { // 碰撞箱按 SCAD 编写（19 盒 / 平台 3）：真实门洞 + 内部中空 + 楼板楼梯井
      // v1.8：删 x=127 两根挡门立柱（21→19 盒）+ 门洞加宽 x[119,143] 高 9
      colliders: [
        [97, 87.7, 0, 167, 89.7, 22],
        // 后墙 y=125.7：主大门 x[119,143] 宽 24 高 9（v1.8 加宽+加高：scale0.3 后世界宽 7.2m ≥3 nav cells、
        //       门楣 2.7m ≥ nav 跳过阈值 2.6 —— 修复「取整污染 + 门楣误 block」双重进不去）
        [97, 125.7, 0, 119, 127.7, 22],
        [143, 125.7, 0, 167, 127.7, 22],
        [119, 125.7, 9, 143, 127.7, 22],
        [97, 87.7, 0, 99, 127.7, 22],
        [165, 87.7, 0, 167, 127.7, 22],
        [97, 87.7, 11, 101, 127.7, 12],
        [105, 87.7, 11, 167, 127.7, 12],
        [101, 87.7, 11, 105, 91.7, 12],
        [101, 95.7, 11, 105, 127.7, 12],
        [107, 95.7, 0, 109, 97.7, 22],
        [107, 119.7, 0, 109, 121.7, 22],
        // x=127 两根立柱位于主大门 x[119,143] 正中（v1.8 删除：scale0.3 后世界 x[234,235] 挡门洞通道）
        [147, 95.7, 0, 149, 97.7, 22],
        [147, 119.7, 0, 149, 121.7, 22],
        [166, 92.7, 0, 192, 118.7, 38],
        [166, 116.7, 0, 192, 142.7, 38],
        [104.5, 97.2, 0, 109.5, 102.2, 44],
        [124.5, 97.2, 0, 129.5, 102.2, 44],
        [144.5, 97.2, 0, 149.5, 102.2, 44],
      ],
      platforms: [
        { x0: 97, x1: 167, y0: 87.7, y1: 127.7, y: 11 },
        { x0: 166, x1: 192, y0: 92.7, y1: 118.7, y: 38 },
        { x0: 166, x1: 192, y0: 116.7, y1: 142.7, y: 38 },
      ]
    }
,
    stadium: { // 碰撞箱按 SCAD 编写（12 盒 / 平台 0）：真实门洞 + 内部中空
      // v1.8：4 条入场隧道加宽 y[104,116]→y[100,120]（scale0.3 后世界宽 6m ≥3 nav cells，修复取整污染进不去）
      colliders: [
        [214, 0, 0, 218, 100, 32],
        [214, 120, 0, 218, 220, 32],
        [214, 100, 14, 218, 120, 32],
        [2, 0, 0, 6, 100, 32],
        [2, 120, 0, 6, 220, 32],
        [2, 100, 14, 6, 120, 32],
        [0, 214, 0, 100, 218, 32],
        [120, 214, 0, 220, 218, 32],
        [100, 214, 14, 120, 218, 32],
        [0, 2, 0, 100, 6, 32],
        [120, 2, 0, 220, 6, 32],
        [100, 2, 14, 120, 6, 32],
      ],
    }
,
    megatower: { // 碰撞箱按 SCAD 编写（110 盒 / 平台 11）：真实门洞 + 内部中空 + 楼板楼梯井
      colliders: [
        [0, 0, 0, 36, 2, 120],
        [0, 34, 0, 13, 36, 120],
        [23, 34, 0, 36, 36, 120],
        [13, 34, 8, 23, 36, 120], // v1.8 门洞加宽 6→10m（≥3 nav cells 净空）
        [0, 0, 0, 2, 36, 120],
        [34, 0, 0, 36, 36, 120],
        [0, 0, 10, 2, 36, 11],
        [11, 0, 10, 36, 36, 11],
        [2, 0, 10, 11, 2, 11],
        [2, 11, 10, 11, 36, 11],
        [0, 0, 20, 2, 36, 21],
        [11, 0, 20, 36, 36, 21],
        [2, 0, 20, 11, 2, 21],
        [2, 11, 20, 11, 36, 21],
        [0, 0, 30, 2, 36, 31],
        [11, 0, 30, 36, 36, 31],
        [2, 0, 30, 11, 2, 31],
        [2, 11, 30, 11, 36, 31],
        [0, 0, 40, 2, 36, 41],
        [11, 0, 40, 36, 36, 41],
        [2, 0, 40, 11, 2, 41],
        [2, 11, 40, 11, 36, 41],
        [0, 0, 50, 2, 36, 51],
        [11, 0, 50, 36, 36, 51],
        [2, 0, 50, 11, 2, 51],
        [2, 11, 50, 11, 36, 51],
        [0, 0, 60, 2, 36, 61],
        [11, 0, 60, 36, 36, 61],
        [2, 0, 60, 11, 2, 61],
        [2, 11, 60, 11, 36, 61],
        [0, 0, 70, 2, 36, 71],
        [11, 0, 70, 36, 36, 71],
        [2, 0, 70, 11, 2, 71],
        [2, 11, 70, 11, 36, 71],
        [0, 0, 80, 2, 36, 81],
        [11, 0, 80, 36, 36, 81],
        [2, 0, 80, 11, 2, 81],
        [2, 11, 80, 11, 36, 81],
        [0, 0, 90, 2, 36, 91],
        [11, 0, 90, 36, 36, 91],
        [2, 0, 90, 11, 2, 91],
        [2, 11, 90, 11, 36, 91],
        [0, 0, 100, 2, 36, 101],
        [11, 0, 100, 36, 36, 101],
        [2, 0, 100, 11, 2, 101],
        [2, 11, 100, 11, 36, 101],
        [0, 0, 110, 2, 36, 111],
        [11, 0, 110, 36, 36, 111],
        [2, 0, 110, 11, 2, 111],
        [2, 11, 110, 11, 36, 111],
        [0, 18, 11, 6, 19, 20],
        [9, 18, 11, 36, 19, 20],
        [6, 18, 17, 9, 19, 20],
        [0, 26, 11, 24, 27, 20],
        [27, 26, 11, 36, 27, 20],
        [24, 26, 17, 27, 27, 20],
        [14, 0, 21, 15, 6, 30],
        [14, 9, 21, 15, 36, 30],
        [14, 6, 27, 15, 9, 30],
        [24, 0, 21, 25, 24, 30],
        [24, 27, 21, 25, 36, 30],
        [24, 24, 27, 25, 27, 30],
        [0, 18, 31, 6, 19, 40],
        [9, 18, 31, 36, 19, 40],
        [6, 18, 37, 9, 19, 40],
        [0, 26, 31, 24, 27, 40],
        [27, 26, 31, 36, 27, 40],
        [24, 26, 37, 27, 27, 40],
        [14, 0, 41, 15, 6, 50],
        [14, 9, 41, 15, 36, 50],
        [14, 6, 47, 15, 9, 50],
        [24, 0, 41, 25, 24, 50],
        [24, 27, 41, 25, 36, 50],
        [24, 24, 47, 25, 27, 50],
        [0, 18, 51, 6, 19, 60],
        [9, 18, 51, 36, 19, 60],
        [6, 18, 57, 9, 19, 60],
        [0, 26, 51, 24, 27, 60],
        [27, 26, 51, 36, 27, 60],
        [24, 26, 57, 27, 27, 60],
        [14, 0, 61, 15, 6, 70],
        [14, 9, 61, 15, 36, 70],
        [14, 6, 67, 15, 9, 70],
        [24, 0, 61, 25, 24, 70],
        [24, 27, 61, 25, 36, 70],
        [24, 24, 67, 25, 27, 70],
        [0, 18, 71, 6, 19, 80],
        [9, 18, 71, 36, 19, 80],
        [6, 18, 77, 9, 19, 80],
        [0, 26, 71, 24, 27, 80],
        [27, 26, 71, 36, 27, 80],
        [24, 26, 77, 27, 27, 80],
        [14, 0, 81, 15, 6, 90],
        [14, 9, 81, 15, 36, 90],
        [14, 6, 87, 15, 9, 90],
        [24, 0, 81, 25, 24, 90],
        [24, 27, 81, 25, 36, 90],
        [24, 24, 87, 25, 27, 90],
        [0, 18, 91, 6, 19, 100],
        [9, 18, 91, 36, 19, 100],
        [6, 18, 97, 9, 19, 100],
        [0, 26, 91, 24, 27, 100],
        [27, 26, 91, 36, 27, 100],
        [24, 26, 97, 27, 27, 100],
        [14, 0, 101, 15, 6, 110],
        [14, 9, 101, 15, 36, 110],
        [14, 6, 107, 15, 9, 110],
        [24, 0, 101, 25, 24, 110],
        [24, 27, 101, 25, 36, 110],
        [24, 24, 107, 25, 27, 110],
      ],
      platforms: [
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 10 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 20 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 30 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 40 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 50 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 60 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 70 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 80 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 90 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 100 },
        { x0: 0, x1: 36, y0: 0, y1: 36, y: 110 },
      ]
    },

    /* ============ v1.8 超大型综合体 complex（120×80×48，占地 9600㎡）============
     * desert 巨无霸地标：四面外墙中央大门（14×8，≥6 nav cells 净空）→ 中庭（60×36 通高天井）
     * + 4 层环廊（楼板挖中庭，玩家可站可守）+ 中央核心筒（8×8 电梯/机房）+ 4 角楼梯井（10×10 可攀）。
     * 门楣 min.y=8 ≥2.6（nav 网格跳过阈值）→ 门洞净空不被取整污染；地面层内部全开放。 */
    complex: {
      colliders: [
        // 外墙 4 面（厚 1.5；中央门洞 14×8 由门楣补齐，门楣 min.y=8 不 block 地面网格）
        [0, 0, 0, 53, 1.5, 48], [67, 0, 0, 120, 1.5, 48], [53, 0, 8, 67, 1.5, 48],
        [0, 78.5, 0, 53, 80, 48], [67, 78.5, 0, 120, 80, 48], [53, 78.5, 8, 67, 80, 48],
        [0, 0, 0, 1.5, 33, 48], [0, 47, 0, 1.5, 80, 48], [0, 33, 8, 1.5, 47, 48],
        [118.5, 0, 0, 120, 33, 48], [118.5, 47, 0, 120, 80, 48], [118.5, 33, 8, 120, 47, 48],
        // 中央核心筒（电梯井 + 顶机房，实体）
        [56, 36, 0, 64, 44, 48],
        // 楼板环 4 层（挖中庭；min.y≥2.6 自动不 block 地面网格；移动碰撞挡上层）
        [0, 0, 11.5, 36, 80, 12.5], [96, 0, 11.5, 120, 80, 12.5],
        [36, 0, 11.5, 96, 22, 12.5], [36, 58, 11.5, 96, 80, 12.5],
        [0, 0, 23.5, 36, 80, 24.5], [96, 0, 23.5, 120, 80, 24.5],
        [36, 0, 23.5, 96, 22, 24.5], [36, 58, 23.5, 96, 80, 24.5],
        [0, 0, 35.5, 36, 80, 36.5], [96, 0, 35.5, 120, 80, 36.5],
        [36, 0, 35.5, 96, 22, 36.5], [36, 58, 35.5, 96, 80, 36.5],
        [0, 0, 47, 36, 80, 48], [96, 0, 47, 120, 80, 48],
        [36, 0, 47, 96, 22, 48], [36, 58, 47, 96, 80, 48]
      ],
      platforms: [
        // 每层环廊（中庭挖空；楼梯井含平台=站在楼梯顶；y=板顶面）
        { x0: 0, x1: 36, y0: 0, y1: 80, y: 12 }, { x0: 96, x1: 120, y0: 0, y1: 80, y: 12 },
        { x0: 36, x1: 96, y0: 0, y1: 22, y: 12 }, { x0: 36, x1: 96, y0: 58, y1: 80, y: 12 },
        { x0: 0, x1: 36, y0: 0, y1: 80, y: 24 }, { x0: 96, x1: 120, y0: 0, y1: 80, y: 24 },
        { x0: 36, x1: 96, y0: 0, y1: 22, y: 24 }, { x0: 36, x1: 96, y0: 58, y1: 80, y: 24 },
        { x0: 0, x1: 36, y0: 0, y1: 80, y: 36 }, { x0: 96, x1: 120, y0: 0, y1: 80, y: 36 },
        { x0: 36, x1: 96, y0: 0, y1: 22, y: 36 }, { x0: 36, x1: 96, y0: 58, y1: 80, y: 36 },
        { x0: 0, x1: 36, y0: 0, y1: 80, y: 48 }, { x0: 96, x1: 120, y0: 0, y1: 80, y: 48 },
        { x0: 36, x1: 96, y0: 0, y1: 22, y: 48 }, { x0: 36, x1: 96, y0: 58, y1: 80, y: 48 }
      ]
    },

    /* ============ v1.6 程序化主题建筑（PROC_GEOS 生成几何，碰撞按真实造型）============
     * 全部为「异形非盒子」建筑：龙门吊/油罐/天线塔/岗亭 —— 给三图注入主题特色；
     * 预留 GLB 插槽（glb 字段），用户建模后走 glb2bldg_out 内联即可替换视觉（碰撞不变）。 */
    crane: { // 26×10×16 龙门吊：四门腿 + 高空横梁（跨货柜堆场，腿间可通行）
      colliders: [
        [0.6, 0.6, 0, 1.4, 1.4, 14], [24.6, 0.6, 0, 25.4, 1.4, 14],
        [0.6, 8.6, 0, 1.4, 9.4, 14], [24.6, 8.6, 0, 25.4, 9.4, 14],
        [0, 0, 14, 26, 10, 16]     // 横梁（min.y=14 ≥ OVERHEAD → 只挡弹道，桥下可通行）
      ],
      platforms: [{ x0: 0, x1: 26, y0: 0, y1: 10, y: 16 }]
    },
    tankH: { // 20×9×8 卧式油罐：罐体实心（方体近似）+ 支墩，不可进入
      colliders: [
        [0, 0, 0, 20, 9, 7.5]
      ]
    },
    tankV: { // 10×10×12 立式油罐：罐体实心（圆柱→方体近似），不可进入
      colliders: [
        [0, 0, 0, 10, 10, 10.5]
      ]
    },
    mast: { // 6×6×20 桁架天线塔：四主柱 + 顶部平台（柱间可通行，可攀平台）
      colliders: [
        [0, 0, 0, 0.5, 0.5, 20], [5.5, 0, 0, 6, 0.5, 20],
        [0, 5.5, 0, 0.5, 6, 20], [5.5, 5.5, 0, 6, 6, 20],
        [0, 0, 19.5, 6, 6, 20]   // 顶部平台（min.y=19.5 → 不挡地面；顶面与几何齐平 20）
      ],
      platforms: [{ x0: 0, x1: 6, y0: 0, y1: 6, y: 20 }]
    },
    guardhouse: { // 5×5×4.5 岗亭：四面 0.4m 墙 + 后向门洞 1.6×2 + 坡顶，可进入
      colliders: [
        [0, 4.6, 0, 5, 5, 4],                                      // 前墙（厚 0.4）
        [0, 0, 0, 1.7, 0.4, 4], [3.3, 0, 0, 5, 0.4, 4], [1.7, 0, 2, 3.3, 0.4, 4], // 后墙门洞
        [0, 0, 0, 0.4, 5, 4], [4.6, 0, 0, 5, 5, 4],                // 左右墙
        [0, 0, 4, 5, 5, 4.5]                                       // 屋顶封盖（碰撞平顶，视觉坡顶在上）
      ]
    }
  },

  /* ============ v1.6 程序化主题建筑几何（PROC_GEOS）============
   * 与 models/buildings/*.glb 同一契约：角点原点 + Y-up + 顶点色 + 索引；
   * 运行时按地图 dims（REAL_DIMS×scale）缩放几何与碰撞 → 与内联类型完全同权。
   * 低模方块/圆柱拼装，离线即玩；每个类型预留 GLB 插槽（见 CONFIGS 注释），
   * 用户建模后走 glb2bldg_out 内联即可替换视觉（碰撞不变）。 */
  PROC_GEOS: (function () {
    // 合并多个基础几何 → 一个带顶点色的 BufferGeometry（角点原点空间）
    function merge(parts) {
      const P = [], N = [], C = [], I = [];
      let base = 0;
      for (const p of parts) {
        const g = p.geo;
        if (!g || !g.attributes.position) continue;
        const pos = g.attributes.position, nor = g.attributes.normal, idx = g.index;
        const c = p.c || [0.72, 0.72, 0.72];
        for (let i = 0; i < pos.count; i++) {
          P.push(pos.getX(i) + p.x, pos.getY(i) + p.y, pos.getZ(i) + p.z);
          N.push(nor.getX(i), nor.getY(i), nor.getZ(i));
          C.push(c[0], c[1], c[2]);
        }
        if (idx) for (let i = 0; i < idx.count; i++) I.push(idx.getX(i) + base);
        base += pos.count;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint16Array(I), 1));
      geo.computeBoundingBox();
      return geo;
    }
    function bx(x, y, z, w, h, d, c) { return { geo: new THREE.BoxGeometry(w, h, d), x, y, z, c: c || [0.72, 0.72, 0.72] }; }
    // 角点原点语义的 box（bx 是中心语义的历史遗留；新类型一律用 cb 保持与内联数据契约一致）
    function cb(x, y, z, w, h, d, c) { return bx(x + w / 2, y + h / 2, z + d / 2, w, h, d, c); }
    // 圆柱沿 X 卧放（中心在 (x,y,z)）：rotateZ(π/2) 使 CylinderGeometry 的 Y 轴→X 轴
    function cylX(x, y, z, r, len, c, seg) { const g = new THREE.CylinderGeometry(r, r, len, seg || 8); g.rotateZ(Math.PI / 2); return { geo: g, x, y, z, c: c || [0.72, 0.72, 0.72] }; }
    function cyl(x, y, z, r, len, c, seg) { return { geo: new THREE.CylinderGeometry(r, r, len, seg || 8), x, y, z, c: c || [0.72, 0.72, 0.72] }; }
    return {
      // 龙门吊（26×10×16）：四门腿 + 主梁 + 小车/吊钩 —— 港口装卸区标志
      crane(rd) {
        const w = rd.w, d = rd.d, h = rd.h, leg = 0.8, legH = h - 2, beamH = 2;
        const rust = [0.72, 0.42, 0.24], beam = [0.9, 0.72, 0.38], cab = [0.5, 0.42, 0.34];
        return merge([
          bx(0, 0, 0, leg, legH, leg, rust), bx(w - leg, 0, 0, leg, legH, leg, rust),
          bx(0, 0, d - leg, leg, legH, leg, rust), bx(w - leg, 0, d - leg, leg, legH, leg, rust),
          bx(0, legH, 0, w, beamH, d, beam),                    // 主梁
          bx(w * 0.42, legH + beamH, d / 2 - 0.9, 2.4, 1.1, 1.8, cab),      // 小车
          bx(w * 0.42, legH + beamH + 1.1, d / 2 - 0.9, 1.1, 1.1, 1.8, cab) // 吊钩箱
        ]);
      },
      // 卧式油罐（20×9×8）：三支墩 + 罐体圆柱 + 端盖 + 顶部护栏 —— 炼油区/补给站
      tankH(rd) {
        const w = rd.w, d = rd.d, h = rd.h, R = 4.0, L = w - 2, cz = d / 2, cy = 0.7 + R;
        const tank = [0.68, 0.6, 0.5], band = [0.85, 0.78, 0.68], end = [0.55, 0.47, 0.4];
        return merge([
          bx(1, 0, cz - 0.8, 0.9, 0.7, 1.6, [0.45, 0.45, 0.5]),
          bx(w / 2, 0, cz - 0.8, 0.9, 0.7, 1.6, [0.45, 0.45, 0.5]),
          bx(w - 2, 0, cz - 0.8, 0.9, 0.7, 1.6, [0.45, 0.45, 0.5]),
          cylX(w / 2, cy, cz, R, L, tank),                     // 罐体
          cylX(1, cy, cz, R + 0.25, 0.7, band, 10),            // 近端加强环
          cylX(w - 1, cy, cz, R + 0.25, 0.7, band, 10),        // 远端加强环
          bx(w / 2, cy + R - 0.35, cz - 0.3, L * 0.7, 1.0, 0.16, [0.4, 0.4, 0.44]), // 顶部护栏
          bx(1, 0.7, cz + 0.5, 0.5, 4.2, 0.5, [0.4, 0.4, 0.44]) // 端部爬梯
        ]);
      },
      // 立式油罐（10×10×12）：罐体圆柱 + 锥顶 + 底部环墙 —— 储油区
      tankV(rd) {
        const w = rd.w, d = rd.d, h = rd.h, R = 4.4, cx = w / 2, cz = d / 2;
        const tank = [0.68, 0.6, 0.5], top = [0.5, 0.42, 0.36], ring = [0.78, 0.7, 0.6];
        return merge([
          cyl(cx, 0, cz, R, h - 1.6, tank, 10),                          // 罐体
          cyl(cx, h - 1.6, cz, R, 1.6, top, 10),                          // 收颈段
          cyl(cx, h - 0.6, cz, 0.8, 0.6, [0.6, 0.55, 0.5], 6),            // 顶部呼吸阀
          cyl(cx, 0, cz, R + 0.35, 1.1, ring, 10),                        // 底部环墙
          bx(cx - R * 0.4, 1.4, cz - R * 0.4, 0.5, h - 2.6, 0.5, [0.42, 0.42, 0.46]) // 外爬梯
        ]);
      },
      // 桁架天线塔（6×6×20）：四主柱 + 每 4m 横撑 + 顶部平台 + 天线 —— 荒漠信号/观察
      mast(rd) {
        const w = rd.w, d = rd.d, h = rd.h, leg = 0.5;
        const steel = [0.58, 0.5, 0.42], brace = [0.42, 0.36, 0.32];
        const parts = [
          bx(0, 0, 0, leg, h, leg, steel), bx(w - leg, 0, 0, leg, h, leg, steel),
          bx(0, 0, d - leg, leg, h, leg, steel), bx(w - leg, 0, d - leg, leg, h, leg, steel)
        ];
        for (let y = 4; y < h; y += 4) {
          parts.push(bx(0, y, 0, w, 0.3, 0.3, brace), bx(0, y, d - 0.3, w, 0.3, 0.3, brace));
          parts.push(bx(0, y, 0, 0.3, 0.3, d, brace), bx(w - 0.3, y, 0, 0.3, 0.3, d, brace));
        }
        parts.push(bx(0, h, 0, w, 0.5, d, [0.46, 0.42, 0.38]));            // 顶部平台
        parts.push(cyl(w / 2, h + 0.5, d / 2, 0.1, 4, [0.62, 0.58, 0.52], 6)); // 天线杆
        return merge(parts);
      },
      // 超大型综合体（120×80×48）：四面墙带门洞 + 4 层楼板环 + 中央核心筒 + 屋顶直升机坪 —— desert 巨无霸
      complex(rd) {
        const w = rd.w, d = rd.d, h = rd.h, th = 1.5;
        const wall = [0.62, 0.64, 0.68], ring = [0.52, 0.55, 0.6], core = [0.45, 0.48, 0.52], roofC = [0.4, 0.42, 0.46];
        const parts = [
          // 四面外墙（中央门洞 14×8；角点语义 cb）
          cb(0, 0, 0, 53, h, th, wall), cb(67, 0, 0, 53, h, th, wall), cb(53, 0, 8, 14, h - 8, th, wall),
          cb(0, d - th, 0, 53, h, th, wall), cb(67, d - th, 0, 53, h, th, wall), cb(53, d - th, 8, 14, h - 8, th, wall),
          cb(0, 0, 0, th, 33, h, wall), cb(0, 47, 0, th, 33, h, wall), cb(0, 33, 8, th, 14, h - 8, wall),
          cb(w - th, 0, 0, th, 33, h, wall), cb(w - th, 47, 0, th, 33, h, wall), cb(w - th, 33, 8, th, 14, h - 8, wall),
          // 中央核心筒
          cb(56, 36, 0, 8, h, 8, core)
        ];
        // 楼板环 4 层（挖中庭 60×36）
        for (const y of [11.5, 23.5, 35.5, 47]) {
          parts.push(cb(0, y, 0, 36, 1, 80, ring), cb(96, y, 0, 24, 1, 80, ring));
          parts.push(cb(36, y, 0, 60, 1, 22, ring), cb(36, y, 58, 60, 1, 22, ring));
        }
        // 屋顶直升机坪 + 短天线（bbox 内）
        parts.push(cb(45, 47.4, 28, 30, 0.6, 24, roofC));
        parts.push(cyl(60, 46.5, 40, 0.8, 1.5, [0.4, 0.4, 0.44], 8));
        return merge(parts);
      },
      // 岗亭（5×5×4.5）：四面墙 + 后向门洞 + 坡顶 + 侧窗 —— 小区门岗/检查站
      guardhouse(rd) {        const w = rd.w, d = rd.d, h = rd.h, t = 0.4;
        const wall = [0.8, 0.76, 0.68], roof = [0.58, 0.4, 0.32], win = [0.5, 0.7, 0.82], dark = [0.25, 0.28, 0.32];
        return merge([
          bx(0, 0, 0, w, h - 0.4, t, wall),                    // 前墙（厚 0.4）
          bx(0, 0, 0, t, h - 0.4, d, wall),                    // 左墙
          bx(w - t, 0, 0, t, h - 0.4, d, wall),                // 右墙
          bx(0, 0, d - t, 1.7, h - 0.4, t, wall),              // 后墙左段
          bx(3.3, 0, d - t, 1.7, h - 0.4, t, wall),            // 后墙右段
          bx(1.7, 2, d - t, 1.6, h - 2.4, t, wall),            // 门楣
          bx(w / 2 - 0.45, h - 0.42, d / 2 - 0.45, w + 0.9, 0.18, d + 0.9, roof), // 坡顶挑檐（平顶近似 + 大挑檐）
          bx(w / 2 - 0.2, h - 0.9, d / 2 - 0.2, w + 0.2, 0.5, d + 0.2, roof),      // 坡顶屋脊
          bx(0.16, 1.4, d / 2 - 0.9, 0.08, 1.0, 1.8, win),     // 左窗
          bx(w - 0.24, 1.4, d / 2 - 0.9, 0.08, 1.0, 1.8, win), // 右窗
          bx(0.2, 1.55, d / 2 - 0.9, 0.12, 0.7, 1.7, dark),    // 窗暗腔
          bx(w - 0.32, 1.55, d / 2 - 0.9, 0.12, 0.7, 1.7, dark),
          bx(w / 2 - 0.9, 0, d - 0.1, 1.8, 0.3, 0.7, [0.62, 0.62, 0.64]) // 门前台阶
        ]);
      }
    };
  })(),

  // dims = {w,d,h}：仅对 GLB 新类型生效 —— 按摆放尺寸缩放几何/碰撞/平台
  //        （设计契约「碰撞箱按 SCAD 源码编写」：CONFIGS 本地坐标逐构件抄写 battle_*.scad，
  //          运行时按 dims（= REAL_DIMS×scale）等比缩放，地图不手写 w/d/h；见 docs/architecture/building-dimensions-spec.md §5.4）
  // 几何朝向：GLB 由 OpenSCAD(Z-up) 直出、无节点旋转 → 模型 y=深、z=高；
  //          这里对几何 rotateX(-90°) 使其「高朝上」，与 CONFIGS 碰撞约定（y=深→世界z, z=高→世界y）对齐。
  // v1.6 程序化主题类型（PROC_GEOS）：与内联数据同一契约（角点原点 + Y-up + 顶点色），
  //         运行时同样按 dims 缩放几何与碰撞 → 与 GLB 类型完全同权。
  build(key, x, z, ry, dims) {
    try {
      // 数据源：models/buildings/<key>.glb
      const glb = (typeof AssetLoader !== 'undefined') ? AssetLoader.building(key) : null;
      const fromOut = !!glb && (!AssetLoader.manifest || AssetLoader.buildingSource(key) !== 'legacy');
      const fromLegacy = !!glb && !fromOut;
      const fromProc = !glb && this.PROC_GEOS && this.PROC_GEOS[key];
      // v3.2：模型自描述碰撞/平台/门洞（GLB extras.battlegame）。旧 GLB 无 extras 时回退手写 CONFIGS。
      const bmeta = (glb && glb.json && glb.json.extras && glb.json.extras.battlegame) || null;
      let geo = null;
      if (glb) {
        geo = GLB.firstGeometry(glb);
        // 朝向修复：Z-up 直出 → 高朝上（模型 z→世界 y），深转世界 z
        geo.rotateX(-Math.PI / 2);
        geo.computeBoundingBox();
      } else if (fromProc) {
        geo = this.PROC_GEOS[key](this.REAL_DIMS[key] || { w: 10, d: 10, h: 10 });
        if (geo) geo.computeBoundingBox();
      }
      if (!geo) return null;
      // 缩放：仅新类型（fromOut / fromProc）+ 显式摆放尺寸
      let sx = 1, sy = 1, sz = 1;
      if ((fromOut || fromProc) && dims && dims.w && dims.d && dims.h) {
        const bb = geo.boundingBox;
        const rw = (bb.max.x - bb.min.x) || 1, rh = (bb.max.y - bb.min.y) || 1, rd = Math.abs(bb.max.z - bb.min.z) || 1;
        sx = dims.w / rw; sy = dims.h / rh; sz = dims.d / rd;
        geo.scale(sx, sy, sz);
        geo.computeBoundingBox();
      }
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const ryR = (ry || 0) * Math.PI / 180;
      mesh.position.set(x, 0, z);
      if (ryR) mesh.rotation.y = ryR;

      // 碰撞盒：模型坐标 [x0, y0(深), z0(高), x1, y1(深), z1(高)] → 世界 (x, 高y, 深z)
      // 缩放：x→sx(宽), y(深)→sz, z(高)→sy
      const cfg = (bmeta && bmeta.colliders) ? bmeta : this.CONFIGS[key];
      const colliders = [], platforms = [], doors = [];
      // v1.5 sink：模型 z=sink 才是地坪（base 因卧式油罐伸到 z=-6 被整体抬高）→ 碰撞/平台整体下移
      const sink = (cfg && cfg.sink) || 0;
      const sinkY = sink * sy;
      if (cfg) {
        for (const c of cfg.colliders) {
          colliders.push({
            min: new THREE.Vector3(x + c[0] * sx, (c[2] - sink) * sy, z + c[1] * sz),
            max: new THREE.Vector3(x + c[3] * sx, (c[5] - sink) * sy, z + c[4] * sz)
          });
        }
        for (const p of cfg.platforms || []) {
          platforms.push({ x0: x + p.x0 * sx, x1: x + p.x1 * sx, z0: z + p.y0 * sz, z1: z + p.y1 * sz, y: (p.y - sink) * sy });
        }
        for (const d of (cfg.doors || [])) {
          doors.push({ x0: x + d[0] * sx, z0: z + d[1] * sz, x1: x + d[2] * sx, z1: z + d[3] * sz });
        }
      }
      return { mesh, colliders, platforms, doors, sinkY, src: fromOut ? 'inline' : (fromProc ? 'proc' : 'legacy') };
    } catch (e) {
      console.warn('[BuildingLib] ' + key + ' 构建失败: ' + e.message);
      return null;
    }
  },
  // 数据来源状态（报告/测试用）：返回 { key: 'inline'|'legacy'|'proc'|'missing' }
  status() {
    const out = {};
    for (const k of Object.keys(this.CONFIGS)) {
      const has = (typeof AssetLoader !== 'undefined') && AssetLoader.hasBuilding(k);
      if (has) out[k] = AssetLoader.buildingSource(k);
      else if (this.PROC_GEOS && this.PROC_GEOS[k]) out[k] = 'proc';
      else out[k] = 'missing';
    }
    return out;
  }
};

