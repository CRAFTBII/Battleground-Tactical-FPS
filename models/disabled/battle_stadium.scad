// 大型体育场 (直径 ~210) —— 可进入: 4 条入场隧道(同时切穿外壳/看台/通道) + 看台下环形通道 + 坡道下到场地
$fn = 12;

field_r = 58;
stand_in = 64;
stand_out = 104;
shell_out = 108;
tunnel_angles = [0, 90, 180, 270];

// 单条隧道洞(径向方盒, 从场地外缘一直切到外壳外)
module tunnel_cut() {
  translate([field_r - 2, -6, 0]) cube([shell_out - field_r + 8, 12, 14]);
}
// 4 条隧道并集(用于 difference 开洞)
module tunnels() {
  for (a = tunnel_angles) rotate([0, 0, a]) tunnel_cut();
}

// 外壳(带 4 隧道洞)
module shell() {
  difference() {
    color("#9aa0a8") cylinder(r = shell_out, h = 32, $fn = 48);
    translate([0, 0, -1]) cylinder(r = shell_out - 4, h = 34, $fn = 48);
    tunnels();
  }
  // 顶棚环
  color("#888") difference() {
    cylinder(r = shell_out, h = 2, $fn = 48);
    translate([0, 0, -1]) cylinder(r = stand_out - 2, h = 4, $fn = 48);
  }
}

// 看台(阶梯环, 可行走, 被隧道切开)
module stands() {
  color("#7e8a96")
    difference() {
      rotate_extrude() polygon([[stand_in, 0], [stand_out, 30], [stand_in, 30]]);
      tunnels();
    }
  // 踏步线(装饰)
  for (a = [0 : 12 : 354])
    rotate([0, 0, a]) translate([stand_in + 2, -0.4, 0]) cube([stand_out - stand_in - 2, 0.8, 30]);
}

// 场地 + 中线 + 中圈
module field() {
  color("#2f7d3a") cylinder(r = field_r, h = 1, $fn = 48);
  color("#dfe6df") cylinder(r = 9, h = 1.1, $fn = 32);
  color("#dfe6df") translate([-field_r, -0.4, 0]) cube([field_r * 2, 0.8, 1.2]);
  color("#dfe6df") translate([field_r - 1, -18, 0]) cube([2, 36, 1.2]);
  color("#dfe6df") translate([-field_r + 1, -18, 0]) cube([2, 36, 1.2]);
}

// 环形通道(看台下) + 坡道连到场地, 被隧道切开
module concourse() {
  color("#6f7681")
    difference() {
      cylinder(r = stand_in, h = 3, $fn = 48);
      translate([0, 0, -1]) cylinder(r = field_r, h = 6, $fn = 48);
      tunnels();
    }
  for (a = tunnel_angles)
    rotate([0, 0, a]) color("#5f666f") translate([field_r, -3, 0]) cube([stand_in - field_r, 6, 1]);
}

module stadium() {
  shell();
  stands();
  field();
  concourse();
  // 隧道内壁装饰
  for (a = tunnel_angles)
    rotate([0, 0, a]) color("#4a4f57") translate([stand_in - 4, -6, 0]) cube([shell_out - stand_in + 6, 0.6, 14]);
}

stadium();
