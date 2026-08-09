// 手枪枪身（不含套筒）— 精细版 v2
// 约定：+X = 枪口方向，+Z = 上，握把向下(-Z)
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

COL_FRAME = "#42474f";
COL_GRIP  = "#23272e";
COL_DARK  = "#15181c";
COL_STEEL = "#6b7178";

// 底把 frame（机匣下部）
color(COL_FRAME) rbox(40,9,20,2.5);

// 握把 grip：从 frame 下方后倾伸出
color(COL_GRIP){
  translate([3,-1,-4]) rotate([0,0,-14]){
    translate([0,0,-12]) hull(){
      rbox(15,10,18,2.5);
      translate([5,0,-9]) rbox(11,9,11,2.5);
    }
    // 握把底盖
    translate([2,0,-20]) rbox(12,9,3,1.5);
  }
}

// 扳机护圈 trigger guard（镂空圆环）
color(COL_DARK){
  difference(){
    translate([-3,0,-9]) rotate([90,0,0]) cylinder(h=10,r=6,center=true);
    translate([-3,0,-9]) rotate([90,0,0]) cylinder(h=10.8,r=4,center=true);
  }
}
// 扳机
color(COL_DARK) translate([-3,0,-6.5]) rotate([90,0,0]) cylinder(h=3.2,r=1.1,center=true);

// 复进簧筒（套筒座内）
color(COL_FRAME) translate([8,0,1]) rotate([0,90,0]) cylinder(h=18,r=4.6,center=true);

// 枪管 barrel：短粗，沿 +X 露出
color(COL_STEEL){
  translate([18,0,1]) rotate([0,90,0]) cylinder(h=18,r=3.2,center=true);
  // 枪口帽
  translate([27,0,1]) rotate([0,90,0]) cylinder(h=2,r=3.5,center=true);
}

// 套筒导轨座（顶部，供套筒滑配）
color(COL_DARK) translate([5,0,11]) rbox(30,7,3,1);

// 弹匣井 magazine well（底部）
color(COL_FRAME) translate([2,0,-11]) rbox(10,8,7,1.5);

// 准星基座
color(COL_DARK) translate([26,0,4]) rbox(2.2,2.2,3,0.5);
