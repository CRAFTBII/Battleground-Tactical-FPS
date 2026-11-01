# v4 源资产审计（Step 0）

> 分支：`rebuild/maps-v4` · 工具：Blender 5.2 headless（`tools/buildings/audit_sources.py`）
> 原始数据：`docs/rebuild/source-audit.json`
> 结论：**四套源包都不能直接进入 v4**；需要 Blender 修复轴向/原点、拆分 VIS/COL/NAV/ANCHOR，
> 并逐类型决定目标尺寸。现有 29 个 v3 派生模型不作为 v4 资产。

## 1. 全局检查

| 项目 | 结果 |
|---|---|
| 文件 | 4 个 GLB，无贴图（images=0），仅材质色/顶点色 |
| 根节点缩放 | 全部 scale=(1,1,1) |
| 非流形边 / 零面积面 | 四包均为 0（Blender bmesh 检查） |
| 材质 | Kit 13 / 13，base 14，estate 无材质（顶点色） |
| **轴向** | **源数据是 Z-up，但 glTF 规范是 Y-up；Blender 导入后模型“躺倒”**（高度落在 Y，进深落在 Z） |
| **原点** | 每个建筑组位于包内任意 X/Y 位置，**不在 footprint 中心地面** |
| **节点角色** | 全部为普通 mesh；没有 `VIS__/COL__/NAV__/ANCHOR__` 前缀或 extras |
| 旧派生资产 | v3 的 `models/buildings/*.glb` 已从本分支移除；不得复用 |

> 结论：第一步必须做 Blender 修复：glTF 导入 → 绕 X +90° 让高度回到 Blender Z → 应用变换 →
> 每组按 footprint 中心地面重设原点 → 添加 COL/NAV/ANCHOR → 以 Y-up（glTF）导出。

## 2. 每包对象/三角

| 源包 | 对象 | Mesh | 三角 | 根节点 | 材质 | 图片 |
|---|---:|---:|---:|---|---:|---:|
| Tactical_FPS_Buildings.glb | 371 | 370 | 11,516 | `world` EMPTY（scale 1） | 13 | 0 |
| Tactical_FPS_Additional_Buildings.glb | 258 | 257 | 3,068 | `world` EMPTY（scale 1） | 13 | 0 |
| large_combat_base.glb | 70 | 69 | 12,264 | `world` EMPTY（scale 1） | 14 | 0 |
| large_house.glb | 96 | 96 | 1,152 | 96 个 mesh 平铺（无父级） | 0（顶点色） | 0 |

## 3. 建筑组与尺寸（Blender 导入后 bbox：X=宽，Y=高，Z=进深）

> 注意：这里的 Y 是“高度”，是因为源 Z-up 被 glTF 当 Y-up；修复后应变成 Blender Z=高、导出 glTF Y=高。

| 目标 key | 源组 | 三角 | 尺寸 X×Y×Z | 备注 |
|---|---|---:|---|---|
| house_small | House_A | 432 | 8.38×3.57×7.38 | 单层 |
| house | House_B | 912 | 10.8×6.32×8.585 | 双层，含外梯/后梯 |
| warehouse | Warehouse | 604 | 14.34×6.14×10.7 | 卷帘门洞 |
| guardhouse | Guard_Shack | 288 | 4.18×3.35×3.98 | 单间门岗 |
| cover | Cover_* | 9,280 | 组件散布 | 需组合成 14.5×6.3 左右掩体 |
| farmhouse | Farmhouse_C | 640 | 10.45×6.22×10.04 | 坡屋顶 |
| workshop | Workshop_D | 448 | 14.65×6.3×11.54 | 厂房+办公室 |
| apartment | Apartment_E | 1,164 | 12.4×7.58×11.025 | **仅 2 层，需补楼层** |
| pumpstation | PumpStation_F | 516 | 11.29×5.51×8.45 | 设备房 |
| bunker | Bunker_G | 300 | 12.4×4.49×7.58 | 低矮掩体 |
| base | large_combat_base | 12,264 | 86.55×11.94×66.675 | 围墙/大门/双层主楼 |
| estate | large_house | 1,152 | 80×8.5×60 | 大型庄园，无材质 |

## 4. 尺寸问题（用户反馈“小了一圈/楼层太矮”）

| 类型 | v3 旧玩法 | 源模型 | 结论 |
|---|---|---|---|
| apartment | 16×12×19.1（4m/层×5） | 12.4×11.025×7.58（2 层） | 占地 0.69~0.77，高度 0.40；仅缩放无法补层 |
| warehouse | 22×14×9.7 | 14.34×10.7×6.14 | 高度 0.63 |
| bunker | 18×14×8 | 12.4×7.58×4.49 | 高度 0.56 |
| base | ≈89×74×26 落地 | 86.55×66.68×11.8 | 占地接近，高度 0.45 |
| guardhouse | 5×5×4.5 | 4.18×3.98×3.35 | 0.74 |
| house | 10.6×8.6×4.3 | 10.8×8.59×6.32 | 双层，层高 3.0 |
| cover | 14.5×6.3×2.75 | 组合件 | 需定目标 |

源模型层高约 3.0~3.2m；ADR-002 建议多层 3.6~4.0m，门净高 ≥2.1m，普通住宅净层高 ≥2.7m。
**建议目标（待评审确认）**：

- house_small：10×8×3.8（单层，净高 3.0）
- house（双层）：11×9×7.6（2×3.8）
- apartment：16×12×15.2（4×3.8）或 19（5×3.8）；需要建模补层/内梯
- warehouse：22×14×9.5（净高 ≥7）
- guardhouse：5×5×4.0
- bunker：18×14×6（低矮但可进入）
- cover：14.5×6.3×2.6
- base / estate：按玩法重定，不直接沿用 v3

## 5. 已发现的资产结构问题

1. **轴向**：所有包导入 Blender 后躺倒（源 Z-up 被 glTF 当 Y-up）。修复后才能谈原点/楼层。
2. **原点**：组内建筑散布在包内不同位置；必须每组重设 footprint 中心地面原点。
3. **无角色节点**：没有 VIS/COL/NAV/ANCHOR，也没有门/楼梯锚点；不能再用“mesh 名包含 wall/floor”推断碰撞。
4. **apartment 只有 2 层**：与旧玩法 4~5 层差距大；需要补建模，不是 scale。
5. **warehouse 无独立碰撞代理**：卷帘/货架/屋顶需要单独 COL；v3 曾出现屋顶不可走/卷帘穿模。
6. **cover 是散布组件**：必须组合并给每段沙袋/矮墙 COL，不能靠 AABB/三角边采样。
7. **large_house 无材质**：仅 COLOR_0；需确认渲染管线接受顶点色，且 COL/NAV 分离。
8. **17 个玩法类型无新模型**：container/watchtower/stairs/bridge/wall/ruins/hangar/pillbox/crane/tankH/tankV/mast/tower/megatower/stadium/refinery/complex。
   需要补模型，或在 v4 MapSpec 中移除对应玩法元素。

## 6. Step 1 三个代表模型（建议）

1. **house（House_B）**：双层 + 外梯 → 验证墙体/门/窗/楼板/楼梯/屋顶；目标 11×9×7.6。
2. **apartment（Apartment_E）**：多层 → 先补到 4 层（15.2m）或 5 层（19m），验证内梯、楼层平台、门厅。
3. **cover（组合）**：沙袋/矮墙/护栏 → 验证连续 COL、可翻越边界、无缝隙。

每个代表交付：

- `VIS__*` 渲染网格（Y-up、中心地面原点、米制、scale 1）
- `COL__*` 碰撞代理（墙/门框/窗台/柱/沙袋/楼梯；门洞真实留空）
- `NAV__*` 可行走面（floorId/高度/净空）
- `ANCHOR__*` 门/楼梯/入口（clearWidth/clearHeight/portalId）
- Catalog 条目（draft → approved）+ 自动校验

## 7. 复现

```bash
cd D:/Projects/battlegame
"D:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python tools/buildings/audit_sources.py
# 输出 docs/rebuild/source-audit.json
```

> 本审计只读；未修改源 GLB，未生成任何碰撞或地图。
