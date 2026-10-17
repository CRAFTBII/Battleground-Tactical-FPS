/* ============================================
 * 战地突击 · glb.js — 零依赖 glTF 2.0 二进制（.glb）解析器
 * 为什么手写：libs/GLTFLoader.js 是 ESM，本工程无构建、无 importmap、
 *   全局只有 UMD 的 libs/three.min.js，无法直接 import；而引入打包器又违背「零构建」。
 * 覆盖范围：只支持本项目资产实际用到的子集
 *   - glTF 2.0 容器（JSON chunk + BIN chunk）
 *   - accessor 分量类型：5120/5121/5122/5123/5125/5126
 *   - 顶点属性 POSITION / NORMAL / TEXCOORD_0 / COLOR_0
 *   - 索引（Uint16/Uint32/Uint8，含无索引的隐式三角列表）
 *   - node 层级 / translation / rotation / scale / matrix
 *   - material.pbrMetallicRoughness.baseColorFactor（无贴图）
 * 不支持（本项目不用）：skins / animations / morph targets / 贴图 / Draco / KHR_* 扩展
 * 用法：
 *   const g = GLB.parse(arrayBuffer);          // -> GLB 容器对象，失败 throw
 *   const geo = GLB.geometry(g, 0);            // -> THREE.BufferGeometry
 *   const node = GLB.nodeTransform(g, 2);      // -> THREE.Object3D（含变换）
 * ============================================ */

const GLB = {
  MAGIC: 0x46546c67,   // 'glTF' 小端
  CHUNK_JSON: 0x4e4f534a,
  CHUNK_BIN: 0x004e4942,
  assetBase: '',       // 资源根（同源部署时为 ''，测试里可指向本地目录）

  /* ---------- 容器解析 ---------- */
  parse(buffer) {
    const declared = buffer.byteLength;
    if (declared < 20) throw new Error('GLB 文件过小（' + declared + ' 字节）');
    const dv = new DataView(buffer);
    const magic = dv.getUint32(0, true);
    if (magic !== this.MAGIC) {
      const head = new Uint8Array(buffer, 0, 4);
      throw new Error('不是 GLB 文件（magic=' + Array.from(head).map(b => b.toString(16)).join('') + '，期望 glTF）');
    }
    const version = dv.getUint32(4, true);
    if (version !== 2) throw new Error('只支持 glTF 2.0，实际版本=' + version);
    const total = dv.getUint32(8, true);
    if (total > declared) throw new Error('GLB 头部声明长度 ' + total + ' 超过实际 ' + declared + '（文件被截断？）');

    let offset = 12, json = null, bin = null;
    while (offset + 8 <= total) {
      const chunkLen = dv.getUint32(offset, true);
      const chunkType = dv.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + chunkLen > total) throw new Error('GLB chunk 越界（offset=' + offset + ', len=' + chunkLen + '）');
      if (chunkType === this.CHUNK_JSON) {
        const bytes = new Uint8Array(buffer, start, chunkLen);
        let text = new TextDecoder('utf-8').decode(bytes);
        text = text.replace(/\u0000+$/g, '').trim();   // 去掉尾部对齐填充的 0
        try { json = JSON.parse(text); } catch (e) { throw new Error('GLB JSON chunk 解析失败: ' + e.message); }
      } else if (chunkType === this.CHUNK_BIN) {
        bin = { view: new DataView(buffer, start, chunkLen), buffer: buffer, offset: start, length: chunkLen };
      }
      offset = start + chunkLen;
    }
    if (!json) throw new Error('GLB 缺少 JSON chunk');
    if (!json.asset || String(json.asset.version).charAt(0) !== '2') {
      throw new Error('GLB asset.version 不是 2.x');
    }
    return { json, bin, raw: buffer, size: total };
  },

  /* ---------- accessor → 数组 ---------- */
  COMPONENT: {
    5120: { Array: Int8Array, size: 1, norm: 127 },
    5121: { Array: Uint8Array, size: 1, norm: 255 },
    5122: { Array: Int16Array, size: 2, norm: 32767 },
    5123: { Array: Uint16Array, size: 2, norm: 65535 },
    5125: { Array: Uint32Array, size: 4, norm: 4294967295 },
    5126: { Array: Float32Array, size: 4, norm: 1 }
  },
  TYPE_N: { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 },

  /** 读取 accessor，返回扁平的 TypedArray（numComponents 见 GLB.TYPE_N） */
  accessor(g, index) {
    const json = g.json;
    const acc = (json.accessors || [])[index];
    if (!acc) throw new Error('accessor #' + index + ' 不存在');
    const comp = this.COMPONENT[acc.componentType];
    if (!comp) throw new Error('不支持的 accessor componentType=' + acc.componentType);
    const n = this.TYPE_N[acc.type];
    if (!n) throw new Error('不支持的 accessor type=' + acc.type);
    const count = acc.count >>> 0;
    const total = count * n;

    // sparse / 无 bufferView：按规范补 0
    if (acc.bufferView === undefined) {
      const out = new comp.Array(total);
      return { array: out, count, numComponents: n, componentType: acc.componentType, normalized: !!acc.normalized };
    }
    const bv = json.bufferViews[acc.bufferView];
    if (!bv) throw new Error('accessor #' + index + ' 的 bufferView 不存在');
    if (!g.bin) throw new Error('accessor #' + index + ' 需要 BIN chunk，但文件里没有');

    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const stride = bv.byteStride || 0;
    const elemBytes = comp.size * n;
    const out = new comp.Array(total);

    if (!stride || stride === elemBytes) {
      // 紧凑布局：整段拷贝（Uint8Array 视图 + slice，避免未对齐访问）
      const abs = g.bin.offset + base;
      const bytes = new Uint8Array(g.raw, abs, elemBytes * count);
      const copy = bytes.slice();                       // 复制，规避 4 字节对齐问题
      out.set(new comp.Array(copy.buffer, 0, total));
    } else {
      // 交错布局：逐元素按 stride 取
      const dv = g.bin.view;
      for (let i = 0; i < count; i++) {
        const off = base + i * stride;
        for (let c = 0; c < n; c++) {
          const o = off + c * comp.size;
          let v;
          switch (acc.componentType) {
            case 5120: v = dv.getInt8(o); break;
            case 5121: v = dv.getUint8(o); break;
            case 5122: v = dv.getInt16(o, true); break;
            case 5123: v = dv.getUint16(o, true); break;
            case 5125: v = dv.getUint32(o, true); break;
            default:   v = dv.getFloat32(o, true); break;
          }
          out[i * n + c] = v;
        }
      }
    }
    return { array: out, count, numComponents: n, componentType: acc.componentType, normalized: !!acc.normalized };
  },

  /* ---------- primitive → BufferGeometry ---------- */
  ATTRIBUTES: { POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', COLOR_0: 'color' },

  geometry(g, meshIndex, primitiveIndex) {
    const json = g.json;
    const mesh = (json.meshes || [])[meshIndex];
    if (!mesh) throw new Error('mesh #' + meshIndex + ' 不存在');
    const prims = mesh.primitives || [];
    const pi = primitiveIndex || 0;
    const prim = prims[pi];
    if (!prim) throw new Error('mesh #' + meshIndex + ' 没有 primitive #' + pi);
    const mode = prim.mode === undefined ? 4 : prim.mode;
    if (mode !== 4) throw new Error('只支持三角形列表（mode=4），实际 mode=' + mode + '（mesh#' + meshIndex + '）');
    if (!prim.attributes || prim.attributes.POSITION === undefined) {
      throw new Error('mesh #' + meshIndex + ' 缺少 POSITION 属性');
    }

    const geo = new THREE.BufferGeometry();
    let vertexCount = 0;
    for (const [gltfName, threeName] of Object.entries(this.ATTRIBUTES)) {
      const accIndex = prim.attributes[gltfName];
      if (accIndex === undefined) continue;
      const a = this.accessor(g, accIndex);
      const itemSize = a.numComponents;
      let arr = a.array;
      // 归一化整型（COLOR_0 常见 Uint8/Uint16）：转成 0..1 的 Float32
      if (a.normalized && a.componentType !== 5126) {
        const max = this.COMPONENT[a.componentType].norm;
        const f = new Float32Array(arr.length);
        for (let i = 0; i < arr.length; i++) f[i] = arr[i] / max;
        arr = f;
      }
      geo.setAttribute(threeName, new THREE.BufferAttribute(arr, itemSize));
      if (gltfName === 'POSITION') vertexCount = a.count;
    }

    if (prim.indices !== undefined && prim.indices !== null) {
      const ia = this.accessor(g, prim.indices);
      geo.setIndex(new THREE.BufferAttribute(ia.array, 1));
    } else if (vertexCount % 3 === 0) {
      // 无索引 → 隐式 0..n-1
      const ia = vertexCount > 65535 ? new Uint32Array(vertexCount) : new Uint16Array(vertexCount);
      for (let i = 0; i < vertexCount; i++) ia[i] = i;
      geo.setIndex(new THREE.BufferAttribute(ia, 1));
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  },

  /* ---------- material → THREE.Material ---------- */
  material(g, index, opts) {
    const o = opts || {};
    const json = g.json;
    const mats = json.materials || [];
    const m = (index !== undefined && index !== null) ? mats[index] : null;
    if (!m) {
      // 无材质：有顶点色就用顶点色，否则用调用方兜底色
      return new THREE.MeshLambertMaterial({
        color: o.color !== undefined ? o.color : 0x9aa4b0,
        vertexColors: !!o.vertexColors,
        side: o.side || THREE.FrontSide
      });
    }
    const pbr = m.pbrMetallicRoughness || {};
    const bcf = pbr.baseColorFactor;
    const mat = new THREE.MeshLambertMaterial({
      color: bcf ? new THREE.Color(bcf[0], bcf[1], bcf[2]) : new THREE.Color(o.color !== undefined ? o.color : 0x9aa4b0),
      vertexColors: !!o.vertexColors && !bcf,
      side: m.doubleSided ? THREE.DoubleSide : (o.side || THREE.FrontSide)
    });
    mat.name = m.name || '';
    return mat;
  },

  /* ---------- node 变换 ---------- */
  nodeMatrix(node) {
    if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
    const m = new THREE.Matrix4();
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    m.compose(
      new THREE.Vector3(t[0], t[1], t[2]),
      new THREE.Quaternion(r[0], r[1], r[2], r[3]),
      new THREE.Vector3(s[0], s[1], s[2])
    );
    return m;
  },

  /* ---------- 把整个场景建成 THREE.Group（保留 node 名字与层级） ---------- */
  scene(g, opts) {
    const o = opts || {};
    const json = g.json;
    const nodes = json.nodes || [];
    const meshes = json.meshes || [];
    const makeNode = (idx, depth) => {
      if (depth > 32) throw new Error('node 层级过深（疑似循环引用）');
      const node = nodes[idx];
      if (!node) throw new Error('node #' + idx + ' 不存在');
      const obj = new THREE.Group();
      obj.name = node.name || ('node' + idx);
      obj.applyMatrix4(this.nodeMatrix(node));
      if (node.mesh !== undefined) {
        const prims = (meshes[node.mesh] || {}).primitives || [];
        for (let p = 0; p < prims.length; p++) {
          const geo = this.geometry(g, node.mesh, p);
          const mat = this.material(g, prims[p].material, Object.assign({}, o, {
            vertexColors: geo.attributes.color !== undefined
          }));
          const mesh = new THREE.Mesh(geo, mat);
          mesh.name = obj.name;
          mesh.castShadow = o.castShadow !== false;
          mesh.receiveShadow = o.receiveShadow !== false;
          obj.add(mesh);
        }
      }
      for (const c of node.children || []) obj.add(makeNode(c, depth + 1));
      return obj;
    };

    const root = new THREE.Group();
    const sceneDef = (json.scenes || [])[json.scene || 0];
    const roots = sceneDef && sceneDef.nodes ? sceneDef.nodes : nodes.map((_, i) => i).filter(i => {
      // 兜底：没有 scenes 时取不是任何节点子节点的节点
      return !nodes.some(n => (n.children || []).includes(i));
    });
    for (const idx of roots) root.add(makeNode(idx, 0));
    root.userData.gltfExtras = json.extras || null;
    return root;
  },

  /* ---------- 取 mesh 级单一几何（本项目多数资产是单 mesh 单 primitive） ---------- */
  firstGeometry(g) {
    return this.geometry(g, 0, 0);
  },

  /* ---------- 便于诊断：资产摘要 ---------- */
  describe(g) {
    const j = g.json;
    return {
      meshes: (j.meshes || []).length,
      nodes: (j.nodes || []).length,
      materials: (j.materials || []).length,
      triangles: (j.meshes || []).reduce((s, m) => s + (m.primitives || []).reduce((t, p) => {
        if (p.indices === undefined || p.indices === null) {
          const a = j.accessors[p.attributes.POSITION];
          return t + Math.floor(a.count / 3);
        }
        return t + Math.floor(j.accessors[p.indices].count / 3);
      }, 0), 0)
    };
  }
};

if (typeof window !== 'undefined') window.GLB = GLB;
