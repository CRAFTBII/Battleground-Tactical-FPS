# v5 建筑预制体（Drop-in）

把通过验证的 GLB 放在这里。命名与 `data/assets/buildings.v5.catalog.json` 的 asset id 一致：

```text
models/buildings/v5/
  warehouse_a.glb
  admin_b.glb
  apartment.glb
  house.glb
  townhouse.glb
  shop.glb
  guardhouse.glb
  shed.glb
  container_stack.glb
  ruin.glb
  wall_module.glb
  catwalk_module.glb
  dock_crane.glb
  extraction_gate.glb
```

## 接入步骤

1. Blender 导出：Y-up、应用变换、根节点 scale=1、原点 footprint 中心地面。
2. 节点命名：`VIS__<id>` / `COL__<id>` / `NAV__<id>_F0` / `ANCHOR__<id>_door_main`。
3. 运行验证：
   ```bash
   python tools/buildings/validate_glb.py models/buildings/v5/warehouse_a.glb \
     --target 20 8.5 14 --require VIS,COL,NAV,ANCHOR
   ```
4. 生成 manifest：
   ```bash
   node tools/gen_manifest.cjs
   ```
5. 地图数据把程序化条目替换为 GLB：
   ```js
   // 旧
   { type: 'warehouse', x: 235, z: 112, ry: 0 }
   // v5
   { key: 'warehouse_a', x: 235, z: 112, ry: 0 }
   ```
6. 重新加载地图，检查门/楼梯/楼板/窗口/导航。

## 约束

- 一栋预制体只使用一套 2K trim sheet + 1K 道具图集；
- draw call ≤6；
- 碰撞代理 ≤视觉三角 15%；
- 每层 NAV 命名带 `floorId`；
- 门/楼梯/破窗必须有 ANCHOR；
- 室内必须可进、可读、有灯光/窗/掩体。

详细规范见 [docs/design/building-kit-v5.md](../../../docs/design/building-kit-v5.md)。
