/* ============================================
 * 战地突击 · js/maps/suburb.js — 地图 01「城郊战场 Suburb」
 * --------------------------------------------
 * 本文件是原 world.js 硬编码地图的 1:1 数据化抽取（行为保留）。
 * v1.2：新增专属机制 airdrop（空投补给 + 中央广场炮击），见 mechanics 字段。
 * v1.3：新增 zone 缩圈（圈心居中 (150,150)，5 阶段半径 220→31、伤害 1→15 HP/s），
 *        规格见 design/maps/zone-br.md；与 airdrop/arty 独立共存（终局 A 点 = 炮击+缩圈双压）。
 * v1.3：新增桥梯 3 元素 — Bridge1 跨南北干道 (135,106.5) + S1/S2 两端台阶（顶 6m 与桥面同高衔接）。
 *        ⚠️ bridge 桥面 collider 需工程 overhead 分流（见 zone-br.md §7.3），否则干道 A* 断。
 * v1.4：新增地标 ST1「竞技场 stadium」— 角点 (180,150)，A 点东侧广场竞技场
 *        （BuildingLib 新类型 key:'stadium'，工程注册前回退占位盒；GLB 插槽休眠见 GDD §4.8）。
 * v1.5：建筑尺寸大修（与 desert/port 一致）—— model 建筑一律改 scale 等比契约（REAL_DIMS×scale），
 *        消除手写 w/d/h 与真实几何比例不符导致的拉伸/压扁；补齐仓库/货柜/围墙/哨楼改善分布。
 * v1.6：建筑群重组（19→27 栋）—— 按「街区群」分组：蓝侧西北生活区 / 西翼生活区 /
 *        东翼生活区 / 竞技场区 / 广场桥梯区；新增民居×4、公寓×1、货柜×3；哨楼归位避开掩体组；
 *        全部遵循 suburb-gdd（均衡基准图：住宅+货栈环绕中央广场，0 屋顶制高点，仅天桥二层）。
 * 所有坐标 / 尺寸 / 种子 / 压平区 / 出生点均与重构前一致。
 * Schema 说明见 docs/architecture/map-architecture.md
 * 设计说明见 design/maps/suburb-gdd.md
 * ============================================ */
(function (root) {
  'use strict';
  if (!root.MapRegistry) { console.warn('[map:suburb] MapRegistry 未加载，跳过注册'); return; }

  root.MapRegistry.register({
    id: 'suburb',
    maxTeams: 4,
    name: '城郊战场',
    desc: '十字干道 + 中央广场，仓库/公寓/民居环绕，东西两片废墟。开阔与巷战各半。',
    theme: 'suburb',
    size: 700, // v3.1 小镇化：450 → 700（外围程序化街区）
    detail: 'high',           // 建筑精修等级：off | low | high

    /* ---------- 环境（雾/天空/光照） ---------- */
    env: {
      fog: { color: 0x8fb4cc, near: 160, far: 560 },
      background: 0x8fb4cc,
      hemi: { sky: 0xdfe9ff, ground: 0x3d4a3a, intensity: 0.85 },
      sun: {
        color: 0xfff2d8, intensity: 1.4, pos: [120, 160, 80],
        target: [350, 350], // 新城中心；阴影相机运行时跟随玩家（World.updateSun）
        shadow: { mapSize: 2048, extent: 170, far: 420 }
      },
      ambient: { color: 0x8899aa, intensity: 0.25 }
    },

    /* ---------- 地形：值噪声起伏 + 土丘 + 压平区 ---------- */
    terrain: {
      seed: 20260805,
      amp: 4.4,               // 基准起伏峰峰值（±amp/2）
      seg: 192,               // PlaneGeometry 细分（700m 图）
      colors: [0x4a6b3c, 0x5c6e52],
      colorMix: 0,            // 0 = 全部用 colors[1]（与重构前一致，见架构文档「已知缺陷」）
      flattenPad: 4,          // flattenPads 每边外扩
      mounds: [
        { x: 80, z: 185, peak: 3.0, falloff: 9, scale: 2.6 },
        { x: 228, z: 95, peak: 3.0, falloff: 10, scale: 2.4 },
        { x: 265, z: 248, peak: 2.5, falloff: 9, scale: 2.0 }
      ],
      // 建筑占地压平（中心 x, 中心 z, 宽, 深）—— v1.6 按「街区群」重组后的建筑逐栋对齐
      flattenPads: [
        /* —— 蓝侧西北生活区（NW）—— */
        [73, 69, 22, 14],            // 货栈 warehouse(62,62)（出生区前沿工业缘）
        [33.3, 34.3, 10.6, 8.6],     // 民居 house(28,30)
        [23.3, 74.3, 10.6, 8.6],     // 民居 house(18,70)
        [118, 66, 16, 12],           // 公寓 apartment(110,60)（干道西侧住宅楼）
        [140.1, 50.1, 4.2, 4.2],     // 哨塔 watchtower(138,48)
        [104.1, 48.2, 16.2, 8.4],    // 货柜 container(96,44)（街区货柜掩体）
        /* —— 西翼生活区（SW）—— */
        [60, 216, 16, 12],           // 公寓 apartment(52,210)
        [58.75, 196.7, 37.5, 1.4],   // 围墙 wall(40,196)（花园隔断）
        [98.1, 200.2, 16.2, 8.4],    // 货柜 container(90,196)（南翼掩体链）
        [50.1, 140.1, 4.2, 4.2],     // 哨塔 watchtower(48,138)
        [133.3, 262.3, 10.6, 8.6],   // 民居 house(128,258)
        [95.3, 244.3, 10.6, 8.6],    // 民居 house(90,240)（西南街坊）
        /* —— 东翼生活区（NE）—— */
        [208, 58, 16, 12],           // 公寓 apartment(200,52)（干道北端地标）
        [267.3, 132.3, 10.6, 8.6],   // 民居 house(262,128)（干道东端）
        [185.25, 121.15, 14.5, 6.3], // 掩体组 cover(178,118)
        [196, 110, 12, 12],          // 哨楼 pillbox(190,104)（A 点东侧掩护）
        [218.1, 84.2, 16.2, 8.4],    // 货柜 container(210,80)（东翼掩体链）
        /* —— 竞技场区（SE）—— */
        [213, 183, 66, 66],          // 竞技场 stadium(180,150)（A 点东侧广场竞技场）
        [227.3, 222.3, 10.6, 8.6],   // 民居 house(222,218)
        [247, 243, 22, 14],          // 货栈 warehouse(236,236)（东南仓库）
        [273.1, 194.2, 16.2, 8.4],   // 货柜 container(265,190)（红方推进掩体）
        [273.3, 259.3, 10.6, 8.6],   // 民居 house(268,255)（东北街坊）
        /* —— 广场边缘掩体组 —— */
        [125.25, 121.15, 14.5, 6.3], // cover(118,118)
        [155.25, 165.15, 14.5, 6.3], // cover(148,162)
        /* —— 桥梯（桥 30×7 桥面 10m；梯 12×12 顶面 9.5m）—— */
        [150, 110, 30, 7],           // bridge(135,106.5)
        [131, 110, 12, 12],          // stairs(125,104)
        [171, 116, 12, 12],          // stairs(165,110)
        /* —— v1.7 岗亭（广场四角门岗 + 居住区门岗）—— */
        [152.5, 180.5, 5, 5],        // GH1 广场南门岗
        [124.5, 152.5, 5, 5],        // GH2 广场西门岗（避开竞技场）
        [32.5, 92.5, 5, 5],          // GH3 蓝侧小区门岗
        [256.5, 198.5, 5, 5],        // GH4 竞技场区门岗（v1.8 挪离 stadium 东门洞出口）
        /* —— v1.8 紧凑布局（31→46 栋）：四象限填空，建筑间距拉近到 8~20m —— */
        [31, 127, 22, 14],           // 货栈 warehouse(20,120)（西北工业缘）
        [63.3, 114.3, 10.6, 8.6],    // 民居 house(58,110)
        [89.3, 94.3, 10.6, 8.6],     // 民居 house(84,90)
        [38.1, 48.2, 16.2, 8.4],     // 货柜 container(30,44)（蓝侧货柜掩体）
        [188, 66, 16, 12],           // 公寓 apartment(180,60)（干道东侧住宅楼）
        [245.3, 44.3, 10.6, 8.6],    // 民居 house(240,40)（东北角）
        [225.3, 108.3, 10.6, 8.6],   // 民居 house(220,104)
        [288.1, 64.2, 16.2, 8.4],    // 货柜 container(280,60)（东角货柜）
        [31.3, 194.3, 10.6, 8.6],    // 民居 house(26,190)（西翼街坊）
        [121, 197, 22, 14],          // 货栈 warehouse(110,190)（西南货栈）
        [68.1, 184.2, 16.2, 8.4],    // 货柜 container(60,180)（西翼掩体链）
        [85.3, 276.3, 10.6, 8.6],    // 民居 house(80,272)（西南角）
        [255.3, 219.3, 10.6, 8.6],   // 民居 house(250,215)（竞技场北）
        [188, 256, 16, 12],          // 公寓 apartment(180,250)（红侧公寓）
        [208.1, 234.2, 16.2, 8.4],   // 货柜 container(200,230)（红侧推进掩体）
        [428, 421, 56, 42]           // 庄园 estate(400,400) scale 0.7
      ],
      // 道路/广场/据点/出生区压平（显式矩形）
      flatten: [
        { x0: 137, x1: 163, z0: 0, z1: 300 },     // 南北干道
        { x0: 0, x1: 300, z0: 137, z1: 163 },     // 东西干道
        { x0: 128, x1: 172, z0: 128, z1: 172 },   // 中央广场
        { x0: 134, x1: 166, z0: 134, z1: 166 },   // 据点 A
        { x0: 96, x1: 124, z0: 94, z1: 122 },     // 据点 B
        { x0: 201, x1: 229, z0: 236, z1: 264 },   // 据点 C
        { x0: 0, x1: 90, z0: 0, z1: 90 },         // 蓝方出生区
        { x0: 210, x1: 300, z0: 210, z1: 300 }    // 红方出生区
      ]
    },

    /* ---------- 道路 ---------- */
    roads: {
      tex: 'asphalt', repeat: 40, thick: 0.12,
      strips: [
        { x: 150, z: 150, w: 26, d: 300 },  // 南北干道
        { x: 150, z: 150, w: 300, d: 26 },  // 东西干道
        { x: 150, z: 150, w: 44, d: 44 }    // 中央广场
      ],
      markColor: 0xd8d8c0, markY: 0.16,
      marks: [
        { axis: 'z', at: 150, from: 15, to: 290, step: 20, len: 4, w: 0.35 },
        { axis: 'x', at: 150, from: 15, to: 290, step: 20, len: 4, w: 0.35 }
      ]
    },

    /* ---------- 建筑 ----------
     * type:'model' → BuildingLib（内联 GLB 数据）；坐标为建筑「角点」，ry 为度
     * trim         → 程序化精修（檐口/角柱/分缝/烟囱），纯视觉不产生碰撞
     * glb          → 可选外部 GLB 插槽；file:// 或加载失败自动回退（离线即玩）
     */
    /* ---------- 建筑（27 栋，v1.6 按「街区群」重组）----------
     * 尺寸契约：model 建筑一律只写 scale（等比系数），w/d/h 由 REAL_DIMS×scale 推导，
     *          结构上不可能再出现拉伸。全部 ry:0（与 desert/port 一致，碰撞轴对齐可预测）。
     * 布局主题（suburb = 均衡基准图）：五组街区群 ——
     *   蓝侧西北生活区（货栈+民居+公寓+哨塔+货柜）
     *   西翼生活区（公寓+围墙+货柜+哨塔+民居）
     *   东翼生活区（公寓+民居+哨楼+货柜）
     *   竞技场区（ST1 竞技场 + 民居 + 东南货栈 + 红方推进货柜）
     *   广场/桥梯区（3 掩体组 + 天桥 + 2 台阶）
     */
    buildings: [
      /* ============ 蓝侧西北生活区（NW）============ */
      {
        type: 'model', key: 'warehouse', x: 62, z: 62, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true } // D-06：top=几何实测高 9.70
      },
      {
        type: 'model', key: 'house', x: 28, z: 30, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 18, z: 70, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'apartment', x: 110, z: 60, ry: 0, scale: 1, tint: 0xb7b0a4,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }
      },
      { type: 'model', key: 'watchtower', x: 138, z: 48, ry: 0, scale: 1, trim: false },
      { type: 'model', key: 'container', x: 96, z: 44, ry: 0, scale: 1, tint: 0xa8603a, trim: false },

      /* ============ 西翼生活区（SW）============ */
      {
        type: 'model', key: 'apartment', x: 52, z: 210, ry: 0, scale: 1, tint: 0xb7b0a4,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }
      },
      { type: 'model', key: 'wall', x: 40, z: 196, ry: 0, scale: 1, tint: 0x6e7880, trim: false },
      { type: 'model', key: 'container', x: 90, z: 196, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      { type: 'model', key: 'watchtower', x: 48, z: 138, ry: 0, scale: 1, trim: false },
      {
        type: 'model', key: 'house', x: 128, z: 258, ry: 0, scale: 1,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 90, z: 240, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },

      /* ============ 东翼生活区（NE）============ */
      {
        type: 'model', key: 'apartment', x: 200, z: 52, ry: 0, scale: 1,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] } // D-06：top=几何实测高 19.10
      },
      {
        type: 'model', key: 'house', x: 262, z: 128, ry: 0, scale: 1,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'cover', x: 178, z: 118, ry: 0, scale: 1, trim: false },
      { type: 'model', key: 'pillbox', x: 190, z: 104, ry: 0, scale: 1, tint: 0x99a3ab, trim: false },
      { type: 'model', key: 'container', x: 210, z: 80, ry: 0, scale: 1, tint: 0xa8603a, trim: false },

      /* ============ 竞技场区（SE）============ */
      { type: 'model', key: 'cover', x: 148, z: 162, ry: 0, scale: 1, trim: false },
      {
        type: 'model', key: 'house', x: 222, z: 218, ry: 0, scale: 1,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'warehouse', x: 236, z: 236, ry: 0, scale: 1, tint: 0xd8c49a,
        trim: { top: 9.7, cornice: true, pilaster: true }
      },
      { type: 'model', key: 'container', x: 265, z: 190, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      {
        type: 'model', key: 'house', x: 268, z: 255, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },

      /* ============ 广场边缘（A 点四周掩体组）============ */
      { type: 'model', key: 'cover', x: 118, z: 118, ry: 0, scale: 1, trim: false },

      /* ============ v1.7 岗亭（27→31 栋）：广场四角 + 街坊门岗 ============
       * GH1/GH2 立 A 点广场南/东沿（守卫感 + 街景）；GH3 蓝侧居住街坊门岗；
       * GH4 竞技场区门岗。程序化岗亭（PROC_GEOS），不堵干道/出生点/据点。 */
      { type: 'model', key: 'guardhouse', x: 150, z: 178, ry: 0, scale: 1, tint: 0xb7b0a4, trim: false }, // GH1
      { type: 'model', key: 'guardhouse', x: 122, z: 150, ry: 0, scale: 1, tint: 0xb7b0a4, trim: false }, // GH2（广场西门岗）
      { type: 'model', key: 'guardhouse', x: 30, z: 90, ry: 0, scale: 1, tint: 0xb7b0a4, trim: false },   // GH3
      { type: 'model', key: 'guardhouse', x: 254, z: 196, ry: 0, scale: 1, tint: 0xb7b0a4, trim: false }, // GH4（v1.8 挪离 stadium 东门洞出口）

      /* ============ v1.8 紧凑布局（31→46 栋）：四象限填空 ============
       * 用户要求「布局再紧凑一些」—— 填补各象限空隙，建筑间距拉近到 8~20m，
       * 干道两侧形成连续街景，出生区前沿也有掩体链；不压干道/出生点/据点。 */
      { type: 'model', key: 'warehouse', x: 20, z: 120, ry: 0, scale: 1, tint: 0xd8c49a,
        trim: { top: 9.7, cornice: true, pilaster: true } },                 // NW 货栈
      {
        type: 'model', key: 'house', x: 58, z: 110, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 84, z: 90, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 30, z: 44, ry: 0, scale: 1, tint: 0xa8603a, trim: false }, // NW 货柜
      {
        type: 'model', key: 'apartment', x: 180, z: 60, ry: 0, scale: 1, tint: 0xb7b0a4,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }
      },                                                                     // NE 公寓（干道东侧）
      {
        type: 'model', key: 'house', x: 240, z: 40, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 220, z: 104, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 280, z: 60, ry: 0, scale: 1, tint: 0xa8603a, trim: false }, // NE 东角货柜
      {
        type: 'model', key: 'house', x: 26, z: 190, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'warehouse', x: 110, z: 190, ry: 0, scale: 1, tint: 0xd8c49a,
        trim: { top: 9.7, cornice: true, pilaster: true } },                 // SW 货栈
      { type: 'model', key: 'container', x: 60, z: 180, ry: 0, scale: 1, tint: 0xa8603a, trim: false }, // SW 货柜
      {
        type: 'model', key: 'house', x: 80, z: 272, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 250, z: 215, ry: 0, scale: 1, tint: 0x8a8f86,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },                                                                     // SE 竞技场北
      {
        type: 'model', key: 'apartment', x: 180, z: 250, ry: 0, scale: 1, tint: 0xb7b0a4,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }
      },                                                                     // SE 红侧公寓
      { type: 'model', key: 'container', x: 200, z: 230, ry: 0, scale: 1, tint: 0xa8603a, trim: false }, // SE 红侧推进掩体

      /* ============ 桥梯（3 元素）：天桥 × 1 + 台阶 × 2 ============
       * v1.5 改真实尺寸：桥 30×7×10（桥面 10.0m）、梯 12×12×13（顶层楼板顶面 9.5m）。
       *   旧数据两者 h 都写 6 → 桥被压到 60%、梯被压到 46%，梯级高度失真到爬不上去。
       *   现在梯顶 9.5 → 桥面 10.0 差 0.5m（< STEP_H 0.8），一步跨上；台阶与桥端「边贴边」不重叠。
       * ⚠️ bridge 桥面+栏杆 collider 由引擎按 min.y≥OVERHEAD_Y 分流进 overhead（只挡弹道）。 */
      /* Bridge1 跨南北干道天桥（x 135~165 / z 106.5~113.5，桥面 10m；西端 S1 东端 S2），A 点南侧二层观察位 */
      { type: 'model', key: 'bridge', x: 135, z: 106.5, ry: 0, scale: 1, tint: 0x8c97a3, trim: false },
      /* S1 桥西端台阶（x 125~137，不侵入干道 x≥137；顶平台与桥面 135 处衔接） */
      { type: 'model', key: 'stairs', x: 125, z: 104, ry: 0, scale: 1, tint: 0x6b645c, trim: false },
      /* S2 桥东端台阶（x 165~177，顶平台与桥面 165 处衔接） */
      { type: 'model', key: 'stairs', x: 165, z: 110, ry: 0, scale: 1, tint: 0x6b645c, trim: false },

      /* ============ 地标 ST1：竞技场 stadium（A 点东侧广场竞技场）============
       * 真实几何 220×220×32；scale 0.3 → 66×66×9.6（镂空环 + 4 径向隧道门，可进场内/看台下）。
       * 角点 (180,150) → 占地 x[180,246] z[150,216]：东邻主街、A 点东南 30m，不堵干道（桥下可通行）。
       * BuildingLib 新类型 key:'stadium'：工程注册前 → placeModelBuilding 回退占位盒（碰撞=w/d/h，安全）；
       * GLB 插槽 'assets/buildings/out/battle_stadium.glb'：离线/未接 GLTFLoader 休眠（ADR-003），不崩。 */
      { type: 'model', key: 'stadium', x: 180, z: 150, ry: 0, scale: 0.3, tint: 0x8c97a3, trim: false },
      /* 庄园地标（外部 large_house 模型） */
      { type: 'model', key: 'estate', x: 400, z: 400, ry: 0, scale: 0.7, trim: false }
    ],

    /* ---------- 掩体 ---------- */
    cover: [
      { t: 'sandline', x: 132, z: 138, len: 12, horiz: true },
      { t: 'sandline', x: 168, z: 138, len: 12, horiz: true },
      { t: 'sandline', x: 132, z: 162, len: 12, horiz: true },
      { t: 'sandline', x: 168, z: 162, len: 12, horiz: true },
      { t: 'sandline', x: 150, z: 129, len: 10, horiz: true },
      { t: 'sandline', x: 150, z: 171, len: 10, horiz: true },
      { t: 'barrier', x: 150, z: 90, horiz: false },
      { t: 'barrier', x: 150, z: 210, horiz: false },
      { t: 'barrier', x: 90, z: 150, horiz: true },
      { t: 'barrier', x: 210, z: 150, horiz: true },
      { t: 'box', mat: 'crate', x: 114, z: 150, w: 1.4, h: 1.2, d: 1.4 },
      { t: 'box', mat: 'crate', x: 115.8, z: 150.6, w: 1.4, h: 1.2, d: 1.4 },
      { t: 'box', mat: 'crate', x: 186, z: 150, w: 1.4, h: 1.2, d: 1.4 },
      { t: 'box', mat: 'crate', x: 184.2, z: 149.4, w: 1.4, h: 1.2, d: 1.4 },
      { t: 'box', mat: 'crate', x: 150, z: 111, w: 2.2, h: 1.6, d: 2.2 },
      { t: 'box', mat: 'crate', x: 150, z: 189, w: 2.2, h: 1.6, d: 2.2 },
      { t: 'box', mat: 'crate', x: 74, z: 150, w: 2.0, h: 1.2, d: 2.0 },
      { t: 'box', mat: 'crate', x: 226, z: 150, w: 2.0, h: 1.2, d: 2.0 },
      { t: 'box', mat: 'concrete', x: 70, z: 70, w: 10, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 70, z: 62, w: 0.6, h: 1.3, d: 8 },
      { t: 'box', mat: 'concrete', x: 230, z: 230, w: 10, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 230, z: 238, w: 0.6, h: 1.3, d: 8 }
    ],

    /* ---------- 废墟 ---------- */
    ruins: {
      wallColor: 0x6b645c, rubbleColor: 0x544e48,
      walls: [
        { x: 252, z: 72, w: 9, h: 2.6, d: 0.5, ry: 0.3 },
        { x: 261, z: 84, w: 7, h: 1.8, d: 0.5, ry: -0.2 },
        { x: 243, z: 87, w: 0.5, h: 2.2, d: 7, ry: 0 },
        { x: 264, z: 96, w: 8, h: 2.8, d: 0.5, ry: 0.4 },
        { x: 255, z: 102, w: 0.5, h: 1.4, d: 6, ry: 0 },
        { x: 52, z: 225, w: 9, h: 2.4, d: 0.5, ry: -0.4 },
        { x: 42, z: 234, w: 7, h: 1.6, d: 0.5, ry: 0.2 },
        { x: 57, z: 240, w: 0.5, h: 2.0, d: 7, ry: 0 },
        { x: 272, z: 20, w: 7, h: 2.2, d: 0.5, ry: 0.5 },
        { x: 28, z: 272, w: 7, h: 2.2, d: 0.5, ry: -0.5 }
      ],
      rubble: [
        { x0: 234, x1: 280, z0: 57, z1: 111, n: 30, s0: 0.3, s1: 0.7 },
        { x0: 34, x1: 72, z0: 213, z1: 252, n: 26, s0: 0.3, s1: 0.6 },
        { x0: 258, x1: 292, z0: 8, z1: 40, n: 18, s0: 0.3, s1: 0.6 }
      ]
    },

    /* ---------- 装饰物 ---------- */
    props: {
      lamps: [[135, 45], [165, 45], [135, 255], [165, 255], [45, 135], [45, 165], [255, 135], [255, 165]],
      trees: [[20, 135], [20, 165], [280, 135], [280, 165], [135, 20], [165, 20], [135, 280], [165, 280]],
      towers: [[264, 36]]
    },

    /* ---------- 据点（必须 3 个：game.js 契约） ---------- */
    capturePoints: [
      { id: 'A', x: 150, z: 150 },  // 中央广场
      { id: 'B', x: 110, z: 108 },  // 蓝方侧
      { id: 'C', x: 215, z: 250 }   // 红方侧
    ],

    /* ---------- 出生点 ---------- */
    spawns: {
      blue: [[40, 40], [56, 30], [30, 56], [70, 45], [45, 70], [80, 84], [60, 26], [26, 60], [80, 34], [34, 80]],
      red: [[650, 650], [634, 660], [660, 634], [620, 645], [645, 620], [615, 628], [630, 664], [664, 630], [610, 656], [656, 610]]
    },

    /* ---------- 专属机制：空投补给 + 中央广场炮击（v1.2，规格见 design/maps/mechanics.md）----------
     * 周期空投：每 60s 从 drops 随机选一点投补给箱（信标警示 → 落箱），拾取回血/补弹药；
     * 周期炮击：每 45s 中央广场 zone 落弹（警示 4s → 伤害 60 / 半径 8m），压制 A 点周期。
     */
    mechanics: {
      type: 'airdrop',
      intervalSec: 60,
      drops: [
        { x: 220, z: 480 },   // 北区居民街
        { x: 500, z: 240 }    // 东区商业街
      ],
      crate: { heal: 50, ammoPct: 0.3 },
      arty: { intervalSec: 45, zone: { x: 350, z: 350, r: 28 }, warnSec: 4, dmg: 60, radius: 8 }
    },

    /* ---------- 缩圈（v1.3，规格见 design/maps/zone-br.md）----------
     * 圈心居中 (150,150)（suburb 为基准图 = 公平终局，最终圈覆盖 A 点中央广场大决战）；
     * 5 阶段：r0=220 覆盖全图 → 收缩比 0.62/0.40/0.26/0.14，伤害 1→3→6→10→15 HP/s；
     * 与 airdrop/arty 独立共存：终局 A 点 = 炮击+缩圈双压（预期难度）；owner=null 环境伤害。
     * ⚠️ 阶段语义：atSec≤t 取最后一个阶段为当前生效；到下一 atSec → warnSec 警示 5s → 2s 收缩。
     */
    zone: {
      center: { x: 350, z: 350 },
      phases: [
        { atSec: 0,   r: 520, dmgPerSec: 1 },
        { atSec: 135,  r: 321, dmgPerSec: 3 },
        { atSec: 315, r: 208,  dmgPerSec: 6 },
        { atSec: 495, r: 135,  dmgPerSec: 10 },
        { atSec: 675, r: 73,  dmgPerSec: 15 }
      ],
      warnSec: 5,
      color: 0x4d9bff
    },

    /* ---------- 小镇化：外围程序化街区（TownGen 在 World.load 前展开） ---------- */
    town: {
      seed: 20261101,
      max: 160,
      perBlock: 3,
      margin: 3,
      styles: {
        residential: ['house', 'house', 'house', 'house', 'house_small', 'house_small', 'apartment', 'guardhouse', 'container', 'watchtower', 'farmhouse'],
        commercial: ['apartment', 'warehouse', 'workshop', 'guardhouse', 'container', 'pillbox', 'pumpstation'],
        industrial: ['warehouse', 'warehouse', 'workshop', 'container', 'container', 'bunker', 'hangar', 'tankH', 'tankV', 'mast', 'pumpstation', 'guardhouse']
      },
      palette: {
        residential: [0x8a8f86, 0xb7b0a4, 0xd8c49a, 0xa9a29a],
        commercial: [0xb7b0a4, 0xc9b082, 0x9aa4a8],
        industrial: [0x7d8a94, 0x8a9396, 0x9aa4a8, 0x6e7880]
      },
      districts: [
        // 北区：住宅小镇（旧核心以北）
        { x0: 0, z0: 315, x1: 695, z1: 695, gw: 78, gd: 68, street: 11, style: 'residential', density: 0.9 },
        // 东区：商业 + 轻工业（旧核心以东）
        { x0: 315, z0: 0, x1: 695, z1: 310, gw: 92, gd: 80, street: 12, style: 'industrial', density: 0.85 },
        // 旧核心填空：低密度，不破坏原有地标
        { x0: 0, z0: 0, x1: 305, z1: 300, gw: 88, gd: 76, street: 11, style: 'commercial', density: 0.45, infill: true }
      ]
    },

    /* ---------- 小地图静态层 ---------- */
    minimap: {
      bg: '#202a33', roadColor: '#2e3a44', plazaColor: '#3a4854', wallColor: '#4a3a30',
      roads: [
        { x: 150, z: 150, w: 26, d: 300 },
        { x: 150, z: 150, w: 300, d: 26 }
      ],
      plaza: { x: 150, z: 150, w: 44, d: 44 }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
