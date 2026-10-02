from pathlib import Path

base=Path(__file__).resolve().parent
entry=base/'build_plan.py'
entry.write_text('"""Regenerate the area-grouped SVG and robot reference library."""\nfrom pathlib import Path\nimport runpy\nrunpy.run_path(str(Path(__file__).with_name("build_area_plan.py")), run_name="__main__")\n',encoding='utf-8')
path=base/'native-importer-template.js'
s=path.read_text(encoding='utf-8')
s=s.replace('for (const layer of DATA.layers) {','function buildGroup(layer) {')
s=s.replace('      if (members.length) {',"      for (const child of layer.children || []) { const childGroup=buildGroup(child); if(childGroup) members.push(childGroup); }\n      if (members.length) {")
s=s.replace("        if (layer.name==='Background') g.locked=true;", "        if (layer.name==='Background') g.locked=true;\n        if (layer.role) g.setPluginData('role', layer.role);\n        if (layer.robot) g.setPluginData('robot', layer.robot);\n        return g;")
s=s.replace('    frame.x=Math.round', '    for (const layer of DATA.layers) buildGroup(layer);\n    frame.x=Math.round')
s=s.replace("+' layers at 2 px/cm, with native shapes and editable labels.'", "+' area groups at 2 px/cm, with nested robot packages and editable labels.'")
path.write_text(s,encoding='utf-8')
path=base/'build_area_plan.py'
s=path.read_text(encoding='utf-8')
s=s.replace('from fontTools.ttLib import TTFont', "import sys\nsys.path.insert(0, r'C:\\Users\\andyl\\.codex\\visualizations\\2026\\09\\29\\01a0ee3a-44e6-7282-8274-6cd194728ded\\figma-tools')\nfrom fontTools.ttLib import TTFont")
path.write_text(s,encoding='utf-8')
print('Installed area SVG builder and recursive Figma grouping.')
