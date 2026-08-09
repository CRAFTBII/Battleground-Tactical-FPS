import os
import subprocess
import trimesh
from pathlib import Path
import shutil

# ============ 配置 ============
OPENSCAD = r"D:\Program Files\openscad\openscad.exe"
INPUT_DIR = "./source"
OUTPUT_DIR = "./out"

# ============ 检查 OpenSCAD 是否存在 ============
if not Path(OPENSCAD).exists():
    print(f"❌ OpenSCAD 不存在: {OPENSCAD}")
    print("请修改脚本中的 OPENSCAD 路径")
    exit(1)

# ============ 创建输出目录 ============
Path(OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

# ============ 查找所有 .scad 文件 ============
scad_files = list(Path(INPUT_DIR).glob("*.scad"))

if not scad_files:
    print("⚠️  ./source目录下没有找到 .scad 文件")
    exit(0)

print("=" * 50)
print("  🎯 OpenSCAD → GLB 批量转换器 (保留颜色)")
print("=" * 50)
print(f"\n📁 找到 {len(scad_files)} 个 .scad 文件\n")

success_count = 0
fail_count = 0

# ============ 批量处理 ============
for scad_file in scad_files:
    base_name = scad_file.stem
    off_path = Path(OUTPUT_DIR) / f"_temp_{base_name}.off"
    glb_path = Path(OUTPUT_DIR) / f"{base_name}.glb"
    
    print(f"  📄 处理: {scad_file.name}")
    
    # 步骤1: OpenSCAD 导出 OFF (带颜色)
    try:
        cmd = f'"{OPENSCAD}" -o "{off_path}" "{scad_file}"'
        subprocess.run(cmd, shell=True, check=True, capture_output=True)
        print(f"     ✅ 导出 OFF 成功")
    except subprocess.CalledProcessError as e:
        print(f"     ❌ 导出 OFF 失败: {e.stderr.decode()}")
        fail_count += 1
        print()
        continue
    
    # 步骤2: trimesh 读取 OFF 并导出 GLB (保留颜色)
    try:
        mesh = trimesh.load(off_path)
        if hasattr(mesh, 'vertices') and len(mesh.vertices) > 0:
            mesh.export(glb_path, file_type='glb')
            size_kb = glb_path.stat().st_size / 1024
            # 检查是否包含颜色
            has_color = hasattr(mesh.visual, 'vertex_colors') and mesh.visual.vertex_colors is not None
            color_status = "🟢 带颜色" if has_color else "⚪ 无颜色"
            print(f"     ✅ 导出 GLB 成功 ({size_kb:.1f} KB, {color_status})")
            success_count += 1
        else:
            print(f"     ❌ OFF 文件没有有效几何体")
            fail_count += 1
    except Exception as e:
        print(f"     ❌ 转换 GLB 失败: {str(e)}")
        fail_count += 1
    finally:
        # 清理临时 OFF 文件
        if off_path.exists():
            off_path.unlink()
    
    print()

# ============ 汇总 ============
print("=" * 50)
print(f"📊 完成: 成功 {success_count} 个，失败 {fail_count} 个")
print(f"📁 输出目录: {OUTPUT_DIR}")
print("=" * 50)