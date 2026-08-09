# 发布清单 · Release Checklist · v1.11.11（2026-08-08）

> 项目：战地突击 Battleground Tactical FPS
> 版本：**1.11.11**（对齐 `CHANGELOG.md` 最新条目；`package.json` 由陈旧值 1.4.0 同步至 1.11.11）
> 本次性质：**发布打包收口**（无生产代码变更；产出本地可分发包 + 压缩包）
> 关联：`CHANGELOG.md`（[1.11.x] 系列条目）· `README.md`（玩法/联机/操作）

---

## 0. 版本与基线

| 项 | 值 | 状态 |
|----|----|------|
| 包版本 | `package.json` → **1.11.11**（原为 1.4.0，与 CHANGELOG 脱节 → 本次同步） | ✅ |
| 变更日志 | `CHANGELOG.md` 已含 [1.5.0]~[1.11.11] 全部条目（AI 提难 / 吃鸡制 / 救援 / 缩圈 / 设置系统 / 头顶标识 / 联机修复 等） | ✅ |
| 生产代码 | 本次零改动（仅 `package.json` 版本字段 + 新增发布包与清单） | ✅ |
| 回归 | `node --check` 全过（server.js + js/*.js + js/maps/*.js + 5 个 models 数据文件，无语法错误） | ✅ |

---

## 1. 发布包内容（本地可分发包 `battlegame-1.11.11/`）

运行游戏所需的**最小文件集**（37 个文件，未压缩 4.21 MB，zip 1.91 MB）：

```
index.html              # 入口（脚本按依赖序加载，离线 file:// 可玩）
server.js               # 联机服务端（listen-server，内置零依赖 RFC6455 实现）
package.json            # version 1.11.11
README.md               # 完整玩法/联机/操作说明
CHANGELOG.md            # 版本变更
startService.bat        # 一键启动（静态服务 :8000 + 联机 :8080）
发布说明.txt            # 30 秒快速上手（中文）
js/  (19)               # core/audio/textures/settings/world/combat/game/ai/ui/
                        #   accounts/items/mg/models/mechanics/net/weaponAnim/main
js/maps/ (4)            # registry + suburb/port/desert
libs/three.min.js       # three.js r160 UMD（本地化，主渲染）
models/ (5)             # soldier_data/weapons_data/buildings_data/buildings_out/gun_glb_data
                        #   （均为 base64 内联数据，无 fetch / 无 ESM / 无 importmap）
sounds/ (3)             # Explosion-Noise / reloading-weapons / war-alarm-sound-long
```

---

## 2. 剔除清单（不进入发布包，理由）

| 剔除项 | 理由 |
|--------|------|
| `node_modules/`（2817 文件） | 运行时零依赖：server.js 内置 RFC6455 实现；`@jscad/modeling` 仅 dev 工具链 |
| `test/` `tools/` `design/` `art/` `docs/` | 开发/测试/设计/美术资源，非运行所需 |
| `model/`（单数，源 GLB/OBJ/PBR 贴图） | 从未被 index.html/js 引用，属源素材工作区 |
| `models/soldier.glb`(15MB) `soldier_parts.glb` `ai_guns/`(20MB) `glb/` `disabled/` `source/` `out/` | 士兵模型已 base64 内联于 `soldier_data.js`；武器枪栓内联于 `gun_glb_data.js`；其余为源/休眠 GLB 插槽（ADR-003，离线不加载） |
| `models/buildings_dims.json` `convert-all.py` `direct_off2glb.py` `run-convert.bat` | 尺寸为 models.js 内联副本；其余为离线转换工具 |
| `libs/three.module.js` `libs/GLTFLoader.js` | ESM/GLB 加载器，GLB 插槽休眠（无 GLTFLoader → 纯程序化），运行时未被 index.html 引用 |
| `sounds/legacy/` | 真实枪声样本已在 v1.10.0 迭代中撤下，audio.js `SFX` 仅引用 3 个 mp3 |

> 校验：`grep -rn "fetch(\|import(\|XMLHttpRequest\|GLTFLoader\|three.module" js/ index.html` 无任何运行时加载路径；士兵模型加载路径为 `window.SOLDIER_DATA`（models.js 注释明确「无 fetch / 无 ESM / 无 importmap → file:// 双击可玩」）。

---

## 3. 验证结果

- **`node --check`**：server.js + 全部 js + 5 个 models 数据文件，全部通过，无语法错误。
- **`node test/smoke.js`（无头冒烟，驱动真实代码）**：
  - 三图（suburb/port/desert）均成功构建（碰撞体 463~726、平台、机制初始化 OK）；
  - 四地标（stadium/refinery/base/megatower）构建 + CONFIGS + 腿式可通行 + 缺数据回退 OK；
  - 结算流程 OK。
  - **已知 1 项提示**：单帧峰值 121ms > 80ms（首帧构建抖动）——属 CHANGELOG/README 已记载 backlog（「性能最坏帧首帧抖动仍在，建议预热帧规避误报」），预热后消失，**非回归、非阻塞**。

---

## 4. 已知风险（延续，均非阻塞）

- 首帧构建抖动（backlog，见 §3）。
- GLB 插槽休眠（ADR-003）：建筑走 `BUILDINGS_OUT` 内联几何，外部 GLB 恒不加载。
- 联机环境依赖：浏览器需直连房主 8080 端口；Windows 首次需放行防火墙。
- 机制/缩圈数值多标 `[PLAYTEST]`，建议首轮内测后收敛（历史 backlog，与本次打包无关）。

---

## 5. Go / No-Go

- [x] 发布门控：**GO**——本地可分发包与压缩包已生成，文件集经依赖扫描与 `node --check` 校验，冒烟三图构建全绿（仅 1 项已知首帧抖动 backlog，非阻塞）。
- 交付物：`battlegame-1.11.11/`（解压即用）+ `battlegame-1.11.11.zip`（1.91 MB）。
