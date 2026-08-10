/* ============================================
 * 战地突击 · net.js（由 index.html 内联脚本拆分）
 * ============================================ */

const MAX_PLAYERS_ONLINE = 8; // 与 server.js MAX_PLAYERS 保持一致（房间人数上限）

Object.assign(Net, {
  ws: null, isHost: false, connected: false, myId: null, roomId: null,
  hostId: null, lobbyOpen: false, lobbyPlayersList: [],
  sendT: 0, broadcastT: 0, frameN: 0, fpsT: 0, fpsV: 0,
  remoteByPeer: new Map(),

  connect(url, mode, cb) {
    this._intentional = false;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      UI.banner('地址无效：必须以 ws:// 或 wss:// 开头（不要用 http://）—— ' + e.message, '#ff6b6b', 6);
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'hello', mode: mode || 'list' });
      if (cb) cb();
    };
    this.ws.onmessage = ev => { try { this.handle(JSON.parse(ev.data)); } catch (e) { } };
    this.ws.onclose = () => {
      const was = this.connected; this.connected = false;
      document.getElementById('connectTag').textContent = was ? '⚠ 与服务器断开' : '';
      if (was && Game.phase === 'playing' && this.isHost) UI.banner('服务器连接中断', '#ff6b6b', 3);
      // 从未连上且非主动断开 → 握手被拒（426/400 等），给可操作的排查提示
      if (!was && !this._intentional) {
        this.closeConnecting(); // 收起「连接中」占位，恢复主菜单操作区
        const port = (url.match(/:(\d+)\/?$/) || [])[1] || '8080';
        UI.banner('连接被拒绝：请确认①地址是 ws://ip:' + port + '（不能是 http://）②server.js 已在对方机器运行 ③防火墙已放行 ' + port + ' 端口', '#ff9f43', 6);
      }
      this.isHost = false;
    };
    this.ws.onerror = () => {
      // 浏览器握手失败必伴随 onclose；这里给出针对性提示（426 = 地址被当普通 HTTP 请求了）
      UI.banner('连接服务器失败：请确认地址为 ws://ip:端口（若在浏览器直接打开 http:// 地址会返回 426 Upgrade Required）', '#ff6b6b', 5);
    };
  },
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); },
  disconnect() { this._intentional = true; try { if (this.ws) this.ws.close(); } catch (e) { } },
  broadcastEvent(e) { if (this.connected) this.send({ t: 'event', e }); },
  sendState(m) { if (this.connected) this.send(m); },

  handle(m) {
    switch (m.t) {
      case 'rooms':
        this.closeConnecting(); // 收起「连接中」占位，展示房间列表
        this.renderRooms(m.list || []);
        break;
      case 'welcome': {
        this.myId = m.pid; this.roomId = m.roomId; this.isHost = !!m.host;
        this.hostId = m.hostId || m.pid;
        document.getElementById('connectTag').textContent = (m.host ? '🏠 房主' : '📡 已加入') + ' · 房间 ' + m.roomId;
        // 过渡页（大厅）：等待玩家到齐，房主点「开始对战」后由 start 消息统一进入游戏
        this.showLobby(m);
        break;
      }
      case 'start': { // 房主广播：进入对战
        this.lobbyOpen = false;
        document.getElementById('lobby').style.display = 'none';
        if (this.isHost) {
          // 房主为权威模拟端：先清掉大厅阶段临时创建的远端单位，再以大厅成员重建
          this.remoteByPeer.clear();
          Game.startSingle();
          Game.player.id = this.myId;
          (this.lobbyPlayersList || []).forEach(p => { if (p.id !== this.myId) this.hostAddRemote(p); });
        } else {
          Game.reset();
          Game.spawnPlayer();
          Game.player.id = this.myId; // 对齐房主侧的身份 ID
          Game.phase = 'playing';
          document.getElementById('menu').style.display = 'none';
          UI.banner('已加入房间，等待房主同步...', '#9fb3c8', 2.5);
          requestPointerLockSafe();
          if (typeof AudioFX !== 'undefined') {
            if (AudioFX.startAmbience) AudioFX.startAmbience(); // 联机客户端环境底噪
            if (AudioFX.playSample) AudioFX.playSample('alarm', { gain: 0.05 }); // 完整警报
          }
        }
        break;
      }
      case 'peerJoin':
        if (this.lobbyOpen) { this.lobbyPlayersList.push(m.p); this.renderLobbyPlayers(); }
        if (this.isHost) { this.hostAddRemote(m.p); Game.rebalance(); }
        break;
      case 'peerLeave':
        if (this.lobbyOpen) { this.lobbyPlayersList = this.lobbyPlayersList.filter(x => x.id !== m.sid); this.renderLobbyPlayers(); }
        if (this.isHost) {
          const u = this.remoteByPeer.get(m.sid);
          if (u) { u.dispose(); Game.units = Game.units.filter(x => x !== u); this.remoteByPeer.delete(m.sid); Game.rebalance(); }
        }
        break;
      case 'roomEnd': // 房主离开/房间解散（大厅阶段）
        if (this.lobbyOpen) {
          this.lobbyLeave();
          UI.banner('房间已解散（房主已离开）', '#ff9f43', 3);
        }
        break;
      case 'state':
        if (this.isHost && m.sid) {
          const u = this.remoteByPeer.get(m.sid);
          if (u && (u.alive || u.down) && m.p) {
            u.pos.x = m.p.x; u.pos.z = m.p.z; u.yaw = m.p.yaw;
            if (m.p.weapon) u.weapon = m.p.weapon;
            if (m.p.down !== undefined && m.p.down !== u.down) { u.down = !!m.p.down; if (u.down) { u.alive = false; u.downAt = Date.now(); } }
          }
        }
        break;
      case 'revive_req':
        // §8.7 客户端按 E → 房主校验距离/状态后执行 startRevive（权威裁决）
        if (this.isHost) {
          const reviver = this.remoteByPeer.get(m.sid);
          const target = Game.units.find(x => x.id === m.target);
          if (reviver && target) Game.startRevive(reviver, target);
        }
        break;
      case 'revive_cancel':
        // §8.7 客户端松开 E → 房主取消救援并广播 revive_cancel
        if (this.isHost) {
          const reviver = this.remoteByPeer.get(m.sid);
          const target = Game.units.find(x => x.id === m.target);
          if (reviver && target) Game.cancelRevive(reviver, target);
        }
        break;
      case 'exec_req':
        // §8.7 客户端按 E 处决倒地敌人 → 房主校验并执行（防客户端越权，处决计入击杀）
        if (this.isHost) {
          const attacker = this.remoteByPeer[m.sid];
          const target = Game.units.find(x => x.id === m.target);
          if (attacker && target && attacker.team !== target.team && typeof Game.execUnit === 'function') Game.execUnit(attacker, target);
        }
        break;
      case 'states':
        if (!this.isHost) this.applyStates(m);
        break;
      case 'event':
        this.applyEvent(m.e, m.sid);
        break;
    }
  },

  /* ---------- 联机大厅过渡页（创建/加入房间的等待界面） ---------- */
  /* 收起「连接中」占位（非房间大厅）：收到房间列表或连接失败时恢复主菜单操作区 */
  closeConnecting() {
    if (this.lobbyOpen) return; // 房间大厅不在此列
    const lobby = document.getElementById('lobby');
    if (lobby && lobby.style.display === 'block') {
      lobby.style.display = 'none';
      const col = document.getElementById('menu').querySelector('.col');
      if (col) col.style.display = '';
    }
  },

  showConnecting(mode, url) {
    const el = document.getElementById('lobby');
    document.getElementById('menu').querySelector('.col').style.display = 'none';
    document.getElementById('lobbyTitle').textContent = mode === 'create' ? '正在创建房间…' : '正在连接服务器…';
    document.getElementById('lobbyRoomId').textContent = '—';
    document.getElementById('lobbyRole').textContent = '';
    document.getElementById('lobbyStart').style.display = 'none';
    document.getElementById('lobbyHint').textContent = '正在连接 ' + url + ' …';
    document.getElementById('lobbyNote').textContent = '';
    document.getElementById('lobbyPlayers').innerHTML = '<div class="lrow dim">连接中…</div>';
    el.style.display = 'block';
  },

  showLobby(m) {
    this.lobbyOpen = true;
    this.lobbyPlayersList = (m.players || []).slice();
    const el = document.getElementById('lobby');
    document.getElementById('menu').querySelector('.col').style.display = 'none';
    document.getElementById('lobbyTitle').textContent = m.host ? '房间已创建 · 等待玩家加入' : '已加入房间 · 等待房主开始';
    document.getElementById('lobbyRoomId').textContent = m.roomId;
    document.getElementById('lobbyRole').textContent = m.host ? '你是房主' : '你是队员';
    document.getElementById('lobbyStart').style.display = m.host ? '' : 'none';
    document.getElementById('lobbyHint').textContent = m.host ? '把房间号告诉队友，他们加入后即可开始对战' : '等待房主点击「开始对战」…';
    document.getElementById('lobbyNote').textContent = m.host ? '开始后你的机器将承担全部 AI 模拟（房主为权威端），最多 ' + MAX_PLAYERS_ONLINE + ' 人' : '';
    this.renderLobbyPlayers();
    el.style.display = 'block';
  },

  renderLobbyPlayers() {
    const el = document.getElementById('lobbyPlayers');
    el.innerHTML = (this.lobbyPlayersList || []).map(p =>
      '<div class="lrow"><span class="dot" style="background:' + (p.team === 'red' ? '#ff6b6b' : '#5aa9ff') + '"></span>' +
      '<span>' + esc(p.name) + '</span>' +
      (p.id === this.myId ? '<span class="tag me">你</span>' : '') +
      (p.id === this.hostId ? '<span class="tag">房主</span>' : '') +
      '</div>'
    ).join('') || '<div class="lrow dim">（暂无玩家）</div>';
  },

  /* 房主点「开始对战」：通知服务器广播 start（自己也收到，统一走 handle 的 start 分支进游戏） */
  startMatch() {
    if (!this.isHost || !this.connected) return;
    this.send({ t: 'start' });
  },

  /* 离开房间：回到主菜单（保留连接，可再刷新列表或换房间） */
  lobbyLeave() {
    this.lobbyOpen = false; this.isHost = false;
    const lobby = document.getElementById('lobby');
    if (lobby) lobby.style.display = 'none';
    const col = document.getElementById('menu').querySelector('.col');
    if (col) col.style.display = '';
    document.getElementById('menu').style.display = 'flex';
    document.getElementById('connectTag').textContent = '';
    this.send({ t: 'leave' });
  },

  renderRooms(list) {
    const el = document.getElementById('roomList');
    el.style.display = list.length ? 'block' : 'none';
    el.innerHTML = list.map(r =>
      '<div class="rrow" data-id="' + r.id + '"><span>' + esc(r.name) + '</span><span class="cnt">' + r.players + '/8</span></div>'
    ).join('');
    el.querySelectorAll('.rrow').forEach(row => row.onclick = () => {
      this.send({ t: 'join', roomId: row.dataset.id });
      el.style.display = 'none';
    });
  },

  hostAddRemote(p) {
    if (this.remoteByPeer.has(p.id)) return;
    const s = World.pickSpawn(p.team || 'blue');
    const u = new Unit(p.team || 'blue', { x: s.x, y: s.y, z: s.z, name: p.name || '玩家', remote: true, label: p.name || '玩家' });
    u.id = p.id;
    Game.units.push(u);
    this.remoteByPeer.set(p.id, u);
  },

  /* 快照（房主广播 10Hz） */
  snapshot() {
    const players = [], ai = [];
    for (const u of Game.units) {
      const e = { id: u.id, name: u.name, team: u.team, hp: Math.round(u.hp), alive: u.alive, down: !!u.down, kills: u.kills, deaths: u.deaths, x: u.pos.x, y: u.pos.y, z: u.pos.z, yaw: u.yaw, weapon: u.weapon };
      (u.ai ? ai : players).push(e);
    }
    return { t: 'states', score: Game.score, time: Game.time, players, ai };
  },

  applyStates(st) {
    Game.score = st.score; Game.time = st.time;
    const apply = (list, isAI) => {
      for (const e of list) {
        let u = Game.units.find(x => x.id === e.id);
        if (!u) {
          const s = World.pickSpawn(e.team);
          u = new Unit(e.team, { x: s.x, y: s.y, z: s.z, name: e.name, remote: true, label: e.name });
          u.id = e.id;
          u.ai = isAI ? { moving: true, role: 'rifle' } : null;
          Game.units.push(u);
        }
        if (e.id === this.myId) { // 自己：只收血量/生死/战绩（含倒地字段，§8.7 快照兜底）
          if (e.hp < (Game._hpPrev !== undefined ? Game._hpPrev : 100)) UI.flashDmg();
          Game._hpPrev = e.hp;
          Game.player.hp = e.hp;
          UI.updateHealth();
          UI.lowhp(e.hp <= 30);
          // 倒地状态：快照 down 字段驱动 overlay + 完整状态复位（丢包自愈；revive 事件丢失时兜底）
          if (e.down && !Game.player.down) {
            Game.player.down = true; Game.player.alive = false;
            Game.player.downHp = CFG.DOWN_HP; Game.player.bleedT = CFG.BLEED_OUT;
            Game.player.downAt = Date.now();
            Game.playerDown(true);
          }
          if (!e.down && Game.player.down && e.alive) {
            Game.player.down = false; Game.player.alive = true;
            Game.player.downHp = 0; Game.player.bleedT = 0;
            Game.player.reviveT = 0; Game.player.reviver = null;
            Game.playerDown(false);
          }
          if (!e.alive && !e.down && !Game.dead) {
            Game.dead = true; Game.player.dead = true;
            // v2.1 吃鸡制：客户端死亡直接进观战（不再重生）
            if (typeof Game.startSpectate === 'function') Game.startSpectate();
            document.getElementById('deathOverlay').style.display = 'flex';
            const dt = document.getElementById('deathTimer');
            if (dt) dt.textContent = '观战中 · E/Q 切换队友视角';
            if (document.getElementById('spectateInfo')) document.getElementById('spectateInfo').style.display = 'block';
            if (document.getElementById('spectateQuit')) document.getElementById('spectateQuit').style.display = 'inline-block';
            if (document.pointerLockElement) document.exitPointerLock();
          }
          if (e.alive && Game.dead) { Game.dead = false; Game.player.dead = false; document.getElementById('deathOverlay').style.display = 'none'; }
          u.kills = e.kills; u.deaths = e.deaths;
          continue;
        }
        // 插值
        const lerpK = 0.35;
        u.pos.x += (e.x - u.pos.x) * lerpK;
        u.pos.z += (e.z - u.pos.z) * lerpK;
        u.pos.y = World.heightAt(u.pos.x, u.pos.z, u.pos.y);
        let dy = (e.yaw - u.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        u.yaw += dy * lerpK;
        u.hp = e.hp; u.weapon = e.weapon;
        // 存活/倒地/死亡状态同步（down 字段快照兜底）
        if (e.down && !u.down) { u.down = true; u.alive = false; u.downAt = Date.now(); }
        if (!e.down && u.down) u.down = false;
        if (!e.alive && u.alive) { u.alive = false; u.deathAt = Date.now(); }
        if (e.alive && !u.alive) { u.alive = true; u.hp = e.hp; }
        u.kills = e.kills; u.deaths = e.deaths;
      }
    };
    apply(st.players, false);
    apply(st.ai, true);
    // 清理已离队单位
    const valid = new Set();
    st.players.forEach(e => valid.add(e.id)); st.ai.forEach(e => valid.add(e.id));
    if (this.myId) valid.add(this.myId);
    for (let i = Game.units.length - 1; i >= 0; i--) {
      const u = Game.units[i];
      if (u === Game.player) continue;
      if (!valid.has(u.id)) { u.dispose(); Game.units.splice(i, 1); }
    }
  },

  applyEvent(e, sid) {
    switch (e.k) {
      case 'shot': {
        if (!this.isHost) break;
        const attacker = this.remoteByPeer.get(sid);
        if (!attacker || (!attacker.alive && !attacker.down)) break;
        const t = Game.units.find(u => u.id === e.hx);
        if (!t || (t.life === 'dead') || t.team === attacker.team) break;
        const W = WEAPONS[e.w]; if (!W) break;
        const d = Math.sqrt(U.dist2(attacker.pos.x, attacker.pos.z, t.pos.x, t.pos.z));
        if (d > W.range * 1.6) break;
        Game.applyDamage(t, W.dmg * (e.head ? W.head : 1), attacker, !!e.head);
        break;
      }
      case 'down': {
        // §8.7 T1 广播：客户端表现（倒地 UI / 小地图十字 / 击倒 feed）
        const t = Game.units.find(u => u.id === e.id);
        if (t && !t.down) { t.down = true; t.alive = false; t.downHp = CFG.DOWN_HP; t.bleedT = CFG.BLEED_OUT; t.downAt = Date.now(); }
        if (e.id === this.myId) Game.playerDown(true);
        if (e.an) UI.downfeed(e.an, e.tn || (t ? t.name : '目标'));
        break;
      }
      case 'revive': {
        // §8.7 T5 广播：被救起
        const t = Game.units.find(u => u.id === e.id);
        if (t) { t.down = false; t.alive = true; t.hp = CFG.REVIVE_HP; t.downHp = 0; t.bleedT = 0; t.reviver = null; }
        if (e.id === this.myId) Game.playerDown(false);
        break;
      }
      case 'revive_cancel': {
        // §8.7 中断广播：进度清零（客户端读条复位）
        const t = Game.units.find(u => u.id === e.id);
        if (t) { t.reviveT = 0; if (e.by === this.myId && Game.playerReviveTarget === t) Game.playerReviveTarget = null; }
        break;
      }
      case 'kill': {
        const t = Game.units.find(u => u.id === e.t);
        if (t && t.alive) { t.alive = false; t.deathAt = Date.now(); t.deaths++; }
        if (t) { t.down = false; t.downHp = 0; t.bleedT = 0; }
        const a = Game.units.find(u => u.id === e.a);
        if (a) { a.kills++; Game.score[a.team]++; }
        UI.killfeed(a ? a.name : '坠落', t ? t.name : '目标', e.head);
        break;
      }
      case 'fire': {
        const u = Game.units.find(x => x.id === e.id);
        const ox = e.x !== undefined ? e.x : (u ? u.pos.x : 0);
        const oz = e.z !== undefined ? e.z : (u ? u.pos.z : 0);
        const oy = e.y !== undefined ? e.y : (u ? u.pos.y + 1.5 : 1.5);
        if (U.dist(ox, oz, Game.player.pos.x, Game.player.pos.z) < 160) {
          const eye = new THREE.Vector3(ox, oy, oz);
          const dir = new THREE.Vector3(Math.sin(u ? u.yaw : e.yaw || 0), 0, Math.cos(u ? u.yaw : e.yaw || 0));
          FX.tracer(eye, eye.clone().addScaledVector(dir, 45), 0xffc080);
          AudioFX.shot(e.w || 'rifle', new THREE.Vector3(ox, oy, oz));
        }
        break;
      }
      case 'throw': {
        if (U.dist(e.x, e.z, Game.player.pos.x, Game.player.pos.z) < 140)
          Projectiles.spawn(e.t, new THREE.Vector3(e.x, e.y, e.z), new THREE.Vector3(e.vx, e.vy, e.vz), e.team, null);
        break;
      }
      case 'boom': FX.explosion(new THREE.Vector3(e.x, e.y, e.z), e.r || 5); break;
      case 'incoming': UI.showIncoming(e.x, e.z); break;
      case 'spawn': {
        const u = Game.units.find(x => x.id === e.id);
        if (u) { u.pos.set(e.x, e.y, e.z); u.alive = true; u.hp = CFG.PLAYER_HP; u.deathAt = 0;
          u.down = false; u.downHp = 0; u.bleedT = 0; u.reviver = null; u.spawnProtT = CFG.SPAWN_PROT; }
        break;
      }
      case 'end': Game.score = { blue: e.b, red: e.r }; Game.endMatch(); break;
      // v2.7 任务同步：房主开局广播本局任务（客户端结算/文案依赖）；v2.8 附带队伍数
      case 'mission':
        if (e.id) {
          const m = (typeof CFG !== 'undefined' && CFG.MISSIONS) ? CFG.MISSIONS.find(x => x.id === e.id) : null;
          if (m) { Game.mission = m; if (Game.updateObjective) Game.updateObjective(); }
        }
        if (e.tc) { Game.teamCount = e.tc; Game.teams = CFG.TEAMS.slice(0, e.tc); }
        break;
      // v1.2：地图机制事件（客户端视觉同步；房主直接模拟）
      case 'm_storm':
      case 'm_airdrop':
      case 'm_pwr':
      case 'm_arty':
      // v1.3：缩圈阶段/半径同步（客户端渲染圈；房主直接模拟）
      case 'm_zone':
        if (typeof Mechanics !== 'undefined' && Mechanics.onEvent) Mechanics.onEvent(e);
        break;
    }
  },

  tick(dt) {
    if (!this.connected || Game.phase !== 'playing') return;
    this.sendT += dt; this.broadcastT += dt;
    if (this.sendT >= 0.1 && !this.isHost) {
      this.sendT = 0;
      const p = Game.player;
      this.send({ t: 'state', p: { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, weapon: p.weapon, hp: p.hp, alive: p.alive, down: !!p.down } });
    }
    if (this.broadcastT >= 0.1 && this.isHost) {
      this.broadcastT = 0;
      this.send(this.snapshot());
    }
  }
});

/* ---------- 菜单与流程 ---------- */
