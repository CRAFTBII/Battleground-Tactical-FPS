#!/usr/bin/env python3
"""
v5 建筑 GLB 快速验收器。

用途：新建筑放进 models/buildings/v5/ 之前，先检查：
  - 文件可解析、包围盒/原点/目标尺寸
  - VIS / COL / NAV / ANCHOR 节点角色
  - 门锚点 clearWidth / clearHeight
  - 三角形与材质数量
  - NAV floorId 是否齐全

用法：
  python tools/buildings/validate_glb.py models/buildings/house.glb --target 11 8.8 9
  python tools/buildings/validate_glb.py models/buildings/v5/warehouse_a.glb \
      --target 20 8.5 14 --require VIS,COL,NAV,ANCHOR --json

退出码：0 = 通过；1 = 有 error；2 = 文件不可读/依赖缺失。
"""
from __future__ import annotations

import argparse
import json
import struct
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import trimesh
except Exception as e:  # pragma: no cover
    print("需要 trimesh: pip install trimesh", e, file=sys.stderr)
    sys.exit(2)


def read_glb_json(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError("GLB 文件过小")
    magic, version, total = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("不是 GLB（magic 错误）")
    if version != 2:
        raise ValueError("只支持 glTF 2.0")
    if total > len(data):
        raise ValueError("GLB 头部长度超过文件大小（截断）")
    off = 12
    while off + 8 <= total:
        chunk_len, chunk_type = struct.unpack_from("<II", data, off)
        start = off + 8
        if chunk_type == 0x4E4F534A:  # JSON
            raw = data[start:start + chunk_len].decode("utf-8", errors="replace")
            raw = raw.rstrip("\x00").strip()
            return json.loads(raw)
        off = start + chunk_len
    raise ValueError("GLB 缺少 JSON chunk")


def node_role(node: dict) -> str | None:
    ex = node.get("extras") or {}
    role = ex.get("battlegameRole")
    if role:
        return str(role)
    name = node.get("name") or ""
    for r in ("VIS", "COL", "NAV", "ANCHOR"):
        if name.startswith(r + "__"):
            return r
    return None


def mesh_triangles(j: dict, mesh_index: int) -> int:
    mesh = (j.get("meshes") or [])[mesh_index]
    n = 0
    for prim in mesh.get("primitives", []):
        if "indices" in prim and prim["indices"] is not None:
            acc = (j.get("accessors") or [])[prim["indices"]]
            n += int(acc.get("count", 0)) // 3
        elif "attributes" in prim and "POSITION" in prim["attributes"]:
            acc = (j.get("accessors") or [])[prim["attributes"]["POSITION"]]
            n += int(acc.get("count", 0)) // 3
    return n


def fmt(v: float) -> str:
    return f"{v:.3f}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", type=Path)
    ap.add_argument("--target", nargs=3, type=float, metavar=("W", "H", "D"),
                    help="目标尺寸（宽 X / 高 Y / 深 Z），米")
    ap.add_argument("--require", default="VIS,COL",
                    help="要求存在的角色，逗号分隔（默认 VIS,COL）")
    ap.add_argument("--tol", type=float, default=0.06, help="尺寸/原点容差，米")
    ap.add_argument("--json", action="store_true", help="输出 JSON 报告")
    args = ap.parse_args()

    p: Path = args.glb
    errors: list[str] = []
    warnings: list[str] = []

    if not p.exists():
        print(f"文件不存在: {p}", file=sys.stderr)
        return 2

    try:
        j = read_glb_json(p)
    except Exception as e:
        print(f"GLB 解析失败: {e}", file=sys.stderr)
        return 2

    try:
        scene = trimesh.load(p, force="scene", process=False)
        bounds = scene.bounds
    except Exception as e:
        print(f"trimesh 加载失败: {e}", file=sys.stderr)
        return 2

    mn, mx = bounds[0], bounds[1]
    dims = [float(mx[i] - mn[i]) for i in range(3)]
    center = [(float(mn[i]) + float(mx[i])) / 2 for i in range(3)]

    roles = {}
    anchors = []
    nav_floors = []
    vis_tris = 0
    total_tris = 0
    for node in (j.get("nodes") or []):
        role = node_role(node)
        if role:
            roles[role] = roles.get(role, 0) + 1
        if role == "ANCHOR":
            ex = node.get("extras") or {}
            anchors.append({
                "name": node.get("name"),
                "portalId": ex.get("portalId"),
                "clearWidth": ex.get("clearWidth"),
                "clearHeight": ex.get("clearHeight"),
                "floorId": ex.get("floorId"),
                "navLinkId": ex.get("navLinkId"),
            })
        if role == "NAV":
            ex = node.get("extras") or {}
            nav_floors.append(ex.get("floorId"))
        if node.get("mesh") is not None:
            t = mesh_triangles(j, int(node["mesh"]))
            total_tris += t
            if role == "VIS":
                vis_tris += t

    required = [x.strip() for x in args.require.split(",") if x.strip()]
    for r in required:
        if r not in roles:
            errors.append(f"缺少节点角色 {r}（需要 {r}__* 或 extras.battlegameRole={r}）")

    if not vis_tris:
        warnings.append("VIS 三角形为 0（可能把可见网格命名成了别的角色）")

    if args.target:
        tw, th, td = args.target
        for i, (got, want, name) in enumerate(zip(dims, (tw, th, td), ("宽 X", "高 Y", "深 Z"))):
            if abs(got - want) > args.tol:
                errors.append(f"尺寸 {name}: {fmt(got)}m，目标 {fmt(want)}m（容差 ±{args.tol}m）")
        # 原点：footprint 中心地面
        if abs(center[0]) > args.tol:
            errors.append(f"原点 X 不在 footprint 中心：centerX={fmt(center[0])}m")
        if abs(center[2]) > args.tol:
            errors.append(f"原点 Z 不在 footprint 中心：centerZ={fmt(center[2])}m")
        if abs(float(mn[1])) > args.tol:
            errors.append(f"原点 Y 不在地面：minY={fmt(float(mn[1]))}m")

    for a in anchors:
        cw, ch = a.get("clearWidth"), a.get("clearHeight")
        if cw is None or ch is None:
            warnings.append(f"锚点 {a.get('name')} 缺 clearWidth/clearHeight")
            continue
        try:
            if float(cw) < 1.3:
                errors.append(f"门/洞 {a.get('name')} 净宽 {cw}m < 1.3m")
            if float(ch) < 2.3:
                errors.append(f"门/洞 {a.get('name')} 净高 {ch}m < 2.3m")
        except Exception:
            warnings.append(f"锚点 {a.get('name')} clearWidth/Height 不是数字")

    if "NAV" in required and any(x is None for x in nav_floors):
        warnings.append("部分 NAV 节点缺少 extras.floorId")
    if len([x for x in nav_floors if x]) != len(set(x for x in nav_floors if x)):
        warnings.append("NAV floorId 有重复")

    materials = len(j.get("materials") or [])
    report = {
        "file": str(p),
        "bytes": p.stat().st_size,
        "dims": {k: round(v, 3) for k, v in zip(("x", "y", "z"), dims)},
        "center": {k: round(v, 3) for k, v in zip(("x", "y", "z"), center)},
        "minY": round(float(mn[1]), 3),
        "roles": roles,
        "anchors": anchors,
        "navFloors": nav_floors,
        "visualTriangles": vis_tris,
        "totalTriangles": total_tris,
        "materials": materials,
        "errors": errors,
        "warnings": warnings,
    }

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(f"== {p.name} ==")
        print(f"  尺寸 X/Y/Z: {report['dims']['x']} / {report['dims']['y']} / {report['dims']['z']} m")
        print(f"  中心: {report['center']['x']}, {report['center']['z']} | minY {report['minY']}")
        print(f"  角色: {roles}")
        print(f"  VIS 三角: {vis_tris} | 总三角: {total_tris} | 材质: {materials}")
        print(f"  门锚点: {len(anchors)} | NAV floor: {nav_floors}")
        for w in warnings:
            print(f"  [warn] {w}")
        for e in errors:
            print(f"  [error] {e}")
        print("  结果: " + ("PASS" if not errors else "FAIL"))

    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
