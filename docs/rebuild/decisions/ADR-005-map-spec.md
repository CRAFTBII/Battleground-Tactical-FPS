# ADR-005：JSON MapSpec 为地图唯一事实源

- 状态：Accepted
- 日期：2026-11-01

## 决策
每张地图使用 `data/maps/<id>.map.json`；建筑信息由独立 Catalog 管理。运行时通过本地 HTTP server 加载、schema 校验。TownGen 只生成 MapSpec，不能直接生成 Three.js objects、Rapier colliders 或第二套 navigation arrays。

## 原因
项目本身已经需要本地 server 提供 GLB；旧 JS map registry 的 file:// 特例增加维护面，阻碍 schema 校验、diff、hash 和工具链。单一 JSON 数据源有利于多人联机版本一致性。

## 后果
旧 `js/maps/*.js` 不再兼容，三张地图需重写。联机进入房间前校验 mapId/schemaVersion/contentHash。
