"""Correct the coffee-cell placement while preserving the latest floor plan."""
import copy
import json
import shutil
from pathlib import Path

base = Path(__file__).resolve().parent
path = base / 'scene_config.json'
config = json.loads(path.read_text(encoding='utf-8-sig'))
objects = {o['id']: o for o in config['objects']}
placements = {
    'coffee_machine': (.270, 1.300, 90),
    'milk_fridge': (.270, 1.580, 90),
    'tea_machine': (.270, 1.880, 90),
    'lid_machine': (.250, .975, 90),
    'ice_machine': (.990, 1.895, 0),
    'cup_dispenser': (1.320, 1.600, 0),
    'lid_dispenser': (1.320, 1.400, 0),
}
for name, (x, y, yaw) in placements.items():
    objects[name].update(x=x, y=y, yaw_deg=yaw, support='coffee_station', equipment_group='coffee')
    objects[name].pop('provisional', None)
station = objects['coffee_station']
station['label'] = 'Robot coffee and pickup table / 140 x 140 cm'
station['handoff_pads'] = [{'x': .49, 'y': -.54, 'width': .28, 'depth': .24}]
prior = json.loads((base.parent / 'bakery_cell/scene_config.json').read_text(encoding='utf-8-sig'))
nova = copy.deepcopy(next(o for o in prior['objects'] if o['id'] == 'nova2'))
nova.update(x=.94, y=1.32, support='coffee_station', yaw_deg=0)
nova.pop('source_cell', None)
config['objects'] = [o for o in config['objects'] if o['id'] != 'nova2']
config['objects'].insert(next(i for i,o in enumerate(config['objects']) if o['id']=='ice_machine'), nova)
shutil.copytree(base.parent / 'bakery_cell/assets/robots/nova2', base / 'assets/robots/nova2', dirs_exist_ok=True)
config['assumptions'] = [a for a in config['assumptions'] if not a.startswith('Previously named coffee equipment') and not a.startswith('The new drawing locates only')]
config['assumptions'].append('Coffee equipment and Nova-2 are on the front 1.40 x 1.40 m, 0.90 m high coffee table. Machines are 0.58 m high; dispensers are 0.70 m high. Individual positions remain adjustable. The ice machine faces Nova-2; the left-side devices face inward toward the arm.')
config['assumptions'].append('Nova-2 uses the original URDF meshes and the previously specified static two-finger cup prong. Its base is supported by the coffee table and follows table height changes.')
config['assumptions'].append('The new drawing gives no ME6/MG400 or plastic-window locations; those older positions have not been transferred.')
config['cameras']['coffee_detail'] = {'name': 'Coffee table / Nova-2 and devices', 'location': [3.3, -.9, 3.4], 'target': [.68, 1.46, 1.18], 'ortho': 2.9}
path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')

path = base / 'build_scene.py'
s = path.read_text(encoding='utf-8-sig')
old = """        for x in [-w*.29, w*.29]:
            box('Handoff mat', (x, d*.18, h+.002), (w*.28, d*.3, .004), DARK, r, .01)"""
new = """        pads = o.get('handoff_pads', [{'x': x, 'y': d*.18, 'width': w*.28, 'depth': d*.3} for x in [-w*.29, w*.29]])
        for pad in pads:
            box('Handoff mat', (pad['x'], pad['y'], h+.002), (pad['width'], pad['depth'], .004), DARK, r, .01)"""
assert old in s or new in s
s = s.replace(old, new)
path.write_text(s, encoding='utf-8')

path = base / 'viewer.html'
s = path.read_text(encoding='utf-8-sig')
s = s.replace('Provisional coffee equipment', 'Coffee equipment')
s = s.replace('object.provisional ? equipmentVisible', "object.equipment_group === 'coffee' ? equipmentVisible")
s = s.replace('<button id="dockView" type="button">Charging dock</button>', '<button id="dockView" type="button">Charging dock</button><button id="coffeeView" type="button">Coffee table</button>')
s = s.replace("$('dockView').addEventListener('click', () => {", """$('coffeeView').addEventListener('click', () => {
      const table = objectById('coffee_station');
      selectedId = 'nova2'; renderControls();
      controls.target.set(table.x, table.height + .30, -table.y);
      camera.position.set(table.x + 2.3, table.height + 2.25, -table.y + 2.3);
      camera.up.copy(up); camera.lookAt(controls.target); controls.update();
      $('customerView').classList.remove('active'); $('topView').classList.remove('active');
    });
    $('dockView').addEventListener('click', () => {""")
path.write_text(s, encoding='utf-8')

path = base / 'verify_viewer.cjs'
s = path.read_text(encoding='utf-8-sig').replace("selectOption('left_counter')", "selectOption('coffee_station')").replace("o.id==='left_counter'", "o.id==='coffee_station'")
s = s.replace("const iceBefore = await transform('ice_machine');", "const iceBefore = await transform('ice_machine');\n    const novaBefore = await transform('nova2');")
s = s.replace("near((await transform('ice_machine')).position[1]-iceBefore.position[1],.1,'machine follows support height');", "near((await transform('ice_machine')).position[1]-iceBefore.position[1],.1,'machine follows support height');\n    near((await transform('nova2')).position[1]-novaBefore.position[1],.1,'Nova-2 follows coffee table height');")
s = s.replace("await page.locator('#dockView').click();", "await page.locator('#coffeeView').click();\n    await page.screenshot({path:path.join(__dirname,'output','viewer-coffee.png')});\n    await page.locator('#dockView').click();")
path.write_text(s, encoding='utf-8')

path = base / 'README.md'
s = path.read_text(encoding='utf-8-sig')
s = s.replace('with Nova-5 in front of shelf 2, Atom-W in front of shelf 1, and a 1.70 m person at the coffee/pickup counter.', 'with Nova-5 in front of shelf 2, Atom-W in front of shelf 1, Nova-2 and the coffee devices on the front 1.40 × 1.40 m table, and a 1.70 m person at the coffee/pickup counter.')
s = s.replace('Use Overview, Top, or Charging dock', 'Use Overview, Top, Coffee table, or Charging dock')
s = s.replace('overview, top, customer, rear, and dock-detail PNGs', 'overview, top, customer, rear, dock-detail, and coffee-detail PNGs')
s = s.replace('The actual Nova-5/Lebai-tongs and Atom-W URDF meshes are included.', 'The actual Nova-5/Lebai-tongs, Nova-2, and Atom-W URDF meshes are included. Nova-2 has the static two-finger cup prong and shares the 0.90 m high coffee table with all five machines and both dispensers. The ice-machine face points toward Nova-2; the left-side machines face inward. The front edge contains the ordering terminal and pickup pad.')
s = s.replace('Shelf-bay lengths and individual coffee-equipment positions are provisional.', 'Shelf-bay lengths and the detailed arrangement within the coffee table remain adjustable.')
s = s.replace('or the other robots, so this separate scene', 'or ME6/MG400, so this separate scene')
path.write_text(s, encoding='utf-8')
print('Moved 7 coffee devices onto the coffee table; added Nova-2 and cup prong.')
