#!/usr/bin/env node
/* ============================================
 * 战地突击 · server.js — HTTP 静态站 + WebSocket 联机服务端
 *
 * 架构变更（去内联）：模型不再是 base64 内联在 JS 里，而是标准 .glb 二进制，
 * 由本服务通过 HTTP 提供。因此**游戏必须启动服务才能玩**：
 *     node server.js   → 浏览器打开 http://localhost:8080
 * 直接双击 index.html 会明确报错（见 js/main.js 的协议自检）。
 *
 * 两条 WebSocket 传输分支（npm ws / 内置 RFC6455）共用同一个 httpHandler。
 * ============================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let WSS = null;
try { WSS = require('ws'); } catch (e) { WSS = null; }

/* ================= 静态文件服务 ================= */
const WEB_ROOT = __dirname;

/** 扩展名 → Content-Type（模型走标准 glTF MIME） */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

/** 允许对外提供的目录白名单（其余一律 404，避免把 backup/ .git/ tools/ test/ docs/ 暴露出去） */
const SERVE_DIRS = ['js', 'css', 'libs', 'models', 'sounds', 'assets'];

/** 根目录下允许直接访问的文件 */
const SERVE_ROOT_FILES = ['index.html'];

/**
 * 把 URL 路径解析为磁盘绝对路径；越界/不允许 → null。
 * 目录穿越防护：解码 → 归一化 → 去掉 .. → 仍须落在 WEB_ROOT 内 → 通过目录白名单。
 */
function resolveStatic(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch (e) { return null; }
  if (decoded.indexOf('\0') !== -1) return null;          // 空字节截断攻击
  const normalized = path.posix.normalize(decoded.replace(/\\/g, '/'));
  if (normalized.indexOf('..') !== -1) return null;
  const abs = path.join(WEB_ROOT, normalized);
  const rel = path.relative(WEB_ROOT, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;

  const parts = rel.split(path.sep);
  if (parts.length === 1) {
    return SERVE_ROOT_FILES.includes(parts[0]) ? abs : null;   // 根目录只放行白名单文件
  }
  if (!SERVE_DIRS.includes(parts[0])) return null;             // 只放行白名单目录
  return abs;
}

function notFound(res, method) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(method === 'HEAD' ? undefined : '404 Not Found');
}

/** 静态响应：支持 GET/HEAD、ETag/304、404/405 */
function serveStatic(req, res, urlPath) {
  const method = req.method;
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', 'Allow': 'GET, HEAD' });
    res.end(method === 'HEAD' ? undefined : '405 Method Not Allowed');
    return true;
  }
  const abs = resolveStatic(urlPath);
  if (!abs) { notFound(res, method); return true; }
  let stat;
  try { stat = fs.statSync(abs); } catch (e) { stat = null; }
  if (!stat || !stat.isFile()) { notFound(res, method); return true; }

  const ext = path.extname(abs).toLowerCase();
  const etag = 'W/"' + stat.size.toString(16) + '-' + Math.floor(stat.mtimeMs).toString(16) + '"';
  const cacheable = ext !== '.html' && ext !== '.htm';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': cacheable ? 'public, max-age=0, must-revalidate' : 'no-store'
  };
  if (cacheable) headers['ETag'] = etag;
  if (cacheable && req.headers['if-none-match'] === etag) {
    res.writeHead(304, { 'Cache-Control': headers['Cache-Control'], 'ETag': etag });
    res.end();
    return true;
  }
  res.writeHead(200, headers);
  if (method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(abs).on('error', () => { try { res.destroy(); } catch (e) { } }).pipe(res);
  return true;
}


/** 服务器状态 JSON（/api/rooms 与列表页共用；调用时 clients/roomList 已就绪） */
function serverStatus(port) {
  return {
    ok: true,
    name: '战地突击 Battleground',
    port: Number(port),
    transport: WSS ? 'ws (npm 包)' : '内置 RFC6455（零依赖）',
    online: clients.size,
    rooms: roomList(),
    now: Date.now()
  };
}

function httpJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** 服务器列表页：浏览器访问 http://IP:端口 时展示（200，替代旧 426 引导页）；
 *  页面 JS 每 3s 轮询 /api/rooms 实时刷新房间列表。body 含 'WebSocket' 供回归测试断言。 */
function lobbyPage(res, port) {
  const st = serverStatus(port);
  const init = JSON.stringify(st).replace(/</g, '\\u003c');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<!DOCTYPE html>\n<html lang="zh-CN">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>战地突击 · 服务器列表</title>\n' +
    '<style>*{box-sizing:border-box}body{font-family:system-ui,"Microsoft YaHei";background:#0b0e13;color:#e8edf4;margin:0;min-height:100vh}' +
    '.wrap{max-width:760px;margin:auto;padding:28px 20px 40px}' +
    'h1{font-size:30px;letter-spacing:6px;color:#ffd166;margin:0 0 4px;text-shadow:0 0 24px rgba(255,209,102,.35)}' +
    '.sub{color:#9fb3c8;font-size:12px;letter-spacing:3px;margin-bottom:22px}' +
    '.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:16px 18px;margin-bottom:16px}' +
    '.card h2{margin:0 0 12px;font-size:15px;letter-spacing:2px;color:#cfd8e3}' +
    '.stats{display:flex;flex-wrap:wrap;gap:14px 26px;font-size:13px;color:#9fb3c8}.stats b{color:#ffd166;font-weight:600}' +
    '.live{display:inline-block;width:9px;height:9px;border-radius:50%;background:#4cd964;box-shadow:0 0 8px #4cd964;margin-right:6px;vertical-align:1px}' +
    '.row{display:flex;justify-content:space-between;align-items:center;padding:11px 4px;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px}' +
    '.row:last-child{border-bottom:none}.row .nm{color:#e8edf4}.row .cnt{color:#9fb3c8;font-size:12px}' +
    '.empty{color:#5f7388;font-size:13px;padding:14px 4px}' +
    '.refresh{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,209,102,.5);background:rgba(255,209,102,.12);color:#ffd166;padding:7px 16px;border-radius:5px;font-size:13px;cursor:pointer;transition:.15s;letter-spacing:1px}' +
    '.refresh:hover{background:rgba(255,209,102,.25)}.refresh:disabled{opacity:.5;cursor:default}' +
    '.uptime{font-size:11px;color:#5f7388;margin-top:8px}' +
    'details{font-size:13px}summary{cursor:pointer;color:#9fb3c8;padding:6px 0}' +
    'details ol{margin:8px 0 0;padding-left:20px;line-height:1.9}details code{background:rgba(255,255,255,.1);padding:1px 6px;border-radius:4px;color:#ffd166}' +
    '.note{font-size:11px;color:#5f7388;margin-top:10px;line-height:1.7}' +
    'table{border-collapse:collapse;font-size:12px;margin-top:8px;width:100%}td{border:1px solid #2a3342;padding:6px 10px;color:#cfd8e3}' +
    '</style>\n<div class="wrap">\n<h1>战地突击 · 服务器浏览器</h1>\n<div class="sub">BATTLEGROUND · WebSocket 联机服务端 · 实时列表</div>\n' +
    '<div class="card"><h2><span class="live"></span>服务器状态</h2><div class="stats" id="stats"></div><div class="uptime" id="uptime"></div></div>\n' +
    '<div class="card"><h2 style="display:flex;justify-content:space-between;align-items:center">房间列表<button class="refresh" id="refreshBtn">🔄 刷新</button></h2><div id="rooms"></div></div>\n' +
    '<div class="card"><h2>如何加入联机</h2><details open><summary>查看步骤（点此折叠）</summary><ol>' +
    '<li>打开游戏 <code>index.html</code>（用浏览器打开游戏页面，不是这个地址）</li>' +
    '<li>主界面「服务器地址」框填入 <code>ws://本机IP:' + port + '</code>，点「刷新服务器列表」</li>' +
    '<li>看到上面列出的房间后点击加入；或直接点「创建联机房间」当房主</li></ol></details>' +
    '<table><tr><td>浏览器地址栏输 <code>ws://…</code></td><td style="color:#ffb3b3">ERR_UNKNOWN_URL_SCHEME（浏览器不支持，正常）</td></tr>' +
    '<tr><td>地址栏输 <code>http://IP:' + port + '</code></td><td>看到本页（服务器列表，说明服务器在线）</td></tr>' +
    '<tr><td>游戏内输 <code>http://…</code></td><td>已自动转为 <code>ws://</code>（无需手动改）</td></tr>' +
    '<tr><td>连接超时 / 连不上</td><td>检查 IP、server.js 是否运行、防火墙是否放行 ' + port + ' 端口</td></tr></table></div>\n' +
    '<div class="note">本页为服务器状态浏览页：每 3 秒自动刷新；浏览器直接访问 <code>http://IP:' + port + '</code> 即可看到。此页不参与游戏联机。</div>\n</div>\n' +
    '<script>var INIT=' + init + ';' +
    'function el(t,c,s){var e=document.createElement(t);if(c)e.className=c;if(s!=null)e.textContent=s;return e;}' +
    'function render(d){var st=document.getElementById("stats");st.textContent="";' +
    'if(!d){st.appendChild(el("span","","无法连接服务器"));return;}' +
    '[["端口",d.port],["传输",d.transport],["在线玩家",d.online],["房间数",d.rooms.length]].forEach(function(it){var s=el("span");s.appendChild(el("b","",it[0]+" "));s.appendChild(document.createTextNode(String(it[1])));st.appendChild(s);});' +
    'var rm=document.getElementById("rooms");rm.textContent="";' +
    'if(!d.rooms.length){rm.appendChild(el("div","empty","暂无房间 —— 去游戏里点「创建联机房间」开一局吧"));}' +
    'else{d.rooms.forEach(function(r){var row=el("div","row");row.appendChild(el("span","nm",r.name));row.appendChild(el("span","cnt",r.players+" / "+r.max+" 人"));rm.appendChild(row);});}' +
    'document.getElementById("uptime").textContent="最后更新："+new Date(d.now).toLocaleTimeString()+"（每 3 秒自动刷新）";}' +
    'function refresh(){var b=document.getElementById("refreshBtn");b.disabled=true;' +
    'fetch("/api/rooms").then(function(r){return r.json();}).then(render).catch(function(){render(null);}).then(function(){b.disabled=false;});}' +
    'document.getElementById("refreshBtn").onclick=refresh;' +
    'render(INIT);setInterval(refresh,3000);' +
    '</script>\n</html>');
}

/**
 * 普通 HTTP 请求入口（两条 WebSocket 传输分支共用）：
 *   /api/rooms    → JSON 状态（保持原契约，server-test.js 依赖）
 *   /             → 服务器列表页（保持原契约，含 'WebSocket' 与 '/api/rooms' 字样）
 *   其余          → 静态文件（白名单目录 + 目录穿越防护）
 * 注意判定顺序：先 API，再根路径列表页，最后才落到静态服务。
 */
function httpHandler(req, res, port) {
  let pathname = req.url || '/';
  const qi = pathname.indexOf('?');
  if (qi !== -1) pathname = pathname.slice(0, qi);
  const hi = pathname.indexOf('#');
  if (hi !== -1) pathname = pathname.slice(0, hi);

  if (pathname === '/api/rooms' || pathname === '/api/rooms/') return httpJson(res, serverStatus(port));
  if (pathname === '/' || pathname === '') return lobbyPage(res, port);
  return serveStatic(req, res, pathname);
}

function createServer(port) {
  if (WSS) {
    // 自定义 http server 接管普通请求：/api/rooms 返回 JSON 状态、其余返回实时服务器列表页，
    // 再把 WebSocket 升级握手手动转交给 wss —— 两种传输层行为对齐，浏览器直接访问也能看到列表页。
    const http = require('http');
    const server = http.createServer((req, res) => httpHandler(req, res, port));
    const wss = new WSS.Server({ noServer: true });
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
    });
    server.listen(port);
    return {
      on(ev, fn) { wss.on(ev, fn); return this; },
      close() { try { wss.close(); } catch (e) { } try { server.close(); } catch (e) { } }
    };
  }
  return MiniWS.createServer(port);
}
function isOpen(ws) { return (ws.readyState === 1 || ws.readyState === 'open'); }

/* ---- 内置 WebSocket 服务端（零依赖，RFC6455 文本帧子集） ---- */
const MiniWS = (() => {
  const crypto = require('crypto');
  const http = require('http');
  const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const OPEN = 1;

  function encodeFrame(opcode, payload) {
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.from([0x80 | opcode, len]); }
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([head, payload]);
  }

  function createServer(port) {
    const server = http.createServer((req, res) => {
      // 普通 HTTP 请求（非 WebSocket 升级）→ 服务器列表页 / JSON 状态接口
      httpHandler(req, res, port);
    });
    const conns = new Set();
    const connHandlers = []; // 'connection' 事件监听器（参数为 ws 实例）

    server.on('upgrade', (req, socket) => {
      const key = req.headers['sec-websocket-key'];
      const ver = req.headers['sec-websocket-version'];
      if (!key || ver !== '13') { socket.destroy(); return; }
      const accept = crypto.createHash('sha1').update(key + MAGIC).digest('base64');
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
      const ws = {
        readyState: OPEN, _socket: socket, _buffer: Buffer.alloc(0), _listeners: {},
        on(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); return this; },
        emit(ev, data) { (this._listeners[ev] || []).forEach(fn => fn(data)); },
        send(str) { if (this.readyState !== OPEN) return; this._socket.write(encodeFrame(0x1, Buffer.from(String(str), 'utf8'))); },
        ping() { if (this.readyState !== OPEN) return; this._socket.write(encodeFrame(0x9, Buffer.alloc(0))); },
        terminate() { try { this._socket.destroy(); } catch (e) { } },
        close() { if (this.readyState !== OPEN) return; this.readyState = 3; try { this._socket.write(encodeFrame(0x8, Buffer.alloc(0))); this._socket.end(); } catch (e) { } }
      };
      conns.add(ws);
      ws.on('close', () => conns.delete(ws));

      socket.on('data', chunk => {
        ws._buffer = Buffer.concat([ws._buffer, chunk]);
        // 解析所有完整帧
        for (;;) {
          const buf = ws._buffer;
          if (buf.length < 2) break;
          const op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          let maskKey = null;
          if (masked) { if (buf.length < off + 4) break; maskKey = buf.slice(off, off + 4); off += 4; }
          if (buf.length < off + len) break;
          const payload = Buffer.from(buf.slice(off, off + len));
          ws._buffer = buf.slice(off + len);
          if (maskKey) for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
          if (op === 0x8) { ws.close(); return; }
          else if (op === 0x9) { ws._socket.write(encodeFrame(0xA, payload)); }
          else if (op === 0xA) { ws.emit('pong'); }
          else if (op === 0x1 || op === 0x2) { ws.emit('message', payload.toString('utf8')); }
        }
      });
      socket.on('close', () => { ws.readyState = 3; ws.emit('close'); });
      socket.on('error', () => { });
      connHandlers.forEach(fn => fn(ws)); // 触发 'connection'(ws)
    });

    server.listen(port);
    return {
      on(ev, fn) { if (ev === 'connection') connHandlers.push(fn); return this; },
      close() { server.close(); for (const ws of conns) ws.terminate(); }
    };
  }
  return { createServer };
})();

/* ================= 业务：房间与消息路由 ================= */
const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 8;
const wss = createServer(PORT);

const rooms = new Map();   // roomId -> { id, name, hostId, players: Map<id, {ws,name,team}> }
const clients = new Map(); // ws -> { id, name, roomId }
let nextId = 1, nextRoom = 1;

function lanIPs() {
  const ips = [];
  const ifs = os.networkInterfaces();
  for (const k in ifs) for (const i of ifs[k]) if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  return ips;
}

function roomList() {
  return [...rooms.values()].map(r => ({ id: r.id, name: r.name, players: r.players.size, max: MAX_PLAYERS }));
}

function send(ws, obj) { if (isOpen(ws)) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }

function broadcastRooms() {
  const msg = JSON.stringify({ t: 'rooms', list: roomList() });
  for (const ws of clients.keys()) if (isOpen(ws)) ws.send(msg);
}

function roomOf(ws) {
  const c = clients.get(ws);
  return c && c.roomId ? rooms.get(c.roomId) : null;
}

function roomPlayersList(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team }));
}

function leaveRoom(ws, silent) {
  const c = clients.get(ws);
  if (!c || !c.roomId) return;
  const room = rooms.get(c.roomId);
  if (!room) { c.roomId = null; return; }
  room.players.delete(c.id);
  const msg = JSON.stringify({ t: 'peerLeave', sid: c.id });
  for (const [pid, p] of room.players) if (pid !== c.id) send(p.ws, msg);
  if (room.hostId === c.id) {
    // 房主离开 → 房间解散
    for (const [, p] of room.players) {
      send(p.ws, { t: 'roomEnd' });
      const pc = clients.get(p.ws); if (pc) pc.roomId = null;
    }
    rooms.delete(c.roomId);
  }
  c.roomId = null;
  if (!silent) broadcastRooms();
}

wss.on('connection', ws => {
  const c = { id: 'p' + (nextId++), name: '玩家' + nextId, roomId: null };
  clients.set(ws, c);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', data => {
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    switch (m.t) {
      case 'hello':
        if (m.mode === 'list') {
          send(ws, { t: 'rooms', list: roomList() });
        } else if (m.mode === 'create') {
          leaveRoom(ws, true);
          if (m.name) c.name = m.name;
          const id = 'room' + (nextRoom++);
          const room = { id, name: m.name || ('房间' + nextRoom), hostId: c.id, players: new Map() };
          room.players.set(c.id, { ws, name: c.name, team: 'blue' });
          rooms.set(id, room);
          c.roomId = id;
          send(ws, { t: 'welcome', pid: c.id, roomId: id, host: true, name: c.name, hostId: c.id, players: roomPlayersList(room) });
          broadcastRooms();
        } else if (m.mode === 'join') {
          const room = rooms.get(m.roomId);
          if (!room) { send(ws, { t: 'error', msg: '房间不存在' }); return; }
          if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: '房间已满' }); return; }
          leaveRoom(ws, true);
          const blueN = [...room.players.values()].filter(p => p.team === 'blue').length;
          const team = blueN >= 6 ? 'red' : 'blue';
          if (m.name) c.name = m.name;
          room.players.set(c.id, { ws, name: c.name, team });
          c.roomId = room.id;
          send(ws, { t: 'welcome', pid: c.id, roomId: room.id, host: false, name: c.name, team, hostId: room.hostId, players: roomPlayersList(room) });
          const pmsg = JSON.stringify({ t: 'peerJoin', p: { id: c.id, name: c.name, team } });
          for (const [pid, p] of room.players) if (pid !== c.id) send(p.ws, pmsg);
          broadcastRooms();
        }
        break;

      case 'join': // 单独发起的加入（点房间行触发）
        ws.emit('message', JSON.stringify({ t: 'hello', mode: 'join', roomId: m.roomId }));
        break;

      case 'start': { // 仅房主可发：通知房间所有人进入对战（房主为权威模拟端，本地同时开始）
        const room = roomOf(ws);
        if (!room || room.hostId !== c.id) break;
        const msg = JSON.stringify({ t: 'start' });
        for (const [, p] of room.players) send(p.ws, msg);
        break;
      }

      case 'state':
      case 'respawn':
      case 'die': {
        const room = roomOf(ws);
        if (!room) break;
        const host = room.players.get(room.hostId);
        if (host && host.ws !== ws) send(host.ws, { t: m.t, sid: c.id, p: m.p || null });
        break;
      }
      case 'event': {
        const room = roomOf(ws);
        if (!room) break;
        const msg = JSON.stringify({ t: 'event', e: m.e, sid: c.id });
        for (const [pid, p] of room.players) if (pid !== c.id) send(p.ws, msg);
        break;
      }
      case 'states': {
        // 房主全量快照（10Hz）→ 转发给房间内其他所有玩家：
        // 队员端据此创建/渲染队友与敌方单位（缺此通道 → 队员看不到队友）
        const room = roomOf(ws);
        if (!room || room.hostId !== c.id) break; // 仅房主可发
        const msg = JSON.stringify(m);
        for (const [pid, p] of room.players) if (pid !== c.id) send(p.ws, msg);
        break;
      }
      case 'rooms':
        send(ws, { t: 'rooms', list: roomList() });
        break;
      case 'leave':
        leaveRoom(ws);
        break;
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
    clients.delete(ws);
  });
});

// 心跳清理
setInterval(() => {
  for (const ws of clients.keys()) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (e) { }
  }
}, 30000);

console.log('==========================================');
console.log('  战地突击 Battleground · 联机服务端已启动');
console.log('  端口: ' + PORT);
console.log('  传输: ' + (WSS ? 'ws (npm 包)' : '内置 RFC6455 实现（零依赖）'));
console.log('  本机: ws://localhost:' + PORT);
for (const ip of lanIPs()) console.log('  局域网: ws://' + ip + ':' + PORT + '  ← 客户端在"加入房间"输入此地址');
console.log('  最多 ' + MAX_PLAYERS + ' 人/房间，房主为权威模拟端');
console.log('  注意: ws:// 地址请在游戏主界面输入框填写，勿在浏览器地址栏打开（会报 ERR_UNKNOWN_URL_SCHEME）');
console.log('  列表: 浏览器访问 http://IP:' + PORT + ' 可查看实时服务器列表页（房间/在线/联机指引）');
console.log('==========================================');