# Replace a hardware stub

The controller depends on adapter contracts, not hardware transports. Keep execution identity, submit/status/cancel semantics and physical verification at that boundary when replacing a stub. The built-in adapters remain software-only; changing configuration cannot enable hardware.

`humanoid_harness/models.py` defines the injectable protocols: `AmrAdapter.submit_navigation`, `HumanoidMoverAdapter.submit_pose`, `LiftAdapter.submit_lift_route`, `VlaPickAdapter.submit_pick`, `PerceptionAdapter.observe`, and `PlatformAdapter.report_completion/get_report`. Action adapters also expose `get_execution` and `cancel_execution`. Route submission, status and cancellation through the same adapter instance.

Inject replacements through `Harness(..., amr=..., mover=..., lift=..., vla=..., perception=..., platform=...)` in `humanoid_harness/controller.py`. Keep the action lifecycle and result types in `models.py`. The simulator's private world is for simulation persistence and display; controller safety decisions must use the injected perception/status contracts.

The small wrapper files below provide intuitive action names: `move_to_tag`, `move_to_pose`, `execute_lift_route`, `pick`, and `check_bun_in_hand`. They delegate to the independent durable simulated-device implementation. Configuration currently supplies symbolic tags, pose names and policy IDs. A real adapter must resolve those references into the concrete source payloads below; this harness does not claim that a symbolic pose is already a hardware joint command.

| Injection area | Real entry point to wrap | Required verification before success |
| --- | --- | --- |
| `humanoid_harness/adapters/amr.py` | `aio_atom-w_gui/amr_api.py:170`, `AmrApi.move_to_tag`; cancellation at `:188` | Fresh navigation state tied to this execution/tag. Current global status and transport send alone are insufficient. |
| `humanoid_harness/adapters/humanoid_mover.py` | `aio_atom-w_gui/humanoid_mover.py:1603`, `HumanoidMover.move_subset`; hand-only at `:1545` | Appropriate measured posture, grip/release or other stage evidence. A successful interpolation/send loop alone is not a measured terminal result. |
| `humanoid_harness/adapters/lift.py` | `aio_atom-w_gui/torso_lift_pose_api.py:343`, `TorsoLiftPoseApi.execute_saved_route` | Preserve telemetry freshness, countdown, idle guard, measured convergence and guarded cancellation hold. Lift must not go through `move_subset`. |
| `humanoid_harness/adapters/vla.py` | `AtomW-VLA/atomw_vla/deploy/run_inference.py:166`, policy selection; `serving/policy_client.py:18`, `get_action`; actuation loop at `run_inference.py:338` | Wrap inference plus servo execution and stopping. An inference chunk is not a pick result. Verify lift posture and possession separately. |
| `humanoid_harness/adapters/perception.py` | `AtomW-VLA/atomw_vla/deploy/grasp_detect.py:28`, `GraspDetector.update`; suitable measured pose/depth verification | Define fresh and ambiguous outcomes for lift, held bun and delivered bun. Finger stall is grasp evidence; commanded openness is not proof of counter delivery. |
| `humanoid_harness/adapters/platform.py` | Reviewed `platform-client/hr_client/client.py:1775`, `_complete_task`, plus `resolve_completion_for_operator` and readback reconciliation; durable store in `hr_client/pending_completion.py` | Bind actual assignment identity to the whole per-pastry delivery result. Preserve accepted completion through missing acknowledgment and restart; do not reuse box-batch transport semantics. |

See [SOURCE_CONTRACTS.md](SOURCE_CONTRACTS.md) for exact source revisions, payloads, units, transports and limitations. The platform-client source above was reviewed in `C:/Users/andyl/.codex/worktrees/dfcb/platform-client`, not modified or imported by this harness. Its interfaces may move during the related recovery task, so recheck provenance before integration.

## Configuration to establish before a real adapter

Supply calibrated slot-to-tag mapping, tag heading in degrees, pre-pick/travel/pre-place named joint targets in radians, lift taught routes, hand/policy selection and four distinct counter targets. Keep a jolt disabled until a safe real recipe and conditions are defined. A symbolic simulation pose is not a valid hardware target.

Do not convert the simulation execution ID into a claim that firmware supports idempotency. The reviewed AMR command has an ID but its UI worker does not correlate it to status; mover and policy RPCs lack durable action IDs. A real adapter needs its own durable intent, suitable device evidence and reconciliation strategy. After a timeout or restart, a possibly executed action with insufficient evidence must hold instead of replaying.

The simulator demonstrates the controller's behavior under these contracts. It does not establish collision safety, calibrated reachability, stopping distance, policy quality, measured grasp/release reliability or real-world exactly-once execution.
