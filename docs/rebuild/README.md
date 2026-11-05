# 地图 / 建筑系统 v4 重建工作区

> **状态：可玩（单机训练版）。** Rapier 碰撞、三张 300m 城镇图、出生/据点/AI/战斗已接通。
> 分支：`rebuild/maps-v4`　基线：`main@154be4e`　架构版本：v4.0
>
> **试玩**：`node server.js` → `http://localhost:8080/` → 选图 → 开始单人战役。
> 独立模型沙盒：`http://localhost:8080/sandbox.html`。

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
| 2.1 | [尺度决策](scale-decision.md) | 默认 2.0m / 上限 2.2m 角色、1.85m 相机 → 层高、门洞、建筑目标尺寸 |
| 2.2 | [角色契约](actor-contract.md) | 多人物模型扩展口、相机/胶囊/锚点 |
| 3 | [MapSpec](map-spec.md) | 地图 JSON 唯一格式 |
| 4 | [碰撞与导航](collision-navigation.md) | Rapier、角色控制器、分层导航 |
| 5 | [实施计划](implementation-plan.md) | 实施顺序、产物和退出门槛 |
| 6 | [验收标准](acceptance-criteria.md) | P0/P1 测试门禁 |
| 7 | [清理记录](cleanup-record.md) | 删除、保留和隔离范围 |
| ADR | [决策记录](decisions/) | 已确定的架构决策 |

## 新目录约定（当前实现）
```text
assets/source-buildings/    # 原始输入 GLB，仅供 Blender 修复
data/assets/                # 建筑 Catalog
data/actors/                # 角色 profile Catalog（身高/相机/胶囊/锚点）
models/buildings/           # 已验收的 v4 GLB：house / cover / base / estate
tools/buildings/            # Blender 导出和 GLB 校验
js/world/index.js           # ESM 入口：Rapier 初始化 + 暴露 window.World / MapRegistry
js/world/runtime.js         # WorldCompat：场景/建筑/据点/出生/旧 API
js/world/physics.js         # Rapier 静态 trimesh、射线、玩家胶囊 sweep、AI 射线移动
js/world/buildings.js       # 程序化建筑（1~4 层、门洞、楼梯、屋顶、合并 draw call）
js/world/nav.js             # 2m 网格 A*（旧 findPath / gridLineClear）
js/world/maps.js            # 三张地图数据（suburb / port / desert）
```
`js/world/{core,assets,collision,navigation,spawn,map,debug}/README.md` 保留为后续拆分说明；当前可玩实现集中在上面 6 个文件。

**视觉预览**：[暮色小镇](preview-suburb.jpg) · [街景](preview-suburb-street.jpg) · [厂房内部](preview-interior.jpg) · [灰港](preview-port.jpg) · [沙岭](preview-desert.jpg)
**俯视规划**：[suburb](map-suburb-plan.png) · [port](map-port-plan.png) · [desert](map-desert-plan.png)

## 坐标与尺度
Three.js 右手系，Y-up，1 world unit = 1m；建筑局部原点是 footprint 中心的地面点。默认 scale=(1,1,1)，禁止隐藏的全局资产倍率。模型目标尺寸由设计契约单独决定，不能把当前 GLB 的缩水尺寸当作标准。

**角色基准**：默认 2.0m（硬上限 2.2m），相机眼高 1.85m，胶囊 0.70m 直径/2.0m 高，台阶 0.45m。门净高 2.4m、净宽 1.3m，层高 3.6m，净层高 3.0m；详见 [尺度决策](scale-decision.md) 与 [角色契约](actor-contract.md)。

## 运行状态
旧 `js/world.js` 和旧地图脚本已从活动路径移除；v4 runtime 以 `WorldCompat` 方式恢复 `World` / `MapRegistry` / `findPath` / `gridLineClear`，旧 Game/AI/Combat 无需整体重写。

**已接通**：三张城镇图、三处据点、双方出生、20 人 AI 对局、玩家胶囊碰撞/门洞/墙面、AI 射线碰撞与 2m 网格 A*、小地图、埋点/击杀/结算流程。

**仍需继续**：多层建筑内部楼层与楼梯导航（当前 AI 只在室外导航）、apartment 等 17 类缺失建筑、低模 COL 代理优化、联机端地图同步验证。
详见 [sandbox-report.md](sandbox-report.md)。
