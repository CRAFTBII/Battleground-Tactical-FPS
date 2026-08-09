// 大型军事基地综合体 (约 220 x 180)
// 围墙 + 4 哨塔 + 中央指挥楼 + 3 营房 + 2 机库 + 雷达塔 + 油罐
// 不追求低模, 中等细节, 体量巨大
$fn = 8;

module perimeter_wall() {
  color("#6f6f66") union() {
    translate([0, 0, 0]) cube([220, 3, 8]);
    translate([0, 177, 0]) cube([220, 3, 8]);
    translate([0, 0, 0]) cube([3, 180, 8]);
    translate([217, 0, 0]) cube([3, 180, 8]);
  }
}

module guard_tower(px, py) {
  color("#7a7a70") {
    translate([px, py, 0]) cube([4, 4, 12]);
    translate([px - 1, py - 1, 12]) cube([6, 6, 0.6]);
  }
  color("#55554f") translate([px - 1.5, py - 1.5, 12.6]) cube([7, 7, 3]);
  color("#33414d") translate([px + 0.5, py + 0.5, 13]) cube([3, 3, 2]);
}

module hq() {
  color("#8a8a82") cube([40, 30, 28]);
  color("#9a9a90") translate([5, 5, 28]) cube([30, 20, 8]);
  color("#aaa8a0") translate([10, 10, 36]) cube([20, 10, 5]);
  for (iy = [2 : 4 : 25]) for (ix = [2 : 4 : 36])
    color("#33414d") translate([ix, -0.2, iy]) cube([2.4, 0.4, 3]);
  for (iy = [2 : 4 : 25]) for (ix = [2 : 4 : 26])
    color("#33414d") translate([ix, 30.2, iy]) cube([2.4, 0.4, 3]);
  color("#444") translate([20, 15, 41]) cylinder(r = 0.6, h = 16);
  color("#c33") translate([20, 15, 57]) sphere(r = 1.4);
}

module barracks(px, py) {
  color("#867f76") translate([px, py, 0]) cube([52, 14, 12]);
  for (ix = [2 : 5 : 48]) for (iy = [2 : 4 : 8]) {
    color("#33414d") translate([px + ix, py - 0.2, iy]) cube([2.6, 0.4, 3]);
    color("#33414d") translate([px + ix, py + 14.2, iy]) cube([2.6, 0.4, 3]);
  }
}

module hangar(px, py) {
  color("#9a9a90") translate([px, py, 0]) difference() {
    cube([46, 30, 16]);
    translate([1, 1, 0]) cube([44, 28, 15]);
    translate([-0.2, 10, 0.5]) cube([1.4, 10, 12]);
  }
}

module radar() {
  color("#777") cylinder(r = 2, h = 50, $fn = 12);
  color("#aaa") translate([0, 0, 50]) rotate([0, 90, 0]) cylinder(r = 9, h = 1.2, $fn = 24);
  color("#666") translate([0, 0, 49]) rotate([0, 90, 0]) cylinder(r = 7, h = 0.6, $fn = 24);
}

module tank_farm() {
  color("#b08040") rotate([0, 90, 0]) cylinder(r = 6, h = 14, $fn = 16);
  color("#b08040") translate([18, 0, 0]) rotate([0, 90, 0]) cylinder(r = 6, h = 14, $fn = 16);
}

// 组装
perimeter_wall();
guard_tower(0, 0);
guard_tower(216, 0);
guard_tower(0, 177);
guard_tower(216, 177);
translate([90, 75, 0]) hq();
barracks(12, 42);
barracks(150, 42);
barracks(12, 135);
hangar(150, 118);
hangar(60, 120);
translate([188, 90, 0]) radar();
translate([100, 140, 0]) tank_farm();
