# 复活机制大修规格（Respawn Rework）· v2.0「倒地救援 + 智能出生 + AI 协同」

> ⚠ **v2.6.1 修订（2026-08-07 · 象限分散出生）**：出生点从「阵营半区挤一团」改为「象限锚点铺开」，覆盖 v2.0 §4 的智能出生与 v2.6 半区分散方案：
>
> | # | 条目 | 旧（v2.6 半区） | 现行（v2.6.1 象限） |
> |---|------|-----------------|---------------------|
> | 1 | 出生布局 | 每队 10 人围己方半区质心 60m 分散 | **地图按中心分 4 象限：蓝队 Q1(左上)+Q4(右下)、红队 Q2(右上)+Q3(左下)**——对角对峙，全图四角都有人 |
> | 2 | 锚点分配 | 一个质心锚点 | `idx%2` 决定锚点（玩家 idx=0 → 蓝 Q1；蓝 AI idx=i+1、红 AI idx=i）→ 每队 5 人一个象限 |
> | 3 | 象限约束 | 无（采样可能跨界） | **硬约束：采样点必须落在目标象限内**（`inQuad` 校验，防半径跨界 → 分象限 100% 成立） |
> | 4 | 防叠 | 同队 ≥`SPAWN_SEP`(8m) | 同款保持；玩家也在 existing 列表（开局 46m 内无队友贴脸） |
> | 5 | 兜底 | 40 次失败回原出生点 | 同款保持 |
>
> 实现：`Game.scatteredSpawn(team, idx, existing)`（js/game.js）——锚点取象限中心偏外 `mid×0.5`（拉开两军开局距离，suburb 实测红蓝平均 ~150m）；`SPAWN_SPREAD=60×mapScale` 半径内 sqrt 均匀采样 + `walkable` + 间距校验。三入口统一：spawnPlayer / spawnAI / rebalance（联机补员 idx=现存数继续奇偶交替）。
> 验证：`test/qa/_qa_v26_spread.js` 17 断言（蓝全 Q1∪Q4 / 红全 Q2∪Q3 / 四角有人 / 同队间距 / 红蓝不贴脸 / 三图 mapScale 回归）。
> 设计口径：**两象限出生已达成"出生分散"诉求，不做四队**——四队需重架构（终局判定从"一方全灭"改"最后一队"、观战目标筛选、计分板/颜色体系、网络协议），收益仅出生分散，成本不成比例。

---

> ⚠ **v2.4 修订（2026-08-07 · 救援消耗医疗包）**：救援从"免费读条"改为"消耗资源"。与 v2.1/v2.3 修订及 v2.0 正文冲突处以本节为准：
>
> | # | 条目 | v2.1（原） | v2.4（现行） |
> |---|------|-----------|-------------|
> | 1 | 救援消耗 | 免费读条 3s | **完成时消耗救援者 1 医疗包**；开始需有包（`startRevive` 前置检查），中断不亏（完成才扣） |
> | 2 | AI 救援前提 | 有倒地队友就锁目标 | **AI 没包（`medkits<=0`）不锁定救援目标**（避免白跑）；医疗兵 8 包 / 他人 4 包 |
> | 3 | 玩家救援反馈 | E 键直接开始 | 没包按 E → toast「医疗包不足，无法救援！」；读条 HUD 显示剩余包数 |
> | 4 | 医疗包分配 | 玩家 5 / AI 8:5 / 掉包 50% | **玩家 6 / 医疗兵 8 / 他人 4 / 掉包 75%**（`PLAYER_START_MEDKITS / AI_MEDIC_MEDKITS / AI_MEDKITS / AI_LOOT_MEDKIT_CHANCE`，全 [PLAYTEST]） |
> | 5 | 红队全兵种锁定 | 状态判定有红队，锁定条件漏（v2.2 疏漏） | **锁定条件补 `u.team==='red'`**——红队有敌在旁也能锁上目标去救 |
>
> 设计意图：医疗包成为"自愈 + 救援"双用途稀缺资源——救人不是免费的，玩家要权衡"自己回血 vs 救队友"；AI 非医疗兵包变少后更依赖捡箱（v2.3 找箱动机），激活"救人 → 耗包 → 捡箱 → 再救人"经济闭环。救援者救人不亏本（被救者残血 35 仍需自愈），资源流向是单向的（救援者 → 被救者场景）。
> 实现：`startRevive/completeRevive`（game.js）+ AI 锁定前置检查（ai.js）+ 分配常量（core.js）；新增测试 `test/qa/_qa_v24_revivekit.js`（16 断言全 PASS）。

> ⚠ **v2.3 修订（2026-08-07 · 战利品箱规则）**：掉落与"死因"绑定。与 v2.1 修订及 v2.0 正文冲突处以本节为准：
>
> | # | 条目 | v2.0/v2.1（原） | v2.3（现行） |
> |---|------|---------------|-------------|
> | 1 | AI 死亡掉落 | 任何最终死亡都掉箱（killUnit 内） | **只有流血致死（`cause==='bleed'`，20s 无人救）掉箱**；处决/环境致死不掉箱（处决已拿击杀分，不叠加箱子收益） |
> | 2 | 玩家尸体 | 不掉箱（旧注释"自己复活不重复捡自己"，吃鸡制已无重生） | **玩家任何死亡都掉箱**，弹药不保留（ammo 空），护甲 + 死前医疗包（上限 `PLAYER_LOOT_MEDKIT_MAX=2`） |
> | 3 | AI 弹药 | reserveMap 有限，打空依赖捡弹药箱 | **弹药无限**：换弹弹匣永远补满，不耗备弹池（reserveMap 仅保留给掉箱计算/显示） |
> | 4 | AI 捡箱动机 | 弹药不足（弹匣+备弹<60%）找箱 | **缺医疗包（`<AI_LOOT_MEDKIT_THRESHOLD=3`）或缺护甲（`<50` 且未带包）**找 25m 内无主箱 |
> | 5 | 击杀者绑定 lootTarget | 击杀即绑定（击杀者去捡） | 仅"有击杀者且掉箱"才绑定（处决不掉箱 → 实际不触发；保留代码防回归） |
>
> 设计意图：**处决 = 拿击杀分，流血 = 留战利品**——玩家击倒红队 AI 后决策："补枪处决（稳拿分、无箱）" vs "不处决赌它队友不来救（20s 后掉箱，可捡弹药/护甲/医疗包，但可能被救走白打）"。玩家箱子弹药不保留是因为 AI 弹药无限后弹药对 AI 无价值，且玩家观战捡不回自己的箱子。
> 实现：`killUnit` 内 `dropLoot = u.ai ? (cause==='bleed') : true`；`js/ai.js` 换弹补满 + `tryLoot` 动机改医疗包/护甲；新增测试 `test/qa/_qa_v23_loot.js`（21 断言全 PASS）。

> ⚠ **v2.1 修订（2026-08-07 · 吃鸡淘汰制）**：本文档 v2.0 的重生路径已作废，改为**全员一条命**。修订点如下，与下方 v2.0 正文冲突处以本节为准：
>
> | # | 条目 | v2.0（原） | v2.1（现行） |
> |---|------|-----------|-------------|
> | 1 | 玩家最终死亡 | `deadT=RESPAWN(5s)` → 重生 | **直接观战**（第三人称跟随存活蓝队 AI，E/Q 切换，`Game.startSpectate/updateSpectate`） |
> | 2 | AI 最终死亡 | `respawnT=6~9s` → `respawnAI` | **不重生**（尸体保留可搜刮；`killUnit` 不再设 respawnT，`Game.update` AI 重生循环删除） |
> | 3 | 胜负判定 | 600s 时间到比分高者胜 | 保留时间结算兜底 + **一方全灭提前收局**（`checkElimination`：某队全员 `life==='dead'`；倒地不算灭） |
> | 4 | `BLEED_OUT` | 12s | **20s** [PLAYTEST 15~25]——淘汰制下救援是唯一保命途径，窗口必须够长 |
> | 5 | `MEDIC_REVIVE_RANGE` | 60m×mapScale | **80m** [PLAYTEST 60~100] |
> | 6 | `DEFAULT_REVIVE_RANGE` | 8m | **12m** [PLAYTEST 8~16] |
> | 7 | AI 救援优先级 | revive 插在 canSee→engage 之后 | **医疗兵 revive 提到 engage 之前**（有敌也冲去救）；读条中不因「看见敌人」中断（只受击打断）；非医疗兵近敌判定 15m→10m |
> | 8 | 玩家死亡布防 | `prepareCover(玩家复活点)` | 删除（不重生，无布防对象） |
> | 9 | 新增观战常量 | — | `SPECTATE_DIST=3.2 / SPECTATE_HEIGHT=1.6` [PLAYTEST] |
> | 10 | 出生无敌帧 | 重生时设 `SPAWN_PROT` | 仅开局出生可能涉及；无重生后不再触发（常量保留防回归） |
>
> 新增测试：`test/qa/_qa_v21_elimination.js`（28 断言全 PASS）。v2.0 的 §5.2/§5.4 重生相关协同（prepareCover/reformAll 依赖重生）实际失效，保留代码未删（防回归），不在现行流程调用。

> 项目：战地突击 Battleground Tactical FPS（Three.js r160）
> 作者：文策渊（design-strategist） · 版本：v2.0「倒地救援 + 智能安全出生点 + AI 协同复活」
> 状态：**设计定稿**，数值待 [PLAYTEST] 微调
> 范围：`js/game.js`（击杀/复活流程）、`js/ai.js`（AIBrain 状态机 + 战术层共存）、`js/ui.js`（Squad 组织 + 玩家倒地/救援 UI）、`js/world.js`（智能出生点）、`js/core.js`（CFG 新常量）、`js/net.js`（广播事件）
> 契约：**本文件只改"机制层"，不改"手感数值"**——命中率 `acc` / 视线重算 / 射速 / 弹匣 / 移速 / 伤害 / 护甲吸收 **全部不动**（延续「提难不加档」）
> 对接机制：`js/mechanics.js`（zone 缩圈 isOutside/escapeDest）、`js/world.js`（walkable/rayBlocked/coverPts/spawns）、`js/combat.js`（Unit/PlayerControls/E 键）、`js/items.js`（lootbox）、既有 v1.4 战术层（ai-tactics.md §1）

---

## 0. 设计原则（红线：机制层新增，手感层冻结）

1. **手感数值红线**：命中率 `acc`、视线重算 0.2s、受伤反应 1.6s、弹匣/换弹 5s、移动速度 3.6/6.2、武器伤害、护甲吸收 60%、手雷/烟时长——**全部维持现状，一个都不调**。本次大修只新增：倒地/救援/处决/智能出生/出生无敌帧/角色分工/集结波次。
2. **机制与既有状态机共存**：AI 的 `advance / engage / dodge` 三态与 v1.4 战术层（沙暴庇护/避光/边打边退/烟雾/护甲医疗/残血优先）对**存活单位**完全不变。新增 `revive`（救援）/ `execute`（处决）两个**叶状态**，仅在特定上下文进入，不扰动三态判定与 `tryShoot` 节奏。
3. **"击倒 ≠ 击杀"**：玩家/AI 打空敌人血量 → 进入**倒地（down）**而非立即死亡；只有**被处决 / 流血致死 / 被救起**才决定后续。击杀数、比分、死亡数、掉落、killfeed **只在最终死亡时结算**（防"击倒刷分"、防"击杀面板对不上"）。
4. **救援是"正向协作"而非"惩罚叠加"**：倒地不立刻扣分、不立即掉落；救起后给残血（`REVIVE_HP`）作为"复活但没完全复活"的中间态，奖励协作、惩罚独走。
5. **智能出生点永远不返回 null**：评分失败必须走兜底链（§4.4），游戏不因出生点问题崩溃（对齐既有 `pickSpawn` 的"绝对可用"语义）。
6. **联机由房主权威**：所有倒地/处决/救援裁决都在房主侧（对齐既有 `Net.isHost` 伤害裁决），客户端只收广播事件做表现与 UI（§9 同步注意点）。
7. **[PLAYTEST] 标注**：所有新增可调参数统一标注，工程联调后按实测收敛（§10 汇总表）。
8. **地图尺寸归一化**：smartSpawn 与 AI 分散/布防的**空间类距离**随地图实际尺寸缩放（`mapScale = mapDef.size / 300`；suburb=300 / desert=340 / port=260），交互类/战斗类/时间类距离**固定不缩放**——避免小图全挤、大图过稀。分类规则与缩放清单见 §4.7。

**为什么"击倒≠击杀"**：当前 `killUnit()` 一刀切——玩家死亡 5s 倒计时重生、AI 死亡 6~9s 随机点重生，队友之间零交互，死亡惩罚（弹匣清零+护甲 30%）来得突兀。改为倒地制后：死亡是一个**可被队友挽回的过程**，击杀方需要"补枪"或承受"敌人被拉起来"的代价，AI 有了"救人与被救"的协作叙事，玩家复活也由纯随机改为**可被战术预测的安全落点**——难度不上档，但决策密度上去了。

---

## 1. 倒地状态机（down / bleed-out / dead / revived 全状态迁移）

### 1.1 状态图（ASCII）

```
                         ┌─────────────────────────────────────────────┐
                         │                                             │
    ┌──────────┐  hp<=0  ▼      敌方武器/环境伤害打 downHp             │
    │  ALIVE   ├──────────────► ┌───────────┐   downHp<=0  ┌──────────┐│
    │(存活)    │                │   DOWN    ├─────────────►│   DEAD   ││
    └──────────┘                │ (倒地)    │   (处决)      │ (最终死亡)││
         ▲                      └─────┬─────┘              └────┬─────┘│
         │   revive 完成               │                          │      │
         │   hp=REVIVE_HP             │ bleedT<=0 (流血致死)      │ respawnT 到
         │                            └───────────► (同上 DEAD)    │      │
         └─────────────────────────◄── (revived 态)               │      ▼
                                                  │        ┌──────────┐
                                                  │        │  RESPAWN │ 出生无敌帧
                                                  │        │ (智能落点)│ SPAWN_PROT
                                                  └────────┴────┬─────┘
                                                                │
                                                                └─────────► ALIVE（回顶部）
```

### 1.2 状态定义与迁移表

| # | 迁移 | 触发条件 | 副作用（全部命名） | 广播事件 |
|---|------|---------|--------------------|----------|
| T1 | ALIVE → DOWN | `applyDamage` 结算后 `hp<=0` 且当前非 down | `u.life='down'`；`u.alive=false`；`u.down=true`；`u.downHp=CFG.DOWN_HP`；`u.bleedT=CFG.BLEED_OUT`；`u.reviveT=0`；`u.reviver=null`；`u.downAt=Date.now()`。**不**加分/不掉落/不加死亡数。玩家侧：`Game.playerDown(true)`（倒地 UI/爬行视角/收镜/取消迫击炮）；蓝队 `Squad.leaderTakeover()` 立即接管 | `{k:'down', id, x, z, by}` |
| T2 | DOWN → DEAD（处决） | down 中受敌方武器伤害，`downHp -= dmg <= 0` | 走 `toDead(u, attacker, 'executed')` | `{k:'kill', ...}`（沿用，含击杀者/爆头） |
| T3 | DOWN → DEAD（流血） | `Game.update` 每帧 `u.bleedT -= dt <= 0` | 走 `toDead(u, null, 'bleed')`（无击杀者，killfeed 显示"流血身亡"） | `{k:'kill', a:null, t, head:false}` |
| T4 | DOWN → DEAD（环境） | down 中受环境伤害（缩圈 `dmgPerSec` / 沙暴 `exposeDmg`）打到 `downHp<=0` | 同 T2，attacker=null，cause='zone'|'storm' | `{k:'kill', ...}` |
| T5 | DOWN → ALIVE（被救起） | 队友完成 `REVIVE_TIME` 秒救援且全程未被中断 | `u.life='alive'`；`u.down=false`；`u.alive=true`；`u.hp=CFG.REVIVE_HP`；`u.downHp=0`；`u.bleedT=0`；`u.reviver=null`；`u.reviveT=0`；**弹匣/备弹/护甲保持倒地前状态**（不加满，惩罚仍在） | `{k:'revive', id, by}` |
| T6 | DEAD → RESPAWN | `u.respawnT`（AI）到点 / `Game.deadT`（玩家）倒计时归零 | 走 `smartSpawn(team, opts)`（§4）代替 `pickSpawn` | `{k:'spawn'|'respawn', ...}`（沿用，坐标变为智能落点） |

### 1.3 关键语义

- **`u.alive` 兼容策略**：倒地单位 `alive=false`，因此既有 `perceive`（不打已死目标）、`updateCaps`（倒地不占点）、`UI.teams`（倒地不算存活数）、快照/插值全部天然兼容；新增 `u.down` 作为**专门判定**，渲染/爬行/救援/处决/小地图单独读取。
- **`deaths` / 击杀数 / 比分只在 T2/T3/T4（最终死亡）结算**：`toDead` 内才 `u.deaths++`、`attacker.kills++`、`score[attacker.team]++`、AI 掉落 `u.loot` + `Items.dropForUnit(u)`。原 `killUnit` 里的掉落/计分逻辑整体迁入 `toDead`。
- **AI 复活计时只设在最终死亡**：`toDead` 才 `u.respawnT = now_s() + U.rand(6, 9)`；倒地期间**没有** `respawnT`，`Game.update` 的 AI 重生循环（`u.ai && !u.alive && u.respawnT`）不会把倒地者当死人刷掉。
- **玩家侧**：倒地**不**置 `Game.dead`（死亡倒计时 UI 是最终死亡专属）；玩家倒地仍可爬行、可被 AI/队友救；`Game.dead=true` 只发生在 T2/T3/T4（玩家最终死亡后进入 `deadT=CFG.RESPAWN` 倒计时）。
- **`killUnit` 角色变化**：保留为"最终死亡"入口（由 `toDead` 调用），**内部直接强制处决**的调用（`rebalance` 撤 AI）行为不变；战斗路径不再直接走 `killUnit`，改走 `downOrKill` 分流（§8 契约）。

---

## 2. 救援交互（玩家救 AI / AI 救玩家 / AI 救 AI / 敌方处决）

### 2.1 通用救援通道（channel）

救援 = 一个 **REVIVE_TIME（3s）持续施法**：救援者需在倒地者 `REVIVE_RANGE（2.5m）` 内、持续朝向倒地者、不移动、不受到伤害，读条满即完成（T5）。任何一次中断 → `cancelRevive`，进度**清零重来**（[PLAYTEST] 是否保留部分进度）。

| 维度 | 规则 |
|------|------|
| 判定距离 | `REVIVE_RANGE = 2.5m`（以两单位 `pos` 水平距离计） |
| 持续施法 | 救援者 `u.reviveT` 每帧 `+= dt`，达 `CFG.REVIVE_TIME` 触发完成 |
| 朝向 | 救援者 yaw 朝向倒地者（玩家视角：准星须指向倒地者，宽松 ±30°） |
| 中断条件（任一） | ①救援者移动 >0.2m/s；②救援者受敌方伤害；③救援者 `canSee` 敌方（有更急的战斗）——AI 自动放弃；④倒地者再受敌方伤害（同时扣 downHp）；⑤救援者离开 `REVIVE_RANGE` |
| 中断副作用 | `cancelRevive`：`reviver.reviveT=0`、`reviver.reviverTarget=null`、`downed.reviver=null`；广播 `{k:'revive_cancel', id, by}` |
| 一次性 | 同一倒地者同时只允许 **1 名**救援者（`downed.reviver` 锁定），防多人叠读条 |

### 2.2 玩家救 AI（E 键）

- **按键**：对倒地蓝队 AI 队友，准星朝向他且距离 ≤ `REVIVE_RANGE`，按住 `E`（keydown 开始、keyup 取消——hold-to-revive，与指针对锁兼容）。
- **HUD**：救援进度条（`UI.reviveBar(p)`，复用横幅区或新增 `#reviveBar`）；提示"按住 E 救援队友…"。
- **E 键优先级**（改 `combat.js` keydown 的 KeyE 分支）：① 当前正在救援 → 释放取消；② 范围内有倒地队友 → 开始救援；③ 否则 `Mechanics.dispatch('interact')`；④ 否则 `Backpack.nearestCorpse()` 搜刮。**救援优先于搜尸**——倒地者不是尸体（掉落只在最终死亡）。
- 玩家救援 AI 完成：被救 AI 起立 `hp=REVIVE_HP`，走 §5 归队逻辑。

### 2.3 AI 救玩家 / AI 救 AI

- **AI 何时救人**：
  - **医疗兵（medic）**：主动搜索半径 `MEDIC_REVIVE_RANGE = 60m × mapScale`（**空间类**，随图缩放，§4.7）内倒地队友（含玩家），优先级高于当前命令（attack/defend 都让位，free 更让位），寻路前往、读条救援。
  - **非医疗兵**：仅当倒地队友在 `DEFAULT_REVIVE_RANGE = 8m`（**固定**，交互类，§4.7）内且当前无战斗（`!canSee`）才顺手救；不专程跑图去救（避免全队放下进攻去拉人）。
- **AI 救援状态**：新增 AI 状态 `'revive'`——进入后 `reviveTarget` 锁定倒地者，`moveTo` 到 2.5m 内停步、面向、`reviveT+=dt`；读条期间**不射击**（战术层全部让位）；若 `canSee` 敌方或受击 → `cancelRevive` 并转入 engage/dodge。
- **AI 救玩家**：蓝队玩家倒地 → 蓝队 AI 按上面规则行动；红队 AI 不会救蓝方玩家（阵营检查）。
- **红队 AI 互救**：红队 AI 同样倒地/互救/被玩家救？——玩家是蓝队，只能救蓝队 AI；红队 AI 之间互救、红队 AI 可救红队 AI（阵营内一致）。

### 2.4 敌方处决（execute）

- **玩家处决 AI**：倒地红队 AI 是"活靶"——对倒地者射击即扣其 `downHp`（`DOWN_HP=60`，步枪约 2~3 发/霰弹 1 发内处决）；倒地者不闪避、`acc` 模型不变（**不改手感**）。
- **AI 处决玩家/AI**：新增 AI 状态 `'execute'`——当**无存活目标**（`!canSee`）但 25m 内（**战斗类固定**，§4.7，与 acc 模型绑定）存在可见倒地敌人时，AI 逼近至武器射程内对其射击（正常 `acc` 模型）。**优先级低于存活目标**：有活敌就打活敌，不蹲尸。这制造"你不补枪，敌人就被拉起来"的张力（B5）。
- **处决 vs 救援的节奏**：`DOWN_HP` 给倒地者一个"被补枪前的窗口"，`REVIVE_TIME` 给队友一个"抢读条"窗口；两端数值由 [PLAYTEST] 收敛（§10）。

### 2.5 倒地爬行

- 玩家倒地：`PlayerControls` 输入速度降为 `CRAWL_SPEED=1.2m/s`，禁跳跃/冲刺/射击/开镜/迫击炮；视角高度降至 ~0.8m（低姿态）；可转向。
- AI 倒地：`AIBrain` 进入 `downUpdate(dt)` 专用分支——向**最近掩体/最近存活队友**方向爬行（`CRAWL_SPEED`），不射击、不感知攻击；其余字段冻结。
- 爬行不重置 `bleedT`（流血照常倒计时），爬行中被救起仍按 T5。

---

## 3. 救援时限数值表

| 参数（CFG 键名） | 默认值 | 单位 | 缩放 | 语义 | [PLAYTEST] |
|------|--------|------|------|------|-----------|
| `BLEED_OUT` | 12 | s | 固定（时间类） | 倒地流血倒计时；归零 → 流血致死（T3） | 10~15 |
| `DOWN_HP` | 60 | HP | 固定 | 倒地执行池；敌方武器/环境伤害扣此池，归零 → 处决（T2/T4） | 50~80 |
| `REVIVE_TIME` | 3 | s | 固定（时间类） | 持续救援读条时长；中断清零 | 2.5~4 |
| `REVIVE_HP` | 35 | HP | 固定 | 被救起后血量（护甲/弹药保持倒地前） | 30~40 |
| `REVIVE_RANGE` | 2.5 | m | 固定（交互类） | 救援判定距离（人手/枪口尺度，不随图缩放） | 2~3 |
| `CRAWL_SPEED` | 1.2 | m/s | 固定 | 倒地爬行速度（玩家/AI 通用） | 1.0~1.6 |
| `SPAWN_PROT` | 2.5 | s | 固定（时间类） | 出生无敌帧（对敌方武器伤害免疫） | 2~3.5 |
| `MEDIC_REVIVE_RANGE` | 60 | m | **×mapScale**（空间类） | 医疗兵主动救援搜索半径（覆盖密度跨图一致） | 40~80 |
| `DEFAULT_REVIVE_RANGE` | 8 | m | 固定（交互类） | 非医疗兵顺手救援半径（贴身级，缩放影响 <±15% 无意义） | 5~12 |

> 缩放规则：**空间类**（AI 搜索/布防/分散）随图缩放，**交互/战斗/时间/权重类**固定不缩放——完整分类与清单见 §4.7；smartSpawn 评分距离（TEAM_RANGE/ENEMY_RANGE/SPAWN_JITTER 等）在 §8.1 标注，不重复列于此表。

> 节奏推演：单人独走死亡 = 12s 流血（无人救）→ 5s 重生倒计时 ≈ **17s 离场**（比现在的 5s 长很多，是**有意的**——逼迫抱团/跟 AI 走，见 §10 风险 R1）。被队友救起 = 3s 读条 → 残血 35 继续作战，**离场时间≈0**。

---

## 4. 智能安全出生点算法（smartSpawn）

### 4.1 目标与原则

替换 `World.pickSpawn(team)` 的纯随机（`respawnPlayer` / `respawnAI` / Net 房主 respawn 分支均改走 `Game.smartSpawn(team, opts)`）。**开局出生**（`spawnPlayer` / `spawnAI` 首刷）保持原样（开局无敌人，评分无意义，避免动既有流程）。

### 4.2 候选集生成（≤ 40 个）

```
candidates = []
for each sp in World.spawns[team]（{x,z,y} 对象）:
  push sp
  for dir in 8 方向（45° 间隔）:
    p = sp + dir * (SPAWN_JITTER(4m) * mapScale)   // ×mapScale：候选抖动随图缩放（§4.7）
    if World.walkable(p.x, p.z): push {x, z, y: World.heightAt(x,z)}
（去重/去出界：x,z ∈ [1, WORLD-1]）
```

> `mapScale = mapDef.size / 300`（suburb=1.0 / desert=1.133 / port=0.867），工程接入见 §4.7。

### 4.3 安全分（safety score，越高越安全）

```
safety(p) =
    teammateBonus(p)          // 附近存活队友 → 加分
  - enemyProxPenalty(p)       // 最近敌方距离 → 扣分
  - enemyLosPenalty(p)        // 被敌方看见的点数 → 扣分
  - edgePenalty(p)            // 贴近圈边界/地图边界 → 小扣分
  + U.rand(0, 5)              // 抖动：防"复活点被预瞄死"的确定性

teammateBonus(p) = clamp((TEAM_RANGE(25)*mapScale - minDistToAliveTeammate) / (25*mapScale), 0, 1) * 15
enemyProxPenalty(p) = clamp((ENEMY_RANGE(40)*mapScale - minDistToAliveEnemy) / (40*mapScale), 0, 1) * 30   // 最近敌人最重要
enemyLosPenalty(p)  = losCount * 20    // 存活敌人眼中点 p 无遮挡（rayBlocked(敌眼,p胸)===null）的数量（权重无量纲，不缩放）
edgePenalty(p)      = zoneEdge ? 5 : 0 // 圈激活且 p 距圈边界 < EDGE_MARGIN(10m)*mapScale → 扣 5（防生在最边缘被圈压）
```

> 距离项（TEAM_RANGE / ENEMY_RANGE / EDGE_MARGIN）均 **×mapScale**；评分权重（15/30/20/5）是无量纲系数，**不缩放**（只缩放距离本身，不改变"距离主导"的排序逻辑）。

**硬约束（任一不满足即剔除候选）**：
- `World.walkable(p.x, p.z)` 为 true；
- 圈激活时 `!Mechanics.zone.isOutside(p.x, p.z)`（**绝不出圈外**——用户硬性要求，权重再高也顶不过硬剔除）；
- 与任意存活单位水平距离 ≥ `SPAWN_MIN_DIST(3m)`（不重叠出生；**固定**——碰撞级距离，与地图尺寸无关，见 §4.7）。

### 4.4 兜底链（safety 永远不返回 null）

1. 硬约束通过且 safety 最高者；
2. 无候选 → 以**最近存活队友**为圆心，复用 `Mechanics.zone.escapeDest` 的环形采样逻辑找圈内最近可走点（圈激活时；采样半径取圈半径 `curR` 的**分数比例**，天然随图缩放，无需额外乘 mapScale）；
3. 圈未激活 → 距所有敌人最远的 `World.spawns[team]` 原始点；
4. 绝对兜底 → `World.pickSpawn(team)`（现状行为，保底不崩）。

### 4.5 出生无敌帧（spawnProtT）

- 重生单位 `u.spawnProtT = CFG.SPAWN_PROT(2.5s)`。
- **效果**：`applyDamage` 前置守卫——`u.spawnProtT > 0 && attacker && attacker.team !== u.team` → 伤害无效（环境伤害不免疫，但硬约束已保证生在圈内）。
- **提前失效**：① 玩家/单位**开火造成伤害** → 立即清 `spawnProtT`（防"无敌窗白嫖对枪"）；② 离开出生点半径 `SPAWN_PROT_RADIUS=10m`（**固定**，交互类，§4.7）→ 清（防"无敌冲脸"）。
- **AI 侧**：`AIBrain.perceive` 跳过 `e.spawnProtT > 0` 的目标（AI 不预瞄无敌目标，配合表现）。

### 4.6 玩家 vs AI 出生策略

| 维度 | 玩家重生（blue） | AI 重生 |
|------|-----------------|---------|
| 队友加成权重 | **高**（teammateBonus ×1.5 → 22.5）：AI 已在附近可掩护 | 中（默认 15）：归队靠 Squad，不靠出生点 |
| 敌方视线惩罚 | **高**（losPenalty ×1.5 → 30/个）：绝不被出生即围 | 默认 |
| 对玩家距离 | — | **额外硬约束**：与玩家水平距离 ≥ `SPAWN_NO_PLAYER(25m)*mapScale`（红队 AI 不在玩家脸上刷出来；空间类，随图缩放） |
| 落点确定性 | 死亡瞬间预计算一次（§5.2 `playerRespawnPt`），重生复用它 | 每次重生现算（AI 归队快，无需预判） |

### 4.7 地图尺寸归一化（mapScale）与缩放分类规则

三图实际尺寸（`js/maps/*.js` 的 `mapDef.size`；`CFG.WORLD` 常量 300 会在 `World.load` 被覆写为实际值，见 world.js:117）：

| 地图 | size | mapScale = size/300 | 语义 |
|------|------|------|------|
| suburb 城郊 | 300 | 1.00（基准） | 标准密度 |
| desert 荒漠 | 340 | 1.133 | 空间距离放开：评分范围/搜索半径/分散间距更大 |
| port 港口 | 260 | 0.867 | 空间距离收敛：评分范围/搜索半径/分散间距更小，防全图挤一堆 |

**工程接入**：`World.load` 覆写 `CFG.WORLD` 后立即计算并缓存 `CFG.mapScale = (mapDef.size || CFG.WORLD) / 300`。smartSpawn / Squad / AIBrain 中所有标 `×mapScale` 的距离在运行时 `dist * CFG.mapScale`（一次乘法，无额外性能成本；出生评分只在重生时算，非每帧）。

**分类规则（核心：别一刀切）**：
- **空间类 → ×mapScale**：决定"在地图上找位置 / 铺阵型 / 覆盖密度"的距离——出生评分范围、候选抖动、圈边距、AI 主动搜索半径（医疗兵救援）、布防/掩护范围、散兵线/环绕偏移。理由：地图越大，同样绝对米数覆盖的相对面积越小；缩放保持**行为密度跨图一致**（小图不挤、大图不稀）。
- **交互类 → 固定**：决定"单位本体 / 玩家操作 / 读条判定"的距离——救援判定 `REVIVE_RANGE`、无敌帧判定半径 `SPAWN_PROT_RADIUS`、出生不重叠 `SPAWN_MIN_DIST`、单位分离 `2.4m`、贴身顺手救 `DEFAULT_REVIVE_RANGE`。理由：这是"人手/枪口/身体"尺度，与地图尺寸无关；缩放反而破坏操作一致性。
- **战斗类 → 固定**：与 acc 命中模型绑定的交战距离——sniper 最小交战 15m、execute 触发/追击 25m、medic 清障 <15m、perceive 90m。理由：命中率公式（`clamp(0.5 - d/150, ...)`）是手感红线不动，交战距离必须与其一致，否则"看得见打不着"。
- **时间类 → 固定**：`BLEED_OUT / REVIVE_TIME / SPAWN_PROT / protectT` 等秒数与空间无关。
- **权重类 → 固定**：`W_TEAMMATE/W_ENEMY/W_LOS/W_EDGE` 是无量纲评分权重，不乘 scale（只缩放距离本身）。

**缩放清单（§8.1 常量表同步标注）**：

| 常量/参数 | 基准值 | 缩放 | 类别 |
|------|------|------|------|
| `TEAM_RANGE` | 25m | ×mapScale | 空间-评分 |
| `ENEMY_RANGE` | 40m | ×mapScale | 空间-评分 |
| `SPAWN_JITTER` | 4m | ×mapScale | 空间-候选 |
| `EDGE_MARGIN` | 10m | ×mapScale | 空间-评分 |
| `SPAWN_NO_PLAYER` | 25m | ×mapScale | 空间-硬约束 |
| `MEDIC_REVIVE_RANGE` | 60m | ×mapScale | 空间-AI 搜索 |
| prepareCover 范围 | 8~15m | ×mapScale | 空间-布防 |
| spreadDest 侧向偏移 | 8m | ×mapScale | 空间-分散 |
| 防守环绕偏移 | +4m | ×mapScale | 空间-分散 |
| `SPAWN_MIN_DIST` | 3m | 固定 | 交互-碰撞 |
| `SPAWN_PROT_RADIUS` | 10m | 固定 | 交互-无敌帧 |
| `REVIVE_RANGE` | 2.5m | 固定 | 交互-救援判定 |
| `DEFAULT_REVIVE_RANGE` | 8m | 固定 | 交互-贴身注意 |
| 单位分离 | 2.4m | 固定 | 交互-碰撞 |
| sniper 15m / execute 25m / medic 15m / perceive 90m | — | 固定 | 战斗-acc 绑定 |
| `W_TEAMMATE` 等权重 | 15/30/20/5 | 固定 | 权重-无量纲 |

---

## 5. AI 协同复活与归队组织

### 5.1 玩家倒地 → AI 立即接管（已有，但提前触发）

- 原 `killUnit` 在玩家最终死亡时 `Squad.leaderTakeover()`；现在改为**玩家倒地（T1）立即接管**——倒地玩家不能指挥（`squadCommand` 增加 `!Game.player.down` 守卫），AI 队长马上带蓝队。

### 5.2 玩家最终死亡 → AI 提前布防掩护（B4「AI 感知复活时机」）

- 玩家 `toDead`（T2/T3/T4）时：`Game.playerRespawnPt = smartSpawn('blue', {cached:true})` 预计算并缓存；随后 `Squad.prepareCover(playerRespawnPt)`。
- `Squad.prepareCover(pt)`：挑选 ≤2 名**非狙击/非在读条救援中**的 AI（优先支援兵/突击手），令其移动到 pt 周围最近 `coverPts`（`8~15m × mapScale` 内；空间类，§4.7）并进入**掩护态**（`protectT=8s`：据守掩体、对靠近 pt 的敌人开火、不主动冲锋）；其余成员维持原命令。
- 玩家实际重生时：若缓存点已失效（`!walkable` 或出圈）→ 重算 `smartSpawn`，掩护 AI 据 `protectT` 剩余时间自动改向新点（A* 重寻路，自适应）。
- 玩家被**救起**（T5）而非重生 → `prepareCover` 不触发（没死就不需要布防）。

### 5.3 复活/重生后归队（B6「复活后战术组织」）

- **归队入口**：AI 被救起（T5）或重生（T6）后，`AIBrain.reset()` 前先置 `u.ai.regroup = true`；`reset()` 后 `followOrder` 走 `Squad.memberDest(m)`——按当前命令（group/attack/defend/free）自动归队，无需玩家额外操作。
- **队长带队集结**：`Squad.reformAll()`——若队内 ≥2 名成员刚归队（救起/重生），队长把 `objective` 重设为**红方质心/当前目标**，成员沿 `spreadDest` 散兵线推进（§7），形成"减员→收拢→再推进"的节奏。
- **与 Squad 指令对接**：`memberDest(m)` 对存活成员本就返回命令目标；新增只影响"刚归队者"——先回 `group` 集结点（若 order=attack/defend，则直接回目标点，不再绕行集结）。

### 5.4 波次进攻节奏（waveHold）

- `Squad.waveHold()`：每 2s 检查存活率 `aliveRatio = 存活成员 / 总成员`；`order==='attack' && aliveRatio < WAVE_HOLD_RATIO(0.5)` → 转入**守势**：剩余成员移动到目标附近最近 `coverPts` 据守、不冲点、对可见敌人射击。
- `Squad.waveResume()`：存活率回升至 `WAVE_HOLD_RATIO + 0.15`（被救起/重生补充）→ 恢复进攻推进。
- 效果：红/蓝 AI 都呈现"冲锋→减员→据守→回血复活→再冲锋"的**自然波次**，玩家感受是"AI 打不死打不完但有节奏"，不靠数值作弊（命中率/伤害未动）。

---

## 6. AI 分工专业化（B7，红蓝差异化）

### 6.1 角色与编成（替换 spawnAI 纯随机武器）

`spawnAI(team, n)` 的 `randRole`（50/20/15/15 随机）改为**战术角色固定编成**，武器由"角色 → 武器池"决定（保留角色池内随机，维持"每局布阵不同"的 v2.8 精神）：

| 战术角色（ai.role） | 蓝队 9 AI | 红队 10 AI | 武器池 | 战术行为 |
|------|-----------|-----------|--------|----------|
| `assault` 突击手 | 4（含 1 名队长 ★） | 4（含 1 名队长 ★） | rifle | 冲点、贴脸、进攻时最靠前；红队更激进（逼近频率↑） |
| `sniper` 狙击手 | 2 | 2 | sniper | 架枪：选远离目标的 coverPt 据守，不进 15m（战斗类固定，§4.7，与 acc 模型绑定） |
| `medic` 医疗兵 | 2 | 2 | rifle 70% / shotgun 30% | 主动救援（§2.3）；带 8 医疗包（他人 5）；进攻时居中 |
| `support` 支援兵 | 1 | 2 | shotgun 60% / rifle 40% | 补弹位（见下）；掩护队长；弹药盒拾取优先 |

> 队长（`leader`）不是独立槽位：从每队突击手中指定 1 名（★ 名牌，复用既有 `spawnAI` 的 leaderIdx 逻辑），其 `ai.role='assault'` 但挂队长行为（带队/带路/召集）。编成合计：蓝 4+2+2+1=9 ✓，红 4+2+2+2=10 ✓。

> 红蓝差异化：**红队偏进攻**（突击手 +1、行为更激进：engage 时逼近概率 +10%、dodge 后更快回攻）；**蓝队偏防守**（医疗兵 +1、狙击手据守更稳：换掩体节流更长）。全部为行为层，不碰 acc/射速/移速/伤害（红队"更凶"靠的是 4 个突击手贴脸，不是数值）。

### 6.2 与 spawnAI 随机武器机制的关系

- `Unit.weapon` 仍由 spawnAI 写入并同步（loot/弹药/搜刮逻辑不变）；只是来源从 `randRole()` 改为"角色 → 武器池"。
- 每局布阵差异现在来自：地图、玩家命令、红蓝编成差异（而非纯武器彩票）；狙击手固定 2 名会小幅降低武器多样性，换取可预期的战术（[PLAYTEST] 观察是否需保留 1 名随机位）。

### 6.3 医疗兵救援行为细化

- 医疗兵状态机插入点：`AIBrain.update` 在 `perceive` 之后、状态判定之前，先查 `findReviveTarget()`：
  - 半径 `MEDIC_REVIVE_RANGE` 内存在倒地队友（`u.down && u.team===myTeam && !u.reviver`）→ `state='revive'`，锁定最近者；
  - 医疗兵救人不看当前命令（attack/defend/free 一律让位）；但 `canSee` 敌方且敌方 <15m（战斗类固定，§4.7）→ 先 engage 清障再救（防救一半被打死）。
- 读条期间战术层（tacticalDest）整体跳过（`revive` 态优先于 shelter/light/retreat）。

### 6.4 支援兵补弹（MVP 边界 + 愿景）

- **MVP（本版实现）**：支援兵 `reserveMap` 为 2 倍备弹；其掉落 lootbox 弹药按备弹 80%（他人 50%）；行为上优先拾取弹药盒、据守队长/目标附近提供**压制射击**（对可见敌人持续点射，即使距离远）。
- **愿景（不在本版）**：真正的"给队友分发弹药"需要新增转移机制（选中队友/靠近投递），超出本版范围，标记为后续版本 [VISION]。

---

## 7. AI 分布分散方案（B8）

1. **出生/重生分散**：`smartSpawn` 候选集本身带 8 方向 `SPAWN_JITTER(4m)×mapScale` 抖动（§4.2）+ `SPAWN_MIN_DIST(3m)` 不重叠硬约束（固定）→ 10 人不会叠在一个点；AI 重生额外按 `u.ai.formationIdx`（0~9）给固定偏移方向，长期打散。
2. **行进散兵线**：`Squad.spreadDest(m, dest)`——`memberDest` 返回目标后，按成员在组内序号加**垂直前进方向的侧向偏移**：`offset = (idx%3 - 1) * 8m × mapScale`（三线散开，8m×mapScale 间距；空间类，§4.7），组与组之间本身去不同据点（既有 groups 逻辑），组内再散开 → 全队呈多个松散波次推进，不再单列纵队。
3. **防守环绕**：`defend` 命令下各组守各据点（既有），组内成员按 `idx` 环绕据点圆周边（`angle = idx/组员数 * 2π`，半径 `CAP_R + 4m×mapScale`）站位，不扎堆旗杆。
4. **开火分散**：无命令（free/自动战术）时，`nearestCoverPt` 按成员 `idx` 取第 `idx%N` 个候选掩体（错开），避免 3 人抢同一面墙。
5. **与既有分离逻辑叠加**：既有 2.4m 分离照常生效（固定，碰撞级）；新方案管的是**目标级分散**（去哪），分离管**碰撞级分散**（别叠），两者互补不冲突。

---

## 8. 与既有代码的对接点契约（给工程）

### 8.1 CFG 新常量（js/core.js）

```js
mapScale: 1,      // = mapDef.size / 300（World.load 覆写 CFG.WORLD 后计算并缓存；suburb=1.0 / desert=1.133 / port=0.867，§4.7）
RESPAWN: 5,        // 语义不变：最终死亡 → 重生倒计时（玩家）
BLEED_OUT: 12,     // [PLAYTEST] 10~15（时间类，固定）
DOWN_HP: 60,       // [PLAYTEST] 50~80（固定）
REVIVE_TIME: 3,    // [PLAYTEST] 2.5~4（时间类，固定）
REVIVE_HP: 35,     // [PLAYTEST] 30~40（固定）
REVIVE_RANGE: 2.5, // [PLAYTEST] 2~3（交互类，固定）
CRAWL_SPEED: 1.2,  // [PLAYTEST] 1.0~1.6（固定）
SPAWN_PROT: 2.5,   // [PLAYTEST] 2~3.5（时间类，固定）
SPAWN_JITTER: 4,   // 候选采样半径（m）· ×mapScale（空间类）
SPAWN_PROT_RADIUS: 10, // 出生点保护半径（m）· 固定（交互类）
MEDIC_REVIVE_RANGE: 60,  // [PLAYTEST] 40~80 · ×mapScale（空间类）
DEFAULT_REVIVE_RANGE: 8, // [PLAYTEST] 5~12 · 固定（交互类）
WAVE_HOLD_RATIO: 0.5,    // [PLAYTEST] 0.4~0.6（无量纲，固定）
// 出生评分（§4.3/§4.7：距离项 ×mapScale，权重项固定）
TEAM_RANGE: 25, ENEMY_RANGE: 40,   // ×mapScale（空间-评分）
EDGE_MARGIN: 10,                   // 圈边距（m）· ×mapScale（空间-评分）
SPAWN_MIN_DIST: 3,                 // 出生不重叠（m）· 固定（交互-碰撞）
SPAWN_NO_PLAYER: 25,               // AI 与玩家最小距离（m）· ×mapScale（空间-硬约束）
W_TEAMMATE: 15, W_ENEMY: 30, W_LOS: 20, W_EDGE: 5  // 权重（无量纲，不缩放）
```
> 缩放口径：所有标 `×mapScale` 的常量在运行时乘 `CFG.mapScale`；权重与时间/交互/战斗类常量原样使用。完整分类规则见 §4.7。

### 8.2 Unit 新字段（js/combat.js Unit 构造）

```js
this.life = 'alive';   // 'alive' | 'down' | 'dead'（规范态）
this.down = false;     // 倒地标记（down 时 alive=false 兼容旧读法）
this.downHp = 0;       // 倒地执行池（DOWN 时 = CFG.DOWN_HP）
this.bleedT = 0;       // 剩余流血秒数
this.reviveT = 0;      // 救援进度（0=空闲；>=REVIVE_TIME=完成）
this.reviver = null;   // 正在救援我的单位
this.spawnProtT = 0;   // 出生无敌帧剩余
this.downAt = 0;       // 倒地时刻（渲染/计时用）
```

### 8.3 Game 新方法/状态（js/game.js）

```js
// 新增字段
playerRespawnPt: null,   // 玩家最终死亡时预计算的智能落点（§5.2）

// 新增方法（工程实现）
Game.downOrKill(u, attacker, isHead)  // applyDamage 的 hp<=0 分流：非 down → toDown；down → 扣 downHp
Game.toDown(u, attacker)              // T1
Game.toDead(u, attacker, cause)       // T2/T3/T4（原 killUnit 的计分/掉落/玩家 deadT/AI respawnT 迁入）
Game.smartSpawn(team, opts)           // §4 评分+兜底链
Game.startRevive(reviver, downed)     // 开始救援（锁定 downed.reviver）
Game.cancelRevive(reviver, downed)    // 中断（清零双方）
Game.completeRevive(reviver, downed)  // T5
Game.playerDown(on)                   // 玩家倒地 UI/视角/输入开关
Game.tickDown(dt)                     // 每帧：bleedT 倒计时 → toDead('bleed')；spawnProtT 倒计时
Game.downHud()                        // 倒地/救援进度 UI 驱动（10Hz 并入既有 HUD 节流）
```

**改造点**：
- `applyDamage`：头部加 `if (u.down) { u.downHp -= dmg; if (u.downHp<=0) this.toDead(u, attacker, 'executed'); return; }`；护甲/血量结算后 `if (u.hp <= 0) this.downOrKill(u, attacker, isHead)`（不再直调 `killUnit`）。
- `applyDamage`：加出生无敌帧守卫 `if (u.spawnProtT > 0 && attacker && attacker.team !== u.team) return;`。
- `killUnit`：保留为最终死亡内部入口（`toDead` 调用）+ 强制处决（rebalance），战斗路径不再直调。
- `killUnit` 中玩家分支（deadT/死亡 overlay/mortar 清理/leaderTakeover）拆到 `toDown`（leaderTakeover、mortar、倒地 overlay）与 `toDead`（deadT、死亡 overlay）。
- `respawnPlayer` / `respawnAI`：`World.pickSpawn` → `Game.smartSpawn`；重生后设 `spawnProtT`。
- `Game.update`：新增 `tickDown(dt)` 调用（在 AI 重生循环前）。

### 8.4 AIBrain 新字段/方法/状态（js/ai.js）

```js
// 新增字段
this.reviveTarget = null;   // 正在救援的倒地队友
this.execTarget = null;     // 准备处决的倒地敌人
this.regroup = false;       // 刚救起/重生 → 归队标记
this.formationIdx = 0;      // 分散偏移序号（§7）
// 新增状态（并入既有 state 判定）
// 'revive' | 'execute'（叶状态，不扰动三态主流程）
// 新增方法
AIBrain.findReviveTarget()  // medic 60m×mapScale / 其他 8m（固定）搜索倒地队友（§2.3/§4.7）
AIBrain.tryRevive(dt)       // revive 态：移动→停步→读条；中断处理
AIBrain.executeDowned(dt)   // execute 态：无活敌时逼近并射击倒地敌人
AIBrain.downUpdate(dt)      // 倒地专用：向最近掩体/队友爬行（§2.5）
AIBrain.respawnDuty()       // 重生/救起后归队（regroup 清理 + 走 memberDest）
AIBrain.spreadOffset()      // 侧向散兵偏移（§7.2，供 followOrder 调用）
```

**改造点**：
- `update(dt, squad)` 头部：`if (u.down) { this.downUpdate(dt); return; }`。
- 状态判定新增：`else if (this.reviveTarget && this.reviveTarget.down) state='revive'; else if (this.execTarget && this.execTarget.down) state='execute';`（插在 `canSee→engage` 之后、`advance` 之前，注意 dodge 仍最高优先）。
- `perceive`：跳过 `e.spawnProtT > 0` 目标。
- `reset()`：清 `reviveTarget/execTarget/regroup`（冷却类沿用既有）。
- `followOrder`：`spreadOffset()` 叠加到 `memberDest` 目标；`regroup` 时先归 `memberDest`（§5.3）。

### 8.5 Squad 新方法（js/ui.js）

```js
Squad.prepareCover(pt)     // §5.2 布防：≤2 名 AI 占掩体保护 pt（protectT=8s）
Squad.reformAll()          // §5.3 队长重新集结推进
Squad.waveHold() / Squad.waveResume()  // §5.4 波次节奏
Squad.ensureLeader()       // 队长倒地 → 换存活者当队长（原 makeLeader 需过滤 !down && alive）
Squad.spreadDest(m, dest)  // §7 散兵线偏移
```
- `update(dt)`：每 2s 调 `waveHold/waveResume`；`makeLeader` 增加存活过滤（队长倒地后自动换人，原队长救起后**不抢回**，防队长频繁换人）。
- `leaderTakeover()` 守卫从 `Game.player.dead` 改为 `Game.player.dead || Game.player.down`。

### 8.6 输入与 UI（js/combat.js + js/ui.js）

- `combat.js` KeyE 分支：按 §2.2 优先级改造（救援 > Mechanics.interact > 搜尸）；`keyup` 释放 E 时若在救援 → `Game.cancelRevive`。
- `PlayerControls.update`：`Game.player.down` 时移动速度 = `CRAWL_SPEED`、禁 jump/sprint/fire/aim/mortar；视角高度降 0.8m。
- `UI`：新增 `#reviveBar`（救援进度）、倒地 overlay（复用 `deathOverlay` 加"倒地/流血"文案 + `bleedT` 倒计时）、小地图倒地队友标记（蓝色脉冲十字，非玩家倒地敌人不标）。
- `MiniMap.draw`：`if (u.down && u.team==='blue')` 画十字标记；`spawnProtT>0` 画白圈。

### 8.7 Net 广播事件（js/net.js）

| k | payload | 时机 |
|---|---------|------|
| `down` | `{id, x, z, by}` | T1（房主裁决） |
| `revive` | `{id, by}` | T5 完成 |
| `revive_cancel` | `{id, by}` | 中断 |
| `kill` | 沿用 `{a,t,head,ts}` | T2/T3/T4 最终死亡（分数/feed 语义不变） |
| `spawn`（AI）/ `respawn`（玩家） | 沿用，坐标来自 smartSpawn | T6 |

- **快照扩展**：`snapshot()` 每条单位追加 `down: u.down`；`applyStates` 对自身：`e.down && !Game.player.down` → 显示倒地 UI；`e.alive && Game.player.down` → 恢复（被救起）。
- **玩家请求**：倒地期间客户端**不**发 `respawn`；仍走既有 `die→snapshot→deadT→respawn` 流程（最终死亡后）。房主 `case 'respawn'` 分支的 `pickSpawn` 改 `smartSpawn`。
- **救援请求（多人）**：客户端按 E → `Net.sendState({t:'revive_req', target})`；房主校验距离/状态后执行 `startRevive`，广播 `revive`/`revive_cancel` 让所有人看到读条（进度条可只在本端显示，远端用 `revive`/`revive_cancel` 事件对状态即可）。

---

## 9. 边界与风险

### 9.1 边界（Edge Cases）

1. **倒地者在圈外**：环境伤害继续扣 `downHp`（更快处决）；被救起后若还在圈外，继续吃圈伤——不特殊豁免（缩圈压力对倒地有效，玩家需爬到圈内再求援）。
2. **倒地者再次被区域伤害**（手雷/迫击炮/炮击）：`areaDamage` 经 `applyDamage` → 扣 `downHp`；被手雷炸死 = 处决（attacker 记分）。**注意**：`areaDamage` 有 `if (!u.alive) continue;`——倒地 `alive=false` 会被跳过！需改为 `if (u.life === 'dead') continue;` 或 `if (!u.alive && !u.down) continue;`（工程必改点）。
3. **处决与救援同帧竞争**：救援读条中倒地者被补枪 → 扣 `downHp` 且 `cancelRevive`；`downHp` 归零 → 处决优先（T2 覆盖 T5）。
4. **队长倒地**：`ensureLeader` 换人；原队长被救起后不抢回（§8.5）。若全队只剩队长 1 人且倒地 → 无救援者 → 流血致死 → 重生（正常流程）。
5. **全员倒地/团灭**：蓝队全倒（含玩家）→ 无人可救 → 全员流血 → 依次重生；重生无"活队友加成"（teammateBonus=0）→ 评分靠"离敌最远 + 视线最少"，兜底链保底。
6. **出生无敌帧与对枪**：重生玩家开火 → 无敌立即消失（§4.5）；重生点 10m 内有敌人 → 敌人可看到玩家但打不动（无敌）→ 玩家选择开火/逃跑（玩家优势但有限，防"刷脸死"）。
7. **倒地单位不能成为"移动掩体"**：`rayBlocked` 不把倒地单位当遮挡（不新增碰撞），避免倒地挡子弹的怪象。
8. **v1.4 战术层与 revive/execute 共存**：`tacticalDest()` 只在 `alive` 单位主流程调用；`revive` 态读条期间跳过；`execute` 态允许正常射击但移动最小化（不追出 25m，战斗类固定，§4.7）。
9. **AI 无限救人的循环**：医疗兵救 A → 途中 A 已死 → `findReviveTarget` 重新锁定最近者；`reviveTarget` 失效校验（`!target.down || target.reviver!==null`）→ 换目标或回到原状态；救援冷却由路径耗时天然节流。
10. **缩圈末期出生**：最终圈很小，候选可能全在圈外 → 硬约束剔除后走兜底链 ②（`escapeDest` 环形采样圈内最近点）——保证"圈内出生"即使圈极小也成立。

### 9.2 [PLAYTEST] 汇总表

| # | 参数 | 默认 | 调高 ↑ | 调低 ↓ |
|---|------|------|--------|--------|
| 1 | BLEED_OUT | 12s | 更多被救机会/更磨 | 更紧张/更快节奏 |
| 2 | DOWN_HP | 60 | 更难补枪（更护倒地者） | 一枪秒杀（处决更爽） |
| 3 | REVIVE_TIME | 3s | 救援更难/更需掩护 | 救援更爽快 |
| 4 | REVIVE_HP | 35 | 救起更有战力 | 救起更脆 |
| 5 | CRAWL_SPEED | 1.2 | 爬更快/更易进掩体 | 更无助 |
| 6 | SPAWN_PROT | 2.5s | 更防刷脸死 | 更真实/更紧张 |
| 7 | W_TEAMMATE / W_ENEMY / W_LOS | 15/30/20 | 更重安全 | 更接近随机 |
| 8 | WAVE_HOLD_RATIO | 0.5 | 更早转守势（波次更密） | 更晚转守势（更莽） |
| 9 | 红队逼近 +10% | +10% | 红队更凶 | 红蓝更均势 |
| 10 | mapScale 缩放（空间类） | size/300 | 缩放过度 → 大图过稀/小图过密 | 缩放不足 → 三图密度不均 |

> 调参原则：任何一项升到"机制可见但玩家可反制"即可；若出现"AI 无限救人导致打不死 / 出生点被预瞄必死 / 全员倒地后无人救"→ 回退该项参数，不引入难度档位。

### 9.3 联机同步注意点

1. **房主权威**：down/execute/revive 全部房主裁决；客户端 `applyDamage` 不裁决（既有 `Net.connected && !Net.isHost` 守卫已覆盖 `areaDamage`，`applyDamage` 本身房主跑）。
2. **快照 vs 事件双通道**：倒地/复活高频发生在快照间隔（100ms）内的事件用 `down/revive/revive_cancel` 即时广播；低频状态一致性靠快照 `down` 字段兜底（丢包自愈）。
3. **玩家倒地输入**：爬行 = 既有 `state` 位置同步（10Hz），无需新通道；救援请求走 `revive_req` 单向消息。
4. **非房主死亡 UI**：自身倒地/复活的 overlay 由 `applyStates` 的 `down` 字段驱动（§8.7），不依赖事件顺序。
5. **出生点一致性**：`smartSpawn` 只在房主跑（respawn 分支都在房主/单机），客户端只收坐标——不要求两端评分一致，避免双端算分偏差。

### 9.4 已知风险

- **R1 独走死亡离场变长**：单人死亡 12s 流血 + 5s 重生 ≈ 17s（原 5s）。缓解：AI 队友会主动救玩家（medic `60m×mapScale` 半径），"独走被收"是设计意图；若实测挫败感过强 → 调 `BLEED_OUT` 至 10s 或玩家流血致死后的重生倒计时降至 3s（新增 `RESPAWN_AFTER_BLEED` 常量，[PLAYTEST]）。
- **R2 出生无敌帧滥用**：重生即开火白嫖。缓解：开火即失效 + 出 10m 失效（§4.5）；若仍被滥用 → 加"无敌期间造成伤害减半"或缩短 `SPAWN_PROT`。
- **R3 AI 救援优先级抢走进攻**：医疗兵长期救人导致前线空虚。缓解：`MEDIC_REVIVE_RANGE` 与"敌方 <15m 先清障"规则；[PLAYTEST] 观察红队进攻节奏是否崩坏。
- **R4 处决手感**：`DOWN_HP=60` 时步枪 2~3 发处决，霰弹 1 发——若玩家觉得"补枪太慢"→ 调 `DOWN_HP` 至 50；若 AI 处决玩家太快（读条没机会）→ 调 `W_LOS`/AI execute 触发半径。
- **R5 视觉/表现缺资产**：倒地爬行姿态、救援读条、倒地小地图标记为程序化表现（沿用既有 prone 姿态缩放/Canvas 覆盖层），无需新美术资产；GLB 模型（若有）不在本版范围。
- **R6 计分语义变化**：killfeed 将出现"X 击倒了 Y"与"X 击杀了 Y"两级信息；记分板只加最终死亡——需在 killfeed 文案区分（`down` 事件显示"击倒"，`kill` 显示"击杀"），避免玩家误读。

---

## 10. 交接清单（给工程）

1. [ ] `CFG` 新增 §8.1 全部常量（core.js）。
2. [ ] `Unit` 新增 §8.2 字段（combat.js）。
3. [ ] `Game.applyDamage` 三分支改造：出生无敌帧守卫 / down 时扣 downHp / hp<=0 走 `downOrKill`（game.js）。
4. [ ] `Game.toDown / toDead / downOrKill / tickDown / smartSpawn / startRevive / cancelRevive / completeRevive / playerDown / downHud` 实现；原 `killUnit` 玩家分支迁移；`respawnPlayer/respawnAI` 换 `smartSpawn` 并设 `spawnProtT`（game.js）。
5. [ ] **`areaDamage` 的 `!u.alive` 过滤改为允许 down 目标**（§9.1 边例 2，必改）。
6. [ ] `AIBrain`：`downUpdate / findReviveTarget / tryRevive / executeDowned / respawnDuty / spreadOffset` + `revive/execute` 状态 + perceive 跳过 `spawnProtT` + 医疗兵 8 医疗包（ai.js）。
7. [ ] `Squad`：`prepareCover / reformAll / waveHold / waveResume / ensureLeader / spreadDest`；`makeLeader` 存活过滤；`leaderTakeover` 守卫含 down（ui.js）。
8. [ ] `combat.js` KeyE 优先级改造 + hold-to-revive + `PlayerControls` 倒地输入降速；`UI` 新增 `#reviveBar` / 倒地 overlay / 小地图倒地与无敌帧标记。
9. [ ] `net.js`：`down / revive / revive_cancel` 事件 + 快照 `down` 字段 + `respawn` 分支换 `smartSpawn` + `revive_req` 请求。
10. [ ] `spawnAI` 编成改为 §6.1 角色表（蓝 4/2/2/1，红 4/2/2/2；突击手含队长；角色→武器池），红蓝行为差异参数入 CFG。
11. [ ] 确认手感数值零改动（§0 红线）：acc/视线/射速/移速/伤害/护甲吸收全表冻结。
12. [ ] [PLAYTEST] 后按 §9.2 汇总表收敛；独走死亡时长（R1）与 AI 处决节奏（R4）为优先观察项。
13. [ ] **smartSpawn 按地图尺寸归一化**：`CFG.mapScale = mapDef.size/300` 在 `World.load` 覆写 `CFG.WORLD` 后计算并缓存；§4.7 缩放清单内所有空间类距离乘 mapScale（`TEAM_RANGE/ENEMY_RANGE/SPAWN_JITTER/EDGE_MARGIN/SPAWN_NO_PLAYER/MEDIC_REVIVE_RANGE/prepareCover/spreadDest/防守环绕偏移`），交互/战斗/权重类不动；回归三图（260/300/340）验证出生与分散密度。
