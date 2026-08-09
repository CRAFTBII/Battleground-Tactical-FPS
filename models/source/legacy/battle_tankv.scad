// 立式油罐 (battle_tankv) — 储油区/补给站油罐
// 轴: x=宽(10), y=深(10), z=高(12); 原点在角(0,0,0); 中心 (5,5)
// 底部环墙(r5 撑 bbox) + 圆柱罐体 + 锥顶 + 顶盖
// 碰撞契约: 实心 10×10×10.5 → GLB bbox 必须精确 10×10×12
$fn = 12;

module tank() {
  // 底部环墙 (r=5 → bbox x/y 0-10, z 0-1.1)
  color([0.70, 0.64, 0.54]) translate([5, 5, 0.55]) cylinder(r = 5, h = 1.1, center = true);
  // 罐体 (r4.4, z 1.1-10.4)
  color([0.62, 0.56, 0.47]) translate([5, 5, 5.75]) cylinder(r = 4.4, h = 9.3, center = true);
  // 罐体分节缝 (2 道细环)
  color([0.58, 0.52, 0.44]) translate([5, 5, 3.5]) cylinder(r = 4.5, h = 0.12, center = true);
  color([0.58, 0.52, 0.44]) translate([5, 5, 7.5]) cylinder(r = 4.5, h = 0.12, center = true);
  // 锥顶 (r4.4→2.5, z 10.4-11.8)
  color([0.55, 0.50, 0.42]) translate([5, 5, 11.1]) cylinder(r1 = 4.4, r2 = 2.5, h = 1.4, center = true);
  // 顶盖 (r2.5→0.5, z 11.8-12)
  color([0.50, 0.46, 0.38]) translate([5, 5, 11.9]) cylinder(r1 = 2.5, r2 = 0.5, h = 0.2, center = true);
}

tank();
