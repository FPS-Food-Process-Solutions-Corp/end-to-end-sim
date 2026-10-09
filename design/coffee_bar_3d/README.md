# Coffee bar Layout studio

For design requirements, see [Coffee bar layout guidelines](LAYOUT_GUIDELINES.md). For current editor features and controls, see the [editor guide](EDITOR_GUIDE.md).

For standalone Windows and macOS applications, see [Desktop builds and CI](desktop/README.md). The Electron package runs offline with bundled models and preserves editor exports, recording, autosave and snapshots.

Open **http://127.0.0.1:8766/viewer.html**. The 2D SVG plan and 3D scene share one editable model. Select objects in either view or the layer list. Changes appear in both views immediately and are saved in this browser's local storage.

If the local server is stopped, run this from the repository root:

```powershell
& .\design\coffee_bar_3d\open_viewer.ps1
```

## Editing

- **Layers** are grouped by area, with coffee equipment in a nested group. Select a group to move, resize or rotate its contents. Shift-click selects multiple items. The eye and lock controls affect both views.
- **2D plan:** drag to move, drag a corner to resize, or use the round handle to rotate. Scroll zooms; Space-drag or middle/right-drag pans. Alt bypasses 1 cm snapping; Shift snaps rotation to 15° and constrains resize proportions.
- **Properties:** edit centre X/Y, width, depth, rotation, height, support and elevation. X points right and Y points down from the plan's top-left; positive displayed rotation is clockwise. Width/depth are local dimensions before rotation. Units switch between cm and pixels, at exactly **2 px = 1 cm**.
- **3D scene:** Orbit rotates the camera; Move drags objects on a horizontal plane. Top, Focus and Home change the camera. Right-drag pans; scroll zooms. The numeric properties also edit the 3D scene.
- **Supports:** moving or rotating a table/cart carries its equipment. Changing its height adjusts the equipment's mount elevation. Hiding or deleting it also hides or deletes its supported equipment. Deletion can be undone.
- **Robots:** drag a library card onto the plan or click its plus button. Nova-2, Nova-5 with Lebai tongs, ME6 with suction, MG400 and Atom-W use actual URDF-derived meshes. Tabletop robots attach to the surface under the drop location. Nova-5 adds a 60 × 80 cm cart. Robot resizing uniformly scales its model and reach guides.
- **Keyboard:** Delete removes, Ctrl D duplicates, Ctrl Z undoes, Ctrl Shift Z / Ctrl Y redoes, Ctrl A selects all visible unlocked objects. Arrow keys nudge 1 cm; Shift increases that to 10 cm.

## Reach and distances

Selecting a robot shows its two circles and configured measurements in both views. **All reach radii** and **All distances** show them for every visible robot. Selecting an area includes its robots. In Properties, choose objects under “Measure to”; an empty list automatically selects the nearest three eligible objects.

Orange dashed circles show maximum effective reach: working radius + tool length. Solid teal circles show realistic placement reach: working radius × 70/85, without tool length.

| Robot | Maximum effective diameter | Realistic placement diameter |
| --- | ---: | ---: |
| Nova-2 | 145 cm | 102.94 cm |
| Nova-5 | 238 cm | 140 cm |
| ME6 | 90 cm | 74.12 cm |
| MG400 | 88 cm | 72.47 cm |
| Atom-W | 170.53 cm | 130.04 cm |

Atom-W uses its torso sweep radius (20.60097 cm) plus arm-to-hand-mount length (58.35 cm). Effective reach adds 6.31633 cm to the palm midpoint. Its reach origin follows the torso axis, 2.5 cm behind the chassis origin in local X. The derivation remains in `../coffee_bar_figma/atom-w-reach-measurements.json`.

Reach appears as circles in the 2D plan and transparent spheres with sparse latitude/longitude lines in the 3D viewer. The maximum effective sphere is orange with dashed lines; realistic placement is teal with solid lines. Both use the existing radii and reach origin at the robot mounting plane, follow movement and scaling, and appear for selected robots or when All reach radii is enabled. Hidden robots have no reach guides. These are planning envelopes, not a collision or joint-limit simulation.

The distance selector offers **Centre → target**, **Footprint → target**, or **Both distances**. Machine targets use their front-face centre; shelves use their nearest edge. Distances remain horizontal, with the cart outline used for a robot mounted on a cart.

## Save, export and reopen

- **SVG:** exports the current plan at 2 px/cm, with named area groups, live text, visible guides and robot circles grouped with their robot. The robot reference sheet can be included. Drag the SVG into Figma. Its metadata also contains the complete scene for reopening here.
- **GLB:** exports the current visible 3D geometry, including added robots, transforms and hidden-state filtering. Import this into Blender or other 3D tools. Measurement overlays and selection boxes are excluded from the geometry export.
- **PNG:** exports the current 3D camera image, including the visible reach and distance overlays.
- **JSON:** saves the full parametric scene, hidden objects and editor options. Use Import to restore it.
- **Blender source layout:** downloads the generated source `.blend`. Browser edits do not rewrite this file; export GLB for the current edited geometry, or rebuild with an exported JSON.

Import accepts this editor's SVG exports and scene JSON. Arbitrary SVG artwork or manual edits made in Figma do not automatically translate into 3D geometry. The immediate link is between the plan and scene inside Layout studio.

Changes save locally under `coffee-layout-studio-v2`; download SVG or JSON to keep a portable copy. Reset restores the source layout and can be undone. The previous viewer is retained as `viewer-legacy.html`.

## Native Blender rebuild

To regenerate furniture and robot geometry from an exported JSON, pass its path to the builder. These commands use one line per command:

```powershell
& .\design\coffee_bar_3d\build.ps1 -Config 'C:\path\coffee-bar-edited.json'
& .\design\coffee_bar_3d\open_blender.ps1
```

The builder writes `output/coffee_bar.blend`, `output/coffee_bar.glb`, `output/built_config.json`, the scene report and render PNGs. To use a separate output folder:

```powershell
& .\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe --background --python-exit-code 1 --python .\design\coffee_bar_3d\build_scene.py -- --config 'C:\path\coffee-bar-edited.json' --output 'C:\path\rendered-layout' --no-render
```

Browser size changes scale most existing meshes; shelves are rebuilt live from their parameters. Native rebuilding regenerates structural details from the parameters: shelf tier count, spacing, slope, divider count, materials and robot joint poses remain editable in JSON. The browser does not provide joint posing or tool-shape editing.

## Current source layout

The main counters and coffee table are 90 cm high, Nova-5's cart is 80 cm high, and the reference person is 1.70 m tall. Shelf tiers are 40 cm apart, drop 10 cm from back to front, and have six solid stainless compartments. The Nova-5 cart is 60 cm along plan X and 80 cm along plan Y. The 13 × 13 cm robot mounting outline is 4 cm from the cart's top edge and 10 cm from its right edge.

The ice machine is **45 cm across its front × 50 cm deep × 58 cm tall**. Its controls, bin and handle are on the short face, pointing toward Nova-2. The charging dock follows the provided 545 × 572 × 280 mm envelope; its projecting connector faces left in the plan.

The source drawing shows 500 cm of a dimensioned 575 cm depth. The pale 75 cm strip remains an unconfirmed reference area. The latest plan did not locate the earlier plastic windows or ME6/MG400 positions; those older placements are preserved in `../bakery_cell`. ME6 and MG400 are now available to place from this editor's robot library.

## Implementation and checks

`editor/store.js` owns the scene, selection, support relationships, geometry, measurements and undo history. `editor/plan.js` renders and edits SVG. `editor/scene3d.js` loads local meshes and applies the same transforms, visibility and measurements. `editor/app.js` connects the controls, local persistence and exports. All runtime libraries and models are local; there are no runtime CDN dependencies.

`test_editor.cjs` exercises the live UI, support transforms, visibility/deletion, unit conversion, measurements, all five robot additions, SVG/GLB/PNG export, SVG import and persistence. `test_editor_interactions.cjs` verifies SVG resize/rotate handles, tabletop robot drag/drop, direct 3D dragging and invalid cycle rejection. Results are in `output/editor-test-report.json`; preview screenshots are `output/editor-overview.png` and `output/editor-coffee.png`.

## Coffee equipment details

The five machine tops carry thin surface lettering (COFFEE, MILK, TEA, ICE and LID PRESS), aligned with the longer side. The lettering follows object transforms and remains proportional when resized. Both dispenser caps are also labelled. These are physical model parts included in GLB and Blender exports.

The cup and lid dispensers each retain their 70 cm overall height, with a 30 cm opening below the 40 cm cylindrical body. Each is attached to the worktop by a 14 × 16 cm steel plate, four visible bolts and a rear upright. The support is behind the cylinder, keeping the front access area open. Its bottom_clearance, plate dimensions and rear-support dimensions are parameters in its scene-config entry.

Nova-2 uses a compact pair of curved cup jaws: 85 mm inner diameter, 6 mm wall, 12 mm thickness and approximately 94 mm projection from the flange. The cup centre is 70 mm ahead of the flange; the open side faces forward. Tool geometry is parameterized under tools.nova2. The existing approximate 10 cm tool allowance in the reach circles is retained.

## Shelf and bread configuration

Select Shelf 1 or Shelf 2, then use **Shelf & bread** in Properties. Each shelf has its own column count, rack/tier count, tier spacing, back-to-front drop, bottom-tier floor clearance, bread Length 1 (across the column), Length 2 (along the tray), bread height and Show bread checkbox. Dimensions use the selected cm/px units. Bread dimensions are full ellipsoid diameters; defaults are 10.2 × 9.4 × 6.2 cm.

The **lowest front underside edge** of the metal tray is the reference for floor clearance and tier-to-tier spacing. The default first edge is 35 cm above the floor, tiers are 40 cm apart, and each tray drops 10 cm from back to front. The inspector reports clear column width excluding the divider thickness, vertical tray-surface-to-upper-underside clearance at the same horizontal point, clearance above the dividers, and the maximum tier count.

The tier maximum is calculated from frame height, bottom clearance, pitch, slope, and the topmost metal/bread geometry. Tier count is clamped to that maximum; minimum spacing prevents trays/dividers/bread from overlapping vertically, with 5 mm allowance. Increasing frame height or reducing spacing can allow more tiers. An impossibly short frame shows zero fitting tiers. These are geometric fit checks, not robot-access or fabrication validation.

Changing columns rebuilds the dividers immediately. Bread keeps its specified physical size when the shelf is resized; rows adjust to the tray depth with 1.5 cm between pieces. Oversized bread is flagged instead of silently shrinking. “Apply to all shelves” copies the shelf and bread settings to unlocked shelves, respecting each frame’s height. Undo, local autosave, SVG/JSON round-trip and GLB export retain the settings. The 2D plan shows the upper tier; the 3D scene shows every tier.

Global defaults live under shelves in scene_config.json; per-shelf values live under shelf_overrides. The browser and native Blender builder apply equivalent geometry and physical limits. Exported JSON stores the effective settings.

## Distance targets

Nova-2’s default distance targets include coffee, tea, ice, lid press, lid dispenser and cup dispenser. Machine/dispenser arrows end at the centre of the front face (local -Y), following position, dimensions and rotation. Shelf arrows retain the nearest footprint edge. The dropdown selects the robot’s centre or the edge of its footprint as the origin; Nova-5 uses its cart footprint for edge measurements.

Readouts are horizontal distances, not 3D tool-path lengths. In 3D, machine arrows lie at the front face’s midpoint height, including the raised dispenser body. Both views, cm/px units, selection and show-all controls use the same calculations. Older saved layouts receive the three newly requested Nova-2 targets once, without changing saved positions; later target choices are preserved.

test_shelf_distances.cjs verifies actual shelf mesh heights and counts, rotated front-face targets, physical limits, units, resizing, undo, migration and exports. Results are saved to output/shelf-distance-test-report.json.

## Bag-opening concept

The scene now includes bag_opener on middle_counter between the two racks. It uses the user's 15 × 9 × 28 cm bag and a proposed 36 × 27 cm fixture, with opposing vacuum platens, eight provisional 20 mm cups, a guided 78 mm slide and bottom support. The open bag mouth is 122.4 cm above the floor on the 90 cm counter.

Open bag-opener/index.html for close-up and in-context renders, the feasibility assessment and model downloads. Standalone sources are bag-opener/parameters.json and bag-opener/build.py; bag_opener.py is shared with the main builder. The independent standalone .blend and GLB files are in bag-opener/output.

Source-layout robot positions are retained. Neither robot is within the chosen placement envelope of the bag centre at those positions. The current 10.2 × 9.4 cm bread placeholder also exceeds the nominal 9 cm mouth depth. Test the actual bun, gripper and bag rather than treating a render as a validated packing sequence.

Revision 4 adds the new fixture once to older saved layouts, at their existing middle counter pose, and adds its distance target for Nova-5 and Atom-W. It preserves existing layout edits and later removal of the fixture.
