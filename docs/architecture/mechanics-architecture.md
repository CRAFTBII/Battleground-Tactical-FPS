# 地图机制架构（Mechanics）· v1.2

> 对应代码：`js/mechanics.js`（引擎）、`js/maps/{port,desert,suburb}.js` 的 `mechanics` 字段（数据）
> 数据规格：`design/maps/mechanics.md`（设计侧）
> 冒烟覆盖：`test/smoke.js` §4.11（注入配置行为断言）+ §4.12（三图真实数据激活断言）、`test/port-density-probe.js` §6

---

## 1. 设计目标

v1.2 为每张地图赋予**独一无二的玩法机制**，由地图数据驱动，运行时统一由 `Mechanics` 引擎调度：

| 地图 | 机制 | 核心玩法 |
|------|------|---------|
| 夜港 port | `searchlight` 探照灯 | 制高点探照灯往复扫描，被扫到 → 曝露（小地图 ping + 标记）；配电箱 E 交互断电（灯灭 + 夜战优势 + 代价/冷却） |
| 荒漠 desert | `sandstorm` 沙暴 | 周期风暴：雾 near/far/color 插值骤浓、AI 命中骤降、暴露者持续伤害；水塔占领回血 |
| 城郊 suburb | `airdrop` 空投 + `arty` 炮击 | 定时空投补给箱（信标 + 降落 + 拾取回血/弹药）；周期炮击（警示 4s + 延迟伤害） |

## 2. Schema（容错契约）

`mapDef.mechanics` 两种形态（引擎自动识别）：

```
// 形态 A（推荐，按地图 id 分键）
mapDef.mechanics = {
  port:   { type:'searchlight', lights[], powerPanels[], expose{} },
  desert: { type:'sandstorm',  cycle{}, fog{}, exposeDmg, tower{} },
  suburb: { type:'airdrop',    intervalSec, drops[], crate{}, arty{} }
}
// 形态 B（直接，当前三图使用）
mapDef.mechanics = { type:'searchlight'|'sandstorm'|'airdrop', ... }
```

各机制字段（`?` 表示缺省自动补）：

```
searchlight:
  lights[]     每盏 { x, z, y?, range?(默认42), halfAngle?°(锥半宽18), speed?°/s(26),
                     dir?±1, yawDeg?(sweep 中位), sweepDeg?(sweep 半幅), color? }
  powerPanels[] { x, z, r?(3), cd?(断电秒45), cost?(代价分0) }   // E 交互断电
  expose{}      { minimapPing?, markT?(4), color? }

sandstorm:
  cycle { stormSec?(风暴秒, 兼容 dur), calmSec?(平静秒, 兼容 interval), fadeDur?(2.5) }
  fog   { storm { near(8), far(55), color }, calm { near/far/color ← 缺省取地图 env.fog } }
  exposeDmg      暴露者每秒伤害(4)
  tower   { x, z, r?(8), healPerSec?(回血/秒5, 兼容 heal) }      // 占领回血（人数多的一队）

airdrop:
  intervalSec    空投间隔(50)
  drops[]        投放点 {x,z}（缺省随机三点）
  crate { radius?(2.2), heal?(40), ammo?(绝对量) | ammoPct?(按备弹比例), fallSec?(3) }
  arty  { intervalSec?(炮击间隔40), zone:{x,z,r} 或数组, warnSec?(警示4), dmg?(90), radius?(8) }
```

**容错规则**：未知 `type`、缺字段、`mechanics` 缺失 → `init` 捕获异常置 `active=false`，游戏照常运行不崩（见 smoke §4.11⑤）。

## 3. Mechanics 生命周期

```
World.load(mapDef)
  └─> Mechanics.init(mapDef)          // 末尾调用（world.js）
        ├─ dispose()                   // 清上一图场景对象/曝露/标记
        ├─ 识别 cfg（形态 A/B）
        └─ _initSearchlight / _initSandstorm / _initAirdrop
              ├─ 读配置（容错缺省）
              ├─ 构建场景视觉（光锥/雾/水塔/空投伞/警示环）→ this.objs
              └─ 预计算（沙暴庇护区 = colliders 外扩 2m）

Game.update(dt)                        // 主循环
  └─> Mechanics.tick(dt)
        ├─ _updateVisual(dt)           // 所有端：光锥旋转/雾插值/降落动画/警示环闪烁
        └─ _sim(dt)                    // 仅房主/单机（!Net.connected || Net.isHost）
              ├─ searchlight：扫描曝露 / 断电冷却 / 标记老化
              ├─ sandstorm：风暴启停 / 暴露伤害(2Hz) / 水塔回血(2Hz)
              └─ airdrop：空投定时落箱 / 炮击警示→延迟伤害

PC keydown 'KeyE'                      // 玩家交互
  └─> Mechanics.dispatch('interact')
        ├─ searchlight：就近配电箱断电（30s 灯灭 + 队级冷却 45s + 代价 + 广播）
        │             断电期内任意一方到任一配电箱 → 抢修立即恢复供电（设计 §2.2 反制对称）
        └─ airdrop：就近已落地空投箱拾取（回血+补弹药+广播）

Net.applyEvent(e)                      // 联机事件（客户端）
  └─> Mechanics.onEvent(e)
        ├─ m_storm {storm}    → 客户端雾状态同步
        ├─ m_airdrop {x,z,pick}→ 客户端落箱/收箱视觉
        ├─ m_pwr {on}         → 客户端探照灯电源状态 + 环境光切换
        └─ m_arty {x,z,r,warn}→ 客户端警示环（半径=伤害半径）
```

## 4. 与现有系统的接缝

| 系统 | 接缝点 | 说明 |
|------|--------|------|
| World | `World.load` 末尾 `Mechanics.init(mapDef)` | 地图切换自动重建/回收机制对象 |
| World | `World.rayBlocked` → `rayAABB` | v1.2 修复：slab 测试正确处理轴平行射线（旧实现 d=0 → 0/0=NaN 污染 tmax → 薄墙误判命中，影响子弹 LOS 与炮击遮挡） |
| Game | `Game.update` 内 `Mechanics.tick(dt)` | 仅 `phase==='playing'` 时运行 |
| Game | `Game.applyDamage(u, dmg, null, false)` | 沙暴暴露伤害 / 炮击（arty 走 `Game.areaDamage`） |
| Game | `Game.areaDamage(..., wallBlock?)` | v1.2：新增可选 `wallBlock` 参数（默认 false）；炮击传 true → 掩体遮挡（复用 rayBlocked），不影响手雷/迫击炮既有调用 |
| Game | `Game.score` 代价 | 断电 `cost` 扣分（防无代价断电刷夜战优势） |
| AI | `AIBrain.tryShoot` 内 `Mechanics.stormActive()` | 沙暴中 AI 命中 ×0.5，**仅 20m 外目标**（设计 §3.1/§5 阈值） |
| UI | `MiniMap.draw` 内 `Mechanics.marks` | 曝露 ping / 空投信标 / 炮击警示统一渲染 |
| UI | `UI.banner` / `UI.updateHealth` / `UI.updateAmmo` | 机制事件 HUD 提示 / 拾取回血刷新 / 水塔易主 banner |
| PC | `keydown 'KeyE'` → `Mechanics.dispatch('interact')` | 配电箱断电/抢修 / 空投拾取 |
| Net | `Net.broadcastEvent` + `applyEvent` 4 个 case | 房主广播，客户端视觉同步 |

## 5. 权威模型与联机现状（最小可行）

- **权威**：完整模拟只在房主/单机（`!Net.connected || Net.isHost`）执行；客户端只播广播事件（雾状态、落箱/收箱、断电、警示环），伤害由房主裁决（与 `Game.areaDamage` 同款守卫）。
- **现状**：搜索灯曝露、沙暴雾、空投箱、炮击警示均可通过 `m_*` 事件同步到客户端；水塔占领复用 `{k:'cap', id:'tower', owner}` 广播（与 A/B/C 据点 cap 事件同通道，客户端不额外处理，状态由 10Hz 快照回写）。
- **v1.2 数值对齐设计（T12 门控修复）**：
  - searchlight：断电期默认 30s（`offSec`）、断电/抢修冷却 45s（`coolSec`，**按队计** `state.teamCool`）；断电时环境光 0.46→0.32（art P1，≥0.30 红线），恢复还原，雾不动。
  - sandstorm：水塔占领推进（复用据点进度模式，单人 ≈12s 占塔）+ 占领方圈内回血 5HP/s（2Hz 节流）；庇护判定 = 水塔圈 ∪ 建筑 footprint 内部 ∪ 碰撞体外扩 2m。
  - airdrop/arty：炮击落点 zone 内随机（圆形均匀），警示圈半径 = 伤害半径，落弹可被掩体遮挡（wallBlock=true）。
- **已知简化（Backlog）**：
  1. 客户端探照灯曝露判定不做（只显示房主广播的状态）——低风险，因为曝露仅小地图提示。
  2. 沙暴 `shelter` 在客户端不重算（客户端不做暴露伤害，仅视觉）。
  3. 炮击落弹特效复用现有 `boom` 事件；客户端不重放伤害计算。
  4. 空投箱拾取由房主裁决并广播 `pick`，客户端移除本地视觉；拾取者的补弹药/回血以房主快照（10Hz）回写。
  5. `searchlight.lights[].tiltDeg` 目前仅作数据保留，未参与锥体倾斜（光锥按水平扇形近似）——视觉已够用，物理倾斜进 backlog。
  6. 水塔占领进度不渲染 3D 可视化（仅 banner + cap 广播）；单机表现与据点一致，联机客户端经快照同步。

## 6. 性能

- 曝露扫描：每灯对存活单位 O(units)，单位数 ≤20 → 可忽略。
- 沙暴庇护区：`init` 预计算一次（colliders 去重外扩 2m），运行时 2Hz 采样，无每帧全量扫描。
- 光锥/警示环/空投伞几何：每机制仅数个 Mesh，`dispose()` 统一回收；无每帧 new 几何。

## 7. 文件索引

| 文件 | 职责 |
|------|------|
| `js/mechanics.js` | 机制引擎（生命周期/三机制/交互/联机事件） |
| `js/maps/port.js` | 夜港：`mechanics.searchlight`（4 灯 + 2 配电箱） |
| `js/maps/desert.js` | 荒漠：`mechanics.sandstorm`（周期 + 水塔 D13） |
| `js/maps/suburb.js` | 城郊：`mechanics.airdrop`（空投 + 中央广场炮击） |
| `js/models.js` | BuildingLib 新 9 类型 CONFIGS + BUILDINGS_OUT 内联重建 + 朝向修复/缩放 |
| `models/buildings_out.js` | models/out 9 新类型内联几何（tools/glb2bldg_out.js 生成） |
| `test/smoke.js` | §4.10/4.11/4.12 断言 |
| `test/port-density-probe.js` | 三图密度/寻路/机制激活回归 |
