# 建筑资产契约（Blender → GLB → Runtime）

## 先修模型，不先调碰撞
当前派生建筑模型在尺寸、楼层、原点和碰撞元数据上都不可信。流程必须是 Blender 审计 → 修复几何/空间 → 决定目标尺寸 → 添加 COL/NAV/ANCHOR → 导出 → 自动验证 → 入 Catalog。不得用碰撞代码里的全局 scale 掩盖尺寸错误。

## 坐标
- 单位米；1 Blender unit = 1m；Y-up。
- 局部原点：footprint 中心地面点；应用旋转/缩放变换后再导出。
- 根节点 scale 应为 1,1,1；实例旋转仅绕 Y。
- 法线朝外；清理重复面、零面积面、非流形边和游离几何。
- 视觉网格可保留细节；COL/NAV 需低复杂度、语义明确。

## GLB 节点角色
| 角色 | 命名前缀 | 意义 |
|---|---|---|
| 可见网格 | `VIS__*` | 只负责显示 |
| 碰撞代理 | `COL__*` | 隐藏；创建 Rapier collider |
| 可行走表面 | `NAV__*` | 导航烘焙输入，含 floorId |
| 功能锚点 | `ANCHOR__*` | 门、楼梯、入口、机制和出生位置 |

节点 extras 至少包含 `battlegameRole`、`assetId`、`schemaVersion`。门锚点写 `clearWidth/clearHeight/portalId`；楼梯锚点写上下端 floorId 与 navLinkId。禁止通过 mesh 名包含 wall/floor/stair 来推断碰撞。

## 碰撞与导航
- 墙、门框、窗台、柱、围墙、沙袋、战壕必须有明确 COL。
- 门窗洞在代理几何中真实留空；不能运行时对 AABB 打洞。
- 禁止整栋楼一个实心 AABB；禁止只采样三角形边缘。
- 复杂静态建筑可用 triangle mesh；薄墙/柱体可用 cuboid 或 convex。
- 楼板、楼梯、坡道、桥面必须有 NAV 标记和明确高度/净空。
- NAV 连接跨层必须使用显式门/楼梯/梯子/跳跃 Link。

## 目标尺度
目标值是设计契约，不是当前 GLB 测量结果。建议普通住宅净层高 ≥2.7m、多层住宅层高目标 3.6–4.0m、门净高 ≥2.1m；仓库入口净高按玩法需要确定，初始目标 ≥3.0m。玩家胶囊尺寸、台阶高度和最大坡度从当前角色移动参数测量后统一登记。桥梁要分别验证桥面和桥下净空。

## Catalog 状态
每个资产包含 assetId、状态 draft/approved、GLB 路径、三轴尺寸、原点、节点清单、楼层标高/净空、入口/楼梯锚点和碰撞类型。Catalog 目标尺寸与 GLB 包围盒误差默认 ≤1cm；任何例外需写 reason。未校准资产不得进入生产 MapSpec。
