# v4 Step 1 沙盒验收报告（可试玩）

> 入口：`http://localhost:8080/sandbox.html`（v4 分支）
> 已修复并接入：house / cover / base / estate
> 未接入：apartment（需要建模补 5 层，不是缩放）、其余 17 个缺失类型

## 1. 已修复模型

| key | 目标尺寸 (w×h×d) | 实际 GLB 尺寸 | 轴向/原点 | 节点 |
|---|---|---|---|---|
| house | 11×8.8×9 | 11×8.8×9 | Y-up、footprint 中心地面 | VIS/COL/NAV/ANCHOR |
| cover | 14.5×2.8×6.3 | 14.5×2.8×6.3 | 同上 | VIS/COL |
| base | 90×16×75 | 90×16×75 | 同上 | VIS/COL |
| estate | 80×10×60 | 80×10×60 | 同上 | VIS/COL |

修复内容：

- 源 Z-up 躺倒 → Blender 绕 X -90°，应用变换；导出 glTF Y-up。
- footprint 中心地面原点；所有 mesh 变换已应用，root scale=1。
- VIS/COL/NAV/ANCHOR 节点 + `extras`（battlegameRole/assetId/schemaVersion）。
- house COL 保留原门洞/窗洞几何；不按名字猜碰撞、不整体 AABB、不采样三角边。

## 2. 角色/相机

- 角色 profile：身高 2.5m，相机眼高 2.3m，胶囊半径 0.45m/总高 2.5m，台阶 0.55m。
- 沙盒用 Rapier `KinematicCharacterController` + capsule，实时重力/跳跃/疾跑。
- 实际截图（相机 2.3m 看 house）：`sandbox_house.png`（会话目录）。
- 相机 fov/near/far 来自 profile；第一人称锚点预留。

## 3. 碰撞实测（Rapier）

| 测试 | 结果 |
|---|---|
| house 正面墙（x=0） | 角色从 z=8 前进，停在 z=4.84（墙面 4.25 + 胶囊 0.45 + offset） → 挡 |
| house 门洞（x=-2.923, 锚点） | 角色从 z=8 穿过门到 z=-3.55 → 通 |
| house 门上墙（y=4.2） | 射线命中 → 挡 |
| cover（x=16） | 角色停在 z=5.62（掩体面 + 胶囊） → 挡 |
| base 正面 | 角色停在 z=-20.03（外围结构） → 挡 |
| COL 调试线框 | C 键显示，共 123 个 trimesh collider |

结论：**不再出现“整面墙可以穿过去”**；门洞实际可通行。之前 v3 的 `voxelRects` 只采三角边的问题在 v4 已不复用。

## 4. 仍不满足规范的地方（必须记录）

1. **house 门净宽 1.344m**，目标 1.6m；胶囊 0.9m 可通过，但低于 v4 目标。下一步 Blender 扩门洞/调门框。
2. **house 层高实测约 4.17m**（8.8m/2 层），目标 4.4m；差 5%，可接受范围但未严格达标。
3. **NAV__house 当前是 VIS 的副本占位**，不是真正的可行走面/楼层链接；AI 导航未接入。
4. **COL__* 当前是完整 VIS 三角副本**，不是低模代理；碰撞正确但三角数偏高。
5. **apartment 未修复**：源模型只有 2 层 7.58m，目标 5 层 22m，需要补楼层/内梯建模。
6. **17 个类型仍无模型**：container/watchtower/stairs/bridge/wall/ruins/hangar/pillbox/
   crane/tankH/tankV/mast/tower/megatower/stadium/refinery/complex。
7. 沙盒是单场景，不是完整 MapSpec/WorldRuntime；主游戏入口仍显示“v4 重建中”。

## 5. 结论

- 模型测量/修复管线已经跑通：轴向、原点、目标尺寸、VIS/COL/NAV/ANCHOR 节点可自动导出。
- house/cover/base/estate 已经在 Rapier 沙盒里可走、可挡、可进门。
- apartment 和 17 个缺失类型不能靠“修复现有 GLB”完成，需要补模型；门宽/层高/NAV/低模 COL 还需第二轮精修。
- 这版可以试玩验证尺度与碰撞手感；不能作为最终地图/游戏交付。
