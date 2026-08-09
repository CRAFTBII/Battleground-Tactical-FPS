// 卧式油罐 (battle_tankh) — 炼油区/补给站储油罐
// 轴: x=宽(20), y=深(9), z=高(8); 原点在角(0,0,0); 罐体沿 X 卧放
// 端部鞍座(撑 bbox) + 3 支墩 + 圆柱罐体 + 顶部走道护栏
// 碰撞契约: 实心 20×9×7.5 → GLB bbox 必须精确 20×9×8
$fn = 10;

module saddles() {
  // 端部鞍座 (撑住 x bbox 0-20, 全深 y 0-9)
  color([0.48, 0.46, 0.44]) translate([0, 0, 0]) cube([0.8, 9, 1.2]);
  color([0.48, 0.46, 0.44]) translate([19.2, 0, 0]) cube([0.8, 9, 1.2]);
}

module supports() {
  // 3 支墩 (罐体下方垫高, z 0-0.7)
  for (x = [2.5, 10, 17.5]) {
    color([0.48, 0.46, 0.44]) translate([x, 3.7, 0]) cube([0.9, 1.6, 0.7]);
  }
}

module tank_body() {
  // 罐体: 半径 3.6, 长 18.4 (x 0.8-19.2), 中心 z=4.3 (罐底 0.7)
  color([0.60, 0.54, 0.45]) translate([10, 4.5, 4.3]) rotate([0, 90, 0]) cylinder(r = 3.6, h = 18.4, center = true);
  // 端盖 (罐两端扁平封板)
  color([0.55, 0.49, 0.41]) translate([0.8, 4.5, 4.3]) rotate([0, 90, 0]) cylinder(r = 3.6, h = 0.4, center = true);
  color([0.55, 0.49, 0.41]) translate([19.2, 4.5, 4.3]) rotate([0, 90, 0]) cylinder(r = 3.6, h = 0.4, center = true);
  // 罐体分节缝 (3 道细环)
  for (x = [3, 10, 17]) {
    color([0.52, 0.47, 0.40]) translate([x, 4.5, 4.3]) rotate([0, 90, 0]) cylinder(r = 3.65, h = 0.15, center = true);
  }
}

module rail() {
  // 顶部走道护栏 (罐顶 z≈7.9, 细条 z 7.85-8.0)
  color([0.42, 0.40, 0.38]) translate([2.5, 3.9, 7.85]) cube([15, 0.15, 0.15]);
  color([0.42, 0.40, 0.38]) translate([2.5, 5.1, 7.85]) cube([15, 0.15, 0.15]);
  // 护栏立柱
  for (x = [2.5 : 2.5 : 17.5]) {
    color([0.42, 0.40, 0.38]) translate([x, 3.9, 7.2]) cube([0.12, 0.15, 0.8]);
    color([0.42, 0.40, 0.38]) translate([x, 5.1, 7.2]) cube([0.12, 0.15, 0.8]);
  }
}

saddles();
supports();
tank_body();
rail();
