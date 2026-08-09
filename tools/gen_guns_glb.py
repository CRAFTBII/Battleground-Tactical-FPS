# -*- coding: utf-8 -*-
"""
用基础几何体预生成 4 把枪的 .glb 模型（枪身 + 独立枪栓），
绕过 openscad.wasm，查看器原生加载，无需编译、不依赖任何 CDN。
坐标约定：+X = 枪口方向，+Z = 上，+Y = 右，握把向 -Z。
"""
import os
import numpy as np
import trimesh
from trimesh.transformations import rotation_matrix

OUT = os.path.join(os.path.dirname(__file__), "..", "models", "glb")
os.makedirs(OUT, exist_ok=True)

# 配色 (linear-ish 0..1)
FRAME = (0.26, 0.28, 0.31)
GRIP  = (0.12, 0.13, 0.15)
STEEL = (0.52, 0.55, 0.60)
DARK  = (0.07, 0.08, 0.09)
WOOD  = (0.46, 0.31, 0.17)
GLASS = (0.36, 0.55, 0.70)

def colorize(mesh, rgb):
    vc = np.tile(np.array([*rgb, 1.0], dtype=np.float32), (len(mesh.vertices), 1))
    mesh.visual = trimesh.visual.ColorVisuals(mesh, vertex_colors=vc)
    return mesh

def place(mesh, t=(0, 0, 0), r=(0, 0, 0)):
    rx, ry, rz = [np.radians(a) for a in r]
    if rx: mesh.apply_transform(rotation_matrix(rx, [1, 0, 0]))
    if ry: mesh.apply_transform(rotation_matrix(ry, [0, 1, 0]))
    if rz: mesh.apply_transform(rotation_matrix(rz, [0, 0, 1]))
    mesh.apply_translation(t)
    return mesh

def box(x, y, z, rgb, t=(0, 0, 0), r=(0, 0, 0), sec=1):
    m = trimesh.creation.box(extents=(x, y, z))
    return colorize(place(m, t, r), rgb)

def cyl(radius, height, rgb, t=(0, 0, 0), axis="x", sections=24):
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    if axis == "x": m.apply_transform(rotation_matrix(np.pi / 2, [0, 1, 0]))
    elif axis == "y": m.apply_transform(rotation_matrix(np.pi / 2, [1, 0, 0]))
    return colorize(place(m, t), rgb)

def cone(r1, r2, h, rgb, t=(0, 0, 0), axis="x", sections=24):
    m = trimesh.creation.cylinder(radius=r1, height=h, sections=sections)  # approx
    # emulate r1->r2 taper via scale on one face is complex; keep simple cylinder
    return colorize(place(m, t), rgb)

def sph(radius, rgb, t=(0, 0, 0), sub=3):
    m = trimesh.creation.icosphere(radius=radius, subdivisions=sub)
    return colorize(place(m, t), rgb)

def torus(tube, major, rgb, t=(0, 0, 0), axis="x", sections=20):
    m = trimesh.creation.torus(major_radius=major, minor_radius=tube)
    if axis == "x": m.apply_transform(rotation_matrix(np.pi / 2, [0, 1, 0]))
    elif axis == "y": m.apply_transform(rotation_matrix(np.pi / 2, [1, 0, 0]))
    return colorize(place(m, t), rgb)

def combine(parts):
    parts = [p for p in parts if p is not None]
    return trimesh.util.concatenate(parts)

def save(name, mesh):
    p = os.path.join(OUT, name)
    mesh.export(p)
    print(f"  {name}: {len(mesh.vertices)} verts, {len(mesh.faces)} faces -> {os.path.getsize(p)} bytes")

# ---------------- 手枪 PISTOL ----------------
def pistol_body():
    parts = [
        box(4.0, 0.9, 2.0, FRAME, t=(0, 0, 0)),                       # 底把
        box(1.5, 0.9, 1.8, GRIP, t=(0.3, 0, -0.9), r=(0, 0, -14)),   # 握把
        box(1.2, 0.8, 0.3, GRIP, t=(0.45, 0, -1.7), r=(0, 0, -14)),  # 握把底
        torus(0.22, 0.6, DARK, axis="x", t=(-0.3, 0, -0.7)),         # 扳机护圈
        box(0.5, 0.18, 0.5, DARK, t=(-0.3, 0, -0.5)),                # 扳机
        cyl(0.32, 1.9, STEEL, axis="x", t=(1.7, 0, 0.1)),            # 枪管
        cyl(0.36, 0.25, STEEL, axis="x", t=(2.65, 0, 0.1)),          # 枪口帽
        box(3.0, 0.7, 0.3, DARK, t=(0.4, 0, 1.1)),                   # 顶部导轨座
        box(1.0, 0.8, 0.7, FRAME, t=(0.2, 0, -1.1)),                 # 弹匣井
        box(0.25, 0.25, 0.35, DARK, t=(2.4, 0, 0.45)),               # 准星基座
    ]
    return combine(parts)

def pistol_bolt():
    parts = [
        box(3.8, 0.9, 1.6, STEEL, t=(0.2, 0, 0.15)),                 # 套筒主体
        box(3.4, 0.85, 1.5, STEEL, t=(0.4, 0, 0.3)),                 # 顶部微拱
        box(0.25, 0.25, 0.3, DARK, t=(2.4, 0, 0.95)),                # 准星
        box(0.3, 0.3, 0.35, DARK, t=(0.5, 0, 0.95)),                 # 照门
        cyl(0.45, 0.15, STEEL, axis="x", t=(1.8, 0, 0.2)),           # 前端枪口坡面
    ]
    # 后端防滑纹
    for i in range(6):
        parts.append(box(0.12, 0.9, 0.18, DARK, t=(0.2 + i * 0.18, 0, -0.65)))
    return combine(parts)

# ---------------- 步枪 RIFLE ----------------
def rifle_body():
    parts = [
        box(4.6, 1.0, 1.6, FRAME, t=(0, 0, 0)),                      # 机匣
        cyl(0.3, 5.0, STEEL, axis="x", t=(4.2, 0, 0.1)),             # 枪管
        cyl(0.34, 0.6, STEEL, axis="x", t=(6.8, 0, 0.1)),           # 消焰器
        box(0.2, 0.2, 0.4, DARK, t=(6.0, 0, 0.45)),                  # 准星
        box(3.0, 1.1, 1.3, DARK, t=(3.4, 0, 0.1)),                   # 护木
        box(2.2, 0.9, 1.4, FRAME, t=(-3.0, 0, 0)),                   # 枪托
        box(1.4, 0.7, 1.6, FRAME, t=(-3.6, 0, 0.2)),                 # 贴腮
        box(0.3, 1.0, 1.6, FRAME, t=(-4.2, 0, 0.1)),                 # 缓冲底板
        box(1.2, 0.9, 1.5, GRIP, t=(-0.8, -0.1, -0.9), r=(0, 0, -12)), # 握把
        torus(0.2, 0.5, DARK, axis="x", t=(-1.0, 0, -0.7)),          # 扳机护圈
        box(1.0, 0.8, 1.6, DARK, t=(-0.2, 0, -1.2)),                 # 弹匣
        box(4.0, 0.6, 0.2, DARK, t=(0.6, 0, 0.9)),                   # 顶部导轨
    ]
    # 护木散热孔（小圆柱暗示）
    for i in range(4):
        parts.append(cyl(0.14, 0.45, DARK, axis="x", t=(2.6 + i * 0.6, 0.45, 0.1)))
        parts.append(cyl(0.14, 0.45, DARK, axis="x", t=(2.6 + i * 0.6, -0.45, 0.1)))
    return combine(parts)

def rifle_bolt():
    parts = [
        box(2.6, 0.8, 1.2, STEEL, t=(0, 0, 0)),                      # 枪机框主体
        cyl(0.16, 0.8, DARK, axis="x", t=(0.4, 0.55, 0)),            # 拉机柄杆
        sph(0.2, DARK, t=(0.8, 0.55, 0)),                            # 拉机柄球
        box(1.8, 0.85, 0.2, DARK, t=(-0.4, 0, 0.3)),                 # 表面导槽
        cyl(0.3, 0.4, STEEL, axis="x", t=(1.4, 0, 0)),               # 枪机头
    ]
    return combine(parts)

# ---------------- 霰弹枪 SHOTGUN ----------------
def shotgun_body():
    parts = [
        box(2.6, 0.9, 1.4, WOOD, t=(-2.6, 0, 0.1)),                  # 木托
        box(1.6, 0.7, 1.6, WOOD, t=(-3.2, 0, 0.2)),                  # 贴腮
        box(0.3, 1.0, 1.6, WOOD, t=(-3.9, 0, 0.1)),                  # 底板
        box(2.0, 0.9, 1.5, FRAME, t=(0, 0, 0)),                      # 机匣
        box(1.0, 0.8, 1.2, WOOD, t=(-0.2, 0, -0.7)),                 # 前握把木块
        cyl(0.35, 4.2, STEEL, axis="x", t=(3.0, 0, 0.1)),           # 枪管
        cyl(0.38, 0.3, STEEL, axis="x", t=(5.1, 0, 0.1)),           # 枪口
        cyl(0.2, 3.6, DARK, axis="x", t=(2.6, 0, -0.3)),            # 管状弹仓
        torus(0.18, 0.45, DARK, axis="x", t=(-0.4, 0, -0.6)),        # 扳机护圈
        box(1.4, 0.5, 0.2, DARK, t=(0.8, 0, 0.9)),                   # 顶部瞄具座
    ]
    return combine(parts)

def shotgun_bolt():
    parts = [
        box(2.6, 1.1, 1.2, WOOD, t=(0, 0, 0)),                       # 泵动护木主体
        box(2.2, 1.0, 1.2, WOOD, t=(0, 0, -0.1)),
        cyl(0.5, 0.3, DARK, axis="x", t=(1.3, 0, 0)),               # 前端套环
        cyl(0.5, 0.3, DARK, axis="x", t=(-1.3, 0, 0)),              # 后端套环
    ]
    for i in range(8):
        parts.append(box(0.12, 1.1, 0.18, DARK, t=(1.2 - i * 0.32, 0, -0.55)))  # 防滑纹
    return combine(parts)

# ---------------- 狙击枪 SNIPER ----------------
def sniper_body():
    parts = [
        box(2.6, 1.0, 1.6, FRAME, t=(-3.4, 0, 0)),                   # 枪托
        box(1.4, 0.8, 1.8, FRAME, t=(-3.9, 0, 0.2)),                 # 贴腮
        box(0.3, 1.1, 1.8, FRAME, t=(-4.8, 0, 0.1)),                 # 底板
        box(4.0, 1.0, 1.5, FRAME, t=(0, 0, 0)),                      # 机匣
        cyl(0.26, 7.2, STEEL, axis="x", t=(5.2, 0, 0)),             # 长枪管
        cyl(0.3, 0.8, STEEL, axis="x", t=(8.9, 0, 0)),              # 制退器
        cyl(0.32, 0.2, DARK, axis="x", t=(2.0, 0, 0)),              # 枪管箍
        box(1.2, 0.9, 1.6, DARK, t=(0.2, 0, -1.3)),                  # 弹匣
        box(1.2, 0.9, 1.5, GRIP, t=(-1.2, -0.1, -0.9), r=(0, 0, -10)), # 握把
        torus(0.18, 0.45, DARK, axis="x", t=(-1.4, 0, -0.7)),        # 扳机护圈
        box(2.2, 0.5, 0.5, DARK, t=(0.2, 0, 1.3)),                   # 镜身
        cyl(0.4, 0.6, STEEL, axis="x", t=(-0.6, 0, 1.3)),           # 前镜环
        cyl(0.4, 0.6, STEEL, axis="x", t=(1.0, 0, 1.3)),            # 后镜环
        box(1.8, 0.3, 0.3, GLASS, t=(0.2, 0, 1.3)),                  # 镜片暗示
    ]
    return combine(parts)

def sniper_bolt():
    parts = [
        cyl(0.35, 2.2, STEEL, axis="x", t=(0, 0, 0)),               # 枪机主体
        cyl(0.2, 0.4, DARK, axis="x", t=(0.6, 0, 0)),               # 机柄座横杆
        cyl(0.16, 1.0, DARK, axis="z", t=(0.8, 0, -0.4)),           # 机柄下伸
        sph(0.22, DARK, t=(0.8, 0, -0.9)),                           # 机柄球
        cyl(0.38, 0.3, STEEL, axis="x", t=(-1.2, 0, 0)),            # 枪机头
    ]
    return combine(parts)

if __name__ == "__main__":
    # 每把枪占一个 Z 槽位，枪身与枪栓同槽对齐；沿 Z 排成一排
    OFFSET = {
        "pistol_body.glb":  (0, 0,  24),
        "pistol_bolt.glb":  (0, 0,  24),
        "rifle_body.glb":   (0, 0,   8),
        "rifle_bolt.glb":   (0, 0,   8),
        "shotgun_body.glb":  (0, 0,  -8),
        "shotgun_bolt.glb":  (0, 0,  -8),
        "sniper_body.glb":   (0, 0, -24),
        "sniper_bolt.glb":   (0, 0, -24),
    }
    print("生成 GLB 模型 ...")
    jobs = [
        ("pistol_body.glb", pistol_body()),
        ("pistol_bolt.glb", pistol_bolt()),
        ("rifle_body.glb", rifle_body()),
        ("rifle_bolt.glb", rifle_bolt()),
        ("shotgun_body.glb", shotgun_body()),
        ("shotgun_bolt.glb", shotgun_bolt()),
        ("sniper_body.glb", sniper_body()),
        ("sniper_bolt.glb", sniper_bolt()),
    ]
    for name, mesh in jobs:
        off = OFFSET.get(name, (0, 0, 0))
        if off != (0, 0, 0):
            mesh.apply_translation(off)
        save(name, mesh)
    print("完成 ->", os.path.abspath(OUT))
