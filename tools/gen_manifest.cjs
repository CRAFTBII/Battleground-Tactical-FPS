#!/usr/bin/env node
/* Generate the active runtime manifest.
 * Buildings are intentionally excluded until v4 assets are approved in the Catalog.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS = path.join(ROOT, 'models');

function listGlb(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.glb')).sort();
}

function main() {
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    soldier: null,
    weapons: {},
    bolts: {}
  };

  const soldier = path.join(MODELS, 'soldier.glb');
  if (fs.existsSync(soldier)) manifest.soldier = 'soldier.glb';

  for (const file of listGlb(path.join(MODELS, 'guns'))) {
    const key = file.replace(/\.glb$/i, '');
    if (/_bolt$/.test(key)) manifest.bolts[key.replace(/_bolt$/, '')] = 'guns/' + file;
    else manifest.weapons[key] = 'guns/' + file;
  }

  const out = path.join(MODELS, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

  console.log('写入 models/manifest.json（仅角色 / 武器 / 枪栓）');
  console.log('  士兵: ' + (manifest.soldier || '（缺失）'));
  console.log('  武器: ' + Object.keys(manifest.weapons).length +
    ' | 枪栓: ' + Object.keys(manifest.bolts).length);
  if (!manifest.soldier) console.warn('缺少 models/soldier.glb');
  if (!Object.keys(manifest.weapons).length) console.warn('models/guns/ 下没有 GLB');
}

main();
