# ADR-001 · 地图采用数据驱动（mapDef + 通用构建器）而非硬编码

| 项 | 内容 |
|----|------|
| 状态 | **已接受（Accepted）** |
| 日期 | 2026-08 |
| 范围 | `js/world.js` 地图构建体系、新增地图工作流 |
| 关联 | `map-architecture.md` §1/§3；ADR-002（数据载体）；ADR-003（GLB 插槽） |

---

## 1. 上下文（Context）

重构前 `js/world.js` 把整张 300×300 城郊战场**硬编码**在 `World.init` 里：地形种子、土丘、压平区、道路、11 栋建筑、24 个掩体、废墟、装饰、3 个据点、出生点全部是字面量。问题：

- 新增一张地图 = 改 `world.js` 大段代码，易引入回归、难以 code review。
- 美术/策划无法独立于程序修改布局（需读懂 Three.js 代码）。
- 缺乏统一 schema，难以自动校验「据点是否恰好 3 个」「出生点是否非空」。
- 后续 Task #4 要新增 2 张地图，若继续硬编码，工作量与风险翻倍。

## 2. 决策（Decision）

采用**数据驱动**：

- 一张地图 = 一份声明式数据对象 `mapDef` + 一组**通用构建器**（`World.load` 及其 `build*` 子函数）。
- `World.init(scene, mapId)` 改为便捷封装：从 `MapRegistry` 取图后调用 `World.load(scene, mapDef)`。
- 新增地图 = 新建 `js/maps/<id>.js`，声明数据并 `MapRegistry.register(def)`，**不修改 `world.js` 构建逻辑**。
- 保留 `World.init` 作为向后兼容入口（main.js 仍调 `World.init(scene)`）。

## 3. 备选方案（Alternatives Considered）

| 方案 | 取舍 |
|------|------|
| A. 维持硬编码（每图一份 `world-<id>.js`） | 拒绝：复制粘贴式扩展，回归风险高，无统一校验，违背后续多图规划。 |
| B. 数据驱动 + JSON 文件（fetch 加载） | 拒绝：违反离线即玩硬约束（`file://` 下 fetch 本地 JSON 被浏览器拒绝）。见 ADR-002。 |
| C. 数据驱动 + JS 模块（`window.MapRegistry`） | **采纳**：离线可用、零网络、同步加载、可注册校验。见 ADR-002。 |
| D. 数据驱动 + 运行时 ESM `import()` | 拒绝：主代码是 UMD 全局 `THREE`，无 importmap；且 `file://` 下动态 import 仍受 CORS 限制。 |

## 4. 后果（Consequences）

**正面**
- 新地图零改核心代码，回归面收敛到「数据正确性」。
- `MapRegistry.validate` 在注册期拦截契约违规（3 据点/出生点非空/坐标为数字）。
- 数据可被工具/编辑器生成，策划美术可参与。
- smoke 测试覆盖构建路径，行为可验证（重构后 `node test/smoke.js` 全绿）。

**负面 / 代价**
- `world.js` 体积增大（通用构建器需覆盖所有字段分支）。
- 数据 schema 需文档化并随字段演进维护（本 ADR 配套 `map-architecture.md`）。
- 程序化建筑门洞可通行需 `OVERHEAD_Y` 阈值特殊处理（见架构文档 §4）。

**中性**
- 运行时开销与硬编码相当（构建期一次性生成，无每帧成本）。

## 5. 遵循 / 违反信号

- ✅ 新增地图只写 `js/maps/*.js` 并 `register`。
- ✅ `World.load` 消费 `mapDef` 子字段，各 `build*` 互不耦合。
- ❌ 在 `world.js` 里写死某张图的布局坐标。
- ❌ 改 `world.js` 才能加新地图。
