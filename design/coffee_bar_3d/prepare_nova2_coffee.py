"""Build a neutral Nova-2 rig for the illustrative beverage sequence."""
from pathlib import Path
import sys, json, xml.etree.ElementTree as ET
HERE=Path(__file__).resolve().parent
SOURCE=HERE/"build_scene.py"
sys.argv=[str(SOURCE)]
api={"__file__":str(SOURCE),"__name__":"__main__"}
exec(compile(SOURCE.read_text(encoding="utf-8").split("RANGE_ORANGE=material",1)[0],str(SOURCE),"exec"),api)
spec=dict(id="nova2_coffee",model_key="nova2",kind="robot",label="Nova-2 cup prong + lid stamper",package="nova2",urdf="nova2_robot.urdf",x=0,y=0,z=0,yaw_deg=0,joints_deg={},support=None)
api["make_robot"](spec)
bpy=api["bpy"];root=api["ROOTS"][spec["id"]]
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
for node in [root,*root.children_recursive]:node.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(HERE/"robot-library/nova2_coffee.glb"),export_format="GLB",use_selection=True,export_apply=True,export_extras=True,export_animations=False)
urdf=(HERE/api["C"]["robot_library"]/"nova2/nova2_robot.urdf").resolve()
doc=ET.parse(urdf);joints=[]
for i in range(1,7):
    j=doc.find("./joint[@name='joint%d']"%i);o=j.find("origin");limit=j.find("limit")
    joints.append(dict(name=j.get("name"),xyz=list(map(float,o.get("xyz").split())),rpy=list(map(float,o.get("rpy").split())),axis=list(map(float,j.find("axis").get("xyz").split())),lower=float(limit.get("lower")),upper=float(limit.get("upper"))))
tool=api["C"]["tools"]["nova2"]
# The socket is concentric with joint6, so its centre/pressing axis remain
# independent of joint6 even though the stamp is parented to the wrist Link5.
from nova2_tool import stamp_dimensions
dims=stamp_dimensions(tool)
stamp_offset=[0,0,dims["wrist_mount_y"]-joints[-1]["xyz"][1]-dims["length"]]
data=dict(source=str(urdf),joints=joints,tool_length=0,cup_offset=[0,0,tool.get("cup_center_offset",.07)],stamp_offset=stamp_offset,stamp_mount_link="Link5",stamp_socket_diameter=dims["socket_diameter"],cup_inner_diameter=tool.get("inner_diameter",.085))
(HERE/"robot-library/nova2_coffee-kinematics.json").write_text(json.dumps(data,indent=2))
print("NOVA-2 COFFEE RIG COMPLETE")
