// 大型体育场 (直径 ~210, 环形看台 + 场地 + 顶棚)
// 不追求低模, 圆环用较高 $fn
$fn = 32;

module bowl() {
  color("#8a8a82") rotate_extrude()
    polygon([[50, 0], [95, 0], [105, 34], [58, 34], [50, 28]]);
}

module roof() {
  color("#66665f") rotate_extrude()
    polygon([[58, 34], [108, 40], [105, 43], [56, 37]]);
}

module field() {
  color("#2f7d32") cylinder(r = 48, h = 1, $fn = 32);
  color("#ffffff") cylinder(r = 46, h = 1.05, $fn = 32);
  color("#ffffff") translate([0, 0, 1.1]) cube([96, 1, 0.4]);
  color("#ffffff") translate([0, 0, 1.1]) cube([1, 96, 0.4]);
  color("#ffffff") translate([0, 0, 1.1]) cylinder(r = 8, h = 0.4, $fn = 24);
}

bowl();
roof();
translate([0, 0, 0.5]) field();
