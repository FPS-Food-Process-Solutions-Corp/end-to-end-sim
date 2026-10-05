"""Export a neutral, articulated Lebai-tongs Nova-5 for the bread flow."""
from pathlib import Path
import json, sys, xml.etree.ElementTree as ET
HERE = Path(__file__).resolve().parent
SOURCE = HERE / "build_scene.py"
sys.argv = [str(SOURCE)]
api = {"__file__": str(SOURCE), "__name__": "__main__"}
exec(compile(SOURCE.read_text(encoding="utf-8").split("RANGE_ORANGE=material", 1)[0], str(SOURCE), "exec"), api)
urdf = (HERE / api["C"]["robot_library"] / "nova5/nova5_lebai_tongs.urdf").resolve()
doc = ET.parse(urdf)
spec = dict(id="nova5_bread_rig", model_key="nova5", kind="robot", label="Nova-5 / Lebai tongs", package="nova5", urdf=urdf.name, x=0, y=0, z=0, yaw_deg=0, joints_deg={}, support=None)
api["make_robot"](spec)
bpy = api["bpy"]
root = api["ROOTS"][spec["id"]]
tip = next(n for n in root.children_recursive if n.get("urdf_link") == "lebai_ee")
tcp = api["empty"]("Bread grasp centre", api["COL"]["Robots"], tip)
tcp.location.z = -.03
tcp["role"] = "bread_tcp"
grip = {}
for joint in doc.findall("joint"):
    name = joint.get("name")
    if not name.startswith("gripper") or joint.get("type") not in {"revolute", "continuous"}:
        continue
    mimic = joint.find("mimic")
    grip[name] = dict(axis=list(map(float, joint.find("axis").get("xyz").split())), multiplier=float(mimic.get("multiplier", "1")) if mimic is not None else 1)
for node in root.children_recursive:
    if node.get("urdf_joint") in grip:
        node["grip_axis"] = grip[node["urdf_joint"]]["axis"]
        node["grip_multiplier"] = grip[node["urdf_joint"]]["multiplier"]
bpy.context.view_layer.update()
# Calibrate the aperture from the same mesh band used by the browser preview.
from mathutils import Matrix, Vector
actuator = doc.find("./joint[@name='gripper_r_joint1']/limit")
lower, upper = float(actuator.get("lower")), float(actuator.get("upper"))
grip_nodes = [n for n in root.children_recursive if n.get("urdf_joint") in grip]
rest = {n.name:n.matrix_basis.copy() for n in grip_nodes}
def aperture(angle):
    for node in grip_nodes:
        g = grip[node["urdf_joint"]]
        node.matrix_basis = rest[node.name] @ Matrix.Rotation(angle*g["multiplier"],4,Vector(g["axis"]))
    bpy.context.view_layer.update()
    inverse = tcp.matrix_world.inverted()
    bounds = []
    for node in root.children_recursive:
        if node.type != "MESH" or not any(name+" visual" in node.name for name in ("gripper_r_tong","gripper_l_tong")):
            continue
        transform = inverse @ node.matrix_world
        points = [transform @ v.co for v in node.data.vertices]
        xs = [p.x for p in points if abs(p.z)<.035]
        if xs:
            bounds.append((min(xs),max(xs)))
    bounds.sort()
    return max(0,bounds[1][0]-bounds[0][1]) if len(bounds)==2 else 0
maximum_aperture = max(aperture(lower+(upper-lower)*i/100) for i in range(101))
for node in grip_nodes:
    node.matrix_basis=rest[node.name]
tcp["grip_lower"]=lower
tcp["grip_upper"]=upper
tcp["maximum_aperture"]=maximum_aperture
bpy.context.view_layer.update()

bpy.ops.object.select_all(action="DESELECT")
for node in [root, *root.children_recursive]:
    node.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(HERE / "robot-library/nova5_bread.glb"), export_format="GLB", use_selection=True, export_apply=True, export_extras=True, export_animations=False)
data = json.loads((HERE / "robot-library/nova5_suction-kinematics.json").read_text())
mount = float(doc.find("./joint[@name='lebai_mount_joint']/origin").get("xyz").split()[2])
tip_length = float(doc.find("./joint[@name='lebai_ee_joint']/origin").get("xyz").split()[2]) + mount
data.update(grip_limits=[lower,upper], maximum_aperture=maximum_aperture, source=str(urdf), tool_length=tip_length-.03, tip_length=tip_length, grasp_inset=.03, note="TCP is 30 mm behind the URDF lebai_ee open tip plane; jaw contact is a geometric preview, not force simulation.")
for key in ["tool_face", "cup_diameter", "cup_spacing"]:
    data.pop(key, None)
(HERE / "robot-library/nova5_bread-kinematics.json").write_text(json.dumps(data, indent=2))
print("BREAD RIG COMPLETE")
