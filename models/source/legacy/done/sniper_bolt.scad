// 狙击枪旋转后拉式枪机 bolt（独立枪栓）— 精细版 v2
// 默认位于机匣后部，沿 -X 拖动即后拉（旋转后拉式）
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

COL       = "#5b616b";
COL_DARK  = "#0f1114";

// 枪机主体（圆柱）
color(COL) rotate([0,90,0]) cylinder(h=22,r=3.5,center=true);

// 机柄 bolt handle：L 形弯折（向下再出球柄）
color(COL_DARK){
  translate([6,0,0]) rotate([0,90,0]) cylinder(h=4,r=2,center=true);
  translate([8,0,-4]) cylinder(h=10,r=1.6,center=true);
  translate([8,-4,-9]) sphere(2.2);
}
// 枪机头
color(COL) translate([-12,0,0]) rotate([0,90,0]) cylinder(h=3,r=3.8,center=true);
// 机柄座
color(COL_DARK) translate([10,0,0]) rbox(4,6,6,1);
