# 缩圈架构（Zone）· v1.3

> 对应代码：`js/mechanics.js` 内 `Mechanics.zone`（独立子系统）、`js/ai.js`（AI 进圈）、`js/ui.js`（小地图圈 + 圈外 vignette）、`js/net.js`（m_zone 事件）、`js/world.js`（navgrid 高空分流）
> 数据契约：`mapDef.zone`（设计侧落数，三图已落地 5 阶段，见 `design/maps/zone-br.md`）
> 视觉规格：`art/zone-visual.md`（美术圣经附录 H）
> 冒烟覆盖：`test/smoke.js` §4.13/4.14、`test/v13-zone-bridge-probe.js`（深度探针）

---

## 1. 设计目标

据点战嵌入缩圈（**不动赢法**）：以**圈外递增环境伤害**制造向心紧迫感，加速对局节奏但不改变「时间到比分高者胜」的胜负规则。三图叠加于既有机制之上（port 探照灯 / desert 沙暴 / suburb 空投炮击），是**叠加系统**而非互斥机制。

| 要素 | 行为 |
|------|------|
| 阶段状态机 | `mapDef.zone.phases[]` 按 `atSec`（对局开始后绝对秒）推进；到点立即开始收缩（半径 lerp）+ **伤害即时切换**到下一阶段 |
| 圈外伤害 | 圈外（dist > curR）单位每秒 `dmgPerSec`，2Hz 节流；`owner=null` 环境伤害**不产分** |
| AI 进圈 | 圈外 AI 在寻路目标里把「圈内最近可达点」提升为最高优先级；圈外 AI 同样吃圈伤 |
| 视觉 | 3D 白实线当前圈 + 白辉光 + 电蓝虚线预告圈（全 `fog:false`）；小地图双圈；圈外电蓝 vignette 随距离递增 |
| 联机 | 房主权威模拟 + `m_zone` 事件广播；客户端只渲染圈不裁决伤害 |

## 2. Schema（容错契约）

`mapDef.zone` 顶层字段（与 `mechanics` 独立共存）：

```
zone: {
  center: { x, z },                    // 圈心（缺省地图中心 W/2）
  phases: [ { atSec, r, dmgPerSec } ], // atSec=对局开始后绝对秒；首阶段起始圈（r 覆盖全图），后续到点缩
  warnSec?: 10,                        // 阶段警示提前秒
  color?: 0x3f9fd8,                    // 兼容保留（视觉已按 art 固定白/电蓝，见 §5）
  shrinkSec?: 2                        // 收缩过渡秒（设计 v1.3 默认 2s）
}
```

**容错规则**：缺 `zone`、缺 `center`、`phases` 非数组/为空、字段缺失 → `init` 置 `active=false` 跳过，不开圈（向后兼容，smoke §4.13⑤ 断言）。

**阶段语义（与设计契约一致）**：`atSec ≤ elapsed` 取最后一个阶段为当前生效；到下一 `atSec` → `warnSec` 警示 → 立即收缩（2s lerp）+ 伤害切到下一阶段（紧迫感即时生效）。

## 3. Zone 生命周期

```
World.load(mapDef)
  └─> Mechanics.init(mapDef)
        ├─ Mechanics.zone.init(mapDef.zone, mapDef)   // 独立子系统，与 cfg.type 机制叠加
        │     ├─ 容错校验（缺 zone/phases → active=false 返回）
        │     ├─ 解析阶段表（排序 + 首阶段 atSec 归 0）
        │     └─ _buildVisual()：白实线环 + 白辉光 + 电蓝虚线预告圈（MeshBasic + fog:false）
        └─ _init<机制>（searchlight/sandstorm/airdrop 照常）

Game.update(dt)                          // 主循环（phase==='playing'）
  └─> Mechanics.tick(dt)
        ├─ Mechanics.zone.tick(dt)       // 缩圈：所有端 _updateVisual + 仅房主 _sim
        │     ├─ _updateVisual：收缩 lerp + 环重建（半径变化才重建）+ 圈外 vignette 节流
        │     └─ _sim（房主/单机）：阶段推进 / 伤害递增 / 圈外伤害(2Hz) / 玩家警示
        └─ 既有机制 tick（searchlight/sandstorm/airdrop）

Net.applyEvent(e)                        // 联机（客户端）
  └─> Mechanics.onEvent(e)
        └─ k==='m_zone' → zone.onEvent(e)：phaseIdx/dmgPerSec/center 更新 + 收缩起点（本地 lerp 渲染）
```

**与既有机制关系**：互不干扰、独立状态。desert 的「圈外 + 沙暴暴露」伤害会叠加（设计预期：`dmgPerSec + exposeDmg` 双压）。

## 4. AI 进圈接缝

| 接入点 | 代码 | 行为 |
|--------|------|------|
| `AIBrain.zoneDest()` | `ai.js` | 圈外 → 返回圈内最近可达点（`Mechanics.zone.escapeDest`：从圈心向外采样可走格，防圈心被建筑占死）；圈内/未开圈 → null |
| `followOrder()` | `ai.js` | 目标选择优先级：**缩圈目标 > squad 命令/分队目标/自动目标** |
| `update()` 非战斗分支 | `ai.js` | 圈外时 `tryLoot` 跳过（进圈保命 > 搜刮） |
| 圈外 AI 吃圈伤 | `zone._sim` | 与玩家同通道 `Game.applyDamage(u, dmg, null, false)` |

**战斗行为不受扰**：`engage`（交火）/`dodge`（躲避）状态不触发进圈——只有无敌人（advance/寻路）时才把圈心作为目标，避免「打架中途逃跑」破坏战术。

## 5. 视觉（art/zone-visual.md 规格）

| 视觉项 | 实现 | fog:false |
|--------|------|-----------|
| 3D 当前圈 | 白 `0xf0f4f8` 实线 `RingGeometry(R-0.5, R+0.5, seg)`，opacity 0.85 | ✅ |
| 3D 白辉光 | 白 `0xf0f4f8` `RingGeometry(R-2.2, R+2.2, seg)`，opacity 0.12（无后处理下的边缘光效） | ✅ |
| 3D 预告圈 | 电蓝 `0x2f7fe8` 虚线（24 弧段，每段 12° 实 + 3° 空），opacity 0.9，半径=下阶段 r；最终阶段隐藏 | ✅ |
| 小地图 | 当前圈白实线 `#f0f4f8` + 极淡填充；预告圈电蓝虚线 `setLineDash([5,4])`；**绘制在据点之前**（圈在最底层） | — |
| 圈外 vignette | 新元素 `#zoneVignette`，电蓝径向渐变；`opacity = clamp(distOut/60, 0.12, 0.45)`，与受击红闪 `#vignette` 完全分离 | — |

**fog:false 记录（顺带修复，art/zone-visual §6 风险）**：沙暴雾 far=70、夜港雾 40/200 下，雾会「吃掉」未设 fog:false 的圈。本次一并补齐：
- 既有据点环（`world.js` buildCapturePoints）→ 补 `fog: false`
- 水塔环 / 炮击警示环 ×2（`mechanics.js`）→ 补 `fog: false`
- 迫击炮落点环（`game.js` buildMortarMarker）→ 补 `fog: false`
- 缩圈三层环全部新建时即 `fog: false`

**颜色语义**：当前圈白（安全）、预告圈电蓝（收缩/预告）——**禁止队伍蓝**；电蓝 `0x2f7fe8` 明度 Y≈0.19 比队伍蓝 `#5aa9ff` Y≈0.378 暗 2 倍，灰度下「圈 ≠ 蓝方」；形状（实线/虚线）是主信道（色盲安全）。

## 6. 权威模型与联机

- **权威**：完整模拟（阶段推进 / 伤害裁决 / 玩家警示）只在房主/单机（`Mechanics._host()`）执行；客户端不裁决伤害。
- **广播**：房主在阶段推进时 `Net.broadcastEvent({ k:'m_zone', phase, r, from, cx, cz, dmgPerSec })`；警示时 `{ k:'m_zone', warn:true, phase }`。`net.js` applyEvent 已挂 `m_zone` → `Mechanics.onEvent`。
- **客户端渲染**：收到事件后更新 `phaseIdx/dmgPerSec/center` + 设置收缩起点 `_shrinkFrom`/`targetR` → 本地 `_updateVisual` lerp 渲染（视觉平滑，与房主一致）；预告圈随阶段重建。客户端**不做** `_sim`（不推阶段、不扣血）。
- **快照回写**：玩家血量/状态仍由 10Hz 快照回写，与既有机制同款。

## 7. 性能（RingGeometry 结论）

- **不每帧重建**：亮线/辉光环只在 `curR` 变化 >0.5m（收缩期）时重建 `RingGeometry`；非收缩期**零重建**。预告圈仅在阶段推进时重建（24 弧段）。
- **seg 按 R 自适应**：`clamp(ceil(2πR/4), 64, 192)`（art 规格）——R≥50 时 32 段会折线明显；R=130 → 128 段 ≈ 每段 6.4m 平滑。
- 收缩期 2s × 60fps ≈ 120 次重建 × (2 环 × ~386 顶点) ≈ 92k 顶点分配/次收缩——可接受（art §1.2 明确「120 次重建可接受」）；未用几何池（`RingGeometry` 重建不触发材质重编译，`geometry.dispose()` 防内存累积）。
- 全图仅 1 组圈 mesh（非每据点一份），远低于 4 探照灯锥 + 炮击环 + 空投信标开销。
- 小地图圈为 canvas 2D 每帧 stroke（已 8Hz 节流），无额外 mesh。

## 8. 文件索引

| 文件 | 职责 |
|------|------|
| `js/mechanics.js` | `Mechanics.zone` 子系统（生命周期/阶段机/伤害/vignette/联机事件）+ 水塔/炮击环 fog:false |
| `js/ai.js` | `AIBrain.zoneDest()` + `followOrder` 优先级 + 圈外不捡盒 |
| `js/ui.js` | `MiniMap.draw` 双圈（据点前）+ `UI.zoneVignette` |
| `js/net.js` | `applyEvent` 挂 `m_zone` |
| `js/world.js` | 据点环 fog:false + `buildNavGrid` 高空分流（bridge 桥下可通行） |
| `js/game.js` | 迫击炮环 fog:false |
| `index.html` | `#zoneVignette` 元素 + CSS |
| `js/maps/{port,desert,suburb}.js` | `mapDef.zone` 数据 + bridge/stairs 放置（设计侧） |
| `test/smoke.js` | §4.13 缩圈 + §4.14 桥梯 A* 回归 |
| `test/v13-zone-bridge-probe.js` | 三图深度探针（阶段/速率/AI/桥梯/连通/容错） |

## 9. Backlog

1. **y-碰撞站立支持（可选）**：站 collider 顶部（y≥max.y）不被碰撞推出——当前 moveTo/PC 物理对「从上方落在 collider 顶」无专门处理，成本高（需 AABB 顶面分离轴判定），记 backlog。
2. **#radio 阶段通知（art P1 #4）**：当前阶段警示用 `UI.banner`（⚠ 安全区即将收缩 / ⚠ 你已在圈外）；art 建议走 `#radio` 通道（⏳/🌀/⚠ 文案）。待 design-strategist 定稿最终文案后接入，与既有机制通知共用通道。
3. **收缩动画细化（art P1 #5）**：当前白圈 lerp 收缩（视觉正确）；art 的理想口径是「白圈不动、电蓝圈动」。差异仅在动画语义，P1 增强可后续对齐。
4. **环上刻度块 / 收缩方向箭头（art P2 #6）**：8 个白色刻度块 + 4 个电蓝方向箭头，增强轮廓识别，P2。
5. **客户端预告圈虚线弧段**：`ShapeGeometry` 弧段每阶段重建一次；若后续地图半径序列更长，可预建弧段几何池（当前 24 段成本可忽略）。
