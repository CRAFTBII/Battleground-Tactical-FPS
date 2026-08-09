// 超高层摩天楼 (~120 高, 底 36x36) —— 全中空 / 多层楼板 / 中央楼梯井 / 隔间迷宫
// 不追求低模, 细节拉满, 可逐层爬升穿行
$fn = 8;

// 直跑楼梯 (沿 X 上行)
module stairX(width, n, run, rise) {
  for (i = [0 : n - 1]) translate([i * run, 0, 0]) cube([run, width, (i + 1) * rise]);
}
// 直跑楼梯 (沿 Y 上行)
module stairY(width, n, run, rise) {
  for (i = [0 : n - 1]) translate([0, i * run, 0]) cube([width, run, (i + 1) * rise]);
}
// 楼板(带楼梯井孔 x2..11 y2..11)
module slab(z) {
  difference() {
    translate([0, 0, z]) cube([36, 36, 1]);
    translate([2, 2, z - 0.2]) cube([9, 9, 1.4]);
  }
}
// 隔墙(带门洞) 沿 X
module partX(len, y0, z0, h, door) {
  difference() {
    translate([0, y0, z0]) cube([len, 1, h]);
    if (door) translate([door[0], y0 - 0.3, z0]) cube([door[1] - door[0], 1.6, 6]);
  }
}

// 楼层数
floors = 11;        // 0..10 楼板在 z=10,20,...,110
fh = 10;            // 层高

module tower() {
  // 外墙(4面真窗洞 + 前墙大门) —— difference 真挖
  color("#9aa0a8") {
    // 后墙 y=0
    difference() {
      translate([0, 0, 0]) cube([36, 2, 120]);
      for (iy = [8 : 9 : 110]) for (ix = [4 : 8 : 28]) translate([ix, -1, iy]) cube([3, 4, 4]);
    }
    // 前墙 y=34 (大门 + 窗)
    difference() {
      translate([0, 34, 0]) cube([36, 2, 120]);
      translate([15, 33.5, 0]) cube([6, 1, 6]);
      for (iy = [8 : 9 : 110]) for (ix = [4 : 8 : 28]) translate([ix, 33.5, iy]) cube([3, 4, 4]);
    }
    // 左墙 x=0
    difference() {
      translate([0, 0, 0]) cube([2, 36, 120]);
      for (iy = [8 : 9 : 110]) for (iz = [4 : 8 : 28]) translate([-1, iz, iy]) cube([4, 3, 4]);
    }
    // 右墙 x=34
    difference() {
      translate([34, 0, 0]) cube([2, 36, 120]);
      for (iy = [8 : 9 : 110]) for (iz = [4 : 8 : 28]) translate([33.5, iz, iy]) cube([4, 3, 4]);
    }
  }
  // 楼板
  for (k = [1 : floors]) color("#aab0b8") slab(k * fh);
  // 中央楼梯井: 交错直跑 (顶留 2 单位头顶空间)
  color("#bcc2c8") {
    for (k = [0 : floors - 1]) {
      z0 = k * fh;
      if (k % 2 == 0)
        translate([2, 2, z0]) stairX(9, 8, 1.0, 1.0);
      else
        translate([2, 2, z0]) stairY(9, 8, 1.0, 1.0);
    }
  }
  // 多层隔间(迷宫感): 奇数层加纵向隔墙带门, 偶数层加横向隔墙带门
  for (k = [1 : floors - 1]) {
    z0 = k * fh + 1;
    if (k % 2 == 1) {
      color("#9098a0") partX(36, 18, z0, fh - 1, [6, 9]);
      color("#9098a0") partX(36, 26, z0, fh - 1, [24, 27]);
    } else {
      color("#9098a0") {
        difference() {
          translate([14, 0, z0]) cube([1, 36, fh - 1]);
          translate([13.7, 6, z0]) cube([1.6, 3, 6]);
        }
        difference() {
          translate([24, 0, z0]) cube([1, 36, fh - 1]);
          translate([23.7, 24, z0]) cube([1.6, 3, 6]);
        }
      }
    }
  }
  // 顶冠 + 天线群
  color("#888") translate([14, 14, 120]) cube([8, 8, 4]);
  color("#555") translate([18, 18, 124]) cylinder(r = 0.8, h = 20);
  color("#555") translate([12, 20, 124]) cylinder(r = 0.5, h = 14);
  color("#555") translate([24, 14, 124]) cylinder(r = 0.5, h = 10);
  color("#c33") translate([18, 18, 144]) sphere(r = 1.6);
}

tower();
