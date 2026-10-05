"""Cup prong and directly wrist-mounted printed lid stamper, in metres."""

def stamp_dimensions(tool):
    return {
        "length": tool.get("stamp_length", .085),
        "socket_diameter": tool.get("stamp_socket_diameter", .073),
        "socket_depth": tool.get("stamp_socket_depth", .022),
        "root_diameter": tool.get("stamp_root_diameter", .079),
        "face_diameter": tool.get("stamp_face_diameter", .088),
        "wrist_mount_y": tool.get("stamp_wrist_mount_y", -.045),
    }


def make_cup_stamp(api, flange, wrist, tool=None, label="Nova-2"):
    """Fit a blind socket over Link5's rear housing; no flange-side bracket."""
    import math

    tool = tool or api["C"]["tools"]["nova2"]
    dims = stamp_dimensions(tool)
    length = dims["length"]
    inside = dims["socket_diameter"] / 2
    proximal = dims["root_diameter"] / 2
    distal = dims["face_diameter"] / 2
    depth = dims["socket_depth"]
    if not 0 < depth < length or not 0 < inside < proximal < distal:
        raise ValueError("The stamper needs a blind socket inside a widening cone.")

    root = api["empty"](label + " wrist-mounted lid stamper", api["COL"]["Robots"], wrist)
    root.location = (0, dims["wrist_mount_y"], 0)
    root.rotation_euler.x = -math.pi / 2
    root["role"] = "cup_stamp"
    root["mount_link"] = "Link5"
    root["mount_type"] = "direct_socket"

    # Four rings: socket mouth, outer shoulder, pressing rim, blind bore bottom.
    # The axial opening is a real recess, not a dark painted disc.
    segments = 64
    rings = [(inside, 0), (proximal, 0), (distal, -length), (inside, -depth)]
    vertices = [(r * math.cos(i * 2 * math.pi / segments),
                 r * math.sin(i * 2 * math.pi / segments), z)
                for r, z in rings for i in range(segments)]
    faces = []
    for i in range(segments):
        j = (i + 1) % segments
        faces.extend([
            (i, segments + i, segments + j, j),
            (segments + i, 2 * segments + i, 2 * segments + j, segments + j),
            (3 * segments + i, i, j, 3 * segments + j),
        ])
    face_center = len(vertices)
    vertices.append((0, 0, -length))
    bore_center = len(vertices)
    vertices.append((0, 0, -depth))
    for i in range(segments):
        j = (i + 1) % segments
        faces.extend([
            (face_center, 2 * segments + j, 2 * segments + i),
            (bore_center, 3 * segments + i, 3 * segments + j),
        ])

    mesh = api["bpy"].data.meshes.new("Printed stamp with wrist socket")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    cone = api["bpy"].data.objects.new("Printed truncated-cone cup stamp", mesh)
    api["finish"](cone, cone.name, root, api["TEAL"], api["COL"]["Robots"])
    cone["shape"] = "truncated_cone"
    cone["distal_diameter_m"] = dims["face_diameter"]
    cone["proximal_diameter_m"] = dims["root_diameter"]
    cone["socket_diameter_m"] = dims["socket_diameter"]
    cone["socket_depth_m"] = depth
    cone["length_m"] = length

    cup = api["empty"](label + " cup centre", api["COL"]["Robots"], flange)
    cup.location = (0, 0, tool.get("cup_center_offset", .070))
    cup["role"] = "cup_tcp"
    stamp = api["empty"](label + " stamp contact", api["COL"]["Robots"], root)
    stamp.location = (0, 0, -length)
    stamp["role"] = "stamp_tcp"
