# 发布清单 · Release Checklist · v1.3.0（2026-08-06）

> 项目：战地突击 Battleground Tactical FPS
> 发布负责人：路远行（release-ops-lead）
> 版本：**1.3.0**（package.json；本次里程碑「缩圈吃雞融合：三图缩圈 + AI 进圈 + 桥梯 + 双圈视觉」）
> 关联：`CHANGELOG.md`（[1.3.0] 条目） · 质量报告 `docs/quality/maps-qa-v13-2026-08-06.md`（初评 FAIL → 复验 **PASS**） · 设计契约 `design/maps/zone-br.md` · 架构 `docs/architecture/zone-architecture.md` · 美术 `art/zone-visual.md` + `art/zone-bridge-integration.md`
> 本清单为**发布前人工核对项**，不代替代码审查；高影响动作（上线/热修/回滚）须用户审批。

---

## 0. 版本与基线

| 项 | 值 | 状态 |
|----|----|------|
| 包版本 | `package.json` → **1.3.0**（1.2.0 次版本递增，只改 version 字段） | ✅ |
| 变更日志 | `CHANGELOG.md` 已含 [1.3.0] 条目（新增/修复/技术/已知风险，含玩家语言补丁说明） | ✅ |
| 质量门控 | 初评 **FAIL**（1 BLOCKER：bridge 桥面 collider 未分流 overhead）→ 工程修复 → 复验 **PASS**（zone 48 + bridge 42 断言全过，smoke/密度探针全绿，无 FAIL / 无阻塞项） | ✅ |
| 门禁套件 | `test/_qa_v13_zone.js`（48 断言）+ `test/_qa_v13_bridge.js`（42 断言）作为 v1.3 发布门禁固定回归套件保留 | ✅ |
| 回归 | `test/smoke.js` RC=0（含 §4.13 缩圈 + §4.14 桥梯）；`test/port-density-probe.js` 三图 ALL PASS；`test/_qa_v12_*.js` 既有机制回归未受影响 | ✅ |
| 本任务改动 | 本次发布收口仅动文档/版本/清理（CHANGELOG / package.json / README / 发布清单 / 临时文件）；生产代码与地图数据由工程/质量批次完成并已复验 | ✅ |

---

## 1. 上线前检查项（人工逐项勾选）

### 1.1 构建与启动

- [ ] **离线双击即玩**：直接双击 `index.html`（`file://`），无红条错误、可进菜单、可开始单人战役（three.js 本地化；地图为 JS 模块注册 + `BUILDINGS_OUT` 内联几何，零 GLTFLoader / 无 fetch JSON）。
- [ ] **联机验证**：`node server.js`（默认 8080）启动无报错；浏览器开 `index.html` → 创建联机房间 → 第二客户端输入房主 IP 加入 → 状态/事件广播正常（Windows 首次放行防火墙）。
- [ ] **回归全绿**：`node test/smoke.js` → 退出码 0，末尾「无头冒烟测试全部通过」。
- [ ] **门禁套件全绿**：`node test/_qa_v13_zone.js` → 48 断言全 PASS（RC=0）；`node test/_qa_v13_bridge.js` → 42 断言全 PASS（RC=0）。
- [ ] **服务端协议回归**：另起 `node server.js` 后跑 `node test/server-test.js` → 通过（握手/建房/加入/state 路由/事件广播）。

### 1.2 三图缩圈实测（v1.3 核心）

- [ ] **suburb 城郊**：进入 `index.html?map=suburb` → 开局白实线圈（心 150,150，r220 覆盖全图）；90s 到点蓝圈闪烁 5s + banner「⚠ 安全区即将收缩！」→ 2s 收缩到 r136；圈外站 1s 掉 1HP（P0）→ 后续阶段 3/6/10/15 HP/s 递增；450s 后终圈 r31。
- [ ] **port 夜港**：`?map=port` → 圈心 (165,150) r230→32；夜港雾（40~200）下**缩圈环仍清晰可见**（fog:false）；探照灯/断电照常运行、缩圈不豁免。
- [ ] **desert 荒漠**：`?map=desert` → 圈心 (110,140) r315→44（最大终圈，最宽松）；沙暴期站圈外 = **双压**（圈伤 + 沙暴 4HP/s 叠加 ≈ 7HP/s）；水塔圈外回血仍生效。
- [ ] **AI 进圈**：圈外无敌意的 AI 向圈内移动（可看到 AI 越过桥下/开阔地奔圈）；圈外 AI 同样掉圈伤；AI 与玩家均可**从桥下穿过**（不被桥面推出、不卡桥）。
- [ ] **桥梯**：三图天桥可上（stairs 底部实体 + 顶平台 y=6.00 与桥面衔接）；**桥面只挡子弹、桥下可通行**；桥上可射击桥下、桥下射击桥上被桥面挡。
- [ ] **双圈视觉**：当前圈白实线 `#f0f4f8` + 预告圈电蓝虚线 `#2f7fe8`（收缩后预告圈更新/最终阶段隐藏）；圈外电蓝 vignette 随距离加深（0.12→0.45）；小地图双圈显示且画在据点之前。
- [ ] **环境伤害不产分**：圈外低血单位死亡后比分不变（owner=null，不算击杀）。
- [ ] **URL 参数 `?map=`**：`?map=port` / `?map=desert` / `?map=suburb` 直达；非法/缺省回退默认图（suburb）。

### 1.3 稳定性与观感

- [ ] **浏览器控制台无红色报错**：三图各加载一次（含缩圈推进到 P4 终圈），控制台无 `console.error` / 未捕获异常。
- [ ] **换图无串图残留**：菜单连续切换三图，场景不残留旧图对象/圈对象，控制台无泄漏报错。
- [ ] **性能抽测**：缩圈环 RingGeometry 自适应分段（非每帧重建）；三图战斗模拟平均 <1ms/帧、最坏帧 <80ms（参考 v1.2 量级）。

### 1.4 发布收口

- [ ] 变更日志 `CHANGELOG.md` 已更新（[1.3.0] 条目）。
- [ ] README 已同步：缩圈玩法（v1.3）小节 / 地图表缩圈字段 / 目录结构（_qa_v13_*.js、zone-architecture.md、zone-br.md、zone-visual.md）/ 已知简化 backlog。
- [ ] 工程/质量验证输出残留已清理（见 §3 清理记录）。
- [ ] `package.json` 版本号已递增为 1.3.0。

---

## 2. 已知风险与缓解

| # | 风险 | 等级 | 缓解 / 处置 |
|---|------|------|-------------|
| R1 | **缩圈数值为 [PLAYTEST] 标注**（伤害曲线 1→15、终局圈 r31/32/44、阶段时刻 90/210/330/450s、desert 双压强度、桥面 6m 可攀登性，见 `design/maps/zone-br.md`） | 中（玩法平衡） | 不阻塞发布；首轮内测后按实测收敛一次，收敛后补回归断言；数值走 `mapDef.zone` 数据层，热修可快速调整 |
| R2 | **设计口径 CONCERNS（复验 §7.4，均非阻塞）**：① 设计 §6.1「圈外有敌 → 走位偏圈内」未实现（实现与架构一致：engage 完全不受扰）② atSec 时序语义字面出入（警示→收缩间隔均 5s，体验一致）③ `escapeDest` 同心环采样非「严格最近」（功能等价） | 低（文档口径） | 已与设计/架构文档对齐说明；待 design-strategist 书面确认以设计还是架构为准（下一批次） |
| R3 | **y-碰撞站立支持 P2（backlog）**：当前移动为 2D x/z 判定 + 按高度跳过；桥下通行已由 overhead 分流解决，完整 y 轴站立/攀爬支持留 P2 | 低（功能增强） | 不阻塞；P2 排期 |
| R4 | **`#radio` 阶段通知通道（backlog）**：缩圈阶段切换进对讲机通知语音通道待接入；收缩动画细化（方向箭头 / 环刻度提示）待做 | 低（体验增强） | backlog；不影响核心玩法 |
| R5 | **联机客户端不处理 `'cap'` 事件（v1.2 遗留，复验 C2）**：水塔占领/易主视觉仅房主可见 | 低（仅联机视觉） | backlog（延续 v1.2）；单机不受影响；缩圈 m_zone 事件已正常注入 |
| R6 | **GLB 插槽休眠（ADR-003）延续**：建筑走 `BUILDINGS_OUT` 内联几何，外部 GLB 恒不加载 | 低（预期行为） | 不阻塞；启用需构建/importmap 打包 GLTFLoader 并另立 ADR |
| R7 | **联机环境依赖**：浏览器需直连房主 8080 端口；Windows 首次需放行防火墙 | 低（环境） | README 已注明；属部署环境项，非产品缺陷 |

**发布门控判定：PASS（CONCERNS 均非阻塞）** —— 无 Blocker；R1 建议首轮内测后收敛，R2 建议下一批次由设计侧书面确认口径。

---

## 3. 临时文件清理记录（2026-08-06）

已删除（工程/质量验证输出残留 + 临时调试脚本）：

```
_qa_bridge_out.txt      （根目录，_qa_v13_bridge 输出捕获）
_qa_probe_desert.txt    （根目录，密度探针 desert 输出捕获）
_qa_probe_port.txt      （根目录，密度探针 port 输出捕获）
_qa_probe_suburb.txt    （根目录，密度探针 suburb 输出捕获）
_qa_smoke_out.txt       （根目录，smoke 输出捕获）
_qa_zone_out.txt        （根目录，_qa_v13_zone 输出捕获）
test/_tmp_debug.js      （临时调试脚本）
```

经全树扫描（排除 node_modules）：根目录无 `*_out.txt` / `smoke*.txt` 残留；`test/` 下无 `*_out.txt` / `smoke_r*.txt` 残留。

保留（正式回归/门禁套件，勿删）：

```
test/smoke.js              # 无头冒烟（RC=0，含 §4.13 缩圈 + §4.14 桥梯）
test/server-test.js        # 服务端协议回归
test/port-density-probe.js # 密度探针（建筑数/A* 连通/出生点/内联网格，三图通用）
test/_qa_v12_stub.js / _qa_v12_port.js / _qa_v12_desert.js / _qa_v12_suburb.js / _qa_v12_coexist.js  # v1.2 机制回归套件（70 断言）
test/_qa_v13_zone.js       # v1.3 缩圈门禁套件（48 断言）
test/_qa_v13_bridge.js     # v1.3 桥梯门禁套件（42 断言，含「玩家/AI 移动穿过桥下」断言）
test/v13-zone-bridge-probe.js  # v1.3 缩圈/桥梯深度探针（遗留探测脚本，按约定不作门禁证据、保留）
```

待确认（不在保留清单，非输出残留，暂未删除——无版本控制，避免误删他人脚本）：

```
test/probe_slot.js   # 早期调试探针（引用 js/accounts.js、js/items.js，疑似死代码），建议用户确认后删除
```

---

## 4. 回滚预案（如需）

本版本收口任务（T20）仅动文档/版本/清理；**生产代码与地图数据变更**（mechanics.js zone 引擎 / world.js overhead 分流 / combat.js / ai.js / 三图 mapDef / buildings_out.js 等）由工程与质量批次完成并已复验 PASS。

- **回滚目标**：恢复 v1.2.0 基线（三图无缩圈、无桥梯、port 26 栋）。
- **回滚步骤**（当前工作区非 git 仓库，依赖发布时构建备份/归档）：
  1. 从发布归档恢复 v1.2.0 的 `js/`、`models/`、`index.html`、`package.json`（version 回 1.2.0）与 `CHANGELOG.md`/`README.md` 上一版；
  2. 重跑 `node test/smoke.js`（RC=0）+ `node test/server-test.js` + 三图人工冒烟；
  3. 分发渠道/分享链接回退到 v1.2.0 构建；
  4. 发布补丁说明公告（说明回滚原因与影响范围）。
- **热修通道**：若发布后仅需修缩圈数值（如 [PLAYTEST] 收敛），走简化流程——只改 `js/maps/*.js` 的 `mapDef.zone` 数值 + 更新 CHANGELOG 热修条目 + 重跑 smoke / `_qa_v13_zone` / `_qa_v13_bridge`，保留完整审计。

---

## 5. Go / No-Go 结论

- [ ] 发布门控：**GO（PASS）**—— 人工上线前核对项（§1）全部勾选通过后即可放行。
- 备注：质量门控复验 PASS（zone 48 + bridge 42 断言、smoke/探针全绿，无 FAIL / 无阻塞项）；复验后 CONCERNS（§7.4 三项）均非阻塞，见 §2 R1-R2。
