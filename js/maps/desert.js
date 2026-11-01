/* ============================================
 * 战地突击 · js/maps/desert.js — 地图 03「荒漠前哨 Desert」
 * --------------------------------------------
 * 设计定位：大尺寸(340) · 低垂直度 · 长视线 · 慢节奏 · 暖橙日照
 * 与「城郊战场」的差异：地图放大 40m、据点间距 ≈ 90m（城郊 ≈ 58m）、
 *                        建筑少而大且彼此远离、掩体稀疏但成"跳岛"链、
 *                        沙丘起伏 amp 7.0（城郊 4.4）制造天然遮蔽与高地。
 * Schema 说明见 docs/architecture/map-architecture.md
 * 设计说明见 design/maps/desert-gdd.md
 * v1.2：新增专属机制 sandstorm（周期沙暴）+ 水塔占领回血（D13 tower + mechanics）
 *        规格见 design/maps/mechanics.md
 * v1.3：新增 zone 缩圈（圈心偏蓝侧 (110,140)，5 阶段半径 315→44、伤害 1→15 HP/s），
 *        规格见 design/maps/zone-br.md；与 sandstorm 独立共存（圈外+风暴暴露=双压，预期戏剧性）。
 * v1.3：新增桥梯 3 元素 — Bridge1 跨纵主道 (155,116.5) + S1/S2 两端台阶（顶 6m 与桥面同高衔接）。
 *        ⚠️ bridge 桥面 collider 需工程 overhead 分流（见 zone-br.md §7.3），否则主道 A* 断。
 * v1.4：新增地标 BA1「前哨基地 base」— 角点 (60,160) · 24×18×8（蓝方推进走廊中段）
 *        与 MG1「巨塔 megatower」— 角点 (232,70) · 20×20×28（东北向中制空锚点，见 desert-gdd.md §4.8）
 *        （BuildingLib 新类型 key:'base'/'megatower'，工程注册前回退占位盒；GLB 插槽休眠）。
 * v1.6：补给站主题强化（26→30 栋）—— 红侧补给路「车队」货柜×2（CT3/CT4）、C 检查站村落民居、
 *       巨塔西南前哨哨楼（PB2）；保持 desert-gdd「少而大、彼此远离、开阔沙地」基调。
 * v1.8：新增地标 CX1「超大型综合体 complex」— 角点 (240,360) · 120×80×48（占地 9600㎡，全图最大单体），
 *       红方出生区北侧巨无霸：四面大门 14×8 可进 + 中庭 60×36 通高 + 4 层环廊 + 中央核心筒 + 4 角楼梯井。
 *       同时修复大型建筑可进入性：megatower/base/stadium/refinery 门洞全部加宽（≥3 nav cells 净空）、
 *       门楣抬到 nav 跳过阈值 2.6 之上（refinery 门楣 2.7m / base 门楣 sink 后 3.2m）、删 refinery 挡门立柱。
 *
 * 纹理备注：T-02 已新增 'sand'/'plaster' 程序化纹理（textures.js）。
 *           本图土路用 'sand'（沙地色），建筑主墙用 'plaster'（土坯），'concrete' 作中性线脚，
 *           沙地起伏由 terrain.colors 顶点色直接给（不依赖纹理）。
 *
 * 坐标语义备忘：model → 角点(ry 不旋转碰撞盒，故一律 ry:0)；proc → 中心，且 h === floors*floorH
 *               rooftop.side 一律用 'west'（引擎里 'east' 坡道背离建筑爬升，顶端够不到屋檐）
 * ============================================ */
(function (root) {
  'use strict';
  if (!root.MapRegistry) { console.warn('[map:desert] MapRegistry 未加载，跳过注册'); return; }

  root.MapRegistry.register({
    id: 'desert',
    maxTeams: 4,
    name: '荒漠前哨',
    desc: '烈日下的沙漠补给站。开阔中庭、绵延沙丘与稀疏残骸，据点相隔近百米——每一次穿越空地都是一次赌博。',
    theme: 'desert',
    size: 740, // v3.1 小镇化：510 → 740（北侧集市/居住区 + 东侧补给镇）
    detail: 'high',

    /* ---------- 环境：暖橙日照 + 远雾（热浪感，保留长视线） ---------- */
    env: {
      fog: { color: 0xd9b483, near: 200, far: 620 },
      background: 0xdcbd90,
      hemi: { sky: 0xffe8c4, ground: 0x6d5a3a, intensity: 0.95 },
      sun: {
        color: 0xfff1cc, intensity: 1.65, pos: [150, 190, -110],   // 高角度强日照，短硬阴影
        target: [370, 370],  // 新城中心；阴影相机运行时跟随玩家
        shadow: { mapSize: 2048, extent: 170, far: 420 }
      },
      ambient: { color: 0xc9a878, intensity: 0.3 }
    },

    /* ---------- 地形：大幅沙丘起伏 + 大范围压平区 ---------- */
    terrain: {
      seed: 20261012,
      amp: 7.0,               // 城郊 4.4 → 荒漠 7.0：沙地本体就是掩体
      seg: 208,               // PlaneGeometry 细分（740m 图）
      colors: [0xc3a56d, 0xb08f55],
      colorMix: 0,
      flattenPad: 5,
      // 沙丘（半径 ≈ peak*falloff，高度 ≈ peak*scale）——全部避开压平矩形，防止出现断崖
      // v1.5：沙丘全部让位给放大后的地标（base 89×74 / megatower 36×36 / tower 18.6²），
      //       避免「压平矩形边缘 = 断崖」。半径 ≈ peak×falloff。
      mounds: [
        { x: 58, z: 320, peak: 3.2, falloff: 13, scale: 2.5 },   // 西北远角大沙丘（≈8m，base 以北）
        { x: 318, z: 40, peak: 3.2, falloff: 13, scale: 2.5 },   // 东南远角大沙丘（≈8m，megatower 以南）
        { x: 208, z: 30, peak: 2.6, falloff: 12, scale: 2.2 },   // 南缘丘
        { x: 40, z: 96, peak: 2.6, falloff: 12, scale: 2.2 },    // 西侧丘（机库以南）
        { x: 312, z: 232, peak: 2.2, falloff: 11, scale: 2.0 },  // 东侧矮丘
        { x: 210, z: 300, peak: 2.2, falloff: 11, scale: 2.0 }   // 北侧矮丘
      ],
      // 建筑占地压平（中心 x, 中心 z, 宽, 深）—— v1.5 全部按「真实几何 × 等比 scale」重算
      flattenPads: [
        /* proc */
        [140, 206, 28, 20], [116, 90, 20, 14], [224, 250, 20, 14],
        /* legacy 型（scale 1.0） */
        [211, 139, 22, 14], [82, 138, 16, 12], [266, 202, 16, 12],
        [135, 243, 22, 14], [273, 135, 22, 14],
        [64.1, 64.1, 4.2, 4.2], [276.1, 276.1, 4.2, 4.2], [152.1, 132.1, 4.2, 4.2],
        [203.25, 153.15, 14.5, 6.3], [136.25, 185.15, 14.5, 6.3],
        /* v1.5 新增中型（真实尺寸） */
        [48, 138, 40, 24],            // HG1 机库 40×24
        [241, 275, 18, 14],           // BK1 碉堡 18×14（v1.6 北移）
        [74, 106, 12, 12],            // PB1 哨楼 12×12
        [140.1, 144.2, 16.2, 8.4],    // CT1 货柜 16.2×8.4
        [224.1, 154.2, 16.2, 8.4],    // CT2 货柜
        [302.5, 148, 33, 16],         // RU1 残楼 33×16
        [114.75, 150.7, 37.5, 1.4],   // WL1 围墙 37.5×1.4
        /* 桥梯（真实尺寸：桥 30×7 桥面 10m；梯 12×12 顶面 9.5m） */
        [170, 120, 30, 7], [149, 122.5, 12, 12], [191, 122.5, 12, 12],
        /* v1.5 三地标：base 89.2×73.6（scale .4）/ megatower 36×36（1.0）/ tower 18.6×18.6（1.0） */
        [64.6, 236.8, 89.2, 73.6], [268, 88, 36, 36], [203.3, 201.3, 18.6, 18.6],
        /* v1.6 新增（补给车队 / 检查站村落 / 巨塔前哨） */
        [158.1, 244.2, 16.2, 8.4],    // CT3 货柜（红侧补给车队，避开 D7 废弃库）
        [204.1, 254.2, 16.2, 8.4],    // CT4 货柜（红侧补给车队，避开 D6 车库）
        [241.3, 194.3, 10.6, 8.6],    // 民居 house(236,190)（检查站村落）
        [242, 106, 12, 12],           // PB2 哨楼（巨塔西南前哨）
        /* v1.7 功能区（前哨营地 / 补给站 / 检查站 / 通讯塔）—— 程序化主题建筑 */
        [152.5, 192.5, 5, 5],         // GH1 营地南门岗
        [174.5, 232.5, 5, 5],         // GH2 营地东门岗
        [123, 163, 10, 10],           // TK1 补给站立式油罐
        [55, 173, 6, 6],              // MS1 蓝侧通讯塔
        [234.5, 208.5, 5, 5],         // GH3 红侧检查站岗亭
        [253, 133, 6, 6],             // MS2 巨塔旁通讯塔
        [121, 205, 10, 10],           // TK2 基地补给油罐
        /* v1.8 紧凑布局（37→45 栋）：前哨链填空，间距拉近到 10~25m */
        [45.3, 104.3, 10.6, 8.6],     // 民居 house(40,100)（蓝侧前哨链）
        [93.3, 84.3, 10.6, 8.6],      // 民居 house(88,80)（蓝侧北）
        [185.3, 132.3, 10.6, 8.6],    // 民居 house(180,128)（中庭东）
        [188.1, 204.2, 16.2, 8.4],    // 货柜 container(176,200)（营地东，避开 TW1 塔）
        [285.3, 204.3, 10.6, 8.6],    // 民居 house(280,200)（红侧民居）
        [288.1, 244.2, 16.2, 8.4],    // 货柜 container(280,240)（红侧东）
        [302.5, 238.5, 5, 5],         // 岗亭 guardhouse(300,236)（检查站东岗）
        [325.3, 184.3, 10.6, 8.6],    // 民居 house(320,180)（东缘民居）
        /* v1.8 超大型综合体 CX1（120×80，角点 240,360 → 中心 300,400）：红方出生区北侧巨无霸 */
        [300, 400, 120, 80]
      ],
      // 土路 / 中庭 / 据点 / 出生区 / 屋顶坡道基座 压平
      flatten: [
        { x0: 161, x1: 179, z0: 0, z1: 340 },     // 纵主道（18m）
        { x0: 0, x1: 340, z0: 161, z1: 179 },     // 横主道（18m）
        { x0: 147, x1: 193, z0: 147, z1: 193 },   // 中央前哨中庭（据点 A）
        { x0: 55, x1: 205, z0: 112, z1: 124 },    // 蓝侧支路（通往据点 B）
        { x0: 135, x1: 285, z0: 216, z1: 228 },   // 红侧支路（通往据点 C）
        { x0: 84, x1: 108, z0: 106, z1: 130 },    // 据点 B
        { x0: 232, x1: 256, z0: 210, z1: 234 },   // 据点 C
        { x0: 0, x1: 80, z0: 0, z1: 80 },         // 蓝方出生区
        { x0: 260, x1: 340, z0: 260, z1: 340 },   // 红方出生区
        { x0: 118, x1: 126, z0: 196, z1: 216 }    // 主堡屋顶坡道基座（D1 西移后同步）
      ]
    },

    /* ---------- 道路：稀疏土路（主道 18m + 两条侧向补给路） ---------- */
    roads: {
      tex: 'sand', repeat: 34, thick: 0.1,    // C3：接线 sand —— 荒漠土路（art/theme §3.4，勿用 sandbag 铺路）
      strips: [
        { x: 170, z: 170, w: 18, d: 340 },    // 纵主道
        { x: 170, z: 170, w: 340, d: 18 },    // 横主道
        { x: 130, z: 118, w: 150, d: 12 },    // 蓝侧支路（x 55~205）
        { x: 210, z: 222, w: 150, d: 12 },    // 红侧支路（x 135~285）
        { x: 170, z: 170, w: 46, d: 46 }      // 中央前哨中庭
      ],
      markColor: 0xbfae86, markY: 0.14,
      marks: []                                // 荒漠土路无标线（留空 = 不生成）
    },

    /* ---------- 建筑（13 栋）----------
     * 少而大、彼此远离：单栋占地是港区的 1.3~1.5 倍，但间距 60~90m，
     * 建筑之间是需要冲锋通过的开阔沙地——这正是"慢节奏"的来源。
     * 垂直度刻意压低：全图只有 1 处可攀屋顶（D1 主堡 7m），其余高度来自沙丘。
     * v1.2：D13 水塔（tower）为专属机制「沙暴+水塔」的占领回血设施位，见 mechanics。
     */
    buildings: [
      /* D1 中央前哨主堡（地标 + 可攀屋顶）—— v1.5 东移 8m 给 BA1 基地让位 */
      {
        type: 'proc', x: 140, z: 206, w: 28, d: 20, h: 7,
        floors: 2, floorH: 3.5, thick: 0.6, windows: 3,
        doors: [[[8, 12]], [[6, 9]], [], []],   // C2：南门/东门避开窗位（南窗 [13.3,14.7]、东窗 [9.3,10.7]），消除门中墙墩
        wallTex: 'plaster', roofTex: 'plaster', detailTex: 'concrete', // T-02：土坯灰泥（desert 主题，勿用 brick）
        rooftop: { side: 'west' },                     // 西侧坡道上 7m 屋顶
        balcony: false, chimney: false, detail: 'high',
        glb: 'assets/buildings/out/desert_fort.glb'        // 占位插槽（T4 已补 glbSlot 钩子；无 GLTFLoader 故休眠）
      },
      /* D2 军需库（近 A 东南，长视线走廊的锚点）—— v1.5 东移让开 S2 台阶 */
      {
        type: 'model', key: 'warehouse', x: 200, z: 132, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true }, // D-06：top=实测 9.70
        tint: 0xd8c49a,                                    // T-01：土黄
        glb: 'assets/buildings/out/desert_depot.glb'
      },
      /* D3 蓝侧观察塔楼（19.1m 高，据点 B 的制空视野）—— v1.5 东移让开 HG1 机库 */
      {
        type: 'model', key: 'apartment', x: 74, z: 132, ry: 0, scale: 1,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] }, // D-06：top=实测 19.10
        tint: 0xd0b58c,
        glb: 'assets/buildings/out/desert_outpost.glb'
      },
      /* D4 蓝侧补给棚（单层大跨度，据点 B 的南向掩护） */
      {
        type: 'proc', x: 116, z: 90, w: 20, d: 14, h: 4.5,
        floors: 1, floorH: 4.5, thick: 0.5, windows: 2,
        doors: [[], [], [[8, 11.5]], [[5, 8]]],
        wallTex: 'plaster', roofTex: 'plaster', detailTex: 'concrete',
        chimney: true, detail: 'high'   // v1.7：棚屋烟囱（营地生活感）
      },
      /* D5 红侧指挥所（与 D3 关于中心对称） */
      {
        type: 'model', key: 'apartment', x: 258, z: 196, ry: 0, scale: 1,
        trim: { top: 19.1, cornice: true, pilaster: true, bands: [4, 8, 12] },
        tint: 0xd0b58c
      },
      /* D6 红侧车库（与 D4 关于中心对称） */
      {
        type: 'proc', x: 224, z: 250, w: 20, d: 14, h: 4.5,
        floors: 1, floorH: 4.5, thick: 0.5, windows: 2,
        doors: [[[8, 11.5]], [[5, 8]], [], []],
        wallTex: 'plaster', roofTex: 'plaster', detailTex: 'concrete',
        chimney: true, detail: 'high'   // v1.7：车库烟囱（营地生活感）
      },
      /* D7/D8 外围废弃库（远端地标，给绕后路线一个目标）—— v1.5 D7 东移，原位被 BA1 基地占用 */
      {
        type: 'model', key: 'warehouse', x: 124, z: 236, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true },
        tint: 0xd8c49a
      },
      {
        type: 'model', key: 'warehouse', x: 262, z: 128, ry: 0, scale: 1,
        trim: { top: 9.7, cornice: true, pilaster: true },
        tint: 0xd8c49a
      },
      /* D9/D10 出生区哨塔 */
      { type: 'model', key: 'watchtower', x: 62, z: 62, ry: 0, scale: 1, trim: false, tint: 0xc9b082 },
      { type: 'model', key: 'watchtower', x: 274, z: 274, ry: 0, scale: 1, trim: false, tint: 0xc9b082 },
      /* D11/D12 中庭外沿掩体组（进 A 前最后一段掩护） */
      { type: 'model', key: 'cover', x: 196, z: 150, ry: 0, scale: 1, trim: false },
      { type: 'model', key: 'cover', x: 129, z: 182, ry: 0, scale: 1, trim: false },
      /* D13 水塔（v1.2 专属机制：占领回血设施，机制数据在 mechanics.tower；坐标=角点）
       * v1.5：原来用 key:'tower'（真实是 18.6×18.6×100 的摩天楼）硬写成 4×4×8 —— 等于把一栋
       *       百米高楼压成 8% 高度的小方块，是「建筑大小不对」最刺眼的一处。
       *       水塔本就是小设施 → 改用 watchtower（4.2×4.2×8.5，自带可站平台），占领圈 r10 保持可站。 */
      { type: 'model', key: 'watchtower', x: 150, z: 130, ry: 0, scale: 1, tint: 0xc9b082, trim: false },

      /* ===== v1.5 新增中型建筑（全部 scale:1 = 真实几何尺寸，杜绝拉伸）=====
       * 补齐 13 类模型建筑在本图的覆盖，并为放大后的地标提供体量过渡。 */
      /* HG1 蓝侧机库 40×24×12（据点 B 西侧掩护，卷帘门朝北可进） */
      { type: 'model', key: 'hangar', x: 28, z: 126, ry: 0, scale: 1, tint: 0xd8c49a, trim: false },
      /* BK1 红侧碉堡 18×14×8（据点 C 北侧支撑点，屋顶可站）—— v1.6 北移避开 D6 车库 */
      { type: 'model', key: 'bunker', x: 232, z: 268, ry: 0, scale: 1, tint: 0xc9b082, trim: false },
      /* PB1 蓝侧哨楼 12×12×5（据点 B 西南前哨） */
      { type: 'model', key: 'pillbox', x: 68, z: 100, ry: 0, scale: 1, tint: 0xc9b082, trim: false },
      /* CT1/CT2 货柜组 16.2×8.4×5（双层可攀，长视线上的"跳岛"制高点） */
      { type: 'model', key: 'container', x: 132, z: 140, ry: 0, scale: 1, trim: false },
      { type: 'model', key: 'container', x: 216, z: 150, ry: 0, scale: 1, trim: false },
      /* RU1 东侧残楼 33×16×28.5（替代原手摆残墙，给东翼一个真正的地标） */
      { type: 'model', key: 'ruins', x: 286, z: 140, ry: 0, scale: 1, tint: 0x8d7c5c, trim: false },
      /* WL1 蓝侧围墙 37.5×1.4×4.8（中段 5m 门洞，把 B→A 切成两条路线） */
      { type: 'model', key: 'wall', x: 96, z: 150, ry: 0, scale: 1, tint: 0xc9b082, trim: false },

      /* ===== v1.6 补给车队 / 检查站村落 / 巨塔前哨（26→30 栋，desert-gdd「少而大」基调内补齐）=====
       * CT3/CT4 沿红侧补给路(z[216,228])南侧排成「车队」——补给站主题（避开 D6/D7 占地）；
       * house(236,190) 与 D5 指挥所组成 C 检查站小村落；
       * PB2 卡在巨塔西南进塔走廊，给 MG1 一个地面护卫。 */
      { type: 'model', key: 'container', x: 150, z: 240, ry: 0, scale: 1, tint: 0xc9b082, trim: false },  // CT3
      { type: 'model', key: 'container', x: 196, z: 250, ry: 0, scale: 1, tint: 0xd8c49a, trim: false },  // CT4
      {
        type: 'model', key: 'house', x: 236, z: 190, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'pillbox', x: 236, z: 100, ry: 0, scale: 1, tint: 0xc9b082, trim: false },    // PB2

      /* ===== v1.7 功能区（前哨营地 / 补给站 / 检查站 / 通讯塔，30→37 栋）=====
       * GH1/GH2 岗亭把 D1 主堡围成「前哨营地」（南/东门岗）；TK1 立式油罐 + 水塔组成补给站储油区；
       * MS1/MS2 桁架天线塔给荒漠补通讯/观察制高点（蓝侧 + 巨塔旁）；
       * GH3 检查站岗亭 + D5 指挥所 + 民居村落组成 C 检查站；TK2 基地补给油罐（BA1 东侧）。
       * 程序化主题建筑（PROC_GEOS），全部离主道 ≥2m、不压出生点/据点。 */
      { type: 'model', key: 'guardhouse', x: 150, z: 190, ry: 0, scale: 1, tint: 0xd0b58c, trim: false, glb: 'assets/buildings/out/desert_guardhouse.glb' }, // GH1
      { type: 'model', key: 'guardhouse', x: 172, z: 230, ry: 0, scale: 1, tint: 0xd0b58c, trim: false, glb: 'assets/buildings/out/desert_guardhouse.glb' }, // GH2
      { type: 'model', key: 'tankV', x: 118, z: 158, ry: 0, scale: 1, tint: 0xb09a70, trim: false, glb: 'assets/buildings/out/desert_tankv.glb' },          // TK1
      { type: 'model', key: 'mast', x: 52, z: 170, ry: 0, scale: 1, tint: 0x8d7c5c, trim: false, glb: 'assets/buildings/out/desert_mast.glb' },             // MS1
      { type: 'model', key: 'guardhouse', x: 232, z: 206, ry: 0, scale: 1, tint: 0xd0b58c, trim: false, glb: 'assets/buildings/out/desert_guardhouse.glb' }, // GH3
      { type: 'model', key: 'mast', x: 250, z: 130, ry: 0, scale: 1, tint: 0x8d7c5c, trim: false, glb: 'assets/buildings/out/desert_mast.glb' },             // MS2
      { type: 'model', key: 'tankV', x: 116, z: 200, ry: 0, scale: 1, tint: 0xb09a70, trim: false, glb: 'assets/buildings/out/desert_tankv.glb' },          // TK2

      /* ===== v1.8 紧凑布局（37→45 栋）：前哨链填空 =====
       * 用户要求「布局更紧凑」—— 蓝侧前哨链/中庭东/红侧民居/检查站东岗补建筑，
       * 间距拉近到 10~25m；保持 desert「核心区密集、外围留空」的开阔感。 */
      {
        type: 'model', key: 'house', x: 40, z: 100, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 88, z: 80, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      {
        type: 'model', key: 'house', x: 180, z: 128, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 5.8, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 176, z: 200, ry: 0, scale: 1, tint: 0xc9b082, trim: false },
      {
        type: 'model', key: 'house', x: 280, z: 200, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 7.6, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },
      { type: 'model', key: 'container', x: 280, z: 240, ry: 0, scale: 1, tint: 0xd8c49a, trim: false },
      { type: 'model', key: 'guardhouse', x: 300, z: 236, ry: 0, scale: 1, tint: 0xd0b58c, trim: false, glb: 'assets/buildings/out/desert_guardhouse.glb' },
      {
        type: 'model', key: 'house', x: 320, z: 180, ry: 0, scale: 1, tint: 0xd0b58c,
        trim: { top: 4.0, cornice: true, chimney: { x: 2.4, z: 2.2, w: 0.9, d: 0.9, h: 2.0, base: 4.0 } }
      },

      /* ===== v1.3 新增桥梯（3 元素）：天桥 × 1 + 台阶 × 2 =====
       * 布局约束（zone-br.md §7.2/§7.3；探针自证见 test/port-density-probe.js）：
       *   - bridge 一律 ry:0（碰撞不随 ry 旋转）；stairs 顶 6m 与桥面 6m 同高、桥端 x 重叠 ≥2m
       *   - 桥墩落在纵主道两侧外侧；stairs 放街边不侵入主道(x≥161)
       *   - ⚠️ bridge 桥面+栏杆 collider 需工程按 min.y≥OVERHEAD_Y 分流进 overhead（否则主道 A* 断）
       */
      /* v1.5 桥梯改为真实尺寸：桥 30×7×10（桥面 10.0m）、梯 12×12×13（顶层楼板顶面 9.5m）。
       * 旧数据把两者的 h 都写成 6 —— 桥被压到 60%、梯被压到 46%，且梯段高度失真到爬不上去。
       * 现在梯顶 9.5 → 桥面 10.0 正好差 0.5m（< STEP_H 0.8），一步跨上；桥墩顶 9.6 也不再挡路。
       * 台阶与桥端「边贴边」摆放（梯东沿 x=155 = 桥西端），不重叠、无缝衔接。 */
      /* Bridge1 跨纵主道天桥（x 155~185 / z 116.5~123.5，桥面 10m；桥墩落在主道 x[161,179] 两侧外） */
      { type: 'model', key: 'bridge', x: 155, z: 116.5, ry: 0, scale: 1, tint: 0xc9b082, trim: false },
      /* S1 桥西端阶梯塔（x 143~155，不侵入主道；顶面 9.5m 接桥西端） */
      { type: 'model', key: 'stairs', x: 143, z: 116.5, ry: 0, scale: 1, tint: 0x8d7c5c, trim: false },
      /* S2 桥东端阶梯塔（x 185~197，避开 D2 军需库 x≥200；顶面 9.5m 接桥东端） */
      { type: 'model', key: 'stairs', x: 185, z: 116.5, ry: 0, scale: 1, tint: 0x8d7c5c, trim: false },

      /* ===== 地标 BA1：前哨基地 base（v1.5 重做）=====
       * 真实几何 223×184×65（battle_base.scad：围墙四门 + 3 层 HQ 迷宫 + 3 营房 + 2 机库 + 4 哨塔 + 雷达）。
       * 旧数据写 24×18×8 ≈ 等比 1/9 —— 门洞被压到 0.65m，玩家连门都进不去，看上去就是个"玩具盒"。
       * v1.5 取 scale 0.4 → 89.2×73.6×26（地坪以上 23.6m）：大门净高 2.4m、层高 3.6m，人体尺度成立，
       *       同时只占 340 图的 26% 宽度，不吃掉整个西北象限。
       * 位置自证：角点 (20,200) → 占地 x[20,109.2] z[200,273.6]。
       *   - 横主道 z[161,179] 以北 21m；纵主道 x[161,179] 以西 52m；D1 主堡 x[126,154] 东侧留 16.8m；
       *   - D7 废弃库 (124~146,236~250) 东侧留 14.8m；蓝出生区 (0~80,0~80) 以北 120m 不挡出生；
       *   - 西北沙丘/残骸场已整体北移让位（见 terrain.mounds / ruins.rubble）。 */
      { type: 'model', key: 'base', x: 20, z: 200, ry: 0, scale: 0.4, tint: 0xd8c49a, trim: false, glb: 'assets/buildings/out/battle_base.glb' },

      /* ===== 地标 MG1：巨塔 megatower（v1.5 回到真实尺寸）=====
       * 真实几何 36×36×145.48（11 层楼板 + 中央楼梯井 + 奇偶层隔间迷宫，可逐层登顶）。
       * 旧数据写 20×20×28 → 高度被压到 19%，11 层楼板挤成 2.5m 一层，内部迷宫完全失真。
       * scale 1.0：占地仅 36×36（图幅 10.6%），高度 145m 正是"制空锚点"的设计意图，不需要缩。
       * 位置自证：角点 (250,70) → 占地 x[250,286] z[70,106]。
       *   - 与 test/smoke.js §4.16③ 硬编码腿位 (251,71)/中庭 (262,82) 对齐（旧图放在 232,70 与测试不符）；
       *   - 纵主道 x[161,179] 以东 71m；红出生区 (260~340,260~340) 以南 154m；
       *   - 东南沙丘已南移到 (318,40)，rubble 场东移到 x[292,332]，均不压塔基。 */
      { type: 'model', key: 'megatower', x: 250, z: 70, ry: 0, scale: 1, tint: 0xc9b082, trim: false, glb: 'assets/buildings/out/battle_megatower.glb' },

      /* ===== 地标 TW1：摩天楼 tower（v1.5 新增）=====
       * 真实几何 18.6×18.6×100（实心楼体 70m + 两级退台 + 天线）。碰撞已按实体修正（旧配置只有"四条腿"）。
       * 角点 (194,192) → 占地 x[194,212.6] z[192,210.6]：卡在十字路口东北角，
       * 切断「中央中庭 ↔ 红方出生区」的对角长视线 —— 这是本图唯一一处强制绕行的硬遮挡。
       *   - 纵主道 x179 以东 15m；横主道 z179 以北 13m；红侧支路 z[216,228] 以南 5.4m。 */
      { type: 'model', key: 'tower', x: 194, z: 192, ry: 0, scale: 1, tint: 0xd0b58c, trim: false },

      /* ===== 地标 CX1：超大型综合体 complex（v1.8 新增）=====
       * 真实几何 120×80×48（battle_complex.scad：四面大门 14×8 可进 + 中庭 60×36 通高 + 4 层环廊
       * + 中央核心筒 + 4 角楼梯井；占地 9600㎡，全图最大单体）。
       * 角点 (240,360) → 占地 x[240,360] z[360,440]：
       *   - 红方出生区 z[260,340] 以北 20m（红方家门口要塞，双方皆可攻守）；
       *   - 纵主道 x[161,179] 以东 61m、横主道 z[161,179] 以北 181m，不压主道；
       *   - 据点 C(244,222) 东北 138m、megatower(250,70) 东北 290m，各不干扰；
       *   - 东北大区无沙丘（mounds 全在中部/南部），flattenPads 压平即可。 */
      { type: 'model', key: 'complex', x: 240, z: 360, ry: 0, scale: 1, tint: 0x8fa0ad, trim: false, glb: 'assets/buildings/out/battle_complex.glb' }
    ],

    /* ---------- 掩体（26 处 / 11.6 公顷 ≈ 2.2 处每公顷；港区 ≈ 5.0，差 2.2 倍）----------
     * 全部低矮（1.0~1.5m）：只能蹲守对枪，不切断长视线 —— 长视线是本图的核心张力。
     * 主干道沿线每 35~50m 布一处"跳岛"，保证冲锋有落脚点但不构成连续掩体链。
     */
    cover: [
      /* — 据点 A：环形沙袋工事 + 四角残墙路障（圈内空旷） — */
      { t: 'sandline', x: 170, z: 158, len: 14, horiz: true },
      { t: 'sandline', x: 170, z: 182, len: 14, horiz: true },
      { t: 'sandline', x: 158, z: 170, len: 14, horiz: false },
      { t: 'sandline', x: 182, z: 170, len: 14, horiz: false },
      { t: 'barrier', x: 152, z: 152, horiz: true },
      { t: 'barrier', x: 188, z: 188, horiz: true },
      { t: 'barrier', x: 188, z: 152, horiz: false },
      { t: 'barrier', x: 152, z: 188, horiz: false },
      /* — 据点 B（蓝侧补给站） — */
      { t: 'sandline', x: 96, z: 108, len: 10, horiz: true },
      { t: 'sandline', x: 96, z: 128, len: 10, horiz: true },
      { t: 'barrier', x: 84, z: 118, horiz: false },
      { t: 'box', mat: 'concrete', x: 110, z: 118, w: 2.4, h: 1.4, d: 2.4 },
      /* — 据点 C（红侧检查站，与 B 点对称） — */
      { t: 'sandline', x: 244, z: 212, len: 10, horiz: true },
      { t: 'sandline', x: 244, z: 232, len: 10, horiz: true },
      { t: 'barrier', x: 256, z: 222, horiz: false },
      { t: 'box', mat: 'concrete', x: 230, z: 222, w: 2.4, h: 1.4, d: 2.4 },
      /* — 主干道"跳岛"（间隔 35~50m，故意留出被打的窗口） — */
      { t: 'box', mat: 'sand', x: 170, z: 100, w: 5, h: 1.5, d: 1.0 },   // C3：中央围挡用 sand（土墙）
      { t: 'box', mat: 'sand', x: 170, z: 240, w: 5, h: 1.5, d: 1.0 },
      { t: 'box', mat: 'sand', x: 100, z: 170, w: 1.0, h: 1.5, d: 5 },
      { t: 'box', mat: 'sand', x: 240, z: 170, w: 1.0, h: 1.5, d: 5 },
      { t: 'box', mat: 'crate', x: 206, z: 170, w: 2, h: 1.4, d: 2 },
      { t: 'box', mat: 'crate', x: 134, z: 170, w: 2, h: 1.4, d: 2 },
      /* — 出生区前沿掩体 — */
      { t: 'box', mat: 'concrete', x: 76, z: 70, w: 10, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 70, z: 76, w: 0.6, h: 1.3, d: 10 },
      { t: 'box', mat: 'concrete', x: 264, z: 270, w: 10, h: 1.3, d: 0.6 },
      { t: 'box', mat: 'concrete', x: 270, z: 264, w: 0.6, h: 1.3, d: 10 }
    ],

    /* ---------- 废墟：被炸毁的旧哨所（两片，给空旷区一点战术纹理） ---------- */
    ruins: {
      wallColor: 0x8d7c5c, rubbleColor: 0x7a6a4a,
      // v1.5：东侧三面残墙已由真正的 RU1 残楼（33×16×28.5）取代；碎石场整体让位给 BA1 基地与 RU1。
      walls: [
        { x: 44, z: 292, w: 10, h: 2.8, d: 0.6, ry: -0.35 },
        { x: 34, z: 302, w: 8, h: 1.9, d: 0.6, ry: 0.25 },
        { x: 52, z: 312, w: 0.6, h: 2.3, d: 8, ry: 0 },
        { x: 208, z: 62, w: 9, h: 2.2, d: 0.6, ry: 0.5 },
        { x: 128, z: 296, w: 9, h: 2.2, d: 0.6, ry: -0.5 }
      ],
      rubble: [
        { x0: 292, x1: 332, z0: 96, z1: 132, n: 22, s0: 0.35, s1: 0.7 },   // RU1 残楼南侧散落带
        { x0: 24, x1: 68, z0: 284, z1: 326, n: 26, s0: 0.35, s1: 0.7 },    // BA1 基地以北
        { x0: 190, x1: 226, z0: 46, z1: 78, n: 18, s0: 0.3, s1: 0.6 }
      ]
    },

    /* ---------- 装饰：前哨探照灯柱 + 木架瞭望台；无树（荒漠无植被） ---------- */
    props: {
      lamps: [[152, 152], [188, 188], [152, 188], [188, 152], [96, 100], [256, 236]],
      trees: [],
      towers: [[128, 268], [240, 96], [170, 300], [170, 40]]
    },

    /* ---------- 据点（恰好 3 个：game.js 契约）----------
     * A 中央前哨中庭；B/C 落在两条侧向补给路上，关于中心点对称（±74, ±52）
     * A↔B / A↔C ≈ 90m，B↔C ≈ 181m —— 全图最长轮转距离，逼出"守点 + 车队推进"打法
     */
    capturePoints: [
      { id: 'A', x: 170, z: 170 },   // 中央前哨中庭（四面开阔，最难守）
      { id: 'B', x: 96, z: 118 },    // 蓝侧补给站（观察塔楼掩护）
      { id: 'C', x: 244, z: 222 }    // 红侧检查站（指挥所掩护）
    ],

    /* ---------- 出生点（西南 / 东北 对角） ---------- */
    spawns: {
      blue: [[36, 36], [52, 26], [26, 52], [64, 44], [44, 64], [70, 30], [30, 70], [56, 56], [20, 40], [40, 20]],
      red: [[690, 690], [674, 700], [700, 674], [660, 685], [685, 660], [655, 668], [670, 704], [704, 670], [650, 696], [696, 650]]
    },

    /* ---------- 专属机制：沙暴 + 水塔（v1.2，规格见 design/maps/mechanics.md）----------
     * 周期沙暴：风暴期雾骤浓（22/70）、AI 命中骤降、暴露者持续伤害；
     * 平静期恢复长视线。水塔（D13）为中立可占领设施，占领方圈内回血。
     */
    mechanics: {
      type: 'sandstorm',
      cycle: { stormSec: 30, calmSec: 90 },
      fog: { storm: { near: 22, far: 70 }, calm: { near: 180, far: 430 } },
      exposeDmg: 4,
      tower: { x: 152, z: 132, r: 15, healPerSec: 5 }
    },

    /* ---------- 缩圈（v1.3，规格见 design/maps/zone-br.md）----------
     * 圈心偏蓝侧 (110,140)（desert 终局偏向 B 点蓝侧主场，红方需长途奔袭；与 port 偏红对称）；
     * 5 阶段：r0=315 覆盖全图 → 收缩比 0.62/0.40/0.26/0.14，伤害 1→3→6→10→15 HP/s；
     * 与 sandstorm 独立共存：圈外+风暴暴露 = dmgPerSec+exposeDmg 双压；水塔回血圈外仍生效
     * （5 HP/s < P3 后 10~15 HP/s，不能赖圈外）。owner=null 环境伤害。
     * ⚠️ 阶段语义：atSec≤t 取最后一个阶段为当前生效；到下一 atSec → warnSec 警示 5s → 2s 收缩。
     */
    zone: {
      center: { x: 370, z: 370 },
      phases: [
        { atSec: 0,   r: 550, dmgPerSec: 1 },
        { atSec: 135,  r: 340, dmgPerSec: 3 },
        { atSec: 315, r: 220,  dmgPerSec: 6 },
        { atSec: 495, r: 143,  dmgPerSec: 10 },
        { atSec: 675, r: 77,  dmgPerSec: 15 }
      ],
      warnSec: 5,
      color: 0x4d9bff
    },

    /* ---------- 小镇化：北侧集市/居住区 + 东侧补给镇 ---------- */
    town: {
      seed: 20260805,
      max: 155,
      perBlock: 3,
      margin: 3,
      styles: {
        residential: ['house', 'house', 'house', 'house', 'apartment', 'guardhouse', 'container', 'watchtower', 'pillbox'],
        commercial: ['apartment', 'warehouse', 'guardhouse', 'container', 'pillbox', 'mast'],
        industrial: ['warehouse', 'warehouse', 'container', 'container', 'bunker', 'hangar', 'tankH', 'tankV', 'mast', 'guardhouse']
      },
      palette: {
        residential: [0xc9b082, 0xd8c49a, 0xb09a70, 0xa8926a],
        commercial: [0xc9b082, 0xd0b58c, 0xb09a70],
        industrial: [0xb09a70, 0x9a8560, 0xc9b082, 0x8d7c5c]
      },
      districts: [
        { x0: 0, z0: 505, x1: 735, z1: 735, gw: 82, gd: 70, street: 11, style: 'residential', density: 0.88 },
        { x0: 500, z0: 0, x1: 735, z1: 500, gw: 96, gd: 82, street: 12, style: 'industrial', density: 0.85 },
        { x0: 0, z0: 0, x1: 500, z1: 500, gw: 92, gd: 80, street: 11, style: 'commercial', density: 0.38, infill: true }
      ]
    },

    /* ---------- 小地图静态层（沙黄色调） ---------- */
    minimap: {
      bg: '#2b2114', roadColor: '#4a3c26', plazaColor: '#5b4a2e', wallColor: '#6e5c3e',
      roads: [
        { x: 170, z: 170, w: 18, d: 340 },
        { x: 170, z: 170, w: 340, d: 18 },
        { x: 130, z: 118, w: 150, d: 12 },
        { x: 210, z: 222, w: 150, d: 12 }
      ],
      plaza: { x: 170, z: 170, w: 46, d: 46 }
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
