"""Parameterized bakery cell. Run with Blender 4.5 LTS, in background or UI.

All dimensions are metres. Source footprints are from source_layout.drawio.
This is a spatial concept model, not a robot motion/safety simulation.
"""
import argparse
import json
import math
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from shelf_parameters import shelf_layout
from bag_opener import make_bag_opener
from me6_station import make_me6_station_component
from nova_suction import make_nova_suction_tool
from nova2_tool import make_cup_stamp
from customer_barrier import make_customer_barrier
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--config', default=str(HERE / 'scene_config.json'))
parser.add_argument('--output', default=str(HERE / 'output'), help='Destination for the generated Blender, GLB and renders')
parser.add_argument('--no-render', action='store_true')
parser.add_argument('--preview', action='store_true', help='Faster, smaller renders')
opt = parser.parse_args(args)
config_path = Path(opt.config).resolve()
C = json.loads(config_path.read_text(encoding='utf-8-sig'))
OUT = Path(opt.output).resolve()
OUT.mkdir(parents=True, exist_ok=True)
ITEMS = {o['id']: o for o in C['objects']}
ROOTS = {}
IMPORT_CACHE = {}
REPORT = {'units': 'metres', 'source': C['source_plan'], 'objects': [], 'robot_imports': [], 'notes': C['assumptions']}

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for collection in list(bpy.data.collections):
    if collection.name != 'Collection':
        bpy.data.collections.remove(collection)
BASE = bpy.data.collections.get('Collection')
BASE.name = 'Architecture'


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


COL = {name: collection(name) for name in ['Furniture', 'Equipment', 'Shelves', 'Robots', 'Plastic windows', 'Human reference', 'Annotations', 'Lighting and cameras']}


def move_collection(o, col):
    for old in list(o.users_collection):
        old.objects.unlink(o)
    col.objects.link(o)


def material(name, color, metal=0, rough=.4):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color[:3], color[3] if len(color) > 3 else 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = m.diffuse_color
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    return m


STEEL = material('Brushed stainless steel', (.53, .59, .62, 1), .8, .3)
DARK = material('Graphite polymer', (.027, .040, .055, 1), .18, .34)
WHITE = material('Warm white machine enamel', (.82, .85, .85, 1), .15, .27)
BLACK = material('Black rubber', (.014, .019, .025, 1), 0, .7)
BLUE = material('Robot blue', (.19, .42, .58, 1), .38, .3)
ROBOT_WHITE = material('Robot silver white', (.62, .70, .76, 1), .3, .31)
FLOOR = material('Warm mineral floor', (.60, .62, .59, 1), 0, .75)
WALL = material('Warm plaster', (.80, .80, .74, 1), 0, .8)
OAK = material('Counter sage finish', (.19, .31, .30, 1), 0, .44)
PAPER = material('Cup paper', (.90, .84, .70, 1), 0, .65)
CARD = material('Kraft takeaway box', (.47, .29, .13, 1), 0, .8)
BREAD = material('Golden bun crust', (.54, .24, .060, 1), 0, .55)
SKIN = material('Scale mannequin skin', (.64, .43, .30, 1), 0, .72)
SHIRT = material('Scale mannequin shirt', (.72, .77, .72, 1), 0, .9)
PANTS = material('Scale mannequin trousers', (.055, .085, .12, 1), 0, .9)
TEAL = material('Wayfinding teal', (.023, .24, .27, 1), .15, .5)
GLASS = material('Clear blue polycarbonate', (.76, .92, .98, 1), 0, .07)
glass_bsdf = GLASS.node_tree.nodes.get('Principled BSDF')
glass_bsdf.inputs['Transmission Weight'].default_value = .96
glass_bsdf.inputs['IOR'].default_value = 1.49
SCREEN = material('Display glass', (.015, .10, .12, 1), .25, .2)
SCREEN.node_tree.nodes.get('Principled BSDF').inputs['Emission Color'].default_value = (.05, .3, .34, 1)
SCREEN.node_tree.nodes.get('Principled BSDF').inputs['Emission Strength'].default_value = .4


def finish(o, name, parent=None, mat=None, col=None):
    o.name = name
    if parent:
        o.parent = parent
    if mat and o.type in {'MESH', 'FONT', 'CURVE'}:
        o.data.materials.clear()
        o.data.materials.append(mat)
    move_collection(o, col or (parent.users_collection[0] if parent else BASE))
    return o


def empty(name, col, parent=None):
    o = bpy.data.objects.new(name, None)
    col.objects.link(o)
    if parent:
        o.parent = parent
    o.empty_display_type = 'PLAIN_AXES'
    o.empty_display_size = .08
    return o


def box(name, pos, size, mat=STEEL, parent=None, bevel=.006, col=None):
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = finish(bpy.context.object, name, parent, mat, col)
    o.location = pos
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('Soft manufactured edges', 'BEVEL')
        b.width = min(bevel, min(size) / 3)
        b.segments = 3
        o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return o


def cyl(name, pos, radius, depth, mat=STEEL, parent=None, vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    o = finish(bpy.context.object, name, parent, mat)
    o.location = pos
    for p in o.data.polygons:
        p.use_smooth = True
    b = o.modifiers.new('Edge rounding', 'BEVEL')
    b.width = min(.002, radius / 5, depth / 5)
    b.segments = 2
    o.modifiers.new('Weighted normals', 'WEIGHTED_NORMAL')
    return o


def ellipsoid(name, pos, scale, mat, parent):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12)
    o = finish(bpy.context.object, name, parent, mat)
    o.location = pos
    o.scale = scale
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def rod(name, a, b, radius, mat, parent):
    v = Vector(b) - Vector(a)
    o = cyl(name, (Vector(a) + Vector(b)) / 2, radius, v.length, mat, parent)
    o.rotation_euler = v.to_track_quat('Z', 'Y').to_euler()
    return o


def text_obj(name, body, pos, size=.06, mat=DARK, parent=None, rotation=(0, 0, 0), align='CENTER'):
    curve = bpy.data.curves.new(name, 'FONT')
    curve.body = body
    curve.align_x = align
    curve.align_y = 'CENTER'
    curve.size = size
    curve.extrude = .0002
    o = bpy.data.objects.new(name, curve)
    finish(o, name, parent, mat, COL['Annotations'] if parent is None else None)
    o.location = pos
    o.rotation_euler = rotation
    return o


def support_z(o):
    parent = ITEMS.get(o.get('support'))
    return support_z(parent) + parent.get('z', 0) + parent.get('height', 0) if parent else 0


def root(o, col):
    r = empty('layout__' + o['id'], col)
    z = o.get('z', 0) + support_z(o)
    if o['kind'] == 'window':
        z = o['bottom']
    pos=ITEMS.get(o.get('follow'),o)
    r.location = (pos['x'], pos['y'], z)
    r.rotation_euler.z = math.radians(o.get('yaw_deg', 0))
    r['layout_id'] = o['id']
    r['kind'] = o['kind']
    r['label'] = o['label']
    r['parameters_json'] = json.dumps(o)
    r['source_drawio_cell'] = o.get('source_cell', '')
    ROOTS[o['id']] = r
    return r


def make_ventilation_shaft(o):
    r = root(o, COL['Furniture'])
    w, d, h = o['width'], o['depth'], o['height']
    box('Ventilation shaft enclosure / reserved volume', (0, 0, h/2), (w, d, h), WALL, r)
    r['height_status'] = o.get('height_status', 'provisional')
    r['geometry_note'] = o.get('geometry_note', 'Building shaft envelope; internal construction unknown')


def make_table(o):
    r = root(o, COL['Furniture'])
    w, d, h, t = o['width'], o['depth'], o['height'], o.get('top_thickness', .035)
    box('Solid stainless worktop', (0, 0, h-t/2), (w, d, t), STEEL, r)
    if o['kind'] == 'counter':
        box('Service counter cabinet', (0, 0, (h-t)/2), (w-.035, d-.035, h-t-.04), OAK, r, .012)
        for sx in [-1, 1]:
            box('Front counter seam', (sx*w*.24, -d/2+.012, h*.46), (.004, .005, h*.77), TEAL, r, 0)
        text_obj('Order pickup sign', o.get('sign_text','ORDER / PICKUP'), (0, -d/2-.002, h*.66), .045, WHITE, r, (math.pi/2, 0, 0))
        if o.get('ordering_terminal', True):
            terminal = box('Ordering terminal', (0, (-d/2+.16), h+.16), (.22, .034, .22), DARK, r, .012)
            terminal.rotation_euler.x = math.radians(15)
            display = box('Order terminal screen', (0, (-d/2+.16)-.022, h+.16), (.188, .005, .175), SCREEN, r, .004)
            display.rotation_euler.x = math.radians(15)
            rod('Terminal stand', (0, (-d/2+.18), h), (0, (-d/2+.16), h+.10), .025, STEEL, r)
        pads = o.get('handoff_pads', [{'x': x, 'y': d*.18, 'width': w*.28, 'depth': d*.3} for x in [-w*.29, w*.29]])
        for pad in pads:
            box('Handoff mat', (pad['x'], pad['y'], h+.002), (pad['width'], pad['depth'], .004), DARK, r, .01)
    else:
        wheel_h = .10 if o['kind'] == 'cart' else .04
        leg_h = h-t-wheel_h
        for x in [-w/2+.045, w/2-.045]:
            for y in [-d/2+.045+j*(d-.09)/max(1,math.ceil(d/1.2)) for j in range(max(1,math.ceil(d/1.2))+1)]:
                box('Square steel leg', (x, y, wheel_h+leg_h/2), (.03, .03, leg_h), STEEL, r, .002)
                if o['kind'] == 'cart':
                    wheel = cyl('Cart caster', (x, y, .05), .043, .025, BLACK, r)
                    wheel.rotation_euler.x = math.pi/2
                    box('Caster fork', (x, y, .081), (.022, .035, .04), STEEL, r, .002)
                else:
                    cyl('Adjustable foot', (x, y, .022), .022, .044, BLACK, r)
        box('Lower solid shelf', (0, 0, .24), (w-.035, d-.035, .02), STEEL, r)
    return r



def make_top_label(o, parent, label, mat=DARK, round_cap=False):
    """Thin surface lettering, with its baseline along the longer local side."""
    w, d, h = o['width'], o['depth'], o['height']
    size = min(.070, min(w, d) * (.20 if round_cap else .32))
    along_depth = d > w and not round_cap
    label_obj = text_obj('Top imprint / ' + label, label, (0, 0, h + .0006), size, mat, parent, (0, 0, -math.pi/2 if along_depth else 0))
    label_obj.data.extrude = .00012
    bpy.context.view_layer.update()
    span = max(v[0] for v in label_obj.bound_box) - min(v[0] for v in label_obj.bound_box)
    fit = min(1, max(w, d) * (.76 if round_cap else .78) / max(span, .0001))
    label_obj.scale = (fit, fit, fit)
    label_obj['equipment_top_label'] = True
    label_obj['text'] = label
    label_obj['long_axis'] = 'depth' if along_depth else 'width'
    return label_obj


def make_machine(o):
    if o.get('machine_type') == 'bag_opener':
        return make_bag_opener(globals(), o)
    r = root(o, COL['Equipment'])
    w, d, h = o['width'], o['depth'], o['height']
    style = o.get('style', 'coffee')
    box(o['label']+' envelope', (0, 0, h/2), (w, d, h), WHITE if style=='coffee' else STEEL, r, .016)
    if style == 'fridge':
        box('Fridge door', (0, -d/2-.005, h*.50), (w*.88, .012, h*.9), WHITE, r, .01)
        rod('Fridge handle', (w*.32, -d/2-.024, h*.40), (w*.32, -d/2-.024, h*.71), .008, DARK, r)
    elif style == 'ice':
        box('Ice bin lid', (0, -d/2-.006, h*.53), (w*.85, .012, h*.57), DARK, r, .008)
        box('Ice bin face', (0, -d/2-.013, h*.53), (w*.74, .008, h*.49), STEEL, r, .006)
        rod('Ice bin handle', (-w*.22, -d/2-.032, h*.71), (w*.22, -d/2-.032, h*.71), .009, DARK, r)
        for j in range(6):
            box('Condenser vent', (0, -d/2-.004, .055+j*.012), (w*.7, .006, .004), DARK, r, 0)
    else:
        box('Front control fascia', (0, -d/2-.004, h*.62), (w*.87, .01, h*.67), DARK, r, .009)
        box('Touchscreen', (0, -d/2-.011, h*.79), (w*.55, .008, h*.19), SCREEN, r, .005)
        box('Dispensing recess', (0, -d/2-.012, h*.30), (w*.66, .008, h*.29), BLACK, r, .004)
        box('Drip tray', (0, -d/2-.028, h*.12), (w*.77, .055, .012), STEEL, r, .003)
        for x in [-w*.12, w*.12]:
            cyl('Nozzle', (x, -d/2-.025, h*.45), .009, .04, STEEL, r)
        if style == 'tea':
            for x in [-w*.32, w*.32]:
                cyl('Tea selector', (x, -d/2-.018, h*.62), .018, .012, WHITE, r)
    text_obj('Equipment label', o.get('display_label', o['label'].upper()), (0, -d/2-.016, h*.95), min(.023, w/14), DARK, r, (math.pi/2, 0, 0))
    title = o.get('display_label') or o.get('top_label') or {'ice':'ICE', 'tea':'TEA', 'coffee':'COFFEE', 'fridge':'MILK', 'lid_press':'LID PRESS'}.get(style, o['label'].upper())
    make_top_label(o, r, title)


def make_dispenser(o):
    r = root(o, COL['Equipment'])
    rad, h = o['diameter']/2, o['height']
    is_lid = 'lid' in o.get('asset_key', o['id']) or 'lid' in o['label'].lower()
    gap = o.get('bottom_clearance', .30)
    if not 0 <= gap < h:
        raise ValueError('Dispenser clearance must be smaller than its overall height.')
    cyl('Dispenser cylindrical housing', (0, 0, gap+(h-gap)/2), rad, h-gap, STEEL, r)
    cyl('Dispenser upper cap', (0, 0, h-.007), rad*1.06, .014, DARK, r)
    cyl('Dispenser lower collar', (0, 0, gap+.012), rad*1.06, .024, DARK, r)
    for j in range(5):
        cyl('Nested lid lip' if is_lid else 'Nested cup lip', (0, 0, gap+.03+j*.009), rad*.88, .003, PAPER, r)
    if gap:
        pw, pd, pt = o.get('base_plate_width', .14), o.get('base_plate_depth', .16), o.get('base_plate_thickness', .006)
        post, rear = o.get('rear_support_size', .020), o.get('rear_support_offset', rad+.029)
        plate_y = .025
        box(('Lid' if is_lid else 'Cup')+' dispenser table mounting plate', (0, plate_y, pt/2), (pw,pd,pt), STEEL, r, .003)
        for x in [-pw/2+.015, pw/2-.015]:
            for y in [plate_y-pd/2+.015, plate_y+pd/2-.015]:
                cyl('Baseplate bolt washer', (x,y,pt+.001), .0075, .002, STEEL, r)
                cyl('Baseplate hex bolt head', (x,y,pt+.004), .0055, .004, DARK, r, vertices=6)
        post_h = h-.035-pt
        box(('Lid' if is_lid else 'Cup')+' dispenser rear upright', (0,rear,pt+post_h/2), (post,post,post_h), STEEL, r, .002)
        for z in [gap+.060, h-.045]:
            bracket_start, bracket_end = rad-.010, rear+post/2
            box('Rear dispenser support bracket', (0,(bracket_start+bracket_end)/2,z), (.034,bracket_end-bracket_start,.016), STEEL, r, .002)
            bolt=cyl('Rear support bracket bolt', (0,rear+post/2+.003,z), .0055,.006,DARK,r,vertices=6)
            bolt.rotation_euler.x=math.pi/2
        r['bottom_clearance_m'] = gap
        r['dispenser_body_height_m'] = h-gap
        r['support_side_local'] = '+Y / rear; front remains open'
    make_top_label(o, r, o.get('display_label') or o.get('top_label') or ('LIDS' if is_lid else 'CUPS'), PAPER, round_cap=True)



def make_shelf(o):
    r = root(o, COL['Shelves'])
    layout = shelf_layout(C, o)
    s = layout['settings']
    o['shelf_overrides'] = s.copy()
    r['shelf_configuration'] = s
    r['clear_column_width_m'] = layout['clear_column_width']
    r['clear_vertical_gap_m'] = layout['clear_vertical_gap']
    r['max_tiers'] = layout['max_tiers']
    length_1, length_2 = s['bread_length_1'], s['bread_length_2']
    bread_h, bread_gap = s['bread_height'], s['bread_gap']
    w, d, h = o['width'], o['depth'], o['height']
    post = s['post_width']
    tray_w, tray_d = layout['tray_width'], layout['tray_depth']
    drop, sheet, divider_h = s['back_to_front_drop'], s['sheet_thickness'], s['divider_height']
    slope, tilted_length = layout['slope'], layout['surface_depth']
    for x in [-w/2+post/2, w/2-post/2]:
        for y in [-d/2+post/2, d/2-post/2]:
            box('Rack post', (x, y, h/2), (post, post, h), STEEL, r, .002)
            cyl('Rack foot', (x, y, .01), .021, .02, BLACK, r)
    for i in range(s['tiers']):
        front_h = s['first_tier_front_height'] + i*s['tier_spacing']
        tier = empty(f'Tier {i+1} / {s["columns"]} columns', COL['Shelves'], r)
        tier.location.z = front_h+drop/2+sheet*math.cos(slope)
        tier.rotation_euler.x = slope
        tier['front_height'] = front_h
        tier['front_bottom_height_m'] = front_h
        tier['rear_height'] = front_h+drop
        tier['clear_width'] = tray_w
        box('Continuous solid stainless tier base', (0, 0, -sheet/2), (tray_w, tilted_length, sheet), STEEL, tier, 0)
        for k in range(1, s['columns']):
            x = -tray_w/2 + k*tray_w/s['columns']
            box(f'Divider {k}', (x, 0, divider_h/2), (sheet, tilted_length, divider_h), STEEL, tier, 0)
        for x in [-tray_w/2, tray_w/2]:
            box('Tray side', (x, 0, divider_h/2), (sheet, tilted_length, divider_h), STEEL, tier, 0)
        for y, lip in [(-tilted_length/2, s['front_lip_height']), (tilted_length/2, divider_h)]:
            box('Tray front or rear lip', (0, y, lip/2), (tray_w, sheet, lip), STEEL, tier, 0)
        if s['show_buns']:
            rows=layout['rows']
            for k in range(s['columns']):
                for j in range(rows):
                    x=-tray_w/2+(k+.5)*tray_w/s['columns']
                    y=(j-(rows-1)/2)*(length_2+bread_gap)
                    bun=ellipsoid('Bun / scale placeholder', (x, y, bread_h/2), (length_1/2, length_2/2, bread_h/2), BREAD, tier)
                    bun['bread_ellipsoid']=True
                    bun['length_1_m']=length_1
                    bun['length_2_m']=length_2
                    bun['height_m']=bread_h
    text_obj('Shelf label', o.get('display_label', o['label'].upper()), (0, -d/2-.007, h-.07), .05, TEAL, r, (math.pi/2, 0, 0))


def make_box_station(o):
    r = root(o, COL['Furniture'])
    w,d,h=o['width'],o['depth'],o['height']
    box('Box work surface', (0,0,h-.012), (w,d,.024), STEEL,r)
    for x in [-w/2+.025,w/2-.025]:
        for y in [-d/2+.025,d/2-.025]:
            box('Box stand leg',(x,y,(h-.024)/2),(.022,.022,h-.024),STEEL,r,.002)
    for i in range(7):
        box('Stacked takeaway box',(0,0,h+.014+i*.025),(w*.82,d*.8,.022),CARD,r,.003)


def make_support(o):
    r=root(o,COL['Furniture'])
    w,d,h=o['width'],o['depth'],o['height']
    box('ME6 cantilever mounting plate',(0,0,h-.01),(w,d,.02),STEEL,r,.002)
    # Two structural brackets connect the small mounting plate back to the cart.
    for x in [-w*.35,w*.35]:
        box('ME6 bracket vertical',(x,-d*.45,h-.12),(.02,.02,.22),STEEL,r,.002)
        rod('ME6 diagonal brace',(x,d*.38,h-.025),(x,-d*.45,h-.22),.012,STEEL,r)


def make_window(o):
    r=root(o,COL['Plastic windows'])
    w,h,t=o['width'],o['height'],o['thickness']
    box('Solid clear plastic panel',(0,0,h/2),(w,t,h),GLASS,r,.001)
    for x in [-w/2+.013,w/2-.013]:
        box('Window upright',(x,0,h/2),(.025,.025,h),STEEL,r,.002)
        box('Panel mounting shoe',(x,0,.015),(.06,.045,.03),STEEL,r,.002)
    for z in [.012,h-.012]:
        box('Slim window rail',(0,0,z),(w,.018,.018),STEEL,r,.002)


def make_human(o):
    r=root(o,COL['Human reference'])
    # Neutral scale mannequin, exact 1.70 m bounds before requested scaling.
    for side in [-1,1]:
        x=side*.095
        ellipsoid('Shoe',(x,.045,.048),(.067,.135,.048),DARK,r)
        rod('Trouser lower leg',(x,0,.13),(x,0,.50),.062,PANTS,r)
        ellipsoid('Knee',(x,0,.51),(.065,.066,.067),PANTS,r)
        rod('Trouser upper leg',(x,0,.53),(side*.087,0,.90),.079,PANTS,r)
    ellipsoid('Pelvis',(0,0,.92),(.175,.108,.13),PANTS,r)
    ellipsoid('Torso',(0,0,1.175),(.205,.119,.26),SHIRT,r)
    cyl('Neck',(0,0,1.451),.052,.09,SKIN,r)
    ellipsoid('Head',(0,0,1.585),(.09,.10,.115),SKIN,r)
    ellipsoid('Nose',(0,.098,1.587),(.021,.025,.031),SKIN,r)
    for side in [-1,1]:
        shoulder=(side*.19,0,1.32)
        elbow=(side*.255,.045,1.10)
        hand=(side*.23,.16,.98)
        ellipsoid('Shoulder',shoulder,(.076,.087,.091),SHIRT,r)
        rod('Sleeve',shoulder,elbow,.059,SHIRT,r)
        ellipsoid('Elbow',elbow,(.047,.047,.047),SKIN,r)
        rod('Forearm',elbow,hand,.043,SKIN,r)
        ellipsoid('Hand',hand,(.043,.027,.075),SKIN,r)
    scale=o['height']/1.7
    for child in list(r.children):
        child.location *= scale
        child.scale *= scale


def origin_matrix(e):
    if e is None:
        return Matrix.Identity(4)
    xyz=tuple(float(v) for v in e.get('xyz','0 0 0').split())
    rpy=tuple(float(v) for v in e.get('rpy','0 0 0').split())
    return Matrix.Translation(xyz) @ Euler(rpy,'XYZ').to_matrix().to_4x4()


def imported_meshes(path):
    key=str(path)
    if key not in IMPORT_CACHE:
        before=set(bpy.data.objects)
        if path.suffix.lower()=='.stl':
            bpy.ops.wm.stl_import(filepath=str(path), forward_axis='Y', up_axis='Z')
        elif path.suffix.lower()=='.dae':
            bpy.ops.wm.collada_import(filepath=str(path))
        elif path.suffix.lower()=='.obj':
            bpy.ops.wm.obj_import(filepath=str(path),forward_axis='Y',up_axis='Z')
        else:
            raise ValueError('Unsupported URDF mesh: '+key)
        created=set(bpy.data.objects)-before
        bpy.context.view_layer.update()
        imported=[]
        for ob in created:
            if ob.type=='MESH':
                imported.append((ob.data, ob.matrix_world.copy()))
        for ob in created:
            bpy.data.objects.remove(ob,do_unlink=True)
        if not imported:
            raise ValueError('Empty mesh import: '+key)
        IMPORT_CACHE[key]=imported
    return IMPORT_CACHE[key]


def curved_cup_jaw(name, start, end, inner, wall, thickness, centre, parent):
    segments = 40
    vertices = []
    for i in range(segments+1):
        a = start+(end-start)*i/segments
        for radius,z in [(inner,-thickness/2),(inner+wall,-thickness/2),(inner,thickness/2),(inner+wall,thickness/2)]:
            vertices.append((radius*math.cos(a),radius*math.sin(a),z))
    faces=[]
    for i in range(segments):
        a,b=4*i,4*(i+1)
        faces.extend([(a,b,b+1,a+1),(a+2,a+3,b+3,b+2),(a+1,b+1,b+3,a+3),(a,a+2,b+2,b)])
    last=segments*4
    faces.extend([(0,1,3,2),(last,last+2,last+3,last+1)])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    jaw=bpy.data.objects.new(name,mesh);finish(jaw,name,parent,STEEL,COL['Robots'])
    jaw.location=(0,0,centre);jaw.rotation_euler.x=math.pi/2
    bevel=jaw.modifiers.new('Soft jaw edges','BEVEL');bevel.width=.0008;bevel.segments=2
    jaw['inner_diameter_m']=inner*2
    return jaw


def make_robot(o):
    r=root(o,COL['Robots'])
    model_key=o.get('model_key',o['id'])
    r.scale=(o.get('robot_scale',1),)*3
    path=HERE/C['robot_library']/o['package']/o['urdf']
    robot=ET.parse(path).getroot()
    links={l.get('name'):l for l in robot.findall('link')}
    children={}
    for j in robot.findall('joint'):
        children.setdefault(j.find('parent').get('link'),[]).append(j)
    link_roots='chassis' if model_key=='atom_w' else 'base_link'
    if link_roots not in links:
        child_names={j.find('child').get('link') for j in robot.findall('joint')}
        link_roots=next(l for l in links if l not in child_names)
    joint_cfg={k:math.radians(v) for k,v in o.get('joints_deg',{}).items()}
    link_objects={}
    count=0

    def add_link(name,parent,local=None):
        nonlocal count
        lo=empty(o['id']+' / '+name,COL['Robots'],parent)
        if local is not None:
            lo.matrix_local=local
        lo['urdf_link']=name
        link_objects[name]=lo
        for i,v in enumerate(links[name].findall('visual')):
            geom=v.find('geometry')
            if geom is None:
                continue
            mesh=geom.find('mesh')
            local_origin=origin_matrix(v.find('origin'))
            mat=ROBOT_WHITE
            if model_key in {'nova2','nova5','nova5_suction','nova5_coffee'}:
                mat=BLUE if name in {'Link1','Link3','Link5'} else ROBOT_WHITE
            if model_key=='me6':
                mat=WHITE if name not in {'Link1','Link3','Link5'} else DARK
            if any(s in name.lower() for s in ['wheel','camera','finger','thumb','wrist','gripper','lebai']):
                mat=DARK
            if model_key=='atom_w' and ('chassis' in name or 'torso' in name):
                mat=WHITE
            if mesh is not None:
                filename=mesh.get('filename')
                mpath=(path.parent/filename).resolve()
                scale=tuple(float(x) for x in mesh.get('scale','1 1 1').split())
                for data, mesh_transform in imported_meshes(mpath):
                    ob=bpy.data.objects.new(o['id']+' / '+name+' visual',data.copy())
                    finish(ob,ob.name,lo,mat,COL['Robots'])
                    ob.matrix_local=local_origin @ Matrix.Diagonal((*scale,1)) @ mesh_transform
                    if len(ob.data.polygons)>18000:
                        dec=ob.modifiers.new('Display mesh reduction; original retained','DECIMATE')
                        dec.ratio=max(.18,18000/len(ob.data.polygons))
                    for poly in ob.data.polygons:
                        poly.use_smooth=True
                    count+=1
            else:
                b=geom.find('box'); c=geom.find('cylinder'); s=geom.find('sphere')
                if b is not None:
                    ob=box(name+' geometry',(0,0,0),tuple(float(x) for x in b.get('size').split()),mat,lo)
                elif c is not None:
                    ob=cyl(name+' geometry',(0,0,0),float(c.get('radius')),float(c.get('length')),mat,lo)
                elif s is not None:
                    radius=float(s.get('radius'))
                    ob=ellipsoid(name+' geometry',(0,0,0),(radius,)*3,mat,lo)
                else:
                    continue
                ob.matrix_basis=local_origin @ ob.matrix_basis
                count+=1
        if model_key in {'nova5_suction','nova5_coffee'} and name == 'Link6':
            return
        for j in children.get(name,[]):
            child=j.find('child').get('link')
            if any(t in child.lower() for t in ['work_table','table_link']):
                continue
            axis=Vector(tuple(float(x) for x in (j.find('axis').get('xyz') if j.find('axis') is not None else '1 0 0').split()))
            value=joint_cfg.get(j.get('name'),0)
            mimic=j.find('mimic')
            if mimic is not None:
                value=joint_cfg.get(mimic.get('joint'),0)*float(mimic.get('multiplier','1'))+float(mimic.get('offset','0'))
            transform=origin_matrix(j.find('origin'))
            if j.get('type') in {'revolute','continuous'}:
                transform=transform @ Matrix.Rotation(value,4,axis)
            elif j.get('type')=='prismatic':
                transform=transform @ Matrix.Translation(axis*value)
            add_link(child,lo,transform)
            link_objects[child]['urdf_joint']=j.get('name')
            link_objects[child]['joint_position']=value
    add_link(link_roots,r)
    if model_key == 'nova5_suction':
        make_nova_suction_tool(link_objects['Link6'], globals())
    if model_key in {'nova2','me6','nova5_coffee'}:
        mount=link_objects.get('Link6') or link_objects.get('link6')
        if mount is None:
            mount=next(reversed(link_objects.values()))
        tool=C['tools'].get(model_key,C['tools']['nova2'])
        if model_key=='me6':
            length,diam=tool['length'],tool['cup_diameter']
            cyl('ME6 suction stem',(0,0,length*.42),.01,length*.84,STEEL,mount)
            bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=diam/2,radius2=.009,depth=.025)
            ob=finish(bpy.context.object,'ME6 suction cup',mount,BLACK)
            ob.location=(0,0,length-.0125)
            ob.rotation_euler.x=math.pi
        else:
            inner=tool.get('inner_diameter',.085)/2
            wall=tool.get('jaw_wall',.006); thickness=tool.get('jaw_thickness',.012); centre=tool.get('cup_center_offset',.070)
            cyl('Cup tong flange',(0,0,.012),.034,.024,STEEL,mount)
            box('Curved cup tong bridge',(0,0,.026),(.026,.018,.008),STEEL,mount,.002)
            opening=math.radians(tool.get('front_opening_deg',120))
            split=math.radians(tool.get('back_gap_deg',4))/2
            curved_cup_jaw('Left curved cup tong / 85 mm ID',math.pi/2+opening/2,3*math.pi/2-split,inner,wall,thickness,centre,mount)
            curved_cup_jaw('Right curved cup tong / 85 mm ID',3*math.pi/2+split,5*math.pi/2-opening/2,inner,wall,thickness,centre,mount)
            make_cup_stamp(globals(), mount, link_objects["Link5"], tool, "Nova-5" if model_key == "nova5_coffee" else "Nova-2")
    REPORT['robot_imports'].append(dict(id=o['id'],urdf=str(path),root=link_roots,visual_count=count,joints_deg=o.get('joints_deg',{})))
    print('ROBOT IMPORTED',o['id'],count,'visuals',flush=True)


def make_architecture():
    w,d=C['room']['width'],C['room']['depth']
    box('Room floor',(w/2,d/2,-.045),(w,d,.09),FLOOR,None,.008)
    for x in [0,w]:
        box('Floor perimeter edge',(x,d/2,.002),(.008,d,.004),TEAL,None,0)
    for y in [0,d]:
        box('Floor perimeter edge',(w/2,y,.002),(w,.008,.004),TEAL,None,0)
    for i in range(1,int(w/.5)+1):
        box('Floor joint',(i*.5,d/2,.001),(.0015,d,.0015),WALL,None,0)
    for i in range(1,int(d/.5)):
        box('Floor joint',(w/2,i*.5,.001),(w,.0015,.0015),WALL,None,0)
    if C['room'].get('show_rear_wall'):
        h,t=C['room']['wall_height'],C['room']['wall_thickness']
        box('Rear wall',(w/2,d+t/2,h/2),(w+t,t,h),WALL,None)
    text_obj('Room width annotation',f'{w:.2f} m',(w/2,-.19,.004),.11,TEAL)
    text_obj('Room depth annotation',f'{d:.2f} m',(-.17,d/2,.004),.11,TEAL,rotation=(0,0,math.pi/2))
    for human in ITEMS.values():
        if human['kind']=='human' and human.get('enabled',True) and human.get('visible',True):
            text_obj('Human height annotation',f"{human['height']:.2f} m", (human['x'],human['y']-.34,.006),.068,TEAL)


def camera(name,loc,target,lens=48,ortho=None):
    data=bpy.data.cameras.new(name)
    obj=bpy.data.objects.new(name,data)
    COL['Lighting and cameras'].objects.link(obj)
    obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.lens=lens
    data.clip_end=100
    if ortho:
        data.type='ORTHO'
        data.ortho_scale=ortho
    return obj


def light(name,loc,power,size,target):
    data=bpy.data.lights.new(name,'AREA')
    data.energy=power
    data.shape='DISK'
    data.size=size
    obj=bpy.data.objects.new(name,data)
    COL['Lighting and cameras'].objects.link(obj)
    obj.location=loc
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()



def dashed_segment(name, a, b, mat, parent=None, width=.012, dash=.06, gap=.045):
    a,b=Vector(a),Vector(b)
    length=(b-a).length
    direction=(b-a).normalized()
    t=0
    while t < length:
        end=min(t+dash,length)
        obj=box(name,(a+direction*t+a+direction*end)/2,(width,end-t,.003),mat,parent,0)
        obj.rotation_euler.z=-math.atan2(direction.x,direction.y)
        t+=dash+gap


def make_range(o):
    r=root(o,COL['Annotations'])
    r['category']='range_guide'
    mat=RANGE_ORANGE if o.get('color')=='orange' else TEAL
    radius=o['diameter']/2
    for i in range(48):
        a=2*math.pi*i/48
        b=a+2*math.pi/48*.55
        start=(radius*math.cos(a),radius*math.sin(a),0)
        end=(radius*math.cos(b),radius*math.sin(b),0)
        rod('Plan range dashed ring',start,end,.0045,mat,r)
    text_obj('Range annotation','NOVA-5 / D 1.40 m' if o['follow']=='nova5' else 'ATOM / CHASSIS TURN',(0,-radius-.09,.002),.045,mat,r)


def make_zone(o):
    r=root(o,COL['Annotations'])
    w,d=o['width'],o['depth']
    if o['kind'] == 'placement_zone' and o.get('role') == 'cup_rest':
        cyl('Cup stamping rest', (0,0,.006), .0525, .012, STEEL,r)
        return r
    if o['kind'] == 'placement_zone':
        box('Placement rectangle', (0,0,.0015), (w,d,.003), TEAL,r,.001)
        text_obj('Placement label','DRINK' if o.get('role') == 'beverage_pickup' else 'PLACE BAG',(0,0,.004),min(.035,w/5),WHITE,r)
        return r
    for a,b in [((-w/2,-d/2,.008),(w/2,-d/2,.008)),((w/2,-d/2,.008),(w/2,d/2,.008)),((w/2,d/2,.008),(-w/2,d/2,.008)),((-w/2,d/2,.008),(-w/2,-d/2,.008))]:
        dashed_segment('Charging zone boundary',a,b,TEAL,r)
    text_obj('Charging area label','CHARGING ZONE',(0,0,.01),.067,TEAL,r)


def make_charger(o):
    r=root(o,COL['Equipment'])
    # Local -Y is the mating face. Overall envelope is centred on this root.
    # A 71 mm body offset centres the asymmetric projecting connector envelope.
    bw,bd,bh=.490,.400,.216
    body_y=.071
    body_bottom=.056
    top=body_bottom+bh
    shell=material('Charger enclosure enamel',(.67,.71,.72,1),.35,.34)
    label_mat=material('Charging control label plate',(.34,.39,.42,1),.35,.32)
    green=material('Start button green',(.025,.33,.12,1),.08,.32)
    red=material('Stop button red',(.52,.027,.02,1),.1,.32)
    contact=material('Charging connector contacts',(.68,.45,.12,1),.85,.22)
    box('490 x 400 x 216 mm main housing',(0,body_y,body_bottom+bh/2),(bw,bd,bh),shell,r,.012)
    box('Top lid seam',(0,body_y,top-.004),(bw-.008,bd-.008,.004),STEEL,r,.008)
    # Levelling feet determine the 545 mm crosswise envelope.
    for x in [-.235,.235]:
        for y in [body_y-.1775,body_y+.1775]:
            cyl('Round floor foot',(x,y,.004),.0375,.008,STEEL,r)
            cyl('Foot isolation pad',(x,y,.010),.025,.006,BLACK,r)
            bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=.023,radius2=.011,depth=.020)
            foot=finish(bpy.context.object,'Tapered levelling foot',r,STEEL)
            foot.location=(x,y,.024)
            cyl('Adjustable foot stem',(x,y,.044),.008,.023,STEEL,r)
            cyl('Foot locking nut',(x,y,.052),.013,.008,STEEL,r,vertices=6)
    # HMI and two pushbuttons on the top, matching the reference arrangement.
    box('Top control panel',(0,body_y-.02,top+.0007),(.36,.25,.0014),label_mat,r,.014)
    box('HMI bezel',(-.055,body_y-.02,top+.002),(.205,.172,.004),DARK,r,.004)
    box('HMI inner trim',(-.055,body_y-.02,top+.0045),(.188,.155,.003),STEEL,r,.002)
    box('HMI screen',(-.055,body_y-.02,top+.006),(.167,.134,.0015),SCREEN,r,.002)
    for y,mat,word in [(body_y+.065,green,'START'),(body_y-.035,red,'STOP')]:
        cyl(word+' button ring',(.145,y,top+.002),.016,.004,STEEL,r)
        cyl(word+' pushbutton',(.145,y,top+.006),.012,.004,mat,r)
        text_obj(word+' label',word,(.145,y+.027,top+.002),.011,WHITE,r)
    for x,mat,word in [(-.11,green,'POWER'),(-.03,green,'RUN'),(.05,red,'FAULT')]:
        cyl('Status lamp '+word,(x,body_y-.125,top+.0025),.0035,.003,mat,r,vertices=16)
        text_obj('Status label '+word,word,(x,body_y-.146,top+.002),.007,WHITE,r)
    # Side ventilation and recessed handle/display window.
    box('Side window bezel',(-bw/2-.001,body_y+.07,.218),(.003,.11,.054),DARK,r,.003)
    box('Side window insert',(-bw/2-.003,body_y+.07,.218),(.001,.095,.040),WHITE,r,.002)
    for row in range(6):
        for column in range(10):
            vent=cyl('Side vent perforation',(-bw/2-.0008,body_y-.13+column*.009,.112+row*.009),.0024,.0015,DARK,r,vertices=12)
            vent.rotation_euler.y=math.pi/2
    # The projecting mating assembly is 157 mm beyond the main housing front.
    front=body_y-bd/2
    port_h=.1475
    box('Charging connector mounting flange',(0,front-.007,port_h),(.146,.014,.096),STEEL,r,.006)
    box('Charging connector carriage',(0,front-.045,port_h),(.112,.062,.067),STEEL,r,.004)
    box('Charging connector extension',(0,-.236,port_h),(.081,.060,.043),STEEL,r,.003)
    box('Charging connector tip',(0,-.276,port_h),(.071,.020,.031),DARK,r,.002)
    for x in [-.020,0,.020]:
        pin=cyl('Mating contact',(x,-.2855,port_h),.005,.001,contact,r,vertices=20)
        pin.rotation_euler.x=math.pi/2
    for x in [-.057,.057]:
        for z in [port_h-.034,port_h+.034]:
            screw=cyl('Flange screw',(x,front-.0145,z),.0032,.001,BLACK,r,vertices=16)
            screw.rotation_euler.x=math.pi/2
    # Small auxiliary connectors visible on the side in the supplied drawing.
    for yy,zz in [(body_y+.09,.18),(body_y-.04,.12)]:
        plug=cyl('Side auxiliary connector',(bw/2+.006,yy,zz),.011,.012,DARK,r)
        plug.rotation_euler.y=math.pi/2
    text_obj('Dock top ID','CHARGING DOCK',(0,body_y+.17,top+.001),.016,DARK,r)
    r.scale=(o['width']/.545,o['depth']/.572,o['height']/.280)
    r['connector_front_local']='-Y'
    r['connector_direction_world']='-X / left in source plan'
    r['reference_overall_mm']='545 x 572 x 280'


def make_source_annotations():
    d=C['room']['depth']; w=C['room']['width']; crop=C['room'].get('cropped_front_depth',.75)
    pale=material('Unshown source strip',(.76,.75,.70,1),0,.85)
    box('Unshown front reference area',(w/2,crop/2,.001),(w,crop,.002),pale,None,0)
    dashed_segment('Crop limit',(0,crop,.007),(w,crop,.007),TEAL)
    text_obj('Crop reference note','SOURCE CROPPED / 0.75 m REFERENCE',(2.50,.30,.006),.052,TEAL)
    text_obj('Replenishment aisle label','0.60 m REPLENISHMENT AISLE',(2.86,d-1.80,.006),.065,TEAL,rotation=(0,0,math.pi/2))
    text_obj('Working area label','ROBOT WORKING AREA',(1.39,d-2.03,.006),.07,TEAL)
    for name in ['shelf_1','shelf_2']:
        o=ITEMS.get(name)
        if not o or not o.get('enabled',True) or not o.get('visible',True):
            continue
        text_obj(name+' floor label',o['label'].upper(),(o['x']-.335,o['y']-.37,.007),.065,TEAL,rotation=(0,0,math.pi/2))


RANGE_ORANGE=material('Nova-5 range guide',(.58,.20,.045,1),0,.7)

make_architecture()
make_source_annotations()
makers={'vent':make_ventilation_shaft,'table':make_table,'counter':make_table,'cart':make_table,'machine':make_machine,'dispenser':make_dispenser,'shelf':make_shelf,'box_station':make_box_station,'support':make_support,'robot':make_robot,'window':make_window,'customer_barrier':lambda o: make_customer_barrier(o,globals()),'human':make_human,'range':make_range,'zone':make_zone,'placement_zone':make_zone,'charger':make_charger}
for o in C['objects']:
    if o.get('enabled',True) and o.get('visible',True):
        if o.get('layout_component'):
            make_me6_station_component(o, globals())
        else:
            makers[o['kind']](o)
        REPORT['objects'].append(o)
bpy.context.view_layer.update()
for id,r in ROOTS.items():
    points=[]
    def bounds(ob):
        if ob.type=='MESH':
            points.extend(ob.matrix_world@Vector(v) for v in ob.bound_box)
        for child in ob.children:
            bounds(child)
    bounds(r)
    if points:
        low=[min(v[i] for v in points) for i in range(3)]
        high=[max(v[i] for v in points) for i in range(3)]
        r['world_bounds_m']=low+high
        REPORT.setdefault('bounds',{})[id]={'min':low,'max':high}

scene=bpy.context.scene
bpy.context.preferences.filepaths.save_version=0
scene.unit_settings.system='METRIC'
scene.unit_settings.length_unit='METERS'
scene.world.color=(.3,.3,.3)
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.72,.79,.84,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
light('Large softbox',(-1,-1.5,7),1450,5,(1.9,3.0,.6))
light('Rear fill',(3.6,6.5,5.8),1350,4,(1.9,3.0,.7))
light('Side fill',(5,2.5,4.2),950,4,(1.9,3.0,1))
CAMERAS={name:camera(v['name'],v['location'],v['target'],lens=v.get('lens',48),ortho=v.get('ortho')) for name,v in C['cameras'].items()}
scene.camera=CAMERAS['overview']
scene.render.engine=C['render'].get('engine','CYCLES')
if scene.render.engine=='CYCLES':
    scene.cycles.samples=16 if opt.preview else C['render']['samples']
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=8
    scene.cycles.transparent_max_bounces=8
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences
        prefs.compute_device_type='OPTIX'
        prefs.get_devices()
        has_gpu=False
        for device in prefs.devices:
            device.use=device.type=='OPTIX'
            has_gpu |= device.use
        if has_gpu:
            scene.cycles.device='GPU'
        print('CYCLES DEVICES',[(d.name,d.type,d.use) for d in prefs.devices],flush=True)
    except Exception as exc:
        print('Using CPU rendering:',exc,flush=True)
scene.render.resolution_x=1000 if opt.preview else C['render']['resolution_x']
scene.render.resolution_y=800 if opt.preview else C['render']['resolution_y']
scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.film_transparent=False
scene.view_settings.view_transform='AgX'
scene.render.image_settings.color_mode='RGBA'
scene['Scene parameters']=str(config_path)
scene['Generator']=str(Path(__file__).resolve())
scene['Limitations']='Concept geometry; illustrative joint poses. Not a collision/reach/motion validation.'
# Embed parameters and generator for a self-describing .blend file.
for filename in ['scene_config.json','build_scene.py']:
    text=bpy.data.texts.new(filename)
    text.write((config_path if filename=='scene_config.json' else Path(__file__)).read_text(encoding='utf-8-sig'))
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.shading.type='MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'coffee_bar.blend'))
print('BLEND SAVED',flush=True)
# Export geometry including hierarchy/extras. Lights/cameras remain in native .blend.
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type not in {'LIGHT','CAMERA'}:
        obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'coffee_bar.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_cameras=False,export_lights=False,export_yup=True)
(OUT/'scene_report.json').write_text(json.dumps(REPORT,indent=2)+'\n',encoding='utf-8')
(OUT/'built_config.json').write_text(json.dumps(C,indent=2)+'\n',encoding='utf-8')
print('GLB EXPORTED',flush=True)
if not opt.no_render:
    for name,cam in CAMERAS.items():
        scene.camera=cam
        if name=='top':
            scene.render.resolution_x=1500 if not opt.preview else 900
            scene.render.resolution_y=1500 if not opt.preview else 900
        else:
            scene.render.resolution_x=1000 if opt.preview else C['render']['resolution_x']
            scene.render.resolution_y=800 if opt.preview else C['render']['resolution_y']
        scene.render.filepath=str(OUT/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        print('RENDERED',name,flush=True)
    scene.camera=CAMERAS['overview']
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'coffee_bar.blend'))
print('SCENE COMPLETE',flush=True)
