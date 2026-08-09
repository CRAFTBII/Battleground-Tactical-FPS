// 步枪枪机框 bolt carrier（独立枪栓）— 精细版 v2
// 默认位于机匣内，沿 -X 拖动即后坐（拉枪机）
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

COL       = "#565c66";
COL_DARK  = "#16191d";
COL_STEEL = "#7a8089";

// 枪机框主体
color(COL) rbox(26,8,12,2);

// 拉机柄 charging handle（侧向伸出）
color(COL_DARK){
  translate([4, 5.5, 0]) rotate([0,90,0]) cylinder(h=8,r=1.6,center=true);
  translate([8, 6.5, 0]) sphere(2);
}
// 表面导槽
color(COL_DARK) translate([-4,0,3]) rbox(18,8.5,2,1);

// 前端枪机头
color(COL_STEEL) translate([14,0,0]) rotate([0,90,0]) cylinder(h=4,r=3,center=true);
