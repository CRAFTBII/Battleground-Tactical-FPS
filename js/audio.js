/* ============================================
 * 战地突击 · audio.js（WebAudio 程序化合成，无外部文件）
 * v2.0 真实感重写：
 *  - 3D 空间定位（HRTF PannerNode + 距离衰减 + 空气吸收低通）
 *  - 共享卷积混响（远近干湿比例自适应，消除干瘪感）
 *  - 多层枪声（瞬态爆裂 crack + 低频冲击 thump + 机械声 mech + 空间尾音）
 *  - 真实爆炸（冲击波 + 宽频爆响 + 亚低频隆隆 + 建筑反射回声）
 *  - 多段换弹、材质感脚步、弹壳落地金属声
 * 所有公共方法保持旧签名，可选第二参数 pos（THREE.Vector3 / {x,y,z}）→ 空间定位播放
 * ============================================ */
const AudioFX = {
  ctx: null, master: null, comp: null, vol: 0.85,
  _reverb: null, _noiseCache: null, _samples: new Set(), // 活跃样本（<audio>）追踪：退出对局时一并停

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.vol;
    // 响度压缩器：把瞬态响度顶到游戏标准水平（"响而不破"，模拟真实枪战音效的响度感知）
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; // 放宽：让重削波能量更多透出（用户偏好"炸"）
    this.comp.knee.value = 4;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.22;
    this.master.connect(this.comp);
    this.comp.connect(this.ctx.destination);
    // 全局共享卷积混响：指数衰减噪声 IR（1.2s，左右声道差异化 → 空间感）
    try {
      const c = this.ctx.createConvolver();
      const ir = this.ctx.createBuffer(2, Math.floor(this.ctx.sampleRate * 1.2), this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < d.length; i++) {
          const t = i / d.length;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) * (ch ? 0.85 : 1);
        }
      }
      c.buffer = ir;
      const bus = this.ctx.createGain();
      bus.gain.value = 1;
      c.connect(bus);
      bus.connect(this.master);
      this._reverb = c;
    } catch (e) { this._reverb = null; }
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setVol(v) { this.vol = v; if (this.master) this.master.gain.value = v; },
  get _t() { return this.ctx ? this.ctx.currentTime : 0; },
  // 缓存噪声缓冲（0.5s），复用避免每次射击新建大数组
  noise(dur) {
    const need = this.ctx.sampleRate * dur;
    if (!this._noiseCache || this._noiseCache.length < need) {
      const n = this.ctx.sampleRate * 0.5, buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      this._noiseCache = buf;
    }
    return this._noiseCache;
  },
  /* ---- 监听器跟随玩家：每帧调用，空间音效以玩家为参考点 ---- */
  setListener(pos) {
    if (!this.ctx || !pos) return;
    const L = this.ctx.listener;
    if (!L) return;
    const x = +pos.x, y = (+pos.y || 0) + 1.6, z = +pos.z; // 强制转数字（防 NaN 触发 AudioParam 报错）
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    try {
      if (L.positionX && L.positionX.value !== undefined) {
        L.positionX.value = x; L.positionY.value = y; L.positionZ.value = z;
      } else if (L.setPosition) L.setPosition(x, y, z);
    } catch (e) { /* 忽略监听器兼容性异常 */ }
  },
  /* ---- 距离（到玩家） ---- */
  _dist(pos) {
    const P = (typeof Game !== 'undefined' && Game.player) ? Game.player.pos : null;
    if (!P) return 0;
    return Math.sqrt((P.x - pos.x) * (P.x - pos.x) + (P.z - pos.z) * (P.z - pos.z));
  },
  /* ---- 空间声源链：panner(HRTF) → lowpass(空气吸收) → dry → master，另送混响湿路 ---- */
  _spatial(pos, o) {
    const x = +pos.x, y = +(pos.y || 1), z = +pos.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null; // 防御 NaN
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref || 3;
    p.maxDistance = o.max || 220;
    p.rolloffFactor = o.rolloff || 1.1;
    try {
      if (p.positionX && p.positionX.value !== undefined) {
        p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
      } else if (p.setPosition) p.setPosition(x, y, z);
    } catch (e) { /* HRTF 需在线程环境，失败静默 */ }
    const d = this._dist(pos);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(450, 20000 - d * 120); // 越远高频越被空气吸收 → 远处枪声发闷
    const g = this.ctx.createGain();
    g.gain.value = 1.9; // 合成补偿增益：程序化信号天然偏小，统一顶上去（压缩器兜底防破音）
    p.connect(lp); lp.connect(g); g.connect(this.master);
    if (this._reverb) { // 混响湿路：近处少、远处环境感更强
      const wet = this.ctx.createGain();
      wet.gain.value = o.wet !== undefined ? o.wet : Math.min(0.38, 0.06 + d * 0.0022);
      g.connect(wet); wet.connect(this._reverb);
    }
    return g;
  },
  /* ---- 近场链（玩家自身声音：更饱满，少量混响） ---- */
  _local(o) {
    const g = this.ctx.createGain();
    g.gain.value = 1.9; // 合成补偿增益（同 _spatial）
    g.connect(this.master);
    if (this._reverb) {
      const wet = this.ctx.createGain();
      wet.gain.value = (o && o.wet !== undefined) ? o.wet : 0.12;
      g.connect(wet); wet.connect(this._reverb);
    }
    return g;
  },
  /* ---- 输出路由：有 pos → 空间，否则近场 ---- */
  _route(node, o) {
    if (!this.ctx) return;
    const s = o.pos ? this._spatial(o.pos, o) : this._local(o);
    if (s) node.connect(s); // _spatial 返回 null 时跳过（位置非法，防崩溃）
  },
  /* ---- 增益包络（快起 → 峰值保持 → 指数衰减；hold 可覆盖 → 高能量"炸"感） ---- */
  _env(t, dur, peak, attack, hold) {
    const g = this.ctx.createGain();
    const a = attack || 0.002;
    const h = hold !== undefined ? hold : Math.min(0.045, (dur || 0.1) * 0.3); // 峰值保持 ~30% 时长
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.setValueAtTime(Math.max(0.0002, peak), t + a + h);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  },
  /* ---- 瞬态爆裂：噪声 + 滤波 + 极短包络（枪声"啪"的主成分 / 爆炸宽频爆响） ---- */
  _crack(o) {
    const t = o.t === undefined ? this._t : o.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise((o.dur || 0.1) + 0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = o.type || 'highpass';
    f.frequency.value = o.f0 || 1500;
    f.Q.value = o.q !== undefined ? o.q : 0.5;
    if (o.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(o.f1, t + (o.dur || 0.1));
    const g = this._env(t, o.dur || 0.1, o.gain || 0.3, 0.002, o.hold);
    src.connect(f); f.connect(g);
    this._route(g, o);
    src.start(t); src.stop(t + (o.dur || 0.1) + 0.1);
  },
  /* ---- 低频冲击：正弦下滑（胸腔/耳膜震感，枪声力度来源） ---- */
  _thump(o) {
    const t = o.t === undefined ? this._t : o.t;
    const os = this.ctx.createOscillator();
    os.type = 'sine';
    os.frequency.setValueAtTime(o.f0 || 120, t);
    os.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 || 60), t + (o.dur || 0.1));
    const g = this._env(t, o.dur || 0.1, o.gain || 0.4, 0.002, o.hold);
    os.connect(g);
    this._route(g, o);
    os.start(t); os.stop(t + (o.dur || 0.1) + 0.05);
  },
  /* ---- 机械声：窄带噪声咔哒（枪机/弹匣/拉栓） ---- */
  _mech(o) {
    const t = o.t === undefined ? this._t : o.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(0.1);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = o.f || 1800;
    f.Q.value = o.q !== undefined ? o.q : 8;
    const g = this._env(t, o.dur || 0.04, o.gain || 0.15, 0.001);
    src.connect(f); f.connect(g);
    this._route(g, o);
    src.start(t); src.stop(t + 0.12);
  },
  /* ---- 空间尾音：低通噪声送混响（远处枪声的氛围、爆炸余响） ---- */
  _tail(o) {
    if (!this._reverb) return;
    const t = o.t === undefined ? this._t : o.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(o.dur || 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.f || 800;
    const g = this._env(t, o.dur || 0.5, o.gain || 0.12, 0.01);
    src.connect(f); f.connect(g);
    this._route(g, o);
    src.start(t); src.stop(t + (o.dur || 0.5) + 0.1);
  },
  /* ---- 单次延迟反射（建筑回声：whump 重复） ---- */
  _echo(o) {
    const t = o.t === undefined ? this._t : o.t;
    const dl = o.delay || 0.28;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(o.dur || 0.4);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.f || 280;
    const g = this._env(t + dl, o.dur || 0.4, o.gain || 0.12, 0.005);
    src.connect(f); f.connect(g);
    this._route(g, o);
    src.start(t + dl); src.stop(t + dl + (o.dur || 0.4) + 0.1);
  },

  /* ---------- 枪声（近场=玩家自己，pos=远处 AI/联机） ---------- */
  shot(w, pos, opts) {
    if (!this.ctx) return;
    const t = this._t;
    const near = !pos;
    const pitch = U.rand(0.965, 1.04);   // 每次开火随机微调 → 消除机械重复感
    const loud = (near ? 2.0 : 1.2) * ((opts && opts.loud) || 1); // 近场响度基准（压缩器兜底防破音）
    const p = pos ? { x: pos.x, y: (pos.y || 1.2), z: pos.z } : null;
    const O = (o) => { const q = Object.assign({ t, pos: p }, o); return q; };
    if (w === 'pistol') {
      // 程序化手枪（真实样本已撤，响度保持下调后水平）
      this._crack(O({ dur: 0.016, f0: 5200, gain: 0.22 * loud }));                         // 膛口瞬态
      this._crack(O({ dur: 0.07, type: 'bandpass', f0: 1100, q: 0.7, gain: 0.35 * loud })); // 主体爆响
      this._crack(O({ dur: 0.09, type: 'lowpass', f0: 480, gain: 0.32 * loud }));            // 低频爆音主体
      this._thump(O({ f0: 145 * pitch, f1: 80, dur: 0.12, gain: 0.3 * loud }));
      this._mech(O({ f: 2400, q: 10, dur: 0.03, gain: 0.14, t: t + 0.05 })); // 滑套复进
    } else if (w === 'rifle') {
      // AK 风格：低沉响亮——增益拉满 + 峰值保持加长（能量密度追上真实录音）+ 持续低频轰鸣
      this._crack(O({ dur: 0.022, f0: 3200, gain: 0.42 * loud }));                     // 膛口瞬态
      this._crack(O({ dur: 0.12, type: 'bandpass', f0: 850, q: 0.7, gain: 5, hold: 0.07 }));  // 主体爆响（保持加长→更炸）
      this._crack(O({ dur: 0.3, type: 'lowpass', f0: 320, gain: 5.75, hold: 0.1 }));    // 低频轰鸣（拉长）
      this._crack(O({ dur: 0.42, type: 'lowpass', f0: 210, gain: 2.2, hold: 0.14 }));   // 持续低频轰鸣（每发余"轰"）
      this._thump(O({ f0: 92 * pitch, f1: 45, dur: 0.3, gain: 6.0, hold: 0.09 }));      // 低频冲击
      this._mech(O({ f: 1900, q: 7, dur: 0.04, gain: 0.3 * loud, t: t + 0.05 }));       // 枪机复进
    } else if (w === 'sniper') {
      // 爆炸级狙击：超级大——增益拉满 + 峰值保持 + 持续低频轰鸣（与步枪同级极限）
      this._crack(O({ dur: 0.03, f0: 3200, gain: 0.4 * loud }));                              // 膛口瞬态
      this._crack(O({ dur: 0.18, type: 'bandpass', f0: 780, q: 0.6, gain: 8.5, hold: 0.08 })); // 主体爆响（用户指定 8.5）
      this._crack(O({ dur: 0.3, type: 'lowpass', f0: 320, gain: 14.0, hold: 0.1 }));            // 低频轰鸣（用户指定 14.0）
      this._crack(O({ dur: 0.4, type: 'lowpass', f0: 200, gain: 2.0, hold: 0.12 }));           // 持续低频轰鸣（每发余"轰"）
      this._thump(O({ f0: 88 * pitch, f1: 36, dur: 0.42, gain: 10.0, hold: 0.09 }));           // 身体震感（用户指定 10.0）
      this._thump(O({ f0: 42, f1: 20, dur: 0.55, gain: 0.5 * loud }));                         // 亚低频空气震荡（爆炸感）
      this._tail(O({ dur: 1.0, f: 480, gain: 0.4 * loud }));                                   // 长空间尾音
      this._echo(O({ dur: 0.5, f: 210, gain: 0.2 * loud, delay: 0.22 }));                      // 一级回荡
      this._echo(O({ dur: 0.45, f: 150, gain: 0.12 * loud, delay: 0.5 }));                     // 二级回荡
      this._mech(O({ f: 1600, q: 5, dur: 0.09, gain: 0.24, t: t + 0.12 }));                    // 拉栓
    } else if (w === 'shotgun') {
      // 程序化霰弹：超级大——增益拉满 + 峰值保持 + 持续低频轰鸣（全枪最"轰"）
      this._crack(O({ dur: 0.035, f0: 2600, gain: 0.4 * loud }));                              // 膛口瞬态
      this._crack(O({ dur: 0.22, type: 'bandpass', f0: 480, q: 0.6, gain: 5.0, hold: 0.08 })); // 闷厚主体
      this._crack(O({ dur: 0.26, type: 'lowpass', f0: 260, gain: 4.5, hold: 0.1 }));           // 低频爆音主体
      this._crack(O({ dur: 0.45, type: 'lowpass', f0: 220, gain: 2.2, hold: 0.13 }));          // 持续低频轰鸣
      this._thump(O({ f0: 82 * pitch, f1: 34, dur: 0.42, gain: 5.5, hold: 0.1 }));             // 重击冲击
      this._tail(O({ dur: 0.45, f: 750, gain: 0.3 * loud }));
    } else if (w === 'melee') {
      this._crack(O({ dur: 0.12, f0: 700, gain: 0.2 }));                    // 挥击风声
      this._thump(O({ f0: 200, f1: 90, dur: 0.1, gain: 0.24 }));
    }
  },
  /* ---------- 换弹：真实换弹录音（reloading-weapons.mp3），程序化 3 段式降为兜底 ---------- */
  reload() {
    if (!this.ctx) return;
    this.playSample('reload', { gain: 0.7 });
    // 兜底：样本加载失败（罕见）时仍有程序化换弹声
    const t = this._t;
    this._mech({ t, f: 1250, q: 12, dur: 0.03, gain: 0.05 });        // 退弹匣（极轻，防与样本重叠）
    this._mech({ t: t + 0.26, f: 1700, q: 9, dur: 0.05, gain: 0.05 }); // 插新匣
  },
  /* ---------- 爆炸（pos 可选；真实爆炸录音打底 + 程序化低频增强；远距离自动衰减 + 空气吸收 + 回声） ---------- */
  explosion(pos, opts) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1), z: pos.z } : null;
    const d = p ? this._dist(p) : 0;
    const scale = Math.max(0.3, 1 - d / 300); // 极远爆炸整体压音（panner 已衰减，此处再收敛）
    const O = (o) => Object.assign({ t, pos: p }, o);
    this.playSample('boom', { gain: 0.75, skip: 0.2, pos: p || undefined });              // 真实爆炸录音（跳 0.2s 前导静音）
    this._thump(O({ f0: 58, f1: 26, dur: 0.6, gain: 0.5 * scale }));                     // 冲击波（样本已含，程序化降为增强）
    this._crack(O({ dur: 0.85, type: 'lowpass', f0: 900, f1: 70, gain: 0.4 * scale }));  // 宽频爆响
    this._thump(O({ f0: 32, f1: 22, dur: 1.3, gain: 0.45 * scale }));                    // 亚低频隆隆
    this._tail(O({ dur: 1.1, f: 500, gain: 0.3 * scale }));                              // 混响余响
    if (d < 140 && p) this._echo(O({ dur: 0.5, f: 260, gain: 0.15 * scale }));           // 建筑反射
  },
  /* ---------- 烟雾弹：高压气体嘶声 ---------- */
  smoke(pos) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1), z: pos.z } : null;
    this._crack({ t, pos: p, dur: 0.55, type: 'bandpass', f0: 2600, q: 0.6, gain: 0.13 });
  },
  /* ---------- 命中反馈：身体闷响（玩家自己命中 → 近场） ---------- */
  hit(pos) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1.2), z: pos.z } : null;
    this._thump({ t, pos: p, f0: 150, f1: 85, dur: 0.07, gain: 0.22 });
    this._crack({ t, pos: p, dur: 0.05, f0: 600, gain: 0.12 });
  },
  /* ---------- 击杀确认音 ---------- */
  /* ---------- 击杀确认音：低沉"吧唧"闷响（中低频噪声主体 + 低频冲击，补偿链响亮，不刺耳） ---------- */
  kill() {
    if (!this.ctx) return;
    const t = this._t;
    this._crack({ t, dur: 0.09, type: 'bandpass', f0: 500, q: 0.8, gain: 0.4 });   // "吧唧"主体（中低频噪声）
    this._thump({ t, f0: 150, f1: 70, dur: 0.12, gain: 0.5 });                      // 低频闷响（身体感）
    this._crack({ t: t + 0.04, dur: 0.06, f0: 1200, gain: 0.18 });                  // 短促点缀（与枪声区分）
  },
  /* ---------- 爆头击杀：低沉但略亮的"吧唧"（更高一档闷响） ---------- */
  killHead() {
    if (!this.ctx) return;
    const t = this._t;
    this._crack({ t, dur: 0.09, type: 'bandpass', f0: 700, q: 0.8, gain: 0.45 });
    this._thump({ t, f0: 180, f1: 80, dur: 0.14, gain: 0.55 });
    this._crack({ t: t + 0.05, dur: 0.06, f0: 1600, gain: 0.2 });
  },
  /* ---------- 脚步声：近无声的连续沙沙（单步 0.45s + 错位层 → 无缝摩擦感）；pos 走空间定位（AI 脚步） ---------- */
  foot(pos) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 0) + 0.2, z: pos.z } : null;
    const v = U.rand(0.9, 1.12);
    this._crack({ t, pos: p, dur: 0.45, type: 'bandpass', f0: 1900 * v, q: 0.45, gain: 0.008 });  // 连续沙沙主体（更长更轻）
    this._crack({ t: t + 0.12, pos: p, dur: 0.34, f0: 2800, gain: 0.005 });                       // 错位细碎叠加 → 无缝
  },
  /* ---------- 弹壳落地：宽带噪声金属"嗒"（纯噪声瞬态，无纯音振荡器 → 杜绝鸟鸣） ---------- */
  casing() {
    if (!this.ctx) return;
    const t = this._t + U.rand(0.08, 0.2);                            // 落地时机随机
    this._crack({ t, dur: 0.035, f0: 3200, gain: 0.05 });             // 高频撞击"嗒"
    this._crack({ t: t + 0.02, dur: 0.03, type: 'bandpass', f0: 6200, q: 3, gain: 0.026 }); // 金属亮感（噪声，非纯音）
    const t2 = t + U.rand(0.18, 0.4);                                 // 滚动弹跳（间隔随机）
    this._crack({ t: t2, dur: 0.03, f0: 2600, gain: 0.03 });
  },
  /* ---------- 通用合成音（UI / 提示） ---------- */
  tone(o) {
    if (!this.ctx) return;
    const t = o.t === undefined ? this._t : o.t;
    const os = this.ctx.createOscillator();
    os.type = o.type || 'square';
    os.frequency.setValueAtTime(o.f0 || 800, t);
    if (o.f1) os.frequency.exponentialRampToValueAtTime(o.f1, t + (o.dur || 0.1));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(o.gain || 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (o.dur || 0.1));
    os.connect(g).connect(this.master);
    os.start(t); os.stop(t + (o.dur || 0.1) + 0.02);
  },
  playNoise(o) {
    if (!this.ctx) return;
    const t = this._t, src = this.ctx.createBufferSource();
    src.buffer = this.noise(o.dur || 0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f0 || 2000, t);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(o.gain || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (o.dur || 0.2));
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  },
  ping() { this.tone({ f0: 1500, f1: 1000, dur: 0.09, gain: 0.22, type: 'sine' }); },
  /* 炮击预警：三连下行警报 + 警示"咚" */
  incoming() {
    if (!this.ctx) return;
    const t = this._t;
    for (let i = 0; i < 3; i++) {
      this.tone({ f0: 950, f1: 520, dur: 0.16, gain: 0.2, type: 'sawtooth', t: t + i * 0.22 });
    }
    this._thump({ t: t + 0.72, f0: 130, f1: 60, dur: 0.2, gain: 0.28 });
  },
  ui() { this.tone({ f0: 1000, f1: 1400, dur: 0.06, gain: 0.15, type: 'triangle' }); },
  radio() { // 对讲机咔哒声：双短音
    const t = this;
    t.tone({ f0: 1800, f1: 1400, dur: 0.045, gain: 0.18, type: 'square' });
    setTimeout(() => t.tone({ f0: 1400, f1: 1000, dur: 0.05, gain: 0.15, type: 'square' }), 80);
  },
  /* 迫击炮发射：闷响 + 出膛哨音 */
  mortar(pos) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1.2), z: pos.z } : null;
    this._thump({ t, pos: p, f0: 90, f1: 45, dur: 0.25, gain: 0.4 });
    this._crack({ t, pos: p, dur: 0.15, f0: 400, gain: 0.25 });
    this.tone({ f0: 320, f1: 900, dur: 0.35, gain: 0.12, type: 'sine', t: t + 0.03 });
  },
  /* 医疗包使用：柔和上行提示 */
  heal() {
    if (!this.ctx) return;
    const t = this._t;
    this.tone({ f0: 520, f1: 880, dur: 0.12, gain: 0.14, type: 'sine', t });
    this.tone({ f0: 660, f1: 1100, dur: 0.14, gain: 0.1, type: 'sine', t: t + 0.1 });
  },
  /* ---------- 子弹呼啸（near-miss）：敌方子弹擦过耳边，音量随距离反比 ---------- */
  nearMiss(pos, missDist) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1.2), z: pos.z } : null;
    const v = U.rand(0.92, 1.1);
    const g = Math.max(0.08, Math.min(0.32, 0.34 * (1 - missDist / 2.4)));
    // 嗖：窄带噪声高频→低频快速下滑（弹道经过的位移感）
    this._crack({ t, pos: p, dur: 0.15, type: 'bandpass', f0: 3000 * v, f1: 480, q: 1.1, gain: g });
    // 极近：超音速音爆"噼"
    if (missDist < 0.9) this._crack({ t, pos: p, dur: 0.025, f0: 5400, gain: 0.2 });
  },
  /* ---------- 命中世界/墙面：短促撞击 + 碎屑 ---------- */
  impact(pos) {
    if (!this.ctx) return;
    const t = this._t;
    const p = pos ? { x: pos.x, y: (pos.y || 1), z: pos.z } : null;
    this._thump({ t, pos: p, f0: 260 * U.rand(0.9, 1.1), f1: 90, dur: 0.06, gain: 0.15 });
    this._crack({ t, pos: p, dur: 0.05, f0: 950, gain: 0.1 });
    if (Math.random() < 0.35) this._crack({ t: t + 0.02, pos: p, dur: 0.025, f0: 1800, gain: 0.02 }); // 偶发碎片（噪声）
  },
  /* ---------- 玩家受击反馈：中弹闷响 + 耳鸣 ---------- */
  dmg() {
    if (!this.ctx) return;
    const t = this._t;
    this._thump({ t, f0: 120, f1: 55, dur: 0.09, gain: 0.3 });
    this._crack({ t, dur: 0.05, f0: 1500, gain: 0.16 });
    this._crack({ t: t + 0.04, dur: 0.05, type: 'bandpass', f0: 2600, q: 2, gain: 0.03 }); // 耳鸣感（噪声化，无"叽"声）
  },
  /* ---------- 战场环境底噪：仅风声（不播假交火，避免干扰玩家对真实敌情的判断） ---------- */
  _amb: null,
  startAmbience() {
    if (!this.ctx || this._amb) return;
    const t = this._t;
    // 风：2s 循环噪声 → 低通 260Hz，LFO 缓慢起伏
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise(2); src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 260;
    const g = this.ctx.createGain();
    g.gain.value = 0.055;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13; lfo.type = 'sine';
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.026;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); lfo.start(t);
    this._amb = { src, lfo, g };
  },
  stopAmbience() {
    if (!this._amb) return;
    const a = this._amb;
    try { a.src.stop(); a.lfo.stop(); } catch (e) { /* 已停止 */ }
    if (a.src.disconnect) a.src.disconnect();
    if (a.lfo.disconnect) a.lfo.disconnect();
    this._amb = null;
  },
  /* 停止所有正在播放的样本（退出对局用）：长样本（防空警报等）未播完也立即静音 */
  stopSamples() {
    for (const a of this._samples) { try { a.pause(); } catch (e) { /* 已结束 */ } }
    this._samples.clear();
  },
  /* ---------- 真实声音样本（sounds/ 目录，file:// 离线兼容：<audio> 元素 + MediaElementSource 接入 WebAudio） ---------- */
  SFX: {
    boom:  'sounds/Explosion-Noise-chosic.com_.mp3',
    reload: 'sounds/reloading-weapons.mp3',
    alarm:  'sounds/war-alarm-sound-long.mp3'
  },
  /* 播放样本：
   *  o.pos      空间定位（Panner 距离衰减）
   *  o.gain     音量（0-1）
   *  o.skip     跳过前导静音秒数（如沙鹰开头 0.2s 空白）
   *  o.stopAt   播放到该秒数后截断（长样本当短音用）
   *  o.loop     循环 */
  playSample(name, o) {
    if (!this.ctx) return;
    o = o || {};
    const url = this.SFX[name];
    if (!url) return;
    let a;
    try { a = new Audio(url); } catch (e) { return; } // 无 Audio 环境（Node 桩）静默
    this._samples.add(a); // 登记活跃样本，退出对局时 stopSamples() 可立即停
    a.volume = o.gain !== undefined ? o.gain : 0.8;
    a.loop = !!o.loop;
    let src = null;
    if (o.pos) {
      try {
        src = this.ctx.createMediaElementSource(a);
        const p = this.ctx.createPanner();
        p.panningModel = 'HRTF';
        p.distanceModel = 'inverse';
        p.refDistance = o.ref || 3;
        p.maxDistance = o.max || 220;
        p.rolloffFactor = 1.1;
        const x = +o.pos.x, y = +(o.pos.y || 1), z = +o.pos.z;
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          if (p.positionX && p.positionX.value !== undefined) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; }
          else if (p.setPosition) p.setPosition(x, y, z);
        }
        src.connect(p); p.connect(this.master);
      } catch (e) { src = null; }
    }
    if (o.stopAt) {
      a.ontimeupdate = () => { if (a.currentTime >= o.stopAt) { try { a.pause(); } catch (e) {} } };
    }
    a.onended = () => { this._samples.delete(a); try { if (src && src.disconnect) src.disconnect(); } catch (e) {} };
    const start = () => {
      try { if (o.skip) a.currentTime = o.skip; } catch (e) { /* 跳转失败则从头播 */ }
      try { a.play().catch(() => {}); } catch (e) { /* 自动播放被拦截则静默 */ }
    };
    if (a.readyState >= 1) start(); // 已就绪立即播
    else a.addEventListener('canplay', start, { once: true }); // 等加载完（设好 skip 再播，无跳跃）
    try { a.load(); } catch (e) { /* 忽略 */ }
  }
};
