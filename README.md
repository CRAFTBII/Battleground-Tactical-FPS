# 战地突击 · Battleground Tactical FPS

> 当前稳定版本 **v1.11.11** · 零构建（无需 `npm install`/打包，但**必须起服务**）
>
> ⚠ **运行方式已变更**：模型改为标准 `.glb`，由服务器通过 HTTP 提供，因此**不再支持双击 `index.html`**。
> 请执行 `node server.js`，然后浏览器打开 <http://localhost:8080>（根路径就是游戏本体）。
> 直接双击会看到明确的「请启动服务」提示，而不是空白页或方块人。

Three.js 浏览器端第一人称战术射击。红蓝两队 AI 对抗（每队 10 人），玩家加入蓝队。**据点占领玩法**：A/B/C 三个据点，站在圈内人数多的一方推进占领进度，占领 +25 分并持续产分（每 2s +1），击杀 +1；10 分钟时间到比分高者胜。客户端 + 独立 Node.js WebSocket 服务端，零外部美术资源（所有模型为 Three.js 内置几何体组合、纹理为程序化生成）。

## 项目结构

```
battlegame/
├── index.html        # 入口（CSS/HUD/DOM，按依赖序引用本地脚本，无 importmap / 无构建步骤）
├── libs/three.min.js # 本地 three.js r160（UMD，唯一运行时依赖，主渲染）
├── libs/three.module.js / GLTFLoader.js  # 休眠（ESM / GLTFLoader；本工程无 importmap，改用自写 js/glb.js 解析 GLB）
├── js/
│   ├── glb.js        # 零依赖 glTF 2.0 二进制解析器（手写，不引入打包器/ESM）
│   ├── assetLoader.js# 模型资源预加载（HTTP → GLB，失败明确报错）
│   ├── core.js       # 常量 / 工具 / 噪声
│   ├── audio.js      # WebAudio 程序化合成音效
│   ├── textures.js   # 程序化纹理 + 外部纹理覆盖接口
│   ├── world.js      # 数据驱动地图构建器 / 建筑 / 碰撞 / A* 导航网格
│   ├── combat.js     # 单位 / 武器 / 特效 / 投射物 / 第一人称控制
│   ├── game.js       # 对战规则 / 伤害结算 / 据点 / 迫击炮 / 对讲机指挥
│   ├── ai.js         # AI 个体大脑（寻路/交火/躲避/投雷/翻越/队长带路）
│   ├── ui.js         # 小队战术层 / HUD / 小地图 / 背包
│   ├── models.js     # 角色/武器模型组装（从 AssetLoader 取 GLB；失败抛错由 main.js 显示红条）
│   ├── mechanics.js  # 地图机制引擎（探照灯/沙暴/空投 v1.2 + 缩圈 zone v1.3）
│   ├── net.js        # 联机客户端（listen-server）
│   └── main.js       # 初始化 / 主循环 / 启动错误兜底
├── js/maps/          # 地图注册表 + 三张地图数据（registry/suburb/port/desert，含 mechanics 机制字段）
├── models/           # 【运行时资源区】标准 glTF 2.0 二进制，由 server.js 通过 HTTP 提供
│   ├── soldier.glb   # 士兵（7 部件节点树：torso/head/armL/armR/legL/legR/gun，gun 挂在 armR 下）
│   ├── guns/         # <key>.glb 枪身 + <key>_bolt.glb 枪栓（extras 带 boltRest/boltTravel/zExt）
│   ├── buildings/    # 24 个建筑 GLB（POSITION + COLOR_0 顶点色）
│   ├── manifest.json # 资源清单（AssetLoader 据此加载）
│   └── buildings_dims.json  # 建筑真实尺寸表（构建期/审计用）
├── assets/           # 【源素材区】构建期才用，运行时永不加载（原先散在 model/ 与 models/ 下）
│   ├── soldier/      # soldier.glb / soldier_parts.glb / viewer.html / preview.png（index.html 菜单头像取 preview.png）
│   ├── guns/glb/     # 枪械/机枪/榴弹炮 GLB（tools/ 转换输入）
│   ├── guns/ai_guns/ # AI 生成枪械 GLB（历史素材）
│   ├── buildings/source/    # 建筑 SCAD 源文件（当前 4 XL + legacy/done 归档）
│   ├── buildings/out/       # SCAD 编译出的 GLB（tools/glb2bldg_out.js 输入）
│   ├── buildings/disabled/  # 停用建筑 SCAD
│   └── raw/model/           # 早期单数 model/ 目录整体归档（OBJ/贴图/转换脚本，含 346MB 历史素材）
├── tools/            # 构建/转换脚本
│   ├── export_assets.cjs  # 内联 base64 → 标准 .glb（33 个产物，自检逐值一致）
│   ├── gen_manifest.cjs   # 生成 models/manifest.json
│   └── （其余为历史转换/审计脚本）
├── server.js         # Node WebSocket 服务端（薄中继 + 房间管理）
├── test/             # 测试与探测
│   ├── smoke.js      # 无头冒烟测试（DOM 桩驱动真实代码）
│   ├── server-test.js # 服务端协议回归（握手/建房/加入/state 路由/事件广播）
│   ├── port-density-probe.js / v13-zone-bridge-probe.js / audio-probe.js / probe_slot.js # 探针
│   ├── qa/           # 24 个逐版本质量门禁套件（_qa_v12_* … _qa_v29_*，含共用 _qa_v12_stub）
│   ├── debug/        # 一次性排障脚本（_dbg_*，保留作历史参考，非门禁）
│   └── scratch/      # 临时探测脚本（_tmp_* / _probe_*，非门禁）
├── design/
│   └── maps/         # 设计规格（mechanics.md 机制契约 + zone-br.md 缩圈定稿 + port/desert/suburb GDD）
├── docs/
│   ├── architecture/ # 地图架构说明 + ADR-001/002/003 + mechanics-architecture.md + zone-architecture.md
│   ├── quality/      # 质量门控报告（maps-qa-2026-08-06 / maps-qa-v12 / maps-qa-v13）
│   └── release/      # 发布清单 / 变更日志配套（v1.1 / v1.2 / v1.3）
├── art/              # 美术约定（建筑精修 / 主题氛围 / 纹理 / GLB 插槽 / mechanics-visual.md / zone-visual.md / model-integration.md）
└── package.json / README.md
```

> 角色模型说明：士兵 6 部件（头/躯干/左右臂/左右腿）+ 枪，以关节为 pivot，几何存放于 **`models/soldier.glb`**（标准 glTF，节点层级即关节层级，`gun` 是 `armR` 的子节点），
> 游戏内做程序化走路动画（摆臂摆腿+弹跳）。**运行时零 fetch / 零 GLB 加载**（ADR-003），双击 `index.html` 即可离线游玩；
> URL 加 `?legacy=1` 可强制方块人。`soldier_parts.glb` / `soldier.glb` 仅为构建期源素材，不参与运行。

## 发布版本

当前版本 **1.11.11**（见 `package.json` 与 `CHANGELOG.md`）。本项目为**零构建静态 Web 游戏**：无需 `npm install`、无需打包。

- **发布包**：`battlegame-1.11.11.zip`（约 1.9 MB）——解压即用。剔除 `node_modules`、测试套件、设计文档、美术源素材等开发文件，仅保留运行所需最小文件集（`index.html` + `js/` + `libs/three.min.js` + `models/` 内联数据 + `sounds/` 3 个 mp3 + `server.js`/`startService.bat`）。
- **本地运行**：`node server.js` 后浏览器打开 <http://localhost:8080>；局域网联机见下方。
- **发布清单**：`docs/release/release-checklist-v111-2026-08-08.md`。

## 快速开始

### 单机（需要起服务，不联网）
```bash
node server.js            # 零依赖直接跑，默认 8080 端口
```
然后浏览器打开 <http://localhost:8080> —— 那就是游戏本体，点「开始单人战役（vs AI）」即可开打。

> 服务器状态看板在 <http://localhost:8080/status>（房间列表/在线人数，不影响游戏）。

> **为什么不能双击 index.html**：模型是标准 `.glb` 二进制，由服务器通过 HTTP 提供；
> `file://` 下浏览器不允许 fetch 本地文件，所以必须走 HTTP。双击会看到明确提示。
> 本机运行不需要联网，服务只监听本地。

若页面顶部出现红条，说明资源缺失或初始化异常，提示里会说明具体是哪个文件和怎么修。

### 局域网联机
```bash
node server.js      # 零依赖直接跑！优先用 ws（若 npm install 过），否则内置 RFC6455 实现
```
1. 房主：打开 `index.html` → 「创建联机房间」→ 进入**大厅**等待队友加入 → 人齐后点「⚔ 开始对战」
2. 队友：打开 `index.html` → 输入房主机器 IP（如 `ws://192.168.1.8:8080`）→ 刷新列表 → 点击房间加入 → 进入大厅等待房主开始
3. 房主（listen-server 模型）承担权威模拟：AI、伤害、状态广播。房主掉线则房间解散
4. 大厅内可实时看到成员列表（房主/队员标记、蓝红队伍）；任一方点「离开房间」回到主菜单

> 可选 `npm install` 安装 ws（更健壮的传输层）；不装也能跑。调试开关：`FORCE_INLINE_WS=1 node server.js` 强制内置实现。
> 浏览器必须能直连房主/服务器的 8080 端口。Windows 首次需放行防火墙。
> 想快速确认服务器是否在跑：浏览器打开 `http://房主IP:8080` 可看到**实时服务器列表页**（服务器状态 + 当前房间 + 联机指引，每 3 秒自动刷新）。

### 回归测试
```bash
node test/smoke.js              # 客户端无头冒烟：初始化 + 跳跃 + 对局模拟 + 手雷/迫击炮 + 联机状态注入
node test/qa/_qa_v29_settings.js  # 单套质量门禁（其余套件在 test/qa/，按版本号命名）
# 改造相关的新套件（自带服务器启停，不用手动起服务）：
node test/glb-runtime-test.js   # HTTP → GLB 解析 → THREE 几何 全链路
node test/static-serving-test.js# 静态服务：GLB/MIME/Content-Length/路径穿越/双传输分支
node test/site-check.js         # 整站：所有引用可达 + 脚本顺序 + 清单一致 + file:// 提示
# 另开终端起服务后：
node server.js                  # 起服务（默认 8080）
node test/server-test.js        # 服务端协议回归：握手/建房/加入/state 路由/事件广播
```

## 修改提示

- 各 js 文件按依赖顺序加载（见 index.html 中 `<script>` 顺序），新增文件需插到 main.js 之前
- 改完任意 js 后建议跑 `node test/smoke.js` 回归；浏览器控制台无红色报错为准
- 新增源素材放 `assets/`（构建期用），**不要**放进 `models/`——`models/` 只放运行时 .glb 与 manifest.json
- 改了模型要用 `node tools/export_assets.cjs` 重新导出，再 `node tools/gen_manifest.cjs` 刷新清单
- 测试脚本按用途分目录：`test/qa/`（门禁，保留）、`test/debug/`、`test/scratch/`（一次性，可删）

## 操作

| 按键 | 功能 |
|---|---|
| WASD | 移动 |
| Shift / 空格 | 疾跑 / 跳跃 |
| 鼠标 | 瞄准（狙击枪右键开镜） |
| 1-4 | 手枪 / 步枪 / 狙击 / 霰弹 |
| R | 换弹 |
| F | 近战（匕首/枪托，55 伤害） |
| G | 手雷（2.8s 引信，范围 5m，100 伤害衰减） |
| H | 烟雾弹（10s 持续，遮挡弹道与 AI 视线） |
| E | 机制交互：配电箱断电/抢修、空投补给箱拾取（靠近尸体按 E 搜刮） |
| Z / X / C / V | 对讲机指挥：集合 / 自由 / 进攻 / 防守 |
| B | 背包（仓库互通） |
| M | 迫击炮视角（曲射火力，20s 冷却，10 发/局） |
| Tab | 记分板 |
| Esc | 暂停 / 释放鼠标 |

## 武器数据（有 rationale 的设计值，未经 playtest 的部分标 [PLACEHOLDER]）

| 武器 | 伤害/发 | 弹匣/备弹 | 射速 | 换弹 | 备注 |
|---|---|---|---|---|---|
| P-9 手枪 | 25 | 12/48 | 360 | 1.4s | 4 发击杀，兜底武器 |
| AR-15 步枪 | 17 | 30/90 | 600 | 2.2s | 6 发击杀，TTK≈0.5s [PLACEHOLDER] |
| M24 狙击 | 90 | 5/15 | 30 | 3.0s | 爆头 ×2 秒杀 |
| SPAS-12 霰弹 | 9×8 弹丸 | 8/24 | 55 | 2.6s | 8m 内满伤，42m 外衰减到 1/4 |

头部分伤 ×2（霰弹 ×1.5）。AI 伤害倍率 0.8（公平性调节，[PLACEHOLDER]）。

## 联机协议（客户端 ↔ 服务端）

- `hello {mode: list|create|join, name?, roomId?}` → 房间列表 / 建房 / 入房（可带昵称）
- `welcome {pid, roomId, host, hostId, players[]}` → 进入**大厅过渡页**（创建/加入房间后等待，不直接开战）
- `start`（仅房主可发）→ 服务器广播给房间所有人，统一进入对战
- `peerJoin` / `peerLeave` → 大厅玩家列表实时刷新（对局中则房主增删远端单位）
- `rooms` / `roomEnd` / `leave` → 列表 / 房主离开房间解散 / 主动离开
- `state {p}` 客户端上报自身状态（10Hz，仅路由给房主）
- `event {e}` 事件中继（射击命中/爆炸/投掷/击杀/炮击预警，广播给房间内其他人）
- `states {score, time, players, ai}` 房主全量快照（10Hz 广播）

> 联机流程：创建/加入房间 → **大厅等待**（房间号 + 成员列表）→ 房主点「开始对战」广播 `start` → 所有人进入对局。房主为权威模拟端，承担 AI/伤害/状态模拟；非房主只模拟自身并接收快照。

## 地图（数据驱动，3 张）

地图由 `js/maps/` 下的数据驱动注册（`MapRegistry`），新增地图无需改引擎代码；地图以 **JS 模块注入**（非 fetch JSON），`file://` 离线可用。三图均为「据点占领」玩法：A/B/C 三据点 + 红蓝各 10 出生点，A* 全连通。

| id | 名称 | 尺寸 | 玩法差异 |
|----|------|------|----------|
| `suburb` | 城郊战场 | 300×300 | 基准图：十字干道 + 中央广场，仓库/公寓/民居环绕，开阔与巷战各半；据点间距 ≈58m · **专属机制：空投 + 炮击** · **缩圈：心(150,150) r220→31** |
| `port` | 夜港工业区 | 260×260 | **快节奏 / 高垂直度**：冷蓝夜景、窄街（10~14m）密掩体、3 处可攀屋顶制高点、集装箱切碎视线、近雾（40~200）压缩交战距离，遭遇战一触即发 · **专属机制：探照灯 + 断电** · **缩圈：心(165,150) r230→32** |
| `desert` | 荒漠前哨 | 340×340 | **慢节奏 / 长视线**：暖橙日照、据点间距 ≈90m、建筑少而大且彼此远离、沙丘起伏（amp 7.0）制造天然遮蔽与高地，穿越空地需掩护推进 · **专属机制：沙暴 + 水塔** · **缩圈：心(110,140) r315→44** |

### 地图选择

- **菜单选择**：主菜单顶部地图按钮行单选，点击即时背景预览，「开始单人战役」使用所选地图。
- **URL 参数**：`index.html?map=port` / `?map=desert` 直接进入指定地图；缺省/非法回退默认图（suburb）。
- **LOD 逃生舱**：`?detail=off` 关闭全部建筑精修（暗腔/雨落管/AC 机组/檐口/分缝），碰撞与玩法不变，低端机可用。
- **色盲模式**：`?cvd=1` 切换蓝-橙安全色相轴，红蓝队伍更易分辨。

建筑程序化精修（纯视觉、不产碰撞）：窗内暗腔、雨落管、屋顶 AC 机组、檐口、角柱、分缝、建筑染色 tint，随 `detail` 等级合批为单 mesh。

## 缩圈玩法（v1.3）

> 三图叠加的**时间压力层**，不改变赢法（比分制保留、不产分、不改结算）。圈外按阶段**递增环境伤害**制造向心紧迫感；三图专属机制照常运行、伤害可叠加（如 desert 沙暴 + 圈外 = 双压）。引擎见 `js/mechanics.js`（`Mechanics.zone`），数据 `mapDef.zone`，设计 `design/maps/zone-br.md`，架构 `docs/architecture/zone-architecture.md`，视觉 `art/zone-visual.md`。

- **蓝圈阶段（5 阶段同心圆，圈心固定）**：开局白实线圈 = 当前安全区；每隔一段对局时间，电蓝虚线预告圈出现 → warnSec=5 蓝圈闪烁 + HUD「⚠ 安全区即将收缩！」→ **2s 线性收缩**到新圈。三图圈位/终圈不同：suburb 心(150,150) r220→**31**（小终圈贴脸快节奏）· port 心(165,150) r230→**32** · desert 心(110,140) r315→**44**（大终圈最宽松）。
- **圈外伤害递增**：1 → 3 → 6 → 10 → 15 HP/s（随阶段，2Hz 节流）。环境伤害**不产分、不算击杀**（owner=null）。圈外不会秒杀，但越拖越疼——把玩家"赶进圈"而非"毒死"。
- **AI 进圈**：圈外无敌意的 AI 会以**奔圈内最近可达点**为最高优先级（覆盖小队目标）；圈外有敌人时保持交战不受扰；救起/出生在圈外 → 首帧即奔圈（v2.1 吃鸡制下无重生，AI 奔圈逻辑仅适用倒地爬行/开局）。AI 与玩家同样吃圈伤。
- **桥梯共存**：三图新增天桥/楼梯（port 32 栋 / desert 16 栋 / suburb 14 栋）；**桥面只挡弹道、桥下实际可通行**（玩家与 AI 都可从桥下穿过，不影响导航）。
- **缩圈视觉**：当前圈白实线 `#f0f4f8` + 白辉光、预告圈电蓝虚线 `#2f7fe8`、圈外电蓝 vignette 随距离加深、小地图双圈；全部 `fog:false`（沙暴/夜港雾不吃圈）。
- **联机**：房主权威模拟缩圈 + `m_zone` 事件广播，客户端本地平滑渲染圈（不裁决伤害）。

## AI 战术升级与地标（v1.4）

> **AI 战术升级**（`js/ai.js`，只改决策层、**数值手感零改动**——命中/反应/射速/移速/伤害与之前完全一致）：AI 现在"更聪明"而非"更准"。设计规格 `design/maps/ai-tactics.md`，架构 `docs/architecture/ai-tactics-architecture.md`，门控 `docs/quality/maps-qa-v14-2026-08-06.md`。

- **沙暴庇护**：荒漠风暴期，暴露的 AI 会 12m 内就近躲进建筑（`_inShelter` 庇护）；无庇护则奔圈内/掩体。
- **探照灯避光**：夜港被光锥扫到 >2s 的 AI 会主动移出光锥；**断电窗口**（全港灯灭）AI 攻击欲望 +20%（趁黑推进）。
- **缩圈边打边退**：圈外与敌交火时，AI 向圈内方向边打边退（不打断射击，环境压力只改移动偏向）。
- **烟雾掩护**：过开阔地（无掩体 + 敌射界）且带烟 → AI 投烟穿烟推进。
- **护甲/医疗**：护甲 <50 且带护甲包 → 主动使用；低血且有敌视线 → 先撤到掩体再治疗。
- **残血优先**：目标选择优先击杀残血（hp<30）敌人；被探照灯曝露的目标优先级 +1（集火）。

> **四地标**（BuildingLib 新增 base/refinery/stadium/megatower，对应 `models/buildings/*.glb`）：体育场 stadium→城郊 (180,150) · 炼油厂 refinery→夜港 **(137,156)**（中央装卸场北侧，小地图金色菱形标记）· 基地 base→荒漠 (60,160) · 巨塔 megatower→荒漠 (232,70)（20×20×28 四腿式、底部可通行、暂不可登顶）。**小地图**会以金色菱形标记四地标，与据点圈分层。

## 地图专属玩法（v1.2）

> 每图一个独占机制，叠加在据点占领之上（不改变 A/B/C 占点与胜利条件）。机制引擎见 `js/mechanics.js`，数据在 `js/maps/*.js` 的 `mechanics` 字段，设计规格见 `design/maps/mechanics.md`。机制对象均为纯视觉/逻辑（不入碰撞体，不阻塞移动与导航）。数值多标 `[PLAYTEST]`，首轮内测收敛。

### port 夜港 · 探照灯 + 断电

- **探照灯**：4 盏巡逻灯（40~55m 光锥）往复扫描全场，被扫到即**曝露**——小地图出现警示点（持续数秒）+ HUD「⚠ 已曝露」；AI 被照同样标点（集火信号）。过街必被照，被照必曝露。
- **断电**：配电箱 2m 内按 **E** → 全港断电 **30s**（环境光变暗，夜战窗口，自己不再被曝露）；断电方进入 45s 队冷却。
- **抢修**：断电期内**任意一方**到任一配电箱按 E → 立即恢复供电（灯重新扫描），抢修方进入 45s 队冷却。一断一修 = 攻防易手。

### desert 荒漠 · 沙暴 + 水塔

- **沙暴**：30s 风暴 / 90s 平静循环。风暴期浓雾（15~70m 视野）、暴露者每秒 **4HP** 灼伤（建筑内 / 掩体后 / 水塔圈内庇护）、AI 对 **20m 外**命中率 ×0.5。
- **水塔**：塔圈（r=10）可占领（圈内人多者推进，单人约 12s），占领方圈内回血 **5HP/s**；敌方圈内不回血、可反抢。水塔独立于 A/B/C，不产分，是「续航资源点」。

### suburb 城郊 · 空投 + 炮击

- **空投**：每 60s 随机选点投补给箱——先 5s 信标警示（小地图标记 + 光柱），落地后按 **E** 拾取：**+50 HP / +30% 弹药**，先到先得（红蓝都能捡）。
- **炮击**：每 45s 中央广场 zone 内**随机落点**炮击——4s 红色警示圈（半径 8m = 爆炸半径）后落弹，60 伤害、掩体可挡。占 A 要「炮击窗口躲、窗口后回」。

### 小地图标记速查

| 标记 | 含义 |
|---|---|
| 琥珀警示点 | port 探照灯曝露（单位被照到，持续数秒） |
| 蓝色信标/光柱 | suburb 空投即将降落 / 补给箱位置 |
| 红色警示圈 | suburb 炮击落点（4s 后落弹） |

## 外部纹理扩展

所有材质默认程序化生成（canvas）。想用真实贴图，在页面控制台设置后刷新：

```js
window.TEXTURE_OVERRIDES = {
  brick: '/textures/brick.jpg',   // 墙面
  grass: '/textures/grass.jpg',   // 地形
  asphalt: '/textures/road.jpg',  // 道路
  concrete: '/textures/conc.jpg', // 掩体/废墟
  sandbag: '/textures/bag.jpg',
  metal: '/textures/metal.jpg',
  floor: '/textures/floor.jpg',
  roof: '/textures/roof.jpg',
  sand: '/textures/sand.jpg',        // 沙地/土路（desert 地形）
  plaster: '/textures/plaster.jpg',  // 灰泥墙（desert 建筑主墙）
  corrugated: '/textures/corrugated.jpg', // 波纹钢板（port 厂房）
  rust: '/textures/rust.jpg'         // 锈蚀金属（port 钢结构）
};
```

## 已知简化（诚实清单）

- **GLB 插槽休眠（ADR-003）**：建筑支持 opt-in 外部 `.glb` 视觉插槽，但当前**未启用**——本项目无构建步骤，Three.js r160 的 GLTFLoader 为 ESM-only（无 UMD），且 `file://` 离线约束下不加载外部 GLB。所有建筑走程序化几何，碰撞/导航/小地图始终来自程序化数据；`glb:` 字段为占位声明，启用需引入构建/importmap 并另立 ADR。
- 非房主客户端对自身射击做本地预演（命中反馈即时），伤害最终由房主二次裁决（LAN 信任模型）
- 烟雾只挡弹道与 AI 视线，不挡手雷爆炸；AI 的"躲避"为位移行为，无真正的掩体覆盖系统 [PLACEHOLDER]
- AI 命中率/反应时间为手调常数（`AIBrain.tryShoot` 的 acc 模型），建议 playtest 后重标
- 迫击炮为"空中俯瞰选点"视角，炮弹从玩家脚下弹道发射，2.6s 落达
- `rust`/`sand` 程序化纹理已接线：port B2 塔吊控制楼 `detailTex: rust`（锈蚀钢构）；desert 土路与中央围挡用 `sand`（土路已弃用 sandbag 铺路）。仍有部分建筑/道具未覆盖，可按需继续接线
- desert D1 南门/东门已避开窗位修复（碰撞体 213→215 为门-窗间合法薄墙，非墙墩），A* 全通；门窗洞扫描线重叠合并仍留 backlog（长线）
- **地图机制联机现状（v1.2，房主权威）**：断电/抢修、沙暴、空投、炮击事件（`m_storm` / `m_pwr` / `m_airdrop` / `m_arty`）客户端注入生效、非房主不跑 sim；但**水塔占领 `cap` 事件客户端暂无 handler** → 联机时水塔占领/易主视觉仅房主可见（backlog，单机不受影响）
- 探照灯 `tiltDeg` 数据保留但暂无物理倾斜；曝露小地图 ping 位置公式用平方距离 → 远距离标记落点偏移（纯 cosmetic，backlog）
- 机制数值多为 `[PLAYTEST]` 标注（扫速 / 冷却 / 伤害 / 回血等），建议首轮内测后收敛一次
- **缩圈为同心圆固定圈心（v1.3 契约）**：不做移动圈（蓝圈向新位置平移），移动圈进 backlog 待后续版本评估（需 phase 级 center 扩展）
- 缩圈数值 `[PLAYTEST]`：伤害曲线 1→15、终局圈 r31/32/44、desert 双压强度、桥面 6m 可攀登性——建议首轮内测收敛
- 设计口径待确认（非阻塞）：设计 §6.1「圈外有敌 → 走位偏圈内」未实现（实现与架构一致：engage 完全不受扰）；atSec 时序语义字面出入（警示→收缩间隔均 5s 体验一致）；`escapeDest` 同心环采样非「严格最近」
- **y-碰撞站立支持 P2**（backlog）：当前移动为 2D x/z 判定 + 按高度跳过；桥下通行已由 overhead 分流解决，完整 y 轴站立/攀爬留 P2
- `#radio` 阶段通知通道（backlog）：缩圈阶段切换进对讲机通知语音通道待接入；收缩动画细化（方向箭头 / 环刻度提示）待做