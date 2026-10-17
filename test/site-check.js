#!/usr/bin/env node
/**
 * 整站可玩性验证：模拟浏览器用「必须起服务」的方式加载一整套资源。
 * 断言 index.html 里每一个本地引用（css/js/图片）都能通过 HTTP 200 拿到，
 * 且脚本按依赖顺序可执行、模型清单可解析。
 *
 * 用法：node test/site-check.js    退出码 0/1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const vm = require('vm');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.TEST_PORT || 8096;
const HOST = '127.0.0.1';
let nPass = 0, nFail = 0;
const fails = [];
const ok = (n, d) => { nPass++; console.log('PASS | ' + n + (d ? ' | ' + d : '')); };
const bad = (n, d) => { nFail++; fails.push(n + (d ? ' — ' + d : '')); console.log('FAIL | ' + n + (d ? ' | ' + d : '')); };

const get = p => new Promise((res, rej) => {
  http.get({ host: HOST, port: PORT, path: encodeURI(p) }, r => {
    const c = []; r.on('data', d => c.push(d));
    r.on('end', () => res({ status: r.statusCode, headers: r.headers, body: Buffer.concat(c) }));
  }).on('error', rej);
});
const waitReady = (n = 60) => new Promise((res, rej) => {
  const tick = k => http.get({ host: HOST, port: PORT, path: '/api/rooms' }, r => { r.resume(); res(); })
    .on('error', () => k <= 0 ? rej(new Error('服务器未就绪')) : setTimeout(() => tick(k - 1), 150));
  tick(n);
});

(async () => {
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(PORT) }), stdio: 'ignore'
  });
  const stop = () => { try { srv.kill(); } catch (e) {} };
  process.on('exit', stop);
  try {
    await waitReady();

    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1])
      .filter(u => !/^(https?:|\/\/|data:)/.test(u));

    // 1) 所有本地引用都能 200 拿到
    let miss = [];
    for (const u of refs) {
      const r = await get('/' + u.replace(/^\.?\//, ''));
      if (r.status !== 200) miss.push(u + ' -> ' + r.status);
    }
    miss.length === 0 ? ok('index.html 全部 ' + refs.length + ' 个本地引用可访问')
      : bad('有引用拿不到', miss.join(', '));

    // 2) 不再引用内联数据脚本
    const dataScripts = refs.filter(u => /models\/\w+_data\.js$/.test(u));
    dataScripts.length === 0 ? ok('index.html 不再加载 models/*_data.js 内联数据')
      : bad('仍在加载内联数据脚本', dataScripts.join(', '));

    // 3) 关键脚本顺序：glb.js / assetLoader.js 必须在 models.js 之前
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    const iGlb = scripts.indexOf('js/glb.js');
    const iAL = scripts.indexOf('js/assetLoader.js');
    const iModels = scripts.indexOf('js/models.js');
    const iMain = scripts.indexOf('js/main.js');
    (iGlb >= 0 && iAL > iGlb && iModels > iAL && iMain === scripts.length - 1)
      ? ok('脚本顺序正确', 'glb#' + iGlb + ' assetLoader#' + iAL + ' models#' + iModels + ' main#' + iMain + '/' + (scripts.length - 1))
      : bad('脚本顺序错误', 'glb=' + iGlb + ' assetLoader=' + iAL + ' models=' + iModels + ' main=' + iMain);

    // 4) 全部脚本可执行（只验证语法/加载不炸，不跑渲染循环）
    const ctx = {}; vm.createContext(ctx);
    ctx.window = ctx; ctx.globalThis = ctx;
    ctx.console = { log: () => {}, warn: () => {}, error: () => {} };
    ctx.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, body: { classList: { add: () => {} } } };
    ctx.navigator = { userAgent: 'node' };
    ctx.location = { protocol: 'http:', hostname: HOST, search: '' };
    ctx.addEventListener = () => {};
    let loadFail = [];
    for (const s of scripts) {
      if (s === 'js/main.js') continue;   // main 会自动 boot，这里只要语法能过
      try {
        const src = vm.runInContext('(function(){})', ctx) && fs.readFileSync(path.join(ROOT, s), 'utf8');
        new vm.Script(src, { filename: s });           // 语法检查
        if (!/^libs\//.test(s) && s !== 'js/main.js') vm.runInContext(src, ctx, { filename: s });
      } catch (e) { loadFail.push(s + ': ' + e.message); }
    }
    loadFail.length === 0 ? ok('全部 ' + (scripts.length - 1) + ' 个脚本可加载')
      : bad('脚本加载失败', loadFail.slice(0, 3).join(' | '));

    // 5) 模型清单与产物一致
    const man = await get('/models/manifest.json');
    const mf = JSON.parse(man.body.toString('utf8'));
    const all = [mf.soldier, ...Object.values(mf.weapons || {}), ...Object.values(mf.bolts || {}), ...Object.values(mf.buildings || {})].filter(Boolean);
    let mbad = [];
    for (const rel of all) {
      const r = await get('/models/' + rel);
      if (r.status !== 200 || r.body.slice(0, 4).toString('ascii') !== 'glTF') mbad.push(rel);
    }
    mbad.length === 0 ? ok('清单里 ' + all.length + ' 个模型全部可取且是 GLB')
      : bad('模型失败', mbad.join(', '));

    // 6) file:// 必须被明确拒绝（而不是静默方块人）
    const mainSrc = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
    (/location\.protocol\s*===\s*'file:'/.test(mainSrc) && /node server\.js/.test(mainSrc))
      ? ok('直接双击 file:// 时有明确「起服务」提示')
      : bad('缺少 file:// 明确提示');

  } finally { stop(); }
  console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
  if (nFail) fails.forEach(f => console.log('  · ' + f));
  process.exit(nFail ? 1 : 0);
})().catch(e => { console.error('崩溃:', e && e.stack || e); process.exit(1); });
