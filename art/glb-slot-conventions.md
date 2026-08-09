# GLB 建筑插槽约定（美术圣经 · 附录 C）

> 对应实现：`js/world.js` — `GLBSlots` / `World.glbSlot()` / `World.modelDims()`；`js/models.js` — `BuildingLib`
> 关联决策：`docs/architecture/adr/adr-003-glb-slot-load-fallback.md`、`docs/architecture/map-architecture.md` §6
> 本文档定义美术侧交付 `.glb` 的**命名、坐标、尺寸、预算、回退与验收**约定。不改代码。

---

## 0. 先说清楚现状（美术必须知道的三件事）

| # | 事实 | 证据 | 含义 |
|---|------|------|------|
| 1 | **GLB 插槽当前 100% 处于休眠状态** | `index.html` 的 15 个 `<script>` 中**没有引入任何 GLTFLoader**（既无 UMD 也无 ESM 挂载），`THREE.GLTFLoader === undefined` → `GLBSlots.enabled()` 恒返回 `false` | 现在往 mapDef 里写 `glb:'xxx.glb'` **不会有任何效果**，只会在控制台打一行日志。工程需先接 loader（P1） |
| 2 | **GLB 永远不在 `file://` 下生效** | `GLBSlots.enabled()` 第二条：`location.protocol === 'file:'` → 直接返回 false | 「双击即玩」的玩家**永远看到程序化建筑**。GLB 只是在线部署时的增强 |
| 3 | **GLB 绝不改碰撞** | `glbSlot()` 只做 `vis.visible = false` 替换视觉；`colliders`/`platforms` 来自 `BuildingLib.CONFIGS` 或 mapDef 的 `w/d/h` | 模型的门洞/楼板/平台位置**必须**与 §3 的碰撞表严格对齐，否则玩家撞空气或穿墙 |

> **由此推出本文档最重要的一条约束（§5.1「剪影等价原则」）**：任何 GLB 都必须有一个**等价的程序化外观**，且两者剪影一致。离线玩家与在线玩家看到的必须是「同一栋楼的粗糙版和精细版」，不能是两栋不同的楼。

---

## 1. 何时该做 GLB，何时不该

| 判据 | 做 GLB | 不做，用程序化 |
|------|-------|--------------|
| 几何是否能用轴向盒 + 圆柱拼出？ | 否（曲面、桁架、斜撑、复杂剪影） | 是 |
| 是否是**唯一**的、玩家会用来定位的地标？ | 是 | 否（普通民居/仓库） |
| 是否需要参与碰撞？ | 需要的话必须**先有**程序化碰撞数据 | — |
| 复用次数 | 1–2 次（地标） | ≥ 3 次（用程序化才能批量） |

**结论**：GLB 用于**地标**，不用于**填充建筑**。填充建筑永远走 `BuildingLib` + 程序化精修。

---

## 2. 命名规范

```
models/buildings/<map>_<type>[_<variant>][_lod<N>].glb
```

| 段 | 取值 | 规则 |
|----|------|------|
| `<map>` | `suburb` \| `port` \| `desert` \| `common` | 跨图复用的用 `common` |
| `<type>` | `warehouse` \| `apartment` \| `house` \| `watchtower` \| `cover` \| `landmark_<name>` | 与 `BuildingLib.CONFIGS` 的 key 对应；地标用 `landmark_` 前缀 |
| `<variant>` | `a` / `b` / `damaged` / `open` … | 可选 |
| `_lod<N>` | `_lod0` / `_lod1` | 可选，暂未接入切换逻辑 |

**硬规则**：全小写、下划线分隔、**无空格、无中文、无大写**（部分静态服务器与 CDN 大小写敏感）。

示例：
```
models/buildings/port_warehouse.glb
models/buildings/port_landmark_gantry_crane.glb
models/buildings/desert_house_a.glb
models/buildings/common_watchtower.glb
```

对应 mapDef 写法：
```js
{ type:'model', key:'warehouse', x:62, z:62, ry:0, w:22, d:14, h:8.5,
  glb: 'models/buildings/port_warehouse.glb',   // 可选；失败静默回退
  trim: { top: 8.0, cornice: true, pilaster: true } }
```

---

## 3. 坐标、pivot、朝向与缩放对齐规则

### 3.1 引擎实际做了什么（必须理解，否则模型一定错位）

`World.glbSlot()` 的处理链（`js/world.js`）：

1. 取 `dim = modelDims(def)`：优先用 mapDef 的 `w/d/h`，否则从 `BuildingLib.CONFIGS[key].colliders` 推最大边。
2. 测模型包围盒 `size`，算 `sx = dim.w/size.x`、`sy = dim.h/size.y`、`sz = dim.d/size.z`。
3. `glbFit === 'uniform'` → 取 `min(sx,sy,sz)` 等比；否则 **xyz 分别拉伸**。
4. 缩放后重测包围盒，`obj.position.set(-bb.min.x, -bb.min.y, -bb.min.z)` → **把包围盒最小角对齐到 holder 原点**。
5. `holder.position.set(def.x, 0, def.z)`，`holder.rotation.y = def.ry × π/180`。

**推论**：

| 事项 | 结论 |
|------|------|
| **pivot 位置** | **不敏感** —— 引擎会强制把包围盒 min 角对齐到 (0,0,0)。你把原点放哪都行 |
| **包围盒纯净度** | **极度敏感** —— 任何游离物体（灯光、相机、空 Empty、辅助线、离群顶点）都会撑大包围盒，导致整体缩放错误。**导出前必须清场，只保留建筑网格** |
| **单位** | 米。glTF 标准 = 米、Y-up、右手系 |
| **导出朝向** | Blender 导出勾选 **+Y up**（默认）。不要手动套 -90° X 旋转，也不要在导出时应用额外变换 |
| **尺寸精度** | 必须按 §3.3 标称尺寸建模，偏差 **> 5%** 会被非等比拉伸成变形（因为默认 `glbFit` 是分轴拉伸） |
| **旋转中心** | 绕包围盒 min 角（= 建筑西南角），与 `BuildingLib` 一致 |

### 3.2 局部轴向约定

```
局部 +X = 建筑宽 (w)     →  世界 +X
局部 +Y = 建筑高 (h)     →  世界 +Y
局部 +Z = 建筑深 (d)     →  世界 +Z
建筑占据 [0,w] × [0,h] × [0,d]（包围盒 min 角在原点）
正门朝 -Z 面（即局部 z = 0 的那一面）
```

> **正门朝 -Z** 是从 `BuildingLib.CONFIGS` 反推的既有约定：SCAD 源在「后墙 y0 面」开门，`BuildingLib.build` 把模型 y 轴映射到世界 z 轴 → 门洞落在 `z = z0` 面。所有 GLB 必须遵守，否则 mapDef 里既有的 `ry` 值全部作废。

### 3.3 各类型标称尺寸与**必须对齐的碰撞特征**（红线表）

数据源：`js/models.js` 的 `BuildingLib.CONFIGS`（碰撞）+ `models/buildings_data.js` 实测包围盒（几何）。
**GLB 的门洞、楼板、可站立平台必须落在下表位置**，否则视觉与碰撞打架。

| type | 标称 w×d×h | 门洞（-Z 面，局部 x 区间 × 高） | 楼板 y | 可站立平台 y | 其他碰撞特征 |
|------|-----------|-------------------------------|--------|-------------|-------------|
| `warehouse` | **22 × 14 × 8.5** | 卷帘门 `x ∈ [8.6, 13.4]`，高 **5.4** | — | 屋顶 **8.5** | 四面实墙，墙厚不限；高窗**不参与碰撞**（可自由设计） |
| `apartment` | **16 × 12 × 16.6** | 门 `x ∈ [7.1, 8.9]`，高 **2.6** | **4 / 8 / 12**（各 0.3 厚） | 屋顶 **16.6** | 4 层；`+Z` 面为完整前墙 |
| `house` | **10 × 8 × 4.3** | 门 `x ∈ [4.3, 5.7]`，高 **2.2** | — | 屋顶封盖 **4.0–4.3** | 视觉可做人字顶（碰撞是平顶，顶面 4.3 以上不参与碰撞，坡顶可自由造型） |
| `watchtower` | **4 × 4 × 8.5** | 无门（爬上去） | — | 平台 **7.4** | 四腿各 `0.4×0.4` 在四角；栏杆 `7.4–8.5`；⚠ 见 §3.4 |
| `cover` | **14.5 × 5.7 × 2.6** | — | — | — | 组合件：集装箱 ×2、木箱 ×2、沙袋堆、路障 ×2（坐标见 `CONFIGS.cover`） |

### 3.4 ⚠ 已知对齐缺陷（做 GLB 前工程必须先修，否则 GLB 也会跟着错）

| ID | 缺陷 | 对 GLB 的影响 |
|----|------|-------------|
| **D-03** | `BuildingLib` 的碰撞盒不随 `ry` 旋转（代码注释自认「ry 暂仅视觉」）。而 GLB 的 holder **会**旋转 → GLB 与碰撞的错位程度与程序化版**完全相同**（同错同步，至少一致） | 在 D-03 修好前，**GLB 只能用在 `ry = 0` 的建筑上**，否则视觉与碰撞分离 |
| **D-04** | `watchtower` 几何包围盒是 `(-2,-2)…(2.2,2.2)`（居中），碰撞是 `[0,4]×[0,4]`（角点） | GLB 版 watchtower 必须按**角点系**建模（`[0,4]×[0,4]`），**不要**照抄现有几何的居中原点 |
| **D-06** | `suburb.js` 的 `trim.top` 与模型实测高不符（warehouse 实测 9.70 / 写 8.0；apartment 实测 19.10 / 写 16.6） | GLB 若按标称 `h` 建模，`trim` 檐口位置会与 GLB 屋顶对不上 → **交付 GLB 时必须同时提交建议的 `trim.top` 值** |

---

## 4. 技术预算与导出设置

### 4.1 面数与体积

| 类型 | 三角面上限 | 文件体积上限 |
|------|-----------|-------------|
| `house` | 3 000 | 300 KB |
| `warehouse` | 6 000 | 500 KB |
| `apartment` | 8 000 | 600 KB |
| `watchtower` / `cover` | 2 000 | 200 KB |
| `landmark_*` | 15 000 | 800 KB |
| **单图 GLB 合计** | **≤ 80 000 tris** | **≤ 4 MB** |

### 4.2 导出白名单 / 黑名单

| 项 | 要求 | 原因 |
|----|------|------|
| 压缩 | ❌ **禁用 Draco**、❌ **禁用 meshopt** | 需额外的 `DracoLoader`/`MeshoptDecoder`，项目未引入 → 加载直接失败 |
| 贴图格式 | ✅ PNG / JPG **内嵌**（single-file .glb）；❌ KTX2 / Basis | 需 `KTX2Loader`，未引入 |
| 贴图数量 | ≤ 1 张 baseColor，≤ 1024² | 显存与首帧预算 |
| **推荐做法** | ✅ **纯顶点色、零贴图** | 与现有 `BuildingLib`（`MeshLambertMaterial({vertexColors:true})`）风格完全一致，且体积最小 |
| 材质 | GLTFLoader 会生成 `MeshStandardMaterial`。项目其余全是 `MeshLambertMaterial` 且**无环境贴图** | Standard 材质在无 envMap 下金属会发黑 → **必须 `metalness = 0`、`roughness ≥ 0.85`**；建议工程加一步材质降级到 Lambert（P2） |
| 动画 | ❌ 不要 | 无播放逻辑 |
| 骨骼 / 变形目标 | ❌ 不要 | 同上 |
| 相机 / 灯光 / 空节点 | ❌ **必须删除** | 会撑大包围盒 → 缩放错误（§3.1） |
| 法线 | ✅ 必须导出，硬边用 split | Lambert 依赖法线，缺失会全黑 |
| UV | 有贴图时必须；纯顶点色可省 | |
| 名称 | 网格名用 ASCII | 便于日志排查 |

### 4.3 LOD

引擎当前**没有** `THREE.LOD` 或距离切换逻辑 → **首版只交付单档**。
若后续接入：`_lod0`（全量）/ `_lod1`（≤ 30% 面数，去掉所有 < 0.25m 的部件，保留剪影），切换距离建议 **60 m**（与 `building-fidelity.md` §1 的可见度预算一致）。优先级 **P2**。

---

## 5. 回退规则（美术必须遵守的设计约束）

### 5.1 剪影等价原则（硬约束）

> **任何 GLB 都必须存在等价的程序化外观，且两者剪影在 30m 外不可区分。**

具体量化：
- 体量偏差 **≤ 10%**（w/d/h 各轴）
- 门洞位置与净尺寸 **完全一致**（见 §3.3 红线表）
- 可站立平台高度 **完全一致**
- 主要轮廓突出物（塔楼、烟囱、屋顶设备）位置偏差 **≤ 1 m**

**理由**：`file://` 玩家永远看不到 GLB。若 GLB 上有一个程序化版没有的塔楼，在线玩家会用它当导航地标，离线玩家则完全找不到——这是**可访问性 + 离线即玩双重违规**。

### 5.2 地标的双轨交付

任何 `landmark_*` GLB 必须**成对交付**：

1. **程序化版规格**（必交）：用轴向盒/圆柱描述的简化几何清单 + 碰撞盒清单，交给工程写进 mapDef 的 `cover`/`buildings`。这是**基线**。
2. **GLB 精修版**（可选）：在线增强。

若只能交付其一 → **交付程序化版**。

### 5.3 引擎侧回退链（引用 ADR-003，美术只需知道结果）

```
MapRegistry.validate 失败      → FALLBACK 空场
BuildingLib 缺失/数据损坏      → 占位实心盒（碰撞与导航仍成立）
GLTFLoader 未引入 / file:// / ?noglb=1 / 加载失败 / 解析异常
                               → 静默保留程序化建筑（仅一行 console.log）
换图后迟到的 GLB 回调          → 被 _gen 代际检查丢弃
```
**任何一环失败都不崩对局。** 美术交付物损坏的最坏后果是「看起来朴素一点」，不是白屏。

---

## 6. 美术提交清单：哪些地标值得做真实模型

排序依据：① 程序化难度（盒子拼不出来的优先）② 导航价值（能不能当地标用）③ 复用性。
**每一项都必须同时给出「程序化基线规格」**（§5.2）。

| 优先级 | 名称 | 建议文件名 | 标称尺寸 (w×d×h) | 需碰撞 | 面数预算 | 程序化基线可行性 | 说明 |
|--------|------|-----------|-----------------|-------|---------|----------------|------|
| **P0** | 龙门吊 | `port_landmark_gantry_crane.glb` | 40 × 16 × 26 | 仅立柱（4 根 2×2） | 12 k | ✅ 盒+柱可拼出可接受的基线 | port 唯一的超大剪影，夜里从任何角度都能看见 → 全图导航锚点。**最高价值** |
| **P0** | 水塔 / 宣礼塔 | `desert_landmark_water_tower.glb` | 8 × 8 × 22 | 塔基 4×4 | 6 k | ✅ 圆柱 + 盒 | desert 地形平坦，需要一个竖向地标区分方位 |
| **P1** | 集装箱堆（成组） | `port_landmark_container_stack.glb` | 24 × 12 × 9 | 需要（可攀爬） | 5 k | ✅ **纯盒即可，建议直接走程序化，不做 GLB** | 色区导航的载体（见 `theme-atmosphere.md` §2.3） |
| **P1** | 货轮（静态，地图边界） | `port_landmark_cargo_ship.glb` | 70 × 18 × 20 | 否（在可行走区外） | 15 k | ⚠ 曲面船体程序化难看 | 放在地图边界当背景板，**不进碰撞、不进导航** → 是最安全的 GLB 用例 |
| **P1** | 加油站 | `suburb_landmark_gas_station.glb` | 18 × 12 × 6 | 罩棚立柱 + 便利店 | 5 k | ✅ 盒可拼 | suburb 中段的功能性地标 |
| **P2** | 清真寺 / 教堂 | `desert_landmark_mosque.glb` | 20 × 20 × 18 | 主体 | 12 k | ⚠ 穹顶程序化难 | 有了水塔后优先级下降 |
| **P2** | 钟楼 | `suburb_landmark_clocktower.glb` | 8 × 8 × 24 | 塔基 | 8 k | ✅ | |
| **P2** | 桥 / 栈桥 | `port_bridge.glb` | 30 × 8 × 6 | 桥面平台 | 6 k | ✅ | 需要 `platforms` 数据配套，工程量大于美术量 |
| ✗ | 普通民居/仓库/公寓的 GLB 版 | — | — | — | — | — | **不做**。程序化 + trim 已足够，做 GLB 得不偿失且加重离线/在线视觉分裂 |

---

## 7. 交付、自检与验收

### 7.1 目录

```
models/
└── buildings/
    ├── port_landmark_gantry_crane.glb
    ├── port_landmark_gantry_crane.README.md   ← 必附：标称尺寸/门洞/平台/建议 trim.top/程序化基线规格
    └── ...
```

每个 `.glb` **必须**附一个同名 `.README.md`，内容至少包含：
标称 `w/d/h` · 门洞局部坐标与净尺寸 · 可站立平台 y · 建议 `trim.top` · 建议 `glbFit` · 三角面数 · 是否含贴图 · **程序化基线几何清单**。

### 7.2 美术自检清单（交付前逐条打勾）

- [ ] 包围盒尺寸 = 标称 `w × d × h`，各轴偏差 ≤ 5%
- [ ] 包围盒 min 角紧贴建筑实体（无游离物体撑大包围盒）
- [ ] 场景中**无**相机、灯光、空 Empty、辅助对象
- [ ] 正门朝 **-Z**，门洞局部 x 区间与净高符合 §3.3
- [ ] 楼板 / 可站立平台高度与 §3.3 完全一致
- [ ] Y-up、右手系、单位米，无残留变换（导出时 Apply Transform）
- [ ] 无 Draco / 无 meshopt / 无 KTX2 / 无动画 / 无骨骼
- [ ] 有法线；材质 `metalness = 0`、`roughness ≥ 0.85`
- [ ] 面数与体积在 §4.1 预算内
- [ ] 文件名符合 §2；已附 `.README.md`
- [ ] **已提交等价的程序化基线规格**（§5.2）

### 7.3 工程/QA 验收方式

```bash
# GLB 只在 http 下生效，必须起本地服务
node server.js                       # 或 python -m http.server 8000
```

| 步骤 | URL | 预期 |
|------|-----|------|
| 1. 程序化基线 | `http://localhost:8080/index.html?map=port&noglb=1` | 建筑为程序化外观，无报错 |
| 2. GLB 版 | `http://localhost:8080/index.html?map=port` | 控制台出现 `[GLB] xxx.glb 已替换 "key" 的视觉`；建筑外观更精细 |
| 3. 剪影对比 | 同一机位分别截图 1 / 2 | 轮廓重合，体量偏差 ≤ 10%（§5.1） |
| 4. 碰撞一致性 | 走到门口 / 上屋顶 | 能进门、能站上平台、不撞空气、不穿墙 |
| 5. 离线回退 | 双击 `index.html`（`file://`） | 控制台出现 `[GLB] 未启用外部 GLB…`，游戏正常，无红条错误 |
| 6. 换图安全 | 快速连续换图 | 无「上一张图的 GLB 出现在新图」的串台 |
| 7. 回归 | `node test/smoke.js` | 全绿；**碰撞体数量与接 GLB 前完全一致**（GLB 不改碰撞） |

### 7.4 版本与替换

- 同名覆盖即生效，无需改 mapDef（`glb` 字段是 URL）。
- 尺寸/门洞发生变化 → **必须同步更新 `.README.md` 并通知工程**（可能要改 mapDef 的 `w/d/h` 与 `trim.top`）。
- 废弃的 GLB 直接删文件即可：加载失败会静默回退程序化，**不会崩**（ADR-003）。这是本机制最大的运维优势。
