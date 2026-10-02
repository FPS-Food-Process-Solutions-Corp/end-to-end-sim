"""Add the reference dock close-up and finish scene navigation."""
import json
from pathlib import Path

base = Path(__file__).resolve().parent
path = base / 'scene_config.json'
config = json.loads(path.read_text(encoding='utf-8-sig'))
config['cameras']['dock_detail'] = {
    'name': 'Charging dock / connector faces plan left',
    'location': [1.88, .78, .88],
    'target': [2.84, 1.45, .14],
    'ortho': 1.03,
}
path.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
path = base / 'viewer.html'
s = path.read_text(encoding='utf-8-sig')
s = s.replace("$('rangesToggle').checked = true; $('robotsToggle').checked = true;", "$('rangesToggle').checked = true; $('robotsToggle').checked = true; $('equipmentToggle').checked = true;")
s = s.replace("-depth / 2 - 0.01", "-depth / 2 + 0.01")
s = s.replace('<a href="./output/customer.png" target="_blank" rel="noopener">Customer render</a>', '<a href="./output/dock_detail.png" target="_blank" rel="noopener">Dock detail</a>')
s = s.replace('<button id="fitView" type="button">Fit scene</button>', '<button id="fitView" type="button">Fit scene</button><button id="dockView" type="button">Charging dock</button>')
s = s.replace("$('fitView').addEventListener('click', fitScene);", """$('fitView').addEventListener('click', fitScene);
    $('dockView').addEventListener('click', () => {
      const dock = objectById('charger');
      selectedId = 'charger'; renderControls();
      controls.target.set(dock.x, dock.height / 2, -dock.y);
      camera.position.set(dock.x - 1.0, .86, -dock.y + .73);
      camera.up.copy(up); camera.lookAt(controls.target); controls.update();
      $('customerView').classList.remove('active'); $('topView').classList.remove('active');
    });""")
path.write_text(s, encoding='utf-8')
print('Added dock detail camera; top view matches source-plan left/right.')
