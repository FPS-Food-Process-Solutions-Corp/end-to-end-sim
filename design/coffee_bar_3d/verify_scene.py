"""Check physical dimensions and actual exported connector orientation."""
import json
import struct
from pathlib import Path
import numpy as np

base = Path(__file__).resolve().parent
report = json.loads((base / 'output/scene_report.json').read_text())
bounds = report['bounds']
size = lambda name: np.array(bounds[name]['max']) - np.array(bounds[name]['min'])
assert np.allclose(size('charger'), [.572, .545, .280], atol=1e-6)
assert abs(size('human')[2] - 1.7) < 1e-6
assert abs(bounds['charger']['max'][0] - 3.13) < 1e-6
blob = (base / 'output/coffee_bar.glb').read_bytes()
length = struct.unpack_from('<I', blob, 12)[0]
gltf = json.loads(blob[20:20+length])
world = {}

def visit(index, parent):
    node = gltf['nodes'][index]
    if 'matrix' in node:
        local = np.array(node['matrix']).reshape(4, 4).T
    else:
        x,y,z,w = node.get('rotation', [0,0,0,1])
        local = np.eye(4)
        local[:3,:3] = np.array([
            [1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
            [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
            [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]
        ]) @ np.diag(node.get('scale', [1,1,1]))
        local[:3,3] = node.get('translation', [0,0,0])
    matrix = parent @ local
    world[node.get('name', str(index))] = matrix
    for child in node.get('children', []):
        visit(child, matrix)

for index in gltf['scenes'][gltf.get('scene', 0)]['nodes']:
    visit(index, np.eye(4))
tip = world['Charging connector tip'][:3,3]
body = world['490 x 400 x 216 mm main housing'][:3,3]
assert tip[0] < body[0] - .3, (tip, body)
assert abs(tip[1] - .1475) < 1e-6
assert abs(tip[2] - body[2]) < 1e-6
result = {
    'passed': True,
    'charger_world_envelope_m': size('charger').tolist(),
    'human_height_m': float(size('human')[2]),
    'connector_center_gltf_m': tip.tolist(),
    'connector_direction': '-X / LEFT in source plan',
    'right_counter_clearance_m': 3.15 - bounds['charger']['max'][0],
}
(base / 'output/geometry-verification.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
