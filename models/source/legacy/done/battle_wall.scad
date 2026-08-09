// 掩体矮墙 (battle_wall) — 枪战掩护资产
// 几段高低错落的断墙，可挡子弹、绕点
$fn = 6;

module wall_segment(len, h, x) {
  color([0.66, 0.63, 0.58]) translate([x, 0, h/2]) cube([len, 1.4, h], center = true);
  // 顶部破损小块
  color([0.60, 0.57, 0.52]) translate([x + len/2 - 1, 0, h + 0.4]) cube([1.2, 1.4, 0.8], center = true);
}

module cover_walls() {
  wall_segment(6, 3.0, -10);
  wall_segment(4, 4.0, -2);
  wall_segment(5, 2.5, 5);
  wall_segment(7, 3.5, 14);
  wall_segment(3, 2.0, 23);
}

cover_walls();
