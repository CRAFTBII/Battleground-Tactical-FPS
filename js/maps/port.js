/* ============================================
 * 战地突击 · js/maps/port.js — 地图 02「夜港工业区 Port」
 * --------------------------------------------
 * 设计定位：小尺寸(260) · 高垂直度 · 窄街密掩体 · 快节奏 · 冷蓝夜景
 * 与「城郊战场」的差异：街道 10~14m（城郊 26m）、3 处可上屋顶制高点、
 *                        集装箱把视线切成短段、雾近(40~200)压缩交战距离。
 * Schema 说明见 docs/architecture/map-architecture.md
 * 设计说明见 design/maps/port-gdd.md
 * v1.2：建筑 12→26（新增 hangar/bunker/pillbox/tower/container/wall/ruins/house）
 * v1.2：新增 mechanics.searchlight（探照灯+配电箱断电），规格见 design/maps/mechanics.md
 * v1.3：新增 zone 缩圈（圈心偏红侧 (165,150)，5 阶段半径 230→32、伤害 1→15 HP/s）
 * v1.4：新增地标 REF1「炼油厂 refinery」
 *
 * ★ v1.5 尺寸契约大修（本次）：
 *   问题：v1.2~v1.4 的 model 建筑全是手写 w/d/h，与 GLB 真实几何比例完全不符 —— 引擎按
 *         sx=w/rw、sy=h/rh、sz=d/rd 三轴独立缩放，于是建筑被非等比拉扁/压瘪：
 *           hangar 真 40×24×12 写成 20×14×5（高度压到 42%，卷帘门 2.9m→1.2m 进不去）
 *           tower  真 18.6×18.6×100 写成 4×4×8（压成 8%，成了个小方柱）
 *           ruins  真 33×16×28.5 写成 10×8×4；container 真 16.2×8.4×5 写成 6×6×5.2
 *           refinery 真 193×184.5×45.5 写成 20×14×12（等比 1/10，管廊全糊成一坨）
 *           bridge/stairs 高度全写 6（真 10 / 13）→ 台阶级高失真、梯顶够不到桥面
 *   修法：地图只写 scale（等比系数），w/d/h 由 BuildingLib.REAL_DIMS × scale 推导 →
 *         结构上不可能再出现拉伸。中小型一律 scale:1（真实尺寸），XL 地标按图幅取等比系数。
 *   分布：26 → 36 栋，按「街区」重排（街网把图切成 4×4 街区，每栋建筑完整落在一个街区内、
 *         不侵街、不压出生点/据点），并补齐 hangar/bunker/pillbox/container/wall/ruins 覆盖。
 * v1.6：集装箱码头强化（36→40 栋）—— 新增 CT5/CT6/CT7 三片货柜堆（强化「货柜切视线」主题）、
 *       PB4 南码头哨楼（与 PB1~PB3 成四面哨楼环）；延续 port-gdd（窄街密掩体/高垂直度/快节奏）。
 * v1.7：功能区 + 程序化主题建筑（40→48 栋）—— 北装卸区（龙门吊 CR1 横跨货柜堆场）、
 *       东南炼油区（TK1/TK2 卧式油罐 + refinery 油罐场）、西仓储区（TK3 立式油罐）、
 *       蓝红出生区门岗（GH1/GH2）；proc 建筑加 chimney 烟囱强化工业感。
 *   桥梯：Bridge1 (115,56.5) / Bridge2 (115,196.5) 中心对称跨纵主街，桥面 10.0m，
 *         两端 stairs 顶层楼板 9.5m —— 差 0.5m（< STEP_H 0.8）一步跨上。
 *
 * 街区速查（街网：纵主街 x[123,137] / 横主街 z[123,137] / 次街 x[69,79] x[181,191] z[91,101] z[159,169]）
 *   x 带：[0,69] [79,123] [137,181] [191,260]      z 带：[0,91] [101,123] [137,159] [169,260]
 *
 * 坐标语义备忘（与引擎实现一致，勿改）：
 *   type:'model' → x/z = 建筑「角点」(西南角)；BuildingLib 碰撞盒不随 ry 旋转 → 本图一律 ry:0
 *   type:'proc'  → x/z = 建筑「中心」；须满足 h === floors * floorH（否则屋顶板与墙顶错位）
 *   proc 的 rooftop 才会生成「可站立屋顶 + 上屋顶坡道」，model 建筑的屋顶平台无坡道
 *   rooftop.side 一律用 'west'：引擎里 'east' 的坡道是「背离建筑爬升」，顶端离屋檐 4m 上不去
 * ============================================ */
(function (root) {
  'use strict';
  if (!root.MapRegistry) { console.warn('[map:port] MapRegistry 未加载，跳过注册'); return; }

  root.MapRegistry.register({
    id: 'port',
    maxTeams: 3,
    name: '夜港工业区',
    desc: '冷雨夜的集装箱码头。窄街密掩体、三处可攀屋顶制高点，视线被厂房与货柜切成碎片，遭遇战一触即发。',
    theme: 'port',
    size: 390, // v2.9 地图扩大 ×1.5                // 比城郊小 40m → 转线更快、遭遇更密
    detail: 'high',

    /* ---------- 环境：冷蓝夜景 + 近雾（压缩交战距离，逼近身） ---------- */
    env: {
      fog: { color: 0x16212c, near: 60, far: 200 },
      background: 0x121a23,
      hemi: { sky: 0x2c4358, ground: 0x14181c, intensity: 0.6 },
      sun: {
        color: 0x9fc0ff, intensity: 0.62, pos: [-90, 150, -70],   // 月光/冷色，低强度长影
        target: [130, 130],  // D-05/T-04：size=260 中心，阴影覆盖整图
        shadow: { mapSize: 2048, extent: 241, far: 690 } // v2.9 地图 ×1.5 阴影放大          // 260×0.62≈161
      },
      ambient: { color: 0x4a6076, intensity: 0.46 }               // 夜景保底可视度（低于此值近战会瞎）
    },

    /* ---------- 地形：码头硬化地面，几乎平整（起伏交给建筑与货柜） ---------- */
    terrain: {
      seed: 20260906,
      amp: 1.6,               // 城郊 4.4 → 港区 1.6：硬化地坪，走位不被地形干扰
      seg: 96,
      colors: [0x2f3940, 0x39434a],
      colorMix: 0,
      flattenPad: 3,
      // v1.5：料堆缩小并整体挪进空街区内部（半径 ≈ peak×falloff ≈ 8.4m），
      //       避免「压平矩形边缘 = 断崖」出现在街道/地标脚下。
      mounds: [
        { x: 36, z: 182, peak: 1.2, falloff: 7, scale: 1.7 },   // 西北料堆（北次街与机库之间）
        { x: 240, z: 82.5, peak: 1.2, falloff: 7, scale: 1.7 }  // 东南料堆（炼油厂与南次街之间）
      ],
      // 建筑占地压平（中心 x, 中心 z, 宽, 深）—— v1.5 全部按「真实几何 × 等比 scale」重算
      flattenPads: [
        /* proc 4 栋 */
        [160, 112, 24, 16], [100, 150, 16, 14], [100, 74, 16, 12], [160, 186, 16, 12],
        /* legacy 型（真实几何，不参与缩放） */
        [41, 115, 22, 14], [219, 145, 22, 14],            // B3/B4 仓库 22×14
        [104, 110, 16, 12], [156, 150, 16, 12],           // B5/B6 公寓 16×12
        [48.1, 48.1, 4.2, 4.2], [212.1, 212.1, 4.2, 4.2], // B9/B10 哨塔 4.2²
        [133.25, 119.15, 14.5, 6.3], [114.75, 139.15, 14.5, 6.3], // B11/B12 掩体组 14.5×6.3
        [113.3, 24.3, 10.6, 8.6], [109.3, 228.3, 10.6, 8.6],      // HS1/HS2 民居 10.6×8.6
        /* v1.5 中型（scale 1.0 = 真实尺寸） */
        [36, 208, 40, 24], [159, 22, 40, 24],             // HG1/HG2 机库 40×24
        [93, 43, 18, 14], [149, 223, 18, 14],             // BK1/BK2 碉堡 18×14
        [58, 80, 12, 12], [202, 112, 12, 12], [222, 182, 12, 12], // PB1~PB3 哨楼 12×12
        [168.1, 76.2, 16.2, 8.4], [224.1, 112.2, 16.2, 8.4],      // CT1/CT2 货柜 16.2×8.4
        [94.1, 182.2, 16.2, 8.4], [168.1, 236.2, 16.2, 8.4],      // CT3/CT4 货柜
        [26.75, 238.7, 37.5, 1.4], [98.75, 86.7, 37.5, 1.4],      // WL1/WL2 围墙 37.5×1.4
        [30.5, 148, 33, 16],                              // RU1 残楼 33×16
        [201.3, 179.3, 18.6, 18.6],                       // TW1 摩天楼 18.6²
        /* 桥梯（桥 30×7 桥面 10m；梯 12×12 顶面 9.5m） */
        [130, 60, 30, 7], [109, 60, 12, 12], [151, 60, 12, 12],
        [130, 200, 30, 7], [109, 200, 12, 12], [151, 200, 12, 12],
        /* v1.5 地标 REF1 炼油厂（scale 0.3 → 57.9×55.35） */
        [224.95, 45.68, 57.9, 55.35],
        /* v1.6 新增（集装箱码头强化） */
        [66.1, 186.2, 16.2, 8.4],      // CT5 货柜堆（西北港区）
        [58, 152, 12, 12],             // PB4 哨楼（南码头入口）
        [126.1, 246.2, 16.2, 8.4],     // CT7 货柜堆（北港池沿）
        /* v1.7 功能区（装卸区 / 炼油区 / 门岗）—— 程序化主题建筑（PROC_GEOS） */
        [153, 45, 26, 10],             // CR1 龙门吊（北装卸区，横跨货柜通道）
        [168.1, 56.2, 16.2, 8.4],      // CT8 货柜（龙门吊南侧堆场，避开桥梯）
        [220, 82.5, 20, 9],            // TK1 卧式油罐（炼油厂油罐场）
        [242, 82.5, 20, 9],            // TK2 卧式油罐（炼油厂油罐场）
        [25, 135, 10, 10],             // TK3 立式油罐（西仓储区油桶）
        [20.5, 16.5, 5, 5],            // GH1 蓝侧门岗
        [212.5, 198.5, 5, 5],          // GH2 红侧门岗
        /* v1.8 紧凑布局（46→58 栋）：街区填空，建筑间距拉近到 8~20m */
        [35.3, 84.3, 10.6, 8.6],       // 民居 house(30,80)（蓝侧北沿）
        [20.1, 84.2, 16.2, 8.4],       // 货柜 container(12,80)（蓝侧掩体）
        [19.3, 112.3, 10.6, 8.6],      // 民居 house(14,108)（西民居）
        [48.1, 134.2, 16.2, 8.4],      // 货柜 container(40,130)（西仓储货柜）
        [31, 247, 22, 14],             // 货栈 warehouse(20,240)（西北货栈）
        [65.3, 244.3, 10.6, 8.6],      // 民居 house(60,240)（北港池沿）
        [89.3, 228.3, 10.6, 8.6],      // 民居 house(84,224)（北民居）
        [92.1, 204.2, 16.2, 8.4],      // 货柜 container(84,200)（北货柜）
        [248.1, 172.2, 16.2, 8.4],     // 货柜 container(240,168)（东货柜）
        [89.3, 132.3, 10.6, 8.6]       // 民居 house(84,128)（南民居，避开控制楼/次街）
      ],
      // 街网 / 装卸场 / 据点 / 出生区 / 屋顶坡道基座 压平
      flatten: [
        { x0: 123, x1: 137, z0: 0, z1: 260 },     // 纵主街（14m）
        { x0: 0, x1: 260, z0: 123, z1: 137 },     // 横主街（14m）
        { x0: 69, x1: 79, z0: 0, z1: 260 },       // 西次街（10m）
        { x0: 181, x1: 191, z0: 0, z1: 260 },     // 东次街（10m）
        { x0: 0, x1: 260, z0: 91, z1: 101 },      // 南次街（10m）
        { x0: 0, x1: 260, z0: 159, z1: 169 },     // 北次街（10m）
        { x0: 113, x1: 147, z0: 113, z1: 147 },   // 中央装卸场（据点 A）
        { x0: 64, x1: 84, z0: 86, z1: 106 },      // 据点 B
        { x0: 176, x1: 196, z0: 154, z1: 174 },   // 据点 C
        { x0: 0, x1: 70, z0: 0, z1: 70 },         // 蓝方出生区
        { x0: 190, x1: 260, z0: 190, z1: 260 },   // 红方出生区
        { x0: 143, x1: 148, z0: 102, z1: 122 },   // 主库屋顶坡道基座
        { x0: 87, x1: 92, z0: 64, z1: 84 },       // 西泵房屋顶坡道基座
        { x0: 147, x1: 152, z0: 176, z1: 196 }    // 东泵房屋顶坡道基座
      ]
    },

    /* ---------- 道路：紧凑街网（主街 14m / 次街 10m，城郊为 26m） ---------- */
    roads: {
      tex: 'asphalt', repeat: 42, thick: 0.12,
      strips: [
        { x: 130, z: 130, w: 14, d: 260 },   // 纵主街
        { x: 130, z: 130, w: 260, d: 14 },   // 横主街
        { x: 74, z: 130, w: 10, d: 260 },    // 西次街
        { x: 186, z: 130, w: 10, d: 260 },   // 东次街
        { x: 130, z: 96, w: 260, d: 10 },    // 南次街
        { x: 130, z: 164, w: 260, d: 10 },   // 北次街
        { x: 130, z: 130, w: 34, d: 34 }     // 中央装卸场
      ],
      markColor: 0xc8c49a, markY: 0.16,
      marks: [
        { axis: 'z', at: 130, from: 12, to: 250, step: 18, len: 3, w: 0.3 },
        { axis: 'x', at: 130, from: 12, to: 250, step: 18, len: 3, w: 0.3 }
      ]
    },

    /* ---------- 建筑（36 栋，v1.5 26→36）----------
     * 垂直度骨架：B1/B7/B8 三栋 proc 带 rooftop → 真·可攀屋顶（含坡道）
     *             B2 三层控制楼 → 纯遮挡地标（10.5m，切断东西向长视线）
     *             Bridge1/2 + 4 座 stairs → 两条跨主街的二层动线（桥面 10m）
     *             TW1 摩天楼（100m 实体）→ 唯一强制绕行的硬遮挡，切断 C 点↔红方出生区对角线
     * 尺寸契约：model 建筑一律只写 scale，w/d/h 由 REAL_DIMS×scale 推导（见文件头 ★v1.5）
     */
    buildings: [
      /* B1 集装箱主库（制高点·俯瞰 A 与东侧走廊） */
      {
        type: 'proc', x: 160, z: 112, w: 24, d: 16, h: 6,
        floors: 2, floorH: 3, thick: 0.5, windows: 2,
        doors: [[[10, 13.5]], [], [[10, 13.5]], []],   // 南/北对穿门 → 可打穿的通道
        wallTex: 'metal', detailTex: 'metal',
        rooftop: { side: 'west' },                      // 西侧坡道上 6m 屋顶（side 必须用 'west'，见文件头注）
        balcony: false, chimney: false, detail: 'high'
      },
      /* B2 塔吊控制楼（地标·三层 10.5m，切断东西长视线） */
      {
        type: 'proc', x: 100, z: 150, w: 16, d: 14, h: 10.5,
        floors: 3, floorH: 3.5, thick: 0.5, windows: 2,
        doors: [[[6, 9]], [[5, 8]], [], []],
        wallTex: 'concrete', detailTex: 'rust',   // C3：接线 rust —— 塔吊钢构锈蚀（art/theme §2.4）
        balconySide: 1, chimney: false, detail: 'high',
        glb: 'models/buildings/port_cranetower.glb'     // 占位插槽（proc 需引擎补 hook）
      },
      /* B7 西泵房（制高点·俯瞰据点 B） */
      {
        type: 'proc', x: 100, z: 74, w: 16, d: 12, h: 6,
        floors: 2, floorH: 3, thick: 0.5, windows: 2,
        doors: [[[6, 9]], [], [], [[4.5, 7.5]]],
        wallTex: 'corrugated', roofTex: 'corrugated', detailTex: 'concrete', // T-02：波纹钢（port 标志材质）
        rooftop: { side: 'west' },
        balcony: false, chimney: true, detail: 'high'   // v1.7：泵房烟囱（工业剪影）
      },
      /* B8 东泵房（制高点·俯瞰据点 C） */
      {
        type: 'proc', x: 160, z: 186, w: 16, d: 12, h: 6,
        floors: 2, floorH: 3, thick: 0.5, windows: 2,
        doors: [[], [[4.5, 7.5]], [[6, 9]], []],
        wallTex: 'corrugated', roofTex: 'corrugated', detailTex: 'concrete',
        rooftop: { side: 'west' },
        balcony: false, chimney: true, detail: 'high'   // v1.7：泵房烟囱（工业剪影）
      },

      /* ===== legacy 5 型（几何不参与缩放，scale:1 仅用于导航/精修对齐） ===== */
      /* B3 蓝侧堆场仓库 22×14×9.7（街区 x[0,69] z[101,123]） */
      {
        type: 'model', key: 'warehouse', x: 30, z: 108, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true },  // D-06：top=实测 9.70
        tint: 0x8fa0ad,                                      // T-01：冷灰蓝压暖砖（art/theme §2.4）
        glb: 'models/buildings/port_warehouse.glb'
      },
      /* B4 红侧堆场仓库（街区 x[191,260] z[137,159]） */
      {
        type: 'model', key: 'warehouse', x: 208, z: 138, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true },
        tint: 0x8fa0ad
      },
      /* B5 港务办公楼 16×12×19.1（近 A 西南角，室内多层近战） */
      {
        type: 'model', key: 'apartment', x: 96, z: 104, ry: 0, scale: 1,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }, // D-06：top=实测 19.10
        tint: 0x8c97a3,
        glb: 'models/buildings/port_office.glb'
      },
      /* B6 船员宿舍楼（近 A 东北角，与 B5 对称夹住中场；西沿距装卸场 1m 不吃据点圈） */
      {
        type: 'model', key: 'apartment', x: 148, z: 144, ry: 0, scale: 1,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] },
        tint: 0x8c97a3
      },
      /* B9/B10 出生区门岗塔 4.2×4.2×8.5（自带可站平台 7.4m） */
      { type: 'model', key: 'watchtower', x: 46, z: 46, ry: 0, scale: 1, trim: false, tint: 0x9aa0a6 },
      { type: 'model', key: 'watchtower', x: 210, z: 210, ry: 0, scale: 1, trim: false, tint: 0x9aa0a6 },
      /* B11/B12 装卸场货柜组 14.5×6.3×2.75（贴 A 外沿，制造进点必经的短掩体链） */
      { type: 'model', key: 'cover', x: 126, z: 116, ry: 0, scale: 1, trim: false },
      { type: 'model', key: 'cover', x: 107.5, z: 136, ry: 0, scale: 1, trim: false },
      /* HS1/HS2 港区民居 10.6×8.6×4.3（南北两片巷战跳板） */
      {
        type: 'model', key: 'house', x: 108, z: 20, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 104, z: 224, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },

      /* ===== v1.5 中型建筑（全部 scale:1 = 真实几何，杜绝拉伸） =====
       * 摆位原则：整栋落在一个街区内、离街边 ≥1m；卷帘门/门洞朝街区内侧或主街，保证可进入。
       */
      /* HG1 西北机库 40×24×12（中立西北翼锚点，卷帘门朝北 x[155,163]） */
      { type: 'model', key: 'hangar', x: 16, z: 196, ry: 0, scale: 1, tint: 0x7d8a94, trim: false },
      /* HG2 南部机库 40×24×12（南翼推进中继，与 HG1 关于中心近似对称） */
      { type: 'model', key: 'hangar', x: 139, z: 10, ry: 0, scale: 1, tint: 0x77848e, trim: false },
      /* BK1 蓝侧碉堡 18×14×8（B 点北侧支撑点，屋顶 8.4m 可站） */
      { type: 'model', key: 'bunker', x: 84, z: 36, ry: 0, scale: 1, tint: 0x8a9299, trim: false },
      /* BK2 红侧碉堡 18×14×8（北区纵深，掩护 Bridge2 北端） */
      { type: 'model', key: 'bunker', x: 140, z: 216, ry: 0, scale: 1, tint: 0x8a9299, trim: false },
      /* PB1 西南哨楼 12×12×5（蓝方出生区北出口第一个掩体） */
      { type: 'model', key: 'pillbox', x: 52, z: 74, ry: 0, scale: 1, tint: 0x99a3ab, trim: false },
      /* PB2 东侧哨楼（东次街以东、横主街南沿，压制进 C 走廊） */
      { type: 'model', key: 'pillbox', x: 196, z: 106, ry: 0, scale: 1, tint: 0x99a3ab, trim: false },
      /* PB3 红侧哨楼（红方出生区南门口，出门第一个掩体） */
      { type: 'model', key: 'pillbox', x: 216, z: 176, ry: 0, scale: 1, tint: 0x99a3ab, trim: false },
      /* CT1~CT4 货柜堆 16.2×8.4×5（双列双层，中央 3.2m 通道；顶面 5m 可站 = 低制高点）
       * 四角散布，把四条次街切成短段（港区的标志性掩体）。 */
      { type: 'model', key: 'container', x: 160, z: 72, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      { type: 'model', key: 'container', x: 216, z: 108, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      { type: 'model', key: 'container', x: 86, z: 178, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },
      { type: 'model', key: 'container', x: 160, z: 232, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },
      /* WL1/WL2 围墙 37.5×1.4×4.8（中段 5m 门洞 → 强制走门或绕行，把开阔街区切成两半） */
      { type: 'model', key: 'wall', x: 8, z: 238, ry: 0, scale: 1, tint: 0x6e7880, trim: false },
      { type: 'model', key: 'wall', x: 80, z: 86, ry: 0, scale: 1, tint: 0x6e7880, trim: false },
      /* RU1 西侧残楼 33×16×28.5（替代原手摆残墙；碰撞只到 12m，顶部纯视觉） */
      { type: 'model', key: 'ruins', x: 14, z: 140, ry: 0, scale: 1, tint: 0x7a8389, trim: false },

      /* ===== v1.6 集装箱码头强化（36→40 栋）：更多货柜堆切碎街视线 + 南码头哨楼 =====
       * CT5/CT6/CT7 补齐港区三片货柜堆（与 CT1~CT4 呼应，强化「集装箱码头」主题）；
       * PB4 卡住南码头入口，与 PB1~PB3 形成四面哨楼环。全部落街区内、不侵街不压出生点。
       */
      { type: 'model', key: 'container', x: 58, z: 182, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },  // CT5
      { type: 'model', key: 'pillbox', x: 52, z: 146, ry: 0, scale: 1, tint: 0x99a3ab, trim: false },     // PB4
      { type: 'model', key: 'container', x: 118, z: 242, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },  // CT7

      /* ===== v1.7 功能区：北装卸区 / 东南炼油区 / 西仓储区 / 门岗（程序化主题建筑）=====
       * CR1 龙门吊横跨货柜通道（CT8 堆场）→ 装卸区地标，一眼认出集装箱码头；
       * TK1/TK2 卧式油罐 + refinery 组成「炼油厂油罐场」；TK3 立式油罐在西仓储区；
       * GH1/GH2 蓝红出生区门岗。全部离街 ≥1m、不压出生点/据点/桥梯。 */
      { type: 'model', key: 'crane', x: 140, z: 40, ry: 0, scale: 1, tint: 0x8a6a4a, trim: false, glb: 'models/buildings/port_crane.glb' },        // CR1
      { type: 'model', key: 'container', x: 160, z: 52, ry: 0, scale: 1, tint: 0xa8603a, trim: false },   // CT8
      { type: 'model', key: 'tankH', x: 210, z: 78, ry: 0, scale: 1, tint: 0x9aa4a8, trim: false, glb: 'models/buildings/port_tankh.glb' },        // TK1
      { type: 'model', key: 'tankH', x: 232, z: 78, ry: 0, scale: 1, tint: 0x9aa4a8, trim: false, glb: 'models/buildings/port_tankh.glb' },        // TK2
      { type: 'model', key: 'tankV', x: 20, z: 130, ry: 0, scale: 1, tint: 0x8a9396, trim: false, glb: 'models/buildings/port_tankv.glb' },        // TK3
      { type: 'model', key: 'guardhouse', x: 18, z: 14, ry: 0, scale: 1, tint: 0x8fa0ad, trim: false, glb: 'models/buildings/port_guardhouse.glb' }, // GH1
      { type: 'model', key: 'guardhouse', x: 210, z: 196, ry: 0, scale: 1, tint: 0x8fa0ad, trim: false, glb: 'models/buildings/port_guardhouse.glb' }, // GH2

      /* ===== v1.8 紧凑布局（46→58 栋）：街区填空 =====
       * 用户要求「布局更紧凑」—— 四侧街区补建筑（蓝侧北沿/西民居/北仓储/北港池/东货柜/南民居），
       * 间距拉近到 8~20m；避开主/次街、桥梯、炼油厂视觉占地与出生点。 */
      {
        type: 'model', key: 'house', x: 30, z: 80, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 12, z: 80, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      {
        type: 'model', key: 'house', x: 14, z: 108, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 40, z: 130, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },
      {
        type: 'model', key: 'warehouse', x: 20, z: 240, ry: 0, scale: 1, tint: 0x8fa0ad,
        trim: { top: 9.7, cornice: true, pilaster: true }
      },
      {
        type: 'model', key: 'house', x: 60, z: 240, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 84, z: 224, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 84, z: 200, ry: 0, scale: 1, tint: 0xa8603a, trim: false },
      { type: 'model', key: 'container', x: 240, z: 168, ry: 0, scale: 1, tint: 0x9a5a38, trim: false },
      {
        type: 'model', key: 'house', x: 84, z: 128, ry: 0, scale: 1, tint: 0x88919a,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },

      /* ===== v1.5 地标 TW1：摩天楼 tower（真实 18.6×18.6×100）=====
       * 旧数据 N7/N8 把它写成 4×4×8（压到 8%）—— 是「建筑大小不对」最刺眼的一处，本次改为真实尺寸并只留一栋。
       * 碰撞已按实体修正（旧配置只有"四条腿"，人和子弹能穿墙）。
       * 角点 (192,170) → 占地 x[192,210.6] z[170,188.6]：卡在据点 C 十字口东北角，
       *   - 东次街 x[181,191] 东侧 1m、北次街 z[159,169] 北侧 1m（不侵街）；
       *   - 红方出生区 (190~260,190~260) 南侧 1.4m 不重叠；
       *   - 切断「中央装卸场 ↔ 红方出生区」对角长视线，红方必须绕行东次街或北次街。 */
      { type: 'model', key: 'tower', x: 192, z: 170, ry: 0, scale: 1, tint: 0x8c98a2, trim: false },

      /* ===== v1.3/v1.5 桥梯（6 元素）：天桥 × 2 + 台阶 × 4 =====
       * v1.5 改为真实尺寸：桥 30×7×10（桥面 10.0m）、梯 12×12×13（顶层楼板顶面 9.5m）。
       *   旧数据两者 h 都写 6 → 桥被压到 60%、梯被压到 46%，梯级高度失真到爬不上去（桥面永远够不到）。
       *   现在梯顶 9.5 → 桥面 10.0 差 0.5m（< STEP_H 0.8），一步跨上；台阶与桥端「边贴边」不重叠。
       * 布局：两座桥关于地图中心 (130,130) 对称跨纵主街（z=60 / z=200），
       *   桥墩（两端 1.2m）落在主街 x[123,137] 之外，台阶全在街区内不侵街。
       *   ⚠️ bridge 桥面+栏杆 collider 由引擎按 min.y≥OVERHEAD_Y 分流进 overhead（只挡弹道），
       *     否则 buildNavGrid 会把桥下地面标 blocked → 主街 A* 断（zone-br.md §7.3）。
       */
      /* Bridge1 南段天桥（x 115~145 / z 56.5~63.5，桥面 10m；西端 S1 东端 S2） */
      { type: 'model', key: 'bridge', x: 115, z: 56.5, ry: 0, scale: 1, tint: 0x7d8a94, trim: false },
      { type: 'model', key: 'stairs', x: 103, z: 54, ry: 0, scale: 1, tint: 0x6e7880, trim: false },  // S1
      { type: 'model', key: 'stairs', x: 145, z: 54, ry: 0, scale: 1, tint: 0x6e7880, trim: false },  // S2
      /* Bridge2 北段天桥（x 115~145 / z 196.5~203.5，与 Bridge1 中心对称；西端 S3 东端 S4） */
      { type: 'model', key: 'bridge', x: 115, z: 196.5, ry: 0, scale: 1, tint: 0x7d8a94, trim: false },
      { type: 'model', key: 'stairs', x: 103, z: 194, ry: 0, scale: 1, tint: 0x6e7880, trim: false }, // S3
      { type: 'model', key: 'stairs', x: 145, z: 194, ry: 0, scale: 1, tint: 0x6e7880, trim: false }, // S4

      /* ===== v1.4/v1.5 地标 REF1：炼油厂 refinery（东南工业锚点）=====
       * 真实几何 193×184.5×45.5（主厂房前向大门 + catwalk 检修层 + 2 冷却塔 + 3 烟囱）。
       * 旧数据写 20×14×12 ≈ 等比 1/10 —— 大门被压到 0.7m，玩家连门都进不去，看上去就是个"玩具盒"。
       * v1.5 取 scale 0.3 → 57.9×55.35×13.65：主厂房大门 3.0×2.1m（人体尺度成立），
       *       检修层 3.3m、冷却塔 11.4m、烟囱 13.2m，占 260 图 22% 宽度，正好填满东南街区。
       * 位置自证：角点 (196,18) → 占地 x[196,253.9] z[18,73.35]。
       *   - 东次街 x[181,191] 东侧 5m、南次街 z[91,101] 南侧 17.6m → 不堵街；
       *   - 红方出生区 (190~260,190~260) 以南 116m；蓝方出生区对角最远 —— 中立东南翼锚点。 */
      { type: 'model', key: 'refinery', x: 196, z: 18, ry: 0, scale: 0.3, tint: 0x7d8a94, trim: false, glb: 'models/out/battle_refinery.glb' }
    ],

    /* ---------- 掩体（36 处，密度约为荒漠前哨的 2.3 倍）----------
     * 集装箱（metal 6×2.6×2.5）负责切断街道长视线；沙袋/路障负责据点圈外沿的贴脸对枪。
     * v1.5：与新建筑 footprint 冲突的 3 处已让位（详见行末注释）。
     */
    cover: [
      /* — 据点 A：四角货柜 + 环形沙袋（圈内保持空旷，避免占点卡视野） — */
      { t: 'box', mat: 'metal', x: 116, z: 116, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 116, z: 119, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 144, z: 144, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 144, z: 141, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 140, z: 116, w: 2.5, h: 2.6, d: 6 },
      { t: 'box', mat: 'metal', x: 116, z: 146, w: 2.5, h: 2.6, d: 6 },   // v1.5 z144→146：避开 B12 掩体组
      { t: 'sandline', x: 130, z: 121, len: 10, horiz: true },
      { t: 'sandline', x: 130, z: 139, len: 10, horiz: true },
      { t: 'sandline', x: 121, z: 130, len: 10, horiz: false },
      { t: 'sandline', x: 139, z: 130, len: 10, horiz: false },
      { t: 'box', mat: 'crate', x: 126, z: 112, w: 1.6, h: 1.3, d: 1.6 },
      { t: 'box', mat: 'crate', x: 127.8, z: 110.8, w: 1.6, h: 1.3, d: 1.6 },
      { t: 'box', mat: 'crate', x: 134, z: 148, w: 1.6, h: 1.3, d: 1.6 },
      { t: 'box', mat: 'crate', x: 132.2, z: 149.2, w: 1.6, h: 1.3, d: 1.6 },
      /* — 据点 B（蓝侧十字口） — */
      { t: 'box', mat: 'metal', x: 64, z: 88, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 84, z: 104, w: 6, h: 2.6, d: 2.5 },
      { t: 'barrier', x: 74, z: 86, horiz: true },
      { t: 'barrier', x: 74, z: 106, horiz: true },
      { t: 'sandline', x: 66, z: 96, len: 8, horiz: false },
      { t: 'sandline', x: 82, z: 96, len: 8, horiz: false },
      /* — 据点 C（红侧十字口，与 B 点对称） — */
      { t: 'box', mat: 'metal', x: 196, z: 158, w: 6, h: 2.6, d: 2.5 },   // v1.5 z172→158：让位 TW1 摩天楼
      { t: 'box', mat: 'metal', x: 176, z: 156, w: 6, h: 2.6, d: 2.5 },
      { t: 'barrier', x: 186, z: 154, horiz: true },
      { t: 'barrier', x: 186, z: 174, horiz: true },
      { t: 'sandline', x: 194, z: 164, len: 8, horiz: false },
      { t: 'sandline', x: 178, z: 164, len: 8, horiz: false },
      /* — 街道断视线货柜（每 30m 一处，禁止出现 100m 直通走廊） — */
      { t: 'box', mat: 'metal', x: 130, z: 100, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 130, z: 160, w: 6, h: 2.6, d: 2.5 },
      { t: 'box', mat: 'metal', x: 100, z: 130, w: 2.5, h: 2.6, d: 6 },
      { t: 'box', mat: 'metal', x: 160, z: 130, w: 2.5, h: 2.6, d: 6 },
      { t: 'barrier', x: 130, z: 70, horiz: true },
      { t: 'barrier', x: 130, z: 190, horiz: true },
      /* — 出生区前沿掩体 — */
      { t: 'box', mat: 'concrete', x: 62, z: 56, w: 8, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 56, z: 62, w: 0.6, h: 1.3, d: 8 },
      { t: 'box', mat: 'concrete', x: 198, z: 204, w: 8, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 204, z: 198, w: 0.6, h: 1.3, d: 8 }
    ],

    /* ---------- 废墟：被拆的旧厂棚（两处对角，作为侧翼绕后路径的地标） ----------
     * v1.5：西北片让位 HG1 机库、东南片让位 REF1 炼油厂 —— 整体挪到相邻空地。
     */
    ruins: {
      wallColor: 0x555c62, rubbleColor: 0x3f464b,
      walls: [
        { x: 96, z: 240, w: 8, h: 2.6, d: 0.5, ry: 0.25 },
        { x: 106, z: 250, w: 6, h: 1.8, d: 0.5, ry: -0.2 },
        { x: 88, z: 252, w: 0.5, h: 2.2, d: 6, ry: 0 },
        { x: 210, z: 80, w: 8, h: 2.6, d: 0.5, ry: -0.3 },
        { x: 226, z: 84, w: 6, h: 1.8, d: 0.5, ry: 0.2 },
        { x: 240, z: 78, w: 0.5, h: 2.2, d: 6, ry: 0 }
      ],
      rubble: [
        { x0: 84, x1: 120, z0: 234, z1: 258, n: 22, s0: 0.3, s1: 0.6 },
        { x0: 196, x1: 250, z0: 76, z1: 88, n: 22, s0: 0.3, s1: 0.6 }
      ]
    },

    /* ---------- 装饰：码头灯柱（夜景可视度锚点）+ 龙门吊架，无树 ---------- */
    props: {
      lamps: [
        [118, 84], [142, 84], [118, 176], [142, 176],
        [84, 118], [84, 142], [176, 118], [176, 142],
        [66, 66], [194, 194], [130, 76], [130, 214], [58, 130], [202, 130]  // v1.5：58→76 / 202→214 避开两座天桥
      ],
      trees: [],
      towers: [[58, 182], [200, 84], [130, 240]]   // v1.5：(200,76)→(200,84) 避开 REF1 压平垫
    },

    /* ---------- 据点（恰好 3 个：game.js 契约）----------
     * A 中央装卸场；B/C 分别落在蓝/红侧次街十字口，关于中心点对称（±56, ±34）
     * 三点两两距离 ≈ 66m（城郊 ≈ 58m / 荒漠 ≈ 90m）→ 轮转最快
     */
    capturePoints: [
      { id: 'A', x: 130, z: 130 },   // 中央装卸场（四面进点，货柜遮挡）
      { id: 'B', x: 74, z: 96 },     // 蓝侧十字口（西泵房屋顶俯瞰）
      { id: 'C', x: 186, z: 164 }    // 红侧十字口（东泵房屋顶俯瞰 + TW1 摩天楼贴身遮挡）
    ],

    /* ---------- 出生点（西南 / 东北 对角） ---------- */
    spawns: {
      blue: [[26, 26], [42, 22], [22, 42], [58, 32], [32, 58], [60, 58], [18, 60], [60, 18], [40, 40], [44, 64]],
      red: [[234, 234], [218, 238], [238, 218], [202, 228], [228, 202], [200, 200], [242, 200], [200, 242], [220, 220], [216, 196]]
    },

    /* ---------- 专属机制：探照灯 + 断电（v1.2，规格见 design/maps/mechanics.md）----------
     * 4 盏巡逻探照灯架在制高点（主库/西泵房/东泵房/控制楼），光锥往复扫描；
     * 被扫到 → 曝露标记（小地图红点 + 轮廓）。配电箱 2 个（蓝/红侧各一）可交互断电，
     * 断电期全灯熄灭 + 夜战优势；对方可到面板抢修恢复（博弈见 GDD/mechanics.md）。
     * v1.5：4 盏灯全部架在 proc 建筑顶（本次未动 proc），坐标与配电箱保持不变。
     */
    mechanics: {
      type: 'searchlight',
      lights: [
        { x: 160, z: 112, yawDeg: -59, tiltDeg: -12, range: 45, sweepDeg: 35, speed: 25 },  // L1 主库顶 → 扫 A 中庭
        { x: 100, z: 74, yawDeg: -50, tiltDeg: -15, range: 40, sweepDeg: 30, speed: 30 },   // L2 西泵房顶 → 扫 B 点
        { x: 160, z: 186, yawDeg: 130, tiltDeg: -15, range: 40, sweepDeg: 30, speed: 30 },  // L3 东泵房顶 → 扫 C 点
        { x: 100, z: 150, yawDeg: 124, tiltDeg: -10, range: 55, sweepDeg: 45, speed: 20 }   // L4 控制楼顶 → 扫主街交叉
      ],
      powerPanels: [
        { x: 66, z: 88 },    // 蓝侧配电箱（B 点西北，蓝方主控）
        { x: 194, z: 158 }   // 红侧配电箱（C 点东南，红方主控）
      ],
      expose: { minimapPing: true }
    },

    /* ---------- 缩圈（v1.3，规格见 design/maps/zone-br.md）----------
     * 圈心偏红侧 (165,150)（port 终局偏向 C 点红侧主场，蓝方需长途奔袭）；
     * 5 阶段：r0=230 覆盖全图 → 收缩比 0.62/0.40/0.26/0.14，伤害 1→3→6→10→15 HP/s；
     * 与 searchlight 独立共存：不豁免、不干扰、伤害可叠加（owner=null 环境伤害）。
     * ⚠️ 阶段语义：atSec≤t 取最后一个阶段为当前生效；到下一 atSec → warnSec 警示 5s → 2s 收缩。
     */
    zone: {
      center: { x: 165, z: 150 },
      phases: [
        { atSec: 0,   r: 345, dmgPerSec: 1 },
        { atSec: 135,  r: 214, dmgPerSec: 3 },
        { atSec: 315, r: 138,  dmgPerSec: 6 },
        { atSec: 495, r: 90,  dmgPerSec: 10 },
        { atSec: 675, r: 48,  dmgPerSec: 15 }
      ],
      warnSec: 5,
      color: 0x4d9bff
    },

    /* ---------- 小地图静态层（冷蓝夜色） ---------- */
    minimap: {
      bg: '#0e161d', roadColor: '#1d2b35', plazaColor: '#2a3d4a', wallColor: '#46545c',
      roads: [
        { x: 130, z: 130, w: 14, d: 260 },
        { x: 130, z: 130, w: 260, d: 14 },
        { x: 74, z: 130, w: 10, d: 260 },
        { x: 186, z: 130, w: 10, d: 260 },
        { x: 130, z: 96, w: 260, d: 10 },
        { x: 130, z: 164, w: 260, d: 10 }
      ],
      plaza: { x: 130, z: 130, w: 34, d: 34 }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
