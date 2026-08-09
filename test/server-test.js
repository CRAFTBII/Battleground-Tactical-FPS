// 服务端协议回归测试：不依赖 ws 库，手写 RFC6455 客户端帧（带掩码）验证
// 用法：先起服务器（PORT=8081 node server.js），再 node test/server-test.js
'use strict';
const net = require('net');
const crypto = require('crypto');
const HOST = '127.0.0.1', PORT = process.env.TEST_PORT || 8081;
let failures = [], roomId = '';

function clientFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  let head;
  if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
  else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(payload.length, 2); }
  return Buffer.concat([head, mask, masked]);
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST, () => {
      const key = crypto.randomBytes(16).toString('base64');
      sock.write('GET / HTTP/1.1\r\nHost: ' + HOST + ':' + PORT +
        '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
    });
    let raw = Buffer.alloc(0), handshook = false, msgs = [];
    sock.on('data', chunk => {
      raw = Buffer.concat([raw, chunk]);
      if (!handshook) {
        const idx = raw.indexOf('\r\n\r\n');
        if (idx < 0) return;
        if (!raw.slice(0, idx).toString().includes('101')) { failures.push(name + ' 握手失败'); sock.destroy(); return; }
        handshook = true;
        raw = raw.slice(idx + 4);
        resolve(sock);
      }
      for (;;) {
        if (raw.length < 2) break;
        const op = raw[0] & 0x0f;
        let len = raw[1] & 0x7f, off = 2;
        if (len === 126) { if (raw.length < 4) break; len = raw.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (raw.length < 10) break; len = Number(raw.readBigUInt64BE(2)); off = 10; }
        if (raw.length < off + len) break;
        const payload = raw.slice(off, off + len).toString('utf8');
        raw = raw.slice(off + len);
        if (op === 0x1) msgs.push(payload);
      }
    });
    sock.on('error', e => reject(e));
    sock._msgs = () => msgs;
    sock._send = str => sock.write(clientFrame(str));
  });
}

function waitMsg(c, pred, timeout) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const m = c._msgs().map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).find(pred);
      if (m) { clearInterval(iv); resolve(m); }
      else if (Date.now() - t0 > timeout) { clearInterval(iv); reject(new Error('等待消息超时: ' + JSON.stringify(c._msgs()))); }
    }, 25);
  });
}

(async () => {
  // 0) 普通 HTTP 请求应返回服务器列表页（200，含房间数据与联机指引）；/api/rooms 返回 JSON 状态
  try {
    const http = require('http');
    const get = url => new Promise((resolve, reject) => {
      http.get('http://' + HOST + ':' + PORT + url, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ code: r.statusCode, body: d }));
      }).on('error', reject);
    });
    const page = await get('/');
    if (page.code !== 200 || !page.body.includes('WebSocket') || !page.body.includes('/api/rooms')) failures.push('列表页异常: code=' + page.code + ' len=' + page.body.length);
    else console.log('✓ 服务器列表页返回（200，含房间数据与联机指引）');
    const api = await get('/api/rooms');
    const st = JSON.parse(api.body);
    if (api.code !== 200 || !Array.isArray(st.rooms) || typeof st.port !== 'number') failures.push('/api/rooms 异常: ' + api.body.slice(0, 120));
    else console.log('✓ /api/rooms 返回 JSON 状态（rooms 数组 + port）');
  } catch (e) { failures.push('列表页检查异常: ' + e.message); }

  const c1 = await connect('client1');
  // 1) 列表
  c1._send(JSON.stringify({ t: 'hello', mode: 'list' }));
  const rooms = await waitMsg(c1, m => m && m.t === 'rooms', 2000);
  if (!Array.isArray(rooms.list)) failures.push('rooms.list 不是数组');
  else console.log('✓ 服务器列表返回:', JSON.stringify(rooms.list));
  // 2) 建房
  c1._send(JSON.stringify({ t: 'hello', mode: 'create' }));
  const w1 = await waitMsg(c1, m => m && m.t === 'welcome', 2000);
  if (!w1.host || !w1.roomId) failures.push('建房 welcome 缺 host/roomId');
  else { console.log('✓ 建房成功 roomId=' + w1.roomId + ' host=' + w1.host); roomId = w1.roomId; }
  // 3) 加入
  const c2 = await connect('client2');
  c2._send(JSON.stringify({ t: 'hello', mode: 'join', roomId }));
  const w2 = await waitMsg(c2, m => m && m.t === 'welcome', 2000);
  if (w2.host !== false) failures.push('加入方 welcome.host 应为 false');
  else console.log('✓ 加入成功 pid=' + w2.pid);
  // 4) 房主收到 peerJoin
  const pj = await waitMsg(c1, m => m && m.t === 'peerJoin', 2000);
  if (!pj.p || !pj.p.id) failures.push('peerJoin 缺 p.id');
  else console.log('✓ 房主收到 peerJoin:', pj.p.name);
  // 5) 客户端上报 state → 房主收到
  c2._send(JSON.stringify({ t: 'state', p: { x: 1, y: 2, z: 3, yaw: 0 } }));
  const st = await waitMsg(c1, m => m && m.t === 'state', 2000);
  if (!st.sid || st.p.x !== 1) failures.push('state 路由失败: ' + JSON.stringify(st));
  else console.log('✓ state 正确路由到房主 sid=' + st.sid);
  // 6) 事件广播（c1 发事件，c2 收到）
  c1._send(JSON.stringify({ t: 'event', e: { k: 'test' } }));
  const ev = await waitMsg(c2, m => m && m.t === 'event', 2000);
  if (!ev.e || ev.e.k !== 'test') failures.push('事件广播失败');
  else console.log('✓ 事件广播成功');
  // 7) 大厅：welcome 应带 players 成员列表 + hostId（过渡页数据）
  if (!Array.isArray(w1.players) || w1.players.length !== 1 || !w1.hostId) failures.push('建房 welcome 缺 players/hostId: ' + JSON.stringify(w1));
  else if (!Array.isArray(w2.players) || w2.players.length !== 2 || w2.hostId !== w1.pid) failures.push('加入 welcome 缺 players/hostId: ' + JSON.stringify(w2));
  else console.log('✓ welcome 携带成员列表（房主1人→2人）与 hostId');
  // 8) start 广播：仅房主可发，房间内所有人（含房主自己）收到
  c2._send(JSON.stringify({ t: 'start' })); // 非房主发 start 应被忽略
  c1._send(JSON.stringify({ t: 'start' })); // 房主发 start → 广播
  const s1 = await waitMsg(c1, m => m && m.t === 'start', 2000);
  const s2 = await waitMsg(c2, m => m && m.t === 'start', 2000);
  if (!s1 || !s2) failures.push('start 未广播给全部成员（房主=' + !!s1 + ' 加入者=' + !!s2 + '）');
  else console.log('✓ start 广播给房间内所有人（房主+加入者）');
  // 8.5) states 快照广播：房主 10Hz 全量快照 → 加入者收到（队员渲染队友的关键通道）
  c2._send(JSON.stringify({ t: 'states', score: { blue: 9, red: 9 }, time: 520 })); // 非房主发 states 应被忽略
  c1._send(JSON.stringify({ t: 'states', score: { blue: 1, red: 0 }, time: 520, players: [{ id: w1.pid, name: 'Host', team: 'blue', hp: 100, alive: true, down: false, kills: 0, deaths: 0, x: 10, y: 0, z: 10, yaw: 0, weapon: 'rifle' }], ai: [] }));
  const sts = await waitMsg(c2, m => m && m.t === 'states', 2000);
  if (!sts || !Array.isArray(sts.players) || sts.players.length !== 1 || sts.players[0].id !== w1.pid) failures.push('states 快照未从房主广播到加入者: ' + JSON.stringify(sts));
  else console.log('✓ states 快照从房主广播到加入者（队员可渲染队友）');
  c1.destroy(); c2.destroy();
  console.log(failures.length ? '\n=== 服务端测试失败 ' + failures.length + ' 项 ===\n' + failures.join('\n') : '\n=== 服务端协议测试全部通过 ===');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
