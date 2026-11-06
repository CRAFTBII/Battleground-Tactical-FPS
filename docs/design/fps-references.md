# 主流 FPS 玩法 / 关卡 / 建筑参考

> 目的：不是“抄一张图”，而是把成熟 FPS 的设计约束翻译成这个项目的可执行规则。  
> 关联：[玩法设计](gameplay-v5.md) · [建筑套件](building-kit-v5.md)

## 1. 游戏拆解

### 1.1 Counter-Strike 2 / Dust2

**值得借鉴**

- **三路结构**：两条进攻路线选择太少，四条防守方守不住；5v5 爆破的甜点是 3 条主要路线。
- **相会点（meeting point）**：每回合双方第一次交火的区域；它决定地图节奏。
- **阻塞点（choke point）**：窄门/隧道/拐角连接两个大区域，强制交火；数量可以比相会点多。
- **过渡区**：阻塞点前的安全区，给投掷物/战术准备留空间。
- **角度与清点**：每个拐角/掩体都可能藏人；地图要提供“可清、可反制”的角度，而不是绝对优势位。
- **视线长度分级**：长枪线、中距离、近距离 CQB 都要有，且用掩体/高度切断。
- **材质与穿透**：不同掩体对子弹的阻挡不同，增加战术深度（本项目 MVP 可不做穿透）。

**不要照搬**

- 像素级角度、烟点/闪点依赖、极强竞技平衡；本项目是单人 + AI，先保证可读和可玩。
- 过高垂直度会让雷达/声音判断困难；本项目只做“可读的两层”。

来源：
- [The dos and don'ts of Counter-Strike level design](https://steamcommunity.com/sharedfiles/filedetails/?id=1110438811)
- [CSGO 关卡设计要点（腾讯游戏学堂）](https://m.gameinstitute.qq.com/community/detail/133729)
- [Dust II · Counter-Strike Wiki](https://counterstrike.fandom.com/wiki/Dust_II)
- [FPS 玩法设计议程（六）：通路设计](https://m.sohu.com/a/216528149_483399/)

### 1.2 Valorant

**值得借鉴**

- **双点 + 中路**：进攻方左右两条路线 + 中路夹击；防守方出生点能快速轮转。
- **路线身份**：每条路线有不同空间性格（窄巷/长街/高低差/传送门），玩家能记住“这是哪”。
- **地图机关**：门、传送、可破坏玻璃/绳索，用机制改变路线，而不是加更多房子。
- **垂直与侧翼**：Ascent/Bind 的 mid、heaven、short 等形成多层夹击。
- **明确的站点入口**：每个 site 有 2–3 个可控入口，防守方有可守的角。

**不要照搬**

- 技能/烟雾/传送需要大量平衡与 UI；MVP 先用基础烟雾/闪光/破门。

来源：
- [Valorant Map Guide: Bind](https://steelseries.com/nl-nl/blog/valorant-map-guide-bind-259)
- [Valorant Map Guide: Ascent](https://steelseries.com/zh-hk/blog/valorant-map-guide-ascent-280)
- [从 Valorant 看战术竞技创新](https://bbs.gameres.com/thread_910237.html)

### 1.3 Battlefield / 突破模式

**值得借鉴**

- **分区（Sector）与 POI**：大地图按区域推进，每个区域有前置防线、死亡区、最终防线、点位内部争夺。
- **防线节奏**：攻方突破一层后有短暂缓冲，再进入下一层；最激烈战斗在最终防线/点位。
- **重生距离**：防守方出生点更靠近点位，攻方需要前线重生/推进；出生距离直接决定难度。
- **并行双点/线性双点**：两个点同时争夺会拉长对局；线性推进更容易控制节奏。
- **掩体与载具/火力**：大地图需要载具/火力支援打破僵局；本项目不做载具，所以地图必须更小、更密。

**不要照搬**

- 64 人、载具、大地图；本项目 4 人小队 + 12 守军，地图 160m。
- 过多防线会让单人小队疲劳；MVP 只做“外围—目标—撤离”三层。

来源：
- [攻防大战场地图规划与设计（腾讯游戏学堂）](https://www.gameres.com/916741.html)
- [Battlefield 6 Open Beta modes](https://www.battlefield.com/games/battlefield/battlefield-6/news/everything-you-need-to-know-for-the-open-beta)
- [Multiplayer Level Design: Essential Techniques](https://games.themindstudios.com/post/multiplayer-level-design-techniques/)

### 1.4 Insurgency: Sandstorm

**值得借鉴**

- **致命 TTK**：几发子弹决定生死；玩家尊重掩体、声音、弹药。
- **极简 HUD / 无准星**：信息来自声音、动作、环境；增强沉浸。
- **HDR 音效**：脚步、换弹、枪声方向是核心信息。
- **小队协作**：职业分工、侦察/支援、co-op 任务；AI 敌人有压制和推进。
- **目标明确**：推进/防守/清剿，不做无意义大地图。

**不要照搬**

- 过度拟真/无 HUD 会让新玩家挫败；MVP 保留准星、弹药、目标提示，但减少小地图信息。

来源：
- [Insurgency: Sandstorm Steam 商店页](https://store.steampowered.com/app/581320/Insurgency_Sandstorm/)

### 1.5 Escape from Tarkov

**值得借鉴**

- **搜—打—撤**：带入装备、搜刮、撤离；风险/回报是核心张力。
- **声音与去 UI 化**：脚步、材质、方向、换弹声都能提供信息。
- **地图地标与路线记忆**：玩家靠地标/房间名导航，而不是一直看小地图。
- **撤离点/条件撤离**：路线规划与时间压力。
- **任务驱动**：给玩家进入不同区域的理由，而不是只有“杀光”。

**不要照搬**

- 永久掉落、复杂健康/经济、跳蚤市场；MVP 用“局内风险 + 结算奖励”，不做长期惩罚。
- 过度硬核的未知机制；先让玩家看懂。

来源：
- [Escape from Tarkov review · GamesRadar](https://www.gamesradar.com/games/fps/escape-from-tarkov-review/)
- [Escape From Tarkov tips · GameSpot](https://www.gamespot.com/gallery/escape-from-tarkov-tips-everything-you-need-to-know-to-survive/2900-7273/)
- [为什么很多撤离射击失败（GAMES.GG）](https://games.gg/ja/news/%E3%81%AA%E3%81%9C%E5%A4%9A%E3%81%8F%E3%81%AEextraction-shooter%E3%81%AF%E5%A4%B1%E6%95%97%E3%81%99%E3%82%8B%E3%81%AE%E3%81%8B/)

### 1.6 Call of Duty / 三路 TDM

**值得借鉴**

- **三路 + 中央冲突点**：Scrapyard/Highrise 等地图用三条 lane、长视线侧路、中央热点。
- **权力位（power position）**：高位/窗口有优势，但必须有反制路线。
- **重生流动**：出生点不能互相直视；重生后 3–5 秒能进入战斗。
- **快节奏**：TTK 短、移动快、交战频繁；但本项目是战术 RAID，节奏要更慢、更有信息。

来源：
- [Call of Duty Mobile Map Snapshot: Scrapyard](https://blog.activision.com/au/en/call-of-duty/2020-01/Call-of-Duty-Mobile-Map-Snapshot-Scrapyard)
- [Call of Duty Mobile Map Snapshot: Highrise](https://blog.activision.com/call-of-duty/2020-07/Call-of-Duty-Mobile-Map-Snapshot-Highrise)
- [Call of Duty Mobile Map Snapshot: Meltdown](https://www.callofduty.com/ca/en/call-of-duty/2020-03/Call-of-Duty-Mobile-Map-Snapshot-Meltdown)

### 1.7 Team Fortress 2 / 关卡理论

**值得借鉴**

- **分阶段推进**：每阶段布局不同，攻方/守方出生点随阶段移动。
- **据点/旗帜分离**：两个目标可以制造“攻哪里”的决策。
- **非对称阶段**：不必每段对称；用空间变化维持新鲜感。

来源：
- [TF2 Level Design / Design Theory](http://developer.valvesoftware.com/w/index.php?oldid=139999)

---

## 2. 关卡设计规则（翻译成本项目）

### 2.1 路线

- 主路线 3 条：西线（CQB）/ 中线（长枪线）/ 东线（潜行侧翼）。
- 每条路线至少 1 个 choke point、1 个 transition（投掷物准备区）、1 个可绕行的侧翼连接。
- 相会点（第一次交火）放在地图 30–40% 处，不要一出生就撞脸。
- 目标点入口 2–3 个，禁止单入口死胡同。

### 2.2 视线

- 长视线（>40m）只放在中线/高处，且尽头有地标/掩体；
- 中距离（15–40m）是步枪主场；
- 近距离（<15m）用于室内/集装箱/拐角；
- 每个窗口/高台至少有一条反制视线或侧翼。

### 2.3 掩体

- 掩体分“挡住视线”和“挡住火力”两类；
- 低掩体（0.9–1.2m）可蹲/翻越；高掩体（1.8–2.8m）可站；
- 掩体间距 3–8m，形成推进节奏，不要一条直线摆满；
- 掩体材质符合场景（港口=集装箱/缆绳/钢板；村庄=土墙/木箱；沙漠=石块/油桶）。

### 2.4 垂直

- 只做两层可读空间；上层有 2 条上下路径；
- 高位视野强，但入口/楼梯可被反制；
- 屋顶/猫道用栏杆和灯光标记可走边界。

### 2.5 可读性

- 避免大面积纯红/纯蓝干扰敌人轮廓；
- 目标/门/楼梯用暖光、形状、地标区分；
- 每个区域一个独特地标（水塔、吊机、钟楼、编号货架）；
- 地面磨损/顶光引导主路线。

---

## 3. 建筑建模参考

### 3.1 模块化套件（Modular Kit）

行业常用流程：

1. 先定网格（2m/4m/0.5m）和 pivot（底面中心）；
2. 墙/楼板/屋顶/门窗/楼梯/栏杆做成可拼接模块；
3. 用 Trim Sheet 复用墙面/檐口/窗框/金属边，而不是每栋楼独立贴图；
4. 在引擎里用模块搭灰盒，确认尺寸/门/楼梯/视线，再做高模/贴图；
5. 预制体导出，运行时只实例化。

参考：
- [The Workflow Behind an Abandoned Bar Modular Environment · 80.lv](https://80.lv/articles/the-workflow-behind-an-abandoned-bar-modular-environment)
- [SanXia Street 1940: Modular Approach, Trim Sheets, Decals · 80.lv](https://80.lv/articles/005cg-001agt-sanxia-street-1940-modular-approach-trim-sheets-decals)
- [Creating Environments efficiently through Iteration and Trim Sheets](https://www.linkedin.com/pulse/creating-environments-efficiently-through-iteration-trim-pichler)
- [UE5 环境艺术：模块化建筑套件与 Trim Sheet（课程说明）](https://www.bilibili.com/video/BV1v7S1BGESJ)
- [UE4 沙漠场景：模块化套件与装饰板](https://www.3dcat.live/share/ue41/)
- [纽约公寓楼 UE4 场景分解（pivot/蓝图/模块）](https://zhuanlan.zhihu.com/p/163777196)

### 3.2 尺寸/技术要点

- 门洞 1.4×2.4m、层高 3.6m、楼梯 0.3×0.3m；所有模块以 0.1m 网格对齐。
- 墙厚 0.24–0.3m；窗台 0.9–1.1m；女儿墙 1.0m。
- UV：非重叠、纹素密度一致；Trim Sheet 2K；道具 1K 图集。
- LOD0/1/2；碰撞代理 ≤视觉 15%；NAV 按层/楼梯/门拆。
- 原点：footprint 中心地面；导出前应用旋转/缩放。
- 每栋楼 draw call ≤6；三角预算见 building-kit-v5.md。

### 3.3 室内可读性

- 单盏主灯 + 窗光/顶灯罩/踢脚线/梁柱形成明暗层次；
- 不要靠大量实时点光；用 emissive 灯罩 + 少量补光；
- 室内必须有 1 个视觉锚点（招牌/货架/海报/配电箱），避免纯色盒子；
- 入口/出口用门框/地面材质/灯光区分。

---

## 4. 对本项目的取舍

| 参考 | 采用 | 不采用 |
|---|---|---|
| CS2 | 三路、相会点、choke point、transition | 像素角、烟点依赖、5v5 经济 |
| Valorant | 双点/路线身份、垂直侧翼、机关门 | 技能系统、传送门平衡 |
| Battlefield | 分区/防线/出生距离/节奏 | 64 人、载具、大地图 |
| Insurgency | 致命 TTK、极简 HUD、声音、小队 | 完全无 HUD、过度拟真 |
| Tarkov | 搜打撤、风险回报、地标导航 | 永久掉落、复杂经济、健康系统 |
| COD | 三路、权力位、重生流动 | 快节奏 TDM、连杀奖励 |
| TF2 | 阶段推进、非对称 | 卡通美术、职业系统 |

## 5. 参考结论

1. **先做小图**：160m、3 路、2 目标、1 撤离点，比 3 张 300m 城镇更容易好玩。
2. **先做灰盒**：用模块灰盒跑通门/楼梯/视线/AI，再投入贴图/高模。
3. **AI 靠区域/路线**：巡逻区、调查、侧翼、QRF，比全局寻路 + 全队同一目标更可控。
4. **目标 + 撤离**：给玩家明确的“为什么前进/为什么撤”，比单纯占点更有张力。
5. **建筑为玩法服务**：入口、窗口、楼梯、掩体先满足战斗，再谈美术细节。
