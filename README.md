# 战地突击 · Battleground Tactical FPS

> **当前分支：`rebuild/maps-v4`（重建中，暂不可玩）**。旧地图运行时、旧建筑碰撞导入器和派生建筑 GLB 已从活动目录清理。此工作区用于重新建立建筑资产、MapSpec、物理碰撞和分层导航。
>
> 稳定可玩版本请切回 `main`。本分支不得合并 main，直到 [v4 验收标准](docs/rebuild/acceptance-criteria.md) P0 全部通过。

## 从这里开始
- [重建文档入口](docs/rebuild/README.md)
- [架构总览](docs/rebuild/architecture.md)
- [Blender / GLB 资产契约](docs/rebuild/asset-contract.md)
- [MapSpec 数据规范](docs/rebuild/map-spec.md)
- [碰撞与导航设计](docs/rebuild/collision-navigation.md)
- [逐阶段实施计划](docs/rebuild/implementation-plan.md)
- [验收标准](docs/rebuild/acceptance-criteria.md)
- [分支清理记录](docs/rebuild/cleanup-record.md)
- [架构决策 ADR](docs/rebuild/decisions/)

## 技术边界
保留 Three.js 渲染、角色/武器/战斗、AI 战术、网络、UI、音效；重建地图/建筑资产管线、Rapier 3D 物理、稀疏分层导航和 MapSpec runtime。坐标采用 Y-up，1 unit = 1m；MapSpec JSON 是地图唯一事实源；建筑 GLB 显式定义 VIS/COL/NAV/ANCHOR。

## 源建筑文件
原始输入包位于 `assets/source-buildings/`，仅供 Blender 审计修复，绝不是运行时资源。通过验收的模型再导出至 `models/buildings/` 并登记到 Catalog。

## 启动说明
此分支当前入口会明确提示 v4 runtime 尚未实现并停止启动。不要通过恢复旧 `js/world.js` 使分支“看起来能玩”；按实施计划建立 WorldRuntime 和 WorldCompat。
