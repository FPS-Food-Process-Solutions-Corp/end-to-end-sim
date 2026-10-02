# Editable bakery cell

The latest revised draw.io plan is reconstructed at metre scale in Blender. The browser viewer lets you orbit the scene and edit placements and dimensions. Everything runs locally; no account or Blender MCP is required.

## View and edit

Open http://127.0.0.1:8765/viewer.html while its local server is running. To restart it, run this one-line command from the repository root:

```powershell
& .\design\bakery_cell\open_viewer.ps1
```

Select an object in the dropdown or click its geometry. Edit X, Y, yaw, height offset and dimensions. Cylinders have a diameter field; windows have thickness and bottom-height fields. Robots retain their actual URDF scale. Changing a support height raises its machines and mounted robots. Moving a table in X/Y does not move equipment automatically; each placement is independent.

Click **Download JSON**, copy the downloaded file over `design/bakery_cell/scene_config.json`, then rebuild from the repository root:

```powershell
& .\design\bakery_cell\build.ps1
```

Alternatively pass a downloaded file directly:

```powershell
& .\design\bakery_cell\build.ps1 -Config 'C:\path\to\scene_config.json'
```

`-Preview` makes smaller/faster renders; `-NoRender` updates just the models. Reload the viewer after rebuilding. Browser dimension edits scale the existing mesh immediately; rebuilding preserves sheet thickness and regenerates detailed construction. Import JSON applies saved parameters. Reset restores the parameters used to build the loaded model.

To open the native scene for editing:

```powershell
& .\design\bakery_cell\open_blender.ps1
```

Portable Blender 4.5.14 LTS is in this repository's `.local/blender-runtime` folder. Use Blender 4.5 LTS for regeneration: the generator uses its Collada importer for Lebai meshes. There is no system-wide installation.

## Files

- `output/bakery_cell.blend`: self-contained native scene, named collections, per-object roots, and robot link hierarchy. Config and generator are embedded as Blender text blocks.
- `output/bakery_cell.glb`: portable scene for the browser and other 3D applications.
- `output/overview.png`, `customer.png`, `top.png`, `rear.png`: rendered views.
- `scene_config.json`: editable source parameters.
- `output/built_config.json`: snapshot matching the exported model; the browser's transform baseline.
- `source_layout.drawio`: the revised source plan.
- `assets/robots`: self-contained copies of the four robots in the plan.
- `build_scene.py`: geometry generator and URDF importer.
- `output/scene_report.json`: geometry bounds and import inventory.

## Parameter conventions

Lengths are metres; angles are degrees. Origin is the front-left floor corner. X increases right, Y toward the rear, and Z upward. Object X/Y values are centres. Furniture and machine width/depth are local dimensions before yaw rotation. The GLB is Y-up internally; the viewer handles that conversion.

`objects` controls each item separately. `support` positions equipment on a named worktop plus optional `z`. Table/cart/counter height is the worktop surface height. A window top is `bottom + height`. Machine `style` selects a simplified coffee, fridge, ice, tea or lid-press appearance; each machine's size, position and rotation is independent.

`shelves` controls tier count, vertical pitch, first front-edge height, back-to-front drop, column count, divider height and sheet thickness. A rack can supply `shelf_overrides` for individual values. Rack width includes posts, so the solid stainless tier is narrower. `tools` controls the illustrative cup-prong and suction dimensions. `joints_deg` sets named URDF joint display poses. Structural and joint changes require rebuilding.

## Dimensions and assumptions

- Room: 3.8 x 3.5 m. Remaining object centres follow the revised plan. Bun rack 2 was removed from the middle of the room at the user request; the original draw.io is retained as reference.
- Ordering/pickup counter: 0.90 m. Coffee table and Nova-5 cart: 0.80 m.
- Shelves: six columns and five dividers per tier; 0.40 m vertical spacing and 0.10 m back-to-front drop. Solid stainless bases, without slots or holes.
- Provisional shelf construction: four tiers with front edges at 0.35, 0.75, 1.15 and 1.55 m; rack posts 1.80 m. Tier count and lowest height were not supplied.
- Plastic panels: 0.80 to 1.70 m above floor, provisionally 6 mm thick, aligned to the blue plan rectangles.
- Machines: 0.58 m tall. Cup/lid dispensers: 0.70 m tall, 0.10 m diameter from the drawing.
- Neutral scale mannequin: exactly 1.70 m tall.
- ME6 suction and Nova-2 cup prong are provisional geometry. Nova-5 uses the selected Lebai tongs and wrist camera meshes.
- ME6 has a provisional bracket at cart height; boxes have a separate support stand.
- Atom-W retains its actual approximately 0.710 x 0.514 m chassis and the drawn centre. Its 0.5 x 0.5 m plan symbol understates its size, leaving the real chassis very close to the counter.
- MG400 is absent from the latest plan and is not placed in this scene.

Equipment appearance, buns and the person are simplified. Robot poses are illustrative. The Nova-5 pose was checked with forward kinematics for downward tongs above the cart; mesh collision, task reach and swept motion have not been validated.

## Verification

`verify_viewer.cjs` exercises model loading, support-height edits, cylinder sizing, panel visibility, JSON export/import and reset. `inspect_scene.py` checks native object centres and suspicious Nova-5 mesh bounds. All four rendered views were visually inspected. Three.js and its license are local in `vendor/`; no external network requests are needed by the viewer.
