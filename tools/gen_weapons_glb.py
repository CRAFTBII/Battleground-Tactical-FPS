# -*- coding: utf-8 -*-
"""
预生成 4 类新武器模型（绕过 openscad.wasm，查看器原生加载 .glb）：
  - 榴彈炮 howitzer (枪身 + 独立炮闩 breech 可拉动)
  - 榴彈炮彈 howitzer shell (独立弹药)
  - 固定位機槍 fixed machine gun (枪身 + 独立枪机 bolt 可拉动)
  - 刺刀 bayonet (独立附件)
坐标约定：+X = 前向(炮口/枪口)，+Z = 上，+Y = 右。
每个模型占一个 Z 槽位，加载 6 个模型即自动排开、互不重叠。
"""
import os
import numpy as np
import trimesh

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "assets", "guns", "glb"))
os.makedirs(OUT, exist_ok=True)

# 配色
FRAME = (0.26, 0.28, 0.31)
GRIP  = (0.12, 0.13, 0.15)
STEEL = (0.52, 0.55, 0.60)
DARK  = (0.07, 0.08, 0.09)
WOOD  = (0.46, 0.31, 0.17)
GLASS = (0.36, 0.55, 0.70)
BRASS = (0.62, 0.50, 0.22)

from trimesh.transformations import rotation_matrix

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

def box(x, y, z, rgb, t=(0, 0, 0), r=(0, 0, 0)):
    return colorize(place(trimesh.creation.box(extents=(x, y, z)), t, r), rgb)

def cyl(radius, height, rgb, t=(0, 0, 0), axis="x", sections=24):
    m = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    rot = (0, 90, 0) if axis == "x" else ((90, 0, 0) if axis == "y" else (0, 0, 0))
    return colorize(place(m, t, rot), rgb)

def sph(radius, rgb, t=(0, 0, 0), sub=3):
    return colorize(place(trimesh.creation.icosphere(radius=radius, subdivisions=sub), t), rgb)

def torus(tube, major, rgb, t=(0, 0, 0), axis="x"):
    m = trimesh.creation.torus(major_radius=major, minor_radius=tube)
    rot = (0, 90, 0) if axis == "x" else ((90, 0, 0) if axis == "y" else (0, 0, 0))
    return colorize(place(m, t, rot), rgb)

def frustum(r_top, r_bottom, h, rgb, t=(0, 0, 0), axis="x", sections=24):
    """圆台/锥体 (r_top==0 时即为圆锥)。默认沿 +Z，按 axis 旋转。"""
    theta = np.linspace(0, 2 * np.pi, sections, endpoint=False)
    bottom = np.column_stack([r_bottom * np.cos(theta), r_bottom * np.sin(theta), np.full(sections, -h / 2)])
    top = np.column_stack([r_top * np.cos(theta), r_top * np.sin(theta), np.full(sections, h / 2)])
    verts = np.vstack([bottom, top])
    faces = []
    for i in range(sections):
        j = (i + 1) % sections
        faces.append([i, j, sections + j])
        faces.append([i, sections + j, sections + i])
    cbot = len(verts); verts = np.vstack([verts, [[0, 0, -h / 2]]])
    for i in range(sections):
        j = (i + 1) % sections
        faces.append([cbot, j, i])
    ctop = len(verts); verts = np.vstack([verts, [[0, 0, h / 2]]])
    for i in range(sections):
        j = (i + 1) % sections
        faces.append([ctop, sections + i, sections + j])
    m = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
    rot = (0, 90, 0) if axis == "x" else ((90, 0, 0) if axis == "y" else (0, 0, 0))
    return colorize(place(m, t, rot), rgb)

def cone(r, h, rgb, t=(0, 0, 0), axis="x", sections=24):
    return frustum(0, r, h, rgb, t=t, axis=axis, sections=sections)

def combine(parts):
    return trimesh.util.concatenate([p for p in parts if p is not None])

# ---------------- 榴彈炮 HOWITZER (body) ----------------
def howitzer_body():
    parts = [
        # 两个大轮
        cyl(3.0, 0.5, FRAME, axis="y", t=(0,  3.2, 3.0)),
        cyl(0.8, 0.7, STEEL, axis="y", t=(0,  3.2, 3.0)),
        cyl(3.0, 0.5, FRAME, axis="y", t=(0, -3.2, 3.0)),
        cyl(0.8, 0.7, STEEL, axis="y", t=(0, -3.2, 3.0)),
        # 轮辐暗示(短辐条)
        *[cyl(0.25, 0.55, DARK, axis="y", t=(0, 3.2, 3.0), ) for _ in range(1)],
        # 车架
        box(5.0, 6.8, 2.2, WOOD, t=(0, 0, 3.0)),
        box(4.0, 1.4, 1.2, FRAME, t=(-5.0, 0, 2.0)),        # 后驻锄
        box(1.0, 6.8, 2.6, FRAME, t=(0, 0, 4.4)),            # 中部立框
        # 摇架 / 耳轴
        box(2.6, 2.8, 2.8, STEEL, t=(-2.0, 0, 6.2)),        # 炮尾环
        cyl(0.6, 1.0, DARK, axis="y", t=(-2.0, 0, 6.2)),    # 耳轴
        # 炮管
        cyl(1.3, 16.0, STEEL, axis="x", t=(4.0, 0, 6.5)),
        cyl(1.55, 2.2, STEEL, axis="x", t=(12.5, 0, 6.5)),  # 炮口制退器
        cyl(0.7, 9.0, DARK, axis="x", t=(3.0, 0, 5.0)),     # 复进筒
        box(0.4, 0.4, 1.2, DARK, t=(7.5, 0, 7.6)),          # 准星
        box(1.2, 0.6, 0.4, DARK, t=(-1.0, 0, 8.0)),         # 高低机
    ]
    # 炮口制退器开槽暗示
    for i in range(4):
        a = i * 90
        parts.append(box(1.6, 0.3, 0.3, DARK, t=(12.5, 0, 6.5), r=(0, 0, a)))
    return combine(parts)

def howitzer_breech():
    """独立炮闩，可沿 -X 拉动。"""
    parts = [
        box(2.4, 2.6, 2.6, STEEL, t=(-3.0, 0, 6.5)),         # 闩体
        box(1.4, 2.0, 0.4, DARK, t=(-3.0, 0, 7.7)),          # 闩面
        cyl(0.3, 2.4, DARK, axis="y", t=(-3.0, 1.6, 7.6)),   # 开闩握把杆
        sph(0.32, DARK, t=(-3.0, 2.9, 7.6)),                 # 握把球
        cyl(0.45, 0.4, BRASS, axis="x", t=(-4.2, 0, 6.5)),   # 击发机
    ]
    return combine(parts)

# ---------------- 榴彈炮彈 HOWITZER SHELL ----------------
def howitzer_shell():
    parts = [
        cyl(0.9, 3.6, FRAME, axis="x", t=(0.0, 0, 0)),       # 弹体
        cone(0.9, 2.6, STEEL, axis="x", t=(3.1, 0, 0)),      # 弹头(尖)
        frustum(0.7, 0.9, 0.7, FRAME, axis="x", t=(-2.15, 0, 0)),  # 弹底收口
        torus(0.16, 0.9, DARK, axis="x", t=(-0.4, 0, 0)),    # 弹带
        torus(0.14, 0.88, DARK, axis="x", t=(0.6, 0, 0)),    # 弹带2
        box(0.1, 1.7, 0.25, DARK, t=(0.2, 0, 0.5)),          # 风帽缝暗示
    ]
    return combine(parts)

# ---------------- 固定位機槍 FIXED MACHINE GUN ----------------
def mg_body():
    parts = [
        # 固定座架
        box(4.2, 4.2, 1.0, FRAME, t=(0, 0, 0.5)),            # 底座
        box(1.2, 1.2, 3.8, FRAME, t=(0, 0, 2.8)),            # 立柱
        box(2.2, 2.2, 1.6, DARK, t=(0, 0, 5.0)),             # 摇架
        # 机匣/受弹机
        box(3.0, 1.4, 1.6, FRAME, t=(1.0, 0, 6.2)),
        box(2.6, 0.6, 1.2, DARK, t=(1.0, 0, 7.1)),           # 受弹机盖
        # 枪管 + 散热套
        cyl(0.45, 9.0, STEEL, axis="x", t=(6.0, 0, 6.2)),    # 枪管
        cyl(0.78, 5.0, DARK, axis="x", t=(5.0, 0, 6.2)),     # 散热套
        # 散热环
        *[torus(0.12, 0.8, FRAME, axis="x", t=(3.2 + i * 1.0, 0, 6.2)) for i in range(4)],
        cyl(0.5, 0.5, STEEL, axis="x", t=(10.6, 0, 6.2)),    # 枪口
        # 枪托/缓冲
        box(2.2, 1.2, 1.4, FRAME, t=(-2.6, 0, 6.2)),
        box(0.6, 1.0, 1.0, DARK, t=(-3.9, 0, 6.2)),          # 缓冲垫
        # 握把
        box(0.9, 0.7, 1.4, GRIP, t=(-1.0, -0.1, 5.0), r=(0, 0, -12)),
        # 两脚架(自座架)
        box(4.0, 0.18, 0.18, DARK, t=(1.5, 1.8, 3.0), r=(0, 30, 0)),
        box(4.0, 0.18, 0.18, DARK, t=(1.5, -1.8, 3.0), r=(0, -30, 0)),
    ]
    return combine(parts)

def mg_bolt():
    """独立枪机，可沿 -X 拉动。"""
    parts = [
        box(2.6, 1.2, 1.2, STEEL, t=(-1.0, 0, 6.2)),         # 枪机框
        cyl(0.3, 0.5, STEEL, axis="x", t=(0.5, 0, 6.2)),     # 机头
        cyl(0.16, 1.6, DARK, axis="y", t=(-1.0, 1.3, 6.6)),  # 拉机柄杆
        sph(0.24, DARK, t=(-1.0, 2.1, 6.6)),                 # 拉机柄球
        box(1.8, 0.2, 1.0, DARK, t=(-1.6, 0, 6.9)),          # 弹底巢面
    ]
    return combine(parts)

# ---------------- 刺刀 BAYONET ----------------
def bayonet():
    parts = [
        # 刀身
        box(8.0, 0.16, 1.0, STEEL, t=(4.0, 0, 0)),
        cone(0.5, 1.4, STEEL, axis="x", t=(8.7, 0, 0)),      # 刀尖
        box(6.0, 0.05, 0.22, DARK, t=(3.5, 0, 0.42)),        # 血槽
        box(8.0, 0.16, 0.2, DARK, t=(4.0, 0, -0.45)),        # 刃背暗示
        # 护手
        box(0.5, 0.5, 2.4, DARK, t=(-0.5, 0, 0)),
        torus(0.28, 0.7, STEEL, axis="x", t=(-0.5, 0, 0)),   # 枪口环(套步枪用)
        # 握把
        box(2.4, 0.5, 1.1, WOOD, t=(-2.1, 0, 0)),
        box(2.4, 0.55, 0.2, DARK, t=(-2.1, 0, 0.5)),         # 握把纹
        # 柄头
        box(0.5, 0.5, 1.15, STEEL, t=(-3.5, 0, 0)),
        sph(0.35, STEEL, t=(-3.9, 0, 0)),
    ]
    return combine(parts)

# 每个模型占一个 Z 槽位；同组(身+动作件)同槽对齐
OFFSET = {
    "howitzer_body.glb":   (0, 0, -44),
    "howitzer_breech.glb": (0, 0, -44),
    "howitzer_shell.glb":  (20, 0, -44),
    "mg_body.glb":         (0, 0, -60),
    "mg_bolt.glb":         (0, 0, -60),
    "bayonet.glb":         (0, 0, -76),
}

def save(name, mesh):
    p = os.path.join(OUT, name)
    mesh.export(p)
    print(f"  {name}: {len(mesh.vertices)} verts, {len(mesh.faces)} faces -> {os.path.getsize(p)} bytes")

if __name__ == "__main__":
    print("生成新武器 GLB 模型 ...")
    jobs = [
        ("howitzer_body.glb", howitzer_body()),
        ("howitzer_breech.glb", howitzer_breech()),
        ("howitzer_shell.glb", howitzer_shell()),
        ("mg_body.glb", mg_body()),
        ("mg_bolt.glb", mg_bolt()),
        ("bayonet.glb", bayonet()),
    ]
    for name, mesh in jobs:
        off = OFFSET.get(name, (0, 0, 0))
        if off != (0, 0, 0):
            mesh.apply_translation(off)
        save(name, mesh)
    print("完成 ->", OUT)
