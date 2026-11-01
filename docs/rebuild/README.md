# 地图 / 建筑系统 v4 重建工作区

> **状态：架构与目录骨架已建立，运行时尚未实现；本分支暂不可玩。**
> 分支：`rebuild/maps-v4`　基线：`main@154be4e`　架构版本：v4.0

## 已定架构
1. 保留渲染、角色、枪械、战斗规则、AI 战术逻辑、网络、UI、音效与通用机制。
2. 从零重建地图运行时、建筑资产管线、物理碰撞、导航、出生点与地图级 QA。
3. JSON MapSpec 是地图唯一事实源；程序化生成器只输出 MapSpec。
4. Blender 修复几何、真实尺寸、原点、楼层和开口后再导出 GLB；不复用旧派生碰撞资产。
5. Rapier 3D 负责物理碰撞与角色控制；所有碰撞来自显式 COL 代理。
6. 导航使用稀疏分层 tile graph，按 floorId / 高度 / 净空建图，楼梯门梯子通过显式连接边连接。
7. 用 WorldCompat 兼容旧 Game/AI/Combat 调用，逐模块迁移，不重写游戏主体。

## 阅读顺序
| 顺序 | 文档 | 内容 |
|---|---|---|
| 1 | [架构总览](architecture.md) | 模块边界、生命周期、依赖 |
| 2 | [资产契约](asset-contract.md) | Blender / GLB 尺寸、坐标和节点角色 |
| 3 | [MapSpec](map-spec.md) | 地图 JSON 唯一格式 |
| 4 | [碰撞与导航](collision-navigation.md) | Rapier、角色控制器、分层导航 |
| 5 | [实施计划](implementation-plan.md) | 实施顺序、产物和退出门槛 |
| 6 | [验收标准](acceptance-criteria.md) | P0/P1 测试门禁 |
| 7 | [清理记录](cleanup-record.md) | 删除、保留和隔离范围 |
| ADR | [决策记录](decisions/) | 已确定的架构决策 |

## 新目录约定
```text
assets/source-buildings/    # 原始输入 GLB，仅供 Blender 修复
data/assets/                # 建筑 Catalog、agent profiles
data/maps/                  # suburb / port / desert MapSpec JSON
js/world/core/              # runtime 生命周期和编排
js/world/assets/            # Catalog、GLB 解析、节点校验
js/world/map/               # MapSpec loader / builder
js/world/collision/         # Rapier PhysicsWorld
js/world/navigation/        # 分层导航 tile graph
js/world/spawn/             # 出生和重生服务
js/world/debug/             # VIS/COL/NAV/debug overlay
models/buildings/           # 通过验收的 v4 GLB（当前应为空）
tools/buildings/            # Blender 导出和 GLB 校验
tools/maps/                 # MapSpec 校验、导航烘焙
test/world/                 # v4 资产/碰撞/导航/地图测试
test/fixtures/world/        # 可重复的小测试场景
```

## 坐标与尺度
Three.js 右手系，Y-up，1 world unit = 1m；建筑局部原点是 footprint 中心的地面点。默认 scale=(1,1,1)，禁止隐藏的全局资产倍率。模型目标尺寸由设计契约单独决定，不能把当前 GLB 的缩水尺寸当作标准。

## 运行状态
旧 `js/world.js` 和旧地图脚本从活动路径移除。新 runtime 未完成时入口应显示“v4 重建中”并中止启动，避免误导性报错。此分支不是可玩版本，也不应合并 main，直到 P0 验收通过。
