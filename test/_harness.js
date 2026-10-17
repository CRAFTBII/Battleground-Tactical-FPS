/* ============================================
 * 测试公共引导 —— 去内联改造后的加载契约
 *
 * 改造前：测试直接 vm 加载 models/*_data.js，全局得到 SOLDIER_DATA 等。
 * 改造后：模型是 HTTP 提供的 .glb，运行时靠 AssetLoader + GLB 解析。
 * 无头测试不真起服务器，这里直接把磁盘上的 GLB 同步灌进 AssetLoader 缓存，
 * 让所有老测试无需改成 async 也能跑同一套产品代码。
 *
 * 用法（在 scripts 数组里放 'js/glb.js','js/assetLoader.js'，加载完再调）：
 *   const H = require('');      // 路径按所在目录调整
 *   ... runInThisContext 加载脚本 ...
 *   H.preloadSync(ROOT);
 * ============================================ */
'use strict';
const fs = require('fs');
const path = require('path');

/** Buffer → 独立 ArrayBuffer（不能直接用 buffer.buffer，Node 有 8KB 池化） */
function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * 同步把磁盘上的模型资源灌进全局 AssetLoader。
 * 必须在 js/glb.js 与 js/assetLoader.js 已被 runInThisContext 加载之后调用。
 * @param {string} ROOT 项目根目录（含 models/）
 * @returns {boolean} 是否全部加载成功
 */
function preloadSync(ROOT) {
  const AP = (typeof AssetLoader !== 'undefined') ? AssetLoader
    : (typeof globalThis !== 'undefined' ? globalThis.AssetLoader : undefined);
  const GLBP = (typeof GLB !== 'undefined') ? GLB
    : (typeof globalThis !== 'undefined' ? globalThis.GLB : undefined);
  if (!AP) throw new Error('_harness.preloadSync: AssetLoader 未定义（脚本加载顺序里缺 js/assetLoader.js？）');
  if (!GLBP) throw new Error('_harness.preloadSync: GLB 未定义（脚本加载顺序里缺 js/glb.js？）');

  const modelsDir = path.join(ROOT, 'models');
  const manifestPath = path.join(modelsDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('_harness.preloadSync: 缺 models/manifest.json —— 先跑 node tools/export_assets.cjs 与 node tools/gen_manifest.cjs');
  }
  AP.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const load = (rel) => {
    const abs = path.join(modelsDir, rel);
    if (!fs.existsSync(abs)) throw new Error('_harness.preloadSync: 缺文件 models/' + rel);
    const g = GLBP.parse(toArrayBuffer(fs.readFileSync(abs)));
    AP.stats.files++;
    AP.stats.bytes += fs.statSync(abs).size;
    return g;
  };

  if (AP.manifest.soldier) AP.cache.soldier = load(AP.manifest.soldier);
  for (const [k, rel] of Object.entries(AP.manifest.weapons || {})) AP.cache.weapons[k] = load(rel);
  for (const [k, rel] of Object.entries(AP.manifest.bolts || {})) AP.cache.bolts[k] = load(rel);
  for (const [k, rel] of Object.entries(AP.manifest.buildings || {})) AP.cache.buildings[k] = load(rel);

  AP.ready = true;
  AP.failed = false;
  return true;
}

module.exports = { preloadSync, toArrayBuffer };
