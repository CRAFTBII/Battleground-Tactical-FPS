/* ============================================
 * 战地突击 · core.js（由 index.html 内联脚本拆分）
 * ============================================ */

'use strict';
/* ================================================================
 * 战地突击 Battleground — 单文件 FPS 战术射击
 * 章节：0 常量与工具  1 音频  2 纹理  3 世界  4 单位/武器/FX
 *       5 AI  6 对战逻辑/HUD  7 联机  8 主循环
 * ================================================================ */

/* ---------- 0. 常量 ---------- */
const CFG = {
  WORLD: 300, CELL: 2, EYE: 1.7, GRAV: 24, JUMP: 10.5, // 跳跃滞空高度 ≈ v²/2g ≈ 2.3m
  WALK: 4.4, SPRINT: 7.8, PLAYER_HP: 100, // 走 4.4 / 冲刺 7.8：冲刺显著快于 AI(3.6)，近身/脱离靠冲刺
  MATCH_TIME: 600, // 据点玩法：时间到比分高者胜；吃鸡制下另有「一方全灭提前结束」（v2.1）
  MORTAR_CD: 20, MORTAR_MAX: 10, SMOKE_TIME: 10,
  TEAM_SIZE: 10,          // 每队 10 人（玩家算蓝队 1 人，AI 补齐）
  CAP_POINTS: 3, CAP_R: 6, // 据点数量与占领半径
  // v2.7 任务驱动胜利语义：每局开局随机抽 1 个任务，任务决定终局判定与队伍规模
  // v2.8 任务绑定固定地图（选图=选任务，不再随机）；胜负始终=吃鸡淘汰（剩最后一队），任务只定对局主题/指标
  // （design/maps/missions-v27.md；teamSize 覆盖 TEAM_SIZE——KILLS 战场更密，人头更肥）
  MISSIONS: [
    { id: 'survive', name: '留到最后', teamSize: 10, mapId: 'suburb', desc: '你所在队伍存活到最后即胜；缩圈逼迫交火' },
    { id: 'kills',   name: '击杀王',   teamSize: 12, mapId: 'port',   desc: '累计击杀最高的队伍是主题；胜负仍看最后存活' },
    { id: 'control', name: '占领据点', teamSize: 10, mapId: 'desert', desc: '据点为整图分区；胜负仍看最后存活' }
  ],
  // v2.8 多队混战：最多 4 队；玩家永远在 blue（第 0 队）。队伍数由开局过渡页选择（2~图 maxTeams）
  TEAMS: ['blue', 'red', 'green', 'yellow'],
  TEAM_NAMES: { blue: '蓝队', red: '红队', green: '绿队', yellow: '黄队' },
  // 生存/淘汰制（v2.1 吃鸡修订，design/maps/respawn-rework.md）：全员一条命，死后不重生；
  // 倒地→流血→被救是唯一保命途径。只加机制层，不改手感数值（acc/移速/射速/伤害冻结）：
  mapScale: 1,            // = mapDef.size / 300（World.load 覆写 CFG.WORLD 后计算并缓存；suburb=1.0 / desert=1.133 / port=0.867，§4.7）
  BLEED_OUT: 20,          // [PLAYTEST] 15~25（时间类，固定）倒地流血倒计时。v2.1 拉长：淘汰制下无重生，必须给队友更长的救援窗口
  DOWN_HP: 60,            // [PLAYTEST] 50~80（固定）倒地执行池；敌方武器/环境伤害扣此池 → 归零处决
  REVIVE_TIME: 3,         // [PLAYTEST] 2.5~4（时间类，固定）持续救援读条时长；中断清零
  REVIVE_HP: 35,          // [PLAYTEST] 30~40（固定）被救起后血量（护甲/弹药保持倒地前）
  REVIVE_RANGE: 2.5,      // [PLAYTEST] 2~3（交互类，固定）救援判定距离（人手/枪口尺度，不随图缩放）
  CRAWL_SPEED: 1.2,       // [PLAYTEST] 1.0~1.6（固定）倒地爬行速度（玩家/AI 通用）
  SPAWN_PROT: 2.5,        // 出生无敌帧（仅开局出生使用；无重生后不再触发，保留常量防回归）
  SPAWN_PROT_RADIUS: 10,  // 出生点保护半径（m）· 固定（交互类）——离开即无敌失效
  SPAWN_JITTER: 4,        // 候选采样半径（m）· ×mapScale（空间类）smartSpawn 候选 8 方向抖动
  MEDIC_REVIVE_RANGE: 80, // [PLAYTEST] 60~100 · ×mapScale（空间类）医疗兵主动救援搜索半径。v2.1 加大：淘汰制下医疗兵是队伍续命引擎
  DEFAULT_REVIVE_RANGE: 12,// [PLAYTEST] 8~16 · 固定（交互类）非医疗兵顺手救援半径。v2.1 放宽：多救一个少减员一个
  WAVE_HOLD_RATIO: 0.5,   // [PLAYTEST] 0.4~0.6（无量纲，固定）进攻波次守势阈值
  // 观战（v2.1：玩家死亡后第三人称跟随存活 AI 队友，E/Q 切换）
  SPECTATE_DIST: 3.2,     // [PLAYTEST] 2.5~4（固定）观战相机跟随距离（目标后方）
  SPECTATE_HEIGHT: 1.6,   // [PLAYTEST] 1.2~2（固定）观战相机高度（相对目标脚底）
  // v2.2 仇恨机制（行为层目标选择，不碰 acc/移速/射速/伤害手感）：
  // 谁在攻击我（或我队友），我优先解决谁；仇恨每 HATE_REFRESH 秒刷新（衰减）一次
  HATE_SELF: 100,         // [PLAYTEST] 80~120 自己受伤 → 对攻击者仇恨值
  HATE_ALLY: 40,          // [PLAYTEST] 30~50 同队队友受伤（90m 内）→ 对攻击者仇恨值（旁观仇恨）
  HATE_WEIGHT: 0.6,       // [PLAYTEST] 0.4~0.8 仇恨换算目标评分：每点仇恨 −0.6 分（100 仇恨 ≈ 60m 距离优势）
  HATE_REFRESH: 3,        // [PLAYTEST] 2~5（秒）仇恨刷新周期：每 3s 衰减一次（用户口径："每隔几秒钟刷新仇恨"）
  HATE_DECAY: 0.5,        // [PLAYTEST] 0.4~0.7 每次刷新仇恨 ×0.5（蓝队；久不打自然淡忘）
  HATE_FLOOR: 15,         // [PLAYTEST] 10~20 低于此值清除仇恨（防全图永久记仇）
  HATE_RED_MULT: 1.25,    // [PLAYTEST] 1.0~1.5 红队受伤仇恨 ×1.25（记仇更深 → 被玩家打后盯得更紧，难度上调）
  HATE_RED_DECAY: 0.7,    // [PLAYTEST] 0.6~0.8 红队刷新衰减系数（更慢遗忘 → 仇恨持续更久）
  // v2.3 战利品箱规则（AI 弹药无限 / 箱子只在流血致死与玩家死亡生成）：
  AI_LOOT_MEDKIT_THRESHOLD: 3,  // [PLAYTEST] 2~4 AI 医疗包低于此值 → 主动找箱补医疗包（弹药无限后箱子对 AI 的价值 = 医疗包/护甲）
  AI_LOOT_ARMOR_THRESHOLD: 50,  // [PLAYTEST] 40~60 AI 护甲低于此值且未带护甲包 → 找箱补护甲
  PLAYER_LOOT_MEDKIT_MAX: 2,    // [PLAYTEST] 1~3 玩家死亡箱子医疗包上限（弹药不保留，只转护甲+部分医疗包）
  // v2.6 分散出生（阵营半区铺开，保留蓝/红分区开局）：
  SPAWN_SPREAD: 60,             // [PLAYTEST] 40~80 · ×mapScale（空间类）出生分散半径——以阵营出生区质心为锚随机落点
  SPAWN_SEP: 8,                 // [PLAYTEST] 6~12（交互-碰撞）出生最小间距——与已出生单位(含玩家)≥此距离，防叠点
  // v2.4 医疗包分配（救援耗包后重新平衡：医疗包 = 自愈 + 救援双用途稀缺资源）：
  PLAYER_START_MEDKITS: 6,      // [PLAYTEST] 5~7 玩家开局（自愈+救援双用；玩家不能像 AI 自动找箱，给足救 2~3 次队友的余量）
  AI_MEDIC_MEDKITS: 8,          // 医疗兵专职救援：8 包 = 8 次救援（v2.3 后 AI 还会捡箱补充）
  AI_MEDKITS: 4,                // [PLAYTEST] 3~5 非医疗兵（救援耗包后资源更紧张 → 更依赖捡箱，激活箱子经济闭环）
  AI_LOOT_MEDKIT_CHANCE: 0.75,  // [PLAYTEST] 0.6~0.85 AI 流血致死箱掉医疗包概率（医疗包价值上升，掉落跟上）
  // 出生评分（§4.3/§4.7：距离项 ×mapScale，权重项固定）
  TEAM_RANGE: 25, ENEMY_RANGE: 40,   // ×mapScale（空间-评分）
  EDGE_MARGIN: 10,                   // 圈边距（m）· ×mapScale（空间-评分）
  SPAWN_MIN_DIST: 3,                 // 出生不重叠（m）· 固定（交互-碰撞）
  SPAWN_NO_PLAYER: 25,               // AI 与玩家最小距离（m）· ×mapScale（空间-硬约束，红队不在玩家脸上刷）
  W_TEAMMATE: 15, W_ENEMY: 30, W_LOS: 20, W_EDGE: 5, // 评分权重（无量纲，不缩放）
  // 红蓝行为差异（§6.1，纯行为层，不碰 acc/射速/移速/伤害）
  RED_ASSERTIVE: 0.10,    // 红队突击手 engage 逼近概率 +10% [PLAYTEST] §9.2-9
  RED_DODGE_SHORTEN: 0.25, // 红队 dodge 时长缩短（更快回攻）
  // 队伍色单一数据源（可访问性 P0，art/accessibility.md §4）：
  // normal 靠明度分离（蓝 #5aa9ff / 红 #b3261e，灰度对比 2.66:1）；cvd 靠蓝-橙安全色相轴。
  // 任何 3D/HUD/小地图/记分板的队伍色必须引用此处，禁止再硬编码（收敛点）。
  // v2.8 多队混战：最多 4 队 blue/red/green/yellow；cvd 模式 4 队用形状编码补充（solid/dashed/dotted/cross）
  TEAM_COLORS: {
    normal: {
      blue:    { hex: 0x5aa9ff, css: '#5aa9ff', shape: 'solid'  },
      red:     { hex: 0xb3261e, css: '#b3261e', shape: 'dashed' },
      green:   { hex: 0x2e9e4f, css: '#2e9e4f', shape: 'dotted' },
      yellow:  { hex: 0xd99a1c, css: '#d99a1c', shape: 'cross'  },
      neutral: { hex: 0x707880, css: '#707880', shape: 'hollow' }
    },
    cvd: {
      blue:    { hex: 0x4dc3ff, css: '#4dc3ff', shape: 'solid'  },
      red:     { hex: 0xffa63d, css: '#ffa63d', shape: 'dashed' },
      green:   { hex: 0xb07cff, css: '#b07cff', shape: 'dotted' },
      yellow:  { hex: 0xff7bd5, css: '#ff7bd5', shape: 'cross'  },
      neutral: { hex: 0x707880, css: '#707880', shape: 'hollow' }
    }
  },
  // 当前配色模式：URL ?cvd=1 切色盲模式
  teamMode() {
    if (typeof location !== 'undefined' && location.search && /[?&]cvd=1/.test(location.search)) return 'cvd';
    return 'normal';
  },
  // 取队伍色：team = 'blue'|'red'|'neutral'；返回 {hex, css, shape}
  teamColor(team) { return this.TEAM_COLORS[this.teamMode()][team] || this.TEAM_COLORS.normal.neutral; }
};

/* ---------- 工具 ---------- */
const U = {
  clamp: (v, a, b) => v < a ? a : v > b ? b : v,
  lerp: (a, b, t) => a + (b - a) * t,
  easeOut: t => { const x = U.clamp(t, 0, 1); return 1 - Math.pow(1 - x, 3); }, // cubic easeOut：开镜动画减速收尾
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: arr => arr[Math.floor(Math.random() * arr.length)],
  dist2: (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; },
  dist: (ax, az, bx, bz) => Math.sqrt(U.dist2(ax, az, bx, bz)),
  angTo: (ax, az, bx, bz) => Math.atan2(bx - ax, bz - az),
  fmtT: s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
  // 种子随机
  mulberry32: seed => { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
};
// 2D 值噪声（地形起伏）
function makeNoise2D(seed) {
  const rnd = U.mulberry32(seed), size = 128, grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();
  const s = 0.12;
  return function (x, y) {
    x = (x % size + size) % size; y = (y % size + size) % size;
    const xi = Math.floor(x * s), yi = Math.floor(y * s);
    const xf = x * s - xi, yf = y * s - yi;
    const g = (a, b) => grid[((a + size) % size) * size + ((b + size) % size)];
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return U.lerp(U.lerp(g(xi, yi), g(xi + 1, yi), u), U.lerp(g(xi, yi + 1), g(xi + 1, yi + 1), u), v);
  };
}
