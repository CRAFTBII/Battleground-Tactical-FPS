# MapSpec 数据规范

## Schema 文件
结构校验定义位于 [map-spec.schema.json](map-spec.schema.json)。Schema 负责静态字段和类型校验；资产引用、ID 唯一、地图边界、NAV/COL 一致性和路径连通由语义 validator 负责。

## 单一事实源
每张地图使用 `data/maps/<mapId>.map.json`。它描述 bounds、terrain、资产实例、区域语义、导航连接、出生点、目标点和地图机制锚点。渲染、碰撞、导航、小地图和 AI 目标从同一个 MapSpec 读取。TownGen 只生成这个 schema 的 JSON，不直接创建 Three.js 或 Rapier 对象。

## 示例
```json
{
  "schemaVersion": 1,
  "mapId": "suburb",
  "name": "Suburb",
  "units": "m",
  "bounds": { "min": [-350,-5,-350], "max": [350,80,350] },
  "terrain": { "heightfield": "data/maps/terrain/suburb.height.bin", "materialSet": "suburb" },
  "instances": [],
  "regions": [],
  "navLinks": [],
  "spawns": [],
  "objectives": [],
  "mechanics": [],
  "metadata": { "seed": 12345, "contentHash": "" }
}
```
该例仅示意结构，不表示地图已创建。

## Instance
```json
{
  "id": "house_001",
  "assetId": "house_a",
  "transform": {
    "position": [24,0,-18],
    "rotationY": 1.5707963,
    "scale": [1,1,1]
  },
  "flags": { "render": true, "collision": true, "navigation": true, "minimap": true },
  "tags": ["building","residential"]
}
```
实例不得重复声明尺寸、碰撞体和 floor elevations；这些都属于 Catalog。所有层共用同一个变换。

## NavLink
```json
{
  "id": "house_001_stair",
  "type": "stair",
  "from": { "instanceId": "house_001", "floorId": "ground", "anchor": "ANCHOR__stair_bottom" },
  "to": { "instanceId": "house_001", "floorId": "upper", "anchor": "ANCHOR__stair_top" },
  "bidirectional": true,
  "cost": 1,
  "agentMask": ["player","infantry"]
}
```
Link 端点必须落在有效 NAV 面上，并验证角色胶囊可通过、路径不穿墙。

## 必须校验
所有 ID 唯一；资源引用有效；坐标是有限米制值；对象不越界；出生点与目标点绑定 floorId；出生点不与 collider 重叠；navLink 不能悬空、穿墙或跨图；联机双方 mapId/schemaVersion/contentHash 不一致时拒绝开始。
