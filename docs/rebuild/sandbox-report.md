# v4 Step 1 沙盒验收报告（可试玩）

> 入口：`http://localhost:8080/sandbox.html`（v4 分支）
> 已修复并接入：house / cover / base / estate
> 未接入：apartment（需要建模补 5 层）、其余 17 个缺失类型

## 1. 已修复模型

| key | 尺寸 (w×h×d) | 轴向/原点 | 节点 |
|---|---|---|---|
| house | 11×8.8×9 | Y-up、footprint 中心地面 | VIS/COL/NAV/ANCHOR |
| cover | 14.5×2.8×6.3 | 同上 | VIS/COL |
| base | 90×16×75 | 同上 | VIS/COL |
| estate | 80×10×60 | 同上 | VIS/COL |

处理：源 Z-up → Blender -90°X、应用变换；fit 到目标尺寸；中心地面原点；导出 Y-up；
VIS/COL/NAV/ANCHOR 节点 + extras。house COL 保留真实门洞/窗洞，不再用 AABB/三角边采样。

## 2. 角色/相机（已按反馈缩小）

- 默认身高 **2.0m**，硬上限 **2.2m**；相机眼高 **1.85m**。
- 胶囊半径 **0.35m**（直径 0.70），总高 2.0m；台阶 0.45m。
- 沙盒用 Rapier `KinematicCharacterController` + capsule，实时重力/跳跃/疾跑。
- 相机 fov/near/far 来自 profile；第一人称锚点预留。

2.5m 角色会导致部分门挤不进去；缩到 2.0m 后，house 门 1.344m 对 0.70m 胶囊有 0.64m 余量。

## 3. 碰撞实测（Rapier）

| 测试 | 结果 |
|---|---|
| house 正面墙（x=0） | 角色从 z=8 前进，停在 z=4.75（墙面 + 胶囊） → 挡 |
| house 门洞（x=-2.923） | 角色从 z=8 穿过门到 z=-3.65 → 通 |
| house 门上墙（y=4.2） | 射线命中 → 挡 |
| cover（x=16） | 角色停在 z=5.52 → 挡 |
| base 正面 | 角色停在 z=-20.03（外围结构） → 挡 |
| COL 调试线框 | C 键显示，共 123 个 trimesh collider |

结论：墙/沙包/基地可挡，house 门可通行；不再出现“整面墙穿过去”。

## 4. 仍不满足规范的地方

1. **house 门净宽 1.344m**，新目标 1.3m（已达标）；旧目标 1.6m 未达但已按新角色尺度调整。
2. **house 层高约 4.4m**（8.8/2），新目标 3.6m（偏大但可用）；下一轮资产收敛。
3. **NAV__house 当前是 VIS 副本占位**，不是真正的分层可走面；AI 导航未接入。
4. **COL__* 当前是完整 VIS 三角副本**，碰撞正确但非低模代理；三角数偏高。
5. **apartment 未修复**：源 2 层 7.58m，目标 5 层 18m，需要补楼层/内梯建模。
6. **17 个类型仍无模型**：container/watchtower/stairs/bridge/wall/ruins/hangar/pillbox/
   crane/tankH/tankV/mast/tower/megatower/stadium/refinery/complex。
7. 沙盒是单场景，不是完整 MapSpec/WorldRuntime；主游戏入口仍显示“v4 重建中”。

## 5. 结论

- 模型测量/修复管线已跑通：轴向、原点、尺寸、VIS/COL/NAV/ANCHOR 可自动导出。
- house/cover/base/estate 已在 Rapier 沙盒可走、可挡、可进门；角色/相机已按反馈缩到 2.0/1.85。
- 这版用于验证尺度与碰撞手感；apartment、低模 COL、真正 NAV、完整 MapSpec 仍待下一轮。
