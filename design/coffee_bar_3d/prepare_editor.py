"""Prepare shared scene metadata and correct the ice machine and Nova-5 cart."""
from pathlib import Path
import json
import shutil

base=Path(__file__).resolve().parent
p=base/'scene_config.json'
c=json.loads(p.read_text(encoding='utf-8-sig'))
figma=json.loads((base.parent/'coffee_bar_figma/plan_parameters.json').read_text(encoding='utf-8-sig'))
items={o['id']:o for o in c['objects']}
items['ice_machine'].update(width=.45,depth=.50,y=1.87,yaw_deg=0,front_side='short')
items['nova5_cart'].update(width=.60,depth=.80,x=1.715,y=2.355,yaw_deg=0)
items['nova5_cart']['label']='Nova-5 cart / 60 x 80 cm'
c['objects']=[o for o in c['objects'] if o['kind']!='range']
c['editor_version']=2
c['pixels_per_cm']=2
c['robot_inventory']=figma['robot_inventory']
c['reach_ratio']=70/85
c['groups']=[
    {'id':'area_left','label':'Left work counter'},
    {'id':'area_right','label':'Right work counter'},
    {'id':'area_upper','label':'Upper counter'},
    {'id':'area_shelf1','label':'Shelf 1 / Atom-W'},
    {'id':'area_middle','label':'Middle counter'},
    {'id':'area_shelf2','label':'Shelf 2 / Nova-5'},
    {'id':'area_coffee','label':'Coffee station'},
    {'id':'coffee_equipment','label':'Coffee equipment','parentId':'area_coffee'},
    {'id':'area_charge','label':'Charging area'},
    {'id':'area_people','label':'People'},
]
parents={'left_counter':'area_left','right_counter':'area_right','upper_counter':'area_upper','middle_counter':'area_middle','shelf_1':'area_shelf1','atom_w':'area_shelf1','shelf_2':'area_shelf2','nova5_cart':'area_shelf2','nova5':'area_shelf2','coffee_station':'area_coffee','human':'area_people','charger':'area_charge','charging_zone':'area_charge'}
targets={'nova5':['shelf_2'],'atom_w':['shelf_1','charger'],'nova2':['coffee_machine','ice_machine','tea_machine']}
for o in c['objects']:
    o['parentId']=parents.get(o['id'],'coffee_equipment')
    o.setdefault('visible',True)
    o.setdefault('locked',False)
    if o['kind']=='robot':
        o['model_key']=o['id']
        o['robot_scale']=1
        o['distanceTargets']=targets.get(o['id'],[])
    o['asset_key']=o['id']
c['assumptions']=[a for a in c['assumptions'] if not a.startswith(('Range guides','Nova-5 and Atom-W centres','Coffee equipment and Nova-2'))]
c['assumptions'] += [
    'Two reach guides follow the confirmed working-radius/tool formulas. They are projected plan envelopes, not a collision or kinematic solver.',
    'Nova-5 cart now matches the revised SVG: width 60 cm along X, length 80 cm along plan Y, 4 cm robot top-edge gap and 10 cm right-edge gap using the original 13 cm mounting symbol.',
    'Coffee equipment and Nova-2 share the 140 x 140 x 90 cm coffee table. Ice machine body is 45 cm across the front and 50 cm deep; its short face points toward Nova-2.',
]
p.write_text(json.dumps(c,indent=2)+'\n',encoding='utf-8')
for package in ['magician_e6','mg400']:
    src=Path(r'D:\Work\FPS\Robotics\urdf\robots')/package
    if src.exists():shutil.copytree(src,base/'assets/robots'/package,dirs_exist_ok=True)
legacy=base/'viewer-legacy.html'
if not legacy.exists():shutil.copy2(base/'viewer.html',legacy)
# Keep Figma's static source consistent with the short-front correction.
ice=next(o for o in figma['coffee_devices'] if o['id']=='ice_machine')
ice.update(width_cm=45,depth_cm=50,y_cm=388)
(base.parent/'coffee_bar_figma/plan_parameters.json').write_text(json.dumps(figma,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
# New cloned robot IDs retain their model identity when rebuilt in Blender.
p=base/'build_scene.py'
s=p.read_text(encoding='utf-8-sig')
start=s.index('def make_robot(o):')
end=s.index('\ndef make_architecture()',start)
body=s[start:end]
body=body.replace("    r=root(o,COL['Robots'])", "    r=root(o,COL['Robots'])\n    model_key=o.get('model_key',o['id'])")
body=body.replace("o['id']=='atom_w'", "model_key=='atom_w'").replace("o['id']=='me6'", "model_key=='me6'").replace("o['id'] in {'nova2','nova5'}", "model_key in {'nova2','nova5'}").replace("o['id'] in {'nova2','me6'}", "model_key in {'nova2','me6'}").replace("C['tools'][o['id']]", "C['tools'][model_key]")
s=s[:start]+body+s[end:]
s=s.replace("if o.get('enabled',True):", "if o.get('enabled',True) and o.get('visible',True):")
p.write_text(s,encoding='utf-8')
print('Prepared 21 shared objects, corrected short ice-machine front, and matched the SVG cart.')
