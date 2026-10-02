"""Configurable front-and-right customer barrier, with a genuine pickup aperture."""
import math


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
    for kind in ["pickup", "tablet", "intercom"] + (["instructions"] if p["show_instructions"] else []):
        side = p[kind + "_side"] if p["right_return"] else "front"
        sections.append(dict(kind=kind, side=side, center=p[kind + "_center"], bottom=p[kind + "_bottom"],
            width=p["intercom_diameter" if kind == "intercom" else kind + "_width"],
            height=p["intercom_diameter" if kind == "intercom" else kind + "_height"]))

    for side in ["front"] + (["right"] if p["right_return"] else []):
        panel = api["empty"]("Front ordering panel" if side == "front" else "Right pickup panel", api["COL"]["Plastic windows"], root)
        if side == "front":
            panel.location.y = -depth / 2
        else:
            panel.location.x = width / 2
            panel.rotation_euler.z = math.pi / 2
        span = width if side == "front" else depth
        features = [s for s in sections if s["side"] == side]
        holes = [s for s in features if s["kind"] != "instructions"]
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
            return text(name, words, (u, -frame/2-.009, z), size, mat, panel, (math.pi/2, 0, 0))

        for s in features:
            kind, u, bottom, w, h = (s[key] for key in ["kind", "center", "bottom", "width", "height"])
            z = bottom + h/2
            if kind == "pickup":
                for edge in [u-w/2-frame/2, u+w/2+frame/2]:
                    box("Pickup jamb", (edge, 0, z), (frame, frame*1.4, h+2*frame), white, panel, .002)
                for level in [bottom-frame/2, bottom+h+frame/2]:
                    box("Pickup opening rail", (u, 0, level), (w, frame*1.4, frame), white, panel, .002)
                sign("Collect label", "COLLECT HERE", u, min(height-.04, bottom+h+.065))
                aperture = api["empty"]("Pickup clear opening", api["COL"]["Plastic windows"], panel)
                aperture.location = (u, 0, z)
                aperture["clear_width"], aperture["clear_height"] = w, h
            elif kind == "tablet":
                box("Embedded tablet bezel", (u, 0, z), (w+.014, .035, h+.014), dark, panel, .004)
                box("Ordering touchscreen", (u, -.018, z), (w-.018, .002, h-.018), white, panel, .001)
                box("Touchscreen heading", (u, -.020, z+h*.32), (w-.023, .002, h*.24), teal, panel, 0)
                sign("Tablet header", "ORDER & COLLECT", u, z+h*.32, w*.06, white)
                sign("Tablet menu", "Fresh buns  /  Coffee", u, z, w*.055)
                sign("Tablet action", "START ORDER", u, z-h*.30, w*.065)
            elif kind == "intercom":
                box("Embedded intercom plate", (u, 0, z), (w+.018, .028, h+.018), white, panel, .003)
                speaker = cyl("Combined microphone and speaker", (u, -.021, z), w*.45, .014, dark, panel, 40)
                speaker.rotation_euler.x = math.pi/2
                for row in range(-3, 4):
                    for column in range(-3, 4):
                        if row*row + column*column > 10:
                            continue
                        dot = cyl("Intercom grille", (u+column*w*.10, -.029, z+row*w*.10), w*.015, .001, steel, panel, 8)
                        dot.rotation_euler.x = math.pi/2
                sign("Intercom label", "MIC + SPEAKER", u, max(.035, bottom-.035), .014)
            else:
                box("Instruction flyer holder", (u, -thickness/2-.005, z), (w+.012, .010, h+.012), white, panel, .002)
                box("Instruction heading strip", (u, -thickness/2-.011, z+h*.38), (w, .002, h*.15), teal, panel, 0)
                sign("Instruction heading", "HOW TO ORDER", u, z+h*.38, w*.062, white)
                for index, words in enumerate(["1  Choose your items", "2  Confirm at tablet", "3  Collect at side window"]):
                    sign("Customer instruction", words, u, z+h*.13-index*h*.19, w*.047)
                sign("Speak instruction", "Speak into the intercom", u, bottom+h*.08, w*.043)
    return root
