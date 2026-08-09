# 三图主题氛围标准（美术圣经 · 附录 B）

> 对应实现：`js/world.js` — `buildEnv()` / `buildTerrain()` / `buildRoads()` / `buildRuins()` / `buildProps()`；`js/textures.js` — `Tex`
> 数据落点：各 `js/maps/<id>.js` 的 `env` / `terrain.colors` / `roads` / `ruins` / `props` 字段
> 关联：`art/building-fidelity.md`（§6.3 主题化能力缺口）、`art/accessibility.md`（夜景可读性红线 = 硬门槛）
> 本文档只给参数与色板，**不改任何代码或 mapDef**。带 ⚙ 标记的项需要工程先补能力（见 building-fidelity.md §6.3）。

---

## 0. 统一视觉语言（三图共享的底层规则）

| 规则 | 内容 |
|------|------|
| **同一套建筑，靠光与色分家** | 三图共用 `BuildingLib` 的 5 种建筑体量。主题差异 **70% 来自 env 光雾、20% 来自纹理/染色、10% 来自 props**。不为主题新增建筑体量（成本失控且破坏玩法一致性）。 |
| **剪影优先** | 玩家在 15–60m 判读的是**轮廓**，不是材质。任何主题调整不得降低建筑与背景的明度分离度（见 §5 红线）。 |
| **地面比天空暗** | 三图一律保持 `hemi.ground` 明度 < `hemi.sky` 明度，否则人物脚下发飘。 |
| **中性灰锚点** | 每张图必须存在一处接近中性灰的表面（道路/混凝土掩体），作为玩家眼睛的白平衡参考，防止整图偏色到无法判读血条/HUD。 |
| **据点色不参与主题化** | 红/蓝/中立三态色由 `accessibility.md` 统一规定，**任何主题都不得覆盖**。 |

### 0.1 雾距公式（可推广到任意 `size`）

令地图对角线 `Dg = size × 1.414`（size=300 → Dg ≈ 424）。

| 主题气质 | `fog.near` | `fog.far` | 说明 |
|---------|-----------|-----------|------|
| 开阔白天（suburb） | `0.19 · Dg` | `0.80 · Dg` | 现值 80 / 340 —— 基准，勿动 |
| 夜景/浓雾（port） | `0.08 · Dg` | `0.40 · Dg` | 雾更近更浓，压缩可视纵深，制造压迫感 |
| 干热远景（desert） | `0.25 · Dg` | `1.01 · Dg` | 近处几乎无雾、远处才洗白 → 「远雾」 |

**硬下限**：`fog.far ≥ 120`（低于此值玩家无法从据点看到下一个据点，导航崩溃 —— 见 `accessibility.md`）。

### 0.2 光比与曝光

| 主题 | hemi | sun | ambient | 亮部:暗部 ≈ | 气质 |
|------|------|-----|---------|------------|------|
| suburb | 0.85 | 1.40 | 0.25 | 2.4 : 1 | 阴天偏晴的中性白天 |
| port | 0.55 | 0.50 | 0.45 | 1.5 : 1 | 低照度、低对比、靠人工光点提亮 |
| desert | 1.00 | 1.55 | 0.50 | 3.1 : 1（近景）<br>远景被雾压到 1.2 : 1 | 强直射 + 强地面反弹 → 近硬远软 |

> desert 的「低对比」指的是**远景低对比**（大气散射洗白），近景仍是硬光硬影。实现手段是「高 ambient + 暖色 hemi.ground（地面反弹）+ 远雾」，不是把太阳调弱。

---

## 1. suburb 城郊战场（基准 · 冷调白天）

**一句话**：欧洲近郊的阴天午后，冷灰蓝的天光、湿润的草地、红砖与混凝土，一切都很「正常」——它是玩家校准眼睛的参照系。

### 1.1 env（现值，保持不动）

```js
env: {
  fog:        { color: 0x8fb4cc, near: 80, far: 340 },
  background: 0x8fb4cc,
  hemi:       { sky: 0xdfe9ff, ground: 0x3d4a3a, intensity: 0.85 },
  sun:        { color: 0xfff2d8, intensity: 1.4, pos: [120, 160, 80],
                shadow: { mapSize: 1024, extent: 130, far: 400 } },
  ambient:    { color: 0x8899aa, intensity: 0.25 }
}
```

⚙ **唯一建议修改**（属 D-05 全局修复，不改观感）：
```js
  sun: { ..., target: [150, 150], shadow: { mapSize: 2048, extent: 186, far: 460 } }
```
`extent = size × 0.62`，`mapSize 2048` → 阴影贴图密度 0.18 m/texel（1024 时为 0.36 m/texel，边缘锯齿明显）。

### 1.2 色板

| 角色 | 色值 | 用途 |
|------|------|------|
| 天空/雾 | `#8fb4cc` | background + fog |
| 草地主 | `#4a6b3c` / `#5c6e52` | `terrain.colors` |
| 沥青 | `#3a3d42`（`Tex.asphalt`） | 道路 |
| 红砖 | `#7a3b2e`（`Tex.brick`） | 墙面 |
| 混凝土 | `#6d7075`（`Tex.concrete`） | 精修线脚 · **中性灰锚点** |
| 废墟 | `#6b645c` / `#544e48` | `ruins.wallColor` / `rubbleColor` |
| 标线 | `#d8d8c0` | `roads.markColor` |

### 1.3 纹理与数据

| 字段 | 值 |
|------|---|
| `terrain.colors` | `[0x4a6b3c, 0x5c6e52]`，⚙ `colorMix` 建议改用噪声驱动恢复斑驳（T-06） |
| `roads.tex` | `asphalt`，`repeat: 40` |
| `buildings[].tint` ⚙ | 不设（原色即基准） |
| `props` | `lamps`（白天不发光，OK）、`trees`（`#2f5d33` 树冠）、`towers` |

---

## 2. port 军港夜战（冷蓝夜景 · 工业 · 近浓雾）

**一句话**：凌晨三点的集装箱码头。海雾贴着地面，钠灯把锈铁染成橙色，一切蓝黑之中只有几团暖光和红蓝据点色——**这张图靠光点导航，不靠地形**。

### 2.1 env（建议值，size = 300）

```js
env: {
  fog:        { color: 0x16202e, near: 34, far: 170 },
  background: 0x0d1521,                                  // 天空比雾更暗 → 建筑呈剪影
  hemi:       { sky: 0x33496b, ground: 0x11161c, intensity: 0.55 },
  sun:        { color: 0x8fb0dd, intensity: 0.50,        // 月光：冷、弱、方向感弱
                pos: [-100, 150, -70], target: [150, 150],   // ⚙ target 需 T-04
                shadow: { mapSize: 2048, extent: 186, far: 460 } },
  ambient:    { color: 0x3a5478, intensity: 0.45 }       // 抬黑位：暗部不死黑（可访问性硬要求）
}
```

**设计说明**：
- `background` 比 `fog.color` 暗 3 档 → 建筑顶部切进深色天空形成清晰剪影，同时地面附近被较亮的雾托起，产生「海雾贴地」的层次。
- `ambient` 反常地高（0.45 vs suburb 0.25）：**这是可访问性要求，不是审美失误**。夜景的黑必须是「蓝黑」不是「死黑」，否则暗处的敌人完全不可见，对局变成运气。
- `sun.intensity 0.50` + 反向光位（`-100,150,-70`，与 suburb 相反）→ 影子朝另一侧，进一步强化「不是同一张图」。

### 2.2 探照灯感 —— 三条实现路径（按成本排序）

| 路径 | 做法 | 成本 | 优先级 |
|------|------|------|-------|
| **A · 零改动** | ① `props.lamps` 密布在码头边与据点周围（12–16 盏）<br>② 地面用 `roads.marks` 机制画暖黄「光斑」矩形（`MeshBasicMaterial` 不受光，夜里照样亮）<br>③ 标线色改 `0xffe08a` 当导航引导线 | 0 | **P0** |
| **B · 静止光柱**（推荐） | 从高处塔顶向下投一个 `CylinderGeometry`（上细下粗）+ `MeshBasicMaterial({color:0xffe4b0, transparent:true, opacity:0.06, depthWrite:false})`。零光源、零阴影开销，视觉上就是探照灯光锥 | 极低（需 ⚙ 新增 `props.lightShafts[]`） | **P1** |
| **C · 真 SpotLight** | `env.spots[]` → `THREE.SpotLight`，`castShadow: false`，**上限 4 盏** | 中（⚙ T-05） | **P1** |
| **D · 扫射动画** | 每帧旋转光锥 | 高（需主循环挂钩） | **P2**，不建议首版做 |

> ⚠ **前置阻塞**：路径 A/C 都依赖路灯灯泡可见。当前 `buildProps` 的 bulb 用 `MeshLambertMaterial` → 夜景下是个暗黄小球，等于没有灯（backlog **D-12**）。**必须先把 bulb 改成 `MeshBasicMaterial`**，这是 port 主题的硬前置。

### 2.3 色板

| 角色 | 色值 | 说明 |
|------|------|------|
| 夜雾 | `#16202e` | fog |
| 夜空 | `#0d1521` | background |
| 码头混凝土 | `#2f3740` / `#3a444e` | `terrain.colors` · **中性锚点** |
| 钢构/锈 | `#4d5258`（`Tex.metal`）→ 锈色 `#7a4a32` ⚙ | 龙门吊、栈桥 |
| **钠灯暖橙** | `#ffb64d` | 唯一暖色，用于灯泡/光斑/警示条。**是全图的视觉锚点** |
| 高亮标线 | `#ffe08a` | `roads.markColor`，兼作导航引导线 |
| 废墟/水泥块 | `#4a5460` / `#39424c` | `ruins` |
| 集装箱 A 区 | `#2f6f8f` 蓝 | **色区导航**：A 据点周边只用这一色 |
| 集装箱 B 区 | `#b4442f` 锈红 | B 据点周边 |
| 集装箱 C 区 | `#d1a02c` 黄 | C 据点周边 |
| 集装箱 D 补色 | `#3f7a4a` 绿 | 中间地带点缀 |

> **色区导航**是 port 的核心可读性设计：夜里地形辨识失效，玩家靠「我在蓝色箱区 = 靠近 A 点」定位。三个区色相拉满 90° 以上，且明度各不相同（见 `accessibility.md` §3）。

### 2.4 纹理与数据建议

| 字段 | 建议值 | 备注 |
|------|-------|------|
| `terrain.colors` | `[0x2f3740, 0x3a444e]` | 码头是硬质铺装，不是草地 |
| `terrain.amp` | `1.2`（比 suburb 的 4.4 平得多） | 码头应平整；起伏留给货堆 |
| `roads.tex` | `asphalt`，`repeat: 50` | |
| `roads.markColor` | `0xffe08a` | 不受光，夜间导航主力 |
| `ruins.wallColor` / `rubbleColor` | `0x4a5460` / `0x39424c` | |
| proc 建筑 `wallTex` | `concrete`；⚙ 有 `corrugated` 后改用 | 波纹钢是港口的标志性材质 |
| proc 建筑 `roofTex` | `metal` | |
| `detailTex` | `concrete` | |
| model 建筑 `tint` ⚙ | warehouse `0x8fa0ad`、apartment `0x8c97a3`、house `0x9aa3ab` | 统一压向冷灰蓝，抹掉 suburb 的暖砖色 |
| 集装箱 | 用 `cover` 的 `{t:'box', mat:'metal'}` 堆叠即可，⚙ 若支持 `color` 字段则按色区上色 | 零新增几何 |
| `props.lamps` | 12–16 盏，沿码头边 + 据点四周 | 见 §2.2 前置 |

### 2.5 TEXTURE_OVERRIDES（在线增强，可选）

```js
window.TEXTURE_OVERRIDES = {
  metal:    '/textures/port_corrugated.jpg',
  concrete: '/textures/port_concrete_wet.jpg',
  asphalt:  '/textures/port_dock.jpg'
};
```
> ⚠ 与 GLB 同属**在线增强**：`file://` 下 `<img>` 跨源污染会让 WebGL `texImage2D` 失败，离线基线**必须**能靠程序化纹理独立成立。

---

## 3. desert 沙漠据点（暖橙日照 · 远雾 · 热浪）

**一句话**：正午的中东边境小镇。太阳在头顶砸下来，影子又短又硬，远处 200m 外的一切都被热气洗成同一片米黄——**这张图的敌人藏在低对比度里，不是藏在暗处**。

### 3.1 env（建议值，size = 300）

```js
env: {
  fog:        { color: 0xd9c39c, near: 105, far: 430 },  // 远雾：近处通透、远处洗白
  background: 0xe6d4ae,                                   // 天空比雾更亮 → 地平线发光
  hemi:       { sky: 0xffeccd, ground: 0x9a7a4e, intensity: 1.00 },  // ground 亮 = 沙地强反弹
  sun:        { color: 0xffd9a3, intensity: 1.55,
                pos: [40, 210, 120], target: [150, 150],  // ⚙ 高角度 → 短硬影（正午）
                shadow: { mapSize: 2048, extent: 186, far: 480 } },
  ambient:    { color: 0xc8a473, intensity: 0.50 }        // 暖色补光，压低近景反差
}
```

**设计说明**：
- `sun.pos` 的 Y 抬到 210（suburb 是 160）→ 太阳角约 63°，投影长度约为建筑高的 0.5 倍 → 正午感。
- `hemi.ground = 0x9a7a4e` 明度高：沙地把光反弹回建筑背面，这是沙漠场景最关键的一笔，缺了它建筑背面会变成脏灰。
- `background` 比 `fog` 亮：地平线附近最亮 → 天然的「热气蒸腾」错觉，零成本。

### 3.2 热浪感 —— 无后处理管线下的替代方案

项目没有 EffectComposer/后处理，**不做屏幕空间扭曲**。替代手段：

| 手段 | 做法 | 成本 | 优先级 |
|------|------|------|-------|
| 地平线过曝 | `background` 亮于 `fog`（已在 §3.1 中） | 0 | **P0** |
| 远景色相收敛 | 让 `fog.color`、`terrain.colors[1]`、建筑 `tint` 在 200m 外趋同 → 远处一切「糊成一片米黄」 | 0 | **P0** |
| 地面反光带 ⚙ | 在 `y = 0.05` 放 2–4 片超大水平面（`MeshBasicMaterial`, `opacity 0.05`, 暖白），只在远处生效 | 低（需 `props.heatBands[]`） | **P2** |
| 顶点抖动 shader | 否决：需自定义材质，破坏 Lambert 统一管线 | 高 | ✗ |

### 3.3 色板

| 角色 | 色值 | 说明 |
|------|------|------|
| 天空 | `#e6d4ae` | background |
| 远雾 | `#d9c39c` | fog |
| 沙地亮 / 暗 | `#c2a26a` / `#b08f57` | `terrain.colors` |
| 沙地阴影 | `#8a6f47` | `hemi.ground` 附近 |
| 土坯墙主 | `#cbb188` | 建筑主色（⚙ tint） |
| 土坯墙次 | `#b89b72` | 变化 |
| 木梁/门框 | `#6b5238` | 挑檐、门窗框 |
| **松石绿强调** | `#4f9a8e` | 门窗扇、遮阳布 —— 与橙沙**互补色**，是全图唯一冷色，辨识度极高 |
| 褪蓝强调 | `#6e93a8` | 次级点缀 |
| 混凝土 | `#8e8574` | **中性锚点**（比 suburb 的灰更暖） |
| 废墟 | `#9c8763` / `#877352` | `ruins` |
| 褪色标线 | `#e8d9b0` | `roads.markColor` |

> **松石绿是 desert 的功能色**：在满屏橙黄中，玩家的眼睛会自动锁定冷色。把它用在**门窗**上 → 玩家一眼看出「哪里能进人」，这是纯美术手段解决的关卡可读性问题。

### 3.4 纹理与数据建议

| 字段 | 建议值 | 备注 |
|------|-------|------|
| `terrain.colors` | `[0xc2a26a, 0xb08f57]` | ⚙ 配合 T-06 噪声混色做沙纹 |
| `terrain.amp` | `6.0`（比 suburb 大）+ 多个 `mounds` | 沙丘起伏是主题识别的一半 |
| `roads.tex` | ⚙ 新增 `sand`/`dirt` 后改用；临时 `asphalt` + `markColor 0xe8d9b0` | 土路比柏油更贴主题 |
| `ruins.wallColor` / `rubbleColor` | `0x9c8763` / `0x877352` | 沙漠废墟必须偏暖 |
| proc `wallTex` | ⚙ `plaster`；临时 `concrete` | **不要用 `brick`**（红砖会立刻把主题拉回欧洲） |
| proc `roofTex` | `roof`（灰）→ ⚙ 建议 `plaster` 平屋顶 | 中东民居是平屋顶 |
| `detailTex` | `concrete` | |
| model `tint` ⚙ | warehouse `0xd8c49a`、apartment `0xd0b58c`、house `0xe0cba4` | 统一压向土黄 |
| `props.trees` | 数量减到 2–4，且叶色改 `0x6b7a3f`（枯黄棕榈感）⚙ | 现叶色 `0x2f5d33` 硬编码在 `world.js`，需参数化 |
| `props.lamps` | 少量或不用（白天） | |

---

## 4. 三图参数速查对照表

| 参数 | suburb | port | desert |
|------|--------|------|--------|
| `fog.color` | `0x8fb4cc` | `0x16202e` | `0xd9c39c` |
| `fog.near / far` | 80 / 340 | **34 / 170** | **105 / 430** |
| `background` | `0x8fb4cc` | `0x0d1521`（暗于雾） | `0xe6d4ae`（亮于雾） |
| `hemi.sky` | `0xdfe9ff` | `0x33496b` | `0xffeccd` |
| `hemi.ground` | `0x3d4a3a` | `0x11161c` | `0x9a7a4e` |
| `hemi.intensity` | 0.85 | 0.55 | 1.00 |
| `sun.color` | `0xfff2d8` | `0x8fb0dd` | `0xffd9a3` |
| `sun.intensity` | 1.40 | **0.50** | **1.55** |
| `sun.pos` | `[120,160,80]` | `[-100,150,-70]` | `[40,210,120]` |
| `ambient.color` | `0x8899aa` | `0x3a5478` | `0xc8a473` |
| `ambient.intensity` | 0.25 | **0.45** | **0.50** |
| `terrain.colors` | `[0x4a6b3c,0x5c6e52]` | `[0x2f3740,0x3a444e]` | `[0xc2a26a,0xb08f57]` |
| `terrain.amp` | 4.4 | 1.2 | 6.0 |
| `roads.markColor` | `0xd8d8c0` | `0xffe08a` | `0xe8d9b0` |
| `ruins.wallColor` | `0x6b645c` | `0x4a5460` | `0x9c8763` |
| 强调色 | 无（中性） | 钠灯橙 `#ffb64d` | 松石绿 `#4f9a8e` |
| `detail` | high | high | high |
| ⚙ `sun.target` | `[150,150]` | `[150,150]` | `[150,150]` |
| ⚙ `shadow.extent / mapSize` | 186 / 2048 | 186 / 2048 | 186 / 2048 |

---

## 5. 主题化的红线（任何调整都不得突破）

1. **`fog.far ≥ 120`** —— 否则据点间失去视觉联系，玩家迷路。
2. **`ambient.intensity ≥ 0.30`** —— 否则暗部死黑，藏在阴影里的敌人不可见，对局失去公平性。
3. **建筑与背景的明度差 ≥ 0.15**（相对亮度 Y 计）—— 否则剪影消失。port 是唯一逼近红线的图，务必用 §2.1 的 `background` 暗于 `fog` 的手法保住剪影。
4. **据点红/蓝/中立三态色不得被主题覆盖**，且必须使用 `MeshBasicMaterial`（不受光）—— 见 `art/accessibility.md`。
5. **每张图必须有中性灰锚点表面**（见 §0）。
6. **不新增建筑体量** —— 主题化只能通过 env / tint / 纹理 / props 实现。

---

## 6. 交付给工程的落地顺序（建议排期）

| 顺序 | 事项 | 阻塞什么 | 优先级 |
|------|------|---------|-------|
| 1 | `env.sun.target` + `extent`/`mapSize` 提升（T-04 / D-05） | **三图全部**：现在 60% 区域无阴影 | **P0** |
| 2 | `buildings[].tint`（T-01 / D-15） | port / desert 的主题识别度 | **P0** |
| 3 | 路灯 bulb 改 `MeshBasicMaterial`（D-12） | port 夜景 | **P0** |
| 4 | 据点旗改 `MeshBasicMaterial`（D-13） | port 夜景可访问性 | **P0** |
| 5 | 新增纹理 key `sand`/`plaster`/`corrugated`/`rust`（T-02） | desert / port 的材质说服力 | **P1** |
| 6 | `env.spots[]` 或 `props.lightShafts[]`（T-05） | port 探照灯感 | **P1** |
| 7 | `props` 的树叶色/灯光色参数化 | desert 植被 | **P2** |
| 8 | `mapDef.textures` per-map 覆盖（T-03） | 在线增强路径 | **P2** |
