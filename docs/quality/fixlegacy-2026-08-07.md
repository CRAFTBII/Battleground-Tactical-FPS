# 质量门控报告 · 遗留问题修复（smoke 首次全绿）

- **日期**：2026-08-07
- **版本**：[1.11.4]
- **范围**：持续 5 轮的 smoke 沙暴 3 项失败 + 2 项新增崩溃、3 队出生空置、AI 迫击炮发射点

## 修复明细

### 1. settings.js 集成缺口（smoke 2 项崩溃，最高优先）
- **现象**：`对局模拟崩溃: ReferenceError: Settings is not defined | combat.js:876`
- **根因**：外部工作流新增键位系统 `js/settings.js`（combat.js 按键改走 `Settings.key('moveF')` 等），**index.html 已正确引入（combat 之前），但 15 个测试桩的 scripts 列表漏了** → 桩环境跑 combat.js 时 Settings 未定义
- **修复**：15 个测试桩（smoke + v21~v28 等）批量在 combat.js 前补 `'js/settings.js'`

### 2. 沙暴庇护断言坐标过时（1 项）
- **现象**：`shelterDest 返回 null` / `tacticalDest 未给 shelter`
- **根因**：desert base 地标已重排到 (20,200)（注释仍写 60,160），测试写死位置 (70,186) 距 base 52m，12m 内零庇护（调试证实 shelter=0 footprints=0）——**测试场景过时，非游戏 bug**（AI 在有庇护处确实能找到庇护）
- **修复**：动态取 `Mechanics.state.footprints` 第一个庇护区南侧 5m 做测试位

### 3. 风暴命中假 miss（1 项）
- **现象**：`风暴 d≤20 AI 命中被错误减半`（tgt.hp 未掉）
- **根因**：测试把第一个 AI 和 tgt 都放 (170,170) **同点**，resolveShot 射线先撞第一个 AI → tgt 没吃到伤害；且原位置 (200,195)/(200,200) 在主堡内被 collider 挡
- **修复**：aiU(170,165) 打 tgt(**178,170** 对角位)，u(170,170) 不在射线上

### 4. 3 队出生 Q4 空置（v2.8 遗留）
- 3 队时蓝队改 Q1+Q4（对角双象限）、红 Q2、绿 Q3 → 四角全覆盖（验证脚本 PASS）

### 5. AI 迫击炮发射点硬编码（v2.9 遗留）
- 原 `(182,2,182)` 在 desert 510 下到远端玩家超射程（150~420m）→ 改为玩家反方向 120m（飞行距离恒在射程内）

## 验证结果

| 测试 | 结果 |
|------|------|
| v21_elimination | 28 PASS |
| v22_hate | 12 PASS |
| v23_loot | 21 PASS |
| v24_revivekit | 16 PASS |
| v25_hpguard | 13 PASS |
| v26_spread | 17 PASS |
| v27_mission | 20 PASS |
| v28_multiteam | 19 PASS |
| **smoke** | **✅ 无头冒烟测试全部通过（历史首次全绿）** |

## 不在本次范围（已记录）

- **v12/v13/v14 旧机制测试**：地图 ×1.5 前坐标假设过时（如 suburb 300 时代坐标），核心机制已被 v21~v28 覆盖——修复=重写整套坐标断言，收益低，标记过时
- **联机多队**：大厅仍 2 队（teamCount 广播通道已留），功能缺口非 bug，需大厅 UI 扩展
