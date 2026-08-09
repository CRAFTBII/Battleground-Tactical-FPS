// 手枪套筒 slide（独立枪栓）— 精细版 v2
// 闭锁位置：覆盖枪身上半部，沿 -X 拖动即后坐（拉套筒）
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

COL      = "#4a505a";
COL_DARK = "#15181c";

// 套筒主体：长圆角块，顶部微拱
color(COL){
  hull(){
    rbox(38,9,16,2.5);
    translate([2,0,1.5]) rbox(34,8.5,15,2.5);
  }
}
// 顶部准星 + 照门
color(COL_DARK){
  translate([25,0,9])   rbox(2.5,3,3,0.5);   // 准星
  translate([5,0,9])    rbox(3,3,3.5,0.5);   // 照门
}
// 侧面减重槽（长条）
color(COL_DARK){
  translate([12,4.7,0])  rbox(18,1,8,1);
  translate([12,-4.7,0]) rbox(18,1,8,1);
}
// 后端防滑纹
for(i=[0:5]) color(COL_DARK) translate([2+i*2,0,-7]) rbox(1,9,1.5,0.4);
// 前端枪口坡面暗示
color(COL_DARK) translate([18,0,2]) rotate([0,90,0]) cylinder(h=1.5,r=4.6,center=true);
