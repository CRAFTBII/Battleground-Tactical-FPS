// 真实集成冒烟测试：用浏览器同款 three.min.js + 已生成的 BUILDINGS_OUT 调 BuildingLib.build()
'use strict';
const fs = require('fs');
const path = require('path');
global.THREE = require(path.join(__dirname, '..', 'libs', 'three.min.js'));
global.BUILDINGS_OUT = eval('(' + fs.readFileSync(path.join(__dirname, '..', 'models', 'buildings_out.js'), 'utf8')
  .replace('window.BUILDINGS_OUT =', '').replace(/;\s*$/, '') + ')');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'models.js'), 'utf8');
const BuildingLib = eval(src + '\n; BuildingLib');

const DIMS = {
  base:      { w: 24, d: 18, h: 8 },
  refinery:  { w: 20, d: 14, h: 12 },
  stadium:   { w: 26, d: 20, h: 14 },
  megatower: { w: 20, d: 20, h: 28 }
};
let ok = true;
for (const key of ['base', 'refinery', 'stadium', 'megatower']) {
  try {
    const r = BuildingLib.build(key, 0, 0, 0, DIMS[key]);
    if (!r) { console.log(`✗ ${key}: build 返回 null`); ok = false; continue; }
    const c = r.colliders.length, p = r.platforms.length;
    const meshVerts = r.mesh && r.mesh.geometry ? r.mesh.geometry.attributes.position.count : 0;
    // 检查碰撞盒都在合理世界范围内（无 NaN）
    let bad = 0;
    for (const bx of r.colliders) {
      if ([bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z].some(Number.isNaN)) bad++;
      if (bx.min.x > bx.max.x || bx.min.y > bx.max.y || bx.min.z > bx.max.z) bad++;
    }
    console.log(`✓ ${key}: mesh顶点=${meshVerts} 碰撞盒=${c} 平台=${p} 异常盒=${bad} 数据源=${r.src}`);
    if (bad) ok = false;
  } catch (e) {
    console.log(`✗ ${key}: 异常 ${e.message}`); ok = false;
  }
}
console.log('\nBuildingLib.status():', JSON.stringify(BuildingLib.status()));
console.log(ok ? '集成冒烟测试通过 ✅' : '集成冒烟测试有失败 ❌');
