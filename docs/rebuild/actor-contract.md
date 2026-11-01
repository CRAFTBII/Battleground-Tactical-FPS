# 角色资产契约（Actor Profile / 扩展口）

> 目的：建筑与相机按“最高 2.5m 的角色”设计；后续可替换/新增多个人物模型，不改地图与相机代码。
> 数据：`data/actors/characters.catalog.json`　运行时：`js/actors.js`（`window.ActorCatalog`）

## 1. Profile 字段

```json
{
  "id": "vanguard",
  "name": "默认士兵（占位）",
  "status": "placeholder | draft | approved",
  "glb": "models/soldier.glb",
  "modelHeight": 1.9,
  "height": 2.5,
  "scale": 1.3158,
  "eyeHeight": 2.3,
  "capsule": { "radius": 0.45, "height": 2.5, "halfHeight": 0.8 },
  "stepHeight": 0.55,
  "camera": { "fov": 70, "near": 0.1, "far": 1200 },
  "anchors": {
    "eye": [0, 2.3, 0],
    "weaponR": [0.28, 1.95, 0.35],
    "muzzle": [0.28, 1.95, 0.8]
  },
  "weaponScale": 1.0,
  "variants": []
}
```

约束：

- `height ≤ maxHeight = 2.5m`；`eyeHeight < height`。
- `scale = height / modelHeight`，模型资产本身保持原尺寸；不要在地图/建筑代码里再乘全局倍率。
- `anchors` 必须随模型/身高给出；相机、枪口、投掷点都从这里取，禁止写死 1.7m。
- 多角色：在 `profiles` 增加条目；运行时 `ActorCatalog.setDefault(id)` 或按队伍/玩家选择。
- 队伍皮肤/变体放 `variants`，不复制 profile。

## 2. 运行时 API

```js
await ActorCatalog.load();          // 读取 data/actors/characters.catalog.json
ActorCatalog.list();                // 所有 profile
ActorCatalog.get(id);               // 单个 profile
ActorCatalog.setDefault(id);        // 应用默认 profile → CFG.EYE / PLAYER_HEIGHT / PLAYER_RADIUS / PLAYER_STEP
ActorCatalog.eyeHeight(id);
ActorCatalog.capsule(id);
ActorCatalog.anchors(id);
ActorCatalog.scale(id);
```

`ActorCatalog.apply()` 会写入：

- `CFG.PLAYER_HEIGHT`
- `CFG.EYE`（相机眼高）
- `CFG.PLAYER_RADIUS`
- `CFG.PLAYER_CAPSULE_HEIGHT`
- `CFG.PLAYER_STEP`

相机创建时必须使用 profile 的 `camera.fov/near/far` 与 `CFG.EYE`；第一人称武器/枪口用 `anchors`。

## 3. 新增人物模型流程

1. 新 GLB 放到 `models/characters/<id>.glb`（Y-up、米制、脚底原点、面朝 -Z）。
2. 测量模型高度 `modelHeight`，确定目标 `height`（≤2.5），算 `scale`。
3. 标出眼/右手/枪口锚点（相对脚底，Y-up）。
4. 在 `characters.catalog.json` 增加 profile，status 先 draft。
5. 浏览器验收：相机高度、开镜、枪口火光/弹道起点、第三人称模型位置、队伍皮肤。
6. status → approved 后才能作为默认/联机角色。

## 4. 当前占位模型

`models/soldier.glb` 高约 1.9m，按 1.3158 放大到 2.5m；相机 2.3m。该模型仅是占位，
后续可以用新角色逐套替换；建筑/地图不需要跟着改。
