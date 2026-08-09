# ADR-002 · 地图数据以 JS 模块注册（window.MapRegistry），不使用 fetch 加载 JSON

| 项 | 内容 |
|----|------|
| 状态 | **已接受（Accepted）** |
| 日期 | 2026-08 |
| 范围 | 地图数据的载体与加载方式、离线分发 |
| 关联 | `map-architecture.md` §7；ADR-001（数据驱动）；本仓库「离线即玩」硬约束 |

---

## 1. 上下文（Context）

项目核心卖点是**「双击 `index.html`（`file://`）即玩」**，无构建步骤、无本地服务器。

浏览器在 `file://` 协议下对 `fetch('maps/suburb.json')` 会返回 opaque response 或直接拒绝（CORS / 同源策略对 `file:` origin 的处理），导致：
- 任何「运行时 fetch 本地 JSON」的地图加载方案在离线场景**直接崩**。
- 即使把 JSON 内联到 `<script type="application/json">` 再 `JSON.parse`，也能用，但和「JS 模块直接注册」相比无优势且多一道解析。

因此地图数据载体必须在「离线可用」「同步可用」「零网络」三者间取舍。

## 2. 决策（Decision）

- 地图数据一律以 **`<script>` 引入的 JS 模块**形式写入 `window.MapRegistry`：
  - `js/maps/registry.js` 定义 `MapRegistry`（注册/校验/`get`/`list`/`setDefault`）。
  - 每张地图一个 `js/maps/<id>.js`，IIFE 内调 `MapRegistry.register({...mapDef})`。
- **禁止使用** `fetch` / `XHR` / 动态 `import()` 加载地图数据。
- `index.html` 中 `registry.js` 必须先于各地图文件、各地图文件必须先于 `world.js`（已在 HTML 注释硬约束）。
- 若未来在线分发多地图，可新增「在线清单 + JS 动态注入」路径，但**不破坏当前离线契约**。

## 3. 备选方案（Alternatives Considered）

| 方案 | 取舍 |
|------|------|
| A. `fetch('maps/*.json')` | **拒绝**：`file://` 下被浏览器 CORS 拒绝，离线即崩，违反硬约束。 |
| B. `<script type="application/json">` + `JSON.parse` | 可行但冗余：需 DOM 查询 + 解析，且仍不如直接调 `register` 简洁；无注册期校验。 |
| C. JS 模块写入 `window.MapRegistry`（**采纳**） | 离线可用、同步、零网络、可注册期 `validate`、无解析步骤。 |
| D. 动态 `import()` / ESM | **拒绝**：主代码 UMD 全局，无 importmap；`file://` 下动态 import 仍受 CORS 限制，且破坏单一全局命名空间约定。 |

## 4. 后果（Consequences）

**正面**
- 完全满足离线即玩：`file://` 双击直接注册地图，无网络请求。
- 注册期校验：坏图 `register` 失败仅 warn，不抛异常、不拖垮整局。
- 加载顺序简单可验证（`registry → 地图 → world`，注释标注）。

**负面 / 代价**
- 地图数据不是「纯 JSON」，而是 JS 对象字面量——对纯 JSON 工具链（如某些外部编辑器导出）需一层转换。可接受（数据形状一致）。
- 全局命名空间 `window.MapRegistry`：需保证 IIFE 注入顺序（已用注释+加载序约束）。
- 地图数据随 JS 打包，无法像 JSON 那样被 CDN 单独缓存——但离线项目本就不依赖 CDN。

## 5. 遵循 / 违反信号

- ✅ 新地图 = `js/maps/<id>.js` 调 `MapRegistry.register`。
- ✅ `index.html` 中地图脚本列于 `world.js` 之前。
- ❌ 在任何地方 `fetch('...json')` 加载地图。
- ❌ 把地图文件命名为 `.json` 并试图运行时加载。
