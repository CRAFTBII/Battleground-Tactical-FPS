# -*- coding: utf-8 -*-
"""
把真实武器 GLB（models/glb/{key}_body.glb / {key}_bolt.glb）烤成内联 JS 数据，
供 battlegame 第一人称武器直接构建（无 fetch / 无 GLTFLoader / 离线 file:// 可玩）。

坐标重映射（关键）：
  GLB 约定(+X=枪口, +Z=上, +Y=右)  ->  第一人称局部(-Z=枪口前, +Y=上, +X=右)
  点 (x,y,z) -> (y, z, -x)   行列式 +1（合法旋转，不镜像）

法线不在 Python 端算（trimesh 本版缺 compute_vertex_normals 且需 scipy），
改为在 JS 端用 THREE.BufferGeometry.computeVertexNormals() 生成。

输出 window.GUN_GLB_DATA[key] = {
  body: {pos, col, idx},        # base64(little-endian f32/f32/u16)，nor 在 JS 端算
  bolt: {pos, col, idx},
  boltRest:  [x,y,z],           # 枪栓相对枪身中心的静止坐标(预缩放, FP-ready)
  boltTravel:number,            # 拉栓行程(沿 +Z 后坐, 预缩放)
  zExt:number                   # 枪身 Z 向长度(预缩放)
}
"""
import os, base64
import numpy as np
import trimesh

BASE = os.path.join(os.path.dirname(__file__), "..", "models", "glb")
OUT = os.path.join(os.path.dirname(__file__), "..", "models", "gun_glb_data.js")

WEAPON_LEN = {"pistol": 0.42, "rifle": 0.78, "sniper": 1.1, "shotgun": 0.9}
KEYS = ["pistol", "rifle", "sniper", "shotgun"]


def remap(v):
    # (x,y,z) -> (y, z, -x)
    return np.array([v[1], v[2], -v[0]], dtype=np.float64)


def _extract(g):
    """从单个 trimesh 几何取出 (V, F, C)（N×3 / M×3 / N×3），法线忽略。"""
    V = np.asarray(g.vertices, dtype=np.float64)
    F = np.asarray(g.faces, dtype=np.int64)
    # 顶点色：trimesh 存的是 uint8(0-255)，THREE vertexColors 需要 0-1，必须除 255
    if hasattr(g.visual, "vertex_colors") and g.visual.vertex_colors is not None:
        vc = np.asarray(g.visual.vertex_colors, dtype=np.float64)
        if vc.shape[1] >= 3:
            C = (vc[:, :3] / 255.0).copy()
        else:
            C = np.tile(0.6, (len(V), 3))
    else:
        C = np.tile(0.6, (len(V), 3))
    return V, F, C


def load_mesh(name):
    p = os.path.join(BASE, name)
    if not os.path.exists(p):
        raise FileNotFoundError(p)
    obj = trimesh.load(p, process=False)
    Vs, Fs, Cs = [], [], []
    if isinstance(obj, trimesh.Scene):
        for node in obj.graph.nodes_geometry:
            T = obj.graph.get(node)[0]
            g = obj.geometry[node].copy()
            g.apply_transform(T)
            V, F, C = _extract(g)
            if len(V):
                off = sum(len(x) for x in Vs)
                Vs.append(V); Fs.append(F + off); Cs.append(C)
    else:
        V, F, C = _extract(obj)
        if len(V):
            Vs.append(V); Fs.append(F); Cs.append(C)
    if not Vs:
        raise ValueError("empty mesh: " + name)
    V = np.vstack(Vs)
    F = np.vstack(Fs)
    C = np.vstack(Cs)
    # 重映射坐标（旋转）
    Vr = np.empty_like(V)
    for i in range(len(V)):
        Vr[i] = remap(V[i])
    return Vr, F, C


def encode_f32(arr):
    return base64.b64encode(np.asarray(arr, dtype="<f4").tobytes()).decode("ascii")


def encode_u16(arr):
    return base64.b64encode(np.asarray(arr, dtype="<u2").tobytes()).decode("ascii")


def bake():
    data = {}
    for key in KEYS:
        Vb, Fb, Cb = load_mesh(f"{key}_body.glb")
        Vl, Fl, Cl = load_mesh(f"{key}_bolt.glb")
        # 枪身居中
        mn, mx = Vb.min(0), Vb.max(0)
        bc = (mn + mx) / 2.0
        Vb -= bc
        # 枪栓用【同一个 bc】居中，保证与枪身相对位置不变（否则会双重平移飞到天上）
        Vl -= bc
        # 枪栓静止位（仅供调试参考，几何已居中，运行时不再叠加偏移）
        lmn, lmx = Vl.min(0), Vl.max(0)
        boltC = (lmn + lmx) / 2.0
        boltRest = boltC.tolist()
        bz = lmx[2] - lmn[2]
        boltTravel = float(bz * 0.5)
        zExt = float(mx[2] - mn[2])

        def pack(V, F, C):
            return {
                "pos": encode_f32(V.reshape(-1)),
                "col": encode_f32(C.reshape(-1)),
                "idx": encode_u16(F.reshape(-1)),
            }

        data[key] = {
            "body": pack(Vb, Fb, Cb),
            "bolt": pack(Vl, Fl, Cl),
            "boltRest": [round(x, 4) for x in boltRest],
            "boltTravel": round(boltTravel, 4),
            "zExt": round(zExt, 4),
        }
        print(f"  {key}: bodyV={len(Vb)} boltV={len(Vl)} "
              f"boltRest={[round(x,2) for x in boltRest]} travel={boltTravel:.3f} zExt={zExt:.3f}")
    lines = ["/* 自动生成，请勿手改。来源: tools/bake_gun_glb.py (GLB -> 内联顶点几何; 法线 JS 端算) */",
             "window.GUN_GLB_DATA = {"]
    for key in KEYS:
        d = data[key]
        lines.append(f"  {key}: {{")
        lines.append(f"    body: {{ pos:'{d['body']['pos']}', col:'{d['body']['col']}', idx:'{d['body']['idx']}' }},")
        lines.append(f"    bolt: {{ pos:'{d['bolt']['pos']}', col:'{d['bolt']['col']}', idx:'{d['bolt']['idx']}' }},")
        lines.append(f"    boltRest: {d['boltRest']}, boltTravel: {d['boltTravel']}, zExt: {d['zExt']}")
        lines.append("  },")
    lines.append("};")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("写出 ->", os.path.abspath(OUT), os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    bake()
