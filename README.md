# 战地突击 · Battleground Tactical FPS

> **当前分支：`rebuild/maps-v4`**。v4 已接通 Rapier + 三张城镇图的单机技术验证；  
> **v5 正在重做玩法与建筑**：小地图 RAID、目标/撤离、authored 建筑预制体。  
> 先读 [v5 设计入口](docs/design/README.md)。

## 从这里开始
- [v5 玩法设计：RAID 黑港行动](docs/design/gameplay-v5.md)
- [v5 建筑替换方案](docs/design/building-kit-v5.md)
- [v5 参考案例](docs/design/fps-references.md)
- [v5 地图设计板（HTML）](docs/design/raid-site-a-layout.html)
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
`node server.js` → `http://localhost:8080/`。当前 v4 技术验证可玩（3 张 300m 城镇 + 20 AI），但**不作为最终玩法**；v5 会缩小为 160m RAID 站点并替换建筑。
