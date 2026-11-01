/* ============================================
 * 战地突击 · main.js（由 index.html 内联脚本拆分）
 * ============================================ */

function wireMenu() {
  const $ = id => document.getElementById(id);
  // URL 规范化：自动补 ws:// 前缀、http(s):// 自动转 ws(s)://（用户常手输 IP 不带协议、或误输 http:// ——
  // http:// 会变成普通 HTTP 请求被服务器以 426 Upgrade Required 拒绝，这里提前纠正）
  const normUrl = u => {
    u = (u || '').trim();
    if (!u) return '';
    if (/^http(s?):\/\//i.test(u)) u = u.replace(/^http/i, 'ws'); // http://→ws://，https://→wss://
    else if (!/^wss?:\/\//i.test(u)) u = 'ws://' + u;             // 无协议 → 补 ws://
    u = u.replace(/\/+$/, '');                                    // 去尾部斜杠，避免 ws://ip:8080/ 被当路径
    return u;
  };
  const url = () => normUrl($('joinIp').value) || ('ws://' + (location.hostname || 'localhost') + ':8080');
  $('joinIp').value = 'ws://' + (location.hostname || 'localhost') + ':8080';

  // ---- 地图选择（T4）：MapRegistry.list() 单选，支持 ?map=<id>，file:// 离线可用 ----
  const mapRow = $('mapRow');
  let selMapId = null;
  if (typeof MapRegistry !== 'undefined' && MapRegistry.count()) {
    const mm = /[?&]map=([\w-]+)/.exec(location.search || '');
    if (mm && MapRegistry.has(mm[1])) selMapId = mm[1];
    const maps = MapRegistry.list();
    // v2.8 任务绑定地图：按钮显示「图名 · 任务名」（选图即选任务）
    const mName = mid => { const m = (typeof CFG !== 'undefined' && CFG.MISSIONS) ? CFG.MISSIONS.find(x => x.mapId === mid) : null; return m ? ' · ' + m.name : ''; };
    mapRow.innerHTML = maps.map(m =>
      '<button type="button" class="mapbtn' + (m.id === selMapId ? ' on' : '') + '" data-map="' + m.id + '" title="' + (m.desc || '') + '">' + m.name + mName(m.id) + '</button>'
    ).join('');
    if (!selMapId) selMapId = maps[0].id;
    mapRow.querySelectorAll('.mapbtn').forEach(b => {
      b.onclick = () => {
        selMapId = b.dataset.map;
        mapRow.querySelectorAll('.mapbtn').forEach(x => x.classList.toggle('on', x === b));
        const def = MapRegistry.get(selMapId);
        if (def) World.load(scene, def); // 菜单背景即时预览（unload 自动回收旧图）
      };
    });
  } else mapRow.style.display = 'none';

  $('btnSingle').onclick = () => {
    AudioFX.init(); AudioFX.resume(); Net.disconnect();
    // v2.8 开局过渡页：先选队伍数（2~该图最大队伍数），确认后才进对局
    if (selMapId && typeof MapRegistry !== 'undefined' && World.mapId !== selMapId) {
      const def = MapRegistry.get(selMapId);
      if (def) World.load(scene, def);
    }
    const def = MapRegistry.get(selMapId || World.mapId);
    const maxT = (def && def.maxTeams) || 4;
    Game.maxTeams = maxT;
    const ts = $('teamSelect');
    const tRow = $('teamSelectBtns');
    if (ts && tRow) {
      // 队伍数按钮：2 ~ maxTeams（每队人数随任务 teamSize 变化，这里只显示队数）
      const mission = (typeof CFG !== 'undefined' && CFG.MISSIONS) ? CFG.MISSIONS.find(x => x.mapId === (def && def.id)) : null;
      $('teamSelectInfo').textContent = (def ? def.name : '') + ' · ' + (mission ? mission.name : '') + ' · 每队 ' + (mission ? mission.teamSize : 10) + ' 人';
      tRow.innerHTML = '';
      for (let n = 2; n <= maxT; n++) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = n + ' 队' + (n === 2 ? '（推荐）' : '');
        b.onclick = () => { Game.teamCount = n; ts.style.display = 'none'; Game.startSingle(); };
        tRow.appendChild(b);
      }
      ts.style.display = 'flex';
    } else {
      Game.teamCount = 2; Game.startSingle(); // 过渡页缺失兜底
    }
  };
  $('btnCreate').onclick = () => { AudioFX.init(); AudioFX.resume(); Net.showConnecting('create', url()); Net.connect(url(), 'create'); };
  $('btnJoin').onclick = () => { AudioFX.init(); AudioFX.resume(); Net.showConnecting('list', url()); Net.connect(url(), 'list'); };
  $('btnRefresh').onclick = () => { Net.connect(url(), 'list'); };
  $('btnJoin').title = '先刷新服务器列表，然后点击房间加入';
  // 联机大厅过渡页：房主开始对战 / 任意人离开房间
  $('lobbyStart').onclick = () => { AudioFX.ui(); Net.startMatch(); };
  $('lobbyLeave').onclick = () => { AudioFX.ui(); Net.lobbyLeave(); };
  // v2.7 任务驱动：objective 文案由 Game.updateObjective() 按本局任务写入（开局调用），此处不再写死旧据点文案

  // 设置面板（灵敏度/音量/按键绑定）：主菜单 + 暂停面板入口；调整即时生效并持久化
  $('btnSettings').onclick = () => { AudioFX.ui(); Settings.open(); };
  $('pausedSettingsBtn').onclick = () => { Settings.open(); };
  $('resumeBtn').onclick = () => { paused = false; requestPointerLockSafe(); };
  // 暂停菜单「退出对局」：任意模式可见；联机时自动断开连接，单机直接回主菜单（复用 backToMenu）
  $('pausedQuitBtn').onclick = () => { AudioFX.ui(); UI.toast(Net.connected ? '已断开连接' : '已退出对局'); backToMenu(); };
  // v2.1：观战/结算共用返回逻辑（死亡观战也可中途退出）
  const backToMenu = () => {
    Game.phase = 'menu';
    Net.disconnect(); Net.connected = false; Net.isHost = false; Net.remoteByPeer.clear(); Net.lobbyOpen = false;
    // v2.9.2 完整重置对局状态：units/squads/score/caps/投射物/粒子/观战/弹药(单位 dispose 含在内)
    Game.reset();
    Game.teamCount = 2; // 退出归默认，下次开局由过渡页重选
    // 停止对局环境底噪（循环风声）与所有活跃样本（防空警报等长样本未播完也立即停）
    if (typeof AudioFX !== 'undefined') {
      if (AudioFX.stopAmbience) AudioFX.stopAmbience();
      if (AudioFX.stopSamples) AudioFX.stopSamples();
    }
    // 清掉落实体（网格直接挂场景根，World.load 清不到）
    if (typeof Items !== 'undefined' && Items.clear) Items.clear();
    // 重建当前地图：重置机制状态(探照灯/沙暴/空投)与据点颜色，菜单背景保持当前图干净
    const def = (typeof MapRegistry !== 'undefined' && MapRegistry.get && World.mapId) ? MapRegistry.get(World.mapId) : null;
    if (def) World.load(scene, def);
    $('matchEnd').style.display = 'none';
    $('deathOverlay').style.display = 'none';
    $('spectateInfo').style.display = 'none';
    $('spectateQuit').style.display = 'none';
    $('paused').style.display = 'none';
    // 联机大厅过渡页兜底复位
    const lobby = document.getElementById('lobby');
    if (lobby) lobby.style.display = 'none';
    const mcol = document.querySelector('#menu .col');
    if (mcol) mcol.style.display = '';
    $('menu').style.display = 'flex';
    document.exitPointerLock && document.exitPointerLock();
  };
  $('backMenuBtn').onclick = backToMenu;
  $('spectateQuit').onclick = backToMenu;
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === renderer.domElement;
    // 触控模式不使用 Pointer Lock：失去 pointerlock 对触控玩家是常态，不能据此弹暂停
    if (typeof TouchUI !== 'undefined' && TouchUI.active) {
      if (PC.forceLocked) { paused = false; $('paused').style.display = 'none'; }
      return;
    }
    // 背包/设置/聊天输入框打开时释放鼠标不弹暂停（聊天用 window.__chatOpen 标记）
    if (!locked && Game.phase === 'playing' && !Game.dead && !Game.mortarMode
      && !window.__chatOpen
      && !(UI && UI.inventoryOpen) && !(typeof Settings !== 'undefined' && Settings.isOpen())) {
      paused = true; $('paused').style.display = 'flex';
    }
    if (locked) { paused = false; $('paused').style.display = 'none'; }
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && Game.mortarMode) { Game.toggleMortar(); e.preventDefault(); }
  });
  setInterval(() => { if (Net.frameN > 0) { UI.fps(Math.round(Net.frameN * 2)); Net.frameN = 0; } }, 500);
}

/* ---------- 8. 初始化与主循环 ---------- */
let renderer, scene, camera, clock, paused = false;
let perfDowngraded = false, fpsAccum = 0, fpsFrames = 0, fpsSampleT = 0;
let sunFollowT = 0;
function init() {
  renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // 上限 1.5，集显友好
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1200);
  // v4：相机参数来自角色 profile（眼高由 CFG.EYE 使用；near/far/fov 也随 profile）
  if (typeof ActorCatalog !== 'undefined') {
    const prof = ActorCatalog.get();
    if (prof && prof.camera) {
      camera.fov = prof.camera.fov || camera.fov;
      camera.near = prof.camera.near || camera.near;
      camera.far = prof.camera.far || camera.far;
      camera.updateProjectionMatrix();
    }
  }
  scene.add(camera); // 相机必须入场景图，否则其子节点（第一人称枪）不会被渲染遍历
  clock = new THREE.Clock();
  FX.init(scene);
  if (typeof Items !== 'undefined' && Items.init) Items.init(); // 物品模型（弹药箱/医疗包等）
  // T4：?map=<id> URL 参数（离线可用，MapRegistry 纯 JS 无 fetch）；缺省用默认图（suburb）
  const mm = /[?&]map=([\w-]+)/.exec(location.search || '');
  const bootMap = (mm && typeof MapRegistry !== 'undefined' && MapRegistry.has(mm[1])) ? mm[1] : undefined;
  World.init(scene, bootMap);
  PC.init();
  UI.init();
  if (typeof Settings !== 'undefined' && Settings.applyToGame) Settings.applyToGame(); // 应用持久化的灵敏度/音量
  if (typeof WeaponAnim !== 'undefined') WeaponAnim.init(camera); // 必须先于 PlayerGun.init：否则 attach 时 this.camera 为空，枪机/弹匣网格不会被创建
  PlayerGun.init(camera);
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
  // 移动端触控层：必须在 PC.init() 之后（要用 PC 的状态），无需 Pointer Lock
  if (typeof TouchUI !== 'undefined' && TouchUI.init) TouchUI.init();
  wireMenu();
  if (typeof Ticker !== 'undefined' && Ticker.init) Ticker.init();
  // camera/renderer 必须暴露：触控层开火要调 PlayerGun.tryFire(camera)，否则射不出去。
  // 用防护式取值，测试桩未加载 touch.js 时不会抛 ReferenceError。
  window.BATTLEGROUND = Object.assign(
    { Game, World, Net, PC, PlayerGun, FX, UI, Unit, camera, renderer },
    (typeof TouchUI !== 'undefined' ? { TouchUI } : {})
  );
  loop();
}
/* 性能自适应：FPS 长期偏低 → 关闭阴影 → 再降像素比 */
function perfAutoDowngrade(dt) {
  fpsAccum += dt; fpsFrames++;
  if (fpsAccum >= 2) {
    const fps = fpsFrames / fpsAccum;
    if (!perfDowngraded && fps < 18) {
      perfDowngraded = true;
      renderer.shadowMap.enabled = false;
      console.log('[perf] FPS ' + fps.toFixed(0) + ' 过低，已关闭阴影');
    } else if (perfDowngraded && fps < 12) {
      renderer.setPixelRatio(1);
      console.log('[perf] 继续降级：像素比 1');
    }
    fpsAccum = 0; fpsFrames = 0;
  }
}
function loop() {
  requestAnimationFrame(loop);
  Net.frameN++;
  const dt = Math.min(clock.getDelta(), 0.05);
  if (Game.phase === 'menu') {
    const t = clock.elapsedTime;
    camera.position.set(100 + Math.sin(t * 0.08) * 75, 42 + Math.sin(t * 0.06) * 6, 100 + Math.cos(t * 0.08) * 75);
    camera.lookAt(100, 0, 100);
  } else if (!paused) {
    if (typeof AudioFX !== 'undefined' && AudioFX.setListener) AudioFX.setListener(camera.position); // 空间音效以玩家为参考点
    // ECS 驱动更新：输入/物理/网络/特效系统分离——聊天空闲时物理照常，仅玩家操控暂停
    if (typeof Engine !== 'undefined' && Engine.tick) {
      Engine.playerControl = !window.__chatOpen && !(UI && UI.inventoryOpen);
      Engine.paused = false;
      Engine.tick(dt);
    } else {
      PC.update(dt);
      PlayerGun.update(dt, PC.keys, camera);
      Projectiles.update(dt);
      if (typeof Items !== 'undefined' && Items.update) Items.update(dt);
      Game.update(dt);
      MiniMap.draw();
      Net.tick(dt);
      FX.update(dt);
      if (typeof WeaponAnim !== 'undefined') WeaponAnim.update(dt);
    }
    perfAutoDowngrade(dt);
  }
  // v3.1：阴影相机跟随玩家（4Hz 足够；避免整图 2048 阴影贴图铺 700m 的糊影与全量阴影绘制）
  sunFollowT += dt;
  if (sunFollowT >= 0.25) {
    sunFollowT = 0;
    if (World && World.updateSun) World.updateSun(camera.position.x, camera.position.z);
  }
  renderer.render(scene, camera);
}
window.addEventListener('error', function (e) {
  const el = document.getElementById('fatalErr');
  if (el) { el.style.display = 'block'; el.textContent = '⚠ 运行错误: ' + (e.message || e); }
});
/* 启动：先等模型资源就绪，再 init()。
 * 模型改为服务器提供的 .glb，所以启动失败必须说清楚「去起服务」，
 * 而不是像以前那样静默回退方块人。 */
function fatalShow(msg) {
  const el = document.getElementById('fatalErr');
  if (el) { el.style.display = 'block'; el.textContent = msg; }
}
(async function boot() {
  if (typeof THREE === 'undefined') {
    fatalShow('⚠ 缺少 libs/three.min.js —— 请确认该文件存在');
    return;
  }
  if (typeof GLB === 'undefined' || typeof AssetLoader === 'undefined') {
    fatalShow('⚠ 缺少 js/glb.js 或 js/assetLoader.js —— 请确认这两个文件存在');
    return;
  }
  // 直接双击 index.html（file://）时 fetch 不可用，给出可执行的提示而非空白页
  if (typeof location !== 'undefined' && location.protocol === 'file:') {
    document.body.classList.add('bootFail');
    fatalShow('⚠ 本游戏必须启动服务才能运行。\n请在项目目录执行：node server.js\n' +
      '然后浏览器打开 http://localhost:8080 （直接双击 index.html 已不再支持）');
    return;
  }
  // The v4 branch intentionally stops booting until the replacement map runtime exists.
  let mapModule;
  try {
    mapModule = await import('/js/world/index.js');
  } catch (err) {
    document.body.classList.add('bootFail');
    fatalShow('地图 v4 入口加载失败：' + (err && err.message || err) +
      '。请检查 js/world/index.js，并参照 docs/rebuild/README.md。');
    return;
  }
  if (!mapModule || mapModule.WORLD_V4_IMPLEMENTED !== true) {
    document.body.classList.add('bootFail');
    fatalShow('地图 v4 重建工作区：运行时尚未实现。请按 docs/rebuild/implementation-plan.md 完成资产、碰撞、导航和地图阶段。');
    return;
  }
  if (mapModule.ready) await mapModule.ready;
  // v4 角色扩展口：相机眼高/胶囊/锚点来自 profile（设计上限 2.5m），不要写死 1.7m
  if (typeof ActorCatalog !== 'undefined' && ActorCatalog.load) {
    try { await ActorCatalog.load(); } catch (e) { console.warn('[Actors] profile 加载异常：' + (e && e.message || e)); }
  }
  if (typeof World === 'undefined' || typeof MapRegistry === 'undefined') {
    document.body.classList.add('bootFail');
    fatalShow('地图 v4 入口尚未提供 World / MapRegistry 兼容接口。请参照 docs/rebuild/architecture.md。');
    return;
  }
  try {
    await AssetLoader.preload();
  } catch (err) {
    fatalShow('⚠ 模型资源加载失败：' + (err && err.message || err) +
      '\n\n请确认已在本目录执行 node server.js，并通过 http://localhost:8080 访问。');
    return;
  }
  try { init(); } catch (err) {
    fatalShow('⚠ 初始化失败: ' + (err && err.message || err));
  }
})();
