/*
 * v4 physics adapter — Rapier 3D static world + capsule sweep + ray queries.
 * 不依赖旧 World.colliders；旧 AABB 列表只是兼容层，由 runtime 另行生成。
 */

export function createPhysics(RAPIER) {
  let world = null;
  let staticBody = null;
  let playerBody = null;
  let playerCol = null;
  let controller = null;
  let playerRadius = 0.35;
  let playerHH = 0.65;
  let playerHeight = 2.0;
  let playerStep = 0.45;
  const capsuleCache = new Map();
  const STATIC_QUERY = (0xFFFF << 16) | 0x0001;
  const PLAYER_GROUPS = (0x0002 << 16) | 0x0001;
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
    playerBody = null; playerCol = null; controller = null;
    const CFG = (typeof window !== 'undefined' && window.CFG) || {};
    playerRadius = CFG.PLAYER_RADIUS || 0.35;
    playerHeight = CFG.PLAYER_CAPSULE_HEIGHT || 2.0;
    playerHH = Math.max(0.02, (playerHeight - 2 * playerRadius) / 2);
    playerStep = CFG.PLAYER_STEP || 0.45;
    playerBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, playerRadius + playerHH, 0)
    );
    playerCol = world.createCollider(
      RAPIER.ColliderDesc.capsule(playerHH, playerRadius).setCollisionGroups(PLAYER_GROUPS),
      playerBody
    );
    controller = world.createCharacterController(0.02);
    controller.enableAutostep(playerStep, 0.2, true);
    controller.enableSnapToGround(0.55);
    controller.setApplyImpulsesToDynamicBodies(false);
    controller.setCharacterMass(80);
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

  /** 带 Y 轴旋转的盒体碰撞（程序化建筑墙体/楼板/楼梯用）。 */
  function addBoxCollider(w, h, d, x, y, z, ry, sensor) {
    const half = (ry || 0) / 2;
    const desc = RAPIER.ColliderDesc
      .cuboid(Math.max(0.02, w / 2), Math.max(0.02, h / 2), Math.max(0.02, d / 2))
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
    if (sensor) desc.setSensor(true);
    const col = world.createCollider(desc, staticBody);
    cuboidCount++;
    return col;
  }

  function removeCollider(col) {
    if (!col || !world) return;
    try { world.removeCollider(col, true); } catch (e) { /* noop */ }
  }

  function addCylinderCollider(halfHeight, radius, x, y, z) {
    const desc = RAPIER.ColliderDesc.cylinder(Math.max(0.05, halfHeight), Math.max(0.05, radius))
      .setTranslation(x, y, z);
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
    if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y) || !Number.isFinite(origin.z) ||
        !Number.isFinite(dir.x) || !Number.isFinite(dir.y) || !Number.isFinite(dir.z) ||
        !Number.isFinite(maxDist) || maxDist <= 0) return null;
    const r = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z });
    const hit = world.castRay(r, maxDist, true, undefined, STATIC_QUERY);
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
    if (!from || !to || !Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(from.z) ||
        !Number.isFinite(to.x) || !Number.isFinite(to.y) || !Number.isFinite(to.z)) return null;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return null;
    const hit = ray(from, { x: dx / len, y: dy / len, z: dz / len }, Math.max(0.01, len - 0.03));
    return hit ? hit.point : null;
  }

  /** 竖直射线取地面/楼板高度；currentY 用于多楼层（从当前脚底往上找最近的下方表面）。 */
  function heightAt(x, z, currentY) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
    const hasY = typeof currentY === 'number' && Number.isFinite(currentY);
    const startY = hasY ? currentY + 1.35 : 90;
    const maxToi = startY + 40;
    const hit = ray({ x, y: startY, z }, { x: 0, y: -1, z: 0 }, maxToi);
    if (!hit) return 0;
    return hit.point.y;
  }

  /** 点是否在可行走面上（只看地面高度 + 水平边界，建筑 footprint 由 runtime 叠加）。 */
  function walkablePoint(x, z) {
    if (!world || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const hit = ray({ x, y: 2.6, z }, { x: 0, y: -1, z: 0 }, 7);
    if (!hit) return false;
    const y = hit.point.y;
    // 允许地坪/薄楼板/矮台阶；拒绝墙体顶部/屋顶（footprint 另外会拦）
    return y > -1.2 && y < 2.6;
  }

  /** 头顶天花板高度（用于跳跃时不穿楼板）；无遮挡返回 Infinity。 */
  function ceilingAt(x, z, fromY, maxDist) {
    const hit = ray({ x, y: fromY, z }, { x: 0, y: 1, z: 0 }, maxDist || 20);
    return hit ? hit.point.y : Infinity;
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
      true, // stopAtPenetration
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      STATIC_QUERY
    );
    return hit || null;
  }

  /**
   * 胶囊体水平移动 + 贴墙滑动 + 台阶抬升。
   * feet 为脚底位置；返回新的脚底位置。不处理重力/跳跃（沿用旧 PC/AI 逻辑）。
   */
  function moveCapsule(feet, dx, dz, radius, height, stepHeight) {
    if (!feet || !Number.isFinite(feet.x) || !Number.isFinite(feet.y) || !Number.isFinite(feet.z) ||
        !Number.isFinite(dx) || !Number.isFinite(dz)) return { x: feet && feet.x, y: feet && feet.y, z: feet && feet.z, blocked: true };
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
    if (!feet || !Number.isFinite(feet.x) || !Number.isFinite(feet.y) || !Number.isFinite(feet.z) ||
        !Number.isFinite(dx) || !Number.isFinite(dz)) return { x: feet && feet.x, y: feet && feet.y, z: feet && feet.z, blocked: false };
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

  /** 玩家：Rapier KinematicCharacterController（与 sandbox 同一套，自动台阶/贴墙/落地）。 */
  function movePlayer(feet, dx, dy, dz) {
    if (!world || !controller || !playerBody || !playerCol) return null;
    if (!feet || !Number.isFinite(feet.x) || !Number.isFinite(feet.y) || !Number.isFinite(feet.z) ||
        !Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return null;
    const cy = feet.y + playerRadius + playerHH;
    playerBody.setTranslation({ x: feet.x, y: cy, z: feet.z }, false);
    // 让 collider 位姿进入查询管线（静态世界，step 很便宜）
    world.step();
    controller.computeColliderMovement(
      playerCol,
      { x: dx, y: dy, z: dz },
      RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
    );
    const mv = controller.computedMovement();
    const nx = feet.x + mv.x, nz = feet.z + mv.z;
    let ny = feet.y + mv.y;
    // 楼梯是 sensor：控制器不做台阶，y 由 heightAt 抬升（最多一个台阶高度）
    const gh = heightAt(nx, nz, feet.y + 0.55);
    if (Number.isFinite(gh) && gh > ny + 0.01 && gh - feet.y <= playerStep + 0.08) ny = gh;
    playerBody.setTranslation({ x: nx, y: ny + playerRadius + playerHH, z: nz }, false);
    return { x: nx, y: ny, z: nz, grounded: controller.computedGrounded() };
  }

  function teleportPlayer(feet) {
    if (!playerBody || !feet || !Number.isFinite(feet.x) || !Number.isFinite(feet.y) || !Number.isFinite(feet.z)) return;
    playerBody.setTranslation({ x: feet.x, y: feet.y + playerRadius + playerHH, z: feet.z }, true);
    world.step();
  }

  function stats() {
    return { trimeshes: trimeshCount, cuboids: cuboidCount, player: !!controller };
  }

  return {
    reset, finalize, addCuboid, addCuboidDesc, addBoxCollider, removeCollider, addCylinderCollider, addTrimesh,
    ray, segmentBlocked, heightAt, ceilingAt, walkablePoint, moveCapsule, moveRayActor, movePlayer, teleportPlayer, stats,
    get world() { return world; }
  };
}
