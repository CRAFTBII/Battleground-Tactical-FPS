# 角色资产契约（Actor Profile / 扩展口）

> 目的：建筑与相机按“默认 2.0m、上限 2.2m 的角色”设计；后续可替换/新增多个人物模型，不改地图与相机代码。
> 数据：`data/actors/characters.catalog.json`　运行时：`js/actors.js`（`window.ActorCatalog`）

## 1. Profile 字段

```json
{
  "id": "vanguard",
  "name": "默认士兵（占位）",
  "status": "placeholder | draft | approved",
  "glb": "models/soldier.glb",
  "modelHeight": 1.9,
  "height": 2.0,
  "scale": 1.0526,
  "eyeHeight": 1.85,
  "capsule": { "radius": 0.35, "height": 2.0, "halfHeight": 0.65 },
  "stepHeight": 0.45,
  "camera": { "fov": 70, "near": 0.1, "far": 1200 },
  "anchors": {
    "eye": [0, 1.85, 0],
    "weaponR": [0.24, 1.6, 0.3],
    "muzzle": [0.24, 1.6, 0.75]
  },
  "weaponScale": 1.0,
  "variants": []
}
```

约束：

- 默认身高 2.0m，**硬上限 maxHeight = 2.2m**；`eyeHeight < height`。
- `scale = height / modelHeight`；模型资产保持原尺寸，不在建筑代码里乘全局倍率。
- `anchors` 必须随模型/身高给出；相机、枪口、投掷点都从这里取。
- 多角色：在 `profiles` 增加条目；`ActorCatalog.setDefault(id)` 或按队伍/玩家选择。
- 队伍皮肤/变体放 `variants`，不复制 profile。

## 2. 运行时 API

```js
await ActorCatalog.load();
ActorCatalog.list();
ActorCatalog.get(id);
ActorCatalog.setDefault(id);       // 写 CFG.EYE / PLAYER_HEIGHT / PLAYER_RADIUS / PLAYER_STEP
ActorCatalog.eyeHeight(id);
ActorCatalog.capsule(id);
ActorCatalog.anchors(id);
ActorCatalog.scale(id);
```

`ActorCatalog.apply()` 会写入：

- `CFG.PLAYER_HEIGHT` = 2.0（默认）
- `CFG.EYE` = 1.85
- `CFG.PLAYER_RADIUS` = 0.35
- `CFG.PLAYER_CAPSULE_HEIGHT` = 2.0
- `CFG.PLAYER_STEP` = 0.45

相机创建时必须使用 profile 的 `camera.fov/near/far` 与 `CFG.EYE`；第一人称武器/枪口用 `anchors`。

## 3. 新增人物模型流程

1. 新 GLB 放到 `models/characters/<id>.glb`（Y-up、米制、脚底原点、面朝 -Z）。
2. 测量 `modelHeight`，确定 `height`（≤2.2），算 `scale`。
3. 标出眼/右手/枪口锚点（相对脚底，Y-up）。
4. 在 `characters.catalog.json` 增加 profile，status 先 draft。
5. 浏览器验收：相机高度、开镜、枪口火光/弹道起点、第三人称模型位置、队伍皮肤。
6. status → approved 后才能作为默认/联机角色。

## 4. 当前占位模型

`models/soldier.glb` 约 1.9m，按 1.0526 放大到 2.0m；相机 1.85m。模型本身是占位，
后续可以用新角色逐套替换；建筑/地图不需要跟着改。

## 5. 门洞通行

0.70m 胶囊直径下，门净宽 ≥1.3m 有 0.6m 余量；当前 house 门实测 1.344m，可通过。
若使用上限 2.2m 角色，胶囊直径仍按 0.70m（半径 0.35），门宽要求不变。
