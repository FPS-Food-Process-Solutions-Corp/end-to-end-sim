"""Inspect generated geometry bounds and parameter fidelity in Blender."""
import json
from pathlib import Path
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
C = json.loads((HERE/'scene_config.json').read_text())
checks=[]
for o in C['objects']:
    r=bpy.data.objects['layout__'+o['id']]
    assert abs(r.location.x-o['x'])<1e-5 and abs(r.location.y-o['y'])<1e-5,o['id']
    checks.append(o['id'])
for r in [bpy.data.objects['layout__nova5']]:
    def rec(ob):
        if ob.type=='MESH':
            points=[ob.matrix_world@Vector(p) for p in ob.bound_box]
            if min(p.x for p in points)<1.5:
                print('OUTLIER',ob.name,'parent',ob.parent.name,'matrix',list(ob.matrix_world.translation),'min',[min(p[i] for p in points) for i in range(3)],flush=True)
        for ch in ob.children:
            rec(ch)
    rec(r)
print('Checked source centre positions:',len(checks),flush=True)
