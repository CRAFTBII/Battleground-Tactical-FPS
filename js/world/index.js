/*
 * Map / World v4 entrypoint.
 *
 * Boot contract (js/main.js):
 *   1. WORLD_V4_IMPLEMENTED === true
 *   2. await ready
 *   3. window.World / window.MapRegistry exist
 *
 * 物理：Rapier 3D（静态 trimesh + 胶囊体 sweep）
 * 地图：data 驱动（js/world/maps.js），旧 World API 全部兼容。
 */
import * as RAPIER from '/libs/rapier/rapier.mjs';
import { createWorldRuntime } from './runtime.js';

export const WORLD_V4_IMPLEMENTED = true;
export const WORLD_V4_STATUS = 'rapier-runtime';

export const ready = (async () => {
  if (typeof window.THREE === 'undefined') {
    throw new Error('THREE 未加载，无法初始化 v4 World');
  }
  await RAPIER.init();
  const { World, MapRegistry } = createWorldRuntime(RAPIER);
  window.World = World;
  window.MapRegistry = MapRegistry;
  window.findPath = (sx, sz, tx, tz) => World.nav.findPath(sx, sz, tx, tz);
  window.gridLineClear = (a, b) => World.nav.gridLineClear(a, b);
  console.log('[World v4] Rapier 就绪 · 地图 ' + MapRegistry.ids().join(', '));
  return true;
})();

export default ready;
