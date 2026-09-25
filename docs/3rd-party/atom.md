# Atom-W repositories

Read-only survey of the 2026-09-18 working copies. See [snapshot metadata](README.md). Statements below describe source behavior, not executed hardware or simulation tests.

## aio_atom-w_gui

The project supplies robot/AMR SDK wrappers, manual GUI controls, saved motion settings, and useful starting points for a future device adapter.

- [amr_api.py](../../../aio_atom-w_gui/amr_api.py), lines 44-107, stores named tags in JSON. Lines 121-200 send MOVE_TO_TAG/CANCEL_TASK; lines 279-359 execute manually assembled tag/theta plans with arrival waits.
- [tab_amr.py](../../../aio_atom-w_gui/tab_amr.py), lines 1-11, 45-60, and 91-145, exposes manual AMR plan construction through Qt.
- [app_settings.py](../../../aio_atom-w_gui/app_settings.py), lines 455-459, persists tag databases and named motion plans.
- [README.md](../../../aio_atom-w_gui/README.md), lines 4-22, describes a Windows IK/GUI environment without DDS/hardware access.

No automatic platform rack/level/slot-to-AMR-tag mapping was identified in this project. Existing manual tags and poses are candidate configuration inputs, not yet a validated source of autonomous workflow behavior. Reuse SDK wrappers while keeping a future headless orchestration layer independent of Qt widgets.

Last Mile provides more reusable detail than a simple depth-pixel count. [finger_gate.py](../../../aio_atom-w_gui/finger_gate.py), lines 1431-1727, evaluates depth-based finger geometry and debounces OBJECT_BETWEEN while treating invalid/obstructed frames as blocked. [last_mile_servo.py](../../../aio_atom-w_gui/last_mile_servo.py), lines 325-701, contains pose/arrival helpers; lines 706-968 contain a pure observation-driven servo state machine with loss, obstruction, divergence, distance, and time limits. The worker at lines 1072-1509 is device-bound. [tab_last_mile.py](../../../aio_atom-w_gui/tab_last_mile.py), lines 2635-2779 and 2908-2998, integrates RGB-D segmentation, pose construction, and arrival checks; lines 3149-3162 gate auto-close on GRASP READY. These pieces do not supply a complete lift/AMR/order sequence.

## AtomW-VLA

The repository contains policy deployment, robot/camera mocks, a DDS bridge, and Isaac Lab grab/place harnesses. These are substantial reusable pieces, but the platform ordering and AMR sequence is not integrated with the inference loop.

- [task_state_machine.py](../../../AtomW-VLA/atomw_vla/deploy/task_state_machine.py), lines 1-16 and 69-81, explicitly leaves order/SLAM events to external wiring. Its order_received()/arrived() hooks do not constitute a platform adapter.
- [run_inference.py](../../../AtomW-VLA/atomw_vla/deploy/run_inference.py), lines 34-102 and 360-438, starts robot/camera/policy inference without importing that task state machine or connecting an order/AMR adapter.
- [task_state_machine.py](../../../AtomW-VLA/atomw_vla/deploy/task_state_machine.py), lines 94-113, transitions to HOLD_TRANSIT after grasp detection. There is no commanded lift target, settling wait, or verified lift-pose condition on this transition. Lines 52-60 and 104-112 define a tick-based grab timeout and retries, without separate AMR recovery or differentiated collision/software-crash semantics.
- [grasp_detect.py](../../../AtomW-VLA/atomw_vla/deploy/grasp_detect.py), lines 1-14 and 28-75, uses commanded-versus-measured finger residual with an optional vision empty-hand veto. This is not the proposed depth-ROI check integrated into the workflow.
- [handcheck.py](../../../AtomW-VLA/atomw_vla/deploy/checks/handcheck.py), lines 1-49, is a manual per-channel motion check; it is not proof of bun presence.
- [atom_w_robot.py](../../../AtomW-VLA/atomw_vla/deploy/atom_w_robot.py), lines 267-325 and 430-465, supplies MockUpperControl, AtomWRobot.mock(), and a JSON/TCP DDS bridge. Lines 531-604 treat torso/lift outside the 28-dimensional policy state and restore an initial posture as a startup precondition.
- [run_inference.py](../../../AtomW-VLA/atomw_vla/deploy/run_inference.py), lines 59-82, supports a mock robot and mock cameras. Lines 377-450 stop on alarms/safety rejection, but do not implement the brief's operator rescue and resume workflow.
- The policy sidecar exposes ping/get_action/reset/shutdown in [policy_server.py](../../../AtomW-VLA/atomw_vla/deploy/serving/policy_server.py), lines 1-15 and 60-104, with a corresponding [policy_client.py](../../../AtomW-VLA/atomw_vla/deploy/serving/policy_client.py), lines 19-62. This transport does not define order, navigation, lift, or collision-result semantics.
- [base_harness.py](../../../AtomW-VLA/atomw_vla/sim/base_harness.py), lines 1-60, provides robot/cameras and policy state/action plumbing. [grab_harness.py](../../../AtomW-VLA/atomw_vla/sim/grab_harness.py), lines 128-138, uses bread centroid above the basket rim as a success metric; it does not verify a prescribed lift posture. [place_harness.py](../../../AtomW-VLA/atomw_vla/sim/place_harness.py), lines 1-60, models placement.
- [sim_rollout.py](../../../AtomW-VLA/atomw_vla/eval/sim_rollout.py), lines 1-64, evaluates policies headlessly in Isaac Sim. This is not an integrated platform/order/AMR simulator.

## Integration implications

The platform protocol client already exists in sibling `platform-client/hr_client`; do not build a second protocol client merely because neither robotics repository embeds it. The missing work is wiring that client to a coherent Atom-W controller and explicit robot, AMR, policy, and hand-check interfaces.

[hr_client/__main__.py](../../../platform-client/hr_client/__main__.py), lines 105-134, already composes LocationTable, RobotClaim, SimulatedHardware, and HumanoidRobotClient. [hardware.py](../../../platform-client/hr_client/hardware.py), lines 27-109 and 152-246, defines the device interface and scriptable simulation. [locations.py](../../../platform-client/hr_client/locations.py), lines 391-461, resolves slot/counter/box targets. The existing headless client and executor should be extended or composed, not duplicated.

The initial ordering simulator can script policy outcomes and mock robot/AMR devices while preserving the real platform protocol. Real VLA evaluation and Isaac physics are separate fidelity increments with substantially larger dependencies. A mock that perfectly tracks arm commands does not automatically provide credible grasp residuals or scene observations; those need an explicit simulation model.

Before implementation, establish the actual slot/tag map, starting and lift poses, selected hand/policy, safe AMR travel posture, counter/box placement poses, retry scopes, and operator reset behavior. Treat README deployment TODOs cautiously: some are stale because robot transport exists even though platform/navigation handoff remains absent.
