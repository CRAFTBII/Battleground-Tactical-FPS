# 三机制视觉规格（美术圣经 · 附录 F）

> 项目：战地突击 Battleground Tactical FPS（Three.js r160）
> 对应实现：`js/mechanics.js`（searchlight / sandstorm / airdrop）；数据见各 `js/maps/*.js` 的 `mechanics` 字段
> 关联：`art/theme-atmosphere.md`（port 冷蓝夜 / desert 暖橙 / suburb 基准）、`art/accessibility.md`（形状编码 + #radio 通知条）、`art/building-fidelity.md`（tint/纹理）
> 本文档只给视觉参数，不改代码。所有机制指示器**不得**覆盖据点红/蓝/中立三态色（accessibility §4 红线）。

---

## 1. port 探照灯 + 断电（searchlight）

| 视觉项 | 规格 |
|--------|------|
| **光锥** | 半透明扇形（`_makeSector`，`MeshBasicMaterial` 不受光）：`opacity 0.14`、`DoubleSide`、`depthWrite:false`。锥角 = `halfAngle`（数据 30–45°）、长度 = `range`（40–55m）。颜色 `0xffe9a8`（暖黄，与 theme §2.3 钠灯橙 `#ffb64d` 同族）。可加第 2 层内锥 `opacity 0.08` 半径 ×0.6 做「亮芯」，成本 0（复用同材质） |
| **灯头** | 球形灯泡 `0.5m` + 灯杆 `CylinderGeometry`（杆高 = `y-1`，`0x4a4f55` 冷灰）。灯泡用 `MeshBasicMaterial`（D-12 既有约定，夜景才亮） |
| **曝露指示** | 被扫到：`#radio` 顶部通知条「⚠ 已曝露」+ 小地图红点（`_mark` 色 `#ffd166`）。**色盲安全**：通知条文字含图标「⚠」+ 红点闪烁（频率 ≤3Hz，accessibility 光敏红线），不单靠颜色；小地图标记叠加**实心三角**（区别于据点的圆/方/空心圆，accessibility §4.3 形状编码扩充） |
| **配电箱** | 半埋盒体 `1.2×0.8×0.6`（`MeshLambertMaterial` + `crate` 木纹或 `metal` 冷灰）+ 顶部一条 `0.06m` 宽警示条 `0xffb64d`（Basic，夜间可见）。E 交互提示用现有 UI 交互条。断电后警示条熄灭（`visible=false`），恢复时亮起 → 一眼读出「可修/不可修」 |
| **断电暗场** | 灯灭：4 盏光锥全部 `visible=false`（已实现）。建议加：`ambient.intensity` 由 0.46 瞬降到 0.32（断电期），恢复回升——制造「更黑」的对比。**不得低于 accessibility §3.1 红线 0.30**，且雾 near/far 不动（避免视觉断层） |

> 锥体朝向：`grp.rotation.y = angle`，`+Z` 为 0°（与移动 yaw 同约定，实现已对齐）。光锥只做地面投影层，不做体积光（无后处理管线，否决屏幕空间方案）。

---

## 2. desert 沙暴 + 水塔（sandstorm）

| 视觉项 | 规格 |
|--------|------|
| **雾插值** | 风暴 fog `near 15 / far 70 / 色 0xcaa06a`，平静 fog `near 120 / far 430 / 色 = env.fog`。2–3s 插值（`fadeDur 2.5`，已实现）。**硬门槛**：风暴 far=70 仍 ≥ 120 红线？—— 否，70 < 120。这是**机制性例外**（风暴本就强制短视野），但必须在 #radio 顶部通知条显著警告「沙暴来袭 30s」，且风暴期间小地图不降（导航冗余，accessibility §3.2） |
| **尘埃粒子** | 复用 `FX.smokeCloud`（已有 `smokeTex` + Sprite 队列，`combat.js:14`）。建议：风暴期在相机周围 6–12m 随机生成 8–12 个 `smokeTex` Sprite，色 `0xcaa06a`、`opacity 0.35`、上浮 `dy=1.2/s`、life 2–3s。**零新资源**（复用烟雾贴图），成本低 |
| **风暴警示 UI** | #radio 顶部通知条「🌪 沙暴来袭 30s — 找掩体！」+ 屏幕边缘半透明沙色 vignette（CSS radial-gradient，`opacity 0.25`，风暴期显示）。小地图加风暴范围底色 `rgba(202,160,106,0.18)` |
| **水塔造型** | 现状：底环（`0x3f9fd8` 蓝，opacity 0.3）+ 金属罐。**不建议直接挂 `battle_tower.glb`**——该模型是 18.6×18.6×100m 摩天楼（3588 tris，超高塔体量），与水塔设施位（w4×d4×h8、回血圈 r10）体量完全不符，接入会被引擎按 w/d/h 非等比压扁成畸变。**方向**：保留程序化水塔（塔腿 + 圆柱罐，`theme-atmosphere.md` §6 P0 已列 `desert_landmark_water_tower.glb` 作为 GLB 增强项，8×8×22m 独立地标，不占 mechanics 设施位） |
| **回血圈** | 复用据点 RingGeometry 风格：`RingGeometry(r-1.2, r)`、`opacity 0.3`、`DoubleSide`、`depthWrite:false`，色 `0x3f9fd8`（蓝=补给/友方语义，非队伍色）。占领方在圈内时叠一层 `0x5aa9ff`（蓝队色）细环 + `#radio`「水塔回血中 +5/s」 |

---

## 3. suburb 空投 + 炮击（airdrop）

| 视觉项 | 规格 |
|--------|------|
| **空投信标** | 投放前 5s：绿色信标光柱（`CylinderGeometry(0.12,0.12,40)`，`MeshBasicMaterial` 色 `0x7ec8ff` → 建议改 **`0x4ade80` 补给绿**，与 #radio 绿语义一致，opacity 0.35，`depthWrite:false`）+ 小地图绿点（`#radio` 同色）。空中加 1 个缓慢旋转的光点 Sprite（复用 `flashTex`，opacity 0.4）指向落点 |
| **降落伞** | 现状 `ConeGeometry(1.1,0.9,8)` 白色 `0xe8eef4`。建议：伞顶保持锥形，底部加 3–4 根细绳（`Line` 或细 `CylinderGeometry` 0.02m），伞下挂补给箱 `BoxGeometry(1.4,1.2,1.4)` `crate` 木纹。降落动画 `y: 60 → 落地`（已实现 `fallSec 3`） |
| **补给箱造型** | 箱体 `1.4×1.2×1.4` 木纹（`0x8a6f4a`）+ 顶部一条 `0x4ade80` 绿边（Basic，可读性）。落地后绿边常亮 = 可拾取；拾取后消失 |
| **炮击警示区** | 地面光圈**复用据点光圈风格**：`RingGeometry(radius-0.6, radius)`、`opacity 0.5`、`DoubleSide`、`depthWrite:false`，色 `0xff4757` 红。**形状编码**：炮击红圈用**虚线/扇段环**（8 段 RingGeometry 扇区，区别于据点的实心/8 段虚线——需与工程确认扇段实现），因为红圈是「危险区」不是「占领区」。闪烁：`opacity 0.25+0.4·|sin(6πk)|`（已实现）+ `scale 1→1.15`（倒计时膨胀感）。#radio「⚠ 炮击警告 — 离开红圈！」 |
| **落点爆闪** | 复用 `FX.explosion(pos, r)`（已有冲击波 Sprite + 爆炸音效）+ `FX.shakePulse(0.4)`（40m 内）。爆闪用现有 `flashTex` `0xff8c2e`。**光敏**：爆炸闪频 ≤3Hz、强度减半选项跟随 accessibility「减少闪烁」开关 |

---

## 4. 指示器与据点形状编码的关系（通用）

| 元素 | 颜色 | 形状 | 与据点编码的关系 |
|------|------|------|-----------------|
| 探照灯曝露 | 黄 `#ffd166` | 实心三角标记 + 闪烁 | 新增形状，不与圆/方/空心冲突 |
| 炮击警示 | 红 `#ff4757` | 虚线/扇段环 | 同「红=危险」语义但用虚线环区别于据点虚线环（据点虚线是队伍红 `#b3261e`，炮击是亮红 `#ff4757`，明度差拉开） |
| 空投信标/补给 | 绿 `#4ade80` | 光柱 + 圆点 | 新语义色（非队伍色），小地图绿点 |
| 配电箱断电 | 橙 `#ffb64d` | 警示条亮/灭 | 复用 port 钠灯橙锚点 |
| 沙暴 | 沙黄 `#caa06a` | 全屏 vignette | 环境层，不占 HUD 形状 |

**红线重申**：红/蓝/中立三态色（`CFG.TEAM_COLORS`）永不参与机制指示；机制色全部为「语义色」且与三态色明度/色相可区分（灰度下可辨）。

---

## 5. 交付给工程的落地清单

| 顺序 | 事项 | 依赖 | 优先级 |
|------|------|------|-------|
| 1 | 探照灯曝露小地图三角标记 + #radio 通知条 | ui.js 已有 #radio 通道 | P0 |
| 2 | 炮击警示虚线环（扇段实现） | 据点虚线环方案确认 | P0 |
| 3 | 沙暴尘埃粒子（复用 FX.smokeCloud） | FX 暴露 smokeCloud | P1 |
| 4 | 断电期 ambient 0.46→0.32 | mechanics 挂 env 钩子 | P1 |
| 5 | 配电箱警示条亮灭 + 空投箱绿边 | mechanics 已有对象 | P1 |
| 6 | 水塔 GLB（desert_landmark_water_tower） | glb-slot 管线启用后 | P2 |
