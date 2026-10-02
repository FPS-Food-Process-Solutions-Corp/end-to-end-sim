"""Create a separate editable scene from the new architectural/Figma plan."""
from pathlib import Path
import copy
import json
import shutil

HERE=Path(__file__).resolve().parent
OLD=HERE.parent/'bakery_cell'
PLAN=HERE.parent/'coffee_bar_figma'
P=json.loads((PLAN/'plan_parameters.json').read_text())
previous=json.loads((OLD/'scene_config.json').read_text())
old_items={o['id']:o for o in previous['objects']}
depth=P['overall_depth_annotation_cm']/100
objects=[]


def add(id,kind,label,x,y,width,depth_,height=None,**kwargs):
    o=dict(id=id,kind=kind,label=label,x=x,y=y,width=width,depth=depth_,yaw_deg=0)
    if height is not None:o['height']=height
    o.update(kwargs)
    objects.append(o)
    return o


add('left_counter','table','Left work counter / 60 x 360 cm',.30,depth-1.80,.60,3.60,.90,top_thickness=.035)
add('right_counter','table','Right counter / 60 cm wide',3.45,depth-2.50,.60,5.00,.90,top_thickness=.035)
add('upper_counter','table','Upper shelf-strip counter',2.375,depth-.30,.35,.60,.90,top_thickness=.025)
add('middle_counter','table','Middle shelf-strip counter',2.375,depth-2.10,.35,1.00,.90,top_thickness=.025)
add('coffee_station','counter','Coffee and pickup station',.70,depth-4.30,1.40,1.40,.90,top_thickness=.04,sign_text='COFFEE / PICKUP')
for id,yy in [('shelf_1',1.10),('shelf_2',3.10)]:
    add(id,'shelf',id.replace('_',' ').title(),2.375,depth-yy,.95,.35,1.80,yaw_deg=-90,bay_length=1.00)
add('nova5_cart','cart','Nova-5 cart / 80 cm high',1.70,depth-3.10,.80,.60,.80,yaw_deg=90,top_thickness=.035)
for id in ['nova5','atom_w']:
    o=copy.deepcopy(old_items[id])
    o.pop('source_cell',None)
    x,y=P['robots'][id]['center_cm']
    o.update(x=x/100,y=depth-y/100)
    if id=='nova5':o.update(yaw_deg=180,support='nova5_cart')
    else:o.update(yaw_deg=0,width=.70,depth=.51,support=None)
    objects.append(o)

# Existing appliance sizes, placed provisionally on the new long left counter.
positions={'ice_machine':(.285,5.26),'tea_machine':(.285,4.65),'coffee_machine':(.285,4.10),'milk_fridge':(.285,3.63),'lid_machine':(.285,3.23)}
for id,(x,y) in positions.items():
    o=copy.deepcopy(old_items[id]);o.pop('source_cell',None)
    o.update(x=x,y=y,yaw_deg=90,support='left_counter',provisional=True)
    objects.append(o)
for id,x,y in [('cup_dispenser',.44,2.77),('lid_dispenser',.44,2.49)]:
    o=copy.deepcopy(old_items[id]);o.pop('source_cell',None)
    o.update(x=x,y=y,support='left_counter',provisional=True)
    objects.append(o)

add('charging_zone','zone','Charging zone / inferred outline',2.575,depth-4.30,1.15,1.40,.005,color='teal')
add('charger','charger','Charging dock / provisional',3.01,depth-4.30,.38,.22,.32,yaw_deg=-90)
add('nova5_range','range','Nova-5 plan range / diameter 140 cm',1.85,depth-3.10,1.40,1.40,.004,z=.008,follow='nova5',diameter=1.40,color='orange')
add('atom_turn','range','Atom-W chassis turning envelope',1.65,depth-1.10,.8660831369,.8660831369,.004,z=.008,follow='atom_w',diameter=.8660831369,color='teal')
add('human','human','Person / 1.70 m',.70,.41,.48,.30,1.70,z=0)

C={
    'schema_version':1,
    'title':'Coffee bar / new floor plan',
    'units':'metres; angles in degrees',
    'coordinate_system':'Origin: front-left floor corner; X right, Y towards the rear, Z up. Source-plan y is measured downward from the top; world y = 5.75 - source_y_cm / 100.',
    'source_plan':'source-plan.png',
    'robot_library':'assets/robots',
    'room':dict(width=3.75,depth=depth,wall_height=2.35,wall_thickness=.08,show_rear_wall=False,cropped_front_depth=.75),
    'shelves':copy.deepcopy(previous['shelves']),
    'tools':copy.deepcopy(previous['tools']),
    'render':dict(resolution_x=1800,resolution_y=1600,samples=48,engine='CYCLES'),
    'cameras':{
        'overview':dict(name='Overview',location=[-4.9,-6.2,7.1],target=[1.875,3.0,.65],ortho=7.8),
        'customer':dict(name='Customer view',location=[1.95,-4.6,3.0],target=[1.875,3.15,.90],lens=34),
        'top':dict(name='Top / source plan',location=[1.875,2.875,10],target=[1.875,2.875,0],ortho=6.3),
        'rear':dict(name='Rear working view',location=[-4.2,8.9,6.2],target=[1.875,3.0,.65],ortho=7.6)
    },
    'assumptions':[
        'This scene follows the NEW supplied architectural screenshot and its Figma reconstruction, not the earlier 3.8 x 3.5 m draw.io layout.',
        'Width: 3.15 m main area plus separate 0.60 m right counter = 3.75 m. Visible depth: 3.60 + 1.40 = 5.00 m.',
        'The source says 5.75 m overall depth but crops the remaining 0.75 m. A pale front reference strip accommodates that discrepancy; its location/content is not confirmed. The human stands there for scale.',
        'Source counter annotations specify 0.90 m high. Nova-5 retains the previously specified 0.80 m high cart.',
        'The shelf strip uses approximate 0.60 / 1.00 / 1.00 / 1.00 m bays. Physical shelves retain 0.95 x 0.35 m size, centred in the two 1.00 m bays.',
        'Shelves: four provisional tiers, front heights 0.35/0.75/1.15/1.55 m, 0.40 m pitch, 0.10 m rear-to-front drop, six columns and five dividers. Continuous stainless sheet bases.',
        'The actual Nova-5 Lebai tongs and Atom-W URDF meshes are used. Atom-W is labelled at the requested nominal 70 x 51 cm; the unscaled CAD chassis is approximately 71 x 51.4 cm.',
        'Nova-5 and Atom-W centres exactly match the Figma plan. The cart is an added support inherited from the prior requirements; its placement is provisional.',
        'Previously named coffee equipment is placed provisionally on the left counter, facing the robot aisle; all machine heights are 0.58 m. Cup/lid dispensers are 0.70 m high, 0.10 m diameter.',
        'The new drawing locates only Nova-5 and Atom-W. It gives no Nova-2/ME6/MG400 or plastic-window positions, so those objects are not transferred from the older layout.',
        'Charging zone follows the inferred plan outline; the small charging dock is a placeholder.',
        'Range guides are optional plan-view references. Nova-5 diameter is the requested 1.40 m; Atom-W ring is chassis turning only, not arm reach.',
        'Person is a 1.70 m neutral scale mannequin. Arm poses are illustrative; no mesh-collision or task-motion validation is claimed.'
    ],
    'objects':objects,
}
HERE.mkdir(parents=True,exist_ok=True)
(HERE/'scene_config.json').write_text(json.dumps(C,indent=2)+'\n',encoding='utf-8')
for filename in ['build_scene.py','viewer.html','serve_viewer.py','build.ps1','open_blender.ps1','open_viewer.ps1']:
    shutil.copy2(OLD/filename,HERE/filename)
shutil.copytree(OLD/'vendor',HERE/'vendor',dirs_exist_ok=True)
for name in ['nova5','atom_w']:
    shutil.copytree(OLD/'assets'/'robots'/name,HERE/'assets'/'robots'/name,dirs_exist_ok=True)
shutil.copy2(PLAN/'source-plan.png',HERE/'source-plan.png')
shutil.copy2(PLAN/'coffee-bar-figma.svg',HERE/'source-plan.svg')
shutil.copy2(PLAN/'plan_parameters.json',HERE/'source-plan-parameters.json')

s=(HERE/'build_scene.py').read_text()
s=s.replace("OUT/'bakery_cell.blend'","OUT/'coffee_bar.blend'").replace("OUT/'bakery_cell.glb'","OUT/'coffee_bar.glb'")
s=s.replace("path=HERE/C['robot_library']", "path=HERE/C['robot_library']")
s=s.replace("'Order pickup sign', 'ORDER / PICKUP'", "'Order pickup sign', o.get('sign_text','ORDER / PICKUP')")
s=s.replace("-d*.20", "(-d/2+.16)").replace("-d*.16", "(-d/2+.18)")
s=s.replace("for y in [-d/2+.045, d/2-.045]:", "for y in [-d/2+.045+j*(d-.09)/max(1,math.ceil(d/1.2)) for j in range(max(1,math.ceil(d/1.2))+1)]:")
s=s.replace("r.location = (o['x'], o['y'], z)", "pos=ITEMS.get(o.get('follow'),o)\n    r.location = (pos['x'], pos['y'], z)")
start=s.index('CAMERAS={')
end=s.index("scene.camera=CAMERAS['overview']",start)
s=s[:start]+"CAMERAS={name:camera(v['name'],v['location'],v['target'],lens=v.get('lens',48),ortho=v.get('ortho')) for name,v in C['cameras'].items()}\n"+s[end:]
s=s.replace("light('Large softbox',(0,-1.5,6),1200,5,(1.9,1.8,.6))", "light('Large softbox',(-1,-1.5,7),1450,5,(1.9,3.0,.6))")
s=s.replace("light('Rear fill',(3.6,4.0,4.8),1050,3,(1.9,1.8,.7))", "light('Rear fill',(3.6,6.5,5.8),1350,4,(1.9,3.0,.7))")
s=s.replace("light('Side fill',(-2,2.2,3.2),700,3,(1.9,1.8,1))", "light('Side fill',(5,2.5,4.2),950,4,(1.9,3.0,1))")
s=s.replace("make_architecture()\nmakers=", "make_architecture()\nmake_source_annotations()\nmakers=")
s=s.replace("'human':make_human}","'human':make_human,'range':make_range,'zone':make_zone,'charger':make_charger}")
extras='''
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
    for a,b in [((-w/2,-d/2,.008),(w/2,-d/2,.008)),((w/2,-d/2,.008),(w/2,d/2,.008)),((w/2,d/2,.008),(-w/2,d/2,.008)),((-w/2,d/2,.008),(-w/2,-d/2,.008))]:
        dashed_segment('Charging zone boundary',a,b,TEAL,r)
    text_obj('Charging area label','CHARGING ZONE',(0,0,.01),.067,TEAL,r)


def make_charger(o):
    r=root(o,COL['Equipment'])
    w,d,h=o['width'],o['depth'],o['height']
    box('Charging dock housing',(0,0,h/2),(w,d,h),DARK,r,.018)
    box('Charging dock face',(0,-d/2-.005,h*.50),(w*.84,.015,h*.70),WHITE,r,.007)
    for x in [-w*.18,w*.18]:
        box('Charging contact',(x,-d/2-.018,h*.32),(.043,.008,.035),STEEL,r,.003)
    box('Dock indicator',(0,-d/2-.02,h*.78),(.06,.006,.012),SCREEN,r,.003)


def make_source_annotations():
    d=C['room']['depth']
    pale=material('Unshown source strip',(.76,.75,.70,1),0,.85)
    box('Unshown front reference area',(1.875,.375,.001),(3.75,.75,.002),pale,None,0)
    dashed_segment('Crop limit',(0,.75,.007),(3.75,.75,.007),TEAL)
    text_obj('Crop reference note','SOURCE CROPPED / 0.75 m REFERENCE',(2.50,.30,.006),.052,TEAL)
    text_obj('Replenishment aisle label','0.60 m REPLENISHMENT AISLE',(2.86,d-1.80,.006),.065,TEAL,rotation=(0,0,math.pi/2))
    text_obj('Working area label','ROBOT WORKING AREA',(1.39,d-2.03,.006),.07,TEAL)
    for name in ['shelf_1','shelf_2']:
        o=ITEMS[name]
        text_obj(name+' floor label',o['label'].upper(),(2.04,o['y']-.37,.007),.065,TEAL,rotation=(0,0,math.pi/2))


RANGE_ORANGE=material('Nova-5 range guide',(.58,.20,.045,1),0,.7)

'''
anchor='make_architecture()\nmake_source_annotations()'
s=s.replace(anchor,extras+anchor)
(HERE/'build_scene.py').write_text(s,encoding='utf-8')

s=(HERE/'serve_viewer.py').read_text().replace('8765','8766').replace('Bakery cell viewer','Coffee bar viewer')
(HERE/'serve_viewer.py').write_text(s)
for name in ['open_viewer.ps1','open_blender.ps1']:
    s=(HERE/name).read_text().replace('8765','8766').replace('bakery_cell.blend','coffee_bar.blend')
    (HERE/name).write_text(s)

s=(HERE/'viewer.html').read_text(encoding='utf-8')
s=s.replace('Bakery cell','Coffee bar').replace('bakery_cell.glb','coffee_bar.glb')
s=s.replace('Layout viewer · metres','New floor plan · metres')
oldnote="The plan contains Atom-W, Nova-2, ME6 and Nova-5; MG400 is absent. Atom-W's URDF chassis is 0.710 × 0.514 m (+X forward) and remains unscaled, though its plan symbol is 0.5 × 0.5 m. Robot poses and simplified tooling are illustrative; motion and collision safety have not been validated."
newnote='New floor plan: Nova-5 at shelf 2 and Atom-W at shelf 1. Person: 1.70 m. Coffee equipment and the charging dock have provisional placements. The pale 0.75 m front strip accounts for cropped source dimensions. Robot poses and floor range guides are illustrative.'
assert oldnote in s
s=s.replace(oldnote,newnote)
s=s.replace('Front windows','Range guides').replace('id="windowsToggle"','id="rangesToggle"')
s=s.replace("$('windowsToggle')","$('rangesToggle')")
s=s.replace("object.kind === 'window' ? windowsVisible", "object.kind === 'range' ? windowsVisible")
s=s.replace('            <label class="toggle"><input id="robotsToggle" type="checkbox" checked> Robots</label>', '            <label class="toggle"><input id="robotsToggle" type="checkbox" checked> Robots</label>\n            <label class="toggle"><input id="equipmentToggle" type="checkbox" checked> Provisional coffee equipment</label>')
s=s.replace("const robotsVisible = $('robotsToggle').checked;", "const robotsVisible = $('robotsToggle').checked;\n      const equipmentVisible = $('equipmentToggle').checked;")
s=s.replace("object.kind === 'robot' ? robotsVisible :", "object.kind === 'robot' ? robotsVisible : object.provisional ? equipmentVisible :")
s=s.replace("    $('robotsToggle').addEventListener('change', applyConfigToScene);", "    $('robotsToggle').addEventListener('change', applyConfigToScene);\n    $('equipmentToggle').addEventListener('change', applyConfigToScene);")
s=s.replace("for (const object of currentConfig.objects) {\n        const root = roots.get(object.id);", "for (const object of currentConfig.objects) {\n        if (object.follow) { const followed=objectById(object.follow); if(followed) { object.x=followed.x; object.y=followed.y; } }\n        const root = roots.get(object.id);")
s=s.replace("rootForNode(node) {", "rootForNode(node) {")
s=s.replace("camera.position.set(width / 2 + 0.15, 2.75, depth * 0.82)", "camera.position.set(-4.0, 6.8, 5.3)")
s=s.replace("camera.position.set(width / 2 + 0.2, Math.max(width, depth) * 1.25, depth * 1.35)", "camera.position.set(-4.0, 6.8, 5.3)")
s=s.replace('>Customer</button>','>Overview</button>')
(HERE/'viewer.html').write_text(s,encoding='utf-8')
print('New coffee-bar scene prepared:',len(objects),'editable objects')
