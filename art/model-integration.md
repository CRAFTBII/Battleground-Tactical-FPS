# 新 BuildingLib 类型接入规范（美术圣经 · 附录 G）

> 项目：战地突击 Battleground Tactical FPS（Three.js r160）
> 对应实现：`js/models.js` BuildingLib（CONFIGS + BUILDINGS_OUT）、`js/world.js` placeModelBuilding、各 `js/maps/*.js` buildings
> 关联：`art/theme-atmosphere.md`（tint/纹理按图）、`art/procedural-textures.md`（新增 key）、`art/glb-slot-conventions.md`（剪影等价原则）
> 范围：v1.2 新增 9 型（bunker/hangar/pillbox/tower/wall/bridge/stairs/container/ruins），其中 **7 型已进三图数据**（tower/wall/container/ruins/bunker/hangar/pillbox），bridge/stairs 待定。
> 本文档只给美术规范，不改代码。

---

## 1. 各类型定位速查（体量 → 该挂哪些纹理/trim）

| 类型 | 标称 w×d×h（GLB 实测） | 定位 | trim 建议 | detail 建议 |
|------|------------------------|------|-----------|-------------|
| bunker | 18×14×8 | 中大型碉堡，顶台可站 | 檐口 + 女儿墙压顶（低矮厚重，不做角柱） | high 全开 / low 砍女儿墙 |
| hangar | 40×24×12 | 超大型机库，卷帘门可进 | 檐口 + 屋顶桁架线脚（视觉桁架已内联） | high；low 时保留体量 |
| pillbox | 12×12×5 | 小型哨楼，顶射击位 | **trim:false**（体量小，精修无收益） | high/low 同（无 trim） |
| tower | 18.6×18.6×100 | 超高视觉地标（摩天楼） | **trim:false**（纯视觉高柱，碰撞只到 18.5 平台） | high；low 时**必须保留**（导航地标） |
| wall | 37.5×1.4×4.8 | 低矮残墙掩体 | **trim:false** | 全档同 |
| bridge | 30×7×10 | 过街桥（两端桥墩 + 桥面） | **trim:false**（桥面/栏杆已内联） | 全档同 |
| stairs | 12×12×13 | 阶梯塔（纯垂直机动） | **trim:false** | 全档同 |
| container | 16.2×8.4×5 | 货柜组（色区导航载体） | **trim:false** | 全档同 |
| ruins | 33×16×28.5 | 战损残楼（碰撞只到 12m） | **trim:false**（残破顶已内联） | 全档同 |

> **规则 M-1（新类型 trim 从简）**：新 9 型里除 bunker/hangar 外一律 `trim:false`——它们的剪影价值来自**本体轮廓**（残墙/桁架/桥栏/货柜），程序化精修外挂件只会画蛇添足。bunker/hangar 给檐口是为了强化「厚重顶面」的可读性。

---

## 2. tint / 纹理映射表（写 mapDef 照抄）

tint 规则沿用 `procedural-textures.md` §4：**RGB 通道落在 [0.55, 0.90]**，`0xffffff` = 不染色；纹理 key 未实现前静默回退 concrete（不崩，观感偏灰）。

| 类型 | **suburb**（基准，不染色） | **port**（冷压：锈蚀/波纹） | **desert**（暖推：沙/灰泥） |
|------|--------------------------|---------------------------|---------------------------|
| bunker | `0xffffff` | tint `0x8a9299` · 墙面 `corrugated`+锈斑 `rust` 底部 | tint `0xcbb188` · 墙面 `plaster` |
| hangar | `0xffffff` | tint `0x7d8a94` · 墙面 `corrugated` · 屋顶 `corrugated` | tint `0xd8c49a` · 墙面 `plaster` |
| pillbox | `0xffffff` | tint `0x99a3ab` · `concrete`（中性锚点，少锈） | tint `0xd0b58c` · `plaster` |
| tower | `0xffffff` | tint `0x8c98a2` · 窗户暗腔 `rust` 边框 | tint `0xc9b082` · `plaster` |
| wall | `0xffffff` | tint `0x6e7880` · `concrete` + 顶部 `rust` | tint `0x9c8763` · `plaster` |
| bridge | `0xffffff` | tint `0x6e7880` · `rust` 栏杆 | tint `0x9c8763` · `concrete` 桥面 |
| stairs | `0xffffff` | tint `0x7d8a94` · `corrugated` | tint `0xc9b082` · `plaster` |
| container | `0xffffff` | **色区导航色**（A 蓝 `0x2f6f8f` / B 锈红 `0xb4442f` / C 黄 `0xd1a02c`，见 theme §2.3） | tint `0x8a6f4a`（木箱/货柜统一） |
| ruins | `0xffffff` | tint `0x7a8389` · `concrete` + `rust` 断口 | tint `0x8d7c5c` · `plaster` 残墙 |

**关键原则**：
- **cover 与 container 永不参与主题 tint**：cover 是中性锚点（procedural-textures §4.3 硬规则）；container 是 port 色区导航载体，**tint 必须与据点色区一致**，否则色区语义崩溃。
- port 的锈蚀来源：优先用 `rust` 纹理（底部锈线）而非整面 tint 锈色；`corrugated` 是仓库/机库主墙材。
- desert 不要用 `brick`（红砖立刻把主题拉回欧洲）；墙面一律 `plaster`。

---

## 3. 接入注意（与工程对齐）

1. **轴与缩放**：BUILDINGS_OUT 数据为 Z-up（x 宽/y 深/z 高），`BuildingLib.build` 已做 `geo.rotateX(-90°)` 高朝上；新类型按 mapDef 的 `w/d/h` 缩放（`dims` 参数），**碰撞/平台随缩放**。mapDef 写 `w/d/h` 必须等于 GLB 标称，偏差 >5% 会被拉伸变形。
2. **碰撞口径**：新类型 CONFIGS 的碰撞已是「视觉本体截断」策略——tower/ruins 的 100m/28.5m 高柱体**只碰撞到平台/残墙高**，避免封死导航。美术侧不要给 tower/ruins 加高碰撞。
3. **细节等级**：tower 在 `?detail=low` 下也必须渲染（它是 desert 导航地标），engine 需保证 BUILDINGS_OUT 建筑不受 detail=off 隐藏（或至少 tower 例外）。
4. **GLB 插槽**：这些类型**已内联**（BUILDINGS_OUT），不再走外部 GLB 插槽；外部 `glb:` 字段仅用于「在线增强替换」，需满足 glb-slot §5.1 剪影等价（体量偏差 ≤10%、平台/门洞一致）。

---

## 4. battle_map.glb 美术视角评估

- **它是什么**：`models/out/battle_map.glb` = 200×200×19.6m 的**整张迷你场景**（地面 + 1 warehouse + 1 apartment + 3 house + 2 watchtower + 3 cover 组 + 散掩体），1696 tris / 842 顶点、无材质无贴图、Z-up。它是一张**独立小图草模**，不是地形或装饰层。
- **建议用途**：**不作为任何一图的地面装饰层/背景**。理由：① 与三图现有 terrain/roads/props 体系重复且冲突（自身已是完整场景）；② 无碰撞数据，直接摆会穿模；③ 200×200 尺寸与三图（300/260/340）不匹配，缩放必变形。**唯一可行用途**：拆件复用（其内部 warehouse/house/apartment/watchtower 已分别内联进 BUILDINGS_OUT，无需整图挂载）；或留作未来「第四图」布局草模参考。
- **风险**：性能极低（<2k tris）无压力；主要风险是**风格不一致**（灰绿营地色调与三图主题都不符）与**碰撞缺失**；轴需 rotateX(-90°) 才立起。
