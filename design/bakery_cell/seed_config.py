"""Create the initial editable parameters from the revised draw.io plan (metres)."""
import json
import math
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = Path(r'C:\Users\andyl\.codex\attachments\abd40dac-0f4a-4f6d-98c2-1581a2d96e4c\Pasted text.txt')
cells = {c.get('id'): c for c in ET.parse(SOURCE).iter('mxCell')}


def footprint(cell_id):
    cell = cells[str(cell_id)]
    g = cell.find('mxGeometry')
    x, y, w, d = (float(g.get(k, '0')) for k in ('x', 'y', 'width', 'height'))
    style = dict(s.split('=', 1) for s in cell.get('style', '').split(';') if '=' in s)
    angle = math.radians(float(style.get('rotation', '0')))
    width = abs(w * math.cos(angle)) + abs(d * math.sin(angle))
    depth = abs(w * math.sin(angle)) + abs(d * math.cos(angle))
    return dict(x=round((x + w / 2 - 2320) / 200, 6), y=round((3200.44 - y - d / 2) / 200, 6), width=round(width / 200, 6), depth=round(depth / 200, 6))


def item(id, kind, label, cell_id, **kw):
    return dict(id=id, kind=kind, label=label, source_cell=str(cell_id), **footprint(cell_id), yaw_deg=0, **kw)


objects = [
    item('coffee_table', 'table', 'Coffee worktable', 11, height=.8, top_thickness=.035),
    item('order_counter', 'counter', 'Order + pickup', 26, height=.9, top_thickness=.04),
    item('nova5_cart', 'cart', 'Nova-5 cart', 27, height=.8, top_thickness=.035),
]
for cell_id, id, label, style in [(14,'coffee_machine','Coffee machine','coffee'), (15,'milk_fridge','Milk fridge','fridge'), (16,'lid_machine','Lid press','lid_press'), (35,'ice_machine','Ice machine','ice'), (36,'tea_machine','Tea machine','tea')]:
    o = item(id, 'machine', label, cell_id, height=.58, support='coffee_table', style=style)
    o['width'], o['depth'] = o['depth'], o['width']
    o['yaw_deg'] = 90
    objects.append(o)
for cell_id,id,label in [(17,'cup_dispenser','Cup dispenser'),(37,'lid_dispenser','Lid dispenser')]:
    o=item(id,'dispenser',label,cell_id,height=.7,support='coffee_table')
    o['diameter']=o['width']
    objects.append(o)
for cell_id,id in [(29,'shelf_1'),(33,'shelf_2'),(4,'shelf_3'),(34,'shelf_4')]:
    o=item(id,'shelf',id.replace('_',' ').title(),cell_id,height=1.8)
    if cell_id==29:
        o['width'],o['depth']=o['depth'],o['width']
        o['yaw_deg']=-90
    objects.append(o)
objects.append(item('box_station','box_station','Box station',43,height=.8))
objects.append(item('me6_support','support','ME6 mounting bracket',42,height=.8))
for cell_id,id,label,package,urdf,support in [(18,'nova2','Nova-2 + cup prong','nova2','nova2_robot.urdf','coffee_table'),(28,'nova5','Nova-5 + Lebai tongs','nova5','nova5_lebai_tongs.urdf','nova5_cart'),(42,'me6','Magician E6 + suction','magician_e6','me6_robot.urdf','me6_support'),(5,'atom_w','Atom-W','atom_w','atom_w_p3.urdf',None)]:
    o=item(id,'robot',label,cell_id,package=package,urdf=urdf,support=support,z=0,joints_deg={})
    o['yaw_deg']={'nova2':0,'nova5':0,'me6':0,'atom_w':-90}[id]
    if id in ('nova2', 'me6'):
        o['joints_deg'] = dict(zip([f'joint{i}' for i in range(1,7)], [0,40,-69,0,29,0]))
    elif id == 'nova5':
        o['joints_deg'] = dict(zip([f'joint{i}' for i in range(1,7)], [8.84,-20.15,88.62,21.53,-90,0]))
        o['joints_deg']['gripper_r_joint1'] = 31.5
    elif id == 'atom_w':
        o['joints_deg'] = {f'{side}_{joint}_joint': value for side in ['left','right'] for joint,value in [('shoulder_pitch',-45.8),('shoulder_roll',5.7 if side=='left' else -5.7),('elbow_pitch',85.9)]}
    objects.append(o)
for cell_id,id in [(30,'front_window_left'),(31,'front_window_right')]:
    objects.append(item(id,'window','Clear polycarbonate front panel',cell_id,bottom=.8,height=.9,thickness=.006))
objects.append(dict(id='human',kind='human',label='Person / 1.70 m',x=1.895,y=.94,z=0,width=.48,depth=.30,height=1.7,yaw_deg=0))

config = dict(
    schema_version=1,
    units='metres; angles in degrees',
    coordinate_system='Origin: front-left corner of room, on floor. X right, Y towards back wall, Z up. Object x/y are centres. Local front is -Y except URDF robots, whose axes are retained.',
    source_plan='source_layout.drawio',
    robot_library='assets/robots',
    room=dict(width=3.8,depth=3.5,wall_height=2.35,wall_thickness=.08,show_rear_wall=False),
    shelves=dict(tiers=4,tier_spacing=.4,first_tier_front_height=.35,back_to_front_drop=.10,columns=6,post_width=.025,sheet_thickness=.002,divider_height=.06,front_lip_height=.025,show_buns=True),
    tools=dict(nova2=dict(type='static_two_finger_cup_prong',length=.12,finger_spacing=.072,finger_width=.012),me6=dict(type='suction',length=.09,cup_diameter=.03)),
    render=dict(resolution_x=1800,resolution_y=1400,samples=48,engine='CYCLES'),
    assumptions=[
        'Four shelf tiers, front edges at 0.35/0.75/1.15/1.55 m; tier count and lowest height were not specified.',
        'Every tier drops 0.10 m from back to front across its horizontal depth; 0.40 m vertical pitch.',
        'Front plastic panels start at 0.80 m and finish at 1.70 m. Their centres/lengths follow the blue plan rectangles; plastic thickness is provisionally 6 mm.',
        'ME6 has a provisional cantilever bracket at 0.80 m; the box station has its own provisional support.',
        'Machines are stylized dimensional envelopes, all 0.58 m high. Cup/lid dispensers are 0.70 m cylinders with the plan diameter.',
        'Nova-2 cup prong and ME6 suction tool are provisional geometry; Nova-5 uses the actual Lebai tongs URDF.',
        'Robot joint poses are illustrative, not collision-checked or executable motion plans.',
        'MG400 has no position in the latest drawing and is not added to the scene.',
    ],
    objects=objects,
)
HERE.mkdir(exist_ok=True,parents=True)
if not (HERE/'scene_config.json').exists():
    (HERE/'scene_config.json').write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')
shutil.copy2(SOURCE,HERE/'source_layout.drawio')
assets=HERE/'assets'/'robots'
for name in ('nova2','nova5','magician_e6','atom_w'):
    shutil.copytree(Path(r'D:\Work\FPS\Robotics\urdf\robots')/name,assets/name,dirs_exist_ok=True)
print('Config, source plan, and self-contained robot assets ready:', HERE)
