"""Import the approved ME6 station components into the main café scene."""
from pathlib import Path
import json
import bpy
from mathutils import Matrix

ASSETS = Path(__file__).resolve().parent / "me6-bag-station/layout-assets"


def make_me6_station_component(spec, api):
    component = spec["layout_component"]
    manifest = json.loads((ASSETS / "manifest.json").read_text())
    if component not in manifest:
        raise ValueError("Unknown bag-station component: " + component)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / (component + ".glb")))
    imported = set(bpy.data.objects) - before
    collection = api["COL"]["Robots" if spec["kind"] == "robot" else "Equipment"]
    root = api["root"](spec, collection)
    for obj in imported:
        if obj.parent not in imported:
            obj.parent = root
            obj.matrix_parent_inverse = Matrix.Identity(4)
        for existing_collection in list(obj.users_collection):
            existing_collection.objects.unlink(obj)
        collection.objects.link(obj)
        if "layout_id" in obj:
            del obj["layout_id"]
    if spec["kind"] == "robot":
        root.scale = (spec.get("robot_scale", 1),) * 3
    else:
        nominal = manifest[component]["dimensions"]
        root.scale = (
            spec["width"] / nominal[0],
            spec["depth"] / nominal[1],
            spec["height"] / nominal[2],
        )
    return root
