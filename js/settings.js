/* ============================================
 * 战地突击 · settings.js —— 设置系统（performance）
 * 按键绑定 / 音量 / 鼠标灵敏度，localStorage 持久化
 * 依赖（运行时）：AudioFX.setVol / PC.sens / Game.phase
 * 注意：必须在 combat.js 之前加载（combat 按键走绑定表）
 * ============================================ */
const Settings = (() => {
  const KEY = 'battleground.settings';
  const DEFAULT_KEYS = {
    moveF: 'KeyW', moveB: 'KeyS', moveL: 'KeyA', moveR: 'KeyD',
    jump: 'Space', sprint: 'ShiftLeft', prone: 'ControlLeft',
    leanLeft: 'Comma', leanRight: 'Period', // 侧身：, 向左倾 / . 向右倾
    reload: 'KeyR', interact: 'KeyE', discard: 'KeyQ', melee: 'KeyF',
    grenade: 'KeyG', smoke: 'KeyH', mortar: 'KeyM', inventory: 'KeyB',
    slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4',
    slot5: 'Digit5', slot6: 'Digit6', slot7: 'Digit7', slot8: 'Digit8',
    cmdGroup: 'KeyZ', cmdFree: 'KeyX', cmdAttack: 'KeyC', cmdDefend: 'KeyV',
    scoreboard: 'Tab'
  };
  // UI 展示顺序（即绑定列表顺序）
  const ACTIONS = [
    'moveF', 'moveB', 'moveL', 'moveR', 'jump', 'sprint', 'prone',
    'leanLeft', 'leanRight',
    'reload', 'interact', 'discard', 'melee', 'grenade', 'smoke', 'mortar', 'inventory',
    'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'slot7', 'slot8',
    'cmdGroup', 'cmdFree', 'cmdAttack', 'cmdDefend', 'scoreboard'
  ];
  const ACTION_NAMES = {
    moveF: '前进', moveB: '后退', moveL: '左移', moveR: '右移',
    jump: '跳跃', sprint: '疾跑', prone: '潜伏',
    leanLeft: '向左侧身', leanRight: '向右侧身',
    reload: '换弹', interact: '交互 / 救援', discard: '丢弃武器', melee: '近战 / 刺刀',
    grenade: '投掷手雷', smoke: '投掷烟雾', mortar: '迫击炮', inventory: '背包（仓库）',
    slot1: '槽位1 · 手枪', slot2: '槽位2 · 步枪', slot3: '槽位3 · 狙击', slot4: '槽位4 · 霰弹',
    slot5: '槽位5 · 医疗包', slot6: '槽位6 · 护甲包', slot7: '槽位7 · 手雷', slot8: '槽位8 · 烟雾',
    cmdGroup: '对讲机 · 集合', cmdFree: '对讲机 · 自由', cmdAttack: '对讲机 · 进攻', cmdDefend: '对讲机 · 防守',
    scoreboard: '记分板'
  };
  const CODE_LABELS = {
    Space: '空格', ShiftLeft: '左Shift', ShiftRight: '右Shift',
    ControlLeft: '左Ctrl', ControlRight: '右Ctrl', AltLeft: '左Alt', AltRight: '右Alt',
    Tab: 'Tab', CapsLock: 'CapsLock', Enter: '回车', Backspace: '退格', Delete: 'Del',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/'
  };

  let data = { keys: Object.assign({}, DEFAULT_KEYS), sens: 0.22, vol: 0.6 };
  let codeMap = null;   // code -> action 反查缓存（bind/load/reset 后失效）
  let listening = null; // 正在等待重绑的动作
  let _hidPause = false;

  const $ = id => document.getElementById(id);

  const load = () => {
    try {
      const j = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (j) {
        data.keys = Object.assign({}, DEFAULT_KEYS, j.keys || {});
        // v2.10 防倒置：typeof NaN === 'number' 会漏过 → 用 isFinite；损坏的 sens/vol 回退默认
        if (typeof j.sens === 'number' && Number.isFinite(j.sens)) data.sens = j.sens;
        if (typeof j.vol === 'number' && Number.isFinite(j.vol)) data.vol = j.vol;
      }
    } catch (e) { /* 存储损坏 → 保持默认 */ }
    codeMap = null;
  };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { } };

  const key = a => (data.keys[a] != null ? data.keys[a] : DEFAULT_KEYS[a]);
  const actionByCode = code => {
    if (!codeMap) {
      codeMap = {};
      for (const a in data.keys) codeMap[data.keys[a]] = a;
    }
    return codeMap[code] || null;
  };
  const codeLabel = c => {
    if (CODE_LABELS[c]) return CODE_LABELS[c];
    const d = /^Digit(\d)$/.exec(c); if (d) return d[1];
    const k = /^Key([A-Z])$/.exec(c); if (k) return k[1];
    const f = /^F([1-9]|1[0-2])$/.exec(c); if (f) return c;
    return c;
  };
  const bind = (action, code) => {
    if (!(action in DEFAULT_KEYS)) return { ok: false, msg: '未知动作' };
    for (const a in data.keys) {
      if (a !== action && data.keys[a] === code)
        return { ok: false, msg: '该键已被「' + ACTION_NAMES[a] + '」占用' };
    }
    data.keys[action] = code;
    codeMap = null; save();
    return { ok: true };
  };
  const resetKeys = () => { data.keys = Object.assign({}, DEFAULT_KEYS); codeMap = null; save(); };

  const toast = msg => { if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg); };

  /* ---------- 设置面板 UI ---------- */
  const renderKeys = () => {
    const wrap = $('setKeyList'); if (!wrap) return;
    wrap.innerHTML = ACTIONS.map(a =>
      '<div class="setKeyRow"><span class="nm">' + ACTION_NAMES[a] + '</span>' +
      '<button type="button" class="setKeyBtn" data-action="' + a + '">' + codeLabel(key(a)) + '</button></div>'
    ).join('');
  };
  const cancelListen = () => {
    listening = null;
    const b = document.querySelector('.setKeyBtn.listening');
    if (b && b.dataset.action) { b.classList.remove('listening'); b.textContent = codeLabel(key(b.dataset.action)); }
  };
  const flash = msg => {
    const b = document.querySelector('.setKeyBtn.listening'); if (!b) return;
    const prev = b.dataset.action ? codeLabel(key(b.dataset.action)) : '';
    b.textContent = msg;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { if (b && !b.classList.contains('listening')) b.textContent = prev; }, 900);
  };
  const syncInputs = () => {
    const s = $('setSens');
    if (s) { s.value = data.sens; const sv = $('setSensVal'); if (sv) sv.textContent = data.sens.toFixed(2); }
    const v = $('setVol');
    if (v) { v.value = data.vol; const vv = $('setVolVal'); if (vv) vv.textContent = Math.round(data.vol * 100) + '%'; }
  };
  const open = () => {
    const p = $('settings'); if (!p) return;
    p.style.display = 'flex';
    syncInputs(); renderKeys();
    // 对局中打开：隐藏暂停面板，关闭时视锁定状态恢复
    if (typeof Game !== 'undefined' && Game.phase === 'playing') {
      _hidPause = true;
      const pp = $('paused'); if (pp) pp.style.display = 'none';
    }
  };
  const close = () => {
    const p = $('settings'); if (!p) return;
    p.style.display = 'none';
    cancelListen();
    if (_hidPause) {
      _hidPause = false;
      if (typeof Game !== 'undefined' && Game.phase === 'playing' && !document.pointerLockElement) {
        const pp = $('paused'); if (pp) pp.style.display = 'flex';
      }
    }
  };
  const isOpen = () => { const p = $('settings'); return !!(p && p.style.display === 'flex'); };
  const applyToGame = () => {
    if (typeof PC !== 'undefined' && Number.isFinite(data.sens)) PC.sens = data.sens; // v2.10 防倒置
    if (typeof AudioFX !== 'undefined') AudioFX.setVol(data.vol);
  };

  const initUI = () => {
    const p = $('settings'); if (!p) return;
    const s = $('setSens'), v = $('setVol');
    if (s) s.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      data.sens = Number.isFinite(v) ? v : 0.22; // v2.10 防倒置：非有限输入回退默认（NaN sens → 相机永久翻转）
      if (typeof PC !== 'undefined') PC.sens = data.sens;
      const sv = $('setSensVal'); if (sv) sv.textContent = data.sens.toFixed(2);
      save();
    });
    if (v) v.addEventListener('input', e => {
      data.vol = parseFloat(e.target.value);
      if (typeof AudioFX !== 'undefined') AudioFX.setVol(data.vol);
      const vv = $('setVolVal'); if (vv) vv.textContent = Math.round(data.vol * 100) + '%';
      save();
    });
    const list = $('setKeyList');
    if (list) list.addEventListener('click', e => {
      const btn = e.target.closest ? e.target.closest('.setKeyBtn') : null;
      if (!btn || !btn.dataset.action) return;
      const action = btn.dataset.action;
      if (listening === action) { cancelListen(); return; } // 再点一次取消
      cancelListen();
      listening = action;
      btn.classList.add('listening');
      btn.textContent = '按下新键…(Esc 取消)';
    });
    const resetBtn = $('setReset');
    if (resetBtn) resetBtn.addEventListener('click', () => { resetKeys(); renderKeys(); toast('已恢复默认按键'); });
    const closeBtn = $('setClose');
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (p) p.addEventListener('click', e => { if (e.target === p) close(); }); // 点遮罩关闭
  };

  /* 重绑捕获监听器：设置面板内等待按键时拦截，避免触发游戏内按键逻辑 */
  document.addEventListener('keydown', e => {
    if (!listening) return;
    e.preventDefault(); e.stopPropagation();
    const code = e.code;
    if (code === 'Escape') { cancelListen(); return; }
    if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(code)) { flash('修饰键需与主键组合'); return; }
    const r = bind(listening, code);
    if (!r.ok) { flash(r.msg); return; }
    const done = listening;
    cancelListen(); renderKeys();
    toast('「' + ACTION_NAMES[done] + '」已绑定 ' + codeLabel(code));
  }, true);

  load();
  initUI();
  return {
    key, actionByCode, codeLabel, bind, resetKeys,
    open, close, isOpen, applyToGame,
    get sens() { return data.sens; },
    get vol() { return data.vol; },
    _data: data,
    _defaults: DEFAULT_KEYS,
    _names: ACTION_NAMES
  };
})();
