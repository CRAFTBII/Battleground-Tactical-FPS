// 可进入暗堡/炮位 - 厚墙射击孔 + 内部小空间 + 爬梯上顶射击位
// 外 12(x) × 12(y) × 4(z); 墙厚 1.5; 内部中空可进
// +X = 右, +Y = 前(门朝此), +Z = 上

module pillbox() {
  difference() {
    cube([12, 12, 4]);
    // 内腔 (留 0.5 地台)
    translate([1.5, 1.5, 0.5]) cube([9, 9, 3]);
    // 门 (y=0 面) w3 h2.5
    translate([4.5, -0.1, 0.5]) cube([3, 1.6, 2.5]);
    // 四向射击孔 (上下两排)
    translate([-0.1, 3, 2]) cube([1.6, 1.2, 1]);
    translate([-0.1, 7.5, 2]) cube([1.6, 1.2, 1]);
    translate([10.5, 3, 2]) cube([1.6, 1.2, 1]);
    translate([10.5, 7.5, 2]) cube([1.6, 1.2, 1]);
    // 顶开口上射击位
    translate([4.5, 4.5, 3.8]) cube([3, 3, 0.5]);
  }
}

module ladder() {
  // 内部爬梯到顶
  for (i = [0 : 1 : 6]) {
    translate([5.5, 5.5, 0.5 + i * 0.45]) cube([1, 0.3, 0.3]);
  }
}

color("#8a8a82") pillbox();
color("#6b6b63") ladder();
// 顶射击位护栏
color("#55554f") translate([0, 0, 4]) {
  cube([12, 0.4, 1]);
  translate([0, 11.6, 0]) cube([12, 0.4, 1]);
  cube([0.4, 12, 1]);
  translate([11.6, 0, 0]) cube([0.4, 12, 1]);
}
