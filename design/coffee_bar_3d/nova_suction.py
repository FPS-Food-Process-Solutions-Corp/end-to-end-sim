"""Nova-5 flange-mounted four-cup tool, 80 x 80 x 100 mm overall."""
import math


def make_nova_suction_tool(mount, api):
    box, cyl, empty = (api[name] for name in ["box", "cyl", "empty"])
    steel, dark, teal = (api[name] for name in ["STEEL", "DARK", "TEAL"])
    tool = empty("Nova-5 / 80 mm four-cup suction head", api["COL"]["Robots"], mount)
    tool["role"] = "nova_suction_tool"
    tool["face_width_m"] = .08
    tool["face_height_m"] = .08
    tool["flange_to_contact_m"] = .10
    cyl("Suction flange adapter", (0, 0, .006), .031, .012, steel, tool)
    box("Suction head body", (0, 0, .042), (.060, .060, .060), dark, tool, .004)
    box("80 x 80 mm suction face", (0, 0, .073), (.080, .080, .006), steel, tool, .002)
    for x in [-.025, .025]:
        for y in [-.025, .025]:
            cyl("Suction cup stem", (x, y, .082), .004, .012, steel, tool)
            api["bpy"].ops.mesh.primitive_cone_add(
                vertices=40, radius1=.0045, radius2=.010, depth=.018)
            cup = api["finish"](api["bpy"].context.object, "Nova-5 suction cup", tool, teal)
            cup.location = (x, y, .091)
            cup["vacuum_cup"] = True
            # The lip defines the contact plane exactly 100 mm from the flange.
            cyl("Suction cup lip", (x, y, .099), .010, .002, teal, tool)
    tcp = empty("Nova-5 suction TCP", api["COL"]["Robots"], mount)
    tcp.location = (0, 0, .10)
    tcp["role"] = "suction_tcp"
    return tool
