# 复活机制大修架构（Respawn Rework）· v2.1「倒地救援 + 智能出生 + AI 协同」

> 对应代码：`js/game.js`（击杀/复活/智能出生）、`js/ai.js`（AIBrain 倒地/救援/处决/归队）、`js/ui.js`（Squad 协同 + UI）、`js/combat.js`（Unit 字段/玩家输入/KeyE）、`js/core.js`（CFG 新常量）、`js/world.js`（mapScale）、`js/net.js`（联机事件）、`index.html`（#downOverlay/#reviveBar）
> 设计规格：`design/maps/respawn-rework.md`（v2.1，§0 红线 / §1 状态机 / §4 smartSpawn / §6 角色编成 / §8 契约 / §10 交接清单）
> 冒烟覆盖：`test/qa/_qa_v15_respawn.js`（新，倒地救援 QA）；回归：`test/qa/_qa_v13_zone.js`、`test/qa/_qa_v14_ai.js`、三图 smartSpawn 探针

---

## 1. 设计目标与红线

**只加机制层，不改手感数值**：命中率 acc / 视线 0.2s / 受伤反应 1.6s / 射速弹匣 / 移速 3.6·6.2 / 伤害 / 护甲吸收 60% **全部冻结**。新增：击倒≠击杀、救援读条、处决、流血致死、智能安全出生点、出生无敌帧、角色编成、AI 协同复活。

**核心语义**：`u.alive=false` 兼容策略（§1.3）——倒地单位 `alive=false` 天然兼容既有 `perceive`/`updateCaps`/`UI.teams`/快照；新增 `u.down` 专门判定，渲染/救援/处决/小地图单独读取。`killUnit` 保留为最终死亡入口（`toDead` 调用 + rebalance 强制处决），战斗路径走 `downOrKill` 分流。

## 2. 状态机（T1~T6）

| 迁移 | 入口 | 副作用 |
|------|------|--------|
| T1 ALIVE→DOWN | `applyDamage` hp≤0 → `toDown` | `life='down'`/`alive=false`/`down=true`/`downHp=DOWN_HP`/`bleedT=BLEED_OUT`；**不加分/不掉落/不加死亡数**；玩家侧 `playerDown(true)` + 蓝队 `leaderTakeover`；广播 `down` |
| T2 DOWN→DEAD 处决 | down 中受敌方伤害 `downHp≤0` | `toDead(u,attacker,'executed')` → `killUnit` 结算 |
| T3 DOWN→DEAD 流血 | `tickDown` 中 `bleedT≤0` | `toDead(u,null,'bleed')`，killfeed「流血身亡」 |
| T4 DOWN→DEAD 环境 | 圈/沙暴伤害扣 downHp | `toDead(u,null,'zone')` |
| T5 DOWN→ALIVE 被救 | 救援读条满 | `life='alive'`/`hp=REVIVE_HP`（弹匣/护甲保持）；被救 AI `regroup=true`；广播 `revive` |
| T6 DEAD→RESPAWN | respawnT/deadT 归零 | `smartSpawn` 落点 + `spawnProtT=SPAWN_PROT`；广播 `spawn`/`respawn` |

**关键改造点**：
- `applyDamage` 三分支：①出生无敌帧守卫（`spawnProtT>0 && attacker.team!==u.team` 免疫）②down 态扣 `downHp`（含 `cancelRevive` 中断）③存活态护甲→hp→`downOrKill`。
- `areaDamage` 过滤 `!u.alive` → `u.life==='dead'`（§9.1 边例 2 必改：手雷可处决倒地者）。
- `resolveShot`/`PlayerGun.melee` 过滤同步改为允许 down 目标（处决通道）。

## 3. 智能安全出生点（smartSpawn，§4）

替换 `World.pickSpawn`（仅重生路径；开局首刷保持原样）。评分 = 队友加成 − 敌方接近 − 敌方视线 − 圈边 + 随机抖动；硬约束：walkable / **圈激活绝不出圈** / 与任意存活单位 ≥ `SPAWN_MIN_DIST(3m)` / AI 不与存活玩家贴脸（`SPAWN_NO_PLAYER×mapScale`）。兜底链：候选评分 → 圈内环形采样（最近队友/圈心）→ 距敌最远原始点 → `pickSpawn`（永不为 null）。

**地图尺寸归一化（§4.7）**：`CFG.mapScale = mapDef.size/300`，`World.load` 覆写 `CFG.WORLD` 后计算缓存。空间类距离 ×mapScale（TEAM_RANGE/ENEMY_RANGE/SPAWN_JITTER/EDGE_MARGIN/SPAWN_NO_PLAYER/MEDIC_REVIVE_RANGE/prepareCover/spreadDest/防守环绕），交互/战斗/时间/权重类固定。

## 4. AI 分工与协同（§5/§6/§7）

- **角色编成（§6.1）**：`spawnAI` 用战术角色表（蓝 4突击/2狙击/2医疗/1支援、红 4/2/2/2）替代旧 `randRole` 纯随机武器；角色→武器池（assault→rifle / sniper→sniper / medic→rifle70%·shotgun30% / support→shotgun60%·rifle40%）；队长从突击手中指定 ★；医疗兵 8 医疗包、支援兵 2 倍备弹。`ai.role` 语义从武器改为战术角色（射击/移速判定改读 `u.weapon`）。
- **AI 救援（§2.3/§6.3）**：`findReviveTarget` 医疗兵 60m×mapScale / 其他 8m；`tryRevive` 靠近→读条→`completeRevive`；中断（受伤/见敌/离开/被抢）→ `cancelRevive`。
- **AI 处决（§2.4）**：`findExecTarget` 25m 内可见倒地敌人（无活敌时）；`executeDowned` 逼近射击。
- **倒地爬行（§2.5）**：玩家 `CRAWL_SPEED` + 0.8m 视角 + 禁跳/射击/开镜/迫击炮；AI `downUpdate` 向最近掩体/队友爬行。
- **协同组织（§5/§7）**：`prepareCover`（玩家死亡布防）、`reformAll`（归队集结）、`waveHold/waveResume`（波次守势）、`ensureLeader`（队长倒地换人）、`spreadDest`（散兵线侧向偏移）、防守环绕站位。

## 5. 新常量表（js/core.js，§8.1）

| 常量 | 值 | 缩放类别 |
|------|-----|----------|
| `mapScale` | size/300（suburb 1.0 / desert 1.133 / port 0.867） | — |
| `BLEED_OUT` | 12s | 时间（固定） |
| `DOWN_HP` | 60 | 固定 |
| `REVIVE_TIME` / `REVIVE_HP` | 3s / 35 | 时间/固定 |
| `REVIVE_RANGE` / `CRAWL_SPEED` | 2.5m / 1.2 | 交互（固定） |
| `SPAWN_PROT` / `SPAWN_PROT_RADIUS` | 2.5s / 10m | 时间/交互（固定） |
| `SPAWN_JITTER` / `TEAM_RANGE` / `ENEMY_RANGE` / `EDGE_MARGIN` / `SPAWN_NO_PLAYER` | 4 / 25 / 40 / 10 / 25m | 空间（×mapScale） |
| `MEDIC_REVIVE_RANGE` | 60m | 空间（×mapScale） |
| `DEFAULT_REVIVE_RANGE` | 8m | 交互（固定） |
| `SPAWN_MIN_DIST` | 3m | 交互（固定） |
| `WAVE_HOLD_RATIO` | 0.5 | 无量纲（固定） |
| `W_TEAMMATE`/`W_ENEMY`/`W_LOS`/`W_EDGE` | 15/30/20/5 | 权重（固定） |
| `RED_ASSERTIVE` / `RED_DODGE_SHORTEN` | 0.10 / 0.25 | 行为层（固定） |

## 6. 联机事件表（js/net.js，§8.7）

| k | payload | 时机 |
|---|---------|------|
| `down` | `{id,x,z,by,an,tn}` | T1 房主裁决 |
| `revive` | `{id,by}` | T5 完成 |
| `revive_cancel` | `{id,by}` | 中断 |
| `kill` | 沿用 `{a,t,head,ts}` | T2/T3/T4 最终死亡 |
| `spawn`/`respawn` | 沿用，坐标来自 smartSpawn | T6 |

- 快照 `snapshot()` 每单位追加 `down` 字段；`applyStates` 用快照驱动客户端倒地/复活 overlay（丢包自愈）。
- 客户端按 E → `{t:'revive_req',target}`；松开 E → `{t:'revive_cancel',target}`；房主校验后 `startRevive`/`cancelRevive` 并广播。倒地期客户端不发 `respawn`（房主 `case 'respawn'` 加 `!u.down` 守卫）。房主 `respawn` 分支换 `smartSpawn`。

## 7. 改动文件清单

| 文件 | 改动 |
|------|------|
| `js/core.js` | CFG 新常量（§5 表） |
| `js/combat.js` | Unit §8.2 字段；PC 倒地爬行 + 禁操作；KeyE 救援优先级 + hold-to-revive；resolveShot/melee 允许 down；开火清 spawnProtT |
| `js/game.js` | applyDamage 三分支；toDown/toDead/downOrKill/smartSpawn/startRevive/cancelRevive/completeRevive/playerDown/tickDown/downHud/findReviveTargetForPlayer；killUnit 迁移；respawn 换 smartSpawn+spawnProtT；spawnAI 角色编成；areaDamage down 兼容；update 加 tickDown |
| `js/ai.js` | downUpdate/findReviveTarget/findExecTarget/tryRevive/executeDowned/respawnDuty/spreadOffset/_moveToDest；revive/execute 状态；perceive 跳过 spawnProtT；医疗兵 8 包/支援 2 倍备弹；role→weapon 重构；reset 清视线记忆 |
| `js/ui.js` | Squad prepareCover/reformAll/waveHold/waveResume/ensureLeader/spreadDest；makeLeader 存活过滤；leaderTakeover 含 down；防守环绕；UI reviveBar/downfeed/killfeed cause；MiniMap 倒地十字+无敌帧白圈 |
| `js/world.js` | `CFG.mapScale = mapDef.size/300` |
| `js/net.js` | down/revive/revive_cancel 事件；快照 down 字段；state 带 down；respawn→smartSpawn；revive_req/revive_cancel |
| `index.html` | #downOverlay / #reviveBarWrap + CSS |
| `test/qa/_qa_v15_respawn.js` | 新增倒地救援 QA（10 组断言） |

## 8. 回归结论

- `test/qa/_qa_v15_respawn.js`：**ALL PASS**（T1~T6 状态机、区域伤害、救援/中断、无敌帧、smartSpawn、角色编成、AI 救援、命中感知、Squad 协同、玩家倒地输入）。
- `test/qa/_qa_v13_zone.js`：**ALL PASS**（修复 followOrder 对 zone 目标误加散兵偏移）。
- `test/qa/_qa_v14_ai.js`：**ALL PASS**（role→weapon 重构后 acc/反应/换弹/移速断言不变）。
- 三图 smartSpawn 探针（suburb 300 / port 260 / desert 340）：**ALL PASS**——mapScale 正确、30×2 次全非 null+可走、10v10 压力下零重叠、最终圈绝不出圈、分布不聚点。
- `test/smoke.js`：34 项失败均为**既有基线问题**（`models/buildings_out.js` 现仅含 4 地标类型，smoke 断言 13 类型；与本次改动无关，隔离探针已证）。
- `test/qa/_qa_v12_coexist.js` / `_qa_v12_suburb.js`：各 1 项既有失败（护甲吸收语义与测试预期不符，非本次引入）。

## 9. 已知遗留（[PLAYTEST] 观察项）

1. 独走死亡离场变长（12s 流血 + 5s 重生 ≈ 17s）——设计意图，`BLEED_OUT` 可调。
2. AI 处决/救援节奏、红队进攻激进参数（`RED_ASSERTIVE`/`RED_DODGE_SHORTEN`）待实测收敛。
3. `smartSpawn` 绝对兜底（`pickSpawn`）在极端填场下可能重叠——设计允许（保底不崩）。
4. 击杀者击败后的击杀 feed 两级信息（击倒/击杀）文案已实现，待玩家反馈。
