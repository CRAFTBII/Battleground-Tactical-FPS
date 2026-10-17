# 发布清单 · Release Checklist · v1.2.0（2026-08-06）

> 项目：战地突击 Battleground Tactical FPS
> 发布负责人：路远行（release-ops-lead）
> 版本：**1.2.0**（package.json；本次里程碑「地图特色化：每图专属玩法」）
> 关联：`CHANGELOG.md`（[1.2.0] 条目） · 质量报告 `docs/quality/maps-qa-v12-2026-08-06.md`（初评 FAIL → 复验 **PASS**） · 设计契约 `design/maps/mechanics.md` · 架构 `docs/architecture/mechanics-architecture.md` · 美术 `art/mechanics-visual.md`
> 本清单为**发布前人工核对项**，不代替代码审查；高影响动作（上线/热修/回滚）须用户审批。

---

## 0. 版本与基线

| 项 | 值 | 状态 |
|----|----|------|
| 包版本 | `package.json` → **1.2.0**（1.1.0 次版本递增，只改 version 字段） | ✅ |
| 变更日志 | `CHANGELOG.md` 已含 [1.2.0] 条目；v2.7 时代遗留系统补记入 [1.1.0]（版本连续性） | ✅ |
| 质量门控 | 初评 **FAIL**（1 BLOCKER + 2 MAJOR）→ 工程修复批 T14 → 复验 **PASS**（70 项断言 + 密度回归全过，无 FAIL / 无阻塞项） | ✅ |
| 回归 | `test/smoke.js` RC=0；`test/qa/_qa_v12_*.js` 4 个 ALL PASS（port/desert/suburb/coexist）；`test/port-density-probe.js` 三图 ALL PASS | ✅ |
| 本任务改动 | 本次发布收口仅动文档/版本/清理（CHANGELOG / package.json / README / 发布清单 / 临时文件）；生产代码与地图数据由工程/质量批次完成并复验 | ✅ |

---

## 1. 上线前检查项（人工逐项勾选）

### 1.1 构建与启动

- [ ] **离线双击即玩**：直接双击 `index.html`（`file://`），无红条错误、可进菜单、可开始单人战役（three.js 本地化；地图为 JS 模块注册 + `BUILDINGS_OUT` 内联几何，零 GLTFLoader / 无 fetch JSON）。
- [ ] **联机验证**：`node server.js`（默认 8080）启动无报错；浏览器开 `index.html` → 创建联机房间 → 第二客户端输入房主 IP 加入 → 状态/事件广播正常（Windows 首次放行防火墙）。
- [ ] **回归全绿**：`node test/smoke.js` → 退出码 0，末尾「无头冒烟测试全部通过」。
- [ ] **服务端协议回归**：另起 `node server.js` 后跑 `node test/server-test.js` → 通过（握手/建房/加入/state 路由/事件广播）。

### 1.2 三图机制实测（v1.2 核心）

- [ ] **port 夜港**：进入 `index.html?map=port` → 4 盏探照灯往复扫描；被扫到出现曝露警示点 + HUD 提示；配电箱 2m 内按 **E** 全港断电 30s（环境光变暗、灯灭）；断电期内对侧按 E 抢修立即恢复供电；队冷却 45s 内该队不能再按 E。
- [ ] **desert 荒漠**：进入 `index.html?map=desert` → 开局 90s 平静后沙暴 30s（雾骤浓）；风暴期站空地掉血（4HP/s）、进建筑/水塔圈不掉血；AI 对 20m 外命中下降；水塔圈内占领方回血 5HP/s、敌方不回血。
- [ ] **suburb 城郊**：进入 `index.html?map=suburb` → 每 60s 空投（信标警示 → 落箱 → E 拾取 +50HP/+30% 弹药）；每 45s 中央广场红色警示圈（8m）4s 后随机落点落弹，掩体可挡。
- [ ] **小地图标记**：port 曝露琥珀警示点 / suburb 空投蓝信标 / suburb 炮击红圈 均按预期显示与消失。
- [ ] **机制与据点共存**：三图机制运行期间 A/B/C 占点、产分、击杀均正常；环境伤害不产分（owner=null）。
- [ ] **URL 参数 `?map=`**：`?map=port` / `?map=desert` / `?map=suburb` 直达；非法/缺省回退默认图（suburb）。
- [ ] **`?cvd=1` 色盲模式**：`index.html?cvd=1` 后队伍色切换蓝-橙安全色相轴，红蓝可辨。

### 1.3 稳定性与观感

- [ ] **浏览器控制台无红色报错**：三图各加载一次，控制台无 `console.error` / 未捕获异常（GLB 未启用时的 `console.log` 回退提示属正常）。
- [ ] **换图无串图残留**：菜单连续切换三图，场景不残留旧图对象/机制对象，控制台无泄漏报错。
- [ ] **性能抽测**：三图 300 帧战斗模拟平均 <1ms/帧、最坏帧 <80ms（参考：v1.1 平均 0.10~0.58ms；机制对象为纯视觉，量级相近）。

### 1.4 发布收口

- [ ] 变更日志 `CHANGELOG.md` 已更新（[1.2.0] + [1.1.0] 补记）。
- [ ] README 已同步：地图专属玩法段 / 操作表（E、对讲机 Z-X-C-V、F 近战、B 背包）/ 目录结构 / 已知简化机制联机现状。
- [ ] 工程遗留探测输出已清理（见 §3 清理记录）。
- [ ] `package.json` 版本号已递增为 1.2.0。

---

## 2. 已知风险与缓解

| # | 风险 | 等级 | 缓解 / 处置 |
|---|------|------|-------------|
| R1 | **机制数值多为 [PLAYTEST] 标注**（探照灯扫速/冷却、沙暴比例/灼伤、水塔回血、空投/炮击数值等，见 `design/maps/mechanics.md` §5） | 中（玩法平衡） | 不阻塞发布；首轮内测后按实测收敛一次，收敛后补回归断言 |
| R2 | **联机客户端不处理 `'cap'` 事件（复验 C2）**：`net.js applyEvent` 无 `case 'cap'` → 水塔占领/易主视觉仅房主可见；A/B/C 靠 states 快照同步不受影响 | 低（仅联机视觉） | backlog：下一批次为 `cap` 事件补客户端 handler；单机不受影响 |
| R3 | **port 断电方队冷却内不能抢修（复验 C1）**：与设计 §2.2 rule2「任意一方可抢修」存在文字冲突；实现取「队冷却阻断该队一切电源操作」，符合防反复开关意图 | 低（规则口径） | 待设计侧书面澄清 §2.2 文字；当前行为为预期 |
| R4 | **suburb 空投细节（复验 C3）**：60+rand12 抖动 / 信标 5s 未独立（3s 降落合并）/ 拾取半径 2.2 vs 1.5 / 箱无碰撞实体 | 低 | [PLAYTEST] / 低优先级 backlog |
| R5 | **desert 单人回血相位边界（复验 C4）**：实测 3.75~5HP/s（2Hz 节流相位），多人同圈严格 5HP/s；5±20% 内 | 低（非回归） | 可接受；多人同圈为准 |
| R6 | **探照灯 `tiltDeg` 无物理倾斜 / 曝露 ping 平方距离偏移（初评 R8）** | 低（纯 cosmetic） | backlog：tilt 物理倾斜、ping 公式改 `Math.sqrt` |
| R7 | **GLB 插槽休眠（ADR-003）延续**：建筑走 `BUILDINGS_OUT` 内联几何，外部 GLB 恒不加载 | 低（预期行为） | 不阻塞；启用需构建/importmap 打包 GLTFLoader 并另立 ADR |
| R8 | **联机环境依赖**：浏览器需直连房主 8080 端口；Windows 首次需放行防火墙 | 低（环境） | README 已注明；属部署环境项，非产品缺陷 |

**发布门控判定：PASS（CONCERNS 均非阻塞）** —— 无 Blocker；R1 建议首轮内测后收敛，R2 建议尽快排期（下一批次）。

---

## 3. 临时文件清理记录（2026-08-06）

已删除（工程/质量验证输出残留，非正式套件）：

```
_final_port.txt        （根目录，port 密度探针输出捕获）
_final_smoke.txt       （根目录，smoke 输出捕获）
```

经全树扫描（排除 node_modules）：`test/` 下无 `*_out.txt` / `smoke_r*.txt` / `spawncheck*` 残留；无其他 `*_out.txt` / `smoke*.txt` / `*.tmp` 输出文件。

保留（正式回归/验证套件，勿删）：

```
test/smoke.js              # 无头冒烟（RC=0）
test/server-test.js        # 服务端协议回归
test/port-density-probe.js # 密度探针（建筑数/A* 连通/出生点/内联网格，三图通用）
test/qa/_qa_v12_stub.js       # v1.2 机制回归套件（真实 mapDef 数据下逐机制探测）
test/qa/_qa_v12_port.js       # port 探照灯+断电（18 断言）
test/qa/_qa_v12_desert.js     # desert 沙暴+水塔（17 断言）
test/qa/_qa_v12_suburb.js     # suburb 空投+炮击（17 断言）
test/qa/_qa_v12_coexist.js    # 机制与据点共存 + 联机注入（10 断言）
```

---

## 4. 回滚预案（如需）

本版本收口任务（T13）仅动文档/版本/清理；**生产代码与地图数据变更**（mechanics.js / world.js / combat.js / 三图 mapDef / buildings_out.js 等）由工程与质量批次完成并已复验 PASS。

- **回滚目标**：恢复 v1.1.0 基线（三图无机制、port 12 栋、旧操作键位）。
- **回滚步骤**（当前工作区非 git 仓库，依赖发布时构建备份/归档）：
  1. 从发布归档恢复 v1.1.0 的 `js/`、`models/`、`index.html`、`package.json`（version 回 1.1.0）与 `CHANGELOG.md`/`README.md` 上一版；
  2. 重跑 `node test/smoke.js`（RC=0）+ `node test/server-test.js` + 三图人工冒烟；
  3. 分发渠道/分享链接回退到 v1.1.0 构建；
  4. 发布补丁说明公告（说明回滚原因与影响范围）。
- **热修通道**：若发布后仅需修数据/数值（如 [PLAYTEST] 收敛），走简化流程——只改 `js/maps/*.js` 数值 + 更新 CHANGELOG 热修条目 + 重跑 smoke/`_qa_v12`，保留完整审计。

---

## 5. Go / No-Go 结论

- [ ] 发布门控：**GO（PASS）**—— 人工上线前核对项（§1）全部勾选通过后即可放行。
- 备注：质量门控复验 PASS（无 FAIL / 无阻塞项）；复验后剩余 CONCERNS（C1-C4）均非阻塞，见 §2 R2-R5。
