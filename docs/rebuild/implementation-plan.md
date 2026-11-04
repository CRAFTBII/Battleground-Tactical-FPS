# v4 实施计划

原则：**先资产，后物理，再导航，然后地图，最后兼容接入。** 不要跳过模型修复直接调碰撞。

## 阶段 0：资产基线
审计四个 source GLB：mesh 清单、单位/轴向、包围盒、原点、非流形/重复面/游离几何。所有 29 个旧派生建筑视为未批准。测量当前角色碰撞胶囊、眼高、台阶高度、最大坡度。选普通房、多层建筑、组合掩体三个代表模型。

**v4 角色基准（已修订）**：默认身高 2.0m、硬上限 2.2m、相机眼高 1.85m、胶囊半径 0.35m/总高 2.0m、台阶 0.45m。
建筑目标尺寸、门高/门宽、层高由该基准推导（见 `scale-decision.md`），不得再用旧 1.7m 眼高或 2.5m 基准。
交付：draft Catalog（含 sourceDims/targetDims/floors/door）、尺寸对照、Blender 问题记录、Actor Catalog。
退出：目标尺寸和坐标契约明确。

## 阶段 1：GLB 生产管线
Blender 添加 VIS/COL/NAV/ANCHOR 节点，修复三个代表模型并导出。实现 GLB/Catalog validator，检查尺寸误差、变换、门洞、楼板、楼梯和净空。
退出：三种代表资产全部通过；墙面射线覆盖无漏碰撞/空气墙。

## 阶段 2：Rapier 物理
安装并锁定 Rapier；建立 PhysicsWorld、collision groups、静态 COL 导入、胶囊 controller、raycast/shapeCast。先做直墙、拐角、门洞、窗台、楼板、楼梯、桥上下层测试场景。
退出：玩家和 AI 不穿墙、不陷地；没有无故空气墙；查询过滤行为可测。

## 阶段 3：分层导航
实现稀疏 tile graph、floorId、A*、navLinks 和可视化。测试单层室外、多层住宅、楼梯间、桥上下层；路径节流和缓存。
退出：路径不穿墙、不跨空、不串层；胶囊真实可沿楼梯/门链接通行。

## 阶段 4：MapSpec 与第一张地图
实现 JSON Schema、validator、loader、builder；先做 training sandbox，再重建 suburb，稳定后依次 port、desert。TownGen 若保留只输出可保存、可 diff、可复现的 MapSpec。
退出：加载/卸载可重复、失败可回滚、所有引用有效。

## 阶段 5：Gameplay 兼容层
实现 WorldCompat 覆盖现有公开 API。迁移 combat → AI → game/spawn → mechanics → UI/minimap → mg/items。将直接遍历 World.colliders 的代码改为 PhysicsWorld 查询，旧 findPath 改为 NavWorld。
退出：单机、AI、据点、复活、迫击炮、投掷物、机制与 LAN 联机无回归。

## 阶段 6：地图与全量 QA
完成 suburb → port → desert；记录资产、碰撞、导航、出生、玩法、性能、加载/卸载报告。
退出：P0 全过，P1 性能有实测数据。

## 阶段 7：清理和 PR
移除 WorldCompat 过渡代码及所有 v3 map 活动引用；更新 README、CHANGELOG、manifest 和 map hash；创建面向 main 的 PR，附测试和性能报告。只在审核通过后合并。
