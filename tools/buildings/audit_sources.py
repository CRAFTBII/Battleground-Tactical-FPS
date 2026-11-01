"""v4 Step 0 · 源 GLB 审计（Blender headless）

用法：
  blender.exe -b --python tools/buildings/audit_sources.py

输出：
  docs/rebuild/source-audit.json  机器可读
  docs/rebuild/source-audit.md    汇总（由本脚本追加/覆盖）

审计内容：对象/三角、世界包围盒、根节点变换/缩放、材质/贴图、非流形/零面积、
轴向（glTF 假定 Y-up；当前资产实际为 Z-up 时会在 Blender 中“躺倒”）。
"""
import bpy
import bmesh
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'source-buildings')
OUT_JSON = os.path.join(ROOT, 'docs', 'rebuild', 'source-audit.json')

FILES = [
    'Tactical_FPS_Buildings.glb',
    'Tactical_FPS_Additional_Buildings.glb',
    'large_combat_base.glb',
    'large_house.glb',
]


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def world_bbox(objs):
    mn = [1e30, 1e30, 1e30]
    mx = [-1e30, -1e30, -1e30]
    for o in objs:
        if o.type != 'MESH':
            continue
        mw = o.matrix_world
        for v in o.data.vertices:
            p = mw @ v.co
            for i in range(3):
                mn[i] = min(mn[i], p[i])
                mx[i] = max(mx[i], p[i])
    if mn[0] > 1e29:
        return None
    return {'min': [round(x, 4) for x in mn], 'max': [round(x, 4) for x in mx],
            'size': [round(mx[i] - mn[i], 4) for i in range(3)]}


def mesh_stats(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    nonmanifold = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    zero = sum(1 for f in bm.faces if f.calc_area() < 1e-9)
    bm.free()
    o.data.calc_loop_triangles()
    return {
        'verts': len(o.data.vertices),
        'polys': len(o.data.polygons),
        'tris': len(o.data.loop_triangles),
        'nonManifoldEdges': nonmanifold,
        'zeroAreaFaces': zero,
        'materials': [m.name if m else None for m in o.data.materials],
    }


def audit_file(path):
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.scene.objects]
    meshes = [o for o in objs if o.type == 'MESH']
    roots = [o for o in objs if o.parent is None]
    bb = world_bbox(meshes)
    groups = {}
    for o in meshes:
        group = o.name.split('_')[0]
        # House_A/B、Guard_Shack、Farmhouse_C 等用前两个 token；这里先按首个 token 汇总
        if group == 'House':
            parts = o.name.split('_')
            group = parts[0] + '_' + parts[1] if len(parts) > 1 else group
        groups.setdefault(group, []).append(o)
    group_info = {}
    for g, os_ in groups.items():
        group_info[g] = {
            'objects': len(os_),
            'tris': sum(mesh_stats(o)['tris'] for o in os_),
            'bbox': world_bbox(os_),
        }
    total_tris = sum(mesh_stats(o)['tris'] for o in meshes)
    return {
        'file': os.path.basename(path),
        'bytes': os.path.getsize(path),
        'objects': len(objs),
        'meshes': len(meshes),
        'lights': sum(1 for o in objs if o.type == 'LIGHT'),
        'cameras': sum(1 for o in objs if o.type == 'CAMERA'),
        'roots': [{'name': o.name, 'type': o.type,
                   'location': [round(v, 4) for v in o.location],
                   'rotation': [round(v, 4) for v in o.rotation_euler],
                   'scale': [round(v, 4) for v in o.scale]} for o in roots],
        'worldBBox': bb,
        'totalTris': total_tris,
        'materials': sorted({m.name for o in meshes for m in o.data.materials if m}),
        'images': sorted({i.name for i in bpy.data.images if i.name != 'Render Result'}),
        'groups': group_info,
        'meshIssues': {o.name: s for o in meshes for s in [mesh_stats(o)] if s['nonManifoldEdges'] or s['zeroAreaFaces']},
    }


def main():
    result = {'sourceDir': SRC, 'files': []}
    for f in FILES:
        p = os.path.join(SRC, f)
        if not os.path.exists(p):
            result['files'].append({'file': f, 'error': 'missing'})
            continue
        print('[audit] ' + f)
        result['files'].append(audit_file(p))
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, 'w', encoding='utf-8') as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print('[audit] wrote ' + OUT_JSON)


if __name__ == '__main__':
    main()
