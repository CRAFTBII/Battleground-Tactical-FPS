// 霰弹枪泵动前护木 pump forearm（独立枪栓）— 精细版 v2
// 默认套在枪管下方中部，沿 X 前后拖动即泵动
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

COL      = "#4a4036";
COL_DARK = "#15181c";

// 泵动护木：长圆角块环绕枪管下
color(COL){
  hull(){
    rbox(26,11,12,2.5);
    translate([0,0,-1]) rbox(22,10,12,2.5);
  }
}
// 防滑纹（横条）
for(i=[0:7]) color(COL_DARK) translate([12-i*3,0,-5]) rbox(1,11,1.5,0.4);
// 前端套环（抱住枪管）
color(COL_DARK) translate([13,0,0]) rotate([0,90,0]) cylinder(h=3,r=5,center=true);
// 后端套环
color(COL_DARK) translate([-13,0,0]) rotate([0,90,0]) cylinder(h=3,r=5,center=true);
