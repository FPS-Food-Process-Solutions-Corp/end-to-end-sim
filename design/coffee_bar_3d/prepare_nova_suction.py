"""Export the neutral Nova-5 suction rig and its six-joint URDF chain."""
from pathlib import Path
import json
import sys
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "build_scene.py"
sys.argv = [str(SOURCE)]
api = {"__file__": str(SOURCE), "__name__": "__main__"}
exec(compile(SOURCE.read_text(encoding="utf-8").split("RANGE_ORANGE=material", 1)[0], str(SOURCE), "exec"), api)
urdf = Path("D:/Work/FPS/Robotics/urdf/robots/nova5/nova5_lebai_tongs.urdf")
api["C"]["robot_library"] = str(urdf.parent.parent)
spec = dict(id="nova5_suction", model_key="nova5_suction", kind="robot",
    label="Nova-5 / suction", package="nova5", urdf=urdf.name,
    x=0, y=0, z=0, yaw_deg=0, joints_deg={}, support=None)
api["make_robot"](spec)
bpy = api["bpy"]
bpy.context.view_layer.update()
root = api["ROOTS"]["nova5_suction"]
bpy.ops.object.select_all(action="DESELECT")
for obj in [root, *root.children_recursive]:
    obj.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=str(HERE / "robot-library/nova5_suction.glb"), export_format="GLB",
    use_selection=True, export_apply=True, export_extras=True, export_animations=False)
doc = ET.parse(urdf)
joints = []
for index in range(1, 7):
    joint = doc.find("./joint[@name='joint%d']" % index)
    origin, limit = joint.find("origin"), joint.find("limit")
    joints.append(dict(
        name=joint.get("name"), child=joint.find("child").get("link"),
        xyz=list(map(float, origin.get("xyz").split())),
        rpy=list(map(float, origin.get("rpy").split())),
        axis=list(map(float, joint.find("axis").get("xyz").split())),
        lower=float(limit.get("lower")), upper=float(limit.get("upper"))))
data = dict(source=str(urdf), base_link="base_link", joints=joints, tool_length=.10,
    tool_face=[.08,.08], cup_diameter=.02, cup_spacing=.05,
    note="The URDF dummy cart transform is omitted; the editor provides the mounting transform. Zero effort/velocity values in this URDF are not motion limits.")
(HERE / "robot-library/nova5_suction-kinematics.json").write_text(json.dumps(data, indent=2))
print("NOVA SUCTION RIG COMPLETE", flush=True)

# Retain the original cart as a library asset after the main scene moves to one table.
cart = dict(id="nova5_cart", kind="cart", label="Nova-5 cart", x=0, y=0, z=0,
    width=.6, depth=.8, height=.8, top_thickness=.035, yaw_deg=0, support=None)
api["make_table"](cart)
cart_root = api["ROOTS"]["nova5_cart"]
bpy.ops.object.select_all(action="DESELECT")
for obj in [cart_root, *cart_root.children_recursive]:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "robot-library/nova5_cart.glb"),
    export_format="GLB", use_selection=True, export_apply=True, export_extras=True,
    export_animations=False)
(HERE / "robot-library/nova5_cart.json").write_text(json.dumps(cart, indent=2))
