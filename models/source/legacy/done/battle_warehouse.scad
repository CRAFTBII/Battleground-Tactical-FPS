// 仓库 (battle_warehouse) — 大空间厂房 近战掩体
// 真实大卷帘门洞(可开车/进入) + 侧面高窗洞(穿窗射击) + 平屋顶
$fn = 4;

module warehouse() {
  w = 22; d = 14; h = 8;

  color([0.66, 0.64, 0.60])
    difference() {
      cube([w, d, h]);
      // 大卷帘门洞（前 +y，贯穿，可进入）
      translate([-2.4, -0.3, 0]) cube([4.8, d + 0.6, 5.4]);
      // 侧高窗洞（贯穿两侧）
      for (yy = [-4.0, 4.0])
        translate([-0.3, yy - 0.7, 3.0]) cube([w + 0.6, 1.4, 1.6]);
    }

  // 平屋顶 + 女儿墙
  color([0.55, 0.53, 0.50]) translate([0, 0, h]) cube([w, d, 0.5]);
  // 屋顶通风口（掩体）
  color([0.50, 0.48, 0.46]) translate([w/2 - 1.5, d/2 - 1.5, h + 0.5]) cube([3, 3, 1.2]);
}

warehouse();
