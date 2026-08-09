import subprocess
import struct
import json
import re
from pathlib import Path

OPENSCAD = r"D:\Program Files\openscad\openscad.exe"
OUTPUT_DIR = "./out"
Path(OUTPUT_DIR).mkdir(exist_ok=True)

def parse_off_with_colors(off_path):
    """解析 OFF 文件，提取顶点、三角形和颜色"""
    with open(off_path, 'r') as f:
        content = f.read()
    
    # 按行分割，去除空行和注释
    lines = []
    for line in content.split('\n'):
        line = line.strip()
        if line and not line.startswith('#'):
            lines.append(line)
    
    if not lines:
        raise ValueError("OFF 文件为空")
    
    idx = 0
    
    # 跳过 OFF 头
    if lines[idx].upper() in ['OFF', 'COFF']:
        idx += 1
    
    # 读取顶点数、面数、边数
    # 用正则提取数字
    while idx < len(lines):
        numbers = re.findall(r'-?\d+', lines[idx])
        if len(numbers) >= 2:
            num_verts = int(numbers[0])
            num_faces = int(numbers[1])
            idx += 1
            break
        idx += 1
    else:
        raise ValueError("无法解析 OFF 文件头")
    
    # 读取顶点
    verts = []
    for i in range(num_verts):
        parts = re.findall(r'-?\d+\.?\d*', lines[idx + i])
        if len(parts) < 3:
            # 尝试用空格分割
            parts = lines[idx + i].split()
        verts.append([float(parts[0]), float(parts[1]), float(parts[2])])
    idx += num_verts
    
    # 读取面
    tri_vertices = []
    tri_colors = []
    
    for i in range(num_faces):
        parts = lines[idx + i].split()
        if not parts:
            continue
        
        n = int(parts[0])
        if n == 3 and len(parts) >= 4:
            v1, v2, v3 = int(parts[1]), int(parts[2]), int(parts[3])
            tri_vertices.append([verts[v1], verts[v2], verts[v3]])
            
            # 提取颜色
            # OFF 格式颜色可能在后面: 3 v1 v2 v3 r g b
            if len(parts) >= 7:
                r = float(parts[4])
                g = float(parts[5])
                b = float(parts[6])
                # 如果颜色值 > 1，说明是 0-255 范围
                if r > 1 or g > 1 or b > 1:
                    r, g, b = r/255, g/255, b/255
                tri_colors.append([r, g, b, 1.0])
            else:
                tri_colors.append([0.7, 0.7, 0.7, 1.0])
        else:
            # 非三角形，跳过
            tri_colors.append([0.7, 0.7, 0.7, 1.0])
    
    return tri_vertices, tri_colors

def build_glb(vertices, colors):
    """构建 GLB 文件"""
    if not vertices:
        raise ValueError("没有顶点数据")
    
    positions = []
    normals = []
    color_data = []
    
    for t_idx, tri in enumerate(vertices):
        # 计算法线
        v0, v1, v2 = tri
        ax, ay, az = v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]
        bx, by, bz = v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]
        nx = ay*bz - az*by
        ny = az*bx - ax*bz
        nz = ax*by - ay*bx
        length = (nx*nx + ny*ny + nz*nz) ** 0.5
        if length > 0:
            nx, ny, nz = nx/length, ny/length, nz/length
        else:
            nx, ny, nz = 0, 0, 1
        
        c = colors[t_idx] if t_idx < len(colors) else [0.7, 0.7, 0.7, 1.0]
        for _ in range(3):
            v = tri[_]
            positions.extend([v[0], v[1], v[2]])
            normals.extend([nx, ny, nz])
            color_data.extend(c)
    
    # 构建 glTF JSON
    pos_count = len(positions) // 3
    norm_count = len(normals) // 3
    col_count = len(color_data) // 4
    
    # 计算包围盒
    min_x = min(positions[i] for i in range(0, len(positions), 3))
    min_y = min(positions[i] for i in range(1, len(positions), 3))
    min_z = min(positions[i] for i in range(2, len(positions), 3))
    max_x = max(positions[i] for i in range(0, len(positions), 3))
    max_y = max(positions[i] for i in range(1, len(positions), 3))
    max_z = max(positions[i] for i in range(2, len(positions), 3))
    
    gltf = {
        "asset": {"version": "2.0"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{
            "primitives": [{
                "attributes": {
                    "POSITION": 0,
                    "NORMAL": 1,
                    "COLOR_0": 2
                },
                "material": 0,
                "mode": 4
            }]
        }],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorFactor": [1, 1, 1, 1],
                "metallicFactor": 0,
                "roughnessFactor": 0.6
            }
        }],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": pos_count,
                "type": "VEC3",
                "max": [max_x, max_y, max_z],
                "min": [min_x, min_y, min_z]
            },
            {"bufferView": 1, "componentType": 5126, "count": norm_count, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": col_count, "type": "VEC4"}
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(positions)*4, "target": 34962},
            {"buffer": 0, "byteOffset": len(positions)*4, "byteLength": len(normals)*4, "target": 34962},
            {"buffer": 0, "byteOffset": (len(positions)+len(normals))*4, "byteLength": len(color_data)*4, "target": 34962}
        ],
        "buffers": [{"byteLength": (len(positions)+len(normals)+len(color_data))*4}]
    }
    
    json_data = json.dumps(gltf).encode('utf-8')
    json_padded = json_data + b' ' * ((4 - len(json_data) % 4) % 4)
    
    pos_bytes = struct.pack(f'{len(positions)}f', *positions)
    norm_bytes = struct.pack(f'{len(normals)}f', *normals)
    col_bytes = struct.pack(f'{len(color_data)}f', *color_data)
    bin_data = pos_bytes + norm_bytes + col_bytes
    bin_padded = bin_data + b'\0' * ((4 - len(bin_data) % 4) % 4)
    
    header = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(json_padded) + 8 + len(bin_padded))
    json_chunk = struct.pack('<II', len(json_padded), 0x4E4F534A) + json_padded
    bin_chunk = struct.pack('<II', len(bin_padded), 0x004E4942) + bin_padded
    
    return header + json_chunk + bin_chunk

def convert_scad_to_glb(scad_path, glb_path):
    base = scad_path.stem
    off_path = Path(OUTPUT_DIR) / f"_{base}.off"
    
    # 导出 OFF
    cmd = f'"{OPENSCAD}" -o "{off_path}" "{scad_path}"'
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    
    if result.returncode != 0 or not off_path.exists():
        raise RuntimeError(f"OpenSCAD 导出失败: {result.stderr}")
    
    try:
        verts, colors = parse_off_with_colors(off_path)
        if not verts:
            raise ValueError("没有三角形数据")
        glb_data = build_glb(verts, colors)
        with open(glb_path, 'wb') as f:
            f.write(glb_data)
    finally:
        if off_path.exists():
            off_path.unlink()
    
    return len(glb_data)

# ============ 先看看 OFF 文件内容是什么 ============
def debug_off(scad_path):
    """调试：查看 OFF 文件内容"""
    base = scad_path.stem
    off_path = Path(OUTPUT_DIR) / f"_{base}.off"
    
    cmd = f'"{OPENSCAD}" -o "{off_path}" "{scad_path}"'
    subprocess.run(cmd, shell=True, capture_output=True)
    
    if off_path.exists():
        with open(off_path, 'r') as f:
            content = f.read()
        print(f"=== {scad_path.name} OFF 文件前 30 行 ===")
        lines = content.split('\n')[:30]
        for i, line in enumerate(lines):
            print(f"{i+1}: {line!r}")
        print("=====================================")
        off_path.unlink()
    else:
        print(f"❌ 无法生成 OFF 文件")

# ============ 批量转换 ============
print("=" * 60)
print("  🎯 OpenSCAD → GLB 批量转换器 (保留颜色)")
print("=" * 60)
print()

scad_files = list(Path('.').glob('*.scad'))
if not scad_files:
    print("⚠️  当前目录下没有找到 .scad 文件")
    exit(0)

print(f"📁 找到 {len(scad_files)} 个 .scad 文件")
print()
print("🔍 先调试第一个文件，看看 OFF 格式...")
print()

debug_off(scad_files[0])

print()
print("🔄 开始批量转换...")
print()

success = 0
fail = 0

for scad_file in scad_files:
    glb_path = Path(OUTPUT_DIR) / f"{scad_file.stem}.glb"
    try:
        size = convert_scad_to_glb(scad_file, glb_path)
        print(f"  ✅ {scad_file.name} → {glb_path.name} ({size/1024:.1f} KB)")
        success += 1
    except Exception as e:
        print(f"  ❌ {scad_file.name}: {e}")
        fail += 1

print()
print("=" * 60)
print(f"📊 完成: 成功 {success} 个，失败 {fail} 个")
print(f"📁 输出目录: {OUTPUT_DIR}")
print("=" * 60)