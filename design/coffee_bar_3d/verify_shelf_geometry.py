"""Run in Blender to verify native shelves against the browser-exported fixture."""
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.argv = [str(HERE / 'build_scene.py')]
scope = {'__file__': str(HERE / 'build_scene.py'), '__name__': '__main__'}
source = (HERE / 'build_scene.py').read_text(encoding='utf-8').split('RANGE_ORANGE=material', 1)[0]
exec(compile(source, str(HERE / 'build_scene.py'), 'exec'), scope)
config = json.loads((HERE / 'output/shelf-settings-test.json').read_text(encoding='utf-8'))
scope['C'] = config
scope['ITEMS'] = {o['id']: o for o in config['objects']}
results = []
for obj in config['objects']:
    if obj['kind'] != 'shelf':
        continue
    scope['make_shelf'](obj)
    scope['bpy'].context.view_layer.update()
    root = scope['ROOTS'][obj['id']]
    tiers = [n for n in root.children if n.name.startswith('Tier ')]
    settings = obj['shelf_overrides']
    assert len(tiers) == settings['tiers']
    heights = []
    for tier in sorted(tiers, key=lambda n: n['front_height']):
        base = next(n for n in tier.children if n.name.startswith('Continuous solid'))
        z = min((base.matrix_world @ Vector(p)).z for p in base.bound_box)
        heights.append(z)
        assert abs(z - tier['front_bottom_height_m']) < 1e-6
        for child in tier.children:
            if child.type == 'MESH':
                assert max((child.matrix_world @ Vector(p)).z for p in child.bound_box) <= obj['height'] + 1e-6
    for i, z in enumerate(heights):
        assert abs(z - settings['first_tier_front_height'] - i*settings['tier_spacing']) < 1e-6
    buns = [n for t in tiers for n in t.children if n.get('bread_ellipsoid')]
    dividers = [n for t in tiers for n in t.children if n.name.startswith('Divider ')]
    assert len(dividers) == settings['tiers'] * (settings['columns']-1)
    assert buns and abs(buns[0]['length_1_m'] - settings['bread_length_1']) < 1e-9
    results.append(dict(id=obj['id'],tiers=len(tiers),dividers=len(dividers),buns=len(buns),bottom_edges=heights,max_tiers=root['max_tiers']))
(HERE / 'output/native-shelf-test-report.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print('NATIVE SHELF GEOMETRY VERIFIED', json.dumps(results))
