// 工业区 (厂区 ~90 x 60) —— 可进入: 主厂房多层管廊 + catwalk 检修通道 + 楼梯
// + 2 双曲线冷却塔(可爬内部旋梯) + 3 烟囱 + 架空管道网
$fn = 10;

// 直跑楼梯
module stair(width, n, run, rise) {
  for (i = [0 : n - 1]) translate([i * run, 0, 0]) cube([run, width, (i + 1) * rise]);
}
// 楼板(带孔)
module slab(len, wid, z, hole) {
  difference() {
    translate([0, 0, z]) cube([len, wid, 1]);
    if (hole) translate([hole[0], hole[1], z - 0.2]) cube([hole[2], hole[3], 1.4]);
  }
}

// ---- 主厂房: 中空 + 管廊 + catwalk ----
module hall() {
  // 外壳(真窗洞 + 前墙大门) —— difference 真挖
  color("#8a8f86") {
    // 后墙 y=0
    difference() {
      translate([0, 0, 0]) cube([70, 2, 22]);
      for (ix = [6 : 12 : 60]) for (iz = [5 : 7 : 17]) translate([ix, -1, iz]) cube([4, 4, 4]);
    }
    // 前墙 y=38 (大门 + 窗)
    difference() {
      translate([0, 38, 0]) cube([70, 2, 22]);
      translate([30, 37.5, 0]) cube([10, 1, 7]);                      // 大门
      for (ix = [6 : 12 : 26]) for (iz = [5 : 7 : 17]) translate([ix, 37.5, iz]) cube([4, 4, 4]);
      for (ix = [44 : 12 : 60]) for (iz = [5 : 7 : 17]) translate([ix, 37.5, iz]) cube([4, 4, 4]);
    }
    // 左墙 x=0
    difference() {
      translate([0, 0, 0]) cube([2, 40, 22]);
      for (iy = [6 : 12 : 32]) for (iz = [5 : 7 : 17]) translate([-1, iy, iz]) cube([4, 4, 4]);
    }
    // 右墙 x=68
    difference() {
      translate([68, 0, 0]) cube([2, 40, 22]);
      for (iy = [6 : 12 : 32]) for (iz = [5 : 7 : 17]) translate([67.5, iy, iz]) cube([4, 4, 4]);
    }
  }
  // catwalk 楼板 (z=11) 带多处孔
  color("#9a9f96") slab(70, 40, 11, [4, 4, 8, 8]);
  color("#9a9f96") slab(70, 40, 11, [20, 4, 8, 8]);
  color("#9a9f96") slab(70, 40, 11, [40, 4, 8, 8]);
  color("#9a9f96") slab(70, 40, 11, [54, 20, 8, 8]);
  color("#9a9f96") slab(70, 40, 11, [20, 24, 8, 8]);
  // catwalk 护栏
  color("#6f756c") union() {
    translate([0, 2, 12]) cube([70, 0.4, 1]);
    translate([0, 38, 12]) cube([70, 0.4, 1]);
    for (x = [0 : 4 : 66]) translate([x, 2, 12]) cube([0.3, 36, 1]);
  }
  // 楼梯(左下角上 catwalk, 顶留 2 单位空间)
  color("#b0b6a8") translate([2, 2, 0]) stair(6, 9, 0.65, 1.0);
  // 管廊: 竖向立柱 + 横向管道, 形成内部走廊迷宫
  color("#5a5f66") {
    for (x = [10, 30, 50]) for (y = [8, 32])
      translate([x, y, 0]) cube([2, 2, 22]);
  }
  color("#7a4a2a") {  // 横向管道(架空)
    for (y = [10, 30]) translate([4, y, 15]) rotate([0, 90, 0]) cylinder(r = 1.2, h = 62);
    for (x = [16, 40, 60]) translate([x, 6, 15]) rotate([90, 0, 0]) cylinder(r = 1.0, h = 28);
  }
  color("#3a6a8a") {  // 蓝色工艺管道
    translate([24, 6, 18]) rotate([90, 0, 0]) cylinder(r = 0.8, h = 28);
    translate([4, 20, 18]) rotate([0, 90, 0]) cylinder(r = 0.8, h = 62);
  }
}

// ---- 双曲线冷却塔(可爬内部旋梯) ----
module cooling_tower(px, py) {
  // 外壳(双曲线)
  color("#9aa0a8") translate([px, py, 0]) rotate_extrude() polygon([
    [10, 0], [13, 8], [14, 20], [12, 34], [13, 38], [9, 38], [8, 34], [10, 20], [9, 8], [7, 0]
  ]);
  // 内部中空(掏出核心) — 已为中空, 不填实心柱, 可进入
  // 内部旋梯(近似: 螺旋方块)
  color("#b0b6a8") for (i = [0 : 6 : 32])
    rotate([0, 0, i * 12]) translate([px + 4, py, i]) cube([1.2, 3, 0.6]);
  // 顶平台
  color("#888") translate([px, py, 38]) cylinder(r = 13, h = 1, $fn = 24);
}

// ---- 烟囱(道具) ----
module chimney(px, py) {
  color("#777") cylinder(r = 2.5, h = 44, $fn = 16);
  color("#555") translate([0, 0, 44]) cylinder(r = 2.8, h = 1.5, $fn = 16);
}

// ================= 组装 =================
translate([0, 0, 0]) hall();
cooling_tower(82, 18);
cooling_tower(82, 42);
translate([10, 12, 0]) chimney(0, 0);
translate([30, 12, 0]) chimney(0, 0);
translate([50, 12, 0]) chimney(0, 0);
// 场外架空管道连到冷却塔
color("#7a4a2a") translate([-5, 30, 10]) rotate([0, 90, 0]) cylinder(r = 1.2, h = 100);
