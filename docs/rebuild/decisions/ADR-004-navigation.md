# ADR-004：稀疏分层网格和显式跨层连接

- 状态：Accepted
- 日期：2026-11-01

## 决策
使用稀疏 tile-based 分层导航。室外初始 cell 1m，狭窄室内允许细化到 0.5m；每个 cell 存 floorId、高度、坡度、净空和区域标记。各楼层独立建图，楼梯/梯子/门/跳跃通过显式 navLinks 连接。采用 A* + portal/tile 分层搜索。

## 不采用
- 不保留旧单层 2D blocked grid。
- 不从碰撞 AABB 推导所有行走面。
- 不允许 A* 自动跨高度层或穿过墙体。

## 后果
NavWorld 与 PhysicsWorld 分离；路径平滑后必须以碰撞/导航查询复验。离线烘焙，运行时不每帧重建全图。
