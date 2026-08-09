// 摩天大楼 (battle_tower) — 大型低精度枪战建筑
// 高细楼体 + 顶部退台 + 天线，适合做狙击制高点
$fn = 6;

module tower() {
  w = 18; d = 18; h = 70;

  // 主楼体
  color([0.82, 0.82, 0.80])
    translate([0, 0, h/2]) cube([w, d, h], center = true);

  // 顶部退台（逐级收分）
  color([0.78, 0.78, 0.76]) translate([0, 0, h + 6]) cube([14, 14, 12], center = true);
  color([0.74, 0.74, 0.72]) translate([0, 0, h + 16]) cube([10, 10, 8], center = true);

  // 天线
  color([0.30, 0.30, 0.30]) translate([0, 0, h + 20]) cylinder(h = 10, r = 0.6);

  // 正/背面窗户 (x = ±w/2)
  for (z = [4:6:(h - 6)]) {
    for (yy = [-w/2 + 2:3:w/2 - 2]) {
      color([0.25, 0.30, 0.40])
        translate([w/2, yy, z]) cube([0.3, 1.6, 3.2]);
      color([0.25, 0.30, 0.40])
        translate([-w/2 - 0.3, yy, z]) cube([0.3, 1.6, 3.2]);
    }
  }
  // 侧窗 (y = ±d/2)
  for (z = [4:6:(h - 6)]) {
    for (xx = [-d/2 + 2:3:d/2 - 2]) {
      color([0.25, 0.30, 0.40])
        translate([xx, d/2, z]) cube([1.6, 0.3, 3.2]);
      color([0.25, 0.30, 0.40])
        translate([xx, -d/2 - 0.3, z]) cube([1.6, 0.3, 3.2]);
    }
  }
}

tower();
