# 分支清理记录

> 本记录仅针对 `rebuild/maps-v4`。main 未修改、未重置、未删除、未合并。

## 从活动路径清理
- `js/world.js`：旧地图/碰撞/平台/2D A* 混合实现。
- `js/maps/{registry,suburb,port,desert}.js`：旧注册表和地图坐标。
- `scripts/import_buildings.cjs`：按 mesh 名分类、AABB 和三角边采样生成碰撞的旧 importer。
- `models/buildings/*.glb`、`models/buildings_dims.json`、`models/.building-groups.json`：v3 派生模型和尺寸表，不作为 v4 资产。
- v3 专用地图 QA、临时 debug/scratch、XL collider 生成和临时 GLB 转换探针。

## 保留/隔离
- 原始 GLB 输入包移入 `assets/source-buildings/`，只供 Blender 审计和修复；运行时 manifest 不引用它们。
- `design/maps/*.md` 与 `art/*.md` 留作玩法主题参考；不能直接复制旧地图坐标。
- 角色、枪械、Three.js、gameplay、网络、UI、音效等主体保持。
- `models/guns/`、`models/soldier.glb` 保留。

## 清单与入口调整
- runtime manifest 只列士兵/武器/枪栓，建筑待 v4 Catalog approved 后单独接入。
- 移除旧 import:buildings npm script；未来建筑工具放 tools/buildings。
- index.html 不再引入旧地图脚本；main.js 显示 v4 尚未实现状态并停止启动。
- 新目录只放契约说明和 scaffold，不伪造完整功能。

## 恢复
被删除文件仍在 Git 历史。需要对照时从 main@154be4e 或清理前提交恢复到临时分支；不要拷回 v4 活动路径。源 GLB 已保留。
