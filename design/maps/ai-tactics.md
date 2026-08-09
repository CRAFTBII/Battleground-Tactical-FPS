# AI 战术升级规格（AI Tactics）· v1.4「AI 战术升级」

> 项目：战地突击 Battleground Tactical FPS（Three.js r160）
> 作者：文策渊（design-strategist） · 版本：v1.4「AI 战术升级 + 四地标落地」
> 状态：**设计定稿**，数值待 [PLAYTEST] 微调
> 范围：`js/ai.js`（AIBrain 战术决策层）+ 三图地标（`js/maps/*.js`，见各图 GDD §4.8）
> 契约：**本文件只改"战术决策"，不改"数值手感"**（命中率 / 反应速度 / 射速 / 移速 / 伤害全部不动）——即用户拍板的「提难不加档」
> 对接机制：`js/mechanics.js`（searchlight 曝露 / sandstorm 庇护 / zone 缩圈）、`js/combat.js`（FX.smokes / Projectiles）、`js/items.js`（拾取）、`js/world.js`（colliders / coverPts / rayBlocked）

---

## 0. 设计原则（统一提难 → 纯战术层）

1. **不改数值手感**：命中率 `acc` 公式、视线重算 0.2s、受伤反应 1.6s、弹匣/换弹 5s、移动速度 3.6/6.2、武器伤害、护甲吸收 60%——**全部维持现状**。
2. **只加"决策维度"**：AI 的强体现在"知道该往哪走、什么时候用药、先打谁"，而不是"打得准/跑得快"。
3. **每项战术必须对接既有机制状态**（探照灯曝露 / 沙暴庇护 / 缩圈 / 烟雾 / 护甲），不新增独立系统；机制状态缺失（非对应地图）→ 该项自动跳过。
4. **战斗不被打断原则（延续 v1.3）**：已 engage（交火）时不因环境压力"中途逃跑"；环境压力只改**移动目标偏向**，不打断射击节奏（`tryShoot` / burst / fireT 不动）。
5. **三图适用性**：7 项战术是**跨图通用**能力，按地图机制自动启用（desert 才查沙暴、port 才查探照灯、任意图都查缩圈/烟雾/护甲/残血）——保证代码一套逻辑，数据驱动生效。
6. **[PLAYTEST] 标注**：所有新增可调参数统一标注，工程联调后按实测收敛（§8 汇总表）。

**为什么"提难不改档"**：难度档位（如 easy/normal/hard）会拆散玩家池与测试矩阵；v1.4 用"战术行为密度"提难——AI 更会躲沙暴/避灯/进圈/扔烟/打残血，但单发命中概率与玩家既有一致，避免"打不过是因为 AI 开挂"的挫败感。后续若仍不够难，先调 §8 的战术参数，不引入档位。

---

## 1. schema / 接入点契约（给工程）

全部在 `AIBrain` 内实现（新增方法 + 现有方法小改），**不改** `Mechanics` / `World` / `Game` / `Projectiles` 对外接口（只读取状态）：

```js
// AIBrain 新增/变更字段（初始化在 constructor）
this.exposedT = 0;        // ② 连续被曝露秒数（探照灯/沙暴）
this.retreatT = 0;        // ③ 边打边退冷却（防每帧改目标）
this.smokeCd = 0;         // ④ 投烟冷却
this.smokes = 0;          // ④ AI 烟雾弹数量（初始 0，拾取/补给获得）
this.armorkits = 0;       // ⑤ AI 护甲包数量（初始 0，拾取获得）
this.armorCd = 0;         // ⑤ 用护甲包冷却
this.evadeT = 0;          // ① 沙暴/探照灯庇护转移冷却

// AIBrain 新增方法（工程实现）
this.shelterDest();       // ① 最近庇护点（footprint/collider 外扩 2m 内可走点）
this.leaveConeDest();     // ② 最近光锥外点（锥外可走点；断电时返回 null）
this.retreatInZone();     // ③ 圈内方向退却点（向圈心退 retreatStep）
this.throwSmokeAt(pt);    // ④ 向 pt 投烟雾（复用 Projectiles.spawn('smoke',...)）
this.scoreTarget(e);      // ⑥ 目标评分（距离 + 残血 + 曝露）
```

**状态读取（工程实现时核对）**：
- 沙暴：`Mechanics.stormActive()`（true=风暴期）、`Mechanics._inShelter(x,z)`（true=已庇护）、`Mechanics.state.footprints` / `Mechanics.state.shelter`（预计算庇护矩形）
- 探照灯：`Mechanics.kind === 'searchlight'`、`Mechanics.isExposed(u)`、`Mechanics.state.power`（false=断电窗口）、`Mechanics.state.lights[]`（x,z,range,angle,halfAngle）
- 缩圈：`Mechanics.zone.isOutside(x,z)`、`Mechanics.zone.escapeDest(x,z)`、`Mechanics.zone.center`
- 烟雾：`FX.smokes`（现役烟球）、`Projectiles.spawn('smoke', origin, vel, team, owner)`、`CFG.SMOKE_TIME`（10s）
- 掩体：`Game.coverPts`（World.buildCoverPts 已生成：collider 四面外 1.3m 可走点）、`World.colliders`、`World.rayBlocked(from,to)`（射界判定）
- 单位：`unit.armor`（0-100）、`unit.hp`、`unit.team`、`ai.medkits / ai.healCd / ai.canSee`

---

## 2. 战术① 沙暴庇护（desert 主动激活，任意图防御性跳过）

### 规则
风暴期（`Mechanics.stormActive()`）且本 AI **处于暴露**（`!Mechanics._inShelter(pos)`）且 **12m 内有建筑 footprint / 掩体庇护区** → 把移动目标改为**最近庇护点**（footprint 或 collider 外扩 2m 庇护矩形内的最近可走点）。

- **无庇护** → 移动目标改为：优先圈内（`zoneDest()`，进圈同时躲沙暴）→ 其次最近 `coverPts` 掩体点 → 都没有则维持原目标（风暴只能硬扛）。
- 战斗中（canSee）**不打断射击**：先完成当前走位/对枪，若暴露持续 >2s 仍无庇护 → 战术性向庇护点移动（移动目标偏庇护，`tryShoot` 照常）。

### 触发条件
`Mechanics.stormActive() && !Mechanics._inShelter(u.pos.x, u.pos.z) && this.evadeT <= 0`

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 庇护搜索半径 | 12 | m | [PLAYTEST] 8~16 |
| 庇护点判定 | `_inShelter(x,z)===true` 且 `World.walkable` | — | 复用机制判定 |
| 战斗中转移阈值 | 暴露持续 2s | s | [PLAYTEST] 1.5~3 |
| 转移节流 | `evadeT=0.8` | s | 防每帧重算 |

### 边界
- 已在庇护（`_inShelter` true）→ 不触发（不反复横跳）。
- **桥下不算庇护**：`Mechanics.state.footprints` 已跳过 `bridge`（开敞结构），AI 不会躲桥下误判安全。
- 水塔圈内 = 庇护（`_inShelter` 已含），且水塔有回血 → AI 优先选择水塔圈（若在 12m 内）。
- 风暴期且圈外：庇护移动优先于进圈（先保血，再进圈）——沙暴伤害 4HP/s 是即时压力，圈外伤害 P1~P4 是延时压力。
- 非 desert 图（无 sandstorm）→ 整项跳过（`stormActive()` 恒 false）。

---

## 3. 战术② 探照灯避光（port 主动激活）

### 规则
port 机制下，AI **被曝露连续 >2s**（`Mechanics.isExposed(u)` 持续计时）→ 移动目标改为**最近光锥外点**（离开当前所有灯的 `range + 1m` 外 / 锥角外 1m 的可走点）；保持射击节奏不打断。

**断电窗口**（`Mechanics.state.power === false`，全港灯灭）→ AI **攻击欲望 +20%**：表现为**行为推进**而非数值——
- engage 时向目标逼近倾向增强（横移概率减半，逼近移动优先）；
- 手雷投掷窗口放宽（`d∈[8,26]` → `d∈[6,30]`，集群压制更积极）；
- 目标在射程边缘时主动缩短距离（sniper 除外，保持狙击位）。
- **不改命中率 / 射速 / 反应 / 移速**。

### 触发条件
- 避光：`Mechanics.kind==='searchlight' && Mechanics.isExposed(u) && exposedT > 2`
- 断电推进：`Mechanics.kind==='searchlight' && Mechanics.state && Mechanics.state.power === false && canSee`

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 避光触发阈值 | 2 | s | [PLAYTEST] 1.5~3 |
| 光锥外安全距离 | range+1 / 锥角外 1 | m/° | 按灯实时数据 |
| 断电推进幅度 | +20% 行为倾向 | — | [PLAYTEST] 10~30% |
| 手雷窗口（断电期） | 6~30 | m | 平时 8~26 |

### 边界
- 断电时灯灭 → 无光锥 → 避光不触发（`isExposed` 清空）。
- 被多灯同时照到 → 离开**全部**灯的光锥（取"最近可走且对所有灯都不曝露"的点）。
- 曝露计时：离开光锥即清零；重新被照重新累计。
- 避光移动不离开据点圈超过 15m（防止 AI 因避灯放弃占点）——以"最近锥外点"为界，不向远方逃。
- AI 被照时小地图红点已存在（机制既有），避光是 AI 的自救行为，不改变机制本身。

---

## 4. 战术③ 缩圈边打边退（实现 v1.3 暂缓的 §6.1 原方案）

> v1.3 签认：圈外有敌 engage 优先、不打断战斗。本项是 v1.3 §6.1 原方案的正式实现——**战斗不打断，但移动目标偏圈内方向**：边打边退。

### 规则
**圈外**（`Mechanics.zone.isOutside(pos)`）且 **engage 有可见敌人** → 移动目标 = 自身沿**圈心方向退却 5m** 的可走点（退却点不可达 → 用 `escapeDest` 的圈心采样逻辑沿圈心找最近可走点）；`tryShoot` 完全照常（burst / fireT / 面向目标都不变）——**打不中断，退不回头**。

### 触发条件
`Mechanics.zone.active && Mechanics.zone.isOutside(u.pos.x, u.pos.z) && this.canSee && this.retreatT <= 0`

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 退却步长 | 5 | m | [PLAYTEST] 4~6 |
| 退却节流 | `retreatT=0.9` | s | 防每帧换点抖动 |
| 圈心方向 | `atan2(center.x - x, center.z - z)` | — | 用 zone.center |
| 目标在圈内 | 退却同时面向目标射击（yaw 不变） | — | 边退边打 |

### 边界
- 圈外无敌（advance）→ 走既有 `zoneDest()` 进圈（不涉及本项）。
- 圈内 engage → 维持现状走位（不触发）。
- **dodge 优先**：受伤 1.6s 内 dodge 覆盖本项（先躲伤，再边打边退）。
- 退却点被建筑堵 → 沿圈心方向采样最近可走点（复用 `escapeDest` 的射线/环形采样，圈心被占死时兜底圈心）。
- 退却点落在庇护/掩体附近 → 优先选择（退 + 掩体双收益）。
- 本项是"压力下不回头送死"：圈外伤害 P3/P4（10/15 HP/s）时 AI 不傻站对枪，边打边退进圈，玩家追击 AI 时会感受到"它在往圈里撤"——战术感增强。

---

## 5. 战术④ 烟雾掩护

### 规则
AI 在**开阔地**（8m 内无 `coverPts` 掩体）且**被敌方射界覆盖**（`World.rayBlocked(敌眼, 我胸) === null`，即打得到我）且**持有烟雾弹**（`ai.smokes > 0`）→ 向移动方向前方 8~14m 投烟雾弹，然后移动到**烟后/烟内**继续原目标（穿烟移动）。

### 触发条件
`ai.smokes > 0 && ai.smokeCd <= 0 && 8m 内无掩体 && 有可见敌人且敌人射界内 && 需要移动（advance/followOrder 或 engage 转点）`

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 投烟距离 | 8~14 | m | [PLAYTEST] 6~16 |
| 烟球寿命 | 10（CFG.SMOKE_TIME） | s | 既有 |
| 投烟冷却 | 12 | s | [PLAYTEST] 8~18 |
| 触发概率 | 0.5 | — | [PLAYTEST] 0.3~0.7（防全图乱扔） |
| 开阔判定 | 8m 内无 coverPts | m | 复用 Game.coverPts |
| 射界判定 | `rayBlocked(敌眼, 我胸) === null` | — | 复用 World.rayBlocked |

### 边界
- 无烟（`smokes=0`）→ 不触发（保持原路径，硬冲）。
- 已在掩体 / 有近距掩体可走 → 不浪费烟（先走掩体）。
- 战斗开火中不投烟（会打断射击节奏）——只在**转点前**投（advance 分支 / engage 中目标切换时）。
- 投烟是"进攻/转点"道具，不是"逃跑"道具：向敌方方向投烟形成遮蔽，AI 从烟侧绕进或穿烟推进。
- 烟冷却独立于手雷冷却（`smokeCd` 与 `grenadeCd` 分开）。
- 红/蓝 AI 通用（谁有烟谁用）；lootbox 拾取获得（工程在 `items.pickupFor` 为 AI 补 `smokes` 计数，见 §9 联调项）。

---

## 6. 战术⑤ 护甲 / 医疗

### 规则
- **护甲**：`unit.armor < 50 && ai.armorkits > 0 && ai.armorCd <= 0` → 使用护甲包（+50 armor，对齐玩家 `useArmorkit`；护甲包消耗 `armorkits--`）。
- **医疗升级**：`hp < 40 && canSee（有敌人视线）` → **先撤到掩体再治疗**：移动目标 = 最近 `coverPts` 掩体点；到位且 `!canSee` → 用医疗包（+50 HP，`medkits--`，healCd=8s 不变）。
  - 8m 内无掩体 → 向远离敌人视线方向退 6m 再用药（边退边等安全，不打断射击）。

### 触发条件
- 护甲：`armor < 50 && armorkits > 0 && armorCd <= 0 && 无战斗锁（不强打断当前对枪）`
- 医疗：`hp < 40 && medkits > 0 && healCd <= 0`（触发后按"是否有敌视线"分流）

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 护甲使用阈值 | armor < 50 | HP | [PLAYTEST] 30~60 |
| 护甲包回复 | +50 | HP | 对齐玩家 |
| 护甲包冷却 | 8 | s | [PLAYTEST] 6~12 |
| 医疗阈值 | hp < 40 | HP | 不变（对齐现状） |
| 医疗回复 | +50 | HP | 不变 |
| 掩体后撤距离 | 6 | m | [PLAYTEST] 4~8 |

### 边界
- `armorkits=0` → 护甲项跳过（AI 从 lootbox 拾取的 armor 已由既有 `items.pickupFor` 直接修甲——那是"捡甲"，本条是"带包用包"，两者并存）。
- `armor ≥ 50` → 不浪费护甲包（留给更残血时）。
- 低血 + 敌视线 + 已在掩体（`coverPts` 附近且 `!canSee`）→ 直接用药（不需要先撤）。
- 低血 + 敌视线 + 战斗对枪中 → 先完成当前 burst（不打断），burst 间隙后撤用药。
- 用药被打断：若撤到掩体期间再次被看到 → 等再次安全才用（healCd 兜底防反复）。

---

## 7. 战术⑥ 残血优先

### 规则
`perceive()` 选目标时从"最近可见"升级为**多目标评分**：所有可见敌人按 `score = 距离 - 残血加成 - 曝露加成` 排序，取 score 最小者。

- **残血加成**：目标 `hp < 30` → score −12（优先打残血收割）。
- **曝露加成**：目标被探照灯/沙暴曝露（`Mechanics.isExposed(e)`）→ score −6（打被曝露目标，利用机制联动）。

### 触发条件
`perceive()` 每 0.2s 重算时（可见敌人 ≥2 时按评分；1 个时无差别）。

### 数值
| 参数 | 值 | 单位 | 标注 |
|------|----|------|------|
| 残血阈值 | hp < 30 | HP | [PLAYTEST] 25~35 |
| 残血加成 | −12（score） | — | 相当于距离偏移 12m |
| 曝露加成 | −6（score） | — | 相当于距离偏移 6m |
| 距离权重 | 原始距离 d（m） | m | 保持主导，防换目标过频 |

### 边界
- 距离仍是主权重：残血/曝露只做偏移，AI 不会 40m 外弃近敌追残血（score 仍由 d 主导）。
- 换目标节流：评分结果与当前目标差 <4 分 → 不换（防 0.2s 高频切换）。
- 曝露目标在暗处（port 断电期无曝露）→ 该项自然失效（机制状态驱动）。
- 不改命中率：残血目标被选后按既有 acc 射击（只是"先打谁"变了）。

---

## 8. 战术⑦ 统一提难 —— 纯战术，不动数值手感

### 明确不动（工程红线）
| 维度 | 现状 | 是否可调 |
|------|------|---------|
| 命中率 acc | `clamp(0.5 - d/150, 0.04, 0.55)` 等 | ❌ 不动 |
| 视线重算 | 0.2s | ❌ 不动 |
| 受伤反应 | 1.6s dodge | ❌ 不动 |
| 射速/弹匣 | fireT / burst / 换弹 5s | ❌ 不动 |
| 移动速度 | 3.6 / 6.2（疾跑） | ❌ 不动 |
| 武器伤害/护甲吸收 | 既有 | ❌ 不动 |
| 手雷伤害/烟时长 | 既有 | ❌ 不动 |

### [PLAYTEST] 后续可调参数汇总（只调战术层，不调手感层）
| # | 参数 | 默认 | 可调方向 |
|---|------|------|---------|
| ① | 庇护搜索半径 | 12m | ↑ 更会找掩体 / ↓ 更暴露 |
| ① | 战斗中转移阈值 | 2s | ↓ 更快躲 / ↑ 更恋战 |
| ② | 避光触发阈值 | 2s | ↓ 更怕灯 / ↑ 更敢冲 |
| ② | 断电推进幅度 | +20% | ↑ 断电更强攻 / ↓ 更稳 |
| ② | 断电手雷窗口 | 6~30m | ↑ 更凶 / ↓ 更保守 |
| ③ | 退却步长 | 5m | ↑ 退得更快 / ↓ 更贴脸 |
| ④ | 投烟概率 | 0.5 | ↑ 更会战术 / ↓ 更莽 |
| ④ | 投烟冷却 | 12s | ↓ 烟更多 / ↑ 烟更省 |
| ⑤ | 护甲阈值 | 50 | ↑ 更早用甲 / ↓ 更省甲 |
| ⑤ | 掩体后撤距离 | 6m | ↑ 撤更远 / ↓ 撤更近 |
| ⑥ | 残血阈值 | 30 | ↑ 更贪收割 / ↓ 更均衡 |
| ⑥ | 曝露加成 | 6 | ↑ 机制联动更强 / ↓ 更弱 |

> 调参原则：任何一项升到"AI 明显变强但玩家可反制"即可；若出现"AI 全图隐身躲灯/无限扔烟/集火残血必杀" → 回退该项参数，不引入难度档位。

---

## 9. 待工程联调项（交接清单）

1. [ ] `AIBrain` 新增字段：`exposedT / retreatT / smokeCd / smokes / armorkits / armorCd / evadeT`（constructor 初始化；§1）。
2. [ ] 战术①：`shelterDest()`（最近庇护点）+ `Mechanics._inShelter` / `stormActive` 状态读取；战斗中 2s 阈值转移。
3. [ ] 战术②：`leaveConeDest()`（光锥外点）+ `exposedT` 计时 + 断电窗口行为推进（横移减半 / 手雷窗口放宽 / 推进逼近）。
4. [ ] 战术③：`retreatInZone()`（圈心方向退 5m）+ `Mechanics.zone.isOutside / escapeDest` 读取；`tryShoot` 节奏不动。
5. [ ] 战术④：`ai.smokes` 计数 + `throwSmokeAt()`（复用 `Projectiles.spawn('smoke',...)`）+ `items.pickupFor` 为 AI 补烟；开阔/射界判定复用 `Game.coverPts` + `World.rayBlocked`。
6. [ ] 战术⑤：`ai.armorkits` 计数 + 用护甲包（+50 armor）+ 低血敌视线先撤掩体再用药（复用 `Game.coverPts`）；`items.pickupFor` 为 AI 补护甲包。
7. [ ] 战术⑥：`scoreTarget(e)` 多目标评分（距离 + 残血 −12 + 曝露 −6）替换 `perceive` 的最近目标选择；换目标节流（差 <4 不换）。
8. [ ] 战术⑦：确认全部手感层参数零改动（§8 红线表）；[PLAYTEST] 后按 §8 汇总表收敛。
9. [ ] 四地标 BuildingLib 类型注册（base/refinery/stadium/megatower）——未注册前地图数据已回退占位盒（安全，探针自证全绿，见各图 GDD §4.8）。
10. [ ] 外部 GLB（models/out/battle_base.glb / battle_refinery.glb / battle_stadium.glb / battle_megatower.glb）接线：工程注册 CONFIGS 或接 glbSlot（离线休眠，不崩）。

---

## 10. 仇恨机制（v2.2「谁打我我打谁」· 目标选择层提难）

> 版本：v2.2（2026-08-07）· 范围：`js/ai.js`（`addHate/tickHate/scoreTarget` 集成）+ `js/game.js`（`applyDamage` 仇恨注入）+ `js/core.js`（HATE 常量）
> 目的：AI 难度上调——玩家打 AI 后会被"记仇"盯住，不能再风筝；红队记仇更深、救援更坚决（见 respawn-rework.md v2.1 修订节）。

### 10.1 设计口径

1. **受伤反应 bug 修复（提难的关键地基）**：原 `applyDamage` 受伤反应条件为 `attacker.ai`（攻击者是 AI 才记录）→ **玩家打 AI 时 AI 不记 `lastDmgT`、不 dodge、不记仇**，AI 难度虚低且可被无限风筝。改为 `u.ai && attacker && attacker !== u`——玩家打 AI 同样触发受伤反应（1.6s dodge）。
2. **仇恨注入**：
   - 自己受伤 → 对攻击者 `HATE_SELF=100`（红队 ×`HATE_RED_MULT=1.25`）
   - 旁观仇恨 → 90m 内同队存活 AI 对攻击者 `HATE_ALLY=40`（看到队友挨打 → 优先打攻击者）
3. **周期刷新（用户口径"每隔几秒钟刷新仇恨"）**：每 `HATE_REFRESH=3s` 全部仇恨 ×`HATE_DECAY`（蓝 0.5 / 红 `HATE_RED_DECAY=0.7` 更慢遗忘），低于 `HATE_FLOOR=15` 清除——"最近在打我的人"仇恨最高，久不打自然淡忘，AI 不死追一个目标到天涯。
4. **目标选择集成**：`scoreTarget` 加仇恨项 `s -= hate × HATE_WEIGHT(0.6)`。100 仇恨 ≈ −60 分 ≈ 60m 距离优势 → 压过距离主导，"优先解决在攻击我的人"。仇恨目标仍需过 90m 感知 + 视线（rayBlocked）检查，被墙挡/超距的仇恨不生效。
5. **红队差异化（难度上调杠杆）**：红队受伤仇恨 ×1.25 + 衰减更慢（0.7）→ 玩家打红队 AI 后被盯得更久更紧。蓝队正常（玩家队友，别太凶）。
6. **红队全兵种救援（"红队也要救援机制"）**：
   - 状态判定：红队所有角色（含非医疗兵）revive 优先级提到 engage 之前（有倒地队友就冲去救，即使有敌在场）
   - 读条中断：红队同医疗兵口径——只受击中断，不因"看见敌人"中断
   - 搜索半径：红队非医疗兵 `MEDIC_REVIVE_RANGE × 0.5`（40m×mapScale）；蓝队非医疗兵维持 12m
   - **配套修复 `tryRevive` 赶路放弃 bug**：旧逻辑 `d > REVIVE_RANGE×3(7.5m)` 直接 cancel 救援目标 → 40m/80m 半径发现的倒地队友永远救不到（救援实际只对 7.5m 内生效，v2.0 遗留）。改为赶路阶段不设放弃阈值，救援目标失效由下帧校验处理。
   - 反制对称：红队救人 = 救援者暴露（读条中受击即断 + 可被处决）；吃鸡制下红队 AI 一条命，救人是减损不是无限。

### 10.2 常量表（js/core.js，全部 [PLAYTEST]）

| 常量 | 值 | 语义 |
|------|-----|------|
| `HATE_SELF` | 100 [80~120] | 自己受伤 → 对攻击者仇恨 |
| `HATE_ALLY` | 40 [30~50] | 90m 内队友受伤 → 旁观仇恨 |
| `HATE_WEIGHT` | 0.6 [0.4~0.8] | 仇恨换算评分：每点 −0.6 分 |
| `HATE_REFRESH` | 3s [2~5] | 仇恨刷新周期（衰减） |
| `HATE_DECAY` | 0.5 [0.4~0.7] | 蓝队每次刷新 ×0.5 |
| `HATE_FLOOR` | 15 [10~20] | 低于此值清除 |
| `HATE_RED_MULT` | 1.25 [1.0~1.5] | 红队受伤仇恨倍率 |
| `HATE_RED_DECAY` | 0.7 [0.6~0.8] | 红队衰减系数（更慢遗忘） |

### 10.3 风险与反制

- **R1 风筝失效**：玩家打 AI 后被记仇盯住 → 设计意图（提难）；对策：脱离视线/距离（90m）仇恨自然失效，或打一枪换阵地等 3s 衰减。
- **R2 全队集火**：旁观仇恨 40×多人 → 打一个 AI 可能拉 3~4 人仇恨 → 设计意图（防独狼风筝）；对策：快速处决/转移，别站桩。
- **R3 红队无限救人打不死**：红队全兵种救援 → 击倒后必须快速处决或压制救援者；救援者读条受击即断、一条命减损，资源有限天然平衡。若实测过强 → 降 `HATE_RED_MULT` 或红队救援半径。
- **R4 仇恨永久化**：`HATE_FLOOR` + 周期衰减防全图永久记仇；若仍出现 → 降 `HATE_RED_DECAY`。

### 10.4 验收

- [ ] `test/_qa_v22_hate.js` 12 断言全 PASS（受伤反应/仇恨注入/旁观仇恨/目标评分/周期衰减/红队救援/读条中断）
- [ ] `test/_qa_v21_elimination.js` 28 断言回归 PASS
- [ ] `test/smoke.js` 全绿
