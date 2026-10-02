"""Build the ME6 bag-station concept, animated Blender scene, GLBs and stills."""
from pathlib import Path
import json,sys,math
import bpy
from mathutils import Matrix,Vector,Euler
HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent/'build_scene.py'
sys.argv=[str(SOURCE)]
api={'__file__':str(SOURCE),'__name__':'__main__'}
exec(compile(SOURCE.read_text(encoding='utf-8').split('RANGE_ORANGE=material',1)[0],str(SOURCE),'exec'),api)
P=json.loads((HERE/'parameters.json').read_text())
M=json.loads((HERE/'motion.json').read_text())
OUT=HERE/'output';OUT.mkdir(exist_ok=True)
box,cyl,rod,text,empty,mat=(api[k] for k in ['box','cyl','rod','text_obj','empty','material'])
STEEL,DARK,WHITE,TEAL,BLACK=(api[k] for k in ['STEEL','DARK','WHITE','TEAL','BLACK'])
COL=api['COL'];z=P['table']['height'];bw=P['bag']['width'];bh=P['bag']['height'];bd=P['bag']['depth']
paper=mat('Warm kraft paper',(.57,.35,.16,1),0,.84)
paper_light=mat('Bag folded edges',(.68,.45,.23,1),0,.86)
blue=mat('Vacuum blue',(.012,.28,.55,1),.1,.32)
silicone=mat('Soft blue suction cups',(.02,.36,.57,1),0,.52)
orange=mat('Magazine amber identifier',(.80,.36,.055,1),.08,.45)
labelmat=mat('Dark graphite lettering',(.04,.095,.105,1),0,.7)
green=mat('Vacuum indicator',(.08,.53,.32,1),0,.35)
plate=mat('Anodized gripper plate',(.15,.22,.25,1),.65,.34)
table=api['make_table'](dict(id='proposed_counter',kind='table',label='Proposed expanded counter',x=0,y=0,z=0,width=P['table']['width'],depth=P['table']['depth'],height=z,top_thickness=.028))
table['proposal']='100 cm along rack gap; expansion is toward the robot working area'
root=empty('Bag station fixtures',COL['Equipment']);root.location.z=z
# Magazine: upright folded bags, bottom runners, adjustable guides, retaining lips.
m=P['magazine'];mx,my=m['x'],m['front_y'];floor=P['bag']['bottom']
mag=empty('01 Bag magazine',COL['Equipment'],root)
mag['role']='magazine'
box('Magazine bolted base',(mx,my+m['depth']/2-.018,.008),(m['width']+.035,m['depth']+.045,.016),STEEL,mag,.003)
for x in [mx-m['width']/2,mx+m['width']/2]:
    box('Magazine adjustable side guide',(x,my+m['depth']/2,.166),(.003,m['depth'],.30),STEEL,mag,.001)
    box('Magazine slotted foot',(x,my+m['depth']/2,.020),(.022,m['depth'],.007),plate,mag,.001)
    for y in [my+.02,my+m['depth']-.02]:
        cyl('Magazine adjustment screw',(x,y,.027),.006,.008,DARK,mag,vertices=6)
box('Magazine bottom runner',(mx,my+m['depth']/2,.020),(bw+.015,m['depth'],.006),TEAL,mag,.001)
for i in range(m['display_bags']):
    yy=my+.012+i*.007
    box('Stored flat bag %02d'%(i+1),(mx,yy,floor+bh/2),(bw,.002,bh),paper if i%2 else paper_light,mag,.0005)
    box('Stored bottom fold %02d'%(i+1),(mx,yy-.001,floor+.027),(bw,.003,.054),paper,mag,.0003)
last=my+.014+m['display_bags']*.007
box('Light spring follower',(mx,last,floor+bh/2),(bw+.008,.004,bh+.009),plate,mag,.002)
rod('Follower guide',(mx,last+.005,.17),(mx,my+m['depth'],.17),.006,STEEL,mag)
for x in [mx-bw/2-.006,mx+bw/2+.006]:
    for zz in [.075,.257]:
        box('Flexible singulation tab',(x,my-.003,zz),(.020,.006,.022),orange,mag,.003)
text('Magazine label','01  BAG MAGAZINE',(mx,my+m['depth']+.055,.003),.020,labelmat,root)
text('Bag size label','150 x 90 x 280 mm',(mx,my+m['depth']+.084,.003),.014,labelmat,root)
# Fixed suction: cups contact the rear bag face at the datum y.
s=P['station'];sx,sy=s['x'],s['rear_face_y'];cp=P['tool']['cup_projection'];cupd=P['tool']['cup_diameter'];contact=P['tool']['contact_height']
fixed=empty('02 Fixed opposing suction',COL['Equipment'],root);fixed['role']='fixed_suction'
plate_y=sy+cp+.002
box('Fixed station bolted base',(sx,sy-.045,.008),(s['base_width'],s['base_depth'],.016),STEEL,fixed,.003)
box('Fixed vacuum plate',(sx,plate_y,floor+.13),(.20,.004,.26),STEEL,fixed,.0015)
for x in [sx-.098,sx+.098]:
    box('Rear folded stiffener',(x,plate_y+.009,floor+.13),(.012,.022,.26),STEEL,fixed,.002)
    box('Fixed plate foot',(x,plate_y+.015,.024),(.026,.060,.018),plate,fixed,.002)
box('Bag bottom support',(sx,sy-bd/2,floor-.002),(bw+.016,bd+.020,.004),STEEL,fixed,.001)
for x in [sx-bw/2-.010,sx+bw/2+.010]:
    box('Low tray locating lip',(x,sy-bd/2,floor+.003),(.003,bd,.010),TEAL,fixed,.001)
for xx in [sx-s['base_width']/2+.018,sx+s['base_width']/2-.018]:
    for yy in [sy-.045-s['base_depth']/2+.018,sy-.045+s['base_depth']/2-.018]:
        cyl('Fixture M6 bolt',(xx,yy,.020),.0055,.008,DARK,fixed,vertices=6)

def cup(name,parent,pos,rotation=(0,0,0)):
    r=cupd/2
    profile=[(.003,0),(.003,.004),(r*.75,.007),(r*.47,.011),(r*.95,.017),(r,cp),(r*.83,cp),(r*.77,.018),(.0028,.009),(.0028,0)]
    verts=[];faces=[];n=36
    for rr,zz in profile:
        for i in range(n):
            a=i*2*math.pi/n;verts.append((rr*math.cos(a),rr*math.sin(a),zz))
    for j in range(len(profile)):
        for i in range(n):faces.append((j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    ob=bpy.data.objects.new(name,mesh);api['finish'](ob,name,parent,silicone)
    ob.location=pos;ob.rotation_euler=rotation;ob['vacuum_cup']=True
    for poly in mesh.polygons:poly.use_smooth=True
    return ob
for x in [-P['tool']['cup_spacing_x']/2,P['tool']['cup_spacing_x']/2]:
    for h in [-P['tool']['cup_spacing_z']/2,P['tool']['cup_spacing_z']/2]:
        cup('Fixed rear suction cup',fixed,(sx+x,sy+cp,contact+h),(math.pi/2,0,0))
        rod('Fixed vacuum branch',(sx+x,plate_y+.013,contact+h),(sx+x,plate_y+.013,.10),.002,blue,fixed)
rod('Fixed vacuum manifold',(sx-.05,plate_y+.013,.10),(sx+.05,plate_y+.013,.10),.003,blue,fixed)
box('Vacuum valve and pressure switch',(sx+.155,sy+.024,.043),(.055,.090,.070),DARK,fixed,.004)
cyl('Fixed vacuum status lamp',(sx+.155,sy+.024,.081),.006,.004,green,fixed)
text('Fixed station label','02  FIXED SUCTION',(sx,sy+.19,.003),.019,labelmat,root)
text('Tray label','BOTTOM SUPPORT',(sx,sy-bd-.059,.018),.013,TEAL,root)
# Import the real articulated ME6 hierarchy. Replace its reference single cup.
api['C']['robot_library']='D:/Work/FPS/Robotics/urdf/robots'
base=P['robot']['base']
spec=dict(id='me6_bag_robot',model_key='me6',kind='robot',label='Magician E6 / bag handling',package='magician_e6',urdf='me6_robot.urdf',x=base[0],y=base[1],z=z+base[2],yaw_deg=0,support=None,joints_deg={})
api['make_robot'](spec)
robot=api['ROOTS'][spec['id']]
links={n.get('urdf_link'):n for n in robot.children_recursive if n.get('urdf_link')}
for ob in list(robot.children_recursive):
    if ob.name.startswith('ME6 suction'):bpy.data.objects.remove(ob,do_unlink=True)
mount=links['Link6'];tool=empty('03 ME6 four-cup pickup head',COL['Robots'],mount)
tool['role']='robot_suction_head'
length=P['robot']['tool_length']
cyl('Lightweight tool flange',(0,0,.010),.025,.020,STEEL,tool)
cyl('Tool stand-off',(0,0,.030),.011,.040,STEEL,tool)
box('Lightweight four-cup mounting plate',(0,0,length-cp-.003),(.126,.108,.006),plate,tool,.004)
for xx in [-P['tool']['cup_spacing_x']/2,P['tool']['cup_spacing_x']/2]:
    for yy in [-P['tool']['cup_spacing_z']/2,P['tool']['cup_spacing_z']/2]:
        cup('Robot pickup suction cup',tool,(xx,yy,length-cp))
        rod('Tool vacuum branch',(xx,yy,length-cp-.008),(0,yy,length-cp-.008),.002,blue,tool)
tcp=empty('Tool contact centre',COL['Robots'],mount);tcp.location=(0,0,length);tcp['role']='tcp'
box('ME6 mounting plate',(base[0],base[1],z+.004),(.19,.15,.008),STEEL,None,.003)
text('ME6 label','03  MAGICIAN E6',(0,-P['table']['depth']/2+.026,z+.001),.021,labelmat)
# Illustrative bag shell, open top, full-depth reference. Animate the depth only.
bag=empty('Handled kraft bag',COL['Equipment']);bag['role']='moving_bag'
for name,yy in [('Front paper face',0),('Rear paper face',bd)]:
    box(name,(0,yy,bh/2),(bw,.0007,bh),paper,bag,.0001)
    box(name+' folded rim',(0,yy,bh-.003),(bw,.0015,.006),paper_light,bag,.0001)
for xx in [-bw/2,bw/2]:
    box('Paper gusset',(xx,bd/2,bh/2),(.0007,bd,bh),paper,bag,.0001)
    rod('Gusset fold crease',(xx*1.002,bd/2,.01),(xx*1.002,bd/2,bh-.01),.0004,paper_light,bag)
box('Paper bottom',(0,bd/2,.0006),(bw,bd,.0012),paper,bag,.0001)
text('Bag print','SAMPLE',(0,-.001,bh*.55),.022,labelmat,bag,(math.pi/2,0,0))
# Counter dimension guides on the tabletop.
for yy in [-.36,.36]:
    rod('Counter dimension tick',(-.50,yy,z+.003),(-.48,yy,z+.003),.0015,TEAL,None)
text('Counter dimension',f"{P['table']['width']*100:g} cm",(0,.342,z+.001),.024,TEAL)
# Export a neutral articulation for the interactive viewer.
bag.location=(sx,sy-bd,z+floor)
for j in M['joints']:
    lo=links[j['child']];lo['motion_joint']=j['name'];lo.rotation_mode='QUATERNION'
scene=bpy.context.scene;scene.unit_settings.system='METRIC';scene.unit_settings.length_unit='METERS'
scene.render.fps=P['motion']['fps'];scene.frame_start=1;scene.frame_end=len(M['frames'])
scene['concept']='ME6 picks upright bag, transfers to fixed suction, and opens mouth. Illustrative paper deformation.'
scene['motion_report']=json.dumps(M['report'])
bpy.context.view_layer.update()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'me6-station-rig.glb'),export_format='GLB',export_apply=True,export_extras=True,export_yup=True,export_animations=False)
# Real joint rotations, rather than translating a static robot mesh.
for index,f in enumerate(M['frames'],1):
    for j,q in zip(M['joints'],f['q']):
        lo=links[j['child']]
        origin=Matrix.Translation(Vector(j['xyz']))@Euler(j['rpy'],'XYZ').to_matrix().to_4x4()
        lo.matrix_basis=origin@Matrix.Rotation(q,4,Vector(j['axis']))
        lo.keyframe_insert('location',frame=index);lo.keyframe_insert('rotation_quaternion',frame=index)
    bag.location=(f['bag_position'][0],f['bag_position'][1],z+f['bag_position'][2])
    bag.scale=(1,f['bag_depth']/bd,1)
    bag.keyframe_insert('location',frame=index);bag.keyframe_insert('scale',frame=index)
# The sampled path uses linear interpolation between closely spaced IK solutions.
for ob in [bag]+list(links.values()):
    if ob.animation_data and ob.animation_data.action:
        try:
            for curve in ob.animation_data.action.fcurves:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
        except AttributeError:pass
scene.frame_set(scene.frame_end)
bpy.ops.export_scene.gltf(filepath=str(OUT/'me6-station.glb'),export_format='GLB',export_apply=True,export_extras=True,export_yup=True,export_animations=False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'me6-station-animated.glb'),export_format='GLB',export_apply=True,export_extras=True,export_yup=True,export_animations=True,export_animation_mode='SCENE',export_frame_range=True,export_force_sampling=True)

sys.path.insert(0,str(HERE))
from gltf_utils import prepare_animation
prepare_animation(OUT/'me6-station-animated.glb')
# Studio rendering. Lighting/floor are excluded from the exported engineering asset.
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.76,.83,.87,1);scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.5
ground=mat('Studio floor',(.78,.80,.77,1),0,.8)
box('Studio ground',(0,0,-.025),(200,200,.04),ground,None,0)
api['light']('Large key',(-1.5,-1.1,3),420,2.5,(0,0,1))
api['light']('Back rim',(1,1.3,2.6),280,1.7,(0,0,1.05))
api['light']('Soft fill',(1.5,-1,1.8),100,1.3,(0,0,1.05))
cam=api['camera']('Station overview',(1.10,-1.50,1.95),(0,.00,1.06),ortho=1.45)
scene.camera=cam;scene.render.engine='CYCLES';scene.cycles.samples=48;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices:device.use=device.type=='OPTIX'
    if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
except Exception:pass
scene.render.resolution_x=1600;scene.render.resolution_y=1300;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
for name in ['parameters.json','kinematics.py','build.py']:
    block=bpy.data.texts.new(name);block.write((HERE/name).read_text(encoding='utf-8'))
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'me6-bag-station.blend'))
scene.render.filepath=str(OUT/'overview.png');bpy.ops.render.render(write_still=True)
cam.location=(0,-.015,3.3);cam.rotation_euler=(Vector((0,-.015,1.02))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=1.16
scene.render.resolution_x=1500;scene.render.resolution_y=1200
scene.render.filepath=str(OUT/'overhead.png');bpy.ops.render.render(write_still=True)
print('ME6 STATION COMPLETE',json.dumps(M['report']),flush=True)

# Context proposal: the original rack gap is preserved; deeper counter projects forward.
for x,name in [(-1,'Shelf 1'),(1,'Shelf 2')]:
    api['make_shelf'](dict(id='context_'+name.replace(' ','_'),kind='shelf',label=name,x=x,y=P['table']['depth']/2-.175,z=0,yaw_deg=0,width=.95,depth=.35,height=1.8))
cam.location=(2.6,-4.1,3.1);cam.rotation_euler=(Vector((0,.07,.9))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=3.8
scene.render.resolution_x=1800;scene.render.resolution_y=1200
scene.render.filepath=str(OUT/'between-racks.png');bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'me6-between-racks.blend'))
print('CONTEXT RENDER COMPLETE',flush=True)
