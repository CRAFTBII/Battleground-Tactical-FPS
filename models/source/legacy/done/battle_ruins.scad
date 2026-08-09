// 废墟楼 (battle_ruins) — 枪战战损建筑
// 残破楼体 + 参差不齐的破损顶 + 地面瓦砾
$fn = 6;

module ruins() {
  // 残破主楼体
  color([0.60, 0.57, 0.52]) translate([0, 0, 12]) cube([20, 16, 24], center = true);

  // 破损顶部（高低错落的小块模拟炸毁边缘）
  for (i = [0:3:18]) {
    hh = (i % 4) + 1.5;
    color([0.58, 0.55, 0.50]) translate([i - 9, 5, 24 + hh/2]) cube([2.4, 2.4, hh], center = true);
  }
  // 一侧塌掉一角的缺口（暗块表示空洞）
  color([0.30, 0.30, 0.30]) translate([8, -4, 16]) cube([4, 4, 12], center = true);
  // 地面瓦砾堆
  color([0.50, 0.48, 0.45]) translate([14, 2, 0.8]) cube([7, 9, 1.6], center = true);
  color([0.48, 0.46, 0.43]) translate([-13, -3, 0.6]) cube([5, 6, 1.2], center = true);
}

ruins();
