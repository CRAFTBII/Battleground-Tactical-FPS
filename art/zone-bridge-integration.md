# bridge / stairs 模型接入建议（美术圣经 · 附录 H-2）

> 项目：战地突击 Battleground Tactical FPS（Three.js r160）
> 对应实现：`js/models.js` BuildingLib（`bridge` / `stairs` 已内联，碰撞+平台已定义）、各 `js/maps/*.js` buildings 数组（v1.3 三图接入）
> 关联：`art/model-integration.md`（§1 类型定位 / §2 tint 映射表 / §3 接入注意）、`art/glb-slot-conventions.md`（§5.1 剪影等价）、`art/zone-visual.md`（缩圈与桥梯共存）
> 范围：v1.3 三图各补 bridge / stairs（数量与摆位由 design-strategist 定稿）；本文档只给**美术接入参数**，不改代码。

---

## 0. 一句话

bridge 是「横向过街桥」（30×7×10，桥面 y=10，桥下可通行、桥面可站、两端桥墩 + 四面栏杆）；stairs 是「垂直阶梯台」（12×12×13，四级梯段 + 顶平台 y=13）。两者都已在 `BuildingLib.CONFIGS` 内联（碰撞/平台完备），**接入 = 在 mapDef.buildings 写一条记录 + 按图给 tint/纹理**，零新几何。

---

## 1. 类型速查（沿用 model-integration §1）

| 类型 | 标称 w×d×h | 碰撞/平台现状 | trim 建议 |
|------|-----------|--------------|-----------|
| bridge | 30×7×10 | 桥墩×2 + 桥面 + 栏杆×4；平台 `{x0:0,x1:30, y:10}` | **trim:false**（桥面/栏杆已内联，见 §3） |
| stairs | 12×12×13 | 四级梯段 3.25m×4 + 顶台；平台 `{x0:0,x1:12, y:13}` | **trim:false**（纯垂直机动，见 §3） |

> 坐标语义（与各 mapDef 文件头一致）：`type:'model'` → x/z = **角点**（西南角），ry 一律 0（碰撞盒不随 ry 旋转，本图全部 ry:0）。

---

## 2. tint / 纹理映射表（写 mapDef 照抄）

规则沿用 `procedural-textures.md` §4 / `model-integration.md` §2：RGB 通道落在 [0.55, 0.90]，`0xffffff` = 不染色；纹理 key 未实现前静默回退 concrete（不崩，观感偏灰）。

| 类型 | **suburb（基准）** | **port（冷压：锈蚀/波纹）** | **desert（暖推：沙/灰泥）** |
|------|-------------------|----------------------------|---------------------------|
| **bridge** | `tint: 0xffffff`（不染色，原混凝土桥） | `tint: 0x6e7880` · 桥面 `concrete`（湿混凝土）· **栏杆 `rust`**（锈蚀栏杆，port 标志细节）· 桥墩 `metal` 底座 | `tint: 0x9c8763` · 桥面 `concrete` · **栏杆 `plaster`**（土坯感扶手）· 桥墩 `sand` |
| **stairs** | `tint: 0xffffff`（不染色，原混凝土台） | `tint: 0x7d8a94` · 梯段 `corrugated`（波纹钢台阶，port 材质锚点）· 顶台 `metal` | `tint: 0xc9b082` · 梯段 `plaster`（灰泥台阶）· 顶台 `sand` |

**关键原则（与 model-integration §2 一致）**：
- **suburb 不染色**：基准图，桥/梯就是「正常城市设施」，玩家靠它校准眼睛。
- **port 的锈蚀来源**：优先用 `rust` 纹理（栏杆锈线）而非整面 tint 锈色——桥面/桥墩保持冷灰（`concrete`），只有栏杆锈，符合「钢构锈蚀、路面冷灰」的 port 观感（theme §2.4）。
- **desert 不用 brick**：任何部位禁用 `brick`（红砖把主题拉回欧洲）；桥面/梯段一律 `plaster` 或 `sand`。
- **中性锚点不破坏**：suburb 桥面混凝土是中性灰锚点候选；port/desert 染色后仍需保证图中存在其他中性灰表面（theme §5 红线 5），tint 不得全图过饱和。

---

## 3. trim 用法（天桥栏杆 / 楼梯扶手）

`model-integration.md` §1 已定 bridge/stairs **trim:false**。落地时注意：

1. **不叠加程序化 trim**：bridge 的栏杆已内联（4 面 0.5m 厚栏杆碰撞），stairs 的四级梯段已内联（3.25m×4 碰撞）。任何外挂 trim（额外扶手/檐口/角柱）会与内联碰撞错位（visual 高于碰撞 = 玩家穿模；低于碰撞 = 卡视野）。
2. **「扶手感」靠纹理色差，不靠几何**：想让天桥栏杆/楼梯扶手「看得见」，用 `rust`（port）/ `plaster`（desert）与桥面 `concrete` 的**纹理色差**实现——栏杆是信息载体（「别掉下去」），颜色略深/略暖即可，不需要额外几何。
3. **唯一允许的例外**：若后续做 GLB 在线增强替换，GLB 内可含更精细栏杆/扶手造型，但必须满足 §4 剪影等价（体量 ≤10%、平台 y 完全一致），且视觉剪影 = 程序化基线（有栏杆、无多余凸起）。

---

## 4. 剪影等价回顾（glb-slot §5.1 硬约束）

bridge/stairs **已内联，不强制走外部 GLB**；外部 `glb:` 字段仅用于在线增强替换。若替换，必须满足：

| 检查项 | 要求 |
|--------|------|
| 体量偏差 | w/d/h 各轴 **≤ 10%**（对标称 30×7×10 / 12×12×13） |
| 可站立平台高度 | **完全一致**：bridge y=10、stairs y=13（glb-slot §5.1） |
| 门洞/通行口 | bridge 桥下净空 9.6m 可通行、栏杆间隙不封口；stairs 顶台可站 |
| 程序化基线 | GLB 与程序化外观剪影一致（离线=粗糙版、在线=精细版，同一栋楼） |
| 碰撞 | **GLB 绝不改碰撞**（colliders/platforms 来自 BuildingLib.CONFIGS，与 §1 一致） |

> 落地检查：`?map=<id>` 进图走到桥下（应可通行）、上桥面（应可站立不穿模）、stairs 顶台（应可站）；截图对比 GLB 与程序化基线轮廓。

---

## 5. 与缩圈共存的视觉要点（v1.3 联动）

| 交互 | 建议 |
|------|------|
| **桥面 = 圈内/圈外分界观察点** | bridge 平台 y=10 高于地面圈环 y=0.18，桥上玩家看圈仍清晰（圈环不穿桥体，Bridge 桥墩碰撞在 XZ 平面、环在地面，无 z-fighting）；桥下玩家看圈不受桥面遮挡（圈环在地面层） |
| **桥梯的导航价值** | port 断电/沙暴（若联动缩圈）期，桥/梯是「高处机动」冗余路径，视觉上桥面 `concrete` 冷灰 + 栏杆 `rust` 在夜雾中剪影明显（fog far ≥ 120 红线不因桥梯降低） |
| **不新增视觉层** | 桥/梯是**场景设施**，不是机制指示器——不参与颜色编码（不涂队伍色/圈色/警示色），保持主题化 tint 即可，避免与机制视觉层混叠 |

---

## 6. 交付给工程的落地清单

| 顺序 | 事项 | 依赖 | 优先级 |
|------|------|------|-------|
| 1 | 三图 mapDef.buildings 补 bridge/stairs 记录（坐标由 design-strategist zone-design 定稿），tint/纹理按 §2 表 | 设计侧桥梯摆位 | **P0** |
| 2 | 验证 bridge 平台 y=10 / stairs 顶台 y=13 可站立、桥下可通行（BuildingLib 已支持，仅回归） | — | P0 |
| 3 | port/desert 纹理 key 落地（rust / corrugated / plaster / sand）或确认已实现 | textures.js | P1 |
| 4 | GLB 在线增强（port_bridge.glb 等）按 §4 剪影等价验收 | glb-slot 管线 | P2 |

> 数值占位：桥梯**数量/位置/朝向**由 `design/maps/zone-design.md`（design-strategist）定稿；本文档只给每处接入的美术参数（tint/纹理/trim/剪影约束），数量变化不改变本文档。
