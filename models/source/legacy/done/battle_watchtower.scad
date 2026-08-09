// 瞭望塔 (battle_watchtower) — 枪战制高点
// 四腿 + 平台 + 护栏 + 顶棚，可上塔架枪
$fn = 6;

module watchtower() {
  h = 14;
  // 四腿
  for (dx = [-3, 3], dy = [-3, 3]) {
    color([0.45, 0.33, 0.22]) translate([dx, dy, 0]) cylinder(h = h, r = 0.5);
  }
  // 平台
  color([0.60, 0.50, 0.40]) translate([0, 0, h]) cube([8, 8, 1], center = true);
  // 护栏
  for (dx = [-4, 4]) color([0.50, 0.40, 0.30]) translate([dx, 0, h + 1]) cube([0.4, 8, 2], center = true);
  for (dy = [-4, 4]) color([0.50, 0.40, 0.30]) translate([0, dy, h + 1]) cube([8, 0.4, 2], center = true);
  // 顶棚支柱 + 顶棚
  color([0.50, 0.40, 0.30]) translate([0, 0, h + 2.5]) cylinder(h = 3, r = 0.3);
  color([0.40, 0.45, 0.50]) translate([0, 0, h + 5]) cube([9, 9, 0.6], center = true);
}

watchtower();
