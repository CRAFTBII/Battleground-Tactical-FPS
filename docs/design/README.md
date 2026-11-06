# 设计文档 · v5

> 这一组文档先解决“为什么不好玩”，再决定建筑怎么替换。  
> 当前 v4 分支作为**技术验证**保留：Rapier、程序化城镇、AI 导航都已跑通，但不作为最终玩法形态。

| 文档 | 内容 |
|---|---|
| [gameplay-v5.md](gameplay-v5.md) | 玩法重设计：RAID 突袭模式、循环、地图、AI、数值、MVP 范围 |
| [raid-site-a-layout.html](raid-site-a-layout.html) | 黑港行动 A 站点俯视设计板（可直接打开；静态预览 [PNG](raid-site-a-layout.png)） |
| [building-kit-v5.md](building-kit-v5.md) | 建筑替换方案：模块化套件、预制体、尺寸、LOD/COL/NAV、Blender 流程 |
| [building-spec-sheet.md](building-spec-sheet.md) | **建筑规格评审表**：14 个预制体的尺寸/层数/入口/楼梯/三角预算 |
| [terrain-v5.md](terrain-v5.md) | 自然地形方案：海堤/排水渠/土堤 + Perlin 掩膜与高度图交付格式 |
| [interaction-v5.md](interaction-v5.md) | **门/破窗交互**：当前 v4 垂直切片、v5 撬锁/翻窗/炸药/AI 开门目标 |
| [fps-references.md](fps-references.md) | CS2 / Valorant / Battlefield / Insurgency / Tarkov / COD 的玩法与建模参考 |
| [../../data/assets/buildings.v5.catalog.json](../../data/assets/buildings.v5.catalog.json) | v5 建筑预制体清单（planned） |
| [../../models/buildings/v5/README.md](../../models/buildings/v5/README.md) | 新 GLB 放置与替换步骤 |

## 一句话结论

把“20 个 AI 在三张 300m 城镇里占点”改成：

> **4 人小队（玩家 + 3 AI）潜入 160×160m 的黑港站点，完成 2 个目标后撤离；守军巡逻、听声、包抄、增援，玩家在“继续搜刮”与“现在撤离”之间做风险决策。**

小地图、少单位、清晰目标、 authored 建筑，优先把手感、节奏和空间做对，再扩内容。
