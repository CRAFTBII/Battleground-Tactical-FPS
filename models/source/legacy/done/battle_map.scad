// 枪战据点 (battle_map) — 和平精英/三角洲风格 营地布局
// 建筑之间留出交火线，掩体散布成安全角；不是密实街区，而是"据点"
$fn = 4;

module house() {
  w = 10; d = 8; h = 4;
  color([0.82, 0.78, 0.70])
    difference() {
      cube([w, d, h]);
      translate([-0.7, -0.3, 0]) cube([1.4, d + 0.6, 2.2]);
      for (x = [-3.0, 0.4, 3.4])
        translate([x - 0.5, -0.3, 1.3]) cube([1.0, d + 0.6, 1.1]);
      for (y = [-1.0, 5.0])
        translate([-0.3, y - 0.5, 1.3]) cube([w + 0.6, 1.0, 1.1]);
    }
  color([0.62, 0.60, 0.56]) translate([-0.3, -0.3, -0.3]) cube([w + 0.6, d + 0.6, 0.3]);
  color([0.55, 0.32, 0.28])
    polyhedron(
      points = [
        [-w/2 - 0.4, -d/2 - 0.4, h], [w/2 + 0.4, -d/2 - 0.4, h],
        [w/2 + 0.4, d/2 + 0.4, h], [-w/2 - 0.4, d/2 + 0.4, h],
        [-w/2 - 0.4, 0, h + 2.2], [w/2 + 0.4, 0, h + 2.2]
      ],
      faces = [[0,1,5,4],[3,2,5,4],[0,3,4],[1,2,5],[0,1,2,3]]
    );
}

module apartment() {
  w = 16; d = 12; h = 16;
  for (fz = [4, 8, 12])
    color([0.70, 0.70, 0.68]) translate([0, 0, fz]) cube([w, d, 0.3]);
  color([0.80, 0.79, 0.76])
    difference() {
      cube([w, d, h]);
      translate([-0.9, -0.3, 0]) cube([1.8, d + 0.6, 2.6]);
      for (fy = [2.5, 6.5, 10.5, 13.5])
        for (fx = [-5, 0, 5])
          translate([fx - 0.7, -0.3, fy]) cube([1.4, d + 0.6, 1.3]);
      for (fy = [2.5, 6.5, 10.5, 13.5])
        for (fy2 = [-3.5, 3.5])
          translate([-0.3, fy2 - 0.7, fy]) cube([w + 0.6, 1.4, 1.3]);
    }
  color([0.66, 0.66, 0.64]) translate([0, 0, h]) cube([w, d, 0.6]);
  color([0.60, 0.60, 0.58]) translate([w/2 - 2, d/2 - 2, h + 0.6]) cube([4, 4, 2.5]);
}

module warehouse() {
  w = 22; d = 14; h = 8;
  color([0.66, 0.64, 0.60])
    difference() {
      cube([w, d, h]);
      translate([-2.4, -0.3, 0]) cube([4.8, d + 0.6, 5.4]);
      for (yy = [-4.0, 4.0])
        translate([-0.3, yy - 0.7, 3.0]) cube([w + 0.6, 1.4, 1.6]);
    }
  color([0.55, 0.53, 0.50]) translate([0, 0, h]) cube([w, d, 0.5]);
  color([0.50, 0.48, 0.46]) translate([w/2 - 1.5, d/2 - 1.5, h + 0.5]) cube([3, 3, 1.2]);
}

module watchtower() {
  leg_h = 7; leg = 0.4; span = 4;
  for (sx = [-1, 1]) for (sz = [-1, 1])
    color([0.45, 0.35, 0.25])
      translate([sx * (span/2 - leg/2), sz * (span/2 - leg/2), 0]) cube([leg, leg, leg_h]);
  color([0.70, 0.70, 0.68]) translate([-span/2, -span/2, leg_h]) cube([span, span, 0.4]);
  rail_h = 1.1;
  color([0.40, 0.32, 0.24]) {
    for (sx = [-1, 1]) translate([sx * (span/2 - 0.1), -span/2, leg_h + 0.4]) cube([0.2, span, rail_h]);
    for (sz = [-1, 1]) translate([-span/2, sz * (span/2 - 0.1), leg_h + 0.4]) cube([span, 0.2, rail_h]);
  }
  color([0.50, 0.30, 0.26])
    polyhedron(
      points = [
        [-span/2, -span/2, leg_h + 0.4 + rail_h], [span/2, -span/2, leg_h + 0.4 + rail_h],
        [span/2, span/2, leg_h + 0.4 + rail_h], [-span/2, span/2, leg_h + 0.4 + rail_h],
        [0, 0, leg_h + 0.4 + rail_h + 1.6]
      ],
      faces = [[0,1,4],[1,2,4],[2,3,4],[3,0,4],[0,1,2,3]]
    );
  color([0.35, 0.30, 0.22])
    for (i = [0 : 0.5 : leg_h - 0.5])
      translate([span/2 - 0.3, -0.2, i]) cube([0.3, 0.4, 0.1]);
}

module container() {
  color([0.62, 0.30, 0.24]) cube([6, 2.5, 2.6]);
  color([0.30, 0.30, 0.32]) translate([0, 0.1, 2.6]) cube([6, 2.3, 0.15]);
}
module sandbags() {
  color([0.74, 0.68, 0.52])
    for (i = [0 : 1]) for (j = [0 : 2]) translate([j * 1.1, i * 0.6, 0]) cube([1.0, 0.5, 0.5]);
}
module barrier() { color([0.80, 0.80, 0.78]) cube([3, 0.6, 1.1]); }
module crate() { color([0.55, 0.40, 0.26]) cube([1.3, 1.3, 1.3]); }

module cover_cluster() {
  translate([0, 0, 0]) container();
  translate([0, 3.2, 0]) container();
  translate([7.5, 0, 0]) crate();
  translate([9.1, 0, 0]) crate();
  translate([7.5, 1.6, 0]) sandbags();
  translate([11.5, -0.6, 0]) barrier();
  translate([11.5, 1.0, 0]) barrier();
}

// 地面（荒漠/营地色调）
color([0.46, 0.49, 0.43]) translate([-70, -70, -0.5]) cube([200, 200, 1]);

// 据点布局：中央空场 + 四周建筑 + 掩体走廊
translate([0, 0, 0]) warehouse();
translate([-46, 36, 0]) apartment();
translate([44, -34, 0]) house();
translate([20, 40, 0]) house();
translate([-30, -44, 0]) house();
translate([40, 34, 0]) watchtower();
translate([-44, -10, 0]) watchtower();
translate([8, 6, 0]) cover_cluster();
translate([-18, 18, 0]) cover_cluster();
translate([26, -14, 0]) cover_cluster();
translate([-10, -22, 0]) sandbags();
translate([14, -30, 0]) barrier();
translate([-26, 8, 0]) crate();
