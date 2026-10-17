/* ============================================
 * 战地突击 · touch.js — 移动端触控操作层（零依赖）
 *
 * 背景：本游戏原本只支持键鼠 + Pointer Lock。移动端浏览器**不支持 Pointer Lock**，
 *   所以 requestPointerLock() 静默失败 → PC.locked 永远 false → 视角完全不响应。
 *
 * 方案：左半屏虚拟摇杆移动 + 右半屏拖动转视角 + 右侧动作按钮。
 *   不复制任何游戏逻辑：移动写 PC.touchMove，视角改 PC.yaw/PC.pitch，
 *   开火/换弹等直接调 PlayerGun / PC 的既有方法。
 *
 * 只在触控设备激活（PC.forceLocked = true 旁路 Pointer Lock）；
 * 桌面端完全不受影响（body 不带 touch-ui class，CSS 不显示本层）。
 *
 * 强制开启（桌面调试用）：URL 加 ?touch=1
 * ============================================ */

const TouchUI = {
  active: false,
  root: null,
  els: {},
  stick: { id: null, cx: 0, cy: 0, dx: 0, dy: 0, R: 56 },
  look: { id: null, lastX: 0, lastY: 0 },
  _bound: false,

  /* ---------- 设备判定 ---------- */
  enabled() {
    const q = (typeof location !== 'undefined' && location.search) || '';
    if (/[?&]touch=1/.test(q)) return true;      // 调试强制
    if (/[?&]touch=0/.test(q)) return false;     // 调试强制关闭
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const maxTouch = Number(nav.maxTouchPoints) || 0;
    const hasTouchEvent = (typeof window !== 'undefined') && ('ontouchstart' in window);
    // 触屏笔记本也会有触摸点，但通常有精细指针；用 coarse 主指针进一步确认
    const coarse = (typeof matchMedia === 'function') && matchMedia('(pointer: coarse)').matches;
    return (maxTouch > 0 && (hasTouchEvent || coarse)) || (hasTouchEvent && coarse);
  },

  init() {
    if (this._bound) return this;
    // 防御：无头测试/受限宿主里可能没有 document.body.classList，不能因此让整个游戏启动失败
    const cls = (document.body && document.body.classList) ? document.body.classList : null;
    this.active = this.enabled();
    if (cls) cls.toggle('touch-ui', this.active);
    if (!this.active) return this;

    this._buildDOM();
    this._bindStick();
    this._bindLook();
    this._bindButtons();
    this._bindOrientation();

    // 关键：绕开 Pointer Lock —— 触控下手动置位
    PC.forceLocked = true;
    this._bound = true;
    console.log('[TouchUI] 触控操作层已启用（左摇杆移动 / 右半屏转视角）');
    return this;
  },

  /* ---------- DOM ---------- */
  _buildDOM() {
    const root = document.createElement('div');
    root.id = 'touchLayer';
    root.innerHTML = [
      // 左下：虚拟摇杆
      '<div id="tStick"><div id="tKnob"></div></div>',
      // 右侧动作按钮
      '<div id="tBtns">',
      '  <button type="button" id="tFire" class="tbtn fire">开火</button>',
      '  <button type="button" id="tAim" class="tbtn">瞄准</button>',
      '  <button type="button" id="tReload" class="tbtn sm">换弹</button>',
      '  <button type="button" id="tJump" class="tbtn sm">跳</button>',
      '  <button type="button" id="tInteract" class="tbtn sm">交互</button>',
      '  <button type="button" id="tGrenade" class="tbtn sm">手雷</button>',
      '</div>',
      // 竖屏提示
      '<div id="tRotate"><div class="tRotateBox">🔄<div>请横屏游玩</div><div class="tRotateHint">旋转手机以获得最佳视野</div></div></div>'
    ].join('');
    document.body.appendChild(root);
    this.root = root;
    this.els = {
      stick: document.getElementById('tStick'),
      knob: document.getElementById('tKnob'),
      look: root,
      rotate: document.getElementById('tRotate'),
      btns: document.getElementById('tBtns')
    };
  },

  /* ---------- 左摇杆 ---------- */
  _bindStick() {
    const el = this.els.stick;
    const S = this.stick;
    const setKnob = (dx, dy) => {
      if (this.els.knob) this.els.knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    };
    const update = (t) => {
      let dx = t.clientX - S.cx, dy = t.clientY - S.cy;
      const len = Math.hypot(dx, dy);
      const R = S.R;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      S.dx = dx / R; S.dy = dy / R;
      setKnob(dx, dy);
      // 屏幕 y 向下 = 后退，所以要取反
      PC.touchMove = { f: -S.dy, s: S.dx };
      // 推满前向 = 疾跑（移动端没有单独的 Shift）
      PC.touchSprint = (-S.dy) > 0.85;
    };
    const start = e => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      if (S.id !== null) return;
      S.id = t.identifier;
      const r = el.getBoundingClientRect();
      S.cx = r.left + r.width / 2; S.cy = r.top + r.height / 2;
      // 摇杆允许以按下点为中心（手感更好），但限制在元素内
      S.cx = t.clientX; S.cy = t.clientY;
      update(t);
      e.preventDefault();
    };
    const move = e => {
      if (S.id === null) return;
      const list = e.changedTouches || [e];
      for (const t of list) if (t.identifier === S.id) { update(t); e.preventDefault(); return; }
    };
    const end = e => {
      if (S.id === null) return;
      const list = e.changedTouches || [e];
      for (const t of list) {
        if (t.identifier === S.id) {
          S.id = null; S.dx = 0; S.dy = 0;
          PC.touchMove = null; PC.touchSprint = false;
          setKnob(0, 0);
          e.preventDefault();
          return;
        }
      }
    };
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  },

  /* ---------- 右半屏转视角 ---------- */
  _bindLook() {
    const L = this.look;
    const SENS = 0.0042;                          // 触屏灵敏度（弧度/像素）
    const findFree = (list) => {
      for (const t of list) {
        // 摇杆和按钮自己处理，其余触摸都算视角
        if (t.target && t.target.closest && t.target.closest('#tStick, #tBtns')) continue;
        return t;
      }
      return null;
    };
    const start = e => {
      if (L.id !== null) return;
      const t = findFree(e.changedTouches || [e]);
      if (!t) return;
      L.id = t.identifier; L.lastX = t.clientX; L.lastY = t.clientY;
      e.preventDefault();
    };
    const move = e => {
      if (L.id === null) return;
      const list = e.changedTouches || [e];
      for (const t of list) {
        if (t.identifier !== L.id) continue;
        const dx = t.clientX - L.lastX, dy = t.clientY - L.lastY;
        L.lastX = t.clientX; L.lastY = t.clientY;
        // 直接改 PC 的朝向（与 mousemove 同一组状态）
        PC.yaw = PC.safeYaw(PC.yaw - dx * SENS);
        PC.pitch = Math.max(-1.45, Math.min(1.45, PC.pitch - dy * SENS));
        e.preventDefault();
        return;
      }
    };
    const end = e => {
      if (L.id === null) return;
      for (const t of (e.changedTouches || [e])) {
        if (t.identifier === L.id) { L.id = null; e.preventDefault(); return; }
      }
    };
    const el = this.root;
    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  },

  /* ---------- 动作按钮 ---------- */
  _bindButtons() {
    const fire = document.getElementById('tFire');
    const aim = document.getElementById('tAim');
    const idx = n => document.getElementById(n);

    // 开火：按住=连发（对应 Mouse0），松开停止
    const fireOn = e => {
      if (Game.phase !== 'playing') return;
      PC.keys.add('Mouse0');
      if (PlayerGun.cur === 'medkit') PlayerGun.useMedkit();
      else if (PlayerGun.cur === 'armorkit') PlayerGun.useArmorkit();
      else if (PlayerGun.cur === 'grenade') PlayerGun.throwGrenade();
      else if (PlayerGun.cur === 'smoke') PlayerGun.throwSmoke();
      else PlayerGun.tryFire(document.getElementById('c') && window.camera ? window.camera : undefined);
      e.preventDefault();
    };
    const fireOff = e => { PC.keys.delete('Mouse0'); e.preventDefault(); };
    fire.addEventListener('touchstart', fireOn, { passive: false });
    fire.addEventListener('touchend', fireOff, { passive: false });
    fire.addEventListener('touchcancel', fireOff, { passive: false });

    // 瞄准：按住 = Mouse2（开镜）
    aim.addEventListener('touchstart', e => { PC.keys.add('Mouse2'); e.preventDefault(); }, { passive: false });
    aim.addEventListener('touchend', e => { PC.keys.delete('Mouse2'); e.preventDefault(); }, { passive: false });

    const tap = (id, fn) => {
      const el = idx(id);
      if (!el) return;
      el.addEventListener('touchstart', e => { fn(); e.preventDefault(); }, { passive: false });
    };
    tap('tReload', () => PlayerGun.reload());
    tap('tJump', () => { PC.keys.add('Space'); setTimeout(() => PC.keys.delete('Space'), 90); });
    tap('tInteract', () => {
      // 复用 E 键的既有优先级逻辑：救援 > Mechanics > 搜刮
      document.dispatchEvent(new KeyboardEvent('keydown', { code: Settings.key('interact'), bubbles: true }));
    });
    tap('tGrenade', () => PlayerGun.throwGrenade());
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

  /** 供外部查询：触控层是否接管了输入 */
  isActive() { return this.active; }
};

window.TouchUI = TouchUI;
