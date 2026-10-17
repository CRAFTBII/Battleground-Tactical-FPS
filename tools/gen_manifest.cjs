#!/usr/bin/env node
/* 生成 models/manifest.json —— 模型资源清单，AssetLoader 据此加载。
 * 用法：node tools/gen_manifest.cjs
 * 约定（与 backup/deinline-spec.md §2 一致）：
 *   models/soldier.glb            士兵（7 部件节点树）
 *   models/guns/<key>.glb         枪身
 *   models/guns/<key>_bolt.glb    枪栓（glTF extras 带 boltRest/boltTravel/zExt）
 *   models/buildings/<key>.glb    建筑（POSITION + COLOR_0）
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
    bolts: {},
    buildings: {},
    buildingGroups: { out: [], legacy: [] }
  };

  const soldier = path.join(MODELS, 'soldier.glb');
  if (fs.existsSync(soldier)) manifest.soldier = 'soldier.glb';

  for (const f of listGlb(path.join(MODELS, 'guns'))) {
    const base = f.replace(/\.glb$/i, '');
    if (/_bolt$/.test(base)) manifest.bolts[base.replace(/_bolt$/, '')] = 'guns/' + f;
    else manifest.weapons[base] = 'guns/' + f;
  }

  for (const f of listGlb(path.join(MODELS, 'buildings'))) {
    const base = f.replace(/\.glb$/i, '');
    manifest.buildings[base] = 'buildings/' + f;
  }

  // 分组信息：原 BUILDINGS_OUT（新类型）vs BUILDINGS_DATA（旧 5 型）。
  // 旧 5 型若仍存在同名 GLB 则以数据为准：导出工具会写进 buildingGroups 提示文件。
  const hintPath = path.join(MODELS, '.building-groups.json');
  if (fs.existsSync(hintPath)) {
    try {
      const hint = JSON.parse(fs.readFileSync(hintPath, 'utf8'));
      manifest.buildingGroups.legacy = (hint.legacy || []).filter(k => manifest.buildings[k]);
      manifest.buildingGroups.out = (hint.out || []).filter(k => manifest.buildings[k]);
    } catch (e) {
      console.warn('忽略损坏的 .building-groups.json:', e.message);
    }
  }
  const grouped = new Set([...manifest.buildingGroups.legacy, ...manifest.buildingGroups.out]);
  for (const k of Object.keys(manifest.buildings)) {
    if (!grouped.has(k)) manifest.buildingGroups.out.push(k);
  }

  const out = path.join(MODELS, 'manifest.json');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');

  const nW = Object.keys(manifest.weapons).length;
  const nB = Object.keys(manifest.bolts).length;
  const nG = Object.keys(manifest.buildings).length;
  console.log('写入 models/manifest.json');
  console.log('  士兵: ' + (manifest.soldier || '（缺失）'));
  console.log('  武器: ' + nW + ' | 枪栓: ' + nB + ' | 建筑: ' + nG);
  if (!manifest.soldier) console.warn('⚠ 缺少 models/soldier.glb');
  if (!nW) console.warn('⚠ models/guns/ 下没有 GLB');
  if (!nG) console.warn('⚠ models/buildings/ 下没有 GLB');
}

main();
