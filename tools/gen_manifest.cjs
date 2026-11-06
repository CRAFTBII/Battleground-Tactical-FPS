#!/usr/bin/env node
/* Generate the active runtime manifest.
 * v4：models/buildings 下已验收的 GLB 会进入 buildings 分组（AssetLoader.preload 会缓存）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODELS = path.join(ROOT, 'models');
const APPROVED_BUILDINGS = ['house', 'cover', 'base', 'estate'];

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
    bolts: {},
    buildings: {}
  };

  const soldier = path.join(MODELS, 'soldier.glb');
  if (fs.existsSync(soldier)) manifest.soldier = 'soldier.glb';

  for (const file of listGlb(path.join(MODELS, 'guns'))) {
    const key = file.replace(/\.glb$/i, '');
    if (/_bolt$/.test(key)) manifest.bolts[key.replace(/_bolt$/, '')] = 'guns/' + file;
    else manifest.weapons[key] = 'guns/' + file;
  }

  for (const file of listGlb(path.join(MODELS, 'buildings'))) {
    const key = file.replace(/\.glb$/i, '');
    if (APPROVED_BUILDINGS.includes(key)) manifest.buildings[key] = 'buildings/' + file;
  }
  // v5 authored prefab：models/buildings/v5 下所有 GLB 自动收录（通过 validate_glb.py 后再放进来）
  for (const file of listGlb(path.join(MODELS, 'buildings', 'v5'))) {
    const key = file.replace(/\.glb$/i, '');
    manifest.buildings[key] = 'buildings/v5/' + file;
  }

  const out = path.join(MODELS, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

  console.log('写入 models/manifest.json（角色 / 武器 / 枪栓 / 已验收建筑）');
  console.log('  士兵: ' + (manifest.soldier || '（缺失）'));
  console.log('  武器: ' + Object.keys(manifest.weapons).length +
    ' | 枪栓: ' + Object.keys(manifest.bolts).length +
    ' | 建筑: ' + Object.keys(manifest.buildings).join(', '));
  if (!manifest.soldier) console.warn('缺少 models/soldier.glb');
  if (!Object.keys(manifest.weapons).length) console.warn('models/guns/ 下没有 GLB');
  if (!Object.keys(manifest.buildings).length) console.warn('models/buildings/ 下没有已验收 GLB');
}

main();
