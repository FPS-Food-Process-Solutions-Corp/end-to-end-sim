# Coffee bar Layout studio

Open **http://127.0.0.1:8766/viewer.html**. The 2D SVG plan and 3D scene share one editable model. Select objects in either view or the layer list. Changes appear in both views immediately and are saved in this browser's local storage.

If the local server is stopped, run this from the repository root:

```powershell
& .\design\coffee_bar_3d\open_viewer.ps1
```

## Editing

- **Fullscreen:** click **Fullscreen** beside **Fit view** to expand the active 2D, 3D or split view. The view switcher, guides and camera controls remain available. Use **Exit fullscreen** or **Escape** to return to the editor. The current camera, plan zoom and scene are preserved. Embedded browsers that block native fullscreen expand the view within the app window instead.

- **Layers** are grouped by area, with coffee equipment in a nested group. Select a group to move, resize or rotate its contents. Shift-click selects multiple items. The eye and lock controls affect both views.
- **2D plan:** drag to move, drag a corner to resize, or use the round handle to rotate. Scroll zooms; Space-drag or middle/right-drag pans. Alt bypasses 1 cm snapping; Shift snaps rotation to 15° and constrains resize proportions.
- **Properties:** edit centre X/Y, width, depth, rotation, height, support and elevation. X points right and Y points down from the plan's top-left; positive displayed rotation is clockwise. Width/depth are local dimensions before rotation. Units switch between cm and pixels, at exactly **2 px = 1 cm**.
- **3D scene:** Orbit rotates the camera; Move drags objects on a horizontal plane. Top, Focus and Home change the camera. Right-drag pans; scroll zooms. The numeric properties also edit the 3D scene.
- **Floor-standing tea machine:** Library → Coffee equipment → **Tea machine / HZ-D01 floor-standing** adds the reference model at **60 × 70 × 152 cm**, with a 90 cm refrigerated cabinet, blue glass, seven simplified reservoirs, an open dispensing bay and sloping black touchscreen head. It starts on the floor beside the coffee table, facing the table; the selected support does not mount it automatically. Drag to choose another spot, rotate or resize it. Properties shows floor-footprint overlaps for the current layout; this is a bounding-footprint check and excludes customer panels/arm sweeps. The old **Tea machine / legacy tabletop** remains available and existing layouts are unchanged until an asset is added. To use the new unit, choose it under Coffee & drinks → Assign equipment → Milk tea. Its cup-rim target is 112 cm above its base and 10 cm inside the front face, scaling with the machine. Those outlet details are estimated from the photo; the outer dimensions come from the reference. The model participates in normal world collisions and SVG/JSON/GLB export.
- **Floor markings:** select **Charging zone / inferred outline** (or another floor zone) in Layers. **Properties → Floor marking** changes the floor text and text size, or hides the text and outline separately, in both 2D and 3D. Transform width/depth resizes the zone; rotation and position move the whole marking. The layer eye hides it entirely. Blank text is allowed. Edits persist in JSON/SVG, snapshots and autosave; GLB exports include the edited marking.
- **Supports:** moving or rotating a table/cart carries its equipment. Changing its height adjusts the equipment's mount elevation. Hiding or deleting it also hides or deletes its supported equipment. Deletion can be undone.
- **Robots:** drag a library card onto the plan or click its plus button. Nova-2, Nova-5 with Lebai tongs, ME6 with suction, MG400 and Atom-W use actual URDF-derived meshes. Tabletop robots attach to the surface under the drop location. Nova-5 adds a 60 × 80 cm cart. Robot resizing uniformly scales its model and reach guides.
- **Asset library:** use Search and the category filter to find furniture, robots, coffee equipment, bag fixtures, customer barriers, a human and charging equipment. Click **+** or drag a card into the 2D plan; every preset has a 3D model. **Furniture → Between-shelves counter** adds a 35 × 60 × 90 cm counter midway between the current Shelf 1 and Shelf 2. Edit its dimensions, height and rotation in Properties. Furniture cards add the bare table/cart/rack; they do not duplicate mounted robots or appliances. Equipment mounts on the selected table when added with **+**, or on the table under its drop point. Source templates remain available after deleting their scene objects; adding a missing source asset reuses its original ID so workflow references can reconnect. Undo, autosave and SVG/JSON/GLB exports include added assets. `test_component_library.cjs` covers all models, restoration, drag/drop, support heights, filtering, persistence and exports.
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

Longer sweeps extend the timeline. Bag loading, vacuum changes, placement and exports use the selected route's event times. Disabling the J1 preference restores straight transfers; the bag-tilt check stays active. Optional world collision checks are described below. Search results otherwise remain kinematic checks without suction-strength, payload dynamics or Nova-5 speed validation.

**Preview flow** animates approach, single-bag pickup, transfer to the fixed cups, opening, a loading pause, release of fixed vacuum, carrying to the front table, placement and robot-vacuum release. Use the timeline to inspect each stage. The moving robot uses solved joint rotations, and the bag follows its tool contact point. Choose **Bread loading** to insert the coordinated bread-robot sequence described below, or retain the illustrative magic-bread loading mode.

In magic mode, the default bread placeholder is 10.2 × 9.4 cm, exceeding the bag's 15 × 9 cm opening in depth. The panel flags this; the bun stays above the opening during the loading pause until its dimensions fit. Choose the reference shelf in Flow or change that shelf's bread dimensions in Properties.

IK runs in a Web Worker using damped least-squares with deterministic restarts, six URDF joint limits and full tool orientation. Pose tolerances are 1 mm and 1 degree. The connecting path is solved at 12 samples/second; a failed pose or discontinuous joint step blocks full playback. No-solution results are numerical search failures, not a mathematical proof of impossibility. Optional oriented-box world collision checks include held payloads; detailed mesh collision, self-collision, controller trajectories, joint speeds, suction strength and flexible-bag behaviour are not validated.

When a path stops, the Flow panel distinguishes **IK did not converge** from **Joint-step guard stopped the path**. It reports the exact phase, time, segment/sample, requested tool contact point, position and orientation errors versus tolerance, and joint angles close to URDF limits. Limit proximity is evidence, not a proven cause. If continuation IK fails, a separate multi-start search checks that same pose; finding an independent solution does not splice it into the path or claim a continuous connection. The 0.5-radian (28.65°) per-sample guard is a preview continuity heuristic, not a hardware speed limit.

**Locate failure · show last valid pose** marks the requested point with a red × in both views, shows the last valid robot posture, and adds a 3D arrow for the requested tool-face direction. The partial teal path ends at the last accepted sample. Coordinates show the requested suction contact point, not the robot base or bag centre; Z is height above the floor. Diagnostic joint details and full target orientation are retained in the exported report. Failed attempts are never played as valid robot motion.

**Export IK report** downloads the input layout, target definitions, sampled results and joint path. SVG/JSON retain components and workflow settings; GLB/PNG include visible current geometry, including a paused preview. These are not controller-ready programs. Stop/reset the preview before exporting the static layout.

Implementation lives in editor/bag-workflow.js, flow-geometry.js, flow-player.js, ik-core.js and ik-worker.js. prepare_nova_suction.py builds the neutral rig, joint metadata and legacy cart asset; nova_suction.py builds the tool. To regenerate the rig, run from the repository root:

    & .\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe --background --python-exit-code 1 --python .\design\coffee_bar_3d\prepare_nova_suction.py

test_suction_workflow.cjs verifies tool dimensions, cup count, URDF/model agreement, path limits, unreachable edits, table support propagation, drawn zones, bread fit, exports, persistence and revision-5 migration. Results are in output/suction-workflow-test-report.json. The former live ME6 station test describes the previous source layout; the standalone ME6 proposal has its own checks.

Copy/paste behavior is covered by test_clipboard.cjs, including nested groups, mounted equipment, custom suction models, text fields, exports, undo/redo and persistence.

Bag motion and longer-route playback are covered by test_bag_motion.cjs. The diagnostic test switches to straight transfers to preserve the original 8 cm lift failure case.

Placement containment, support assignment, live boundary diagnostics and playback gating are covered by test_placement_validation.cjs, including rotated and flush-edge cases.

## Customer barrier and ordering frontage

The frontage has two independently editable objects. **Ordering barrier / Left work counter** is mounted along the outside long edge of the named Left work counter, opposite Atom-W. Its tablet, combined mic/speaker and instructions face customers outside the robot area; the 1.70 m human reference stands at this ordering position. **Pickup barrier / coffee table** retains the existing pickup aperture beside the coffee robot. Its 44 × 42 cm opening starts flush with the worktop. Both barriers start at 80 cm above their 90 cm supports, with their tops at 170 cm.

Width, depth, height, support and rotation are editable. The **Customer barrier** section controls which front/side panels are present, plastic thickness, frame width and opacity. **Sections in this wall** independently enables the pickup opening, tablet and mic/speaker. The instructions panel has its own visibility toggle. Each pickup, tablet, combined mic/speaker and instructions section has independent panel and placement controls. The pickup opening also has clear width and height controls; the tablet and flyer have their own dimensions. Bottom heights are relative to the wall base. Offset zero is the panel centre; positive offsets run right along the front or toward the back along the right side. Section positions and sizes are clamped to their panel; overlapping devices are flagged in Properties. Instructions can be hidden.

**Align with placement zone** moves the aperture along its selected panel as close to the active Flow placement rectangle as the frame permits. It does not move the placement rectangle or the robot's IK target. The barrier follows counter movement, rotation, height and visibility; its panel spans are separately adjustable. Copying a counter includes its barrier. Additional barriers can be added from **Library → Customer barrier**. Panel names use local wall coordinates: the ordering barrier is rotated 180° relative to the Left work counter, so its local right panel occupies the counter’s outer left edge and faces away from the robot area.

SVG and JSON preserve the editable wall settings and named plan sections. GLB includes the current transparent geometry, open aperture, embedded tablet, mic/speaker and flyer textures. Blender source generation includes the same physical sections through customer_barrier.py. Revision 7 introduced the original barrier. Revision 8 moves its ordering controls onto a separate barrier on the Left work counter, retaining the pickup opening’s exact position, size and orientation, and leaving the placement zone unchanged. It also relocates the customer reference and removes the superseded freestanding terminal from the coffee counter. The migration uses saved counter dimensions and poses, runs once, and respects deleted barriers in later saves.

The barrier's empty interior is excluded from the simple placement-footprint overlap check. The optional world-collision checker uses separate solid-part boxes for the barrier and equipment; it does not perform detailed triangle-mesh collision. test_customer_barrier.cjs checks actual aperture raycasts, live controls, unit conversion, migration, support transforms, visibility, copy/delete/undo and SVG/GLB round trips.

## Dragging one dimension

Select a component in the 2D plan and drag the handle at the middle of an edge. Left/right edge handles change only width; top/bottom handles change only depth. These axes rotate with the component. Click **Resize settings** above the views, or use **Resize settings** directly below the selected object's name in Properties. **Resize behaviour** defaults to **Keep opposite side fixed**: edge handles fix the opposite edge, and corner handles fix the opposite corner. **Resize around centre** grows/shrinks both sides equally. The gold dot during dragging marks the fixed point. This also works on rotated components and groups. **Keep child objects in place** is enabled by default: mounted descendants that are not themselves selected retain their room X/Y positions and sizes while the support's boundary changes, including the translation from anchoring an edge. Uncheck it for the previous behavior where resizing repositions supported equipment. Explicitly selected objects and members of a selected group still transform together. Height changes keep equipment mounted at the tabletop height. Moving/rotating the support normally still carries its equipment. For numeric Width/Depth edits, choose **Width field keeps** (left/right) and **Depth field keeps** (top/bottom). Those edge names follow the object's rotation. The preference persists with autosave, snapshots and SVG/JSON exports. Corner handles resize both dimensions; Shift constrains proportions for corners. Edge handles remain single-axis even with Shift held. Alt temporarily disables snapping. Robot and circular dispenser models retain proportional corner scaling. Undo restores the entire drag.


## Inclined ordering console

The ordering barrier now has a shared white housing that projects toward the customer. The tablet and mic/speaker sit flush on its inclined face; the instructions remain on the window. In **Customer barrier**, adjust **Projection**, **Incline**, **Base** and **Front lip height**, or switch off the console to return to a flat mounting. Defaults are 30 cm projection, 40 degrees from horizontal, and a 4.5 cm front lip. Tablet/intercom bottom offsets measure upward along the inclined face when this is enabled. SVG includes the projecting footprint and GLB/Blender include the wedge, controls and continuous plastic behind it.

## Coordinated bread loading

Open **Flow → Bread loading → Pick with bread Nova-5**. Choose any tongs Nova-5, including copied robots. Choose a specific rack or **Nearest visible rack to selected robot**. The planner tries the front row of each tier, nearest the arm first, and reports the tier and column of the first complete successful path. **Pre-pick position** supports a signed across/height offset and setback relative to each bun, or a fixed X/Y/Z point relative to the rack centre/base. Rack-local X runs across the rack and negative Y is in front; the point follows rack movement and rotation. **Show pre-pick pose** previews the nearest candidate with solvable pre-pick IK (or the nearest failed target) with a green start marker, amber bun marker and approach arrow. **Use displayed tool position** captures the currently shown TCP as a fixed rack-relative point. Previewing a pre-pick pose alone does not validate the grasp or full route. It searches two initial postures and three lift clearances for each candidate bun. Shelf movement, slope, tier spacing, bread dimensions, support elevation, and robot scale all feed into the targets.

There are two Nova pickup methods:

- **Pre-pick → aim in place → tool +Z**: move to a pre-pick TCP, rotate about that same TCP to aim +Z at the bun, then approach in a straight line. The shortest-arc rotation follows the convention in bun-coordinate-server/core/aim_math.py. Detection is represented by the known ellipsoid centre; no camera or server connection is used.
- **Direct IK → tong contact**: approach the bun with a solved grasp orientation, without the extra in-place aiming stage.

The tong arm closes around the bun's thickness, lifts, withdraws from the rack, turns its jaws downward above the bag, and lowers vertically. It releases the bun, lets it settle, then withdraws vertically. The selected shelf bun follows the solved TCP after pickup instead of spawning a second bun. Reset and backwards scrubbing restore it on the rack.

The bag arm keeps its TCP fixed and both vacuums active during insertion, settling and tong withdrawal. Only after the tongs withdraw does the fixed vacuum release and the bag arm resume its placement path. With **Overlap bag opening + bread pickup** off (the default for existing layouts), bread picking starts after the bag opens. Turn it on in **Bread loading** to start both robots together: the bread arm waits at its above-bag pose if it arrives before opening finishes, and the bag arm waits if bread takes longer. The panel reports bag-ready and tongs-clear times, plus the serial waiting removed by overlap. Moving segments keep their original speed and path; only stationary waits change. Enabled Nova-5 pair checks validate the new shared timeline, and unresolved overlaps still block playback. This is illustrated timing, not measured hardware cycle time.

The same toggle is available in **Combined order → Bread loading**, with that panel’s separately saved bread settings. JSON, SVG, autosave and snapshots retain it. Failed-prefix previews respect the same gates and stop both concurrent tracks at the first individual failure. `editor/packing-timeline.js` coordinates the two solved routes. `test_parallel_packing.cjs` checks early/late arrivals, unchanged joint paths, fixed-suction release, failed prefixes, simultaneous rendering, combined orders, persistence, and enabled collision checks on the supplied layout.

A bun enters on its edge: the opening must fit Length 1 across its width and the bun's thickness across its depth. Length 2 becomes the vertical dimension. The fit check reserves 4 mm total clearance. Thus the default 10.2 × 9.4 × 6.2 cm ellipsoid fits the 15 × 9 cm opening in this orientation. This does not validate bag deformation or collision clearance for the jaws.

The neutral animated rig is exported from the Nova-5 + Lebai-tongs URDF. The grasp TCP is 30 mm behind its 328.3 mm flange-to-tip planning frame. Both pickup methods use all six arm joints and their URDF limits; tong mimic joints follow the same model. The measured opening at the grasp plane is about 6.85 cm at full size. Side gripping is the default: the jaws close across bread Length 1, requiring another 2 mm of clearance. The default 10.2 cm-wide bun does not fit these actual tongs for a side grip; reduce Length 1 or model a wider gripper. A legacy top/bottom grip remains selectable and checks the bread thickness instead. Scaled robots use the correspondingly scaled opening. Bread failures identify the robot, phase, target position, IK residuals and last valid pose separately from bag-arm failures. **Locate failure** and the exported IK report retain that distinction.

**Magic · bread falls from sky** retains the previous preview. **Atom-W** is shown as a future option and cannot be selected. Current layouts keep magic mode until Nova pickup is selected. Settings persist through autosave and SVG/JSON export/import; GLB/PNG capture current visible geometry, including a paused two-arm preview.

This is geometric grasp and kinematic path planning. It does not simulate cameras, gripping force, bread deformation, vacuum reliability or a controller's speed/acceleration limits. Optional world collision checking includes shelf/table parts and held bread. The separate Nova-5 pair toggle checks the synchronized bread and suction arms. A successful path is not a hardware execution approval.

Rebuild the articulated tongs asset from the repository root:

    & .\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe --background --python-exit-code 1 --python .\design\coffee_bar_3d\prepare_nova_bread.py

The implementation is split across editor/bread-geometry.js, bread-flow.js, bread-render.js and bread-ui.js. test_bread_flow.cjs covers both methods, URDF/render agreement, aiming and insertion direction, two-arm timing, real mesh removal/restoration, robot/rack selection, unreachable inputs, persistence and exports.


## Nova-2 beverage flow

Open **Flow → Coffee & drinks**, choose coffee or milk tea and hot or cold, then click **Place demo order**. Sugar, milk and cold-drink ice preferences appear in the simulated device messages. Preview, pause, reset and the timeline let you inspect each step. The direct URL is viewer.html?workflow=coffee.

Hot drinks use a paper cup and paper lid. The robot parks the lidded cup on the small stamping rest, slides its prong away, turns the opposite stamper downward, presses the lid, then turns back and retrieves the cup. Cold drinks use the plastic cup dispenser, optional ice and plastic lid applicator. Both finish in the separately editable Beverage pickup rectangle. Machine messages and fill completion are simulated; nothing is sent to hardware.

The Nova-2 has its existing 85 mm inside-diameter circular prong and an opposite printed truncated-cone stamper fitted directly over the back of the Link5 wrist housing. The provisional stamp is 85 mm long, widening from 79 mm at its root to an 88 mm pressing face. Its 73 mm mounting opening has a 22 mm-deep blind socket; there is no black offset bracket. The pressing centre is coaxial with the flange, about 218 mm behind it, and stays fixed to the wrist when joint6 rotates the cup prong. This contact frame and the prong's 70 mm flange-to-cup-centre offset are included in the pose calculations. These illustrative stamp dimensions are in scene_config.json under tools.nova2 and can be regenerated.

Machine service targets put the cup rim at 25% of machine height, measured above the supporting table. The cup stays just outside the front face. The milk-tea outlet uses the nearer front quarter of the machine. Cup and paper-lid dispensers instead use the actual bottom clearance: the rim sits 12 mm below the cylinder. Service height, approach clearance, transfer lift and filling time are adjustable in the coffee panel. Equipment selectors let you assign a different Nova-2, dispenser, machine, stamping rest or pickup area. Move these objects with the normal editor controls to rebuild the preview.

The sequence uses fixed stages with URDF IK at the taught targets, Cartesian local approaches and joint transfers between stations. Wrist compensation keeps a held cup upright. The coffee solver checks joint limits with 5 mm position and 3 degree orientation tolerances. A failed preview reports the phase, time, requested flange position and residual error; Locate failure shows the last accepted posture. This is an illustration with optional world collision checking, without liquid/spill, force, acceleration or controller-dynamics simulation.

Saved layouts receive a plastic cup dispenser, stamping rest and drink pickup rectangle once. Later saves respect fixture deletion. Workflow choices persist in autosave and SVG/JSON exports; GLB/PNG include the current cup and stamper geometry. **Export coffee sequence** includes the layout, order preferences, simulated events and computed path.

Regenerate the articulated Nova-2 asset from the repository root:

    & .\.local\blender-runtime\blender-4.5.14-windows-x64\blender.exe --background --python-exit-code 1 --python .\design\coffee_bar_3d\prepare_nova2_coffee.py

The implementation is in editor/coffee-geometry.js, coffee-solver.js, coffee-worker.js, coffee-player.js, coffee-ui.js and coffee-workflow.js. test_coffee_flow.cjs checks all four drink/temperature branches, dispenser routing, preferences, actual model/TCP agreement, upright transfers, stamping and regripping, unreachable inputs, migration, persistence and exports.


## Combined bread and beverage orders

Open **Flow → Combined order**, or viewer.html?workflow=order. Choose the drink preferences and bread pickup method, robot and rack, then click **Place combined order**. The combined panel defaults to Nova-5 bread pickup. Its bread choices are saved separately from the individual packing preview; packing equipment, bag dimensions and clearances come from Bread & bags. Beverage preferences and equipment are shared with Coffee & drinks.

The order checks both complete routes before starting either one. The bag check includes the tong robot's bread pickup and loading step. A shared clock starts packing and beverages together, and supports pause, reset and scrubbing. The shorter flow stays at its completed pickup position while the other finishes. Each track shows its current phase and completion status. Layout edits cancel pending checks, stop any preview and require revalidation; failed checks identify the affected track and phase. The Nova-5 pair toggle checks the two packing robots on their shared timeline. Coffee-to-packing robot collisions remain outside the checker.

Under **Camera & video**, orbit/zoom the 3D scene or use **Frame both**. **Save this POV** remembers the current camera in the editable scene; **Restore saved POV** returns to it. Camera and resolution changes do not invalidate robot routes. SVG/JSON and scene snapshots retain this saved camera.

**Record full order from this view** restarts both validated flows at time zero and records the entire order at 30 fps. Choose 720p or 1080p. A separate renderer uses a fixed copy of the chosen camera, so window resizing and later UI camera movement cannot change the recorded view. The entire chosen frame is retained, with letterboxing when its aspect ratio differs from 16:9. Video contains the 3D scene only, without controls or audio.

Recording finishes automatically when both tracks finish. **Save video** downloads WebM, or MP4 if that is the browser's supported fallback. **Stop recording** retains a partial video. A layout edit, leaving the combined workflow or hiding the app stops the recording; a completed partial recording can still be saved. Keep the viewer visible while recording. Video blobs are temporary and are not retained across a page reload, so download a recording before refreshing.

The implementation is in editor/order-workflow.js, order-ui.js and order-recorder.js. test_combined_order.cjs checks synchronized playback and completion, gating and cancellation, fixed-camera 720p/1080p recording, actual video decoding/downloading, partial recordings, and snapshot persistence.

## Named scene snapshots

Use **Snapshots** in the top bar. Enter a name and optional description, then **Save current scene**. Each entry contains the complete editable layout, hidden objects, dimensions, workflow choices, editor options, selected objects, the current camera viewpoint, and a thumbnail. It records the layout and settings, not a running animation or computed IK cache.

**Restore** applies the snapshot and returns to its camera; running previews stop and routes must be checked again. Restoring the layout participates in the usual Undo history. **Delete** removes an entry, and **Undo deletion** recovers the most recently deleted entry while the page remains open. Snapshot names/descriptions are treated as plain text.

Snapshots persist in this browser independently of the current scene autosave. **Export snapshots** downloads a JSON backup of the library. **Import snapshots** adds entries from such a backup without replacing the current library or automatically restoring a scene. Save backups before clearing browser data or moving to another browser. A storage-full error leaves existing entries intact.

Snapshot code is in editor/scene-snapshots.js. The combined-order test covers names/descriptions, camera/layout restoration, stale-preview invalidation, reload persistence, deletion undo, backup/import, and storage-full handling.


## Nova-2 end-effector speed

**Maximum end-effector speed** defaults to **1.5 m/s**. Change it in Coffee & drinks → Service poses & timing, or in the Combined order drink settings. It caps linear speed at both the cup-prong centre and the wrist-mounted stamper contact point. It is not a joint angular-speed or acceleration limit.

The planner keeps the solved joint path and stretches only stages that exceed the limit. Each affected stage is slowed uniformly, preserving its motion profile; stationary dispensing and pressing waits keep their configured duration. Speed is evaluated along the player's joint interpolation using forward-kinematic velocities, with a conservative bound between samples rather than only endpoint distances.

Tool poses, cup/lid events, machine messages and the timeline all use the retimed route. The combined order runs until the longer retimed track finishes, and recording follows that complete timeline. Settings persist through autosave, SVG/JSON and snapshots. The coffee sequence report includes the original duration, retimed duration, speed bound and each stage's stretch factor.

The retiming implementation is in editor/coffee-timing.js. test_coffee_speed.cjs measures tool speed between rendered samples across all four drink/temperature combinations, checks unchanged joint paths and dwell durations, lid stamping and event synchronization, slower configured limits, combined playback and persistence.

## Optional world collisions

Open **Collisions** above the viewports and enable **Avoid world collisions**, then choose the individual Nova checkboxes underneath. Each scene instance (including copies) has its own setting, identified by its label and layer ID. Uncheck a robot to skip its world checks and obstacle detours; its arm, tool and held objects follow the same setting. The master switch turns all world checks off without discarding these choices. Existing scenes and new robot IDs default to checked. The **Nova-5 ↔ Nova-5** switch remains independent, even with world checks disabled for one or both arms. Recheck or place an order after changing these settings. Packing and combined-order panels show separate **Nova-5 suction** and **Nova-5 bread** route results, including disabled, pending, blocked, incomplete and fully checked states. A bun that is too wide still receives a starting-pose collision check; its unfinished route is never marked clear. **Check all Nova arm/tool poses** checks the currently displayed arms and tools (including visible copies) independently of the route toggle. This one-shot inspection does not enable route blocking or validate held items and motion; those are checked by the flow. It starts disabled for existing scenes. The master and per-robot choices, clearance (−2 to +5 cm), detour-search toggle and search budget are saved in scene JSON, SVG metadata, local autosave and named snapshots. Changing geometry, visibility or the collision policy invalidates checked routes.

The Nova-2 and both Nova-5 variants use oriented boxes around each loaded mesh part, following the same articulated rig as the viewer. A gripped cup, bag or bun is attached to the tool as an additional collision shape for the duration of the grasp. Bag depth follows the opening stroke; the filled bag's envelope contains its bun. Cup envelopes include lid clearance. Payload dimensions do not scale when resizing the robot.

Visible furniture and equipment use separate solid-part boxes: sloped rack bases, dividers, posts, dispenser housings, supports, worktops, legs, customer panels around the pickup aperture, and fixture hardware. This preserves shelf and dispenser gaps. Hidden objects and every other robot are excluded. Unheld consumables, decorative lettering, robot self-collision, fluids and deformable-contact physics are outside this checker.

Collision checking covers the joint interpolation actually used by playback. A conservative bound on each part's travel allows clear intervals to pass; possible intersections are recursively subdivided. If less than 0.5 mm of unresolved travel remains, the interval is rejected with an **Insufficient collision clearance** diagnostic instead of being silently accepted. A detected overlap also blocks the route. Both messages identify the robot link or held item, world object/part, phase and time. **Locate collision** displays the rejected pose and orange/red collision solids.

The planners still try posture, sweep, lift and approach candidates. With **Search obstacle detours** enabled (default), a blocked free transfer additionally runs deterministic bidirectional RRT-Connect in six-joint space. Each accepted edge passes the same swept arm, tool and held-object collision checks used for playback. Cup and bag transfers retain their upright constraints, and bag transfers retain the selected minimum J1 share. Successful detours replace the original motion and extend the timeline; the Nova-2 end-effector speed limit is reapplied. Precise contact strokes such as grabbing, opening a bag, stamping, shelf extraction and vertical placement retain their constrained motion.

The search budget defaults to 600 node expansions, shared across candidate routes for each robot; it is configurable from 100 to 3000. Diagnostics distinguish an overlapping start, overlapping goal, endpoint IK failure, protected contact motion, disabled search and exhausted search budget. Budget exhaustion means no route was found in this search, not proof that none exists. Failed routes still block full playback and combined-order recording; the accepted prefix can be inspected using the diagnostic preview described below.

Negative clearance permits a small overlap of the proxy solids: for example **−0.3 cm** permits 3 mm clipping, while zero disallows overlap and a positive margin requires a gap. This relaxation applies to the held object as well as the arm and tool. It is a geometric approximation, not a change to the rendered dimensions.

Intentional contact is narrowly scoped: the fixed base may rest on its mounting surface; held items receive a 1.5 mm contact tolerance at their named tray/table/fixture receiving surfaces. Cup contact with its locating rim is permitted only above its supporting base. Arm and tool links are still tested against the same furniture. Boxes can reject a tight path that detailed geometry would allow, so use **Show collision shapes** to inspect the approximation.

**Check all Nova arm/tool poses** checks the displayed Nova arm/tool postures. Route checks additionally include the held object and all intervening motion. Inspection overlays are outside the physical scene exported to GLB; SVG and 3D exports remain available.

### Nova-5 pair collisions

Enable **Collisions → Nova-5 ↔ Nova-5 collisions** to check the selected suction and bread robots against each other. This is independent of the world toggle and shares its signed clearance. It checks both moving poses at the same time, including motion between animation frames, grippers, held bread, bag walls and the bun inside a loaded bag. The bag uses five thin walls with an open top so inserting bread into the empty interior is allowed. In magic mode the selected bread Nova-5 is checked at its stored stationary posture. **Check Nova-5 pair poses** inspects just the currently displayed arms/tools; the flow validates held objects and motion.

Pair failures name both robots and intersecting parts, with the shared timeline time. **Locate collision · show both robots** displays the rejected poses and solids. If the failure is during a free suction transfer after the bread robot has stopped, **Search obstacle detours** can search around its final geometry. It tries fresh budgets of at least 1200 and 2400 expansions (respecting larger configured budgets, capped at 4800). Upright/J1 constraints, process endpoints and world collisions remain enforced, and the entire synchronized path is rechecked before accepting the detour. Contact strokes and simultaneous two-arm replanning are not replaced or rescheduled; unresolved conflicts remain blocked.

### Inspecting a failed route

**Preview to failure** animates only the accepted prefix and enables scrubbing up to its last accepted pose. It does not mark the route valid. The rejected target remains marked separately; use **Locate failure/collision** to inspect it. Pair failures stop before the first rejected synchronized interval. If bread pickup fails, sequential mode opens and holds the bag while the accepted bread motion plays. Concurrent mode plays both accepted prefixes on the shared schedule and stops when either one fails. No synthetic bread is dropped in its place. The coffee prefix retains the configured end-effector speed cap, so its inspection clock can be longer than the original failure report's route time.

The combined-order panel offers **Inspect failed motion ↗** on failed routes. It opens that route's diagnostics and partial preview; full order playback and recording still require every route to pass. Reset restores the static scene. All existing scene/SVG/3D exports remain available.

Coffee diagnostics distinguish IK, joint continuity and collision failures and show the phase, target, residuals versus tolerances, and search outcome. **Route alternatives checked** lists the configured route and level-withdrawal alternatives at the original and increased clearances. Free transfers can search after IK/continuity failures as well as collisions. A longer route cannot fix an endpoint for which IK has not found a valid pose, or a required contact pose that overlaps equipment. No objects are automatically repositioned.

Regression checks: test_robot_collision_policy.cjs checks per-instance world toggles, arm/tool/payload policy, independent pair checks, copies, undo and persistence. test_nova_pair_collision.cjs checks synchronized sweeps, independent toggles, negative clearance and hollow/loaded bag geometry. test_failure_preview.cjs reproduces fixtures/collision-layout-regression.json, verifies the Nova-5 recovery and partial coffee/bread/pair playback, and checks combined-order inspection and gating. test_coffee_path_recovery.cjs covers an IK failure recovered through obstacle search and an unreachable endpoint retaining its original reason. test_motion_search.cjs checks genuine detours around an obstructed direct path, negative clearance, failure statuses, timing/speed preservation, side gripping, pre-pick preview/capture and persistence. test_collisions.cjs covers oriented boxes, thin-obstacle sweeps, held-item-only collisions, rig/mesh agreement, shelf/dispenser gaps, hidden equipment, all Nova planners, cold drinks, route gating and the toggle. Existing beverage speed, bread and combined-order/video/snapshot checks also remain applicable.


## Beverage Nova-5 and the floor-tea proposal

The Library now includes **Nova-5 beverages**, with the 85 mm cup prong and the directly wrist-mounted lid stamper. Select it as the **Beverage robot** in Coffee & drinks or Combined order. This variant uses Nova-5 URDF joint geometry; Nova-2, bread tongs and bag suction remain separate choices. World collision controls, held-cup checks, reach overlays and SVG/GLB exports support the new variant.

`layouts/coffee-bar-nova5-floor-tea.json` adapts the supplied October scene to an L-shaped beverage counter and the 600 x 700 x 1520 mm floor tea machine. Reload the viewer, then import this JSON. Its two counter sections, equipment positions and robot are independently editable. It preserves the source packing area and customer frontage.

The tea machine's `service_approach` sets `yaw_offset_deg: 0`, `clearance: 0.23`, `level_exit: true` and `linear_contact: true`. These make the cup enter from the front and withdraw level before lifting. Other machines keep their existing approach behavior unless explicitly configured. The proposed outlet height is an estimate, pending actual machine dimensions.

The four drink/temperature sequences pass IK with the saved beverage-world checks disabled, using a 20 cm general clearance, 28 cm lift and 1.5 m/s tool-speed cap. Collision-enabled route search still stops at **Move clear / coffee outlet**, where the arm's Link2 proxy meets the milk fridge. This is an editable planning proposal, not a fully collision-free cell. The delivered JSON preserves the source's individual collision settings.

`prepare_nova5_coffee.py` builds the separate GLB and kinematics; `test_nova5_beverage.cjs` checks import, supported footprints, URDF/model TCP agreement, all four IK routes, speed, actual workflow selection and SVG/GLB export. The existing Nova-2 beverage regression remains applicable.
