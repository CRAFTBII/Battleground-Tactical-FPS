/*
 * v4 physics adapter — Rapier 3D static world + capsule sweep + ray queries.
 * 不依赖旧 World.colliders；旧 AABB 列表只是兼容层，由 runtime 另行生成。
 */

export function createPhysics(RAPIER) {
  let world = null;
  let staticBody = null;
  const capsuleCache = new Map();
  let trimeshCount = 0;
  let cuboidCount = 0;

  function reset() {
    if (world) {
      try { world.free(); } catch (e) { /* noop */ }
    }
    world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    staticBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    capsuleCache.clear();
    trimeshCount = 0;
    cuboidCount = 0;
  }

  function addCuboid(hx, hy, hz, x, y, z) {
    const c = RAPIER.ColliderDesc.cuboid(Math.max(0.01, hx), Math.max(0.01, hy), Math.max(0.01, hz))
      .setTranslation(x, y, z);
    world.createCollider(c, staticBody);
    cuboidCount++;
  }

  function addCuboidDesc(desc) {
    if (!desc) return;
    world.createCollider(desc, staticBody);
    cuboidCount++;
  }

  function addTrimesh(positions, indices) {
    if (!positions || !indices || indices.length < 3) return;
    const desc = RAPIER.ColliderDesc.trimesh(positions, indices);
    world.createCollider(desc, staticBody);
    trimeshCount++;
  }

  /** Rapier 的 query pipeline 需要 step 一次才包含新静态碰撞体。 */
  function finalize() {
    world.step();
  }

  function ray(origin, dir, maxDist) {
    if (!world) return null;
    const r = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z });
    const hit = world.castRay(r, maxDist, true);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      t,
      point: { x: origin.x + dir.x * t, y: origin.y + dir.y * t, z: origin.z + dir.z * t },
      collider: hit.collider
    };
  }

  /** 视线/弹道遮挡：命中返回命中点（THREE.Vector3 兼容对象），否则 null。 */
  function segmentBlocked(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return null;
    const hit = ray(from, { x: dx / len, y: dy / len, z: dz / len }, Math.max(0.01, len - 0.03));
    return hit ? hit.point : null;
  }

  /** 竖直射线取地面/楼板高度；currentY 用于多楼层（从当前脚底往上找最近的下方表面）。 */
  function heightAt(x, z, currentY) {
    const hasY = typeof currentY === 'number' && Number.isFinite(currentY);
    const startY = hasY ? currentY + 1.35 : 90;
    const maxToi = startY + 40;
    const hit = ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 }, maxToi);
    if (!hit) return 0;
    return hit.point.y;
  }

  /** 点是否在可行走面上（只看地面高度 + 水平边界，建筑 footprint 由 runtime 叠加）。 */
  function walkablePoint(x, z) {
    if (!world) return false;
    const hit = ray({ x, y: 2.6, z }, { x: 0, y: -1, z: 0 }, 7);
    if (!hit) return false;
    const y = hit.point.y;
    // 允许地坪/薄楼板/矮台阶；拒绝墙体顶部/屋顶（footprint 另外会拦）
    return y > -1.2 && y < 1.6;
  }

  function capsule(radius, halfHeight) {
    const key = radius.toFixed(3) + ':' + halfHeight.toFixed(3);
    let s = capsuleCache.get(key);
    if (!s) {
      s = new RAPIER.Capsule(halfHeight, radius);
      capsuleCache.set(key, s);
    }
    return s;
  }

  function castCapsule(x, yCenter, z, dx, dz, radius, halfHeight) {
    if (!world) return null;
    const shape = capsule(radius, halfHeight);
    const hit = world.castShape(
      { x, y: yCenter, z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dx, y: 0, z: dz },
      shape,
      0,    // targetDistance
      1,    // maxToi（位移用 0..1 参数化）
      true  // stopAtPenetration
    );
    return hit || null;
  }

  /**
   * 胶囊体水平移动 + 贴墙滑动 + 台阶抬升。
   * feet 为脚底位置；返回新的脚底位置。不处理重力/跳跃（沿用旧 PC/AI 逻辑）。
   */
  function moveCapsule(feet, dx, dz, radius, height, stepHeight) {
    const r = Math.max(0.1, radius || 0.35);
    const h = Math.max(2 * r + 0.02, height || 2.0);
    const hh = (h - 2 * r) / 2;
    const skin = 0.035;
    const want = Math.hypot(dx, dz);
    let x = feet.x, y = feet.y, z = feet.z;
    let remX = dx, remZ = dz;
    let blocked = false;

    for (let i = 0; i < 3; i++) {
      const len = Math.hypot(remX, remZ);
      if (len < 1e-4) break;
      const hit = castCapsule(x, y + h / 2, z, remX, remZ, r, hh);
      if (!hit) { x += remX; z += remZ; break; }
      blocked = true;
      const toi = Math.max(0, Math.min(1, hit.time_of_impact));
      const travel = Math.max(0, Math.min(1, toi - skin / len));
      x += remX * travel;
      z += remZ * travel;
      remX *= (1 - travel);
      remZ *= (1 - travel);

      const n = hit.normal1;
      const nl = Math.hypot(n.x, n.z);
      if (nl < 0.25) break; // 顶到水平面：直接停
      const nx = n.x / nl, nz = n.z / nl;
      const dot = remX * nx + remZ * nz;
      if (dot >= 0) break;
      remX -= nx * dot;
      remZ -= nz * dot;
    }

    // 台阶：水平被挡住近一半时，抬高 stepHeight 再试一次
    if (stepHeight > 0 && blocked && want > 0.02 && Math.hypot(x - feet.x, z - feet.z) < want * 0.55) {
      const raisedY = y + stepHeight;
      const h1 = castCapsule(feet.x, raisedY + h / 2, feet.z, dx, dz, r, hh);
      const t1 = h1 ? Math.max(0, h1.time_of_impact - skin / Math.max(0.001, want)) : 1;
      if (t1 > 0.55) {
        const nx0 = feet.x + dx * t1;
        const nz0 = feet.z + dz * t1;
        const gh = heightAt(nx0, nz0, raisedY + 0.05);
        if (gh >= y - 0.08 && gh <= y + stepHeight + 0.1) {
          x = nx0; z = nz0; y = gh;
        }
      }
    }

    return { x, y, z, blocked };
  }

  /**
   * AI 轻量移动：用 3 条横向偏移射线近似胶囊半径，X/Z 分轴滑动。
   * 比 capsule castShape 便宜一个量级（20 个 AI 同时跑也不会掉帧）。
   */
  function moveRayActor(feet, dx, dz, radius, height) {
    const r = Math.max(0.15, radius || 0.35);
    const y = feet.y + Math.min(1.05, (height || 2.0) * 0.52);
    let x = feet.x, z = feet.z;
    let blocked = false;

    const axis = (ax, az, len) => {
      if (Math.abs(len) < 1e-5) return 0;
      const dirX = ax, dirZ = az;
      const px = -dirZ * r * 0.78, pz = dirX * r * 0.78;
      const maxD = Math.abs(len) + r;
      let best = Math.abs(len);
      for (let k = -1; k <= 1; k++) {
        const hit = ray({ x: x + px * k, y, z: z + pz * k }, { x: dirX, y: 0, z: dirZ }, maxD);
        if (!hit) continue;
        const d = Math.max(0, hit.t - r);
        if (d < best) best = d;
      }
      if (best < Math.abs(len) - 1e-4) blocked = true;
      return Math.sign(len) * Math.min(Math.abs(len), best);
    };

    const mx = axis(1, 0, dx);
    x += mx;
    const mz = axis(0, 1, dz);
    z += mz;
    return { x, y: feet.y, z, blocked };
  }

  function stats() {
    return { trimeshes: trimeshCount, cuboids: cuboidCount };
  }

  return {
    reset, finalize, addCuboid, addCuboidDesc, addTrimesh,
    ray, segmentBlocked, heightAt, walkablePoint, moveCapsule, moveRayActor, stats,
    get world() { return world; }
  };
}
