/*
 * v4 nav — 稀疏 2D 网格 A*（外部 API 兼容旧全局 findPath/gridLineClear）。
 * 网格来自 Rapier 向下射线 + 地图建筑/道具 footprint；不读取旧 2D 地图数据。
 */

export function createNav(physics) {
  const CELL = 2;
  let size = 300;
  let n = 0;
  let blocked = null;
  let heights = null;
  let ready = false;

  function idx(cx, cz) { return cz * n + cx; }
  function cellOf(v) { return Math.max(0, Math.min(n - 1, Math.floor(v / CELL))); }
  function center(c) { return (c + 0.5) * CELL; }

  function build(mapSize, rects) {
    size = mapSize;
    n = Math.ceil(size / CELL);
    blocked = new Uint8Array(n * n);
    heights = new Float32Array(n * n);
    const inset = 2.2;
    for (let cz = 0; cz < n; cz++) {
      const z = center(cz);
      for (let cx = 0; cx < n; cx++) {
        const x = center(cx);
        const i = idx(cx, cz);
        if (x < inset || z < inset || x > size - inset || z > size - inset) { blocked[i] = 1; continue; }
        let inRect = false;
        for (let r = 0; r < rects.length; r++) {
          const q = rects[r];
          if (x > q.x0 - 0.55 && x < q.x1 + 0.55 && z > q.z0 - 0.55 && z < q.z1 + 0.55) { inRect = true; break; }
        }
        if (inRect || !physics.walkablePoint(x, z)) { blocked[i] = 1; continue; }
        heights[i] = physics.heightAt(x, z);
      }
    }
    ready = true;
    return { cells: n * n, blocked: countBlocked() };
  }

  function countBlocked() {
    if (!blocked) return 0;
    let c = 0;
    for (let i = 0; i < blocked.length; i++) if (blocked[i]) c++;
    return c;
  }

  function nearestOpen(cx, cz, maxR) {
    const rMax = maxR === undefined ? 6 : maxR;
    if (!blocked) return null;
    if (cx >= 0 && cx < n && cz >= 0 && cz < n && !blocked[idx(cx, cz)]) return { cx, cz };
    for (let r = 1; r <= rMax; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= n || z >= n) continue;
          if (!blocked[idx(x, z)]) return { cx: x, cz: z };
        }
      }
    }
    return null;
  }

  function isCellOpen(cx, cz) {
    return cx >= 0 && cz >= 0 && cx < n && cz < n && !blocked[idx(cx, cz)];
  }

  function lineClearCells(a, b) {
    // 超覆盖采样：走格心线，任何一格阻挡即不直通
    let ax = a.x / CELL - 0.5, az = a.z / CELL - 0.5;
    let bx = b.x / CELL - 0.5, bz = b.z / CELL - 0.5;
    const dx = bx - ax, dz = bz - az;
    const steps = Math.ceil(Math.hypot(dx, dz) * 2.4);
    let lastCx = null, lastCz = null;
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      const cx = Math.round(ax + dx * t), cz = Math.round(az + dz * t);
      if (cx === lastCx && cz === lastCz) continue;
      lastCx = cx; lastCz = cz;
      if (!isCellOpen(cx, cz)) return false;
    }
    return true;
  }

  function findPath(sx, sz, tx, tz) {
    if (!ready) return [];
    let scx = cellOf(sx), scz = cellOf(sz);
    let tcx = cellOf(tx), tcz = cellOf(tz);
    const sOpen = nearestOpen(scx, scz, 4);
    const tOpen = nearestOpen(tcx, tcz, 6);
    if (!sOpen || !tOpen) return [];
    scx = sOpen.cx; scz = sOpen.cz; tcx = tOpen.cx; tcz = tOpen.cz;
    if (scx === tcx && scz === tcz) return [];

    const N = n * n;
    const gScore = new Float32Array(N).fill(Infinity);
    const fScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];
    const start = idx(scx, scz), goal = idx(tcx, tcz);

    const h = (i) => {
      const cx = i % n, cz = (i / n) | 0;
      const dx = Math.abs(cx - tcx), dz = Math.abs(cz - tcz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const push = (i) => {
      heap.push(i);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (fScore[heap[p]] <= fScore[heap[k]]) break;
        const tmp = heap[p]; heap[p] = heap[k]; heap[k] = tmp; k = p;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = k * 2 + 1, r = l + 1;
          let m = k;
          if (l < heap.length && fScore[heap[l]] < fScore[heap[m]]) m = l;
          if (r < heap.length && fScore[heap[r]] < fScore[heap[m]]) m = r;
          if (m === k) break;
          const tmp = heap[m]; heap[m] = heap[k]; heap[k] = tmp; k = m;
        }
      }
      return top;
    };

    gScore[start] = 0; fScore[start] = h(start); push(start);
    let expanded = 0;
    const maxExpand = 9000;
    while (heap.length && expanded++ < maxExpand) {
      const cur = pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % n, cz = (cur / n) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx, nz = cz + dz;
          if (!isCellOpen(nx, nz)) continue;
          if (dx && dz && (!isCellOpen(cx + dx, cz) || !isCellOpen(cx, cz + dz))) continue;
          const ni = idx(nx, nz);
          if (closed[ni]) continue;
          const step = (dx && dz) ? Math.SQRT2 : 1;
          const ng = gScore[cur] + step;
          if (ng < gScore[ni]) {
            gScore[ni] = ng;
            came[ni] = cur;
            fScore[ni] = ng + h(ni);
            push(ni);
          }
        }
      }
    }

    if (came[goal] === -1 && start !== goal) return [];
    const cells = [];
    let cur = goal;
    while (cur !== -1) { cells.push(cur); cur = came[cur]; }
    cells.reverse();
    // 起点格心 → 终点精确点
    const pts = cells.map(i => ({ x: center(i % n), z: center((i / n) | 0) }));
    if (pts.length) {
      pts[0] = { x: sx, z: sz };
      const last = pts.length - 1;
      if (gridLineClearWorld(pts[last], { x: tx, z: tz })) pts[last] = { x: tx, z: tz };
    }
    // 路径平滑：能直通的中间点直接跳过
    const out = [pts[0]];
    let i = 1;
    while (i < pts.length) {
      let j = pts.length - 1;
      for (; j > i; j--) {
        if (gridLineClearWorld(out[out.length - 1], pts[j])) break;
      }
      out.push(pts[j]);
      i = j + 1;
    }
    return out;
  }

  function gridLineClearWorld(a, b) {
    // 带 0.35m 半径的近似的双线采样
    if (!ready) return false;
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return true;
    const px = -dz / len * 0.38, pz = dx / len * 0.38;
    const lines = [
      [a.x, a.z, b.x, b.z],
      [a.x + px, a.z + pz, b.x + px, b.z + pz],
      [a.x - px, a.z - pz, b.x - px, b.z - pz]
    ];
    for (const [x1, z1, x2, z2] of lines) {
      const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / (CELL * 0.5));
      for (let i = 0; i <= steps; i++) {
        const t = steps ? i / steps : 0;
        const cx = cellOf(x1 + (x2 - x1) * t), cz = cellOf(z1 + (z2 - z1) * t);
        if (!isCellOpen(cx, cz)) return false;
      }
    }
    return true;
  }

  return {
    build, findPath, gridLineClear: gridLineClearWorld, isCellOpen, nearestOpen,
    get ready() { return ready; },
    get cellSize() { return CELL; }
  };
}
