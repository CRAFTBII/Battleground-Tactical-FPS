# 吃鸡淘汰制 v2.1 质量门控 · 2026-08-07

> 范围：v2.1 吃鸡制（去重生 + 观战 + AI 救援强化）实现验证
> 规格：`design/maps/respawn-rework.md`（v2.1 修订节）· 变更：`CHANGELOG.md [1.6.0]`

## 结论：PASS（28/28 断言 + smoke 全绿 + 语法检查全过）

## 1. 测试矩阵

| # | 断言组 | 断言数 | 结果 |
|---|--------|--------|------|
| 1 | 常量调参（BLEED_OUT=20 / MEDIC 80 / DEFAULT 12 / 观战常量） | 4 | 全 PASS |
| 2 | 开局（蓝 9 AI + 玩家 / 红 10 AI / 无重生计时） | 4 | 全 PASS |
| 3 | AI 死亡不重生（无 respawnT、快进 9s 仍死亡、存活数减少） | 4 | 全 PASS |
| 4 | 倒地救援保留（倒地→流血 20s→读条 3s→残血 35 恢复） | 3 | 全 PASS |
| 5 | 玩家死亡→观战（跟随 AI / E/Q 切换 / 目标死亡自动切 / 相机跟随） | 8 | 全 PASS |
| 6 | 全灭提前收局（红灭→蓝胜 / 蓝灭→红胜 / 倒地不算灭） | 3 | 全 PASS |
| 7 | 流血致死闭环（倒地→流血归零→最终死亡→观战） | 2 | 全 PASS |

额外门控：
- `test/smoke.js` 无头冒烟：全绿（三图构建 + 武器/建筑断言 + 结算流程）
- 全部改动文件 `node --check` 语法通过（core/game/combat/ai/net/main）

## 2. 实现清单（改动文件）

| 文件 | 改动 |
|------|------|
| `js/core.js` | `BLEED_OUT 12→20`、`MEDIC_REVIVE_RANGE 60→80`、`DEFAULT_REVIVE_RANGE 8→12`；新增 `SPECTATE_DIST/SPECTATE_HEIGHT` |
| `js/game.js` | `killUnit` 删玩家重生倒计时 + AI respawnT；新增 `startSpectate/spectateNext/updateSpectate`（第三人称跟随，E/Q 切换，目标死亡自动切换）；`checkElimination/endMatchByElim`；`toDead` 删 prepareCover；`Game.update` 删重生循环；`downHud` 加观战提示 |
| `js/combat.js` | 死亡观战 E/Q 切人（优先于其他按键） |
| `js/ai.js` | 医疗兵救援优先级提到 engage 前 + 读条不因看见敌中断（只受击打断）；非医疗兵近敌判定 15m→10m |
| `js/net.js` | 客户端死亡直接进观战；删房主/客户端 respawn 分支 |
| `js/main.js` | 抽 `backToMenu` 共用；绑 `#spectateQuit` |
| `index.html` | `#deathOverlay` 改观战文案（pointer-events:none）+ 新增 `#spectateInfo/#spectateQuit` |
| `test/qa/_qa_v21_elimination.js` | 新增 28 断言专项 QA |

## 3. 行为口径（与 v2.0 的差异）

1. **玩家**：最终死亡（处决/流血/环境）→ 不再 5s 重生，直接观战；观战 = 第三人称跟随存活蓝队 AI，E/Q 切换，目标倒地/死亡自动切下一个；`#spectateQuit` 可中途返回主菜单。
2. **AI**：最终死亡后不重生，尸体保留可搜刮（loot/掉落实体逻辑不变）；`respawnT` 不再设置。
3. **救援**：倒地→流血 20s→队友读条 3s→残血 35 恢复；玩家救 AI / AI 救玩家 / AI 救 AI 全部保留。医疗兵更坚决（有敌也救、读条只受击中断）。
4. **胜负**：600s 时间结算兜底 + 一方全员 `life==='dead'` 提前收局（倒地不算灭——可被救）。玩家观战中队伍获胜/失败同样结算。
5. **数值红线**：acc/移速/射速/伤害/护甲吸收等手感数值零改动（只调机制层参数）。

## 4. 已知边界

- 观战相机第三人称可能穿墙（原型阶段接受，未做射线避让）。
- 观战中死亡 overlay 为 45% 半透明（不遮挡战场视野）。
- `_qa_v15_respawn.js` 重生断言已失效（v2.0 历史记录，头部已标注）。
- `respawnPlayer/respawnAI/smartSpawn` 保留但不再被调用（防回归）。
