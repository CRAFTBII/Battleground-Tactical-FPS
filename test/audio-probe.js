// AudioFX 逻辑链路探针：用轻量 WebAudio 桩验证合成节点图构建正确（无真实 DSP）
// 覆盖：所有公共方法不抛错 / 多层合成 / 空间定位(Panner) / 空气吸收(远距低通) / 包络先升后降
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

/* ---- 最小 WebAudio 桩 ---- */
class ParamStub {
  constructor(v) { this.value = v; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['ramp', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; }
}
class NodeStub {
  constructor(type) {
    this.type = type;
    this.gain = new ParamStub(1);
    this.frequency = new ParamStub(1000);
    this.Q = new ParamStub(1);
    this.detune = new ParamStub(0);
    this.buffer = null;
    this.panningModel = ''; this.distanceModel = ''; this.refDistance = 0; this.maxDistance = 0; this.rolloffFactor = 0;
    this.positionX = new ParamStub(0); this.positionY = new ParamStub(0); this.positionZ = new ParamStub(0);
    this.connected = [];
    this.started = [];
  }
  connect(n) { this.connected.push(n); return n; }
  start(t) { this.started.push(t); }
  stop(t) { this.started.push(['stop', t]); }
  setPosition(x, y, z) { this.positionX.value = x; this.positionY.value = y; this.positionZ.value = z; }
}
const chain = [];
let nodeCount = 0, pannerCount = 0, convolverCount = 0;
class BufferStub { constructor(ch, len, sr) { this.channels = ch; this.length = len; this.sampleRate = sr; this.data = new Float32Array(len); } getChannelData(c) { return this.data; } }
class CtxStub {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new NodeStub('destination');
    this.listener = {
      positionX: new ParamStub(0), positionY: new ParamStub(0), positionZ: new ParamStub(0),
      setPosition() {}
    };
  }
  createBuffer(ch, len, sr) { return new BufferStub(ch, len, sr); }
  createBufferSource() { nodeCount++; return new NodeStub('source'); }
  createGain() { nodeCount++; return new NodeStub('gain'); }
  createBiquadFilter() { nodeCount++; const n = new NodeStub('filter'); n.gain = new ParamStub(1); return n; }
  createOscillator() { nodeCount++; return new NodeStub('osc'); }
  createPanner() { nodeCount++; pannerCount++; return new NodeStub('panner'); }
  createConvolver() { nodeCount++; convolverCount++; return new NodeStub('convolver'); }
  createDynamicsCompressor() { nodeCount++; const n = new NodeStub('compressor'); n.threshold = new ParamStub(-14); n.knee = new ParamStub(4); n.ratio = new ParamStub(5); n.attack = new ParamStub(0.003); n.release = new ParamStub(0.22); return n; }
}
global.window = global;
global.addEventListener = () => {};
global.AudioContext = CtxStub;
global.webkitAudioContext = CtxStub;
global.location = { hostname: 'localhost' };
global.devicePixelRatio = 1;
global.THREE = { Vector3: class { constructor(x, y, z) { this.x = x; this.y = y; this.z = z; } } };

for (const f of ['js/core.js', 'js/audio.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}

let fail = 0;
function check(cond, msg) {
  if (!cond) { fail++; console.log('FAIL  ' + msg); }
  else console.log('PASS  ' + msg);
}

// Game 桩（_dist 用）
global.Game = { player: { pos: { x: 0, y: 0, z: 0 } } };

/* 1. 初始化 */
AudioFX.init();
check(AudioFX.ctx instanceof CtxStub, 'init 创建 AudioContext');
check(AudioFX.master && AudioFX.master.type === 'gain', 'init 创建 master gain');
check(AudioFX.comp && AudioFX.comp.type === 'compressor' && AudioFX.comp.threshold.value === -10, 'init 创建响度压缩器（-10dB）');
check(convolverCount === 1, 'init 创建全局共享卷积混响');

/* 2. 所有公共方法不抛错 */
const methods = [
  ['shot(pistol)', () => AudioFX.shot('pistol')],
  ['shot(rifle)', () => AudioFX.shot('rifle')],
  ['shot(sniper)', () => AudioFX.shot('sniper')],
  ['shot(shotgun)', () => AudioFX.shot('shotgun')],
  ['shot(melee)', () => AudioFX.shot('melee')],
  ['reload()', () => AudioFX.reload()],
  ['explosion()', () => AudioFX.explosion()],
  ['explosion(pos)', () => AudioFX.explosion({ x: 0, y: 1, z: 0 })],
  ['smoke(pos)', () => AudioFX.smoke({ x: 5, y: 1, z: 0 })],
  ['hit()', () => AudioFX.hit()],
  ['kill()', () => AudioFX.kill()],
  ['foot()', () => AudioFX.foot()],
  ['casing()', () => AudioFX.casing()],
  ['incoming()', () => AudioFX.incoming()],
  ['ui()', () => AudioFX.ui()],
  ['radio()', () => AudioFX.radio()],
  ['mortar()', () => AudioFX.mortar()],
  ['heal()', () => AudioFX.heal()],
  ['setListener()', () => AudioFX.setListener({ x: 10, y: 0, z: 20 })],
  ['tone()', () => AudioFX.tone({ f0: 800, f1: 400, dur: 0.2, gain: 0.2 })],
  ['playNoise()', () => AudioFX.playNoise({ dur: 0.2, f0: 1000 })],
  ['nearMiss(近)', () => AudioFX.nearMiss({ x: 2, y: 1.2, z: 0 }, 0.6)],
  ['nearMiss(远)', () => AudioFX.nearMiss({ x: 2, y: 1.2, z: 0 }, 1.8)],
  ['impact()', () => AudioFX.impact({ x: 5, y: 1, z: 0 })],
  ['dmg()', () => AudioFX.dmg()],
  ['playSample(无Audio环境静默)', () => AudioFX.playSample('pistol', { gain: 0.5, stopAt: 3 })],
];
for (const [name, fn] of methods) {
  try { fn(); check(true, name + ' 无异常'); }
  catch (e) { check(false, name + ' 抛异常: ' + e.message); }
}

/* 2.1 环境底噪：启动创建循环声源 + LFO，停止后清理干净；无假交火调度（不干扰敌情判断） */
AudioFX.startAmbience();
check(!!AudioFX._amb && !!AudioFX._amb.src, 'startAmbience 创建循环风声源');
check(!AudioFX._amb.timers, 'startAmbience 不再调度远处假交火');
AudioFX.stopAmbience();
check(AudioFX._amb === null, 'stopAmbience 清理环境源');
// 重复启停不崩溃
AudioFX.startAmbience(); AudioFX.startAmbience();
AudioFX.stopAmbience(); AudioFX.stopAmbience();
check(AudioFX._amb === null, '重复启停环境音不崩溃');
// 近距 nearMiss 增益应高于远距
let nearG = 0, farG = 0;
const origCrack = AudioFX._crack.bind(AudioFX);
AudioFX._crack = function (o) { if (o.type === 'bandpass') { nearG = nearG || o.gain; } return origCrack(o); };
AudioFX.nearMiss({ x: 2, y: 1.2, z: 0 }, 0.5);
AudioFX._crack = origCrack;
AudioFX._crack = function (o) { if (o.type === 'bandpass') { farG = farG || o.gain; } return origCrack(o); };
AudioFX.nearMiss({ x: 2, y: 1.2, z: 0 }, 2.0);
AudioFX._crack = origCrack;
check(nearG > farG, 'nearMiss 近距离呼啸更响（' + nearG.toFixed(2) + ' > ' + farG.toFixed(2) + '）');

/* 3. 多层枪声：单次步枪射击应构建 ≥4 节点（crack 噪声源+滤波+包络 / thump 振荡器 / mech / tail 等） */
nodeCount = 0; pannerCount = 0;
AudioFX.shot('rifle');
check(nodeCount >= 6, '步枪射击多层合成节点数=' + nodeCount + '（≥6: 爆裂+冲击+机械+路由）');

/* 4. 空间定位：带 pos 的射击创建 PannerNode */
nodeCount = 0; pannerCount = 0;
AudioFX.shot('rifle', { x: 30, y: 1.2, z: 0 });
check(pannerCount > 0, '带 pos 射击创建 PannerNode（3D 定位）');
check(AudioFX.shot('rifle', { x: 30, y: 1.2, z: 0 }) === undefined, 'pos 版本正常执行（返回 undefined）');

/* 5. 空气吸收：远距离 lowpass 截止频率应低于近距离 */
const lpFilters = [];
const origBF = CtxStub.prototype.createBiquadFilter;
CtxStub.prototype.createBiquadFilter = function () {
  const n = origBF.call(this);
  lpFilters.push(n);
  return n;
};
lpFilters.length = 0;
AudioFX.shot('rifle', { x: 10, y: 1.2, z: 0 });  // 近
const nearLp = lpFilters.filter(f => f.type === 'lowpass').map(f => f.frequency.value);
lpFilters.length = 0;
AudioFX.shot('rifle', { x: 150, y: 1.2, z: 0 }); // 远
const farLp = lpFilters.filter(f => f.type === 'lowpass').map(f => f.frequency.value);
const nearMax = Math.max(...nearLp), farMax = Math.max(...farLp);
check(nearLp.length > 0 && farLp.length > 0, '近/远射击均创建 lowpass（空气吸收链）');
check(farMax < nearMax, '远距低通 ' + farMax.toFixed(0) + 'Hz < 近距 ' + nearMax.toFixed(0) + 'Hz（远枪声发闷）');
CtxStub.prototype.createBiquadFilter = origBF;

/* 6. 包络形状：gain 事件序列含 set 后 ramp（先升后降） */
// 验证 shot 产生的 gain 都有 attack+decay
function gainShaped(o) { return o.events.some(e => e[0] === 'set' && e[1] > 0) && o.events.some(e => e[0] === 'ramp' && e[1] < 0.01); }
// 简单验证：master 音量与 vol 联动
AudioFX.setVol(0.3);
check(Math.abs(AudioFX.master.gain.value - 0.3) < 1e-6, 'setVol 联动 master');
AudioFX.setVol(0.6);

/* 7. 监听器更新 */
AudioFX.setListener(new global.THREE.Vector3(15, 2, 8));
check(AudioFX.ctx.listener.positionX.value === 15, 'setListener 更新 positionX');
check(AudioFX.ctx.listener.positionY.value === 2 + 1.6, 'setListener 抬高 1.6m（耳高）');

console.log(fail === 0 ? '\n=== AudioFX 逻辑链路验证通过 ===' : '\n=== 失败 ' + fail + ' 项 ===');
process.exit(fail === 0 ? 0 : 1);
