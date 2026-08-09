// 大型军事基地综合体 (约 220 x 180) —— 全可进入 / 迷宫式内部结构
// 围墙带大门 + 4 哨塔(可爬梯上) + 中央指挥楼(3层多房间迷宫) +
// 3 营房(隔间走廊) + 2 机库(大开门) + 雷达塔 + 油罐
// 不追求低模, 中等细节, 体量巨大, 内部中空可穿行
$fn = 8;

// ---- 通用构件 ----
// 沿 X 方向的墙(带门洞), 位于 y=y0, 底 z=z0, 长 len, 厚 t, 高 h
module wallX(len, t, h, y0, z0, door) {
  difference() {
    translate([0, y0, z0]) cube([len, t, h]);
    if (door) translate([door[0], y0 - 0.3, z0]) cube([door[1] - door[0], t + 0.6, 6]);
  }
}
// 沿 Y 方向的墙(带门洞), 位于 x=x0
module wallY(len, t, h, x0, z0, door) {
  difference() {
    translate([x0, 0, z0]) cube([t, len, h]);
    if (door) translate([x0 - 0.3, door[0], z0]) cube([t + 0.6, door[1] - door[0], 6]);
  }
}
// 直跑楼梯 (沿 X 上行), width=进深, n=级数, run/rise=每级
module stair(width, n, run, rise) {
  for (i = [0 : n - 1])
    translate([i * run, 0, 0]) cube([run, width, (i + 1) * rise]);
}
// 楼板(带楼梯井孔洞)
module slab(len, wid, z, hole) {
  difference() {
    translate([0, 0, z]) cube([len, wid, 1]);
    if (hole) translate([hole[0], hole[1], z - 0.2]) cube([hole[2], hole[3], 1.4]);
  }
}

// ---- 围墙(带 4 个大门) ----
module perimeter_wall() {
  color("#6f6f66") union() {
    // 前/后墙(沿 X), 在 x=100 处留大门
    translate([0, 0, 0]) wallX(95, 3, 9, 0, 0, [44, 56]);
    translate([105, 0, 0]) wallX(95, 3, 9, 0, 0, undef);
    translate([0, 177, 0]) wallX(95, 3, 9, 0, 0, [44, 56]);
    translate([105, 177, 0]) wallX(95, 3, 9, 0, 0, undef);
    // 左/右墙(沿 Y), 在 y=90 处留大门
    translate([0, 0, 0]) wallY(85, 3, 9, 0, 0, [40, 52]);
    translate([0, 95, 0]) wallY(85, 3, 9, 0, 0, undef);
    translate([217, 0, 0]) wallY(85, 3, 9, 0, 0, [40, 52]);
    translate([217, 95, 0]) wallY(85, 3, 9, 0, 0, undef);
  }
}

// ---- 哨塔(可爬梯上平台) ----
module guard_tower(px, py) {
  color("#7a7a70") {
    translate([px, py, 0]) cube([4, 4, 12]);
    translate([px - 1, py - 1, 12]) cube([6, 6, 0.6]);
  }
  color("#55554f") translate([px - 1.5, py - 1.5, 12.6]) cube([7, 7, 3]);
  // 平台护栏
  color("#888") translate([px - 1.5, py - 1.5, 15.6]) cube([7, 0.4, 1]);
  color("#888") translate([px - 1.5, py + 5.1, 15.6]) cube([7, 0.4, 1]);
  color("#888") translate([px - 1.5, py - 1.5, 15.6]) cube([0.4, 7, 1]);
  color("#888") translate([px + 5.1, py - 1.5, 15.6]) cube([0.4, 7, 1]);
  // 爬梯
  color("#444") for (i = [0 : 1.5 : 11]) translate([px + 2, py + 2, i]) cube([0.4, 0.4, 0.3]);
  color("#33414d") translate([px + 0.5, py + 0.5, 13]) cube([3, 3, 2]);
}

// ---- 中央指挥楼: 3 层多房间迷宫 ----
module hq() {
  // 外墙(前墙留大门, 其余实心)
  color("#8a8a82") union() {
    translate([0, 0, 0]) wallX(40, 2, 28, 0, 0, [17, 23]);      // 后(门)
    translate([0, 28, 0]) wallX(40, 2, 28, 0, 0, [17, 23]);     // 前(门)
    translate([0, 0, 0]) wallY(30, 2, 28, 0, 0, [12, 18]);      // 左(门)
    translate([38, 0, 0]) wallY(30, 2, 28, 0, 0, [12, 18]);     // 右(门)
  }
  // 楼板(带楼梯井孔 x2..8 y2..8)
  color("#9a9a90") {
    slab(40, 30, 9, [2, 2, 6, 6]);
    slab(40, 30, 18, [2, 2, 6, 6]);
    slab(40, 30, 27, undef);
  }
  // 内部隔墙 -> 4 个房间, 门洞交错形成迷宫
  color("#7d7d74") union() {
    // 纵向隔墙 x=20, 1层门在[6,9], 2层门在[14,17]
    wallY(30, 1, 27, 20, 0, [6, 9]);
    translate([0, 0, 9]) wallY(30, 1, 18, 20, 0, [14, 17]);
    // 横向隔墙 y=15, 1层门在[24,27], 2层门在[4,7]
    wallX(40, 1, 27, 15, 0, [24, 27]);
    translate([0, 0, 9]) wallX(40, 1, 18, 15, 0, [4, 7]);
  }
  // 楼梯井(左下角, 3 层直跑交错)
  color("#b0a890") {
    translate([2, 2, 0]) stair(6, 8, 0.7, 1.1);
    translate([8, 2, 9]) rotate([0, 0, 180]) stair(6, 8, 0.7, 1.1);
    translate([2, 2, 18]) stair(6, 8, 0.7, 1.1);
  }
  // 窗(装饰)
  for (iy = [3 : 5 : 24]) for (ix = [3 : 6 : 34])
    color("#33414d") translate([ix, -0.2, iy]) cube([2, 0.4, 3]);
  // 顶冠天线
  color("#444") translate([20, 15, 28]) cylinder(r = 0.6, h = 16);
  color("#c33") translate([20, 15, 44]) sphere(r = 1.4);
}

// ---- 营房: 1 层隔间 + 走廊 ----
module barracks(px, py) {
  color("#867f76") union() {
    translate([px, py, 0]) wallX(52, 2, 12, 0, 0, [23, 29]);        // 后(门)
    translate([px, py + 12, 0]) wallX(52, 2, 12, 0, 0, [23, 29]);   // 前(门)
    translate([px, py, 0]) wallY(14, 2, 12, 0, 0, [5, 8]);          // 左(门)
    translate([px + 50, py, 0]) wallY(14, 2, 12, 0, 0, [5, 8]);      // 右(门)
  }
  color("#9a938a") slab(52, 14, 11, undef);
  // 内部隔墙分 3 间 + 走廊, 门交错
  color("#7d766d") union() {
    translate([px, py, 0]) wallY(14, 1, 11, 18, 0, [5, 8]);
    translate([px, py, 0]) wallY(14, 1, 11, 34, 0, [5, 8]);
    // 走廊墙(y=4) 留门连各间
    translate([px, py + 4, 0]) wallX(52, 1, 11, 0, 0, [10, 13]);
    translate([px, py + 4, 0]) wallX(52, 1, 11, 0, 0, [26, 29]);
    translate([px, py + 4, 0]) wallX(52, 1, 11, 0, 0, [42, 45]);
  }
  for (ix = [2 : 5 : 48]) for (iy = [2 : 4 : 8])
    color("#33414d") translate([px + ix, py - 0.2, iy]) cube([2.6, 0.4, 3]);
}

// ---- 机库: 大开门中空 ----
module hangar(px, py) {
  color("#9a9a90") difference() {
    cube([46, 30, 16]);
    translate([1, 1, 0]) cube([44, 28, 15]);
  }
  // 大卷帘门(前墙缺口 高 11)
  color("#9a9a90") translate([px, py, 0]) cube([46, 30, 16]);
  color("#2a2a2a") translate([px + 1, py + 1, 0]) cube([44, 28, 15]);
  color("#9a9a90") {
    translate([px, py, 11]) cube([46, 30, 5]);           // 门楣以上
    translate([px, py, 0]) cube([46, 2, 16]);            // 后墙
    translate([px, py + 28, 0]) cube([46, 2, 16]);        // 前墙(除门)
    translate([px, py + 4, 0]) cube([14, 0.4, 11]);       // 门洞两侧柱
    translate([px + 32, py + 4, 0]) cube([14, 0.4, 11]);
    translate([px, py, 0]) cube([2, 30, 16]);             // 左墙
    translate([px + 44, py, 0]) cube([2, 30, 16]);        // 右墙
  }
  color("#888") translate([px, py, 15]) cube([46, 30, 1]); // 顶
}

// ---- 雷达塔 / 油罐(道具) ----
module radar() {
  color("#777") cylinder(r = 2, h = 50, $fn = 12);
  color("#aaa") translate([0, 0, 50]) rotate([0, 90, 0]) cylinder(r = 9, h = 1.2, $fn = 24);
  color("#666") translate([0, 0, 49]) rotate([0, 90, 0]) cylinder(r = 7, h = 0.6, $fn = 24);
}
module tank_farm() {
  color("#b08040") rotate([0, 90, 0]) cylinder(r = 6, h = 14, $fn = 16);
  color("#b08040") translate([18, 0, 0]) rotate([0, 90, 0]) cylinder(r = 6, h = 14, $fn = 16);
}

// ================= 组装 =================
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
