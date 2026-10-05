"""Generate a separate cup-equipped Nova-5 using its own URDF arm geometry."""
from pathlib import Path
import sys, json, xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "build_scene.py"
sys.argv = [str(SOURCE)]
api = {"__file__": str(SOURCE), "__name__": "__main__"}
exec(compile(SOURCE.read_text(encoding="utf-8").split("RANGE_ORANGE=material", 1)[0], str(SOURCE), "exec"), api)
tool = dict(api["C"]["tools"]["nova2"], inner_diameter=.085, cup_center_offset=.070,
            stamp_length=.085, stamp_socket_diameter=.073, stamp_root_diameter=.079,
            stamp_face_diameter=.088, stamp_wrist_mount_y=-.045)
api["C"]["tools"]["nova5_coffee"] = tool
spec = dict(id="nova5_coffee", model_key="nova5_coffee", kind="robot",
            label="Nova-5 beverages / cup prong + lid stamper", package="nova5",
            urdf="nova5_lebai_tongs.urdf", x=0, y=0, z=0, yaw_deg=0, joints_deg={}, support=None)
api["make_robot"](spec)
bpy = api["bpy"]
root = api["ROOTS"][spec["id"]]
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for node in [root, *root.children_recursive]:
    node.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "robot-library/nova5_coffee.glb"),
    export_format="GLB", use_selection=True, export_apply=True, export_extras=True, export_animations=False)
urdf = (HERE / api["C"]["robot_library"] / "nova5/nova5_lebai_tongs.urdf").resolve()
doc = ET.parse(urdf)
joints = []
for i in range(1, 7):
    j = doc.find("./joint[@name='joint%d']" % i)
    origin, limit = j.find("origin"), j.find("limit")
    joints.append(dict(name=j.get("name"), xyz=list(map(float, origin.get("xyz").split())),
        rpy=list(map(float, origin.get("rpy").split())), axis=list(map(float, j.find("axis").get("xyz").split())),
        lower=float(limit.get("lower")), upper=float(limit.get("upper"))))
data = dict(source=str(urdf), joints=joints, tool_length=0, cup_offset=[0,0,.070],
    stamp_offset=[0,0,-.045-joints[-1]["xyz"][1]-.085], stamp_mount_link="Link5",
    stamp_socket_diameter=.073, cup_inner_diameter=.085,
    note="Cup prong and stamp are a planning configuration; mounting socket dimensions require fabrication verification.")
(HERE / "robot-library/nova5_coffee-kinematics.json").write_text(json.dumps(data, indent=2), encoding="utf-8")
print("NOVA-5 BEVERAGE RIG COMPLETE")
