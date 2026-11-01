// v3.2 建筑模型/碰撞契约 QA：GLB 自描述元数据 + 门洞 + nav 连通
'use strict';
const S = require('./_qa_v12_stub');
const { loadMap, report, finish } = S;

const KEYS = ['house_small', 'house', 'warehouse', 'guardhouse', 'cover', 'farmhouse',
  'workshop', 'apartment', 'pumpstation', 'bunker', 'base', 'estate'];
const W3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- 1. GLB 元数据 vs 实际几何 ---------- */
console.log('\n[1] GLB 自描述元数据');
for (const k of KEYS) {
  const meta = AssetLoader.buildingMeta(k);
  report(k + ' 有 GLB extras.battlegame', !!meta, meta ? '' : 'missing');
  if (!meta) continue;
  const b = BuildingLib.build(k, 0, 0, 0, { w: meta.dims.w, d: meta.dims.d, h: meta.dims.h });
  report(k + ' 可构建', !!b && !!b.mesh, '');
  if (!b) continue;
  b.mesh.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(b.mesh);
  const size = bb.getSize(new THREE.Vector3());
  const okDim = Math.abs(size.x - meta.dims.w) < 0.08 && Math.abs(size.y - meta.dims.h) < 0.08 && Math.abs(size.z - meta.dims.d) < 0.08;
  report(k + ' 几何 bbox = 元数据尺寸', okDim, size.toArray().map(v => v.toFixed(2)).join('×') + ' vs ' + [meta.dims.w, meta.dims.h, meta.dims.d].join('×'));
  let bad = 0, nan = 0;
  for (const c of b.colliders) {
    for (const v of [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z]) if (!Number.isFinite(v)) nan++;
    if (c.min.x < -0.1 || c.min.z < -0.1 || c.max.x > meta.dims.w + 0.1 || c.max.z > meta.dims.d + 0.1 ||
        c.min.y < -0.1 || c.max.y > meta.dims.h + 0.1) bad++;
  }
  for (const p of b.platforms) {
    for (const v of [p.x0, p.x1, p.z0, p.z1, p.y]) if (!Number.isFinite(v)) nan++;
    if (p.x0 < -0.1 || p.x1 > meta.dims.w + 0.1 || p.z0 < -0.1 || p.z1 > meta.dims.d + 0.1 || p.y < -0.1 || p.y > meta.dims.h + 0.1) bad++;
  }
  report(k + ' 碰撞/平台在 footprint 内且无 NaN', bad === 0 && nan === 0, 'bad=' + bad + ' nan=' + nan);
  let doorBad = 0;
  for (const d of (b.doors || [])) {
    const w = Math.max(d.x1 - d.x0, d.z1 - d.z0); // 门宽 = 沿墙方向的长边
    if (w < 0.8) doorBad++;
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    for (const c of b.colliders) {
      if (c.min.y < 1.6 && c.max.y > 0.4 && cx > c.min.x && cx < c.max.x && cz > c.min.z && cz < c.max.z) { doorBad++; break; }
    }
  }
  report(k + ' 门洞宽度/不被碰撞堵住', doorBad === 0, 'bad=' + doorBad + ' doors=' + (b.doors || []).length);
}

/* ---------- 2. 运行时：每图门洞 nav 可走 + 两侧连通 ---------- */
function reachable(sx, sz, tx, tz) {
  const n = World.grid.n, cell = CFG.CELL;
  const s = Math.floor(sx / cell) + Math.floor(sz / cell) * n;
  const t = Math.floor(tx / cell) + Math.floor(tz / cell) * n;
  if (World.grid.blocked[s] || World.grid.blocked[t]) return false;
  const seen = new Uint8Array(n * n);
  const q = [s]; seen[s] = 1; let head = 0, steps = 0;
  while (head < q.length && steps++ < 60000) {
    const cur = q[head++];
    if (cur === t) return true;
    const cx = cur % n, cz = Math.floor(cur / n);
    const nb = [cur - 1, cur + 1, cur - n, cur + n];
    const ok = [cx > 0, cx < n - 1, cz > 0, cz < n - 1];
    for (let i = 0; i < 4; i++) if (ok[i] && !seen[nb[i]] && !World.grid.blocked[nb[i]]) { seen[nb[i]] = 1; q.push(nb[i]); }
  }
  return false;
}
for (const id of ['suburb', 'port', 'desert']) {
  loadMap(id);
  const doors = World.navDoors || [];
  report(id + ' 门洞已写入 navDoors', doors.length > 0, 'n=' + doors.length);
  let badWalk = 0, badCol = 0, linked = 0, testable = 0;
  for (let i = 0; i < doors.length; i++) {
    const d = doors[i], cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    if (!World.walkable(cx, cz)) badWalk++;
    if (World.colliders.some(c => c.min.y < 1.6 && c.max.y > 0.4 && cx > c.min.x && cx < c.max.x && cz > c.min.z && cz < c.max.z)) badCol++;
    if (i >= 40) continue;
    const dx = d.x1 - d.x0, dz = d.z1 - d.z0;
    const nx = dx < dz ? 1.3 : 0, nz = dx < dz ? 0 : 1.3;
    const a = { x: cx - nx, z: cz - nz }, b = { x: cx + nx, z: cz + nz };
    if (!World.walkable(a.x, a.z) || !World.walkable(b.x, b.z)) continue;
    testable++;
    if (reachable(a.x, a.z, b.x, b.z)) linked++;
  }
  report(id + ' 门洞中心可走且无碰撞', badWalk === 0 && badCol === 0, 'badWalk=' + badWalk + ' badCol=' + badCol);
  report(id + ' 抽样门洞两侧 nav 连通', testable > 0 && linked >= Math.ceil(testable * 0.8), linked + '/' + testable);
}

/* ---------- 3. 全部建筑走 GLB 元数据分支 ---------- */
const st = BuildingLib.status();
const notInline = Object.keys(st).filter(k => st[k] !== 'inline');
report('全部建筑使用 GLB 元数据/内联分支', notInline.length === 0, notInline.join(',') || 'all inline');

finish();
