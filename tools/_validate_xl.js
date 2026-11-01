// 校验当前运行时 BuildingLib.CONFIGS，而不是从旧生成器重建历史数据。
// 用法: node tools/_validate_xl.js
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dims = JSON.parse(read('models/buildings_dims.json'));
const modelsSrc = read('js/models.js');

function extractConfigs(src) {
  const m = src.match(/CONFIGS:\\s*(\\{[\\s\\S]*?)\\n  \\},\\n\\n  \\/\\/ 构建一栋建筑/);
  if (!m) throw new Error('未能定位 BuildingLib.CONFIGS');
  return Function('"use strict"; return (' + m[1] + '\\n);')();
}
const configs = extractConfigs(modelsSrc);
let errors = 0, warnings = 0;
const fail = (msg) => { console.error('✗ ' + msg); errors++; };
const warn = (msg) => { console.warn('⚠ ' + msg); warnings++; };
const finite = n => typeof n === 'number' && Number.isFinite(n);

console.log('=== 当前运行时建筑碰撞配置结构检查 ===');
for (const [key, cfg] of Object.entries(configs)) {
  const real = dims[key];
  const colliders = cfg.colliders || [];
  const platforms = cfg.platforms || [];
  let malformed = 0, outside = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (!Array.isArray(c) || c.length !== 6 || !c.every(finite)) {
      fail(key + ' collider[' + i + '] 格式错误/含非有限数值'); malformed++; continue;
    }
    if (!(c[0] < c[3] && c[1] < c[4] && c[2] < c[5])) {
      fail(key + ' collider[' + i + '] 轴范围翻转或尺寸为零: ' + JSON.stringify(c)); malformed++; continue;
    }
    if (real && (c[0] < -0.05 || c[1] < -0.05 || c[2] < -0.05 ||
      c[3] > real.w + 0.05 || c[4] > real.d + 0.05 || c[5] > real.h + 0.05)) {
      warn(key + ' collider[' + i + '] 超出模型尺寸边界 ' + JSON.stringify(c));
      outside++;
    }
  }
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    const vals = p && [p.x0, p.x1, p.y0, p.y1, p.y];
    if (!vals || !vals.every(finite) || !(p.x0 < p.x1 && p.y0 < p.y1)) {
      fail(key + ' platform[' + i + '] 格式错误/范围翻转'); malformed++;
    }
    if (real && vals && vals.every(finite) &&
      (p.x0 < -0.05 || p.y0 < -0.05 || p.x1 > real.w + 0.05 ||
       p.y1 > real.d + 0.05 || p.y < -0.05 || p.y > real.h + 0.5)) {
      warn(key + ' platform[' + i + '] 超出模型尺寸边界'); outside++;
    }
  }
  if (!real) warn(key + ' 在 models/buildings_dims.json 中没有尺寸记录，跳过边界核对');
  console.log((errors ? '' : '✓ ') + key + ': ' + colliders.length +
    ' colliders / ' + platforms.length + ' platforms' +
    (malformed ? ' / malformed=' + malformed : '') +
    (outside ? ' / out-of-bounds=' + outside : ''));
}
console.log('\\n=== 地图摆放 scale / 尺寸检查 ===');
for (const map of ['desert', 'port', 'suburb']) {
  const src = read('js/maps/' + map + '.js');
  const starts = [...src.matchAll(/type:\\s*'model',\\s*key:\\s*'([^']+)'/g)];
  for (const hit of starts) {
    const start = hit.index;
    const nextObj = src.indexOf('\\n      {', start + 1);
    const nextEnd = src.indexOf('\\n    ],', start + 1);
    const end = [nextObj, nextEnd].filter(n => n >= 0).sort((a,b)=>a-b)[0] ?? src.length;
    const block = src.slice(start, end);
    const key = hit[1], real = dims[key];
    const get = name => {
      const m = block.match(new RegExp('\\\\b' + name + ':\\\\s*([+-]?(?:\\\\d+\\\\.?\\\\d*|\\\\.\\\\d+))'));
      return m ? Number(m[1]) : null;
    };
    const scale = get('scale');
    const w = get('w'), d = get('d'), h = get('h');
    if (scale !== null && (!(scale > 0) || !finite(scale))) fail(map + '/' + key + ' scale 非法: ' + scale);
    if (scale !== null && real) {
      if (Math.abs(real.w * scale) < 0.001 || Math.abs(real.d * scale) < 0.001 || Math.abs(real.h * scale) < 0.001)
        fail(map + '/' + key + ' scale 产生零尺寸');
    } else if ([w,d,h].every(v => v !== null) && real) {
      const factors = [w / real.w, d / real.d, h / real.h];
      const ratio = Math.max(...factors) / Math.min(...factors);
      if (ratio > 1.06) warn(map + '/' + key + ' 显式 w/d/h 非等比，比例差 ' + ratio.toFixed(2) + 'x');
    }
  }
}
console.log('\\n结果: ' + errors + ' errors, ' + warnings + ' warnings');
if (errors) process.exitCode = 1;
