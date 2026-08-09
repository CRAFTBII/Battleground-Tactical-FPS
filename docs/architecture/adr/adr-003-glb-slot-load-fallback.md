# ADR-003 · 建筑 GLB 插槽：加载 + 回退策略（碰撞/导航始终来自程序化数据）

| 项 | 内容 |
|----|------|
| 状态 | **已接受（Accepted）** |
| 日期 | 2026-08 |
| 范围 | 外部 `.glb` 建筑视觉接入、离线/失败回退、`BuildingLib` 内联数据 |
| 关联 | `map-architecture.md` §6；ADR-002（离线约束）；`js/models.js`「加载+回退」范式 |

---

## 1. 上下文（Context）

美术侧（Task #3）将提供主题化建筑外观，可能以外部 `.glb` 形式交付；同时项目强调「**零外部资源默认**」——双击即玩的基线必须不依赖任何外部文件。

需要回答：
- GLB 何时加载、何时不加载？
- GLB 加载失败时游戏是否崩溃？
- GLB 是否影响碰撞/导航/小地图（玩法公平性）？

复用既有范式：`js/models.js` 的 `ModelLib`/`BuildingLib` 已采用「GLTFLoader 加载 + 失败回退程序化几何」，`BuildingLib` 用**内联 GLB 数据**（无外部文件）构建建筑主体与碰撞。

## 2. 决策（Decision）

- 建筑主体默认走 `BuildingLib`（**内联 GLB 数据**，零外部文件），碰撞/平台来自其 `colliders`。
- 外部 `.glb` 作为 **opt-in 视觉插槽**：在 mapDef 建筑上设可选 `glb` 字段（URL）。
- **启用判定**（`GLBSlots.enabled()`）三条件任一为 false 即不加载、直接回退：
  1. `THREE.GLTFLoader` 未挂全局（纯程序化项目）；
  2. `location.protocol === 'file:'`（离线双击）；
  3. URL 含 `noglb=1`（调试开关）。
- **加载成功**：按 `glbFit` 缩放并角点对齐、应用 `ry`；将程序化视觉组 `vis.visible=false`，GLB 仅替换外观。**碰撞/导航/小地图数据完全不变**（来自 mapDef 的 `w/d/h` 或 `BuildingLib`）。代际检查 `gen !== self._gen` 丢弃换图后迟到的结果。
- **加载失败 / 未启用**：**静默保留程序化建筑**（仅 `console.log`），不抛异常、不中断构建。
- **`BuildingLib` 缺失/数据损坏**：`placeModelBuilding` 用占位实心盒（保碰撞与导航成立）。
- 建筑**程序化精修外挂件**（`buildModelTrim`：檐口/角柱/分缝/烟囱）始终基于程序化几何生成，不依赖 GLB；合批为单 mesh。

## 3. 备选方案（Alternatives Considered）

| 方案 | 取舍 |
|------|------|
| A. GLB 强制加载（无回退） | **拒绝**：离线/缺文件即崩，违反「离线即玩」「零外部资源默认」。 |
| B. GLB 替换碰撞体（用模型包围盒做碰撞） | **拒绝**：外部模型碰撞不可控，破坏玩法公平性/导航一致性；与「数据驱动碰撞」相悖。 |
| C. GLB 仅视觉 + 程序化碰撞 + 三级回退（**采纳**） | 视觉增强与玩法数据解耦；离线/失败均优雅回退；复用 `models.js` 范式一致。 |
| D. 全程序化、不接 GLB | 可行但放弃美术增强空间；保留插槽（opt-in）零成本，故采纳 C 而非 D。 |

## 4. 后果（Consequences）

**正面**
- 离线（`file://`）/未引 `GLTFLoader` 一律程序化，保证「双击即玩」永不因 GLB 失败。
- 碰撞/导航/小地图与外观解耦：GLB 是纯增强，不影响平衡与 AI。
- 回退链完整：`MapRegistry` → `World.load`(validate) → `placeModelBuilding`(BuildingLib 缺失) → `glbSlot`(GLB 失败)，任一环坏都不崩。
- 换图安全：`_gen` 代际检查防止旧图 GLB 串入新图。

**负面 / 代价**
- GLB 仅在「在线 + 已引入 GLTFLoader」时生效——美术提供的 `.glb` 需配服务器预览（本地起 http）或在线上环境验证。
- GLB 缩放/对齐逻辑（`glbFit` uniform 与否）需按美术交付物校准，可能需逐建筑微调。
- `vis.visible=false` 后程序化视觉仍在场景图中（不可见但占一点开销），可接受。

## 5. 遵循 / 违反信号

- ✅ 设 `glb` 字段时碰撞/导航仍由程序化数据提供。
- ✅ GLB 失败静默回退，构建不中断。
- ✅ 离线/`noglb=1`/无 loader → 自动回退程序化。
- ❌ 用 GLB 包围盒覆盖 `colliders`/`platforms`。
- ❌ 在 `file://` 下期望 GLB 加载成功。

---

## 6. 追加决策记录（2026-08 · GLB 插槽暂休眠）

**背景**：`index.html` 未引入任何 GLTFLoader；Three.js r160 的 GLTFLoader 位于 `examples/jsm`，为 **ESM-only（无 UMD 构建）**；本项目无构建步骤 + 离线约束（`file://` 双击即玩）。

**决定**：GLB 插槽保持**休眠**——`GLBSlots.enabled()` 在「未引 GLTFLoader / `file://` / `noglb=1`」时恒 false，所有建筑走程序化几何。proc/model 路径均已接线 `glbSlot` 占位插槽（proc 钩子已补），缺资产自动静默回退，不影响玩法与构建。

**启用条件**：需引入构建/importmap 将 GLTFLoader 打包为可用模块，并**另立 ADR**；在那之前 `glb:` 字段只是占位声明。

**验证**：三图（suburb/port/desert）无 GLB 资产时冒烟与 `World.load` 全绿；`?noglb=1` 与 `file://` 行为一致（全程序化）。

