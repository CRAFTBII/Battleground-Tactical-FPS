// 可进入楼梯塔 - 多层中空平台 + 直跑楼梯 (纯垂直机动, 玩家层层爬升)
// 平台 12(x) × 12(y), 层高 3, 共 4 层, 总高 12
// 每层平台挖楼梯井留空, 楼梯段交替方向连层

module platform(z) {
  difference() {
    translate([0, 0, z]) cube([12, 12, 0.5]);
    // 楼梯井留空 (中部偏一侧)
    translate([2, 2, z]) cube([4, 4, 0.6]);
  }
}

module posts() {
  for (px = [0, 11.6]) for (py = [0, 11.6]) {
    translate([px, py, 0]) cube([0.4, 0.4, 12]);
  }
}

module stair_run(z0, flip) {
  // 一段直跑楼梯 (6 级, 每级升 0.5)
  for (i = [0 : 1 : 5]) {
    translate([6, 2 + (flip ? (5 - i) : i) * 1.2, z0 + i * 0.5]) cube([3, 1.2, 0.5]);
  }
}

color("#7a7a72") posts();
color("#9a9a90") for (z = [0, 3, 6, 9]) platform(z);
color("#6b6b63") stair_run(0, false);
color("#6b6b63") stair_run(3, true);
color("#6b6b63") stair_run(6, false);
color("#6b6b63") stair_run(9, true);
// 顶护栏
color("#55554f") translate([0, 0, 12]) {
  cube([12, 0.4, 1]);
  translate([0, 11.6, 0]) cube([12, 0.4, 1]);
  cube([0.4, 12, 1]);
  translate([11.6, 0, 0]) cube([0.4, 12, 1]);
}
