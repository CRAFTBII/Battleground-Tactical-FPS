// 岗亭 (battle_guardhouse) — 小区门岗/检查站
// 轴: x=宽(5), y=深(5), z=高(4.5); 原点在角(0,0,0); 门在 y=0 面(后向, 与 CONFIGS 门洞对齐)
// 四面 0.4m 墙 + 后向门洞 1.6×2 + 左右窗(玻璃) + 平顶+屋脊(人字顶低模近似)
// 碰撞契约: 墙 0.4 + 门洞 x[1.7,3.3] z[0,2] + 顶 4-4.5 → GLB bbox 必须精确 5×5×4.5
$fn = 6;

module walls() {
  wall_h = 4;
  // 前墙 (y=5 面, 厚 0.4)
  color([0.70, 0.66, 0.58]) translate([0, 4.6, 0]) cube([5, 0.4, wall_h]);
  // 左右墙 (厚 0.4)
  color([0.70, 0.66, 0.58]) translate([0, 0, 0]) cube([0.4, 5, wall_h]);
  color([0.70, 0.66, 0.58]) translate([4.6, 0, 0]) cube([0.4, 5, wall_h]);
  // 后墙 (y=0 面, 厚 0.4) 挖门洞 x[1.7,3.3] z[0,2]
  difference() {
    color([0.70, 0.66, 0.58]) translate([0, 0, 0]) cube([5, 0.4, wall_h]);
    translate([1.7, -0.1, 0]) cube([1.6, 0.6, 2]);
  }
}

module windows() {
  // 左右墙窗 (y 0.5-2.5, z 0.7-1.9) + 窗玻璃
  for (x = [0.4, 4.6]) {
    difference() {
      color([0.70, 0.66, 0.58]) translate([x, 1.5, 1.3]) cube([0.4, 2.0, 1.2], center = true);
      translate([x, 1.5, 1.3]) cube([0.5, 1.8, 1.0], center = true);
    }
    // 窗玻璃 (薄板, 内侧暗色)
    color([0.30, 0.34, 0.40]) translate([x, 1.5, 1.3]) cube([0.1, 1.7, 0.9], center = true);
  }
}

module roof() {
  // 平顶 (5×5×0.3, z 4-4.3) + 屋脊 (z 4.1-4.5, 人字顶低模)
  color([0.55, 0.40, 0.34]) translate([0, 0, 4]) cube([5, 5, 0.3]);
  color([0.48, 0.35, 0.30]) translate([0, 2.35, 4.1]) cube([5, 0.3, 0.4]);
}

walls();
windows();
roof();
