// 掩体道具 (battle_cover) — 集装箱/沙袋/路障/木箱 低矮掩体
// 散布在建筑之间，形成交火线与安全角，是枪战地图的命脉
$fn = 4;

module container() {
  // 集装箱
  color([0.62, 0.30, 0.24]) cube([6, 2.5, 2.6]);
  color([0.30, 0.30, 0.32]) translate([0, 0.1, 2.6]) cube([6, 2.3, 0.15]);
}

module sandbags() {
  color([0.74, 0.68, 0.52])
    for (i = [0 : 1]) for (j = [0 : 2])
      translate([j * 1.1, i * 0.6, 0]) cube([1.0, 0.5, 0.5]);
}

module barrier() {
  // 混凝土路障
  color([0.80, 0.80, 0.78]) cube([3, 0.6, 1.1]);
}

module crate() {
  color([0.55, 0.40, 0.26]) cube([1.3, 1.3, 1.3]);
}

module cover_cluster() {
  // 一组掩体：双层集装箱 + 木箱 + 沙袋 + 路障
  translate([0, 0, 0]) container();
  translate([0, 3.2, 0]) container();
  translate([7.5, 0, 0]) crate();
  translate([9.1, 0, 0]) crate();
  translate([7.5, 1.6, 0]) sandbags();
  translate([11.5, -0.6, 0]) barrier();
  translate([11.5, 1.0, 0]) barrier();
}

cover_cluster();
