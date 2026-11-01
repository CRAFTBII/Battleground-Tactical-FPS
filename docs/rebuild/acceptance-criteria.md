# v4 验收标准

所有验收必须在实际运行时执行并保存报告。仅通过 JSON 检查、只看 Blender 截图或运行旧 smoke test 不足以证明地图已修复。

## P0 必须全部通过

### 资产
- GLB 能解析且没有缺失资源、NaN、零面积几何、未应用根节点缩放。
- Catalog 与 GLB 世界包围盒逐轴误差 ≤0.01m；例外必须记录原因。
- 原点 footprint-center-ground、Y-up、默认 scale=1。
- 每个可见阻挡面有 COL 或明确豁免；每个可走面有 NAV。

### 碰撞
- 墙体内外面、门窗、柱、沙袋、战壕多高度、多角度射线采样；COL 与预期表面偏差 ≤0.03m（装饰豁免除外）。
- 胶囊正常/冲刺/斜向移动和跳落测试不能穿墙。
- 门洞、窗口、走廊、楼梯和桥下净空不得被错误封死。
- 地面/楼板/楼梯支撑稳定；落地高度由物理接触决定。
- 同一地图加载/卸载 20 次，无残留 collider、监听器或 geometry。

### 角色与相机（2.5m 基准）
- Actor Profile 身高 ≤2.5m；胶囊半径 0.45m、总高 2.5m、台阶 0.55m。
- 相机眼高 = profile.eyeHeight（默认 2.3m），不穿天花板/门楣；fov/near/far 来自 profile。
- 第一人称武器/枪口/投掷锚点来自 profile.anchors，不写死 1.7m 坐标。
- 门净高 ≥3.0m、净宽 ≥1.6m、走廊 ≥2.2m、净层高 ≥3.8m。

### 导航
- 每个 NAV surface 有 floorId / 高度 / 净空。
- 每个 navLink 两端可达，角色胶囊实际能通过。
- 无穿墙路径、悬空节点、串楼层、桥面/桥下错层。
- 每个 team spawn 至至少一个 objective 有路径；动态关闭的门能禁用 link。

### 地图与玩法
- 出生点无碰撞重叠并落在有效 NAV 面。
- objective 绑定正确高度层。
- AI 视线、射击、寻路和掩体统一访问 Physics/Nav 服务。
- 单机完整对局与 LAN 加入/退出成功；双方 MapSpec hash 一致。

## P1 性能
记录建筑数、三角面、static collider 数、nav cells/links、draw calls、帧时间、AI path queries。至少 20 AI 场景跑持续战斗；路径请求必须有节流、缓存和取消。与 main 已知 suburb 约 37 draw calls / 98.9k triangles 作参考，不能为 draw calls 牺牲碰撞正确性；硬预算在目标设备实测后制定。

## 证据包
每次验收保存 Catalog/尺寸检查 JSON、墙体射线采样报告、角色 controller 测试、导航 floor/link 可视化、spawn/objective 连通性、浏览器控制台记录、20 AI 性能 CSV。

## 禁止冒充通过
不得只跑旧 `test/smoke.js`；不得只测碰撞盒边界；不得只测 nav 门洞连通而不让胶囊实际通过；不得把空气墙作为保守碰撞。
