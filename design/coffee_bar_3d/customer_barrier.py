"""Configurable front-and-right customer barrier, with a genuine pickup aperture."""
import math
import bpy


def make_ordering_console(panel, features, parameters, api, white):
    controls = [s for s in features if s["kind"] in {"tablet", "intercom"}]
    if not parameters.get("console_enabled", True) or not controls:
        return None
    left = min(s["center"] - s["width"]/2 for s in controls) - .035
    right = max(s["center"] + s["width"]/2 for s in controls) + .035
    depth = parameters.get("console_projection", .30)
    angle = math.radians(parameters.get("console_incline_deg", 40))
    base = parameters.get("console_base", 0)
    front = base + parameters.get("console_lip_height", .045)
    back = front + depth * math.tan(angle)
    vertices = [(left,0,base),(right,0,base),(right,-depth,base),(left,-depth,base),
                (left,0,back),(right,0,back),(right,-depth,front),(left,-depth,front)]
    faces = [(0,1,2,3),(0,4,5,1),(3,2,6,7),(0,3,7,4),(1,5,6,2),(4,7,6,5)]
    mesh = bpy.data.meshes.new("Sloped console housing mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    body = bpy.data.objects.new("Projecting sloped ordering console", mesh)
    api["finish"](body, body.name, panel, white)
    body["barrierRole"] = "ordering-console"
    surface = api["empty"]("Inclined control surface", api["COL"]["Plastic windows"], panel)
    surface.location = (0, -depth, front)
    surface.rotation_euler.x = angle - math.pi/2
    surface["inclineDegrees"] = parameters.get("console_incline_deg", 40)
    return surface


def make_customer_barrier(spec, api):
    p = spec["barrier"]
    root = api["root"](spec, api["COL"]["Plastic windows"])
    width, depth, height = spec["width"], spec["depth"], spec["height"]
    frame, thickness = p["frame"], p["thickness"]
    glass = api["material"]("Customer polycarbonate", (.72, .90, .94, p["opacity"]), 0, .12)
    bsdf = glass.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Alpha"].default_value = p["opacity"]
    bsdf.inputs["IOR"].default_value = 1.49
    glass.surface_render_method = "DITHERED"
    box, cyl, text = api["box"], api["cyl"], api["text_obj"]
    steel, white, dark, teal = (api[key] for key in ["STEEL", "WHITE", "DARK", "TEAL"])

    sections = []
    for kind in ["pickup", "tablet", "intercom", "instructions"]:
        if not p.get("show_" + kind, True):
            continue
        side = ("right" if not p.get("front_panel", True) else p[kind + "_side"]) if p["right_return"] else "front"
        sections.append(dict(kind=kind, side=side, center=p[kind + "_center"], bottom=p[kind + "_bottom"],
            width=p["intercom_diameter" if kind == "intercom" else kind + "_width"],
            height=p["intercom_diameter" if kind == "intercom" else kind + "_height"]))

    for side in (["front"] if p.get("front_panel", True) or not p["right_return"] else []) + (["right"] if p["right_return"] else []):
        panel = api["empty"]("Front barrier panel" if side == "front" else "Side barrier panel", api["COL"]["Plastic windows"], root)
        if side == "front":
            panel.location.y = -depth / 2
        else:
            panel.location.x = width / 2
            panel.rotation_euler.z = math.pi / 2
        span = width if side == "front" else depth
        features = [s for s in sections if s["side"] == side]
        console_surface = make_ordering_console(panel, features, p, api, white)
        holes = [s for s in features if s["kind"] != "instructions" and not (console_surface and s["kind"] in {"tablet", "intercom"})]
        xs, zs = [-span / 2, span / 2], [0, height]
        for hole in holes:
            xs += [hole["center"] - hole["width"] / 2, hole["center"] + hole["width"] / 2]
            zs += [hole["bottom"], hole["bottom"] + hole["height"]]
        xs, zs = sorted(set(xs)), sorted(set(zs))
        for x1, x2 in zip(xs, xs[1:]):
            for z1, z2 in zip(zs, zs[1:]):
                u, z = (x1 + x2) / 2, (z1 + z2) / 2
                if any(s["center"] - s["width"] / 2 < u < s["center"] + s["width"] / 2 and s["bottom"] < z < s["bottom"] + s["height"] for s in holes):
                    continue
                if x2 - x1 > 1e-8 and z2 - z1 > 1e-8:
                    box("Clear plastic pane", (u, 0, z), (x2-x1, thickness, z2-z1), glass, panel, 0)
        for u in [-span/2, span/2]:
            box("Perimeter upright", (u, 0, height/2), (frame, frame, height), steel, panel, .002)
        box("Top perimeter rail", (0, 0, height-frame/2), (span, frame, frame), steel, panel, .002)
        pickup = next((s for s in features if s["kind"] == "pickup"), None)
        base = [(-span/2, span/2)]
        if pickup and pickup["bottom"] < frame:
            base = [(-span/2, pickup["center"]-pickup["width"]/2), (pickup["center"]+pickup["width"]/2, span/2)]
        for left, right in base:
            if right > left:
                box("Bottom perimeter rail", ((left+right)/2, 0, 0), (right-left, frame, frame), steel, panel, .002)

        def sign(name, words, u, z, size=.021, mat=teal):
            return text(name, words, (u, -frame/2-.009, z), size, mat, drawing_parent, (math.pi/2, 0, 0))

        for s in features:
            kind, u, bottom, w, h = (s[key] for key in ["kind", "center", "bottom", "width", "height"])
            drawing_parent = console_surface if console_surface and kind in {"tablet", "intercom"} else panel
            z = bottom + h/2
            if kind == "pickup":
                for edge in [u-w/2-frame/2, u+w/2+frame/2]:
                    box("Pickup jamb", (edge, 0, z), (frame, frame*1.4, h+2*frame), white, drawing_parent, .002)
                for level in [bottom-frame/2, bottom+h+frame/2]:
                    box("Pickup opening rail", (u, 0, level), (w, frame*1.4, frame), white, drawing_parent, .002)
                sign("Collect label", "COLLECT HERE", u, min(height-.04, bottom+h+.065))
                aperture = api["empty"]("Pickup clear opening", api["COL"]["Plastic windows"], drawing_parent)
                aperture.location = (u, 0, z)
                aperture["clear_width"], aperture["clear_height"] = w, h
            elif kind == "tablet":
                box("Tablet bezel", (u, 0, z), (w+.014, .035, h+.014), dark, drawing_parent, .004)
                box("Ordering touchscreen", (u, -.018, z), (w-.018, .002, h-.018), white, drawing_parent, .001)
                box("Touchscreen heading", (u, -.020, z+h*.32), (w-.023, .002, h*.24), teal, drawing_parent, 0)
                sign("Tablet header", "ORDER & COLLECT", u, z+h*.32, w*.06, white)
                sign("Tablet menu", "Fresh buns  /  Coffee", u, z, w*.055)
                sign("Tablet action", "START ORDER", u, z-h*.30, w*.065)
            elif kind == "intercom":
                box("Intercom mounting plate", (u, 0, z), (w+.018, .028, h+.018), white, drawing_parent, .003)
                speaker = cyl("Combined microphone and speaker", (u, -.021, z), w*.45, .014, dark, drawing_parent, 40)
                speaker.rotation_euler.x = math.pi/2
                for row in range(-3, 4):
                    for column in range(-3, 4):
                        if row*row + column*column > 10:
                            continue
                        dot = cyl("Intercom grille", (u+column*w*.10, -.029, z+row*w*.10), w*.015, .001, steel, drawing_parent, 8)
                        dot.rotation_euler.x = math.pi/2
                sign("Intercom label", "MIC + SPEAKER", u, max(.035, bottom-.035), .014)
            else:
                box("Instruction flyer holder", (u, -thickness/2-.005, z), (w+.012, .010, h+.012), white, drawing_parent, .002)
                box("Instruction heading strip", (u, -thickness/2-.011, z+h*.38), (w, .002, h*.15), teal, drawing_parent, 0)
                sign("Instruction heading", "HOW TO ORDER", u, z+h*.38, w*.062, white)
                for index, words in enumerate(["1  Choose your items", "2  Confirm at tablet", "3  Collect at side window"]):
                    sign("Customer instruction", words, u, z+h*.13-index*h*.19, w*.047)
                sign("Speak instruction", "Speak into the intercom", u, bottom+h*.08, w*.043)
    return root
