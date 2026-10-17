/* 用 jsdom 实际加载 index.html 并跑脚本,捕获 null.textContent 来源 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  // 把 <script src=...> 改写为内联,因为 jsdom 默认不加载外部资源
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  let inlined = html;
  for (const src of scripts) {
    let code = '';
    try { code = fs.readFileSync(path.join(ROOT, src), 'utf8'); } catch (e) { console.log('  ! 跳过（读不到）:', src); continue; }
    inlined = inlined.replace(`<script src="${src}"></script>`, '<script>' + code + '</script>');
  }

  const { JSDOM, ResourceLoader } = require('jsdom');
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
    errors.push((e.error && e.error.stack) || e.message);
  });
  const origErr = window.console.error;
  window.console.error = (...a) => errors.push('console.error: ' + a.join(' '));

  // 等待所有同步脚本执行完
  await new Promise(r => setTimeout(r, 200));
  // 触发一次可能的 microtask
  await new Promise(r => setTimeout(r, 200));

  if (errors.length === 0) console.log('[jsdom 加载完毕] 未捕获到错误');
  else for (const e of errors) { console.log('✗ ' + e.split('\n').slice(0, 8).join('\n')); }
  process.exit(errors.length ? 1 : 0);
})();