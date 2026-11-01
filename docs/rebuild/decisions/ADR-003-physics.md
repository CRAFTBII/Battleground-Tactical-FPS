# ADR-003：Rapier 3D 作为物理与角色移动核心

- 状态：Accepted；包版本在实现阶段锁定
- 日期：2026-11-01

## 决策
使用 `@dimforge/rapier3d-compat` 作为浏览器 3D 物理核心。初始目标版本 0.21.0，但阶段 2 安装前必须核对 registry 当前可用版本及 API 并更新 lockfile。静态建筑来自 COL 代理；玩家/AI 使用 capsule Kinematic Character Controller；射线和区域使用 query/sensor。

## 原因
需要角色扫掠、接触、射线、形状查询和明确的多层物理响应；手写 x/z AABB 无法可靠处理楼层、楼梯和桥梁。

## 后果
PhysicsWorld 是唯一物理入口。Gameplay 不直接持有 Rapier handles；异步初始化完成后才能加载 MapSpec。

## 参考
- https://rapier.rs/docs/user_guides/javascript/getting_started_js/
- https://rapier.rs/docs/user_guides/javascript/character_controller_collisions/
- https://www.npmjs.com/package/@dimforge/rapier3d
