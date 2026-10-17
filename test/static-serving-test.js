#!/usr/bin/env node
/**
 * 静态资源服务验证（去内联改造的验收脚本）
 * ============================================================================
 * 目标：server.js 必须通过 HTTP 提供标准 .glb 静态资源，同时不破坏原有
 *        「服务器列表页 / /api/rooms」行为，且不能有路径穿越 / 敏感文件泄漏。
 *        两条 WebSocket 传输分支（npm ws / 内置 RFC6455）共用 httpHandler，
 *        因此两条都必须跑一遍同样的静态断言。
 *
 * 用法：   node test/static-serving-test.js
 * 环境：   TEST_PORT=8099         默认传输分支（装了 ws 包 → WSS 分支）
 *          TEST_PORT_INLINE=8098  内置 RFC6455 分支（拦掉 require('ws') 强制进入）
 *          BASE_ONLY=1            只跑默认传输分支
 * 退出码： 0 = 全过（WARN 不阻断）；1 = 存在 FAIL
 *
 * 关于「内置 RFC6455 分支怎么强制」：server.js 早期版本有 FORCE_INLINE_WS=1 开关，
 * 现在已移除。为了不动产品代码，本脚本用 node -e 在 require('ws') 处注入一个
 * 抛错的 Module._load 钩子，使 server.js 的 try/catch 把 WSS 置为 null，
 * 从而真正进入 MiniWS 分支。若 /api/rooms 的 transport 仍是「ws (npm 包)」，
 * 脚本会打 WARN 说明该分支没被真正覆盖（建议 server.js 把 FORCE_INLINE_WS 加回来）。
 *
 * 说明：脚本自己起 server 子进程、自己收尾（退出前 kill），不需要先手动起服务。
 * ============================================================================
 */
'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GLB_REL = 'models/soldier.glb';
const GLB_ABS = path.join(ROOT, 'models', 'soldier.glb');
const MAINJS_ABS = path.join(ROOT, 'js', 'main.js');
const HOST = '127.0.0.1';
const REQ_TIMEOUT = 5000;
const READY_TIMEOUT = 12000;

/* 内置分支引导程序：拦掉 ws 模块，逼 server.js 走零依赖 RFC6455 实现 */
const INLINE_BOOT = [
  "const M=require('module'),o=M._load;",
  "M._load=function(r){if(r==='ws'){const e=new Error('blocked by static-serving-test');e.code='MODULE_NOT_FOUND';throw e;}return o.apply(this,arguments)};",
  "require('./server.js');"
].join('');

/* ---------------------------------------------------------------- 计数与输出 */
let nPass = 0, nFail = 0, nWarn = 0;
const failures = [];

function ok(name, detail) {
  nPass++;
  console.log('PASS | ' + name + (detail ? ' | ' + detail : ''));
}
function bad(name, detail) {
  nFail++;
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('FAIL | ' + name + (detail ? ' | ' + detail : ''));
}
function warn(name, detail) {
  nWarn++;
  console.log('WARN | ' + name + (detail ? ' | ' + detail : ''));
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function tail(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(s.length - n) : s;
}
function bytes(n) { return n + ' B'; }

/* ---------------------------------------------------------------- 子进程管理 */
const children = new Set();

function killChild(child) {
  if (!child) return Promise.resolve();
  if (child.exitCode !== null || child.signalCode) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', fin);
    try { child.kill(); } catch (e) { }
    setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (e) { }
      setTimeout(fin, 400);
    }, 1200);
  });
}
function killAllSync() {
  for (const c of children) {
    try { c.kill('SIGKILL'); } catch (e) { }
  }
  children.clear();
}
process.on('exit', killAllSync);
process.on('SIGINT', () => { killAllSync(); process.exit(130); });
process.on('SIGTERM', () => { killAllSync(); process.exit(143); });
process.on('uncaughtException', e => {
  console.error('\n[脚本异常] ' + ((e && e.stack) || e));
  killAllSync();
  process.exit(1);
});

/* ---------------------------------------------------------------- HTTP 工具 */
/** 发一个请求，永不 reject：成功返回 {status, headers, body, bodyText}，失败返回 {error} */
function request(port, urlPath, method) {
  return new Promise(resolve => {
    let settled = false;
    const fin = v => { if (!settled) { settled = true; resolve(v); } };
    const req = http.request({
      host: HOST, port, path: urlPath, method: method || 'GET',
      headers: { 'Connection': 'close', 'Accept': '*/*' }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        fin({ status: res.statusCode, headers: res.headers || {}, body, bodyText: body.toString('utf8') });
      });
      res.on('error', e => fin({ error: '响应读取失败: ' + e.message }));
    });
    req.setTimeout(REQ_TIMEOUT, () => { try { req.destroy(new Error('请求超时(' + REQ_TIMEOUT + 'ms)')); } catch (e) { } });
    req.on('error', e => fin({ error: e.message }));
    req.end();
  });
}

function portFree(p) {
  return new Promise(resolve => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(p, HOST, () => { s.close(() => resolve(true)); });
  });
}
function ephemeralPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, HOST, () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}
async function pickPort(preferred) {
  if (preferred && await portFree(preferred)) return { port: preferred, shifted: false };
  return { port: await ephemeralPort(), shifted: !!preferred };
}

/** 等到服务器能回任何 HTTP 响应（不要求 200，避免掩盖 /api/rooms 的独立断言） */
async function waitReady(port, child) {
  const t0 = Date.now();
  while (Date.now() - t0 < READY_TIMEOUT) {
    if (child.exitCode !== null) return false;
    const r = await request(port, '/api/rooms');
    if (!r.error && typeof r.status === 'number') return true;
    await sleep(120);
  }
  return false;
}

/** 起 server 子进程：优先 pipe 捕获日志；受限沙箱禁止管道 stdio（spawn EPERM）时退化为 ignore */
function spawnServer(port, extraEnv, forceInline) {
  const base = {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PORT: String(port) }, extraEnv || {}),
    windowsHide: true
  };
  const args = forceInline ? ['-e', INLINE_BOOT] : ['server.js'];
  try {
    return { child: spawn(process.execPath, args, Object.assign({}, base, { stdio: ['ignore', 'pipe', 'pipe'] })), piped: true };
  } catch (e) {
    return {
      child: spawn(process.execPath, args, Object.assign({}, base, { stdio: 'ignore' })),
      piped: false,
      note: e.code || e.message
    };
  }
}

/* ---------------------------------------------------------------- 断言工具 */
const SRC_MARKERS = ['httpHandler', 'MiniWS', 'function createServer', 'require(', 'WEB_ROOT'];

/** 路径穿越 / 敏感文件被请求时：必须是 403 或 404，且绝不能回源码或列表页 */
function checkBlocked(label, urlPath, r) {
  const name = label + ' ' + (r && r.error ? 'ERR' : r.status) + ' × ' + urlPath;
  if (!r || r.error) { bad(name, '请求失败: ' + (r && r.error)); return; }
  const statusOk = r.status === 403 || r.status === 404;
  const leaked = SRC_MARKERS.filter(m => r.bodyText.indexOf(m) >= 0);
  const looksLobby = r.bodyText.indexOf('服务器') >= 0 && r.bodyText.indexOf('/api/rooms') >= 0;
  if (statusOk && !leaked.length) {
    ok(name, '已拦截（' + r.status + '），响应体 ' + bytes(r.body.length) + ' 未含源码');
    return;
  }
  if (!statusOk) {
    bad(name, '期望 403/404，实际 ' + r.status +
      (looksLobby ? '（返回了服务器列表页：静态白名单/路由顺序未生效）'
        : '（body 前 80B: ' + JSON.stringify(r.bodyText.slice(0, 80)) + '）'));
    return;
  }
  bad(name, r.status + ' 但响应体含源码标记: ' + leaked.join(', '));
}

/* ---------------------------------------------------------------- 单分支套件 */
async function runSuite(opts) {
  const label = opts.label;
  const { port, shifted } = await pickPort(opts.preferredPort);
  section(label + '：PORT=' + port + (shifted ? '（首选端口被占用，已改用空闲端口）' : ''));

  const spawned = spawnServer(port, opts.env, opts.forceInline);
  const child = spawned.child;
  children.add(child);
  const log = { out: '', err: '' };
  if (spawned.piped) {
    child.stdout.on('data', d => { log.out += d.toString(); });
    child.stderr.on('data', d => { log.err += d.toString(); });
    child.on('error', e => { log.err += 'spawn error: ' + e.message; });
  } else {
    log.err = '(受限沙箱：无法用管道捕获子进程日志，已退化为 stdio=ignore；原因 ' + spawned.note + ')';
    warn(label + ' 子进程日志捕获不可用', spawned.note + ' —— 已用 stdio=ignore 继续，请以 HTTP 断言为准');
  }

  try {
    const ready = await waitReady(port, child);
    if (!ready) {
      bad(label + ' 服务器启动', READY_TIMEOUT + 'ms 内无 HTTP 响应' +
        (child.exitCode !== null ? '，子进程已退出 code=' + child.exitCode : '，子进程仍在运行') +
        ' | stdout=' + JSON.stringify(tail(log.out, 240)) +
        ' | stderr=' + JSON.stringify(tail(log.err, 240)));
      return;
    }
    ok(label + ' 服务器就绪', '子进程 pid=' + child.pid + '，' + HOST + ':' + port + ' 有 HTTP 响应');

    /* ============ 1) GET /models/soldier.glb ============ */
    let diskSize = null;
    try { diskSize = fs.statSync(GLB_ABS).size; } catch (e) { diskSize = null; }
    if (diskSize === null) {
      bad(label + ' 磁盘基线 | ' + GLB_REL + ' 存在', 'models/ 下找不到该文件（GLB 产物还没生成，服务端本身不算错）');
    } else {
      ok(label + ' 磁盘基线 | ' + GLB_REL + ' 存在', bytes(diskSize));
    }

    const glb = await request(port, '/' + GLB_REL);
    if (glb.error) {
      bad(label + ' GET /' + GLB_REL + ' → 200', '请求失败: ' + glb.error);
    } else {
      if (glb.status === 200) ok(label + ' GET /' + GLB_REL + ' → 200');
      else bad(label + ' GET /' + GLB_REL + ' → 200', '实际 ' + glb.status +
        (glb.bodyText.indexOf('<html') >= 0 || glb.bodyText.indexOf('<!DOCTYPE') >= 0
          ? '（返回了 HTML —— 静态路由缺失，落到了列表页兜底）'
          : '（body=' + JSON.stringify(glb.bodyText.slice(0, 60)) + '）'));

      const rawCt = String(glb.headers['content-type'] || '');
      const ct = rawCt.split(';')[0].trim().toLowerCase();
      if (ct === 'model/gltf-binary' || ct === 'application/octet-stream') {
        ok(label + ' GLB Content-Type 合法', ct + '（本脚本接受 model/gltf-binary 或 application/octet-stream）');
      } else {
        bad(label + ' GLB Content-Type ∈ {model/gltf-binary, application/octet-stream}',
          '实际 ' + JSON.stringify(rawCt || '(缺)'));
      }

      const cl = glb.headers['content-length'];
      if (diskSize !== null && cl !== undefined && Number(cl) === diskSize) {
        ok(label + ' GLB Content-Length = 磁盘字节数', String(cl));
      } else if (cl === undefined) {
        bad(label + ' GLB Content-Length = 磁盘字节数', '响应无 Content-Length 头（chunked，不利于 .glb 预取/进度）');
      } else {
        bad(label + ' GLB Content-Length = 磁盘字节数',
          '头部 ' + cl + ' vs 磁盘 ' + (diskSize === null ? '(文件缺失)' : diskSize));
      }

      if (diskSize !== null && glb.body.length === diskSize) {
        ok(label + ' GLB 响应体字节数 = 磁盘字节数', bytes(glb.body.length));
      } else {
        bad(label + ' GLB 响应体字节数 = 磁盘字节数',
          '实际 ' + bytes(glb.body.length) + ' vs 磁盘 ' + (diskSize === null ? '(文件缺失)' : bytes(diskSize)));
      }

      const magic = glb.body.length >= 4 ? glb.body.slice(0, 4).toString('latin1') : '';
      if (magic === 'glTF') {
        ok(label + ' GLB 魔数前 4 字节 = "glTF"');
      } else {
        bad(label + ' GLB 魔数前 4 字节 = "glTF"', '实际 ' + JSON.stringify(magic) + '（不是二进制 GLB）');
      }

      if (opts.advisory && glb.status === 200 && glb.body.length >= 12) {
        const ver = glb.body.readUInt32LE(4), declared = glb.body.readUInt32LE(8);
        if (ver === 2 && declared === glb.body.length) {
          warn(label + ' GLB 头部自洽', 'version=' + ver + '，totalLength=' + declared + ' 与文件一致（信息项）');
        } else {
          warn(label + ' GLB 头部自洽', 'version=' + ver + '、totalLength=' + declared + '、实际 ' + glb.body.length + ' 不一致');
        }
      }
    }

    /* ============ 2) GET / → 游戏本体；GET /status → 服务器列表页 ============ */
    // 去内联后模型必须走 HTTP，玩家打开根路径就要能看到游戏，所以 / 必须是 index.html。
    // 原列表页挪到 /status，其 'WebSocket' 与 '/api/rooms' 标记保持不变（test/server-test.js 依赖）。
    const root = await request(port, '/');
    if (root.error) {
      bad(label + ' GET / → 200 text/html', '请求失败: ' + root.error);
    } else {
      if (root.status === 200) ok(label + ' GET / → 200');
      else bad(label + ' GET / → 200', '实际 ' + root.status);
      const ct = String(root.headers['content-type'] || '').toLowerCase();
      if (ct.indexOf('text/html') >= 0) ok(label + ' GET / Content-Type 含 text/html', ct);
      else bad(label + ' GET / Content-Type 含 text/html', '实际 ' + JSON.stringify(root.headers['content-type'] || '(缺)'));
      // 游戏本体的标志：主菜单按钮 + GLB 加载器
      if (root.bodyText.indexOf('btnSingle') >= 0 && root.bodyText.indexOf('js/glb.js') >= 0) {
        ok(label + ' GET / 是游戏本体', '含 btnSingle 主菜单与 GLB 加载器');
      } else {
        bad(label + ' GET / 是游戏本体', '缺少游戏标记（是否又回落成列表页了？）');
      }
    }
    const status = await request(port, '/status');
    if (!status.error && status.status === 200 &&
        status.bodyText.indexOf('WebSocket') >= 0 && status.bodyText.indexOf('/api/rooms') >= 0) {
      ok(label + ' GET /status 是服务器列表页', '含 WebSocket 与 /api/rooms');
    } else {
      bad(label + ' GET /status 是服务器列表页', 'status=' + (status.error || status.status));
    }

    /* ============ 3) GET /api/rooms → 200 JSON ============ */
    let state = null;
    const api = await request(port, '/api/rooms');
    if (api.error) {
      bad(label + ' GET /api/rooms → 200 JSON', '请求失败: ' + api.error);
    } else {
      if (api.status === 200) ok(label + ' GET /api/rooms → 200');
      else bad(label + ' GET /api/rooms → 200', '实际 ' + api.status);
      try { state = JSON.parse(api.bodyText); } catch (e) { state = null; }
      if (state && state.ok === true && Array.isArray(state.rooms)) {
        ok(label + ' GET /api/rooms 返回 JSON 状态', 'transport=' + state.transport + '，rooms=' + state.rooms.length);
      } else {
        bad(label + ' GET /api/rooms 返回 JSON 状态', 'body=' + JSON.stringify(api.bodyText.slice(0, 120)));
      }
    }
    if (opts.forceInline) {
      if (state && String(state.transport).indexOf('内置') >= 0) {
        ok(label + ' 已进入内置 RFC6455 分支', 'transport=' + state.transport);
      } else {
        warn(label + ' 未能强制进入内置 RFC6455 分支',
          'transport=' + ((state && state.transport) || '(未知)') + '，本套件实际测的是默认分支；建议 server.js 补回 FORCE_INLINE_WS=1 开关');
      }
    }

    /* ============ 4) GET /js/main.js → 200 javascript ============ */
    let mainDisk = null;
    try { mainDisk = fs.statSync(MAINJS_ABS).size; } catch (e) { mainDisk = null; }
    const js = await request(port, '/js/main.js');
    if (js.error) {
      bad(label + ' GET /js/main.js → 200', '请求失败: ' + js.error);
    } else {
      if (js.status === 200) ok(label + ' GET /js/main.js → 200');
      else bad(label + ' GET /js/main.js → 200', '实际 ' + js.status);
      const ct = String(js.headers['content-type'] || '').toLowerCase();
      if (ct.indexOf('javascript') >= 0) ok(label + ' GET /js/main.js Content-Type 含 javascript', ct);
      else bad(label + ' GET /js/main.js Content-Type 含 javascript', '实际 ' + JSON.stringify(js.headers['content-type'] || '(缺)'));
      if (mainDisk !== null && js.body.length === mainDisk) {
        ok(label + ' GET /js/main.js 是真实文件', bytes(js.body.length) + ' 与磁盘一致');
      } else {
        bad(label + ' GET /js/main.js 是真实文件',
          '实际 ' + bytes(js.body.length) + ' vs 磁盘 ' + (mainDisk === null ? '(文件缺失)' : bytes(mainDisk)));
      }
    }

    /* 查询串不能破坏静态命中（浏览器会加 ?v= 之类） */
    const jsQ = await request(port, '/js/main.js?v=1');
    if (!jsQ.error && jsQ.status === 200 &&
      String(jsQ.headers['content-type'] || '').toLowerCase().indexOf('javascript') >= 0 &&
      (mainDisk === null || jsQ.body.length === mainDisk)) {
      ok(label + ' GET /js/main.js?v=1 查询串不影响静态命中', '200，' + bytes(jsQ.body.length));
    } else {
      bad(label + ' GET /js/main.js?v=1 查询串不影响静态命中',
        jsQ.error ? '请求失败: ' + jsQ.error
          : '实际 status=' + jsQ.status + '，type=' + JSON.stringify(jsQ.headers['content-type'] || '(缺)') + '，' + bytes(jsQ.body.length));
    }

    /* ============ 5) 路径穿越 / 敏感文件 ============ */
    const trav = [
      '/models/../../server.js',
      '/models/%2e%2e/%2e%2e/server.js',
      '/js/../server.js',
      '/server.js'
    ];
    for (const p of trav) {
      const r = await request(port, p);
      checkBlocked(label, p, r);
    }

    /* ============ 6) GET /models/nope.glb → 404 ============ */
    const nope = await request(port, '/models/nope.glb');
    if (nope.error) bad(label + ' GET /models/nope.glb → 404', '请求失败: ' + nope.error);
    else if (nope.status === 404) ok(label + ' GET /models/nope.glb → 404');
    else bad(label + ' GET /models/nope.glb → 404', '实际 ' + nope.status +
      (nope.bodyText.indexOf('<html') >= 0 ? '（返回了 HTML 列表页，应 404）' : ''));

    /* ============ 7) HEAD 不返回 body ============ */
    const head = await request(port, '/' + GLB_REL, 'HEAD');
    if (head.error) {
      bad(label + ' HEAD /' + GLB_REL + ' 无响应体', '请求失败: ' + head.error);
    } else {
      if (head.body.length === 0) ok(label + ' HEAD /' + GLB_REL + ' 无响应体', 'status=' + head.status + '，body=0 B');
      else bad(label + ' HEAD /' + GLB_REL + ' 无响应体', '实际返回了 ' + bytes(head.body.length));

      const getStatus = (!glb.error && glb.status) || 0;
      if (getStatus && head.status === getStatus) ok(label + ' HEAD 状态码与 GET 一致', '同为 ' + head.status);
      else bad(label + ' HEAD 状态码与 GET 一致', 'HEAD=' + head.status + ' vs GET=' + getStatus);
    }

    /* ============ 8) 附加检查（仅默认分支跑，只报 WARN） ============ */
    if (opts.advisory) {
      const entry = await request(port, '/index.html');
      if (!entry.error && entry.status === 200 && String(entry.headers['content-type'] || '').indexOf('html') >= 0) {
        warn(label + ' GET /index.html → 200 text/html', '游戏入口页可达（' + bytes(entry.body.length) + '）');
      } else {
        warn(label + ' GET /index.html → 200 text/html',
          '实际 ' + (entry.error ? 'ERR ' + entry.error : entry.status) + ' —— 浏览器将无法进入游戏');
      }
      const extras = ['/js/glb.js', '/js/assetLoader.js', '/js/maps/registry.js', '/libs/three.min.js', '/css/base.css', '/assets/soldier/preview.png'];
      for (const f of extras) {
        const r = await request(port, f);
        if (!r.error && r.status === 200) warn(label + ' GET ' + f + ' → 200', String(r.headers['content-type'] || ''));
        else warn(label + ' GET ' + f + ' → 200', '实际 ' + (r.error ? 'ERR ' + r.error : r.status) + '（文件可能尚未创建或未被白名单覆盖）');
      }

      /* 资源清单 + 抽样：AssetLoader 的启动入口，必须能被静态服务提供 */
      const man = await request(port, '/models/manifest.json');
      if (!man.error && man.status === 200) {
        warn(label + ' GET /models/manifest.json → 200', 'Content-Type=' + (man.headers['content-type'] || '(缺)') + '，' + bytes(man.body.length));
        let m = null;
        try { m = JSON.parse(man.bodyText); } catch (e) { m = null; }
        if (m) {
          const rels = [];
          if (typeof m.soldier === 'string') rels.push(m.soldier);
          for (const k of ['weapons', 'bolts', 'buildings']) {
            for (const v of Object.values(m[k] || {})) if (typeof v === 'string') rels.push(v);
          }
          const sample = rels.slice(0, 8);
          const badList = [];
          let good = 0;
          for (const rel of sample) {
            const u = '/models/' + String(rel).replace(/^\/?models\//, '');
            const rr = await request(port, u);
            const magicOk = !rr.error && rr.status === 200 && rr.body.length >= 4 && rr.body.slice(0, 4).toString('latin1') === 'glTF';
            if (magicOk) good++; else badList.push(u + ' → ' + (rr.error ? 'ERR' : rr.status));
          }
          warn(label + ' 清单抽样可用性', good + '/' + sample.length + ' 条返回 200 + glTF 魔数' +
            (badList.length ? '；异常: ' + badList.join(', ') : ''));
        }
      } else {
        warn(label + ' GET /models/manifest.json',
          '实际 ' + (man.error ? 'ERR ' + man.error : man.status) + ' —— 游戏启动必需（node tools/gen_manifest.cjs）');
      }
    }
  } finally {
    await killChild(child);
    children.delete(child);
    if (child.exitCode === null && !child.signalCode) {
      console.log('（提示）子进程未能及时退出: pid=' + child.pid);
    }
  }
}

/* ------------------------------------------- 附加：从任意工作目录启动也能服务对文件 */
/** server.js 用 __dirname 作站点根（若误用 process.cwd() 会从别的目录取文件）→ WARN 级验证 */
async function checkCwdIndependence() {
  const cwd = os.tmpdir();
  section('[任意 cwd 启动]：cwd = ' + cwd);
  const { port } = await pickPort(null);
  let child = null;
  try {
    try {
      child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd, env: Object.assign({}, process.env, { PORT: String(port) }),
        stdio: 'ignore', windowsHide: true
      });
      children.add(child);
    } catch (e) {
      warn('[任意cwd] 无法启动子进程', e.code || e.message);
      return;
    }
    if (!await waitReady(port, child)) {
      warn('[任意cwd] 服务器未就绪', '从 ' + cwd + ' 启动 server.js 后 ' + READY_TIMEOUT + 'ms 内无 HTTP 响应');
      return;
    }
    let mainDisk = null;
    try { mainDisk = fs.statSync(MAINJS_ABS).size; } catch (e) { mainDisk = null; }
    const js = await request(port, '/js/main.js');
    if (!js.error && js.status === 200 && (mainDisk === null || js.body.length === mainDisk)) {
      warn('[任意cwd] GET /js/main.js → 200', '站点根基于 __dirname，与启动时 cwd 无关（' + bytes(js.body.length) + '）');
    } else {
      warn('[任意cwd] GET /js/main.js → 200', '实际 ' + (js.error ? 'ERR ' + js.error : js.status + ' / ' + bytes(js.body.length)) + ' —— 站点根可能误用了 process.cwd()');
    }
  } finally {
    if (child) { await killChild(child); children.delete(child); }
  }
}

/* ---------------------------------------------------------------- 主流程 */
(async () => {
  console.log('静态资源服务验证 · 去内联改造验收');
  console.log('工作目录: ' + ROOT);

  const basePort = Number(process.env.TEST_PORT) || 8099;
  const inlinePort = Number(process.env.TEST_PORT_INLINE) || 8098;

  // 分支 A：默认传输（装了 ws 包 → WSS 分支；未装 → 内置 RFC6455）
  await runSuite({
    label: '[默认传输]',
    preferredPort: basePort,
    env: {},
    forceInline: false,
    advisory: true
  });

  if (process.env.BASE_ONLY !== '1') await checkCwdIndependence();

  if (process.env.BASE_ONLY === '1') {
    console.log('\n（BASE_ONLY=1，跳过内置 RFC6455 分支与 cwd 检查）');
  } else {
    // 分支 B：强制内置 RFC6455 实现 —— 两条传输分支必须都支持静态文件
    await runSuite({
      label: '[内置RFC6455]',
      preferredPort: inlinePort,
      env: {},
      forceInline: true,
      advisory: false
    });
  }

  console.log('\n失败清单：' + (nFail ? '' : '无'));
  for (const f of failures) console.log('  · ' + f);

  console.log('\n===== ' + nPass + ' PASS / ' + nFail + ' FAIL =====');
  if (nWarn) console.log('（另有 ' + nWarn + ' 条 WARN，仅提示，不计入 FAIL）');
  process.exit(nFail ? 1 : 0);
})();
