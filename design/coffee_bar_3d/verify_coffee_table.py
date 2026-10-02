"""Verify the updated placement using generated geometry bounds."""
import itertools
import json
import math
from pathlib import Path

base = Path(__file__).resolve().parent
report = json.loads((base / 'output/scene_report.json').read_text())
config = json.loads((base / 'output/built_config.json').read_text())
objects = {o['id']: o for o in config['objects']}
bounds = report['bounds']
ids = ['coffee_machine', 'milk_fridge', 'tea_machine', 'lid_machine', 'ice_machine', 'cup_dispenser', 'lid_dispenser', 'nova2']
table = objects['coffee_station']
limits = [(table['x'] - table['width']/2, table['x'] + table['width']/2), (table['y'] - table['depth']/2, table['y'] + table['depth']/2)]
for name in ids:
    assert objects[name]['support'] == 'coffee_station', name
    for axis, (low, high) in enumerate(limits):
        assert bounds[name]['min'][axis] >= low - 1e-4, (name, bounds[name])
        assert bounds[name]['max'][axis] <= high + 1e-4, (name, bounds[name])
    assert abs(bounds[name]['min'][2] - table['height']) < 1e-4, (name, bounds[name])
for a,b in itertools.combinations(ids, 2):
    overlap = [min(bounds[a]['max'][k], bounds[b]['max'][k]) - max(bounds[a]['min'][k], bounds[b]['min'][k]) for k in range(3)]
    assert not all(v > 1e-4 for v in overlap), (a,b,overlap)
ice = objects['ice_machine']
nova = objects['nova2']
angle = math.radians(ice['yaw_deg'])
facing = [math.sin(angle), -math.cos(angle)]
assert facing[0] * (nova['x']-ice['x']) + facing[1] * (nova['y']-ice['y']) > 0
assert any(r['id'] == 'nova2' and r['visual_count'] == 7 for r in report['robot_imports'])
result = {'passed': True, 'table_size_m': [table['width'], table['depth'], table['height']], 'supported_objects': ids, 'checks': ['actual meshes within tabletop outline', 'all bases at tabletop height', 'no bounding-box intersections between coffee devices and posed Nova-2', 'ice-machine face points toward Nova-2', 'seven Nova-2 URDF link visuals imported'], 'motion_validation': False}
(base / 'output/coffee-verification.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result))
