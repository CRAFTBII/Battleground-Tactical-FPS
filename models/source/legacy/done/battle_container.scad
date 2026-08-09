// 集装箱堆 (battle_container) — 枪战掩体资产
// 标准货柜尺寸，颜色区分，可堆叠，提供模块化掩护
$fn = 6;

module container(len, h, col, pos) {
  color(col) translate(pos) cube([len, 2.4, h], center = true);
  // 端部门框
  color([0.10, 0.10, 0.10]) translate([pos[0] + len/2 - 0.15, 0, pos[2]]) cube([0.3, 2.0, 1.8], center = true);
  color([0.10, 0.10, 0.10]) translate([pos[0] - len/2 + 0.15, 0, pos[2]]) cube([0.3, 2.0, 1.8], center = true);
}

module containers() {
  // 底层三连
  container(6, 2.5, [0.70, 0.25, 0.20], [0, 0, 1.25]);
  container(6, 2.5, [0.20, 0.40, 0.65], [0, 3, 1.25]);
  container(6, 2.5, [0.80, 0.70, 0.20], [0, 6, 1.25]);
  // 上面叠一个
  container(6, 2.5, [0.30, 0.55, 0.30], [0, 1.5, 3.75]);
  // 侧翻一个
  color([0.55, 0.30, 0.55]) translate([12, 3, 1.25]) rotate([0, 0, 90]) cube([6, 2.4, 2.5], center = true);
}

containers();
