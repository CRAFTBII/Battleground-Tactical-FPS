> **历史文档（v3）**：仅供理解旧实现。v4 规范以 [docs/rebuild/README.md](../rebuild/README.md) 为准；不要按本文恢复旧 runtime、2D 导航或旧尺寸表。

# 地图架构设计（数据驱动地图 + 建筑精修系统）

> 项目：战地突击 Battleground Tactical FPS（Three.js r160，UMD 全局 `THREE`）
> 模块：`js/world.js` · `js/maps/registry.js` · `js/maps/suburb.js`
> 适用引擎版本：Three.js r160（无 ESM / importmap 用于主代码）
> 关联决策：`docs/architecture/adr/adr-001-*.md`（数据驱动 vs 硬编码）、`adr-002-*.md`（JS 模块 vs fetch JSON）、`adr-003-*.md`（GLB 插槽加载+回退）

---

## 0. 架构评审结论（速览）

| 维度 | 结论 |
|------|------|
| 数据驱动重构 | **PASS** — 硬编码整图已抽取为 `mapDef` + 通用构建器 |
| 玩法保留 | **PASS** — 碰撞 141 / 平台 5 / 据点 A·B·C / 出生点 / 小地图 / 单机+联机 / A* 导航全部保留 |
| 离线即玩约束 | **PASS** — 地图走 `window.MapRegistry`（JS 模块），不 fetch JSON；GLB 默认禁用 |
| 冒烟验证 | **PASS** — `node test/smoke.js` 全绿（Exit 0），含「5 栋建筑构建 OK + warehouse 卷帘门留空」 |
| 建筑精修 | **PASS** — 窗框/窗台/门框/分缝/檐口/阳台/烟囱 程序化生成，细节合批为单 mesh |
| 风险项（CONCERNS） | 见 §8，均非阻塞，已有缓解 |

**总体结论：PASS（含 4 条非阻塞 CONCERN，无 FAIL）。** 可作为后续 Task #4（新地图数据）与新地图接入的基线。

---

## 1. 架构目标与约束

| 目标 | 说明 | 约束来源 |
|------|------|----------|
| 数据驱动 | 一张地图 = 一份数据定义（mapDef）+ 通用构建器（`World.load`）。新增地图只需写数据文件，不动 `world.js`。 | ADR-001 |
| 服务即玩 | 必须 `node server.js`，由 HTTP 提供 `models/*.glb`；`file://` 直接打开会显示明确的启动提示。 | 去内联改造（cd45815） |
| GLB 运行时资源 | 士兵/武器/建筑模型是标准 `.glb`，经自写 `js/glb.js` 解析；缺失时回退程序化几何并在页面顶部报错。 | 去内联改造（cd45815） |
| 玩法不变 | 据点占领、碰撞、A* 导航、出生点、小地图、单机与联机全部保留，数值与规则不改。 | 用户硬约束 |
| 性能可控 | 精修细节用合批 + 共享材质，避免 draw call 爆炸；支持 `?detail=` 降 LOD。 | 性能预算 |

---

## 2. mapDef 数据 Schema（完整字段）

> 所有坐标均为世界轴向米制；**坐标语义（C4 修订）**：`model` 建筑 `x/z` = 角点（西南角），局部坐标 `x∈[0,w]、z∈[0,d]`；**`proc` 建筑 `x/z` = 中心**（`buildBuilding` 内 `x0=x-w/2`）；据点/出生点/掩体 = 中心。
> `MapRegistry.validate(def)` 强校验：必须恰好 3 个据点、出生点 blue/red 非空、关键坐标为数字；否则该图不注册（不抛异常，仅 warn）。

### 2.1 顶层字段

| 字段 | 类型 | 必填 | 默认 | 说明 |
|------|------|------|------|------|
| `id` | string | ✅ | — | 地图唯一键（registry 主键、URL `?map=` 用） |
| `name` | string | ✅ | — | 显示名（地图选择 UI） |
| `desc` | string | — | `''` | 简介 |
| `theme` | string | — | `''` | 主题标签（美术/氛围用，见 Task #3） |
| `size` | number | — | `300` | 地图边长；写入 `CFG.WORLD`（影响出生边界、小地图比例） |
| `detail` | `'off'\|'none'\|'low'\|'high'\|'full'` | — | `'high'` | 地图级精修等级（见 §5）；可被 `?detail=` 覆盖 |
| `env` | object | — | `{}` | 环境（雾/天空/光照） |
| `terrain` | object | — | `{}` | 地形（噪声/土丘/压平区） |
| `roads` | object | — | `{}` | 道路 |
| `buildings` | array | — | `[]` | 建筑列表（model / proc） |
| `cover` | array | — | `[]` | 掩体列表 |
| `ruins` | object | — | `{}` | 废墟 |
| `props` | object | — | `{}` | 装饰物（灯/树/塔） |
| `capturePoints` | array(3) | ✅(3) | — | 据点，**必须恰好 3 个**（`game.js` 契约 A/B/C） |
| `spawns` | `{blue:[[x,z]..], red:[[x,z]..]}` | ✅ | — | 出生点，**blue/red 均非空** |
| `minimap` | object | — | `{}` | 小地图静态层配色与矩形 |

### 2.2 `env`（环境）

```js
env: {
  fog:       { color: 0x8fb4cc, near: 80, far: 340 },   // scene.fog（线性）
  background: 0x8fb4cc,                                  // scene.background 色
  hemi:      { sky: 0xdfe9ff, ground: 0x3d4a3a, intensity: 0.85 },
  sun:       { color: 0xfff2d8, intensity: 1.4, pos: [120,160,80],
               shadow: { mapSize: 1024, extent: 130, far: 400 } },
  ambient:   { color: 0x8899aa, intensity: 0.25 }
}
```

### 2.3 `terrain`（地形）

| 字段 | 类型 | 说明 |
|------|------|------|
| `seed` | number | 值噪声种子（`core.js` `makeNoise2D`） |
| `amp` | number | 基准起伏峰峰值（±amp/2） |
| `seg` | number | `PlaneGeometry` 细分（越高越平滑、越费） |
| `colors` | [c0,c1] | 顶点着色两色 |
| `colorMix` | 0\|1 | 配色混合开关（**见 §8 CONCERN-1：当前固定 0，与原随机实现有差异**） |
| `flattenPad` | number | `flattenPads` 每边外扩，用于建筑占地压平缓冲区 |
| `mounds` | [{x,z,peak,falloff,scale}] | 程序化土丘（高斯隆起） |
| `flattenPads` | [[cx,cz,w,d]] | 建筑占地矩形压平（中心+尺寸） |
| `flatten` | [{x0,x1,z0,z1}] | 显式压平矩形（道路/广场/据点/出生区） |

### 2.4 `roads`（道路）

```js
roads: {
  tex: 'asphalt', repeat: 40, thick: 0.12,
  strips: [ { x, z, w, d } ],     // 路面矩形（中心+宽深）
  markColor: 0xd8d8c0, markY: 0.16,
  marks:  [ { axis:'x'|'z', at, from, to, step, len, w } ]  // 标线（虚线）
}
```

### 2.5 `buildings`（建筑）

每栋建筑通用字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `'model'\|'proc'` | `model`=用 `BuildingLib` 内联 GLB 数据；`proc`=纯程序化扫描线开洞建筑 |
| `key` | string | `model` 用：对应 `BuildingLib.CONFIGS[key]` |
| `x,z` | number | **model=角点（西南角）；proc=中心**（C4） |
| `ry` | number | 旋转角（度） |
| `scale` | number | **model 用（v1.5 尺寸契约）**：等比系数（缺省 1.0），`w/d/h` 由 `BuildingLib.REAL_DIMS×scale` 推导，结构上杜绝非等比拉伸 |
| `w,d,h` | number | **proc 用**（碰撞/层高）；model 也可显式传（老数据兼容，比例偏差 >5% 告警，见 models.js） |
| `detail` | string\|bool\|number | 建筑级精修覆盖（见 §5）；`false`/`trim:false` → 关 |
| `trim` | false\|object | 精修配置（model 见 §5.2；proc 由 detailLevel 驱动） |
| `glb` | string(url) | **可选** 外部 GLB 插槽 URL（见 §6） |
| `glbFit` | `'uniform'` | GLB 缩放模式（uniform=等比；默认按 xyz 分别适配） |

**`proc` 专属字段**：`thick`(墙厚,默认0.5)、`floorH`(层高,默认3.0)、`floors`(层数)、`doors`(每面门区间 `[[u0,u1]..]`)、`windows`(每面窗数)、`wallTex`/`roofTex`/`detailTex`、`rooftop`({side})、`balcony`/`balconies`/`balconySide`、`chimney`(bool/obj)、`plinth`(bool，默认关)。

**`model` 的 `trim` 对象字段**：`top`(檐口高度)、`cornice`(bool)、`pilaster`(角柱,bool)、`pilasterW`、`bands`([y..] 楼层分缝)、`chimney`({x,z,w,d,h,base})。示例见 `suburb.js` 的 apartment/warehouse/house。

### 2.6 `cover` / `ruins` / `props` / `minimap`

- **cover**：`{t:'sandline'|'barrier'|'box', x, z, len?, horiz?, w?, h?, d?, mat?}`。
- **ruins**：`{wallColor, rubbleColor, walls:[{x,z,w,h,d,ry}], rubble:[{x0,x1,z0,z1,n,s0,s1}]}`。
- **props**：`{lamps:[[x,z]..], trees:[[x,z]..], towers:[[x,z]..]}`。
- **minimap**：`{bg, roadColor, plazaColor, wallColor, roads:[{x,z,w,d}], plaza:{x,z,w,d}}`（小地图 2D 静态层）。

---

## 3. `World.load(mapDef)` 构建流程

入口有两层：

```
World.init(scene, mapId?)      // 便捷封装：从 MapRegistry 取 def，缺失→FALLBACK
  └─ World.load(scene, mapDef) // 核心：按 mapDef 构建整张地图
```

`load()` 顺序（每一步消费 mapDef 对应字段，互不耦合）：

1. `unload()` — 移除上一图的场景对象、清空空间数据（`colliders/walls/platforms/overhead/grid/terrainH/...`），`_gen++`（使迟到的 GLB 回调失效）。
2. 设置 `mapDef/mapId`；若 `mapDef.size !== CFG.WORLD` 则改 `CFG.WORLD`。
3. `_detail = _resolveDetail(mapDef.detail)`（支持 `?detail=` URL 覆盖）。
4. `Tex.setupOverrides()` — 程序化纹理准备。
5. `buildEnv(env)` → 雾/天空/光照。
6. `buildTerrain(terrain)` → 噪声 + 土丘 + 压平区；写 `terrainH`（高度场回调）。
7. `buildRoads(roads)` → 路面 strip + 标线。
8. `buildBuildings(list)` → 按 `type` 分派 `placeModelBuilding` / `buildBuilding`。
9. `buildCover` / `buildRuins` / `buildProps`。
10. `buildCapturePoints` → 写入 `World.capturePoints`（供 `game.js` 据点玩法）。
11. `buildNavGrid()` → A* 栅格（基于 `colliders` 求 walkable）。
12. `buildMinimapStatic(minimap)` → 2D 静态层。
13. `genSpawns(spawns)` → 写入 `World.spawns.blue/red`（供 `pickSpawn`）。
14. 日志输出：`碰撞体 N | 平台 M | 精修等级 K`。

**空间数据载体**（换图由 `unload()` 统一回收）：`colliders`（移动/导航/小地图碰撞）、`walls`（墙体子集）、`platforms`（可站立台/坡道）、`overhead`（仅挡弹道的悬空墙段，见 §4）、`grid`（导航栅格）、`terrainH`（地形高度回调）、`objects`（场景根级对象列表，卸载遍历 dispose）。

**`FALLBACK`**（内置兜底空场）：当 `MapRegistry` 缺失或某图 `validate` 失败时启用，至少含 3 据点 + 非空出生点，保证对局不崩。

---

## 4. 关键机制：`OVERHEAD_Y` 与门洞可通行

**问题**：程序化建筑外墙用扫描线开洞后，门洞处仍是空的（不生成墙段），但门楣/上层墙段会挡住走位，导致程序化建筑「门进不去」。

**方案**：常量 `OVERHEAD_Y = 2.2`。`addWall(..., baseY)` 中：

```js
if (by >= OVERHEAD_Y) this.overhead.push(box);   // 门楣/上层墙：只挡子弹
else { this.colliders.push(box); this.walls.push(box); }  // 下层墙：挡走位+子弹
```

- 进入移动/导航碰撞检测的是 `colliders`（现有 `combat.js`/`ai.js` 遍历 `colliders` 且**忽略 AABB 的 y 区间**）→ 门洞处无 collider → 可穿行。
- 弹道命中检测 `rayBlocked(from,to)` 同时遍历 `colliders` **和** `overhead` → 门楣/悬空墙仍挡子弹（战术合理）。

> 注：门洞本身 (`opts.doorH≈2.6`) 生成的墙段 `baseY=0`，落入 `colliders` 之外（门区间是空段）；只有 `f>=1` 楼层上方的墙段 `baseY>=3.0` 自然进入 `overhead`。

**`model` 建筑（BuildingLib）的碰撞箱**：不经过 `addWall` 扫描线，而是由 `CONFIGS[key].colliders` 直接提供——**碰撞盒按 SCAD 源码逐构件编写**（见 `docs/architecture/building-dimensions-spec.md` §5.4）：外墙/门楣/楼板/平台的本地坐标直接抄 SCAD 对应 cube，`build()` 按 `scale` 等比缩放。门洞可通行语义与 proc 相同：门楣 `min.y≥2.6` 进 `overhead` 逻辑（nav 网格跳过、只挡弹道）；门洞净宽 ≥6m 保证 ≥3 个 nav 格净空。

---

## 5. 建筑程序化精修系统

**目标**：给建筑加窗框/窗台/门框/墙面分缝/檐口/阳台栏杆/烟囱，纯视觉（不生成碰撞体），提升质感且不破坏走位/寻路/小地图。

**等级解析**（两级覆盖）：

```
DETAIL = { off:0, none:0, low:1, high:2, full:2 }
地图级  _resolveDetail(mapDef.detail)  → World._detail（可被 ?detail= 覆盖）
建筑级  detailLevel(opts)：opts.detail/trim===false → 0；否则按字符串/数字覆盖
```

| 等级 | 内容 |
|------|------|
| `0` off | 无精修（仅裸墙+楼板+屋顶） |
| `1` low | 窗框/门框/窗台 + 檐口压顶 + 楼层分缝环 |
| `2` high | 在 low 基础上 + 阳台栏杆 + 烟囱 + 角柱（model 建筑） |

**性能保障（防 draw call 爆炸）**：
- 所有细节盒先收集进 `det[]`，最后 `_mergeBoxes(det)` 合批成**单个 `BufferGeometry`**（顶点/索引内联变换，unit box 缓存复用；顶点 >65535 自动切 `Uint32` 索引）。
- 细节材质经 `sharedMat(name, repeat, color)` 全局缓存共享（同一份材质跨建筑复用）。
- 单栋建筑精修 → **1 个 mesh**，draw call 不随细节数量增长。

### 5.1 proc 建筑精修（`buildBuilding`）

- 外墙扫描线开洞（门/窗）→ 剩余矩形段用 `addWall` 生成。
- 精修细节：`_ringBoxes` 生成檐口/分缝/勒脚环；`pushF` 局部坐标→世界盒生成窗框立梃/冒头、窗台、门楣挑檐、阳台挑板/栏板/扶手。
- `plinth`（勒脚）默认关——开启会横穿门洞底边，影响观感。

### 5.2 model 建筑精修（`buildModelTrim`）

- `BuildingLib.build(key)` 生成主体（内联 GLB 数据，含碰撞/平台）。
- 外挂件在**模型局部坐标**（x∈[0,w]、y∈[0,h]、z∈[0,d]）生成：檐口环、四角角柱、楼层分缝带、烟囱+帽。
- 外挂件组挂到 `vis`（同 `ry` 旋转），**不向 `colliders` 推任何盒** → 不影响走位/导航/小地图。
- 全部合批为 1 mesh，共享材质。

---

## 6. GLB 插槽机制（`GLBSlots` + `glbSlot`）

**定位**：外部 `.glb` 是 **opt-in 视觉增强**。碰撞/导航/小地图**始终来自程序化数据**（mapDef 的 `w/d/h` 或 `BuildingLib` 碰撞盒），GLB 只替换「外观」。

**启用判定**（`GLBSlots.enabled()`）：
```
false ← ① THREE.GLTFLoader 未挂全局（纯程序化项目）
false ← ② location.protocol === 'file:'（离线双击 → 直接回退）
false ← ③ URL 含 noglb=1（调试开关）
true  ← 其余（在线 + 已引入 GLTFLoader）
```

**加载流程**（`glbSlot(def, vis, dim)`）：
1. `GLBSlots.load(url, onOk, onFail)`。
2. **成功**：按 `glbFit` 缩放并角点对齐到 `(def.x,0,def.z)` 旋转 `ry`；`vis.visible=false`（程序化退居幕后）；碰撞体保持不变。代际检查 `gen !== self._gen` 时丢弃迟到的结果（防换图串台）。
3. **失败/未启用**：静默保留程序化建筑（仅一条 console.log，不抛异常、不阻塞）。

**回退链**：`MapRegistry` → `World.load`（validate 失败 → FALLBACK） → `placeModelBuilding`（BuildingLib 缺失 → 占位实心盒） → `glbSlot`（GLB 失败 → 程序化视觉）。**任何一环失败都不崩对局。**

---

## 7. 离线约束说明（为什么不用 fetch JSON）

`file://` 下浏览器对 `fetch('maps/suburb.json')` 返回 opaque/blocked（CORS 同源失败），会导致地图加载即崩。因此：

- 地图数据以 `<script>` 注入 `window.MapRegistry`（`js/maps/registry.js` + `js/maps/suburb.js`），同步可用、零网络。
- `index.html` 加载顺序硬约束（注释标注）：`registry.js` → 各地图文件 → `world.js` → 其余。
- 不引入任何 `fetch`/`XHR`/动态 `import()` 加载地图。
- 若日后需在线分发多地图，可新增「在线清单 + JS 动态注入」路径，**不改现有离线契约**。

---

## 8. 架构评审（PASS / CONCERNS / FAIL）

### PASS（达成项）
- P1 数据驱动：整图硬编码 → `mapDef` + 通用构建器；新增地图零改 `world.js`。
- P2 玩法不变：`node test/smoke.js` 全绿——碰撞 141、平台 5、单位 20、据点 A/B/C、出生点、小地图、单机+联机、A*（600 帧 0.06ms/帧）全部保留。
- P3 离线即玩：无 fetch；`file://` 下 GLB 自动回退程序化。
- P4 性能：精修合批为单 mesh + 共享材质；`?detail=off` 可一键降 LOD。
- P5 容错：FALLBACK + BuildingLib 回退 + GLB 回退三层兜底，坏图不拖垮对局。

### CONCERNS（非阻塞，需关注）
- **C1 地形配色差异**：原 `world.js` 用 `U.rand()<0.5` 随机选 `colors[0/1]`；为确定性，`suburb.js` 设 `terrain.colorMix:0`（全用 `colors[1]`）。视觉上是「无随机斑块」的整洁草地，功能无影响。若需还原斑驳感，后续可加确定性噪声驱动 `colorMix` 而非随机。
- **C2 勒脚（plinth）默认关**：开启会横穿门洞底边，观感差；保持默认关即可。
- **C3 GLB 仅在线生效**：离线/未引 `GLTFLoader` 一律程序化——这是设计取舍（零外部资源默认），但意味着美术侧提供的 `.glb` 必须配合在线部署或本地起服务器预览（见 Task #3/#4）。
- **C4 建筑级 detail 覆盖**：`opts.detail` 字符串走 `DETAIL` map，`'none'`→0；若写错字符串会回退到地图级（`detailLevel` 兜底），不会崩。
- **C5 FALLBACK 简版**：兜底空场无建筑/道路，仅 3 据点 + 各 3 出生点（validate 通过），仅用于「注册表全失」的极端场景，不应作为正式玩法图。
- **C6 overhead 与 combat 耦合**：`rayBlocked` 已遍历 `overhead`（挡弹道），但若未来某玩法需要「悬空墙也挡走位」，需改 `addWall` 阈值或新增分类，目前不影响。

### FAIL
- 无。

---

## 9. 程序员控制清单（一页规则）

> 新增/修改地图或建筑时逐条核对：

1. **地图必须注册到 `MapRegistry`**；`register` 前 `validate` 必须过：恰好 3 据点（A/B/C）、blue/red 出生点非空、坐标为数字。
2. **坐标语义（C4 修订）**：`model` 建筑 `x/z` = **角点（西南角）**；`proc` 建筑 `x/z` = **中心**；据点/出生点/掩体 = 中心。写错会导致建筑错位（尤其 proc 会整体偏 w/2、d/2）。
3. **`index.html` 顺序**：`registry.js` → 各地图 `*.js` → `world.js`，不得颠倒（否则 `World.init` 取不到图）。
4. **绝不 fetch 本地 JSON** 加载地图；新地图 = 一个 `js/maps/xxx.js` 调 `MapRegistry.register({...})`。
5. **建筑精修是纯视觉**：任何精修细节（窗框/檐口/栏杆/烟囱）**不得**向 `colliders` 推盒；碰撞只来自 `BuildingLib` 数据或 `buildBuilding` 的 `addWall`。
6. **碰撞箱按 SCAD 源码编写**（v1.8 强制）：`BuildingLib.CONFIGS[key].colliders/platforms` 的本地坐标逐构件抄写对应 `battle_*.scad`（外墙/门楣/楼板/平台直接对 cube）；禁止凭空编造或按地图 `w/d/h` 反推。改 SCAD 必须同步改 CONFIGS（见 `docs/architecture/building-dimensions-spec.md` §5.4）。
7. **精修细节必须合批**：收集进 `det[]` 后 `_mergeBoxes` 一次性生成；材质走 `sharedMat` 共享，禁止逐细节 `new Mesh`。
8. **门洞可通行**：下层墙（`baseY<OVERHEAD_Y`）入 `colliders`；门楣/上层墙（`baseY>=OVERHEAD_Y`）只入 `overhead`。不要动 `OVERHEAD_Y=2.2` 阈值除非重测碰撞。`model` 建筑门楣 `min.y` 同理需 ≥2.6（nav 跳过阈值，含 `sink` 修正）。
9. **GLB 是 opt-in**：设 `glb` 字段时，碰撞/导航仍由程序化数据提供；GLB 失败必须静默回退（不许抛异常中断构建）。
9. **换图必走 `World.load`**：它会先 `unload()`（回收 `objects`+空间数据+`_gen++`），禁止直接 `new` 场景对象而不登记 `objects`。
10. **`?detail=` 调试**：`off`/`low`/`high` 可强制 LOD 做性能对比；正式图以 `mapDef.detail` 为准。
11. **不改玩法数值**：据点规则、碰撞阈值、出生点逻辑、导航 CELL 尺寸维持不变；新地图只改数据，不改 `world.js` 规则。
12. **测试门控**：每次改 `world.js` 或 `js/maps/*` 后跑 `node test/smoke.js`，必须全绿（含「建筑断言」「地形覆盖断言」）方可交付。
