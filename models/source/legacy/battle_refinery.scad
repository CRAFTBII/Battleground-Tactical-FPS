// 大型工业区 (主厂房 + 3 烟囱 + 2 冷却塔 + 管道网络)
// 不追求低模
$fn = 12;

module hall() {
  color("#8f8a80") cube([80, 50, 24]);
  color("#6f6a60") translate([0, 0, 24]) cube([80, 50, 2]);
  // 侧高窗
  for (ix = [4 : 8 : 72])
    color("#33414d") translate([ix, 25.2, 4]) cube([4, 0.4, 12]);
  for (ix = [4 : 8 : 72])
    color("#33414d") translate([ix, -0.2, 4]) cube([4, 0.4, 12]);
}

module chimney(px, py, h) {
  color("#b0a89a") cylinder(r1 = 3, r2 = 2, h = h, $fn = 12);
  color("#888") translate([0, 0, h - 2]) cylinder(r1 = 3.2, r2 = 2.2, h = 2, $fn = 12);
}

module cooling_tower(px, py) {
  color("#9a9a90") translate([px, py, 0]) rotate_extrude()
    polygon([[8, 0], [10, 20], [7, 45], [9, 50], [6, 50], [4, 45], [7, 20], [5, 0]]);
}

module pipes() {
  color("#777") for (i = [0 : 1 : 5])
    translate([10 + i * 12, 0, 2]) rotate([0, 90, 0]) cylinder(r = 1, h = 60, $fn = 8);
  color("#aa5533") translate([0, 40, 3]) rotate([0, 90, 0]) cylinder(r = 1.4, h = 70, $fn = 8);
}

hall();
translate([10, 10, 0]) chimney(10, 10, 70);
translate([30, 10, 0]) chimney(30, 10, 80);
translate([50, 10, 0]) chimney(50, 10, 60);
cooling_tower(75, 15);
cooling_tower(75, 35);
pipes();
