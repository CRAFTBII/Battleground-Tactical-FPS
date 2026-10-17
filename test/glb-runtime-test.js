#!/usr/bin/env node
/**
 * GLB 运行时链路验证（去内联改造的客户端侧验收）
 * =====================================================================
 * 在 Node 里用真浏览器同款代码路径验证：
 *   server.js（静态服务）→ fetch 二进制 → js/glb.js 解析 → THREE.BufferGeometry
 * 不依赖 jsdom / 不依赖浏览器，直接把 THREE 与项目 js 片段放进同一个 vm 上下文。
 *
 * 用法：node test/glb-runtime-test.js
 * 退出码：0 全过 / 1 有失败
 * =====================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawn } = require('child_process');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT || 8097;
const HOST = '127.0.0.1';

let nPass = 0, nFail = 0;
const failures = [];
const ok = (n, d) => { nPass++; console.log('PASS | ' + n + (d ? ' | ' + d : '')); };
const bad = (n, d) => { nFail++; failures.push(n + (d ? ' — ' + d : '')); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: urlPath }, r => {
      const chunks = [];
      r.on('data', c => chunks.push(c));
      r.on('end', () => resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}
function waitReady(tries = 60) {
  return new Promise((resolve, reject) => {
    const tick = n => {
      http.get({ host: HOST, port: PORT, path: '/api/rooms' }, r => { r.resume(); resolve(); })
        .on('error', () => n <= 0 ? reject(new Error('服务器未就绪')) : setTimeout(() => tick(n - 1), 150));
    };
    tick(tries);
  });
}

async function main() {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  let exited = false;
  const cleanup = () => { if (!exited) { exited = true; try { srv.kill(); } catch (e) {} } };
  process.on('exit', cleanup);

  try {
    await waitReady();
    console.log('— 服务器已就绪 :' + PORT + ' —');

    /* ---------- 1. 静态服务把 GLB 送出且 MIME/魔数正确 ---------- */
    const man = await get('/models/manifest.json');
    if (man.status !== 200) throw new Error('manifest.json 拿不到 (HTTP ' + man.status + ')');
    const manifest = JSON.parse(man.body.toString('utf8'));
    ok('GET /models/manifest.json → 200', '士兵=' + manifest.soldier + ' 建筑=' + Object.keys(manifest.buildings).length);

    const expected = [];
    if (manifest.soldier) expected.push(manifest.soldier);
    for (const v of Object.values(manifest.weapons || {})) expected.push(v);
    for (const v of Object.values(manifest.bolts || {})) expected.push(v);
    for (const v of Object.values(manifest.buildings || {})) expected.push(v);

    let badMime = 0, badMagic = 0, badLen = 0;
    for (const rel of expected) {
      const res = await get('/models/' + rel);
      if (res.status !== 200) { bad(res.status === 404 ? '资源 404: ' + rel : '请求失败 ' + rel); continue; }
      const ct = String(res.headers['content-type'] || '');
      if (!/model\/gltf-binary|application\/octet-stream/.test(ct)) badMime++;
      if (res.body.slice(0, 4).toString('ascii') !== 'glTF') badMagic++;
      if (Number(res.headers['content-length']) !== res.body.length) badLen++;
    }
    badMime === 0 ? ok('全部 ' + expected.length + ' 个 GLB Content-Type 正确', 'model/gltf-binary')
      : bad('Content-Type 异常个数', String(badMime));
    badMagic === 0 ? ok('全部 GLB 魔数 = "glTF"') : bad('魔数异常个数', String(badMagic));
    badLen === 0 ? ok('全部 GLB Content-Length = 实际字节数') : bad('长度不符个数', String(badLen));

    /* ---------- 2. 用真浏览器同款路径解析（js/glb.js + THREE） ---------- */
    // 造一个「浏览器味道」的上下文：window 自引用 + fetch/location/TextDecoder
    const ctx = {};
    vm.createContext(ctx);
    ctx.window = ctx;                       // 让 window.X = ... 真正落到 ctx.X 上
    ctx.globalThis = ctx;
    ctx.console = { log: () => {}, warn: () => {}, error: () => {} };
    ctx.performance = performance;
    ctx.TextDecoder = TextDecoder;
    ctx.location = { protocol: 'http:', hostname: HOST, search: '' };
    const realFetch = globalThis.fetch;
    // 同源相对路径 → 绝对 URL（Node 的 fetch 需要绝对地址）
    ctx.fetch = (u, o) => realFetch('http://' + HOST + ':' + PORT + '/' + String(u).replace(/^\//, ''), o);

    // 注意顺序：three(UMD) → glb.js → assetLoader.js（与 index.html 一致）
    for (const f of ['libs/three.min.js', 'js/glb.js', 'js/assetLoader.js']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    // const 声明在当前上下文里是词法绑定，不挂到 ctx 上 —— 用 runInContext 取回来
    const THREE = vm.runInContext('THREE', ctx);
    const GLB = vm.runInContext('GLB', ctx);
    ok('THREE 已加载', 'r' + THREE.REVISION);
    if (typeof GLB.parse !== 'function') throw new Error('GLB 解析器未正确导出');

    const loader = vm.runInContext('AssetLoader', ctx);
    await loader.preload();
    loader.ready ? ok('AssetLoader.preload() 完成', loader.stats.files + ' 文件 / ' + Math.round(loader.stats.bytes / 1024) + ' KB / ' + loader.stats.ms + ' ms')
      : bad('AssetLoader.preload() 未就绪', loader.errors.join(' / '));

    /* ---------- 3. 士兵模型：7 部件 + gun 在 armR 下 ---------- */
    const sg = loader.soldier();
    if (!sg) bad('soldier.glb 未加载');
    else {
      const scene = GLB.scene(sg, {});
      const names = [];
      scene.traverse(o => { if (o.isMesh) names.push(o.name); });
      const want = ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'gun'];
      const missing = want.filter(n => !names.includes(n));
      missing.length === 0 ? ok('士兵 7 部件齐全', names.join(',')) : bad('士兵缺部件', missing.join(','));
      // gun 的父节点名应为 armR（取 Node 组，不是 mesh）
      let gunParent = null;
      scene.traverse(o => { if (o.name === 'gun' && !o.isMesh) gunParent = o.parent && o.parent.name; });
      gunParent === 'armR' ? ok('gun 挂在 armR 下', 'parent=' + gunParent) : bad('gun 父节点错误', String(gunParent));
      let tris = 0;
      scene.traverse(o => { if (o.isMesh) tris += o.geometry.index.count / 3; });
      tris === 9864 ? ok('士兵三角形数 = 9864（与内联数据一致）', String(tris)) : bad('士兵三角形数不符', tris + ' ≠ 9864');
    }

    /* ---------- 4. 武器 + 枪栓 ---------- */
    for (const k of ['pistol', 'rifle', 'sniper', 'shotgun']) {
      const w = loader.weapon(k);
      if (!w) { bad('武器缺失', k); continue; }
      const geo = GLB.firstGeometry(w);
      // 武器几何来自 WEAPONS_DATA，本来只有 pos/nor/uv/idx（无顶点色），与改造前一致
      const has = !!(geo.attributes.position && geo.attributes.normal && geo.attributes.uv && geo.index);
      has ? ok('武器 ' + k + ' 几何完整', 'v=' + geo.attributes.position.count + ' idx=' + geo.index.count)
        : bad('武器 ' + k + ' 几何缺属性', 'pos=' + !!geo.attributes.position + ' nor=' + !!geo.attributes.normal + ' uv=' + !!geo.attributes.uv + ' idx=' + !!geo.index);
      const b = loader.bolt(k);
      b ? ok('枪栓 ' + k + ' 已加载', 'extras=' + JSON.stringify((b.json.extras || {})).slice(0, 60))
        : bad('枪栓缺失', k);
    }

    /* ---------- 5. 建筑：24 个全可解析且 bbox 合理 ---------- */
    let bOk = 0, bBad = [];
    for (const k of Object.keys(manifest.buildings)) {
      const g = loader.building(k);
      if (!g) { bBad.push(k + ':未加载'); continue; }
      try {
        const geo = GLB.firstGeometry(g);
        const bb = geo.boundingBox;
        const sz = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
        if (!(sz[0] > 0 && sz[1] > 0 && sz[2] > 0)) { bBad.push(k + ':bbox零体积'); continue; }
        if (!geo.attributes.color) { bBad.push(k + ':缺顶点色'); continue; }
        bOk++;
      } catch (e) { bBad.push(k + ':' + e.message); }
    }
    bBad.length === 0 ? ok('建筑 ' + bOk + ' 个全部可解析（bbox>0 且带顶点色）')
      : bad('建筑解析异常', bBad.join(', '));

    /* ---------- 6. 负向：资源缺失必须报错而不是静默 ---------- */
    const missingRes = await get('/models/buildings/__nope__.glb');
    missingRes.status === 404 ? ok('不存在的 GLB → 404') : bad('不存在 GLB 状态码', String(missingRes.status));

  } finally {
    cleanup();
  }

  console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
  if (nFail) { console.log('失败清单：'); failures.forEach(f => console.log('  · ' + f)); }
  process.exit(nFail ? 1 : 0);
}

main().catch(e => { console.error('测试崩溃:', e && e.stack || e); process.exit(1); });
