# Source contracts and real adapter boundaries

The sources were read without executing their hardware code. `aio_atom-w_gui` was clean on `movement-planner` at `574d9ca0b79e991531c327ff26c973e8130af4ca`. `AtomW-VLA` was clean on `andy/lift-ff-wip` at `2b3793519edcfddcc7882d803bfb682f9c6ea30b`. Paths below are relative to the named source repository at `D:/Work/FPS/Robotics/`.

## AMR navigation

`aio_atom-w_gui/amr_api.py:128` creates CycloneDDS readers/writers for `rt/amr/state` and `rt/amr/cmd`. `AmrApi.move_to_tag` at line 170 sends a generated `AMRCommand_` with `command_type=MOVE_TO_TAG`, integer `target_id`, degree `theta`, zero `linear_vel`/`angular_vel`, incrementing uint32 `command_id` and wall-clock microsecond `timestamp`. `cancel_task` at line 188 sends `CANCEL_TASK` with zero target, velocities and theta.

The command and state structures are in `atom/robot_control_dds/dobot_atom/msg/dds_/_amr_cmd.py` and `_amr_state.py`. State includes navigation status and `task_id`. `AmrSequenceWorker` at `amr_api.py:319` waits up to 10 seconds for `RUNNING`, resends every 3 seconds, polls every 250 milliseconds and allows 300 seconds for completion. It recognizes `COMPLETED`, `FAILED` and `CANCELED`.

The worker does not correlate the returned command ID or enforce state freshness. Each resend creates a new command ID. Cancellation publishes a command and stops the local worker without waiting for chassis cancellation. A real harness adapter therefore needs a verified mapping from an execution to fresh chassis evidence; global `COMPLETED` alone cannot reconcile a possibly sent command.

Saved UI plans resolve tag names into `{name, tag_id, theta}` at `tab_amr.py:340`. Simulator tags deliberately remain separate configuration, marked as placeholders.

## Humanoid posture and hand commands

`aio_atom-w_gui/humanoid_mover.py:1603` exposes `HumanoidMover.move_subset(target, move_time_sec=0.5, endpoint_correction=False, max_joint_speed_rad_s=None, deadline_s=None) -> Result`. `target` is a sparse dictionary of named joints in radians; omitted joints retain setpoints. Lift keys are rejected and require a separate adapter action.

`move_hands_only(target, move_time_sec=0.5) -> Result` at line 1545 sends sparse hand targets in radians through a 100 Hz interpolation loop. `Result` provides `is_ok`, `data` and `message`, without execution identity. `cancel_event` is local and cooperative between servo ticks (`humanoid_mover.py:520`). Success means the send loop finished, not that measured position or release was confirmed.

`atom/robot_upper_control.py:528` exposes `command_joint_state(left7, right7, left_hand6, right_hand6, head2, torso=...)`. It publishes `rt/upper/cmd` with 17 positions ordered torso, left arm, right arm, head, and `rt/hands/cmd` with 12 hand positions ordered **right then left**. It returns `1` after sending. Do not confuse that wire order with the command API's left-first hand arguments or with the VLA vector layout.

The UI's pose replay and hand workers call these methods and return bool/message (`pick_place_workers.py`; `tab_pick_place.py:5171`). Some Cartesian steps compare measured FK after settling (`tab_pick_place.py:5693`); taught poses and blind grip can succeed after transmission without equivalent verification (`:5893`). A real adapter must define what measured condition establishes each terminal outcome.

## Separate lift and torso route

`aio_atom-w_gui/torso_lift_pose_api.py:64` exposes `TorsoLiftPoseApi.connect(urdf_path) -> Result[TorsoLiftPoseApi]`. Its `execute_saved_route(teaching, cancel_event, countdown_s=5.0, direct=False) -> Result[dict]` at line 343 executes taught torso/J1/J2/J3 radian targets or explicitly selected direct interpolation. It enforces a minimum five-second countdown, fresh healthy telemetry, external-motion idle checks and a local run lock.

The lower command is `UpperControl.command_lift_vel_state(lift_state, lift_vel, kp=800, kd=40, tau=None)` in `atom/robot_upper_control.py:785`, publishing three lower motor positions/velocities and gains on `rt/lower/cmd`. Do not route these through `HumanoidMover.move_subset`.

Unlike the ordinary posture send loop, `torso_lift_endpoint.settle_and_correct` checks measured four-axis position/velocity with tolerance/dwell and up to three corrective passes (`torso_lift_endpoint.py:136`). The result report includes reference, measured position, velocity, residual, passes, offset, convergence and reason. Cancellation after lower writes attempts a guarded measured-position/zero-velocity hold (`torso_lift_pose_api.py:441`). A real adapter should retain these guards and measured success criteria.

## VLA inference and actuation

There is no separate VLA client wrapper in the reviewed aio tree. The relevant policy execution code is in `AtomW-VLA/atomw_vla/deploy/`.

`run_inference.py:166` selects local policy, OpenPI WebSocket or generic `RemotePolicy`. `serving/policy_client.py:18` exposes `get_action(observation, options) -> (chunk, info)`, `reset()` and `close()`. The observation includes measured `observation.state` as 28 float32 radian values plus profile camera images in uint8 H-by-W-by-3 form.

The 28-value layout is left arm 7, left hand 6, right arm 7, right hand 6, head 2 (`common/joints.py:7`). OpenPI repacks camera slots, `state` and optional `prompt`, and receives `actions` shaped `(horizon, 28|15|13)`, expanding reduced outputs against measured state (`serving/openpi_policy.py:92`). WebSocket sends a msgpack observation and receives one inference response (`third_party/openpi_client/src/openpi_client/websocket_client_policy.py:47`); the reviewed default is port 8000. Generic remote policy uses `multiprocessing.connection` TCP, default port 5555, with `("get_action", encoded_observation, options)` and `("ok", (action, info))` or `("err", traceback)`.

These transports return action chunks. They do not provide a pick-job acknowledgment, execution ID, running status, cancellation or terminal physical result. The harness VLA adapter must wrap policy inference, servo execution, stopping and physical verification into its own lifecycle.

`deploy/robot_server.py:268` also provides a JSON-lines TCP bridge (default port 8447). A call has shape `{"op":"command_joint_state","args":[left7_rad,right7_rad,left_hand6_rad,right_hand6_rad,head2_rad]}` and returns `{"ok":true,"ret":1}`. Client serialization is in `deploy/atom_w_robot.py:349`; socket timeout defaults to 30 seconds. There is no request ID or cancel operation. A timeout after sending can leave an unknown physical outcome.

`run_inference.py:338` performs the actuation loop, including arm-jump rejection/slow glide; `atom_w_robot.py:472` maps `command28`. Do not implement VLA by treating one inference response as a completed pick or by substituting a blocking movement command for the servo loop.

`GraspDetector.update(cmd28, meas28, hint) -> GraspState` in `grasp_detect.py:28` uses commanded-versus-measured stall across five closure joints of the active hand, excluding thumb rotation. Its defaults arm at 0.4 closure, require a 0.35-radian residual for ten ticks, and allow a high-confidence vision-empty veto. `TaskStateMachine.step` in `task_state_machine.py:53` consumes this evidence in GRAB and freezes the current command before HOLD_TRANSIT; that transition does not itself command a lift posture. Its PLACE completion checks commanded hand openness for fifteen ticks (`:118`), which does not prove physical release. The simulator's explicit world possession, lift-pose and counter-inventory checks are therefore additional verification boundaries required by the brief.

## Orchestration reference

`aio_atom-w_gui/pick_place_flow.py:1394` has a pure `PickPlaceRun` decision machine. `tab_pick_place.py:4884` constructs it; `_dispatch`, `_run_step` and `_report` at lines 5036-5123 connect decisions to hardware handlers and return `StepOutcome`. This supports separating orchestration from transport. Its local recipe/slot loop does not by itself implement the original platform/AMR/VLA pastry flow, and its outcomes do not carry durable physical execution identities.

## Recovery boundary

The new simulator's durable execution ledger is deliberately stronger than the reviewed real transports. It proves software recovery within the simulated world. Replacing an adapter requires establishing correlation, measured terminal conditions, stopped/cancelled evidence and a durable reconciliation strategy. If those facts are unavailable after a possible send, preserve the task and hold for operator resolution. Tags, poses, jolt recipe, lift verification, hand/policy selection and counter calibration remain hardware configuration work.
