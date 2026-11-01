# 原始建筑输入包

此目录存放从旧 import_glbs 移入的 GLB 源包，只用于 Blender 审计、修复和重新导出。
- 未通过 v4 尺寸、坐标、网格质量及 COL/NAV 节点契约。
- 运行时 manifest 不得引用这里的 GLB。
- 不要覆盖输入源；修复输出另存并写入 models/buildings。
- 生产资产必须登记到 data/assets/buildings.catalog.json。
