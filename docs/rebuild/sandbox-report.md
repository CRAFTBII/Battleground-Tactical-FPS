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
7. 沙盒是单场景；**主游戏入口已接通 v4 运行时**（2026-11 本轮）。

## 5. 主游戏接入实测（v4 runtime）

入口：`http://localhost:8080/` → 选图 → 开始单人战役（VS AI）。

| 项目 | 结果 |
|---|---|
| 地图 | suburb / port / desert 三张 300m 城镇图，各 3 据点、5+5 出生点 |
| 场景 | 254–263 个静态 trimesh、13–15 个 cuboid、22,500 个 2m 导航格 |
| 玩家碰撞 | Rapier capsule sweep：墙停、cover 停、house 门可进（门内 y≈0.24 台阶） |
| 弹道 | Rapier ray：墙后目标 8 发 0 伤害；无墙目标正常扣甲/扣血 |
| AI | 射线近似胶囊移动 + A*；20 人开局 4s 内全部离开出生点，无卡墙 |
| 性能 | 2 队 20 人、headless Chrome 实测 60fps（AI 碰撞从 capsule cast 改为射线后从 ~20fps 提升） |
| 击杀 | 玩家击倒→处决/击杀，比分 +1，killfeed 正常 |

## 6. 视觉重建（v4.2）

针对“地形平坦 / 地表缺失 / 全是同一栋别墅 / 没有道路”的反馈：

- **地表缺失根因**：旧底板放在世界原点（0,0），地图范围是 0..300 → 东/南侧 70m 没有地面。已改为居中 (size/2, size/2) 的超大底板。
- **地形**：100×100 网格程序化缓坡（suburb 1.7m / port 1.1m / desert 2.0m），道路、建筑、据点、出生区自动压平；远景为 24 座圆顶丘陵。
- **道路**：主/次街道 + 人行道 + 路缘 + 中心黄线 + 中央广场；三张图道路网络各不相同。
- **建筑**：不再重复 house.glb；新增程序化 cottage/townhouse/shop/apartment/villa/warehouse/shed/tower/ruin，墙体留 1.4×2.45m 门洞，室内楼板留楼梯井，楼梯用 sensor + heightAt 实现可上二层。
- **街景**：64 棵树、34 丛灌木、20 块岩石、沿路车辆、路灯、沙袋/集装箱/木箱。
- **预览**：[suburb](preview-suburb.jpg) · [port](preview-port.jpg) · [desert](preview-desert.jpg)
- **俯视**：[suburb](map-suburb-plan.png) · [port](map-port-plan.png) · [desert](map-desert-plan.png)

## 7. 结论

- 主入口已从“v4 重建中”变为**可玩单机训练版**：三图、据点、20 人 AI、碰撞/弹道/击杀/小地图全部接通。
- WorldCompat 保留旧 `World` / `MapRegistry` / `findPath` / `gridLineClear` 接口，Game/AI/Combat 仅改移动与弹道两处。
- 下一轮：apartment/17 类缺失模型、低模 COL 代理、室内多层导航与楼梯、联机端地图同步。
