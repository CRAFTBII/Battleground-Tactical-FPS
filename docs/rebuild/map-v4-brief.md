# 地图 / 建筑系统 v4 决策入口

旧版评审 Brief 中的架构问题现已形成明确决策。以本目录文档为实施规范：

- [重建入口](README.md)
- [架构总览](architecture.md)
- [Blender / GLB 资产契约](asset-contract.md)
- [MapSpec 规范](map-spec.md)
- [碰撞与导航](collision-navigation.md)
- [实施计划](implementation-plan.md)
- [验收标准](acceptance-criteria.md)
- [清理记录](cleanup-record.md)
- [ADR 决策记录](decisions/)

本分支已清理 v3 活动地图运行时和派生建筑 GLB。原始 GLB 源包保留在 `assets/source-buildings/`。当前 runtime 是 scaffold，不可玩；不得合并 main，直到 P0 验收全部通过。
