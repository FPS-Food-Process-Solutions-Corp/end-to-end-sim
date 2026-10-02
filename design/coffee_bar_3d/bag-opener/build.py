"""Render and export the parameterized standalone bag opener using Blender."""
from pathlib import Path
import json
import sys
import bpy

HERE=Path(__file__).resolve().parent
SOURCE=HERE.parent/'build_scene.py'
sys.argv=[str(SOURCE)]
api={'__file__':str(SOURCE),'__name__':'__main__'}
exec(compile(SOURCE.read_text(encoding='utf-8').split('RANGE_ORANGE=material',1)[0],str(SOURCE),'exec'),api)
params=json.loads((HERE/'parameters.json').read_text(encoding='utf-8'))
params.update(x=0,y=0,z=0,yaw_deg=0,support=None)
root=api['make_bag_opener'](api,params)
root['reference_video']='injb7gEEdYA; opposed plates inferred, drive is a proposed implementation'
OUT=HERE/'output';OUT.mkdir(exist_ok=True)
scene=bpy.context.scene
scene.unit_settings.system='METRIC';scene.unit_settings.length_unit='METERS'
scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(.82,.86,.89,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=.45
floor=api['material']('Studio warm grey',(.66,.69,.68,1),0,.82)
api['box']('Studio floor',(0,0,-.010),(200,200,.015),floor,None,0)
api['light']('Left softbox',(-.6,-.5,1.4),90,1.0,(0,0,.14))
api['light']('Rear softbox',(.4,.8,1),65,.8,(0,0,.17))
api['light']('Front fill',(.8,-.6,.6),28,.6,(0,0,.15))
camera=api['camera']('Concept product view',(.59,-.78,.65),(0,0,.16),ortho=.59)
scene.camera=camera
scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
try:
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
    for device in prefs.devices: device.use=device.type=='OPTIX'
    if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
except Exception:pass
scene.render.resolution_x=1600;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
scene.view_settings.view_transform='AgX'
scene['Concept status']='Proposed vacuum opener for 150 x 90 x 280 mm bag. Not fabrication drawings.'
for filename in ['parameters.json','build.py']:
    block=bpy.data.texts.new(filename);block.write((HERE/filename).read_text(encoding='utf-8'))
block=bpy.data.texts.new('bag_opener.py');block.write((HERE.parent/'bag_opener.py').read_text(encoding='utf-8'))
bpy.context.view_layer.update()
parts=[root]+list(root.children_recursive)
bpy.ops.object.select_all(action='DESELECT')
for o in parts:o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'bag-opener.glb'),export_format='GLB',use_selection=True,export_apply=True,export_extras=True,export_yup=True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'bag-opener.blend'))
scene.render.filepath=str(OUT/'overview.png');bpy.ops.render.render(write_still=True)
# A second view omits only the illustrative bag to reveal the opposing cups.
bag=next(o for o in root.children if o.get('example_bag'))
for o in [bag]+list(bag.children_recursive):o.hide_render=True
camera.location=(.50,-.54,.76);direction=api['Vector']((0,0,.15))-camera.location;camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'mechanism.png');bpy.ops.render.render(write_still=True)
for o in [bag]+list(bag.children_recursive):o.hide_render=False
points=[o.matrix_world@api['Vector'](v) for o in parts if o.type=='MESH' for v in o.bound_box]
report=dict(dimensions_m={key:params[key] for key in ['width','depth','height']},bag_dimensions_m=[params['bag_parameters'][k] for k in ['bag_width','bag_depth','bag_height']],opening_stroke_m=params['bag_parameters']['bag_depth']-params['bag_parameters']['closed_gap'],vacuum_cups=sum(bool(o.get('vacuum_cup')) for o in parts),bounds_min=[min(v[i] for v in points) for i in range(3)],bounds_max=[max(v[i] for v in points) for i in range(3)])
(OUT/'model-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('BAG OPENER COMPLETE',json.dumps(report))
