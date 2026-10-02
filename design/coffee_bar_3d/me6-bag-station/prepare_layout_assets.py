"""Extract the final ME6 bag-handling pose as editable café-layout assets."""
from pathlib import Path
import json
import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "layout-assets"
OUTPUT.mkdir(exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(HERE / "output/me6-bag-station.blend"))
bpy.context.scene.frame_set(bpy.context.scene.frame_end)
bpy.context.view_layer.update()

components = {
    "me6_robot": {
        "roots": ["layout__me6_bag_robot", "ME6 mounting plate"],
        "anchor": [0, -.27, .908],
        "dimensions": [.19, .15, .60],
    },
    "magazine": {
        "roots": ["01 Bag magazine"],
        "anchor": [-.23, .125, .9],
        "dimensions": [.24, .195, .325],
    },
    "fixed_suction": {
        "roots": ["02 Fixed opposing suction", "Handled kraft bag"],
        "anchor": [.20, .035, .9],
        "dimensions": [.365, .24, .304],
    },
}

for name, component in components.items():
    originals = []
    for root_name in component["roots"]:
        source = bpy.data.objects[root_name]
        originals.extend([source, *source.children_recursive])
    world = {obj: obj.matrix_world.copy() for obj in originals}
    copies = {}
    root = bpy.data.objects.new("station_component__" + name, None)
    bpy.context.scene.collection.objects.link(root)
    root["layout_component"] = name
    shift = Matrix.Translation(-Vector(component["anchor"]))

    for source in originals:
        duplicate = source.copy()
        duplicate.animation_data_clear()
        for constraint in list(duplicate.constraints):
            duplicate.constraints.remove(constraint)
        for key in ["layout_id", "parameters_json"]:
            if key in duplicate:
                del duplicate[key]
        bpy.context.scene.collection.objects.link(duplicate)
        copies[source] = duplicate

    for source, duplicate in copies.items():
        parent = source.parent
        duplicate.parent = copies.get(parent, root)
        duplicate.matrix_parent_inverse = Matrix.Identity(4)
        duplicate.matrix_basis = (
            world[parent].inverted() @ world[source]
            if parent in copies else shift @ world[source]
        )

    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for duplicate in copies.values():
        duplicate.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT / (name + ".glb")),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_extras=True,
        export_animations=False,
    )
    print("EXTRACTED", name, len(copies), flush=True)
    for duplicate in copies.values():
        bpy.data.objects.remove(duplicate, do_unlink=True)
    bpy.data.objects.remove(root, do_unlink=True)

(OUTPUT / "manifest.json").write_text(json.dumps(components, indent=2))
