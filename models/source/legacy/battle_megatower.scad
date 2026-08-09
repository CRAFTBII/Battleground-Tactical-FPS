// 超高层摩天楼 (~120 高, 底 36x36, 多段退台, 密集窗阵列)
// 不追求低模, 细节拉满
$fn = 8;

module tower() {
  color("#9aa0a8") cube([36, 36, 70]);
  color("#aab0b8") translate([4, 4, 70]) cube([28, 28, 28]);
  color("#bcc2c8") translate([8, 8, 98]) cube([20, 20, 16]);
  color("#cdd2d8") translate([12, 12, 114]) cube([12, 12, 8]);
  // 主楼四面密集窗
  for (iy = [3 : 4 : 64]) for (ix = [3 : 4 : 32])
    color("#2b3640") translate([ix, -0.2, iy]) cube([2.4, 0.4, 3]);
  for (iy = [3 : 4 : 64]) for (ix = [3 : 4 : 32])
    color("#2b3640") translate([ix, 36.2, iy]) cube([2.4, 0.4, 3]);
  for (iy = [3 : 4 : 64]) for (iz = [3 : 4 : 32])
    color("#2b3640") translate([-0.2, iz, iy]) cube([0.4, 2.4, 3]);
  for (iy = [3 : 4 : 64]) for (iz = [3 : 4 : 32])
    color("#2b3640") translate([36.2, iz, iy]) cube([0.4, 2.4, 3]);
  // 退台段窗
  for (iy = [72 : 4 : 94]) for (ix = [6 : 4 : 24]) {
    color("#2b3640") translate([ix, 3.8, iy]) cube([2.4, 0.4, 3]);
    color("#2b3640") translate([ix, 32.2, iy]) cube([2.4, 0.4, 3]);
    color("#2b3640") translate([3.8, ix, iy]) cube([0.4, 2.4, 3]);
    color("#2b3640") translate([32.2, ix, iy]) cube([0.4, 2.4, 3]);
  }
  // 顶冠 + 天线群
  color("#888") translate([14, 14, 122]) cube([8, 8, 4]);
  color("#555") translate([18, 18, 126]) cylinder(r = 0.8, h = 20);
  color("#555") translate([12, 20, 126]) cylinder(r = 0.5, h = 14);
  color("#555") translate([24, 14, 126]) cylinder(r = 0.5, h = 10);
  color("#c33") translate([18, 18, 146]) sphere(r = 1.6);
}

tower();
