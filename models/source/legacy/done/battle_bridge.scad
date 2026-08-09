// 桥梁 (battle_bridge) — 枪战通路资产
// 桥面 + 栏杆 + 桥墩，可跨越沟壑/河道
$fn = 6;

module bridge() {
  len = 30; w = 6; h = 8;
  // 桥面
  color([0.55, 0.55, 0.58]) translate([0, 0, h]) cube([len, w, 1], center = true);
  // 栏杆
  color([0.45, 0.45, 0.48]) translate([0, w/2, h + 1]) cube([len, 0.4, 2], center = true);
  color([0.45, 0.45, 0.48]) translate([0, -w/2, h + 1]) cube([len, 0.4, 2], center = true);
  // 桥墩
  for (x = [-len/2 + 4, 0, len/2 - 4]) {
    color([0.50, 0.50, 0.52]) translate([x, 0, h/2]) cube([2, w + 1, h], center = true);
  }
}

bridge();
