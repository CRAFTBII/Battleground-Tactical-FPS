"""v4 Step 1 · 三个代表模型修复（House_B / Cover / Base / Estate）

用法：
  blender.exe -b --python tools/buildings/build_representatives.py

处理：
  - glTF 导入后源 Z-up 躺倒 → 绕 X -90° 恢复 Blender Z-up
  - 应用变换；按目标尺寸缩放；footprint 中心地面为原点
  - VIS__ / COL__ / NAV__ / ANCHOR__ 节点角色 + extras
  - 导出 Y-up GLB 到 models/buildings/
"""
import bpy
import json
import math
import os
from mathutils import Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'source-buildings')
OUT = os.path.join(ROOT, 'models', 'buildings')
os.makedirs(OUT, exist_ok=True)

ROT = Matrix.Rotation(-math.pi / 2, 4, 'X')


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(name):
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name))
    return [o for o in bpy.context.scene.objects if o.type == 'MESH']


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    if objs:
        bpy.context.view_layer.objects.active = objs[0]


def apply_all(objs):
    select(objs)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def fix_axis(objs):
    for o in objs:
        o.matrix_world = ROT @ o.matrix_world
    apply_all(objs)


def bbox(objs):
    mn = [1e30, 1e30, 1e30]
    mx = [-1e30, -1e30, -1e30]
    for o in objs:
        for v in o.data.vertices:
            p = v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i])
                mx[i] = max(mx[i], p[i])
    return mn, mx


def fit(objs, target):
    mn, mx = bbox(objs)
    size = [mx[i] - mn[i] for i in range(3)]
    s = [target[i] / size[i] if size[i] > 1e-6 else 1 for i in range(3)]
    cx = (mn[0] + mx[0]) / 2
    cy = (mn[1] + mx[1]) / 2
    z0 = mn[2]
    for o in objs:
        for v in o.data.vertices:
            v.co.x = (v.co.x - cx) * s[0]
            v.co.y = (v.co.y - cy) * s[1]
            v.co.z = (v.co.z - z0) * s[2]
        o.data.update()
    return s, cx, cy, z0


def join(objs, name, role, extras=None):
    if not objs:
        return None
    select(objs)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    o['battlegameRole'] = role
    o['assetId'] = name
    o['schemaVersion'] = 1
    if extras:
        for k, v in extras.items():
            o[k] = v
    return o


def duplicate(obj, name, role):
    d = obj.copy()
    d.data = obj.data.copy()
    d.name = name
    d.data.name = name
    d['battlegameRole'] = role
    d['assetId'] = name
    d['schemaVersion'] = 1
    bpy.context.collection.objects.link(d)
    return d


def anchor(name, x, y, extras=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.5
    e.location = (x, y, 0)
    e['battlegameRole'] = 'ANCHOR'
    e['assetId'] = name
    e['schemaVersion'] = 1
    if extras:
        for k, v in extras.items():
            e[k] = v
    bpy.context.collection.objects.link(e)
    return e


def door_anchor_from_mesh(objs):
    for o in objs:
        if 'Ground_Door_Header' in o.name or 'Front_Door_Header' in o.name:
            mn, mx = bbox([o])
            return ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2)
    return None


def export(objs, key):
    select(objs)
    path = os.path.join(OUT, key + '.glb')
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
    )
    print('[build] ' + key + ' -> ' + path)


def build_house():
    reset()
    all_meshes = import_glb('Tactical_FPS_Buildings.glb')
    meshes = [o for o in all_meshes if o.name.startswith('House_B_')]
    fix_axis(meshes)
    door = None
    for o in meshes:
        if 'Ground_Door_Header' in o.name:
            mn, mx = bbox([o])
            door = ((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mx[0] - mn[0], mn[2])
            break
    vis = join(meshes, 'VIS__house', 'VIS')
    s, cx, cy, z0 = fit([vis], (11.0, 9.0, 8.8))
    col = duplicate(vis, 'COL__house', 'COL')
    col.hide_render = True
    col['collisionType'] = 'triangle'
    nav_obj = duplicate(vis, 'NAV__house', 'NAV')
    nav_obj.hide_render = True
    nav_obj['floorId'] = 'F0'
    anchors = []
    if door:
        ax = (door[0] - cx) * s[0]
        ay = (door[1] - cy) * s[1]
        anchors.append(anchor('ANCHOR__house_door', ax, ay, {
            'portalId': 'house_main',
            'clearWidth': round(door[2] * s[0], 3),
            'clearHeight': round(door[3] * s[2], 3)
        }))
    export([vis, col, nav_obj] + anchors, 'house')


def build_cover():
    reset()
    all_meshes = import_glb('Tactical_FPS_Buildings.glb')
    fix_axis(all_meshes)
    groups = [
        ('Cover_Concrete_Wall_A', (0.3, 0.3)),
        ('Cover_Concrete_Wall_C', (7.2, 0.3)),
        ('Cover_Concrete_Wall_B', (0.3, 5.6)),
        ('Cover_Jersey_Barrier_A', (11.8, 2.9)),
        ('Cover_Sandbags_A', (5.4, 2.8)),
    ]
    picked = []
    for prefix, target in groups:
        ms = [o for o in all_meshes if o.name.startswith(prefix)]
        if not ms:
            print('[build] cover missing ' + prefix)
            continue
        mn, mx = bbox(ms)
        dx, dy = target[0] - mn[0], target[1] - mn[1]
        for o in ms:
            for v in o.data.vertices:
                v.co.x += dx
                v.co.y += dy
        picked.extend(ms)
    vis = join(picked, 'VIS__cover', 'VIS')
    fit([vis], (14.5, 6.3, 2.8))
    col = duplicate(vis, 'COL__cover', 'COL')
    col.hide_render = True
    col['collisionType'] = 'triangle'
    export([vis, col], 'cover')


def build_whole(src, key, target, anchor_mesh=None):
    reset()
    meshes = import_glb(src)
    fix_axis(meshes)
    vis = join(meshes, 'VIS__' + key, 'VIS')
    fit([vis], target)
    col = duplicate(vis, 'COL__' + key, 'COL')
    col.hide_render = True
    col['collisionType'] = 'triangle'
    objs = [vis, col]
    export(objs, key)


if __name__ == '__main__':
    build_house()
    build_cover()
    build_whole('large_combat_base.glb', 'base', (90.0, 75.0, 16.0))
    build_whole('large_house.glb', 'estate', (80.0, 60.0, 10.0))
