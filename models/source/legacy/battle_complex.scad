// battle_complex.scad —— 超大型综合体 120×80×48（占地 9600㎡，desert 巨无霸地标）
// 可进入：四面外墙中央大门（14×8，≥6 nav cells 净空）→ 中庭（60×36 通高天井）+ 4 层环廊（可站可守）
// 结构：中央核心筒（电梯+机房 8×8×48）+ 4 角楼梯井（10×10，交错直跑可逐级攀爬）+ 屋顶直升机坪
// 规范：角点原点（min=0,0,0）、Z-up、color() 上色、bbox 精确 = REAL_DIMS 120×80×48（无任何超界元素）
$fn = 8;
W = 120; D = 80; H = 48; TH = 1.5; FH = 12;
AT_X = 36; AT_W = 60; AT_Y = 22; AT_D = 36;   // 中庭 60×36（x[36,96] y[22,58]，通高到屋顶）
ST = 10;                                       // 楼梯井 10×10（四角）

// 直跑楼梯（沿 X / 沿 Y 上行，每级 1m）
module stairX(width, n, run, rise) { for (i = [0:n-1]) translate([i*run, 0, 0]) cube([run, width, (i+1)*rise]); }
module stairY(width, n, run, rise) { for (i = [0:n-1]) translate([0, i*run, 0]) cube([width, run, (i+1)*rise]); }

// 楼板（挖中庭 + 4 角楼梯井；挖洞与外墙留 0.1 间隙，避免 CGAL 共享面毛刺）
module slab(z) {
  difference() {
    translate([0, 0, z]) cube([W, D, 1]);
    translate([AT_X, AT_Y, z-0.2]) cube([AT_W, AT_D, 1.4]);      // 中庭
    translate([0.1, 0.1, z-0.2]) cube([ST-0.2, ST-0.2, 1.4]);                 // 楼梯井×4
    translate([W-ST+0.1, 0.1, z-0.2]) cube([ST-0.2, ST-0.2, 1.4]);
    translate([0.1, D-ST+0.1, z-0.2]) cube([ST-0.2, ST-0.2, 1.4]);
    translate([W-ST+0.1, D-ST+0.1, z-0.2]) cube([ST-0.2, ST-0.2, 1.4]);
  }
}
// 外墙（4 面，厚 1.5，中央大门 14×8）
module walls() {
  color("#9aa0a8") {
    difference() { translate([0, 0, 0]) cube([W, TH, H]); translate([53, -0.5, 0]) cube([14, TH+1, 8]); }     // 南
    difference() { translate([0, D-TH, 0]) cube([W, TH, H]); translate([53, D-TH-0.5, 0]) cube([14, TH+1, 8]); } // 北
    difference() { translate([0, 0, 0]) cube([TH, D, H]); translate([-0.5, 33, 0]) cube([TH+1, 14, 8]); }       // 西
    difference() { translate([W-TH, 0, 0]) cube([TH, D, H]); translate([W-TH-0.5, 33, 0]) cube([TH+1, 14, 8]); } // 东
  }
}
// 楼梯（4 角井内，每层 12 级 rise1 run0.8 —— 全部缩进井内，不超 bbox）
module stairs() {
  color("#bcc2c8") {
    for (k = [0:3]) {
      z0 = k * FH;
      translate([0, 0, z0]) stairX(10, 12, 0.8, 1);        // SW（沿 x 0~9.6）
      translate([0, D-ST, z0]) stairX(10, 12, 0.8, 1);     // NW
      translate([W-ST, 0, z0]) stairY(10, 12, 0.8, 1);     // SE（沿 y 0~9.6）
      translate([W-ST, D-ST, z0]) stairY(10, 12, 0.8, 1);  // NE（沿 y 70~79.6）
    }
  }
}
// 中央核心筒（电梯井 + 顶机房）
module core() {
  color("#7e8a96") translate([56, 36, 0]) cube([8, 8, 48]);
  color("#6f7681") translate([58, 38, 44]) cube([4, 4, 4]);
}
// 屋顶：直升机坪（中庭上方）+ 短天线（全部压在 bbox 48 内）
module roof() {
  color("#888") translate([45, 28, 47.4]) cube([30, 24, 0.6]);   // 直升机坪 z[47.4,48]
  color("#555") translate([60, 40, 46.5]) cylinder(r = 0.8, h = 1.5); // 天线 z[46.5,48]
  color("#c33") translate([60, 40, 47.2]) sphere(r = 0.8);        // 警示灯 顶=48
}
// 外立面窗带（每层凸横带）+ 4 门雨棚（不超 bbox）
module facade() {
  color("#aab0b8") {
    for (k = [1:4]) {
      translate([TH, TH, k*FH-2]) cube([W-2*TH, 1.2, 1.2]);        // 南窗带
      translate([TH, D-TH-1.2, k*FH-2]) cube([W-2*TH, 1.2, 1.2]);  // 北窗带
      translate([TH, TH, k*FH-2]) cube([1.2, D-2*TH, 1.2]);        // 西窗带
      translate([W-TH-1.2, TH, k*FH-2]) cube([1.2, D-2*TH, 1.2]);  // 东窗带
    }
  }
  color("#6f7681") {
    translate([50, 0, 8]) cube([20, 1.2, 0.6]);                    // 南雨棚
    translate([50, D-1.2, 8]) cube([20, 1.2, 0.6]);                // 北雨棚
    translate([0, 30, 8]) cube([1.2, 20, 0.6]);                    // 西雨棚
    translate([W-1.2, 30, 8]) cube([1.2, 20, 0.6]);                // 东雨棚
  }
}

module complex() {
  walls();
  for (k = [1:3]) slab(k * FH);
  slab(47);          // 屋顶板 47~48
  stairs();
  core();
  roof();
  facade();
}
complex();
