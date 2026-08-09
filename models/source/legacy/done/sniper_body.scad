// 狙击步枪枪身（不含枪机）— 精细版 v2
// +X = 枪口方向，长枪管 + 瞄具
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

COL_FRAME = "#23272e";
COL_DARK  = "#0f1114";
COL_STEEL = "#828990";
COL_GLASS = "#3a6b8a";

// 枪托（可调贴腮 + 底板）
color(COL_FRAME){
  translate([-34,0,0]) hull(){
    rbox(26,10,16,2.5);
    translate([-8,0,3]) rbox(14,8,18,2);
  }
  translate([-48,0,2]) rbox(3,11,18,1.5);
}
// 机匣
color(COL_FRAME) rbox(40,10,15,2.5);

// 长枪管 + 制退器
color(COL_STEEL){
  translate([52,0,0]) rotate([0,90,0]) cylinder(h=72,r=2.6,center=true);
  translate([88,0,0]) rotate([0,90,0]) cylinder(h=8,r1=3,r2=2,center=true);
}
// 枪管箍
color(COL_DARK) translate([20,0,0]) rotate([0,90,0]) cylinder(h=2,r=3.2,center=true);

// 弹匣
color(COL_DARK){ translate([2,0,-13]) rbox(12,9,16,2); }

// 握把
color(COL_DARK){
  translate([-12,-1,-4]) rotate([0,0,-10]) translate([0,0,-9]) hull(){
    rbox(12,9,15,2); translate([4,0,-7]) rbox(9,8,9,2);
  }
}
// 扳机护圈
color(COL_DARK){
  difference(){
    translate([-14,0,-7]) rotate([90,0,0]) cylinder(h=11,r=4.5,center=true);
    translate([-14,0,-7]) rotate([90,0,0]) cylinder(h=11.6,r=2.8,center=true);
  }
}
// 瞄准镜 scope：镜筒 + 两环 + 玻璃暗示
color(COL_DARK){
  translate([2,0,13]) rbox(22,5,5,1.5);
  translate([-6,0,13]) cylinder(h=6,r=4,center=true);
  translate([10,0,13]) cylinder(h=6,r=4,center=true);
}
color(COL_GLASS) translate([2,0,13]) rbox(18,3,3,1);
