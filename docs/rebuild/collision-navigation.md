# 碰撞与导航设计

## 物理：Rapier 3D
采用 `@dimforge/rapier3d-compat`，阶段 2 安装并锁定版本（初始目标 0.21.0，安装时以 registry 可用版本和 API 核对并提交 package-lock）。初始化是异步的；WorldRuntime 等待 PhysicsWorld.ready 才能加载地图。
参考：[Rapier JS Guide](https://rapier.rs/docs/user_guides/javascript/getting_started_js/) · [Character Controller](https://rapier.rs/docs/user_guides/javascript/character_controller_collisions/)

## Collider 规则
| 用例 | 表示 |
|---|---|
| 建筑、地形、固定墙体 | Static body + 显式三角网格或简单 COL 代理 |
| 门框、柱、沙袋、掩体 | 从 COL 节点导出的 convex / cuboid / mesh |
| 玩家、AI | Kinematic capsule + character controller |
| 可移动物体 | Dynamic body + convex collider；需要时 CCD |
| 子弹、视线 | Raycast + 明确 QueryFilter |
| 据点和交互范围 | Sensor collider |

禁止动态刚体使用凹三角网格；禁止视觉 AABB 猜碰撞；门洞必须在 COL 几何内真实留空。

## Collision groups
建议定义 WORLD_STATIC、PLAYER、BOT、PROJECTILE、HITSCAN、SENSOR、NAV_ONLY。每次 ray/shape query 都显式指定过滤组，避免视线、玩家移动和爆炸查询共用模糊默认值。

## 角色控制器
玩家与 AI 共用胶囊 profile；固定物理步长更新，渲染帧只做插值。Kinematic Controller 负责墙滑、台阶、地面吸附、斜坡限制和下落。落地高度来自物理 contact，不从二维 heightAt 猜。身高、半径、台阶高度、坡度必须参数化并自动测试。

## 导航：稀疏分层 Tile Graph
- 室外初始 cell 1m；室内窄空间可细化至 0.5m。
- 只为实际可行走 NAV surface 建 cell，不创建整张空地图密集数组。
- 每个 cell 记录 x/z/floorId/y/clearance/slope/areaType/flags。
- 每个楼层独立邻接图；跨层只由 MapSpec navLinks（stair/ladder/door/jump/drop/elevator）连接。
- 采用 A* + portal/tile 分层；路径平滑后必须用导航和物理查询复验。
- 初始 tile 32m × 32m，最终由性能测试决定。

## API
PhysicsWorld: createStaticCollider / moveCharacter / raycast / shapeCast / overlapSphere / registerSensor / disposeMap。
NavWorld: findPath / nearestReachable / isReachable / setLinkEnabled / disposeMap。
SpawnService: pickSpawn / validateSpawn / findSafeRespawn。
