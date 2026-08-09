/* ============================================
 * 战地突击 · textures.js（由 index.html 内联脚本拆分）
 * ============================================ */

/* ---------- 2. 程序化纹理 ----------
 * 外部纹理扩展：在打开页面控制台设置后刷新即可覆盖，例如：
 *   window.TEXTURE_OVERRIDES = { brick:'/my/brick.jpg', grass:'/my/grass.jpg' };
 * 或把图片放同目录：{ grass:'grass.jpg' }。未覆盖的走程序化生成。 */
const Tex = {
  cache: {},
  overrides: null,
  makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; },
  brick() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#7a3b2e'; g.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 32, bh = 30;
      g.fillStyle = row % 2 ? '#8a4636' : '#6f3529';
      for (let x = -32; x < 288; x += 64) g.fillRect(x + off, row * bh + 4, 62, bh - 6);
    }
    for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(0,0,0,' + U.rand(0.04, 0.12) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    return c;
  },
  concrete() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#6d7075'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2400; i++) {
      const a = U.rand(0.02, 0.07); g.fillStyle = 'rgba(' + U.randi(40, 90) + ',' + U.randi(40, 90) + ',' + U.randi(50, 100) + ',' + a + ')';
      g.fillRect(Math.random() * 256, Math.random() * 256, U.rand(1, 4), U.rand(1, 4));
    }
    return c;
  },
  grass() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3d5a32'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = ['#4a6b3c', '#35502c', '#557a45', '#2f4827'][U.randi(0, 3)];
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 3);
    }
    return c;
  },
  asphalt() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#3a3d42'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2600; i++) { g.fillStyle = 'rgba(0,0,0,' + U.rand(0.03, 0.1) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, U.rand(1, 6), 1); }
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(Math.random() * 256, 0); g.lineTo(Math.random() * 256, 256); g.stroke(); }
    return c;
  },
  sandbag() {
    const c = this.makeCanvas(256, 64), g = c.getContext('2d');
    g.fillStyle = '#7a6a4a'; g.fillRect(0, 0, 256, 64);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = y % 2 ? '#8a7a58' : '#6e5e42';
      g.beginPath(); g.ellipse(x * 32 + 16 + (y ? 16 : 0), y * 32 + 16, 15, 13, 0, 0, 7); g.fill();
    }
    return c;
  },
  metal() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#4d5258'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.moveTo(i * 7, 0); g.lineTo(i * 7 - 40, 256); g.stroke(); }
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(' + U.randi(200, 240) + ',' + U.randi(200, 240) + ',' + U.randi(210, 250) + ',' + U.rand(0.02, 0.06) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 3, 1); }
    return c;
  },
  floor() {
    const c = this.makeCanvas(128, 128), g = c.getContext('2d');
    g.fillStyle = '#56504a'; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#3a342e'; g.lineWidth = 3;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.stroke(); g.beginPath(); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke(); }
    for (let i = 0; i < 200; i++) { g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    return c;
  },
  roof() {
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#45484d'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 4000; i++) { g.fillStyle = 'rgba(' + U.randi(60, 110) + ',' + U.randi(60, 110) + ',' + U.randi(70, 120) + ',' + U.rand(0.05, 0.2) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    return c;
  },
  /* ---- T-02：desert/port 主题程序化纹理（art/procedural-textures.md §2，256×256，离线可用） ---- */
  sand() { // 沙地/土路：均匀米黄细粒 + 横向沙纹（desert）
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#c2a26a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 8; i++) { // 大尺度横向沙纹
      g.fillStyle = 'rgba(176,143,87,' + U.rand(0.06, 0.14) + ')';
      g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, U.rand(120, 220) / 2, U.rand(10, 26) / 2, U.rand(-0.2, 0.2), 0, 7); g.fill();
    }
    for (let i = 0; i < 6; i++) { // 亮斑带
      g.fillStyle = 'rgba(205,176,122,' + U.rand(0.06, 0.12) + ')';
      g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 256, U.rand(110, 200) / 2, U.rand(8, 18) / 2, U.rand(-0.2, 0.2), 0, 7); g.fill();
    }
    for (let i = 0; i < 4000; i++) { g.fillStyle = 'rgba(138,115,64,' + U.rand(0.06, 0.20) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, U.randi(1, 2), U.randi(1, 2)); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(110,90,55,' + U.rand(0.20, 0.50) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, U.randi(2, 4), U.randi(2, 4)); }
    return c;
  },
  plaster() { // 灰泥墙：平整、轻微斑驳、低噪声，无砖缝（desert）
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#cbb188'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 20; i++) { // 抹灰不均斑块
      g.fillStyle = (i % 2 ? 'rgba(200,178,130,' : 'rgba(168,144,100,') + U.rand(0.05, 0.14) + ')';
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, U.rand(20, 60), 0, 7); g.fill();
    }
    for (let i = 0; i < 12; i++) { // 水平抹痕短弧线
      g.strokeStyle = 'rgba(150,126,86,0.15)'; g.lineWidth = 1;
      g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, U.rand(60, 140), Math.PI * 0.05, Math.PI * 0.45); g.stroke();
    }
    for (let i = 0; i < 2000; i++) { g.fillStyle = 'rgba(0,0,0,' + U.rand(0.02, 0.06) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    return c;
  },
  corrugated() { // 波纹钢板：竖波纹 + 底部锈线（port）
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#566069'; g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 8) { // 8px 周期：3px 亮 + 2px 过渡 + 3px 暗
      g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 3, 256);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 5, 0, 3, 256);
    }
    for (let i = 0; i < 50; i++) { // 锈斑偏向底部（模拟积水锈蚀）
      g.fillStyle = 'rgba(122,74,50,' + U.rand(0.08, 0.28) + ')';
      g.fillRect(Math.random() * 256, 200 + Math.random() * 56, U.randi(2, 8), U.randi(1, 5));
    }
    for (let i = 0; i < 500; i++) { g.fillStyle = 'rgba(230,235,240,' + U.rand(0.02, 0.06) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    return c;
  },
  rust() { // 锈蚀金属：高密度锈斑 + 橘色点缀（port 钢结构）
    const c = this.makeCanvas(256, 256), g = c.getContext('2d');
    g.fillStyle = '#6e4a35'; g.fillRect(0, 0, 256, 256);
    const rustCols = ['#8a5a3a', '#5a3a28', '#b06a3a'];
    for (let i = 0; i < 150; i++) {
      g.fillStyle = rustCols[U.randi(0, 2)]; g.globalAlpha = U.rand(0.08, 0.30);
      g.fillRect(Math.random() * 256, Math.random() * 256, U.randi(2, 12), U.randi(2, 12));
    }
    g.globalAlpha = 1;
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(74,47,34,' + U.rand(0.15, 0.40) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, U.randi(2, 6), U.randi(2, 6)); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(190,118,58,' + U.rand(0.10, 0.35) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, U.randi(1, 4), U.randi(1, 4)); }
    for (let i = 0; i < 3000; i++) { g.fillStyle = 'rgba(0,0,0,' + U.rand(0.03, 0.10) + ')'; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    return c;
  },
  get(name, repeat, scale) {
    const key = name + '|' + (repeat || 1) + '|' + (scale || 1);
    if (this.cache[key]) return this.cache[key];
    let tex;
    if (this.overrides && this.overrides[name]) {
      const img = new Image(); img.src = this.overrides[name];
      tex = new THREE.CanvasTexture(img); // 加载中为空白，加载完成后自动更新
      img.onload = () => { tex.needsUpdate = true; };
    } else {
      const makers = { brick: this.brick, concrete: this.concrete, grass: this.grass, asphalt: this.asphalt, sandbag: this.sandbag, metal: this.metal, floor: this.floor, roof: this.roof, sand: this.sand, plaster: this.plaster, corrugated: this.corrugated, rust: this.rust };
      tex = new THREE.CanvasTexture((makers[name] ? makers[name].call(this) : this.concrete.call(this)));
    }
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat || 1, repeat || 1);
    tex.anisotropy = 4;
    this.cache[key] = tex;
    return tex;
  },
  setupOverrides() { this.overrides = window.TEXTURE_OVERRIDES || null; }
};
