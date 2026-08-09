// 泵动霰弹枪枪身（不含前护木）— 精细版 v2
// +X = 枪口方向，木质枪托
$fn = 16;

module rbox(x,y,z,r=1.2){
  hull(){
    translate([-x/2+r,-y/2+r,-z/2+r]) sphere(r);
    translate([ x/2-r,-y/2+r,-z/2+r]) sphere(r);
    translate([-x/2+r, y/2-r,-z/2+r]) sphere(r);
    translate([ x/2-r, y/2-r,-z/2+r]) sphere(r);
    translate([-x/2+r,-y/2+r, z/2-r]) sphere(r);
    translate([ x/2-r,-y/2+r, z/2-r]) sphere(r);
    translate([-x/2+r, y/2-r, z/2-r]) sphere(r);
    translate([ x/2-r, y/2-r, z/2-r]) sphere(r);
  }
}

COL_FRAME = "#2f333a";
COL_WOOD  = "#6b4f33";
COL_DARK  = "#15181c";
COL_STEEL = "#7a8089";

// 木制枪托 + 前握把（木质，斜面造型）
color(COL_WOOD){
  translate([-26,0,1]) hull(){
    rbox(26,9,14,2.5);
    translate([-8,0,3]) rbox(16,7,16,2);
  }
  // 前握把小木块
  translate([-2,0,-7]) rbox(10,8,12,2);
}

// 机匣 receiver
color(COL_FRAME) rbox(20,9,15,2.5);   // X -10..10

// 枪管 barrel（泵动霰弹，中等长度）+ 枪口
color(COL_STEEL){
  translate([30,0,1]) rotate([0,90,0]) cylinder(h=42,r=3.5,center=true);
  translate([51,0,1]) rotate([0,90,0]) cylinder(h=3,r=3.8,center=true);
}
// 管状弹仓（枪管下方）
color(COL_DARK) translate([26,0,-3]) rotate([0,90,0]) cylinder(h=36,r=2,center=true);

// 扳机护圈
color(COL_DARK){
  difference(){
    translate([-4,0,-6]) rotate([90,0,0]) cylinder(h=9,r=4.5,center=true);
    translate([-4,0,-6]) rotate([90,0,0]) cylinder(h=9.6,r=2.8,center=true);
  }
}
// 顶部简易瞄具座
color(COL_DARK) translate([8,0,9]) rbox(14,5,2,1);
