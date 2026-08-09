// 突击步枪枪身（不含枪机框）— 精细版 v2
// +X = 枪口方向
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

COL_FRAME = "#3c4149";
COL_DARK  = "#16191d";
COL_STEEL = "#7a8089";

// 机匣 receiver
color(COL_FRAME) rbox(46,10,16,2.5);

// 枪管 barrel（长）+ 消焰器
color(COL_STEEL){
  translate([42,0,1]) rotate([0,90,0]) cylinder(h=50,r=3,center=true);
  translate([68,0,1]) rotate([0,90,0]) cylinder(h=6,r1=3.2,r2=2.2,center=true);
}
// 准星（护木前端）
color(COL_DARK) translate([60,0,4.5]) rbox(2,2,4,0.5);

// 护木 handguard（圆角 + 散热孔）
color(COL_DARK){
  translate([34,0,1]) rbox(30,11,13,2);
}
color(COL_FRAME){
  for(i=[0:5]) for(j=[-1,1]) translate([24+i*4, j*4.2,1]) rotate([0,90,0]) cylinder(h=4.2,r=1.4,center=true);
}

// 枪托 stock
color(COL_FRAME){
  translate([-30,0,0]) hull(){
    rbox(22,9,14,2.5);
    translate([-6,0,2]) rbox(14,7,16,2);   // 贴腮
  }
  translate([-42,0,1]) rbox(3,10,16,1.5);   // 缓冲底板
}

// 握把 grip
color(COL_DARK){
  translate([-8,-1,-4]) rotate([0,0,-12]) translate([0,0,-9]) hull(){
    rbox(12,9,15,2);
    translate([4,0,-7]) rbox(9,8,9,2);
  }
}

// 扳机护圈
color(COL_DARK){
  difference(){
    translate([-10,0,-7]) rotate([90,0,0]) cylinder(h=11,r=5,center=true);
    translate([-10,0,-7]) rotate([90,0,0]) cylinder(h=11.6,r=3.2,center=true);
  }
}
// 弹匣 magazine（弧形）
color(COL_DARK){
  translate([-2,0,-12]) hull(){
    rbox(10,8,16,2);
    translate([-3,0,-9]) rbox(9,7.5,12,2);
  }
}
// 顶部战术导轨
color(COL_DARK) translate([6,0,9]) rbox(40,6,2,1);
