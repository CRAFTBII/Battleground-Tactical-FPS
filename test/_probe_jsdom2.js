/* 用 jsdom 模拟浏览器加载,主动触发 Settings.open() 复现可能的 null.textContent */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  let inlined = html;
  for (const src of scripts) {
    let code = '';
    try { code = fs.readFileSync(path.join(ROOT, src), 'utf8'); } catch (e) { continue; }
    inlined = inlined.replace(`<script src="${src}"></script>`, '<script>' + code + '</script>');
  }

  const { JSDOM } = require('jsdom');
  const dom = new JSDOM(inlined, {
    url: 'http://localhost:8000/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      const HCE = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
      if (HCE) HCE.getContext = function () { return null; };
      win.WebSocket = function () { return { on() {}, send() {}, close() {}, addEventListener() {} }; };
    }
  });
  const { window } = dom;

  const errors = [];
  window.addEventListener('error', e => {
    errors.push((e.error && e.error.stack) || (e.message + (e.error ? ' :: ' + (e.error.stack||'') : '')));
  });
  const origErr = window.console.error;
  window.console.error = (...a) => errors.push('console.error: ' + a.join(' '));

  // 等同步脚本
  await new Promise(r => setTimeout(r, 300));
  // 主动模拟：调用 Settings.open()（模拟用户点「⚙ 设置」）
  try {
    window.eval('Settings && Settings.open && Settings.open();');
  } catch (e) {
    console.log('Settings.open 抛错: ' + e.message);
    console.log((e.stack||'').split('\n').slice(0, 5).join('\n'));
  }
  // 模拟拖动滑块
  try {
    window.eval(`
      const s = document.getElementById('setSens');
      if (s) { s.value = '0.33'; s.dispatchEvent(new Event('input', {bubbles:true})); }
      const v = document.getElementById('setVol');
      if (v) { v.value = '0.8'; v.dispatchEvent(new Event('input', {bubbles:true})); }
    `);
  } catch (e) {
    console.log('slider 触发抛错: ' + e.message);
    console.log((e.stack||'').split('\n').slice(0, 5).join('\n'));
  }
  // 等异步
  await new Promise(r => setTimeout(r, 500));

  if (errors.length === 0) console.log('[jsdom 加载完毕] 未捕获到错误');
  else for (const e of errors) { console.log('✗ ' + e.split('\n').slice(0, 8).join('\n')); }
  process.exit(errors.length ? 1 : 0);
})();