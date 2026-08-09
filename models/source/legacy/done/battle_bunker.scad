// 可进入地堡 - 入口 + 内部房间 + 内部直跑楼梯上顶台
// 轴: x=宽, y=深, z=高 (SCAD cube 无 center, 原点在角)
// 外尺寸 18(x) × 14(y) × 7(z); 墙厚 1; 内部完全中空可进入
// +X = 右, +Y = 前(门朝此), +Z = 上

module wall_shell() {
  difference() {
    cube([18, 14, 7]);
    // 挖内部空腔: 留 0.5 厚地台 + 1 厚顶
    translate([1, 1, 0.5]) cube([16, 12, 5.5]);
    // 正门洞 (y=0 面) w5 h3.2
    translate([6.5, -0.1, 0.5]) cube([5, 1.2, 3.2]);
    // 侧射击孔 (x=0 面) 两个
    translate([-0.1, 4.5, 3.6]) cube([1.2, 1, 1]);
    translate([-0.1, 8, 3.6]) cube([1.2, 1, 1]);
    // 顶台开口 (从内部上到顶)
    translate([7, 6, 6]) cube([4, 2, 1.2]);
  }
}

module stairs() {
  // 内部直跑楼梯: 从地台到顶 (12 级, 每级升 0.5)
  for (i = [0 : 1 : 11]) {
    translate([2, 6, 0.5 + i * 0.5]) cube([3, 1.2, 0.5]);
  }
}

module roof_rail() {
  // 顶台护栏
  translate([0, 0, 7]) {
    cube([18, 0.4, 1]);
    translate([0, 13.6, 0]) cube([18, 0.4, 1]);
    cube([0.4, 14, 1]);
    translate([17.6, 0, 0]) cube([0.4, 14, 1]);
  }
}

color("#8a8a82") wall_shell();
color("#6b6b63") stairs();
color("#55554f") roof_rail();
