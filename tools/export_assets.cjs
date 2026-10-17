#!/usr/bin/env node
/* ============================================================
 * tools/export_assets.cjs — 内联 base64 几何 → 标准 glTF 2.0 二进制 .glb
 *
 * 这是 tools/split-glb.js / glb2data.js / glb2bldg.js 的**逆过程**：
 *   把 models/*.js 里 base64 内联的顶点几何还原成浏览器可直接 fetch 的 .glb。
 *
 * 产物（严格按 backup/deinline-spec.md 第二章「数据契约」）：
 *   models/soldier.glb                   ← SOLDIER_DATA（7 部件，真节点层级，gun 挂 armR）
 *   models/guns/<key>.glb                ← WEAPONS_DATA（POSITION/NORMAL/TEXCOORD_0 + Uint16）
 *   models/guns/<key>_bolt.glb           ← GUN_GLB_DATA[key].bolt（POSITION/COLOR_0 + Uint16，
 *                                          顶层 extras 带 boltRest/boltTravel/zExt）
 *   models/buildings/<key>.glb           ← BUILDINGS_DATA ∪ BUILDINGS_OUT（POSITION/NORMAL/COLOR_0 + Uint16）
 *   models/.building-groups.json         ← 建筑来源分组提示（gen_manifest.cjs 据此填 manifest.buildingGroups，
 *                                          legacy 5 型不参与 dims 缩放，分组错了建筑会被非等比拉伸）
 *
 * ⚠ 与规格 §2.2 字面表述的唯一差异（有据可查，非随意偏离）：
 *   §2.2 写「枪身带 COLOR_0」，但去内联前 js/models.js#buildWeaponMesh 读的是 WEAPONS_DATA
 *   （POSITION/NORMAL/TEXCOORD_0，无顶点色；材质用 WEAPON_COLOR 常量色；makeBasis 定向留在运行时），
 *   而 GUN_GLB_DATA 在运行时只贡献 .bolt（§2.3）。若把枪身改喂 GUN_GLB_DATA.body（带 COLOR_0），
 *   第一人称枪身会换成 trimesh 拼装的那份几何——models.js 注释记录了那次回归
 *   （「之前把整枪换成 trimesh 拼的 GLB，看起来像拆散的方块」）。故枪身严格对应 WEAPONS_DATA，
 *   COLOR_0 只出现在枪栓（§2.3）与建筑（§2.4）产物上。规格 §2.2 的 COLOR_0 措辞待 Lead 校正。
 *
 * 硬性约定：
 *   1) 零第三方依赖、纯 CommonJS、只读 models/*.js 原始内联数据（不删不改）；
 *   2) 几何**原样搬运**：不做任何坐标变换 / 缩放 / 居中 / 平移（运行时负责定向）；
 *   3) POSITION accessor 必须带 min/max；索引 5123(Uint16)，顶点属性 5126(Float32)；
 *   4) GLB 容器：12 字节头 + JSON chunk（0x20 空格补齐）+ BIN chunk（0x00 补齐），均 4 字节对齐；
 *   5) base64 长度先做类型自证（pos/nor/uv/col = Float32LE，idx = Uint16LE），不整除一律报错，
 *      不猜测、不硬凑。
 *
 * 用法：
 *   node tools/export_assets.cjs                # 导出 + 回读自检
 *   node tools/export_assets.cjs --verify-only  # 只回读自检（不写文件）
 *   node tools/export_assets.cjs --quiet        # 只输出汇总（自检失败仍然打印明细）
 * 退出码：0 = 全部产物导出且自检 PASS；1 = 有 FAIL / 数据契约不符。
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MODELS = path.join(ROOT, 'models');

const ARGV = process.argv.slice(2);
const VERIFY_ONLY = ARGV.includes('--verify-only');
const QUIET = ARGV.includes('--quiet');

/* ============================================================
 * 0. 小工具 / 错误类型
 * ============================================================ */
class DataError extends Error {
  constructor(msg) { super(msg); this.name = 'DataError'; }
}
const pad4 = (n) => (n + 3) & ~3;
const rel = (abs) => path.relative(ROOT, abs).replace(/\\/g, '/');
const fmtBytes = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B');

/* ============================================================
 * 1. 载入内联数据（在沙箱 window 里求值，只读）
 * ============================================================ */
function loadInline(relPath, globalName) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) throw new DataError('内联数据文件缺失: ' + relPath);
  const src = fs.readFileSync(abs, 'utf8');
  const win = {};
  // 这些文件只做 window.X = {...} 赋值，无其他副作用。
  // 用 vm 在隔离上下文里求值（new Function 会被超长 base64 字符串参数化路径卡住）。
  const vm = require('vm');
  const sandbox = { window: win, console: { log() {}, warn() {}, error() {} } };
  vm.createContext(sandbox);
  try {
    vm.runInContext(src, sandbox, { filename: relPath });
  } catch (err) {
    throw new DataError(relPath + ' 求值失败: ' + err.message);
  }
  const data = sandbox.window[globalName];
  if (data === undefined || data === null) {
    throw new DataError(relPath + ' 未定义预期全局 ' + globalName);
  }
  return data;
}

/* ============================================================
 * 2. base64 → 类型数组（带长度自证）
 * ============================================================ */
function decodeB64(b64, label, bytesPerElem, elemName) {
  if (typeof b64 !== 'string' || b64.length === 0) throw new DataError(label + ': 不是非空 base64 字符串');
  if (b64.length % 4 !== 0) throw new DataError(label + ': base64 长度 ' + b64.length + ' 不是 4 的倍数');
  const buf = Buffer.from(b64, 'base64');
  if (buf.length % bytesPerElem !== 0) {
    throw new DataError(
      label + ': 解码得 ' + buf.length + ' 字节，不是 ' + elemName + '（' + bytesPerElem + ' 字节/元素）的整数倍' +
      ' —— 类型推断错误，拒绝猜测'
    );
  }
  if (buf.toString('base64') !== b64) {
    throw new DataError(label + ': base64 非规范编码（重新编码不一致，疑似被截断/污染）');
  }
  return buf;
}

function decodeF32(b64, label) {
  const buf = decodeB64(b64, label, 4, 'Float32LE');
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function decodeU16(b64, label) {
  const buf = decodeB64(b64, label, 2, 'Uint16LE');
  const out = new Uint16Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readUInt16LE(i * 2);
  return out;
}

/* ------------------------------------------------------------
 * 单条几何的完整契约校验。
 * 返回 { vtx, tri, pos, nor, uv, col, idx, warnings }
 * ------------------------------------------------------------ */
function checkGeometry(label, raw, opts) {
  const o = opts || {};
  const warnings = [];
  if (!raw || typeof raw !== 'object') throw new DataError(label + ': 几何对象缺失');

  const pos = decodeF32(raw.pos, label + '.pos');
  if (pos.length === 0 || pos.length % 3 !== 0) {
    throw new DataError(label + '.pos: ' + pos.length + ' 个 float 不能被 3 整除（不是 VEC3）');
  }
  const vtx = pos.length / 3;

  let nor = null;
  if (raw.nor !== undefined && raw.nor !== null) {
    nor = decodeF32(raw.nor, label + '.nor');
    if (nor.length !== vtx * 3) {
      throw new DataError(label + '.nor: ' + nor.length + ' 个 float ≠ ' + (vtx * 3) + '（应等于顶点数×3）');
    }
  } else if (o.requireNormal) {
    throw new DataError(label + ': 缺少 NORMAL 数据（该产物要求带法线）');
  }

  let uv = null;
  if (raw.uv !== undefined && raw.uv !== null) {
    uv = decodeF32(raw.uv, label + '.uv');
    if (uv.length !== vtx * 2) {
      throw new DataError(label + '.uv: ' + uv.length + ' 个 float ≠ ' + (vtx * 2) + '（应等于顶点数×2）');
    }
  }

  // 索引先解析：下面 col 的截断补齐要用它判断「缺色顶点是否真的被三角形引用」
  const idx = decodeU16(raw.idx, label + '.idx');
  if (idx.length === 0 || idx.length % 3 !== 0) {
    throw new DataError(label + '.idx: ' + idx.length + ' 个索引不是 3 的倍数（不是三角形列表）');
  }
  let maxIdx = -1;
  for (let i = 0; i < idx.length; i++) if (idx[i] > maxIdx) maxIdx = idx[i];
  if (maxIdx >= vtx) {
    throw new DataError(label + '.idx: 最大索引 ' + maxIdx + ' 越界（顶点数 ' + vtx + '）');
  }

  let col = null;
  if (raw.col !== undefined && raw.col !== null) {
    const colRaw = decodeF32(raw.col, label + '.col');
    const need = vtx * 3;
    if (colRaw.length > need) {
      throw new DataError(label + '.col: ' + colRaw.length + ' 个 float 超过顶点数×3=' + need);
    }
    if (colRaw.length < need) {
      // 已核对的原始数据缺陷：生成器（tools/glb2bldg*.js 的 colorize）按「顶点数组顺序每 3 个一组」
      // 上色，末尾不足一组的 R = vtx % 3 个顶点拿到 null；Buffer.writeFloatLE(null) 写 0，
      // 于是落盘的 float 数 = 3*(vtx-R) + R = 3*vtx - 2R，比顶点数×3 少 2R 个。
      // 这里按 0 补齐 = 与原内联数据运行时「读越界缓冲」的结果一致（原 BufferAttribute 的
      // count 是 111.33 这类小数，末顶点取不到颜色 → 渲染为黑），属于忠实还原而非修复。
      // 已知影响：末尾 R 个顶点确实被三角形引用，所以那一小块原本就是黑的，改造后仍是黑的。
      const R = vtx % 3;
      const deficit = need - colRaw.length;
      if (deficit !== 2 * R) {
        throw new DataError(
          label + '.col: ' + colRaw.length + ' 个 float，比顶点数×3=' + need + ' 少 ' + deficit +
          ' 个；不符合已知缺陷模式 2*(vtx%3)=' + (2 * R) + '（vtx%3=' + R + '）—— 拒绝硬凑'
        );
      }
      col = new Float32Array(need);
      col.set(colRaw);
      warnings.push({
        kind: 'COLOR_TAIL_TRUNCATED',
        text: label + '.col 少 ' + deficit + ' 个 float（顶点数组尾部 ' + R + ' 个顶点未被原生成器上色），' +
          '按 0 补齐 = 与原内联数据运行时读取结果一致（末 ' + R + ' 个顶点颜色 = [0,0,0]）'
      });
      const tailRefs = [];
      for (let i = 0; i < idx.length; i++) {
        if (idx[i] >= vtx - R && tailRefs.indexOf(idx[i]) < 0) tailRefs.push(idx[i]);
      }
      if (tailRefs.length) {
        tailRefs.sort((a, b) => a - b);
        warnings.push({
          kind: 'COLOR_TAIL_REFERENCED',
          text: label + ': 缺色的尾部顶点 ' + tailRefs.join(',') + ' 被索引引用（原运行时这些顶点就是黑的），' +
            '补 0 后颜色仍为 [0,0,0]；几何/索引未改动'
        });
      }
    } else {
      col = colRaw;
    }
  }

  return { vtx, tri: idx.length / 3, pos, nor, uv, col, idx, warnings };
}

/* ============================================================
 * 3. GLB 容器构建
 * ============================================================ */
class BinBuilder {
  constructor() { this.parts = []; this.length = 0; }
  push(buf) {
    const aligned = pad4(this.length);
    if (aligned > this.length) { this.parts.push(Buffer.alloc(aligned - this.length)); this.length = aligned; }
    const offset = this.length;
    this.parts.push(buf);
    this.length += buf.length;
    return offset;
  }
  // 返回 4 字节对齐的完整 BIN（尾部 0 填充）
  buffer() {
    const total = pad4(this.length);
    const out = Buffer.alloc(total); // Buffer.alloc 已清零
    let at = 0;
    for (const p of this.parts) { p.copy(out, at); at += p.length; }
    return out;
  }
}

function f32Buffer(arr) {
  const b = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) b.writeFloatLE(arr[i], i * 4);
  return b;
}
function u16Buffer(arr) {
  const b = Buffer.alloc(arr.length * 2);
  for (let i = 0; i < arr.length; i++) b.writeUInt16LE(arr[i], i * 2);
  return b;
}

const TARGET_ARRAY = 34962;
const TARGET_ELEMENT = 34963;

class GlbWriter {
  constructor(generator) {
    this.bin = new BinBuilder();
    this.json = {
      asset: { version: '2.0', generator: generator },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: [],
      accessors: [],
      bufferViews: [],
      buffers: [{ byteLength: 0 }],
    };
  }
  // 顶点属性 accessor（Float32）
  _attr(buf, type, count, extra) {
    const comp = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const offset = this.bin.push(buf);
    const bv = { buffer: 0, byteOffset: offset, byteLength: buf.length, target: TARGET_ARRAY };
    this.json.bufferViews.push(bv);
    const acc = { bufferView: this.json.bufferViews.length - 1, componentType: 5126, count: count, type: type };
    if (extra) Object.assign(acc, extra);
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  // 索引 accessor（Uint16）
  _index(buf, count) {
    const offset = this.bin.push(buf);
    this.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target: TARGET_ELEMENT });
    this.json.accessors.push({
      bufferView: this.json.bufferViews.length - 1,
      componentType: 5123,
      count: count,
      type: 'SCALAR',
    });
    return this.json.accessors.length - 1;
  }
  /* geo = checkGeometry() 结果；返回 primitive */
  addPrimitive(geo, materialIndex) {
    const attributes = {};
    // POSITION 必须带 min/max
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < geo.vtx; i++) {
      for (let c = 0; c < 3; c++) {
        const v = geo.pos[i * 3 + c];
        if (v < mn[c]) mn[c] = v;
        if (v > mx[c]) mx[c] = v;
      }
    }
    attributes.POSITION = this._attr(f32Buffer(geo.pos), 'VEC3', geo.vtx, { min: mn, max: mx });
    if (geo.nor) attributes.NORMAL = this._attr(f32Buffer(geo.nor), 'VEC3', geo.vtx);
    if (geo.uv) attributes.TEXCOORD_0 = this._attr(f32Buffer(geo.uv), 'VEC2', geo.vtx);
    if (geo.col) attributes.COLOR_0 = this._attr(f32Buffer(geo.col), 'VEC3', geo.vtx);
    const indices = this._index(u16Buffer(geo.idx), geo.idx.length);
    const prim = { attributes: attributes, indices: indices, mode: 4 };
    if (materialIndex !== undefined && materialIndex !== null) prim.material = materialIndex;
    return prim;
  }
  addMaterial(mat) {
    this.json.materials.push(mat);
    return this.json.materials.length - 1;
  }
  /* 单 mesh 单 primitive 的常见产物 */
  addSingleMeshGlb(meshName, nodeName, geo, material, extras) {
    const matIdx = this.addMaterial(material);
    const prim = this.addPrimitive(geo, matIdx);
    this.json.meshes.push({ name: meshName, primitives: [prim] });
    const node = { name: nodeName, mesh: this.json.meshes.length - 1 };
    this.json.nodes.push(node);
    this.json.scenes[0].nodes.push(this.json.nodes.length - 1);
    if (extras) this.json.extras = extras;
    return this;
  }
  write(absPath) {
    const bin = this.bin.buffer();
    this.json.buffers[0].byteLength = bin.length;
    const jsonBuf = Buffer.from(JSON.stringify(this.json), 'utf8');
    const jsonPad = pad4(jsonBuf.length);
    const binPad = pad4(bin.length);
    const total = 12 + 8 + jsonPad + 8 + binPad;
    const out = Buffer.alloc(total);
    out.writeUInt32LE(0x46546c67, 0);      // 'glTF'
    out.writeUInt32LE(2, 4);               // version
    out.writeUInt32LE(total, 8);           // total length
    // JSON chunk
    out.writeUInt32LE(jsonPad, 12);
    out.write('JSON', 16, 'ascii');
    jsonBuf.copy(out, 20);
    out.fill(0x20, 20 + jsonBuf.length, 20 + jsonPad); // JSON 4 字节对齐必须用空格
    // BIN chunk
    const binHeaderAt = 20 + jsonPad;
    out.writeUInt32LE(binPad, binHeaderAt);
    out.write('BIN\0', binHeaderAt + 4, 'ascii');
    bin.copy(out, binHeaderAt + 8);
    // BIN 尾部 4 字节对齐用 0（Buffer.alloc 已清零，此处显式保证）
    out.fill(0x00, binHeaderAt + 8 + bin.length, total);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, out);
    return out.length;
  }
}

const MATERIAL_BASE = { metallicFactor: 0, roughnessFactor: 1 };
function solidMaterial(name, rgb) {
  return {
    name: name,
    pbrMetallicRoughness: {
      baseColorFactor: [rgb[0], rgb[1], rgb[2], 1],
      metallicFactor: MATERIAL_BASE.metallicFactor,
      roughnessFactor: MATERIAL_BASE.roughnessFactor,
    },
  };
}
// 顶点色几何：baseColorFactor 必须为白，否则会把 COLOR_0 乘暗
function vertexColorMaterial(name) {
  return solidMaterial(name, [1, 1, 1]);
}
/* 枪身没有 COLOR_0（见文件头 §2.2 说明），运行时由 js/models.js 用 WEAPON_COLOR 常量上色；
 * 这里落同一色值，让 GLB 在标准查看器/离线工具里也是把枪而不是一块白模。
 * 色值抄自 js/models.js#WEAPON_COLOR —— 两边必须一致，改一处要改两处。 */
const WEAPON_COLOR = { pistol: 0x4a4f55, rifle: 0x4a4d52, sniper: 0x4a4d52, shotgun: 0x4a4e54 };
const WEAPON_COLOR_FALLBACK = 0x2a2d33;
function hexToRgb(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}
function gunMaterial(key) {
  return solidMaterial(key, hexToRgb(WEAPON_COLOR[key] !== undefined ? WEAPON_COLOR[key] : WEAPON_COLOR_FALLBACK));
}

/* ============================================================
 * 4. GLB 回读解析（自检用，独立实现，不复用导出侧代码）
 * ============================================================ */
const COMP_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMP_READ = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
const TYPE_COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

function parseGlbFile(absPath) {
  const buf = fs.readFileSync(absPath);
  if (buf.length < 20) throw new DataError('GLB 太短: ' + rel(absPath));
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new DataError('GLB magic 错误: ' + rel(absPath));
  if (buf.readUInt32LE(4) !== 2) throw new DataError('GLB version ≠ 2: ' + rel(absPath));
  if (buf.readUInt32LE(8) !== buf.length) {
    throw new DataError('GLB 头部总长度 ' + buf.readUInt32LE(8) + ' ≠ 实际 ' + buf.length + ': ' + rel(absPath));
  }
  let off = 12;
  let json = null;
  let bin = null;
  let chunkNo = 0;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (len % 4 !== 0) throw new DataError('GLB chunk 长度未 4 字节对齐: ' + rel(absPath));
    const data = buf.slice(off + 8, off + 8 + len);
    if (chunkNo === 0 && type !== 'JSON') throw new DataError('GLB 首个 chunk 不是 JSON: ' + rel(absPath));
    if (type === 'JSON') {
      const text = data.toString('utf8');
      const trimmed = text.replace(/ +$/, '');
      const padding = text.length - trimmed.length;
      // JSON 4 字节对齐只允许用空格(0x20)填充，且最多 3 个
      if (padding > 3) throw new DataError('JSON chunk 尾部填充 ' + padding + ' 字节（只允许 0-3 个空格）: ' + rel(absPath));
      if (padding > 0 && !/^ +$/.test(text.slice(trimmed.length))) {
        throw new DataError('JSON 尾部填充不是空格: ' + rel(absPath));
      }
      json = JSON.parse(trimmed);
      if (!json || typeof json !== 'object') throw new DataError('JSON chunk 不是对象: ' + rel(absPath));
    } else if (type === 'BIN\0') {
      bin = data;
    } else {
      throw new DataError('未知 chunk 类型 ' + JSON.stringify(type) + ': ' + rel(absPath));
    }
    off += 8 + len;
    chunkNo++;
  }
  if (!json) throw new DataError('GLB 缺 JSON chunk: ' + rel(absPath));
  if (!bin) throw new DataError('GLB 缺 BIN chunk: ' + rel(absPath));
  if (json.buffers && json.buffers[0] && json.buffers[0].byteLength > bin.length) {
    throw new DataError('buffer.byteLength > BIN chunk 长度: ' + rel(absPath));
  }
  return { json: json, bin: bin, bytes: buf.length };
}

function readAccessor(glb, accIdx) {
  const json = glb.json;
  const acc = json.accessors[accIdx];
  if (!acc) throw new DataError('accessor #' + accIdx + ' 不存在');
  const nComp = TYPE_COMP[acc.type];
  const compSize = COMP_BYTES[acc.componentType];
  if (!nComp || !compSize) throw new DataError('accessor #' + accIdx + ' 类型不支持: ' + acc.type + '/' + acc.componentType);
  if (acc.bufferView === undefined) throw new DataError('accessor #' + accIdx + ' 无 bufferView（sparse 不支持）');
  const bv = json.bufferViews[acc.bufferView];
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = bv.byteStride || compSize * nComp;
  if (byteOffset + stride * (acc.count - 1) + compSize * nComp > binLength(glb)) {
    throw new DataError('accessor #' + accIdx + ' 越界');
  }
  const out = new Float64Array(acc.count * nComp);
  for (let i = 0; i < acc.count; i++) {
    for (let c = 0; c < nComp; c++) {
      out[i * nComp + c] = glb.bin[COMP_READ[acc.componentType]](byteOffset + i * stride + c * compSize);
    }
  }
  return { acc: acc, data: out, nComp: nComp };
}
function binLength(glb) { return glb.bin.length; }

/* ============================================================
 * 5. 自检：把产物回读，逐值与原始 base64 数据比对
 * ============================================================ */
function near(a, b) { return a === b || (Number.isNaN(a) && Number.isNaN(b)); }

function compareArray(label, got, want, failures) {
  if (got.length !== want.length) {
    failures.push(label + ': 元素个数 ' + got.length + ' ≠ 期望 ' + want.length);
    return;
  }
  let bad = 0;
  let firstBad = -1;
  for (let i = 0; i < want.length; i++) {
    if (!near(got[i], want[i])) { bad++; if (firstBad < 0) firstBad = i; }
  }
  if (bad) failures.push(label + ': ' + bad + '/' + want.length + ' 个值不一致（首个 #' + firstBad + ' ' + got[firstBad] + ' ≠ ' + want[firstBad] + '）');
}

const ATTR_MAP = [
  ['POSITION', 'pos', 3],
  ['NORMAL', 'nor', 3],
  ['TEXCOORD_0', 'uv', 2],
  ['COLOR_0', 'col', 3],
];

/* 校验一个 .glb 与一组期望几何是否逐值一致 */
function verifyGlb(relFile, spec, failures) {
  const abs = path.join(ROOT, relFile);
  const info = { file: relFile, bytes: 0, meshes: 0, verts: 0, tris: 0, bbox: null, ok: false };
  if (!fs.existsSync(abs)) { failures.push(relFile + ': 产物不存在'); return info; }
  let glb;
  try { glb = parseGlbFile(abs); } catch (e) { failures.push(relFile + ': 容器解析失败 — ' + e.message); return info; }
  info.bytes = glb.bytes;
  const json = glb.json;

  // --- 容器/结构 ---
  if (!json.asset || json.asset.version !== '2.0') failures.push(relFile + ': asset.version ≠ "2.0"');
  if (json.scene !== 0 || !json.scenes || !json.scenes[0]) failures.push(relFile + ': 缺少默认 scene');
  if (!json.buffers || json.buffers.length !== 1) failures.push(relFile + ': buffers 数量 ≠ 1');
  const meshCount = (json.meshes || []).length;
  info.meshes = meshCount;
  if (meshCount !== spec.prims.length) {
    failures.push(relFile + ': mesh 数 ' + meshCount + ' ≠ 期望 ' + spec.prims.length);
    return info;
  }

  // --- 每个 mesh 的几何逐值比对 ---
  for (let mi = 0; mi < meshCount; mi++) {
    const mesh = json.meshes[mi];
    if (!mesh.primitives || mesh.primitives.length !== 1) {
      failures.push(relFile + ' mesh#' + mi + ': primitive 数 ≠ 1');
      continue;
    }
    const prim = mesh.primitives[0];
    const want = spec.prims[mi].geo;
    const tag = relFile + ' mesh#' + mi + (spec.prims[mi].name ? '(' + spec.prims[mi].name + ')' : '');
    if (prim.mode !== 4) failures.push(tag + ': mode ≠ 4 (TRIANGLES)');
    if (prim.indices === undefined) { failures.push(tag + ': 缺 indices'); continue; }
    const idxAcc = readAccessor(glb, prim.indices);
    if (idxAcc.acc.componentType !== 5123) failures.push(tag + ': indices componentType ≠ 5123 (Uint16)');
    compareArray(tag + ' indices', idxAcc.data, Float64Array.from(want.idx), failures);
    info.tris += idxAcc.acc.count / 3;
    if (idxAcc.acc.count % 3 !== 0) failures.push(tag + ': 索引数 ' + idxAcc.acc.count + ' 不是 3 的倍数');

    // 属性集合必须与期望完全一致
    const gotAttrs = Object.keys(prim.attributes).sort();
    const wantAttrs = ATTR_MAP.filter((a) => want[a[1]]).map((a) => a[0]).sort();
    if (gotAttrs.join(',') !== wantAttrs.join(',')) {
      failures.push(tag + ': 属性集 [' + gotAttrs.join(',') + '] ≠ 期望 [' + wantAttrs.join(',') + ']');
    }
    let posAcc = null;
    for (const a of ATTR_MAP) {
      const [attrName, key, nComp] = a;
      const accIdx = prim.attributes[attrName];
      const wantData = want[key];
      if (accIdx === undefined) {
        if (wantData) failures.push(tag + ': 缺属性 ' + attrName);
        continue;
      }
      const got = readAccessor(glb, accIdx);
      if (got.acc.componentType !== 5126) failures.push(tag + ' ' + attrName + ': componentType ≠ 5126 (Float32)');
      if (got.acc.count !== want.vtx) failures.push(tag + ' ' + attrName + ': count ' + got.acc.count + ' ≠ 顶点数 ' + want.vtx);
      if (got.nComp !== nComp) failures.push(tag + ' ' + attrName + ': 分量数 ' + got.nComp + ' ≠ ' + nComp);
      compareArray(tag + ' ' + attrName, got.data, Float64Array.from(wantData), failures);
      if (attrName === 'POSITION') {
        posAcc = got;
        // min/max 必须存在且逐值正确
        if (!got.acc.min || !got.acc.max) {
          failures.push(tag + ': POSITION 缺 min/max');
        } else {
          const mn = [Infinity, Infinity, Infinity];
          const mx = [-Infinity, -Infinity, -Infinity];
          for (let v = 0; v < want.vtx; v++) {
            for (let c = 0; c < 3; c++) {
              const val = want.pos[v * 3 + c];
              if (val < mn[c]) mn[c] = val;
              if (val > mx[c]) mx[c] = val;
            }
          }
          compareArray(tag + ' POSITION.min', Float64Array.from(got.acc.min), Float64Array.from(mn), failures);
          compareArray(tag + ' POSITION.max', Float64Array.from(got.acc.max), Float64Array.from(mx), failures);
          info.bbox = { min: mn.map((x) => +x.toFixed(4)), max: mx.map((x) => +x.toFixed(4)) };
        }
      }
      if (attrName === 'POSITION') info.verts += got.acc.count;
    }
    // 材质
    if (prim.material === undefined) {
      if (spec.prims[mi].material) failures.push(tag + ': 缺 material');
    } else if (spec.prims[mi].material) {
      const gotMat = json.materials[prim.material];
      const wantMat = spec.prims[mi].material;
      const gb = gotMat && gotMat.pbrMetallicRoughness && gotMat.pbrMetallicRoughness.baseColorFactor;
      if (!gb) failures.push(tag + ': 材质缺 baseColorFactor');
      else compareArray(tag + ' baseColorFactor', Float64Array.from(gb), Float64Array.from(wantMat.baseColorFactor), failures);
      if (gotMat && gotMat.pbrMetallicRoughness) {
        if (gotMat.pbrMetallicRoughness.metallicFactor !== wantMat.metallicFactor) failures.push(tag + ': metallicFactor ≠ ' + wantMat.metallicFactor);
        if (gotMat.pbrMetallicRoughness.roughnessFactor !== wantMat.roughnessFactor) failures.push(tag + ': roughnessFactor ≠ ' + wantMat.roughnessFactor);
      }
    }
  }

  // --- 节点层级 ---
  if (spec.nodes) {
    const nodes = json.nodes || [];
    if (nodes.length !== spec.nodes.length) failures.push(relFile + ': node 数 ' + nodes.length + ' ≠ 期望 ' + spec.nodes.length);
    for (const exp of spec.nodes) {
      const node = nodes.find((n) => n.name === exp.name);
      if (!node) { failures.push(relFile + ': 缺 node "' + exp.name + '"'); continue; }
      if (exp.translation) compareArray(relFile + ' node "' + exp.name + '" translation', Float64Array.from(node.translation || []), Float64Array.from(exp.translation), failures);
      if (exp.parent !== undefined) {
        const parentIdx = nodes.findIndex((n) => n.name === exp.parent);
        if (parentIdx < 0) { failures.push(relFile + ': 找不到 parent "' + exp.parent + '"'); continue; }
        const kids = nodes[parentIdx].children || [];
        const selfIdx = nodes.indexOf(node);
        if (!kids.includes(selfIdx)) failures.push(relFile + ': node "' + exp.name + '" 不是 "' + exp.parent + '" 的子节点');
        const inScene = (json.scenes[0].nodes || []).includes(selfIdx);
        if (inScene) failures.push(relFile + ': node "' + exp.name + '" 同时挂在场景根（应只在父节点下）');
      } else {
        const selfIdx = nodes.indexOf(node);
        if (!(json.scenes[0].nodes || []).includes(selfIdx)) failures.push(relFile + ': node "' + exp.name + '" 未挂在场景根');
      }
      if (exp.meshName) {
        const m = json.meshes[node.mesh];
        if (!m || m.name !== exp.meshName) failures.push(relFile + ': node "' + exp.name + '" 的 mesh 名 ≠ ' + exp.meshName);
      }
    }
  }

  // --- 顶层 extras ---
  if (spec.extras) {
    const got = json.extras || {};
    for (const k of Object.keys(spec.extras)) {
      const a = got[k];
      const b = spec.extras[k];
      if (Array.isArray(b)) {
        if (!Array.isArray(a)) failures.push(relFile + ': extras.' + k + ' 缺失或不是数组');
        else compareArray(relFile + ': extras.' + k, Float64Array.from(a), Float64Array.from(b), failures);
      } else if (a !== b) {
        failures.push(relFile + ': extras.' + k + ' = ' + a + ' ≠ ' + b);
      }
    }
  }

  info.ok = !failures.some((f) => f.startsWith(relFile));
  return info;
}

/* ============================================================
 * 6. 导出
 * ============================================================ */
const GENERATOR = 'tools/export_assets.cjs (inline base64 -> glTF 2.0 .glb)';
const warnings = [];
const outputs = [];

function collectWarnings(_name, geo) {
  for (const w of geo.warnings) warnings.push(w.text);
}

/* ---- 6.1 士兵：7 个 node 的真层级，gun 挂 armR ---- */
function exportSoldier() {
  const data = loadInline('models/soldier_data.js', 'SOLDIER_DATA');
  if (!Array.isArray(data) || data.length !== 7) {
    throw new DataError('SOLDIER_DATA 应为 7 条数组，实际 ' + (Array.isArray(data) ? data.length : typeof data));
  }
  const parts = data.map((p, i) => {
    const name = p.name;
    if (typeof name !== 'string' || !name) throw new DataError('SOLDIER_DATA[' + i + '].name 缺失');
    const geo = checkGeometry('SOLDIER_DATA[' + i + '](' + name + ')', p, { requireNormal: true });
    collectWarnings(name, geo);
    return { name: name, geo: geo, pivot: p.pivot, rel: p.rel, parent: p.parent || null, color: p.color };
  });
  const names = parts.map((p) => p.name).sort().join(',');
  if (names !== 'armL,armR,gun,head,legL,legR,torso') {
    throw new DataError('SOLDIER_DATA 节点名不符合契约（torso/head/armL/armR/legL/legR/gun），实际: ' + names);
  }

  const w = new GlbWriter(GENERATOR);
  const idxByName = {};
  parts.forEach((part, i) => {
    if (!Array.isArray(part.color) || part.color.length !== 3) throw new DataError(part.name + ': color 必须是 [r,g,b]');
    const mat = solidMaterial(part.name, part.color);
    const matIdx = w.addMaterial(mat);
    const prim = w.addPrimitive(part.geo, matIdx);
    w.json.meshes.push({ name: part.name, primitives: [prim] });
    const translation = part.parent ? (part.rel || part.pivot) : part.pivot;
    const node = { name: part.name, mesh: w.json.meshes.length - 1 };
    if (Array.isArray(translation)) node.translation = [translation[0], translation[1], translation[2]];
    w.json.nodes.push(node);
    idxByName[part.name] = w.json.nodes.length - 1;
  });
  // 层级：gun 挂 armR，其余挂场景根
  parts.forEach((part, i) => {
    const selfIdx = idxByName[part.name];
    if (part.parent) {
      const pIdx = idxByName[part.parent];
      if (pIdx === undefined) throw new DataError(part.name + ': parent "' + part.parent + '" 不存在');
      const pNode = w.json.nodes[pIdx];
      pNode.children = pNode.children || [];
      pNode.children.push(selfIdx);
    } else {
      w.json.scenes[0].nodes.push(selfIdx);
    }
  });

  const abs = path.join(MODELS, 'soldier.glb');
  const bytes = w.write(abs);
  outputs.push({ file: 'models/soldier.glb', bytes: bytes, meshes: parts.length, verts: parts.reduce((s, p) => s + p.geo.vtx, 0), tris: parts.reduce((s, p) => s + p.geo.tri, 0) });
  return parts;
}

/* ---- 6.2 武器：POSITION/NORMAL/TEXCOORD_0 + Uint16（无 COLOR_0） ---- */
function exportWeapons() {
  const data = loadInline('models/weapons_data.js', 'WEAPONS_DATA');
  const keys = Object.keys(data);
  const out = [];
  for (const key of keys) {
    const geo = checkGeometry('WEAPONS_DATA[' + key + ']', data[key], { requireNormal: true });
    collectWarnings(key, geo);
    const w = new GlbWriter(GENERATOR);
    w.addSingleMeshGlb(key, key, geo, gunMaterial(key));
    const abs = path.join(MODELS, 'guns', key + '.glb');
    const bytes = w.write(abs);
    outputs.push({ file: 'models/guns/' + key + '.glb', bytes: bytes, meshes: 1, verts: geo.vtx, tris: geo.tri });
    out.push({ key: key, geo: geo });
  }
  return out;
}

/* ---- 6.3 枪栓：POSITION/COLOR_0 + Uint16，顶层 extras 三个标量 ---- */
function exportGunBolts() {
  const data = loadInline('models/gun_glb_data.js', 'GUN_GLB_DATA');
  const keys = Object.keys(data);
  const out = [];
  for (const key of keys) {
    const e = data[key];
    if (!e || !e.bolt) throw new DataError('GUN_GLB_DATA[' + key + '].bolt 缺失');
    const geo = checkGeometry('GUN_GLB_DATA[' + key + '].bolt', e.bolt, { requireNormal: false });
    collectWarnings('gun_bolt:' + key, geo);
    const extras = {
      boltRest: Array.isArray(e.boltRest) ? [e.boltRest[0], e.boltRest[1], e.boltRest[2]] : [0, 0, 0],
      boltTravel: e.boltTravel,
      zExt: e.zExt,
    };
    const w = new GlbWriter(GENERATOR);
    w.addSingleMeshGlb(key + '_bolt', key + '_bolt', geo, vertexColorMaterial(key + '_bolt'), extras);
    const abs = path.join(MODELS, 'guns', key + '_bolt.glb');
    const bytes = w.write(abs);
    outputs.push({ file: 'models/guns/' + key + '_bolt.glb', bytes: bytes, meshes: 1, verts: geo.vtx, tris: geo.tri });
    out.push({ key: key, geo: geo, extras: extras });
  }
  return out;
}

/* ---- 6.4 建筑：BUILDINGS_DATA ∪ BUILDINGS_OUT（POSITION/NORMAL/COLOR_0 + Uint16） ---- */
function exportBuildings() {
  const legacy = loadInline('models/buildings_data.js', 'BUILDINGS_DATA');
  const newer = loadInline('models/buildings_out.js', 'BUILDINGS_OUT');
  const jobs = [];
  for (const key of Object.keys(legacy)) jobs.push({ key: key, src: 'BUILDINGS_DATA', raw: legacy[key] });
  for (const key of Object.keys(newer)) {
    if (legacy[key]) throw new DataError('BUILDINGS_DATA 与 BUILDINGS_OUT 同时存在 key "' + key + '"，产物路径会冲突');
    jobs.push({ key: key, src: 'BUILDINGS_OUT', raw: newer[key] });
  }
  const out = [];
  for (const job of jobs) {
    const geo = checkGeometry(job.src + '[' + job.key + ']', job.raw, { requireNormal: true });
    collectWarnings(job.key, geo);
    const w = new GlbWriter(GENERATOR);
    w.addSingleMeshGlb(job.key, job.key, geo, vertexColorMaterial(job.key));
    const abs = path.join(MODELS, 'buildings', job.key + '.glb');
    const bytes = w.write(abs);
    outputs.push({ file: 'models/buildings/' + job.key + '.glb', bytes: bytes, meshes: 1, verts: geo.vtx, tris: geo.tri });
    out.push({ key: job.key, geo: geo, src: job.src });
  }

  // 来源分组提示：gen_manifest.cjs 把它写进 manifest.buildingGroups。
  // 运行时 BuildingLib.build() 用 buildingSource() 决定是否按地图 dims 缩放——
  // legacy 5 型几何不参与缩放，分组缺失/错乱会让它们被非等比拉伸。
  const hintAbs = path.join(MODELS, '.building-groups.json');
  const hint = {
    generator: GENERATOR,
    legacy: jobs.filter((j) => j.src === 'BUILDINGS_DATA').map((j) => j.key).sort(),
    out: jobs.filter((j) => j.src === 'BUILDINGS_OUT').map((j) => j.key).sort(),
  };
  fs.writeFileSync(hintAbs, JSON.stringify(hint, null, 2) + '\n');
  outputs.push({ file: 'models/.building-groups.json', bytes: fs.statSync(hintAbs).size, hint: true });
  return out;
}

/* ============================================================
 * 7. 全量自检（重新读原始内联数据 → 与磁盘上的 .glb 逐值比对）
 * ============================================================ */
function runVerification() {
  const failures = [];
  const infos = [];

  /* --- 士兵 --- */
  {
    const parts = loadInline('models/soldier_data.js', 'SOLDIER_DATA');
    const spec = {
      prims: parts.map((p) => ({
        name: p.name,
        geo: checkGeometry('SOLDIER_DATA(' + p.name + ')', p, { requireNormal: true }),
        material: { baseColorFactor: [p.color[0], p.color[1], p.color[2], 1], metallicFactor: 0, roughnessFactor: 1 },
      })),
      nodes: parts.map((p) => ({
        name: p.name,
        translation: p.parent ? (p.rel || p.pivot) : p.pivot,
        parent: p.parent || undefined,
        meshName: p.name,
      })),
    };
    infos.push(verifyGlb('models/soldier.glb', spec, failures));
    // 额外断言：7 个 node 名字齐全 + gun 的父节点是 armR
    const glb = parseGlbFile(path.join(ROOT, 'models/soldier.glb'));
    const nodes = glb.json.nodes;
    const want = ['torso', 'head', 'armL', 'armR', 'legL', 'legR', 'gun'];
    if (nodes.length !== 7) failures.push('models/soldier.glb: node 数 ' + nodes.length + ' ≠ 7');
    for (const n of want) if (!nodes.some((x) => x.name === n)) failures.push('models/soldier.glb: 缺 node "' + n + '"');
    const armR = nodes.findIndex((x) => x.name === 'armR');
    const gun = nodes.findIndex((x) => x.name === 'gun');
    if (armR < 0 || gun < 0) failures.push('models/soldier.glb: armR / gun 节点缺失');
    else {
      if (!(nodes[armR].children || []).includes(gun)) failures.push('models/soldier.glb: gun 的父节点不是 armR');
      if ((glb.json.scenes[0].nodes || []).includes(gun)) failures.push('models/soldier.glb: gun 被错误地挂在场景根');
      if ((nodes[gun].children || []).length !== 0) failures.push('models/soldier.glb: gun 不应有子节点');
    }
    const rootNodes = (glb.json.scenes[0].nodes || []).map((i) => nodes[i].name).sort().join(',');
    if (rootNodes !== 'armL,armR,head,legL,legR,torso') failures.push('models/soldier.glb: 场景根节点集合 ≠ ' + rootNodes);
  }

  /* --- 武器 --- */
  {
    const data = loadInline('models/weapons_data.js', 'WEAPONS_DATA');
    for (const key of Object.keys(data)) {
      const geo = checkGeometry('WEAPONS_DATA[' + key + ']', data[key], { requireNormal: true });
      const wantMat = gunMaterial(key).pbrMetallicRoughness;
      infos.push(verifyGlb('models/guns/' + key + '.glb', {
        prims: [{ name: key, geo: geo, material: { baseColorFactor: wantMat.baseColorFactor, metallicFactor: wantMat.metallicFactor, roughnessFactor: wantMat.roughnessFactor } }],
        nodes: [{ name: key, meshName: key }],
      }, failures));
    }
  }

  /* --- 枪栓 --- */
  {
    const data = loadInline('models/gun_glb_data.js', 'GUN_GLB_DATA');
    for (const key of Object.keys(data)) {
      const e = data[key];
      const geo = checkGeometry('GUN_GLB_DATA[' + key + '].bolt', e.bolt);
      infos.push(verifyGlb('models/guns/' + key + '_bolt.glb', {
        prims: [{ name: key + '_bolt', geo: geo, material: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
        nodes: [{ name: key + '_bolt', meshName: key + '_bolt' }],
        extras: { boltRest: e.boltRest, boltTravel: e.boltTravel, zExt: e.zExt },
      }, failures));
    }
  }

  /* --- 建筑 --- */
  {
    const legacy = loadInline('models/buildings_data.js', 'BUILDINGS_DATA');
    const newer = loadInline('models/buildings_out.js', 'BUILDINGS_OUT');
    for (const [src, table] of [['BUILDINGS_DATA', legacy], ['BUILDINGS_OUT', newer]]) {
      for (const key of Object.keys(table)) {
        const geo = checkGeometry(src + '[' + key + ']', table[key], { requireNormal: true });
        infos.push(verifyGlb('models/buildings/' + key + '.glb', {
          prims: [{ name: key, geo: geo, material: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
          nodes: [{ name: key, meshName: key }],
        }, failures));
      }
    }
  }

  return { infos: infos, failures: failures };
}

/* ---- 7.2 资源清单一致性（models/manifest.json 由 tools/gen_manifest.cjs 生成） ----
 * 清单是 AssetLoader 的唯一入口：少一条 = 该模型加载不到，多一条 = 启动即 404 红条。
 * 这里按 gen_manifest.cjs 的同一规则从磁盘重算一遍再比对，防止"导出了却没进清单"。 */
function listGlb(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.glb')).sort();
}
function expectedManifest() {
  const gunsAbs = path.join(MODELS, 'guns');
  const bldAbs = path.join(MODELS, 'buildings');
  const exp = { soldier: null, weapons: {}, bolts: {}, buildings: {} };
  if (fs.existsSync(path.join(MODELS, 'soldier.glb'))) exp.soldier = 'soldier.glb';
  for (const f of listGlb(gunsAbs)) {
    const base = f.replace(/\.glb$/i, '');
    if (/_bolt$/.test(base)) exp.bolts[base.replace(/_bolt$/, '')] = 'guns/' + f;
    else exp.weapons[base] = 'guns/' + f;
  }
  for (const f of listGlb(bldAbs)) exp.buildings[f.replace(/\.glb$/i, '')] = 'buildings/' + f;
  return exp;
}
function verifyManifest() {
  const failures = [];
  const notes = [];
  const abs = path.join(MODELS, 'manifest.json');
  const exp = expectedManifest();
  if (!fs.existsSync(abs)) {
    notes.push('models/manifest.json 尚未生成 —— 跑 node tools/gen_manifest.cjs（AssetLoader 启动时先取它）');
    return { failures: failures, notes: notes };
  }
  let man;
  try {
    man = JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    failures.push('models/manifest.json 不是合法 JSON: ' + e.message);
    return { failures: failures, notes: notes };
  }
  const cmp = (label, got, want) => {
    const g = Object.keys(got || {}).sort();
    const w = Object.keys(want || {}).sort();
    if (g.join(',') !== w.join(',')) {
      failures.push('manifest.' + label + ' 键集 [' + g.join(',') + '] ≠ 磁盘产物 [' + w.join(',') + ']（清单过期？重跑 gen_manifest.cjs）');
      return;
    }
    for (const k of w) if (got[k] !== want[k]) failures.push('manifest.' + label + '.' + k + ' = ' + got[k] + ' ≠ ' + want[k]);
  };
  if (man.soldier !== exp.soldier) failures.push('manifest.soldier = ' + man.soldier + ' ≠ ' + exp.soldier);
  cmp('weapons', man.weapons, exp.weapons);
  cmp('bolts', man.bolts, exp.bolts);
  cmp('buildings', man.buildings, exp.buildings);

  // 分组：legacy 5 型不得进 out（否则运行时会把它们按地图 dims 非等比拉伸）
  const hintAbs = path.join(MODELS, '.building-groups.json');
  if (fs.existsSync(hintAbs)) {
    try {
      const hint = JSON.parse(fs.readFileSync(hintAbs, 'utf8'));
      const groups = man.buildingGroups || { legacy: [], out: [] };
      for (const k of hint.legacy || []) {
        if (!(groups.legacy || []).includes(k)) failures.push('manifest.buildingGroups.legacy 缺 "' + k + '"（legacy 建筑会被当成新类型缩放）');
        if ((groups.out || []).includes(k)) failures.push('manifest.buildingGroups.out 误含 legacy 建筑 "' + k + '"');
      }
      for (const k of hint.out || []) {
        if (!(groups.out || []).includes(k)) failures.push('manifest.buildingGroups.out 缺 "' + k + '"');
      }
    } catch (e) {
      failures.push('models/.building-groups.json 不是合法 JSON: ' + e.message);
    }
  } else {
    failures.push('models/.building-groups.json 缺失（导出未完成？legacy/out 分组无从得知）');
  }
  return { failures: failures, notes: notes };
}

/* ============================================================
 * 8. 主流程 + 报告
 * ============================================================ */
function printTable(rows) {
  const cols = ['产物', '字节', 'mesh', '顶点', '三角形', 'bbox(min ~ max)'];
  const table = rows.map((r) => [
    r.file,
    String(r.bytes),
    String(r.meshes),
    String(r.verts),
    String(r.tris),
    r.bbox ? '[' + r.bbox.min.join(',') + '] ~ [' + r.bbox.max.join(',') + ']' : '',
  ]);
  const widths = cols.map((c, i) => Math.max(c.length, ...table.map((t) => (t[i] || '').length)));
  const line = (cells) => cells.map((c, i) => c + ' '.repeat(widths[i] - c.length)).join('  ');
  console.log(line(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const t of table) console.log(line(t));
}

function main() {
  console.log('=== export_assets.cjs — 内联 base64 → glTF 2.0 .glb ===');
  console.log(VERIFY_ONLY ? '模式: 仅自检（不写文件）' : '模式: 导出 + 自检');
  console.log('');

  if (!VERIFY_ONLY) {
    exportSoldier();
    exportWeapons();
    exportGunBolts();
    exportBuildings();
    console.log('已写出 ' + outputs.filter((o) => !o.hint).length + ' 个 .glb' +
      (outputs.some((o) => o.hint) ? ' + 1 个分组提示文件' : ''));
    console.log('');
  }

  console.log('--- 自检（回读 .glb，与原始 base64 数据逐值比对）---');
  const vr = runVerification();
  const totalBytes = vr.infos.reduce((s, i) => s + i.bytes, 0);
  if (!QUIET) printTable(vr.infos);

  // 数据警告
  const uniqWarn = Array.from(new Set(warnings)).sort();
  if (uniqWarn.length) {
    console.log('');
    console.log('--- 数据缺陷告警（' + uniqWarn.length + ' 条，已按原语义确定性补齐，不影响几何/索引/bbox）---');
    for (const w of uniqWarn) console.log('  ! ' + w);
  }

  /* --- 资源清单一致性 --- */
  const mr = verifyManifest();
  if (mr.notes.length) {
    console.log('');
    for (const n of mr.notes) console.log('· ' + n);
  }

  const allFail = vr.failures.concat(mr.failures);
  const failFiles = new Set(allFail.map((f) => String(f).split(':')[0]));
  console.log('');
  console.log('--- 汇总 ---');
  console.log('产物: ' + vr.infos.length + ' 个 | 总字节: ' + totalBytes + ' (' + fmtBytes(totalBytes) + ')');
  console.log('mesh: ' + vr.infos.reduce((s, i) => s + i.meshes, 0) +
    ' | 顶点: ' + vr.infos.reduce((s, i) => s + i.verts, 0) +
    ' | 三角形: ' + vr.infos.reduce((s, i) => s + i.tris, 0));
  console.log('清单: ' + (mr.failures.length ? 'FAIL' : (mr.notes.length ? '未生成（跑 gen_manifest.cjs 即可，非导出缺陷）' : 'PASS（models/manifest.json 与磁盘产物一致）')));
  console.log('自检: ' + (allFail.length === 0 ? 'PASS（' + vr.infos.length + '/' + vr.infos.length + ' 个产物逐值一致）' : 'FAIL（' + failFiles.size + ' 处问题）'));
  if (allFail.length) {
    for (const f of allFail) console.log('  ✗ ' + f);
    process.exitCode = 1;
  }
  if (!VERIFY_ONLY) {
    console.log('');
    console.log('下一步: node tools/gen_manifest.cjs   # 重建 models/manifest.json（AssetLoader 的入口清单）');
  }
}

try {
  main();
} catch (e) {
  if (e instanceof DataError) {
    console.error('\n[数据契约不符] ' + e.message);
    console.error('已写出的产物可能不完整；修正数据或工具后重跑：node tools/export_assets.cjs');
    process.exitCode = 1;
  } else {
    throw e;
  }
}
