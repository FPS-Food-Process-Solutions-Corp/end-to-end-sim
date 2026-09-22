# Run the real-client humanoid integration

This composition connects the unchanged real platform-client to the humanoid simulator through `PickExecutor`. A real platform assigns each Rack B pastry; the simulated physical executor finishes navigation, picking and verified counter placement; the real client owns progress, completion/failure reporting, acknowledgment recovery and the next task.

It does not enable robot hardware. Tags, joint phases and counter targets remain symbolic. The standalone module and its 21 tests remain available through the [standalone runbook](../humanoid-harness/README.md).

## Runtime and composition

Use the existing Ubuntu-22.04 environment `/home/user/.venvs/end-to-end-sim-ros/bin/python`, which has the client's dependencies. No installation is required. The pinned real client source is `C:/Users/andyl/.codex/worktrees/dfcb/platform-client`; on WSL its path starts `/mnt/c/Users/andyl/`. Put that checkout and this worktree on `PYTHONPATH`.

The composition entry point is `python -m humanoid_harness.integration`. It requires a real-client settings file, a fresh integration state root, the pinned client source path, and distinct explicit local proxy/API URLs. The launcher selects `humanoid_robot`, forces WebSocket transport for Socket.IO and sends completion readback through the real client's direct API configuration.

Example inside WSL, after the sole runtime owner has prepared the fresh database, settings and services:

```bash
PYTHONPATH=/mnt/c/Users/andyl/.codex/worktrees/dfcb/platform-client:/mnt/c/Users/andyl/.codex/worktrees/f0cd/end-to-end-sim /home/user/.venvs/end-to-end-sim-ros/bin/python -m humanoid_harness.integration --client-source /mnt/c/Users/andyl/.codex/worktrees/dfcb/platform-client --settings /path/to/fresh/hr-settings.json --state-root /path/to/fresh/humanoid-state --url http://127.0.0.1:3122 --readback-url http://127.0.0.1:3121 --device-id humanoid_robot --stop-after-seconds 60
```

The `/path/to/fresh/` values are explicit placeholders, not existing fixtures. Do not point this launcher at a captured/live journal or another case's state root. Changing only an API URL on the standalone harness does not perform this integration.

## Public executor seam

`HumanoidPickExecutor` is exported by `humanoid_harness.integration`. Its constructor accepts a state root, an optional `config_factory(TaskContext)` and the explicit one-shot crash test option. Public methods are async `run(context, progress_cb)`, `recover_completed(client)` and `drain()`.

The launcher calls recovery before `client.run()`. A recovered exact placement is handed to the public `client.queue_recovered_completion(...)` method. Unknown physical ownership prevents new work. Shutdown drains or preserves a held worker before closing the client/device ownership; cancelling the coroutine alone does not release a running worker.

The assigned mode stops at physical completion and does not create or report through a `StubPlatform`, select another task, or command front-counter idle. Its task-ID registry rejects a changed session/order/counter or item/rack/level/slot for an existing task. Retry count is recorded as metadata and cannot authorize another pick of an already completed unit.

Known safe physical failure is reported through the real client with `ready_for_next=False`; the client remains PAUSED instead of repeatedly requesting and failing the same exhausted task. Unknown effects, collision and unresolved cancellation use the unresolved outcome. This version has no operator procedure to clear such physical holds.

## Counter mapping

The supplied real-client location file is preserved. In fresh copied settings, set `paths.poses` and `paths.locations` to absolute original client files; otherwise relative paths resolve beneath the new case directory. The launcher creates an immutable `simulation-locations.json` overlay in the integration state root, resolves existing trajectory references against their original directory and adds counter 4 with distinct symbolic `SIM_COUNTER_4` identity. Its generic `place_box` pose reference is only client-schema compatibility; the injected physical flow uses its own distinct symbolic counter targets. No taught/calibrated counter-4 coordinates or hardware movement are inferred.

## State and evidence

| Artifact | Meaning |
| --- | --- |
| `integration-manifest.json` | Loaded client module paths/hashes, source pin, endpoints, location overlay and recovered identities. |
| `task-identities.json` | Immutable task/session/order/counter and item/rack/level/slot registry, plus observed retry counts. |
| `device-owner.json` | Device-wide idle/active/hold ownership across task directories and restarts. |
| `assignments/<unit-digest>.json` | Saved assignment context and terminal physical proof. |
| `units/<unit-digest>/controller.json` | Per-unit durable controller intent, stage and result. |
| `units/<unit-digest>/device.json` | Independently persisted simulated action effects and world. |
| `units/<unit-digest>/events.jsonl`, `summary.json`, `world.html` | Per-unit progress, terminal physical result and world replay. |
| `pending-completions.json` | The real client's durable completion queue; do not edit it to force settlement. |

A normal or timed launcher stop returns 0; this means the process stopped normally, not that the order reached READY. Invalid configuration/source returns 2. The explicit integrated placement crash exits 76. Always verify actual platform order/task/session/stock state and exact simulator place counts alongside process status.

## Deterministic faults and restart

`--faults-json FILE` accepts a JSON mapping from exact platform task ID to the standalone simulator's fault-rule list. Create the order and obtain its actual task identities before writing the fixture; do not guess them. The real client still owns all task reports. See the [standalone fault table](../humanoid-harness/README.md) for stage/outcome definitions.

`--crash-after-place-once` exits after placement is durable but before executor proof/return and client completion queueing. Restart the same launcher with the same state root and unchanged assignment configuration. Startup must verify the saved place execution, queue its exact proof through the real client and avoid another physical action. The crash marker is durable and does not fire again for that fixture.

For acknowledgment loss, the sole runtime owner controls the existing Socket.IO fault proxy. Keep completion readback pointed directly at the API. Do not replace the real client's acknowledgment/reconnect/readback behavior with a local success flag.

## Ownership and limitations

The client task's Sol `/root/sol_combined_harness` is the sole shared runtime operator for this acceptance: API 3121, humanoid proxy 3122, optional Nova proxy 3123 and ROS domain 71. It prepares fresh `taska_20260922_humanoid_*` databases from the original seed, captures existing queue/inventory/counter state, owns processes and performs cleanup. This task's agents run only isolated local tests.

The seed contains historical business records; it must not be forcibly cleared to make a scenario pass. Known platform partial-order settlement, cancellation accounting and completion replay limits remain external constraints. The integration must expose their observed behavior rather than modify platform logic or manufacture READY.

Read [PLAN.md](PLAN.md) for stages/ownership and [CONTRACTS.md](CONTRACTS.md) for reviewed public interfaces and source provenance. Software simulation does not establish calibrated reachability, physical stopping, sensor reliability or hardware exactly-once execution.
