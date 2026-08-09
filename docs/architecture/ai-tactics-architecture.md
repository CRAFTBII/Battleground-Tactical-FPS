# AI 战术架构（AI Tactics）· v1.4「AI 战术升级 + 四地标落地」

> 对应代码：`js/ai.js`（AIBrain 战术决策层）、`js/items.js`（AI 战术补给）、`js/models.js`（BuildingLib 四地标 CONFIGS）、`tools/glb2bldg_out.js` + `models/buildings_out.js`（四地标内联管线）、`js/maps/{suburb,port,desert}.js`（设计已落四地标条目）
> 设计规格：`design/maps/ai-tactics.md`（7 项战术 + §1 接入点契约，数值勿改）
> 设计文档：`design/maps/{suburb,port,desert}-gdd.md` §4.8（四地标意图）
> 冒烟覆盖：`test/smoke.js` §4.15（AI 战术行为断言）/ §4.16（四地标构建·回退断言）

---

## 1. 设计目标（v1.4「提难不改档」）

用户拍板：**AI 提难度但不动数值手感**。v1.4 用「战术行为密度」提难——AI 更会躲沙暴 / 避灯 / 进圈 / 扔烟 / 打残血 / 带甲用药，但**单发命中概率、反应、射速、移速、伤害与玩家既有完全一致**，避免「打不过是因为 AI 开挂」。

| 维度 | 现状（不可动，硬约束） |
|------|----------------------|
| 命中率 acc | `clamp(0.5 - d/150, 0.04, 0.55)` 等（§8 红线表全部不动） |
| 视线重算 | 0.2s（`perceive` losT） |
| 受伤反应 | 1.6s dodge |
| 射速/弹匣 | fireT / burst / 换弹 5s |
| 移动速度 | 3.6 / 6.2（疾跑） |
| 武器伤害/护甲吸收 | 既有 |

## 2. 接缝（读侧契约，只读不改）

战术层**只读取**既有机制状态，不新增独立系统，也不改 `Mechanics` / `World` / `Game` / `Projectiles` 对外接口：

| 战术 | 读取的状态（读侧） | 复用能力 |
|------|--------------------|----------|
| ① 沙暴庇护 | `Mechanics.stormActive()` / `Mechanics._inShelter(x,z)` / `Mechanics.state.footprints` / `Mechanics.state.shelter` / `Mechanics.state.tower` | `World.walkable`、`World.colliders`、`Game.coverPts` |
| ② 探照灯避光 | `Mechanics.kind==='searchlight'` / `Mechanics.isExposed(u)` / `Mechanics.state.power` / `Mechanics.state.lights[]` | `World.walkable` |
| ③ 缩圈边打边退 | `Mechanics.zone.active` / `Mechanics.zone.isOutside` / `Mechanics.zone.center` / `Mechanics.zone.escapeDest` | `World.walkable` |
| ④ 烟雾掩护 | `FX.smokes`（经 `World.rayBlocked` 已含烟球遮挡） | `Projectiles.spawn('smoke',…)`、`Game.coverPts`、`World.rayBlocked` |
| ⑤ 护甲/医疗 | `unit.armor` / `unit.hp` / `ai.armorkits` / `ai.medkits` / `ai.healCd` | `Game.coverPts`、既有 medkit 逻辑 |
| ⑥ 残血优先 | 可见敌人 `hp` / `Mechanics.isExposed(e)` | 既有 `perceive` 视线重算 |

**写侧（仅 AI 自己的字段）**：`exposedT / retreatT / smokeCd / smokes / armorkits / armorCd / evadeT / _tacDest / _smokeT / _prevTarget`。
**唯一机制外改动**：`js/items.js pickupFor` 为 AI 拾取 lootbox 时补 `smokes` 与 `armorkits` 计数（设计 §9 联调项 5/6）——只加"决策资源"，不改拾取数值/手感。

## 3. 战术实现清单（7 项）

| # | 战术 | 代码位置 | 触发条件（按 ai-tactics.md） | 关键参数 [PLAYTEST] |
|---|------|----------|------------------------------|---------------------|
| ① | 沙暴庇护 | `shelterDest()` / `tacticalDest()` 分支 | `stormActive && !_inShelter && evadeT<=0`；战斗中 `exposedT>2` 才转 | 搜索半径 12m / 转移节流 0.8s |
| ② | 探照灯避光 | `leaveConeDest()` / `_inAnyCone()` / `_pwrOff()` | `kind==='searchlight' && isExposed && exposedT>2` | 触发阈值 2s / 锥外裕量 1m |
| ②b | 断电推进 | engage 分支（横移减半 + 逼近）+ 手雷窗口 | `power===false && canSee` | 推进 +20% 行为倾向 / 手雷 6~30m |
| ③ | 缩圈边打边退 | `retreatInZone()` / `tacticalDest()` 分支 | `zone.active && isOutside && canSee && retreatT<=0` | 退却步长 5m / 节流 0.9s |
| ④ | 烟雾掩护 | `maybeThrowSmoke()` / `throwSmokeAt()` / `_smokeT` | 带烟 + 开阔（8m 无 coverPt）+ 敌射界 + 转点前 | 触发概率 0.5 / 冷却 12s / 投烟 8~14m |
| ⑤ | 护甲/医疗 | update() 顶部护甲块 + `tacticalDest()` heal 分支 | armor<50 带包 / 低血敌视线先撤掩体 | 甲阈值 50 / +50 / 冷却 8s / 撤 6m |
| ⑥ | 残血优先 | `perceive()` 评分 + `scoreTarget()` | 每 0.2s 重算；评分差 <4 不换 | 残血 −12 / 曝露 −6 |

**战斗不打断原则（延续 v1.3）**：①/②/③/⑤ 在 engage 分支只做**移动目标偏向**（`this._tacDest`），`tryShoot` / burst / fireT 完全照常；仅 burst 间隙（`burst<=0`）才执行走位改动。dodge 1.6s 状态优先级最高，覆盖一切战术移动（先躲伤，再战术）。

## 4. 四地标内联管线 + BuildingLib 注册

### 4.1 管线（tools/glb2bldg_out.js）
- KEYS 扩展 9 → 13：新增 `base / refinery / stadium / megatower`。
- PALETTE 扩展：四地标主题基色（desert 土坯黄 / port 冷灰蓝 / suburb 中性灰 / desert 沙棕）。
- **归一化**：每类型几何平移到角点原点（全局 min → (0,0,0)），与 CONFIGS「x[0,w] y[0,d] z[0,h]」约定一致；`placeModelBuilding` 的 D-04 归一化变为 no-op，行为与旧数据等价（旧 9 型重生成后冒烟全绿自证）。
- 输出 `models/buildings_out.js`（13 型，~635KB base64 内联，离线 file:// 可玩）。

### 4.2 BuildingLib.CONFIGS 注册（js/models.js）
坐标系 `x[0,w] y[0,d](深) z[0,h](高)`，尺寸 = 归一化 GLB bbox；运行时按地图 w/d/h 缩放（碰撞尺寸以地图数据为准）。门洞留空、平台可站：

| key | GLB bbox（归一） | 地图 dims | CONFIGS 意图 |
|-----|------------------|-----------|---------------|
| `base` | 223×184×65 | 24×18×8 | 前哨基地「可进可守」：四周矮墙（z≤20 ≈2.5m）+ 中央塔（可走内部） |
| `refinery` | 193×184.5×45.5 | 20×14×12 | 炼油厂工业锚点：围墙 + 前向全高大门（不堵主街） |
| `stadium` | 220×220×32 | 26×20×14 | 竞技场碗状：四周高墙 + 东西对穿门（A 侧进 / 东侧出） |
| `megatower` | 36×36×145.48 | 20×20×28 | 巨塔制高点：**四腿式，底部中心可通行**（设计取舍「不可上」，见 §6 backlog） |

**平台决策（v1.4 四地标均不注册 `platforms`，理由）**：CONFIGS 契约「平台可站」指**凡注册的平台必须可站**（进入 `World.platforms` 后 `heightAt` 会直接返回其高度）。四地标设计均无可攀屋顶——base 中央塔/refinery 露顶堆场/stadium 敞口看台无可达路径；若注册全 footprint 平台会令内部行走单位浮空（base 无屋顶 collider，破坏「可进可守」）。故 v1.4 注册 0 平台、0 风险；待 y 碰撞落地后以「平台 + 可上路径」成对追加（megatower 登顶、stadium 看台等，见 §6 backlog）。

缺数据（BUILDINGS_OUT 缺 key / 解码失败）→ `BuildingLib.build` 返回 null → `placeModelBuilding` 回退占位盒（碰撞=w/d/h），不崩（smoke §4.16 回退断言自证）。地图 `glb` 字段在离线/file:// 下由 `GLBSlots` 休眠（ADR-003），不崩。

## 5. 性能注意

- `tacticalDest()` 每帧每 AI 调用一次：无机制地图（suburb airdrop）几乎零开销（stormActive=false、kind!=='searchlight`、zone 内 isOutside=false）；desert 风暴期才进入 `shelterDest()` 扫描。
- `shelterDest()` 只取 12m 内的 footprint/shelter 矩形（距离预剪枝），候选点仅做 `World.walkable`（O(1) 网格查）——**不做**每候选 `_inShelter` 全量扫描（矩形成员即机制庇护判定，语义等价，复杂度 O(N) 而非 O(N²)）。
- `maybeThrowSmoke()` / `scoreTarget()` 仅在条件命中时运行（带烟、开阔、低血等），常态零分配。
- 手雷/烟雾走既有 `Projectiles` 池；烟雾弹实体复用 `FX.smokes`，不新增对象类型。

## 6. Backlog（不做进 v1.4，记录）

1. **[P2] megatower 登顶玩法**：设计取舍「v1.4 不可上」（desert-gdd §4.8）——当前移动碰撞无 AABB 顶面分离轴，站 collider 顶部会被推出。待 y 碰撞落地后追加「塔内螺旋楼梯 + 顶部平台」（CONFIGS 届时补 `platforms`）。
2. **[PLAYTEST] §8 调参收敛**：庇护搜索半径 / 避光阈值 / 退却步长 / 投烟概率冷却 / 护甲阈值 / 残血曝露加成——按实测收敛，不引入难度档位。
3. **[艺术] megatower GLB 视觉与碰撞不一致**：当前 GLB 为实心柱体（全高 36×36 占据），而 CONFIGS 为腿式 → 玩家穿模底部视觉。需 art 重出腿式 GLB（或工程加中央核心碰撞，二选一，等 art 排期）。
4. **[AI] 烟后推进细化**：当前 `_smokeT` 是向目标直线推进 2.2s；更细的「绕烟侧」路径（沿烟球切线）可作后续增强。
5. **[联机] `m_throw` 事件**：AI 投烟已广播 `k:'throw'`；客户端烟云由既有 Projectiles/FX 播报，无需新增事件类型。
6. ~~**[server-test] 426 引导页**~~（已解决，2026-08-07）：原为 ws 库默认对普通 HTTP 请求返回裸 426 纯文本（body 无 'WebSocket'）。server.js 改为自定义 http server + `noServer` 模式，普通请求统一返回**实时服务器列表页**（200，含服务器状态/房间列表/联机指引，页面每 3s 轮询 `/api/rooms`），`/api/rooms` 提供 JSON 状态接口，两种传输层行为对齐；客户端 `normUrl` 同时支持 `http(s)://` 自动转 `ws(s)://`，避免误输 http:// 触发 426。

## 7. 测试证据路径

- `node test/smoke.js` → **全部通过**（含既有 v1.2/v1.3 断言 + v1.4 §4.15 AI 战术 + §4.16 四地标）。
  - §4.15 行为断言（真实触发，模拟场景）：沙暴庇护（desert 风暴期暴露 → shelterDest 给出可走庇护点 + tacticalDest shelter）/ 避光（port 合成光锥 → leaveConeDest 出锥外点 + 断电 null + 断电 7m 手雷投出）/ 边打边退（圈外 engage → 圈心退 5m）/ 烟雾（开阔 + 敌射界 + 带烟 → 转点投烟）/ 护甲（armor 30→80）/ 残血优先（低血 20 目标评分胜出）。
  - §4.16：四地标 `BuildingLib.build` 真模型（非占位）+ CONFIGS + `status()==='inline'` + megatower 底部可通行 + 缺数据回退占位盒不崩。
- `node test/port-density-probe.js` → ALL PASS（port 探针回归；含新 BuildingLib 类型渲染）。
- `node test/v13-zone-bridge-probe.js` → ALL PASS（缩圈/桥梯回归）。
- `node test/server-test.js`（需先起 `PORT=8081 node server.js`）→ **6/6 通过**（含 426 引导页子检查，2026-08-07 修复）。
