"""Export the five isolated, URDF-scale coffee-bar robot models as GLBs.

Run through the repository's local Blender 4.5 executable. This script reuses
the robot import helpers in build_scene.py but never runs its scene build loop.
Only robot-library/*.glb files are written by this script.
"""

from pathlib import Path
import json
import sys


HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "robot-library"
URDF_ROOT = Path(r"D:\Work\FPS\Robotics\urdf\robots")
BUILD_SOURCE = HERE / "build_scene.py"
OLD_CONFIG = HERE.parent / "bakery_cell" / "scene_config.json"


def load_generator_prefix():
    source = BUILD_SOURCE.read_text(encoding="utf-8")
    marker = "RANGE_ORANGE=material"
    if marker not in source:
        raise RuntimeError(f"Could not find safe generator-prefix marker {marker!r}")
    exec(compile(source.split(marker, 1)[0], str(BUILD_SOURCE), "exec"), globals())


def robot_entries():
    current = C
    robots = {
        item["id"]: dict(item)
        for item in current["objects"]
        if item.get("kind") == "robot"
    }
    old = json.loads(OLD_CONFIG.read_text(encoding="utf-8-sig"))
    old_me6 = next(item for item in old["objects"] if item.get("id") == "me6")
    robots["me6"] = dict(old_me6)
    robots["mg400"] = {
        "id": "mg400",
        "kind": "robot",
        "label": "MG400",
        "package": "mg400",
        "urdf": "mg400_description.urdf",
        "x": 0,
        "y": 0,
        "z": 0,
        "yaw_deg": 0,
        "support": None,
        "joints_deg": {},
    }

    ordered = ["nova2", "nova5", "atom_w", "me6", "mg400"]
    missing = [robot_id for robot_id in ordered if robot_id not in robots]
    if missing:
        raise RuntimeError(f"Missing robot configs: {missing}")
    for robot_id in ordered:
        item = robots[robot_id]
        item.update(x=0, y=0, z=0, yaw_deg=0, support=None)
    return [robots[robot_id] for robot_id in ordered]


def selected_hierarchy(root):
    objects = [root]
    pending = list(root.children)
    while pending:
        item = pending.pop()
        objects.append(item)
        pending.extend(item.children)
    return objects


def export_robot(item):
    C["robot_library"] = str(URDF_ROOT)
    ITEMS.clear()
    ITEMS.update({item["id"]: item})
    ROOTS.clear()
    make_robot(item)
    bpy.context.view_layer.update()

    root = ROOTS[item["id"]]
    root.location = (0, 0, 0)
    root.rotation_euler = (0, 0, 0)
    root.scale = (1, 1, 1)
    root["library_id"] = item["id"]
    root["source_urdf"] = f"{item['package']}/{item['urdf']}"
    root["nominal_mesh_scale_retained"] = True

    hierarchy = selected_hierarchy(root)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in hierarchy:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root

    target = OUTPUT / f"{item['id']}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(target),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_yup=True,
    )
    if not target.is_file() or target.stat().st_size < 1024:
        raise RuntimeError(f"GLB export failed or was unexpectedly small: {target}")
    print(f"ROBOT_LIBRARY {item['id']} {target.stat().st_size} bytes root={root.name} scale=(1,1,1)", flush=True)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in hierarchy:
        bpy.data.objects.remove(obj, do_unlink=True)
    ROOTS.clear()


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    load_generator_prefix()
    entries = robot_entries()
    for item in entries:
        export_robot(item)
    print("ROBOT_LIBRARY_COMPLETE", flush=True)


if __name__ == "__main__":
    main()
