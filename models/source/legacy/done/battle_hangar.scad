// 可进入机库/大棚 - 大跨度内部空间, 两端大开口 (可开车进入)
// 外 40(x) × 24(y) × 12(z); 薄墙; 内部完全中空
// +X = 长轴(开口在两端), +Y = 宽, +Z = 高

module hangar() {
  difference() {
    cube([40, 24, 12]);
    // 内腔 (顶部留 1 厚)
    translate([1, 1, 0]) cube([38, 22, 11]);
    // 两端大门 (x=0 与 x=40 面) 大开口 w10 h9
    translate([-0.1, 7, 0.5]) cube([1.2, 10, 9]);
    translate([38.9, 7, 0.5]) cube([1.2, 10, 9]);
  }
}

module truss() {
  // 屋顶桁架
  for (x = [4 : 8 : 32]) {
    translate([x, 1, 11]) cube([1, 22, 1]);
  }
}

color("#9a9a90") hangar();
color("#6b6b63") truss();
