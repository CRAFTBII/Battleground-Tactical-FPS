/* ============================================
 * QA · v29 设置系统（按键绑定 / 音量 / 灵敏度）
 * 运行：node test/_qa_v29_settings.js
 * 断言：Settings 核心逻辑 + index.html/combat.js/main.js 改动完整性
 * ============================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ FAIL: ' + name); } };

/* ---- mock 浏览器环境后以 vm 沙箱加载 settings.js（顶层 const 不参与 CJS 导出） ---- */
const store = {};
const sandbox = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  // 无 DOM：initUI 直接返回，仅测逻辑层
  document: { getElementById: () => null, addEventListener: () => {}, querySelector: () => null },
  console, setTimeout, clearTimeout
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'settings.js'), 'utf8') + '\nthis.Settings = Settings;', sandbox);
const Settings = sandbox.Settings;

console.log('\n[Settings 核心逻辑]');
ok(typeof Settings !== 'undefined', 'Settings 模块已加载');
ok(Settings.key('moveF') === 'KeyW', '默认绑定：moveF=KeyW');
ok(Settings.key('scoreboard') === 'Tab', '默认绑定：scoreboard=Tab');
ok(Settings.key('prone') === 'ControlLeft', '默认绑定：prone=ControlLeft');
ok(Settings.actionByCode('KeyW') === 'moveF', '反查：KeyW→moveF');
ok(Settings.actionByCode('Digit1') === 'slot1', '反查：Digit1→slot1');
ok(Settings.actionByCode('KeyM') === 'mortar', '反查：KeyM→mortar');
ok(Settings.actionByCode('F10') === null, '未绑定键反查为 null');
ok(Settings.codeLabel('KeyW') === 'W', '显示名：KeyW→W');
ok(Settings.codeLabel('Space') === '空格', '显示名：Space→空格');
ok(Settings.codeLabel('Digit7') === '7', '显示名：Digit7→7');
ok(Settings.codeLabel('ControlLeft') === '左Ctrl', '显示名：ControlLeft→左Ctrl');
ok(Settings.codeLabel('F5') === 'F5', '显示名：F5 原样');

const r1 = Settings.bind('reload', 'KeyP');
ok(r1.ok === true, '重绑 reload→KeyP 成功（KeyP 未被占用）');
ok(Settings.key('reload') === 'KeyP', '绑定后 key(reload)=KeyP');
ok(Settings.actionByCode('KeyP') === 'reload', '反查缓存失效后 KeyP→reload');
const r2 = Settings.bind('cmdFree', 'KeyP');
ok(r2.ok === false, '冲突绑定被拒绝（KeyP 已被 reload 占用）');
ok(Settings.key('cmdFree') === 'KeyX', '冲突后原绑定不变（cmdFree 仍为 KeyX）');
ok(store['battleground.settings'] && JSON.parse(store['battleground.settings']).keys.reload === 'KeyP', '绑定已持久化到 localStorage');
Settings.resetKeys();
ok(Settings.key('reload') === 'KeyR', 'resetKeys 恢复默认 reload=KeyR');
ok(Settings._data.sens === 0.22 && Settings._data.vol === 0.6, '默认 sens/vol = 0.22 / 0.6');

/* ---- index.html 完整性 ---- */
console.log('\n[index.html]');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
['id="settings"', 'id="setSens"', 'id="setVol"', 'id="setKeyList"', 'id="setReset"', 'id="setClose"',
  'id="btnSettings"', 'id="pausedSettingsBtn"'].forEach(id => {
  ok(html.includes(id), '包含 ' + id);
});
ok(!html.includes('id="sensInp"') && !html.includes('id="volInp"'), '旧暂停面板滑块已移除');
const sIdx = html.indexOf('js/settings.js'), cIdx = html.indexOf('js/combat.js');
ok(sIdx !== -1 && cIdx !== -1 && sIdx < cIdx, 'settings.js 在 combat.js 之前引入');
// 设置面板样式已抽到 css/panels.css，不能再只查 index.html
const cssDir = path.join(ROOT, 'css');
const cssText = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'))
  .map(f => fs.readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
ok(/^#settings\{[^}]*z-index:70/m.test(cssText), '设置面板层级 z-index:70（高于菜单 50）');

/* ---- combat.js 完整性 ---- */
console.log('\n[combat.js]');
const combat = fs.readFileSync(path.join(ROOT, 'js', 'combat.js'), 'utf8');
ok(!/e\.code === 'Key[A-Z]'/.test(combat), '无残留硬编码按键（KeyX 形式）');
ok(!/e\.code === 'Digit\d'/.test(combat), '无残留硬编码数字槽位');
ok(combat.includes("Settings.actionByCode(e.code)"), 'keydown 使用 actionByCode 分发');
ok(combat.includes("Settings.key('moveF')"), '移动键走绑定表');
ok(combat.includes("Settings.key('jump')"), '跳跃键走绑定表');

/* ---- ui.js 完整性（timerT 空引用修复） ---- */
console.log('\n[ui.js]');
const ui = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8');
ok(ui.includes("timer() { if (this.els.timerT)"), 'timer() 已加 null 防御（timerT 元素已被 v2.8 移除）');

/* ---- main.js 完整性 ---- */
console.log('\n[main.js]');
const main = fs.readFileSync(path.join(ROOT, 'js', 'main.js'), 'utf8');
ok(main.includes("$('btnSettings').onclick"), '主菜单设置按钮已接线');
ok(main.includes("$('pausedSettingsBtn').onclick"), '暂停面板设置按钮已接线');
ok(main.includes('Settings.applyToGame()'), 'init 应用持久化设置');
ok(main.includes('Settings.isOpen()'), 'pointerlock 弹暂停避开设置面板');
ok(!/sensInp|volInp/.test(main), 'main.js 不再引用旧滑块');
ok(main.includes('pausedQuitBtn') && main.includes('backToMenu()'), '暂停「退出对局」按钮已接线（联机自动断开+回菜单）');
ok(main.includes('Game.reset()') && main.includes('Items.clear()') && main.includes('World.load(scene, def)'),
  'backToMenu 完整重置：Game.reset + 掉落物清理 + 地图重建(机制/据点归位)');
ok(main.includes('AudioFX.stopAmbience') && main.includes('AudioFX.stopSamples'),
  'backToMenu 停止环境底噪与所有活跃样本(防空警报等长样本)');

/* ---- audio.js 完整性 ---- */
console.log('\n[audio.js]');
const audio = fs.readFileSync(path.join(ROOT, 'js', 'audio.js'), 'utf8');
ok(audio.includes('stopSamples()') && audio.includes('_samples.add(a)'), 'AudioFX.stopSamples 已提供并登记活跃样本');

/* ---- items.js 完整性 ---- */
console.log('\n[items.js]');
const items = fs.readFileSync(path.join(ROOT, 'js', 'items.js'), 'utf8');
ok(items.includes('clear()') && items.includes('this.list.length = 0'), 'Items.clear() 已提供（清场景残留掉落物）');

/* ---- index.html 完整性 ---- */
console.log('\n[index.html 暂停面板]');
ok(html.includes('id="pausedQuitBtn"'), '暂停面板包含退出对局按钮（始终显示）');
ok(!html.includes('pausedDisconnectBtn'), '旧的联机专属断开按钮已移除（改为通用退出）');

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
