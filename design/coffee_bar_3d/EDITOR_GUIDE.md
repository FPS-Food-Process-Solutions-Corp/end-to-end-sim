# Coffee bar Layout studio

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
- **Copy / paste:** select components or an area, then use Ctrl C / Ctrl V (Cmd on Mac), or the Copy / Paste buttons below Layers. Each paste adds a separate copy 15 cm right and down from the last. Tables and carts include their mounted equipment; groups preserve their hierarchy. Internal supports and measurement targets point to the new copies. Copying equipment alone retains its existing support. Copies preserve dimensions, rotation, shelf settings, custom ME6 tools and visibility. Undo, both views, autosave and exports include the pasted parts. Text fields keep normal text copy/paste. Toolbar Paste uses the last components copied in this editor, also available across editor tabs and reloads.
- **Keyboard:** Delete removes, Ctrl D duplicates, Ctrl Z undoes, Ctrl Shift Z / Ctrl Y redoes, Ctrl A selects all visible unlocked objects. Arrow keys nudge 1 cm; Shift increases that to 10 cm.

## Reach and distances

Selecting a robot shows its two reach envelopes and configured measurements in both views. **All reach radii** and **All distances** show them for every visible robot. Selecting an area includes its robots. In Properties, choose objects under “Measure to”; an empty list automatically selects the nearest three eligible objects.

Orange dashed circles show maximum effective reach: working radius + tool length. Solid teal circles show realistic placement reach: working radius × 70/85, without tool length.

| Robot | Maximum effective diameter | Realistic placement diameter |
| --- | ---: | ---: |
| Nova-2 | 145 cm | 102.94 cm |
| Nova-5 | 238 cm | 140 cm |
| ME6 | 90 cm | 74.12 cm |
| MG400 | 88 cm | 72.47 cm |
| Atom-W | 170.53 cm | 130.04 cm |

Atom-W uses its torso sweep radius (20.60097 cm) plus arm-to-hand-mount length (58.35 cm). Effective reach adds 6.31633 cm to the palm midpoint. Its reach origin follows the torso axis, 2.5 cm behind the chassis origin in local X. The derivation remains in `../coffee_bar_figma/atom-w-reach-measurements.json`.

Reach appears as circles in the 2D plan and smooth translucent sphere surfaces in the 3D viewer, with no internal rings or volume fill. The maximum effective sphere is orange; realistic placement is teal. Both use the existing radii and reach origin at the robot mounting plane, follow movement and scaling, and appear for selected robots or when All reach radii is enabled. Hidden robots have no reach guides. These are planning envelopes, not a collision or joint-limit simulation.

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

The main counters and coffee table are 90 cm high. One shared packing table, initially 105 × 180 cm and 80 cm high, supports the bun Nova-5, suction Nova-5, bag magazine and fixed suction holder. Each part can be adjusted independently using global transforms or local X/Y offsets from its support's centre. Moving, rotating or raising the table carries all four parts. The tongs Nova-5 remains available with a separate 60 × 80 cm cart when added from the robot library. The reference person is 1.70 m tall.

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

## Nova-5 suction workflow

Open **Flow** beside Layers and Robots. **Check IK** tests the magazine's exposed bag face, the opposing suction contact, the end of the opening stroke, and the centre of the placement rectangle. A 3 × 3 grid samples valid bag-centre locations within the rectangle, inset by half the bag footprint. Clicking a successful result shows that robot pose. The grid reports sampled reachability, not a guarantee for every point in the area.

**Draw new zone** lets you drag a rectangle in the 2D plan. It attaches to a table that contains the drawn rectangle, preferring a selected table and then the front coffee / ordering / pickup table when these fit. Otherwise it uses the table under the centre and reports any overhang. Select it to move, resize or rotate it in either view, or adjust its local X/Y offset from the table centre.

**Active placement rectangle** identifies the exact rectangle and its assigned support table. Moving an existing rectangle across the room keeps that support until you change it in the selector. Containment checks use all four rotated corners in the assigned table's local axes; reach circles do not affect them. Warnings name the support and list the overhang in centimetres at each failing edge. A rectangle on the wrong support suggests other tables that contain it. Changing support keeps XY and mounts the rectangle 2 mm above the new table.

**Inspect placement & table** frames both views, outlines the assigned table in blue and marks outside corners in red. **Move rectangle inside this table** applies the minimum translation needed without resizing or rotating it, and can be undone. It is unavailable when the rectangle is too large to fit by translation or is locked. Boundary warnings update immediately even when automatic IK checking is off. **Preview flow** explains its blocking reason and requires a fresh successful IK check after an edit; the View flow camera control remains available. Zone boundaries and footprint conflicts with tabletop equipment are checked separately from IK.

The suction variant retains the Nova-5 arm meshes and six arm joints from the URDF; tongs, gripper and wrist-camera attachments are removed. Its flange-mounted tool is 80 × 80 mm across the face and 100 mm from flange to cup contact plane, including the cups. Four provisional 20 mm cups are spaced 50 mm apart. Its maximum effective reach guide is 95 cm radius; placement guide remains 70 cm. Numerical IK uses the URDF geometry instead of either display radius.

The shared source table starts at X=1.625, Y=3.05 m, with a 105 × 180 cm top at 80 cm elevation. Revision 6 converts earlier cart/ME6 layouts to this shared table, preserving unrelated equipment edits and previously copied ME6 models. The original animated ME6 proposal remains available in me6-bag-station/.

**Stroke & clearance** controls the opening stroke, approach/withdrawal distance and vertical lift. The default 8.6 cm stroke expands the flat 4 mm bag to its full 9 cm depth. The default 25 cm lift gives a continuous IK solution for the proposed layout. A low straight transfer can fail a joint limit even when its endpoints are reachable. Edits invalidate old results immediately; automatic rechecking is enabled by default.

**Bag motion** enables J1 sweeps by default. After withdrawal/lift, the robot follows an arc about its base with the arm shape nearly fixed, then aligns its position and yaw to the destination while keeping the bag upright. The planner tests short and long sweeps for both transfers, up to the configured additional lift (default 20 cm, tested at 0, half and full), and two starting-posture seeds: at most 24 candidates. Every accepted path remains continuous; independent IK solutions are never spliced across a failed segment. Extra clearance and longer duration are part of the solved preview, not edits to fixture positions.

The default held-bag tilt limit is 5°. IK still targets the exact upright orientation; this is a rejection limit, not a requested tilt. FK checks the actual suction tool/bag orientation after pickup through release, including joint interpolation between path samples. Subdivided checks plus a conservative angular bound enforce the tilt limit on that interpolation. Motion constraints are reported separately from IK failures.

The default minimum J1 share is 50% of combined J1/J2/J3 angular travel **during each sweep**. This excludes withdrawal, lift and final alignment, where other joints are needed, and does not restrict wrist compensation. The panel reports actual sweep shares and all six joints' full-sequence travel so the scope of this metric is explicit. Among passing candidates, the planner favours less shoulder/elbow and wrist movement, with smaller penalties for J1 movement and duration. It is a bounded candidate search, not a globally optimal or complete motion planner.

Longer sweeps extend the timeline. Bag loading, vacuum changes, placement and exports use the selected route's event times. Disabling the J1 preference restores straight transfers; the bag-tilt check stays active. Search results remain kinematic checks: there is no collision, robot-speed, suction-strength or payload validation.

**Preview flow** animates approach, single-bag pickup, transfer to the fixed cups, opening, a loading pause, release of fixed vacuum, carrying to the front table, placement and robot-vacuum release. Use the timeline to inspect each stage. The moving robot uses solved joint rotations, and the bag follows its tool contact point. Loading is illustrative: the bun Nova-5 is not motion-planned in this sequence.

The default bread placeholder is 10.2 × 9.4 cm, exceeding the bag's 15 × 9 cm opening in depth. The panel flags this; the bun stays above the opening during the loading pause until its dimensions fit. Choose the reference shelf in Flow or change that shelf's bread dimensions in Properties.

IK runs in a Web Worker using damped least-squares with deterministic restarts, six URDF joint limits and full tool orientation. Pose tolerances are 1 mm and 1 degree. The connecting path is solved at 12 samples/second; a failed pose or discontinuous joint step blocks full playback. No-solution results are numerical search failures, not a mathematical proof of impossibility. Mesh collisions, self-collision, controller trajectories, joint speeds, suction strength, flexible-bag behaviour and payload are not validated.

When a path stops, the Flow panel distinguishes **IK did not converge** from **Joint-step guard stopped the path**. It reports the exact phase, time, segment/sample, requested tool contact point, position and orientation errors versus tolerance, and joint angles close to URDF limits. Limit proximity is evidence, not a proven cause. If continuation IK fails, a separate multi-start search checks that same pose; finding an independent solution does not splice it into the path or claim a continuous connection. The 0.5-radian (28.65°) per-sample guard is a preview continuity heuristic, not a hardware speed limit.

**Locate failure · show last valid pose** marks the requested point with a red × in both views, shows the last valid robot posture, and adds a 3D arrow for the requested tool-face direction. The partial teal path ends at the last accepted sample. Coordinates show the requested suction contact point, not the robot base or bag centre; Z is height above the floor. Diagnostic joint details and full target orientation are retained in the exported report. Failed attempts are never played as valid robot motion.

**Export IK report** downloads the input layout, target definitions, sampled results and joint path. SVG/JSON retain components and workflow settings; GLB/PNG include visible current geometry, including a paused preview. These are not controller-ready programs. Stop/reset the preview before exporting the static layout.

Implementation lives in editor/bag-workflow.js, flow-geometry.js, flow-player.js, ik-core.js and ik-worker.js. prepare_nova_suction.py builds the neutral rig, joint metadata and legacy cart asset; nova_suction.py builds the tool. To regenerate the rig, run from the repository root:

    & .\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe --background --python-exit-code 1 --python .\design\coffee_bar_3d\prepare_nova_suction.py

test_suction_workflow.cjs verifies tool dimensions, cup count, URDF/model agreement, path limits, unreachable edits, table support propagation, drawn zones, bread fit, exports, persistence and revision-5 migration. Results are in output/suction-workflow-test-report.json. The former live ME6 station test describes the previous source layout; the standalone ME6 proposal has its own checks.

Copy/paste behavior is covered by test_clipboard.cjs, including nested groups, mounted equipment, custom suction models, text fields, exports, undo/redo and persistence.

Bag motion and longer-route playback are covered by test_bag_motion.cjs. The diagnostic test switches to straight transfers to preserve the original 8 cm lift failure case.

Placement containment, support assignment, live boundary diagnostics and playback gating are covered by test_placement_validation.cjs, including rotated and flush-edge cases.
