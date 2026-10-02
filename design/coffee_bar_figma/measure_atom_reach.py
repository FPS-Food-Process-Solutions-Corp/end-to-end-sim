"""Reproduce the Atom-W planning circles from URDF offsets and palm mesh."""
import json
import math
import struct
import xml.etree.ElementTree as ET
from pathlib import Path

base=Path(__file__).resolve().parent
urdf=base.parent/'coffee_bar_3d/assets/robots/atom_w/atom_w_p3.urdf'
robot=ET.parse(urdf).getroot()
joints={j.get('name'):j for j in robot.findall('joint')}
xyz=lambda name: [float(v) for v in joints[name].find('origin').get('xyz').split()]
shoulder=[a+b for a,b in zip(xyz('left_shoulder_pitch_joint'),xyz('left_shoulder_roll_joint'))]
torso_radius=math.hypot(*shoulder[:2])
names=['left_shoulder_yaw_joint','left_elbow_pitch_joint','left_elbow_roll_joint','left_wirst_pitch_joint','left_wirst_yaw_joint','left_rohand_base_joint']
segments={name:math.sqrt(sum(v*v for v in xyz(name))) for name in names}
arm=sum(segments.values())
mesh=urdf.parent/'meshes/left_hand/base_link.STL'
blob=mesh.read_bytes()
count=struct.unpack_from('<I',blob,80)[0]
assert len(blob)==84+50*count
points=[struct.unpack_from('<3f',blob,84+50*i+12+12*v) for i in range(count) for v in range(3)]
lo=[min(p[a] for p in points) for a in range(3)]
hi=[max(p[a] for p in points) for a in range(3)]
mid=[(a+b)/2 for a,b in zip(lo,hi)]
palm=math.sqrt(sum(v*v for v in mid))
working=arm+torso_radius
result={
    'source_urdf':str(urdf), 'palm_mesh':str(mesh),
    'arm_segment_lengths_cm':{k:v*100 for k,v in segments.items()},
    'arm_endpoint':'hand_base mounting frame; fixed wrist-to-hand adapter belongs to arm',
    'arm_length_without_hand_cm':arm*100,
    'shoulder_sweep_radius_about_torso_yaw_cm':torso_radius*100,
    'palm_mesh_bounds_m':{'min':lo,'max':hi},
    'palm_midpoint_hand_frame_m':mid,
    'hand_length_to_palm_midpoint_cm':palm*100,
    'working_radius_cm':working*100,
    'maximum_effective_diameter_cm':2*(working+palm)*100,
    'realistic_placement_diameter_cm':2*working*100*70/85,
    'method':'Sum arm segment lengths to the hand mounting frame plus shoulder sweep radius. Use palm-base mesh bounding-box midpoint, excluding separate finger meshes. Placement excludes hand length.',
    'limitation':'Circular planning envelope for an upright torso, not a certified joint-limit or collision-free workspace.',
}
(base/'atom-w-reach-measurements.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['working_radius_cm','maximum_effective_diameter_cm','realistic_placement_diameter_cm']}))
