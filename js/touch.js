/* ============================================
 * 战地突击 · touch.js — 移动端触控操作层（零依赖）
 *
 * 设计参考主流手游 FPS 惯例：
 *   · 左半屏任意位置按下即出现摇杆（浮动摇杆，不用去找固定圆心）
 *   · 右半屏任意位置拖动 = 转视角（整个右半屏都是瞄准区）
 *   · 右半屏"点击（几乎不移动）"= 开火；按住拖动 = 只转视角不开火
 *   · 右下角大号动作按钮 + 武器切换条，按钮按可用状态自动显隐/置灰
 *   · 只在 Game.phase === 'playing' 时显示，回菜单/暂停自动隐藏
 *
 * 不复制游戏逻辑：移动写 PC.touchMove，视角改 PC.yaw/pitch，
 * 开火/换弹/切枪调 PlayerGun 既有方法。
 * ============================================ */

const TouchUI = {
  active: false,
  root: null,
  els: {},
  stick: { id: null, cx: 0, cy: 0, R: 62 },
  look: { id: null, lastX: 0, lastY: 0, moved: 0, t0: 0 },
  _bound: false,
  _visible: false,
  _tick: 0,

  SENS: 0.0052,          // 转视角灵敏度（弧度/像素）
  TAP_MAX_MOVE: 14,      // 位移小于该值视为"点击开火"
  TAP_MAX_MS: 260,       // 点击时长上限

  /* ---------- 设备判定 ---------- */
  enabled() {
    const q = (typeof location !== 'undefined' && location.search) || '';
    if (/[?&]touch=1/.test(q)) return true;
    if (/[?&]touch=0/.test(q)) return false;
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const maxTouch = Number(nav.maxTouchPoints) || 0;
    const hasTouchEvent = (typeof window !== 'undefined') && ('ontouchstart' in window);
    const coarse = (typeof matchMedia === 'function') && matchMedia('(pointer: coarse)').matches;
    return (maxTouch > 0 && (hasTouchEvent || coarse)) || (hasTouchEvent && coarse);
  },

  init() {
    if (this._bound) return this;
    this.active = this.enabled();
    const cls = (document.body && document.body.classList) ? document.body.classList : null;
    if (cls) cls.toggle('touch-ui', this.active);
    if (!this.active) return this;

    this._buildDOM();
    this._bindStick();
    this._bindLookAndFire();
    this._bindButtons();
    this._bindOrientation();

    PC.forceLocked = true;          // 绕开 Pointer Lock
    this._bound = true;

    // 每帧同步一次 UI 可见性/按钮状态（回菜单自动隐藏）
    setInterval(() => this._sync(), 200);
    this._sync();
    console.log('[TouchUI] 触控层已启用');
    return this;
  },

  /* ---------- DOM ---------- */
  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'touchLayer';
    root.innerHTML = [
      '<div id="tStick"><div id="tRing"></div><div id="tKnob"></div></div>',
      '<div id="tHitTip">点击开火 · 拖动转视角</div>',

      '<div id="tWeaponBar"></div>',

      '<div id="tBtns">',
      '  <button type="button" id="tFire" class="tbtn fire">开火</button>',
      '  <button type="button" id="tAim"  class="tbtn">瞄准</button>',
      '  <button type="button" id="tReload" class="tbtn sm">换弹</button>',
      '  <button type="button" id="tJump"   class="tbtn sm">跳</button>',
      '  <button type="button" id="tInteract" class="tbtn sm">交互</button>',
      '  <button type="button" id="tItem"   class="tbtn sm">手雷</button>',
      '</div>',

      '<div id="tRotate"><div class="tRotateBox">🔄<div>请横屏游玩</div><div class="tRotateHint">旋转手机以获得完整视野</div></div></div>'
    ].join('');
    document.body.appendChild(root);
    this.root = root;
    this.els = {
      stick: root.querySelector('#tStick'),
      ring: root.querySelector('#tRing'),
      knob: root.querySelector('#tKnob'),
      tip: root.querySelector('#tHitTip'),
      wbar: root.querySelector('#tWeaponBar'),
      btns: root.querySelector('#tBtns'),
      rotate: root.querySelector('#tRotate'),
      fire: root.querySelector('#tFire'),
      aim: root.querySelector('#tAim'),
      reload: root.querySelector('#tReload'),
      jump: root.querySelector('#tJump'),
      interact: root.querySelector('#tInteract'),
      item: root.querySelector('#tItem'),
    };
    this._buildWeaponBar();
  },

  /* ---------- 武器切换条 ---------- */
  _buildWeaponBar() {
    if (!this.els.wbar) return;      // 防御：极简 DOM 桩无 querySelector 时不阻断
    const list = [
      { k: 'rifle', label: '步枪' },
      { k: 'sniper', label: '狙击' },
      { k: 'shotgun', label: '霰弹' },
      { k: 'pistol', label: '手枪' },
      { k: 'medkit', label: '医疗' },
      { k: 'grenade', label: '手雷' },
    ];
    this.els.wbar.innerHTML = list.map(w =>
      '<button type="button" class="twpn" data-w="' + w.k + '">' + w.label + '</button>'
    ).join('');
    if (!this.els.wbar.querySelectorAll) return;
    this.els.wbar.querySelectorAll('.twpn').forEach(b => {
      b.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        if (Game.phase !== 'playing' || !Game.player || Game.player.dead) return;
        PlayerGun.setCur(b.dataset.w);
        AudioFX.ui();
        this._sync();
      }, { passive: false });
    });
  },

  /* ---------- UI 显隐与状态同步 ---------- */
  _sync() {
    if (!this.active || !this.root) return;
    const playing = (typeof Game !== 'undefined') && Game.phase === 'playing'
      && Game.player && !Game.player.dead && !Game.player.down;
    // 菜单/暂停/结算时整体隐藏，避免"离开游戏还有按键"
    // 用 body class 控制（CSS 里 body.touch-ui.touch-playing #touchLayer { display:block }），
    // 比给子元素逐个隐藏更彻底，连按钮和武器条一起收掉。
    if (this._visible !== playing) {
      this._visible = playing;
      const cls = (document.body && document.body.classList) ? document.body.classList : null;
      if (cls) cls.toggle('touch-playing', playing);
      if (cls && !playing) {
        // 隐藏瞬间释放所有触控状态，防止"按着摇杆退回菜单"后输入卡住
        PC.touchMove = null; PC.touchSprint = false;
        PC.keys.delete('Mouse0'); PC.keys.delete('Mouse2');
        this.stick.id = null; this.look.id = null;
      }
    }
    if (!playing) return;

    // 换弹按钮：换弹中置灰并显示进度文案
    if (this.els.reload) {
      const isRel = !!PlayerGun.reloading;
      this.els.reload.classList.toggle('off', isRel);
      this.els.reload.textContent = isRel ? '换弹中' : '换弹';
      const w = (typeof WEAPONS !== 'undefined') ? WEAPONS[PlayerGun.cur] : null;
      if (w) {
        const mag = PlayerGun.mags[PlayerGun.cur] || 0;
        // 空弹匣时换弹按钮高亮提示
        this.els.reload.classList.toggle('alert', mag <= 0 && !isRel);
      }
      // 非枪械槽（医疗/手雷等）不需要换弹/瞄准
      const isGun = !!(w && w.damage !== undefined);
      this.els.reload.style.visibility = isGun ? 'visible' : 'hidden';
      this.els.aim.style.visibility = isGun ? 'visible' : 'hidden';
    }
    // 瞄准按钮状态跟随开镜
    if (this.els.aim) this.els.aim.classList.toggle('on', PlayerGun.aimT > 0.5);
    // 手雷按钮文案随当前槽变化
    if (this.els.item) {
      const it = PlayerGun.cur === 'medkit' ? '治疗' : PlayerGun.cur === 'armorkit' ? '护甲'
        : PlayerGun.cur === 'smoke' ? '烟雾' : '手雷';
      this.els.item.textContent = it;
    }
    // 当前武器高亮
    if (this.els.wbar) {
      this.els.wbar.querySelectorAll('.twpn').forEach(b => {
        b.classList.toggle('on', b.dataset.w === PlayerGun.cur);
      });
    }
  },

  /* ---------- 浮动摇杆（左半屏任意位置按下） ---------- */
  _bindStick() {
    const S = this.stick;
    const half = () => (window.innerWidth || 800) * 0.5;
    const show = (x, y) => {
      const el = this.els.stick;
      if (!el) return;
      el.classList.add('on');
      el.style.left = (x - S.R) + 'px';
      el.style.top = (y - S.R) + 'px';
    };
    const hide = () => { if (this.els.stick) this.els.stick.classList.remove('on'); };
    const moveKnob = (dx, dy) => {
      if (this.els.knob) this.els.knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };

    const start = e => {
      if (Game.phase !== 'playing') return;
      const t = (e.changedTouches || [e])[0];
      if (!t || t.clientX > half()) return;      // 只有左半屏
      if (S.id !== null) return;
      S.id = t.identifier; S.cx = t.clientX; S.cy = t.clientY;
      show(S.cx, S.cy);
      moveKnob(0, 0);
      e.preventDefault();
    };
    const move = e => {
      if (S.id === null) return;
      for (const t of (e.changedTouches || [e])) {
        if (t.identifier !== S.id) continue;
        let dx = t.clientX - S.cx, dy = t.clientY - S.cy;
        const len = Math.hypot(dx, dy);
        if (len > S.R) { dx = dx / len * S.R; dy = dy / len * S.R; }
        moveKnob(dx, dy);
        const nx = dx / S.R, ny = dy / S.R;
        // 死区，避免手指微抖就走
        const dead = 0.16;
        const mag = Math.hypot(nx, ny);
        const scale = mag < dead ? 0 : Math.min(1, (mag - dead) / (1 - dead)) / mag;
        PC.touchMove = { f: -ny * scale, s: nx * scale };
        PC.touchSprint = (-ny) > 0.86;
        e.preventDefault();
        return;
      }
    };
    const end = e => {
      if (S.id === null) return;
      for (const t of (e.changedTouches || [e])) {
        if (t.identifier !== S.id) continue;
        S.id = null;
        PC.touchMove = null; PC.touchSprint = false;
        moveKnob(0, 0); hide();
        e.preventDefault();
        return;
      }
    };
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: false });
    document.addEventListener('touchcancel', end, { passive: false });
  },

  /* ---------- 右半屏：拖动转视角 + 轻点开火 ---------- */
  _bindLookAndFire() {
    const L = this.look;
    const half = () => (window.innerWidth || 800) * 0.5;
    const isUI = t => !!(t.target && t.target.closest && t.target.closest('#tBtns, #tWeaponBar'));

    const start = e => {
      if (Game.phase !== 'playing') return;
      const t = (e.changedTouches || [e])[0];
      if (!t || t.clientX <= half() || isUI(t)) return;
      if (L.id !== null) return;
      L.id = t.identifier; L.lastX = t.clientX; L.lastY = t.clientY;
      L.moved = 0; L.t0 = Date.now();
      e.preventDefault();
    };
    const move = e => {
      if (L.id === null) return;
      for (const t of (e.changedTouches || [e])) {
        if (t.identifier !== L.id) continue;
        const dx = t.clientX - L.lastX, dy = t.clientY - L.lastY;
        L.lastX = t.clientX; L.lastY = t.clientY;
        L.moved += Math.abs(dx) + Math.abs(dy);
        PC.yaw = PC.safeYaw(PC.yaw - dx * this.SENS);
        PC.pitch = Math.max(-1.45, Math.min(1.45, PC.pitch - dy * this.SENS));
        e.preventDefault();
        return;
      }
    };
    const end = e => {
      if (L.id === null) return;
      for (const t of (e.changedTouches || [e])) {
        if (t.identifier !== L.id) continue;
        const quick = (Date.now() - L.t0) <= this.TAP_MAX_MS;
        const still = L.moved <= this.TAP_MAX_MOVE;
        L.id = null;
        // 轻点右半屏 = 开火（手游常见：点按射击；拖动只转视角）
        if (quick && still) this._triggerFire();
        e.preventDefault();
        return;
      }
    };
    document.addEventListener('touchstart', start, { passive: false });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end, { passive: false });
    document.addEventListener('touchcancel', end, { passive: false });
  },

  /** 开火/使用当前槽（与桌面左键同样的分支） */
  _triggerFire() {
    if (Game.phase !== 'playing' || !Game.player || Game.player.dead || Game.player.down) return;
    const cam = (typeof window !== 'undefined' && window.BATTLEGROUND && window.BATTLEGROUND.camera)
      ? window.BATTLEGROUND.camera : null;
    const c = PlayerGun.cur;
    if (Game.mortarMode) { Game.fireMortar(); return; }
    if (c === 'medkit') PlayerGun.useMedkit();
    else if (c === 'armorkit') PlayerGun.useArmorkit();
    else if (c === 'grenade') PlayerGun.throwGrenade();
    else if (c === 'smoke') PlayerGun.throwSmoke();
    else if (cam) PlayerGun.tryFire(cam);
    else {
      // 兜底：相机拿不到时也要能开枪（tryFire 支持传 null 会炸，这里用场景相机）
      const sc = (typeof World !== 'undefined' && World.scene) ? World.scene.getObjectByProperty('isCamera', true) : null;
      if (sc) PlayerGun.tryFire(sc);
    }
  },

  /* ---------- 动作按钮 ---------- */
  _bindButtons() {
    const on = (el, fn) => {
      if (!el) return;
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); fn(); }, { passive: false });
    };
    // 开火：按住连发
    const f = this.els.fire;
    if (f) {
      f.addEventListener('touchstart', e => {
        e.preventDefault(); e.stopPropagation();
        if (Game.phase !== 'playing') return;
        PC.keys.add('Mouse0');
        this._triggerFire();
      }, { passive: false });
      const off = e => { PC.keys.delete('Mouse0'); if (e) e.preventDefault(); };
      f.addEventListener('touchend', off, { passive: false });
      f.addEventListener('touchcancel', off, { passive: false });
    }
    // 瞄准：按住开镜
    const a = this.els.aim;
    if (a) {
      a.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); PC.keys.add('Mouse2'); this._sync(); }, { passive: false });
      const off = e => { PC.keys.delete('Mouse2'); if (e) e.preventDefault(); };
      a.addEventListener('touchend', off, { passive: false });
      a.addEventListener('touchcancel', off, { passive: false });
    }

    on(this.els.reload, () => { if (Game.phase === 'playing') PlayerGun.reload(); });
    on(this.els.jump, () => {
      if (Game.phase !== 'playing') return;
      PC.keys.add('Space');
      setTimeout(() => PC.keys.delete('Space'), 90);
    });
    on(this.els.interact, () => {
      if (Game.phase !== 'playing') return;
      // 复用 E 键既有优先级：救援 > Mechanics > 搜刮
      document.dispatchEvent(new KeyboardEvent('keydown', { code: Settings.key('interact'), bubbles: true }));
    });
    on(this.els.item, () => {
      if (Game.phase !== 'playing') return;
      const c = PlayerGun.cur;
      if (c === 'medkit') PlayerGun.useMedkit();
      else if (c === 'armorkit') PlayerGun.useArmorkit();
      else if (c === 'smoke') PlayerGun.throwSmoke();
      else PlayerGun.throwGrenade();
    });
  },

  /* ---------- 横竖屏 ---------- */
  _bindOrientation() {
    const check = () => {
      const portrait = (window.innerHeight > window.innerWidth);
      if (this.els.rotate) this.els.rotate.style.display = portrait ? 'flex' : 'none';
      const cls = (document.body && document.body.classList) ? document.body.classList : null;
      if (cls) cls.toggle('touch-portrait', portrait);
    };
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    check();
  },

  isActive() { return this.active; }
};

window.TouchUI = TouchUI;
