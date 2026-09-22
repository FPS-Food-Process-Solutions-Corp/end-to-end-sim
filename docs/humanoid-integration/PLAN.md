# Humanoid platform integration plan

Branch: `codex/humanoid-platform-integration`, based on standalone harness commit `02fabbec015d9444ece79ec38c089e69ec1faeaa`. Astra owns coordination, decisions and documentation; Luna reads sources without edits; Sol implements, tests, reviews and owns agreed simulation runtime operations.

## End-to-end boundary

Use the unchanged real coffee-platform API and Socket.IO service, the recovered real platform-client, and its public injected `PickExecutor.run(TaskContext, progress_cb)` interface. The executor runs the complete per-pastry humanoid flow against simulated AMR, VLA, mover, lift and perception adapters.

The real client remains the sole owner of assignment, network progress/failure/completion reports, acknowledgment/reconnect, pending completion and platform readback. The bridge must not use the standalone `StubPlatform`, claim the next task, send completion directly, or invoke the client's default box-batch delivery route. Preserve the existing standalone mode and its 21 acceptance tests.

## Verified source baseline

- Client source: `C:/Users/andyl/.codex/worktrees/dfcb/platform-client`, branch `codex/durable-completion-recovery`, reviewed HEAD `e6766e8319c9a6a832e8f058135a9d52b869a7c2`. Production baseline `948fd23c1204f94983cc2e35865e3796f81b8a9c`; `hr_client/client.py` SHA256 `65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777`. Existing untracked `.local/` and `pending-completions.json` remain untouched.
- `HumanoidRobotClient.__init__` accepts `pick_executor`, `pending_store`, `completion_callback` and `readback` (`hr_client/client.py:443`). Its public executor path returns before default box delivery (`:1490`). The built-in CLI does not inject an executor, so integration needs its own composition launcher.
- `PickExecutor.run` is async; progress callbacks receive `PickSubtask` and integer progress and must be awaited (`hr_client/task_executor.py:33`; client callback at `client.py:1517`). `TaskContext` carries session/task/item/retry/rack/counter, resolved location and order identity (`hr_client/models.py:107`).
- Known completion passes execution identity and terminal evidence into the durable client queue before network reporting (`hr_client/client.py:1791`). `unresolved(...)` holds without a terminal report or next-task request. Ordinary `failed(...)` is a platform failure and must never represent uncertain physical state.
- Nova remains frozen at `39c6aff523e95bc03a1db10bb854aec8746d0df9`. Any later mixed run uses its real bridge/executor and the existing fake provider under the single agreed runtime owner. No Nova source changes are planned.

## Assigned physical execution

Add an assigned-unit mode around the existing physical state machine. It starts one supplied Rack B task at rack navigation and ends only at verified placement, safe failure or a persistent hold. Bypass local selection, local platform reporting and next-task/front-idle ownership in this mode.

Keep all physical stages: navigate to slot tag; lift and pre-pick posture; VLA; lift/possession checks; retract; placement navigation/lift/pre-place; possession recheck; place into assigned counter; verify placement and empty hands. Counter 4 has its own symbolic target. No calibrated coordinates or live policy/device endpoints are introduced.

An immutable physical-unit key contains order, session, task and assigned counter. A registry anchored to task ID also freezes item, rack, level and slot, so changing a source or counter cannot allocate a second unit directory for the same task. Save incoming retry count as assignment metadata, not as permission to repick an already placed unit. Per-action IDs include the stable unit namespace, cycle, action and safe attempt. An acknowledgment/report retry reuses the action identity; only positively established no-effect failure may create a new physical attempt.

Persist an assignment manifest and intent before dispatch. A terminal proof must include exact assignment identity, place execution ID/status, target counter, bun identity, current possession/placement evidence and simulation provenance. Returning `completed` requires that proof. Unknown outcome, stale/mismatched status, cancellation uncertainty or collision returns `unresolved` and preserves a hold. A completed effect during cancellation is retained, but no dependent motion starts.

## Async execution and exclusion

Keep the synchronous physical engine serialized in one worker so Socket.IO and client recovery remain responsive. Forward progress to the client's event loop through an explicit awaited bridge. Cancellation signals the worker cooperatively and waits for bounded cleanup/reconciliation; cancelling a coroutine must not abandon a still-moving worker and free the robot for another assignment.

Add device-wide ownership across per-task state directories, not just the existing per-directory lock. Persist an unresolved owner through process death and holds. A new task cannot take ownership while the prior physical state is unresolved. Re-delivery of the same assignment reconciles the saved execution before any new command.

## Startup recovery boundary

The client pending-completion queue starts after the executor returns. A process can die after placement but before that return. The bridge therefore needs its own durable assignment/physical proof, and startup must reconcile that gap before the client can request new work.

The verified public `queue_recovered_completion(identity, terminal_evidence)` method (`hr_client/client.py:1833`) can seed a proven completion before `client.run()`. The platform contract also returns the same IN_PROGRESS task on `request_next_task` (`docs/PLATFORM_API.md:129`), allowing the executor to reconcile its saved physical journal on redelivery. Use exact saved identity/proof in the real client's supported recovery path; the real client performs readback/reporting. If evidence remains unknown, refuse new motion and retain an actionable hold. Do not call private network methods to manufacture completion.

## Acceptance stages

1. Local contract tests: preserve all standalone tests; test assigned-only completion without local reporting, public client types, progress/cancellation boundary, device exclusion, retry metadata, corrupt/mismatched identity, crash recovery and persistent holds.
2. Fresh real Rack B order: real platform assignment and real client execution reach READY only after verified simulator counter placement. Record task/order/session/counter identities, physical action counts and stock changes.
3. Meaningful isolated faults: safe retries, missing completion acknowledgment, process restart after placement, cancellation/unknown holds and partial success/failure. Expose the real platform's partial-order settlement and cancellation-accounting defects as external limitations; do not alter business logic or force settlement.
4. Mixed routing: after isolated cases pass, run one real Rack A/Nova plus Rack B/humanoid order if the fixtures support it. Verify exact device routing, distinct execution starts, completion settlement and per-rack stock effects.
5. Final review: code review, source hashes, commands, fresh fixture locations, failed attempts and cleanup evidence. Separate simulated physical assurance from real hardware assurance.

## Ownership and runtime constraints

This worktree owns the humanoid bridge, launcher, tests and documentation. The client task owns shared runtime fixtures, generic client fixes and master-report consolidation; the Nova task owns its source. A single agreed Sol owner controls all platform/proxy/provider/bridge processes and fresh databases for actual runs. No launch occurs until that owner and ports are confirmed.

The confirmed sole runtime owner is the client task's GPT-6 Sol `/root/sol_combined_harness`. Reserved resources are API 3121, humanoid proxy 3122, optional Nova proxy 3123 and ROS domain 71 with localhost-only mode. This task launches none of those services. The owner confirmed a read-only free-port/runtime preflight; it must repeat appropriate checks before each actual launch.

The existing test interpreter is `/home/user/.venvs/end-to-end-sim-ros/bin/python` on Ubuntu-22.04. Fresh databases use `taska_20260922_humanoid_<case>_<unique>` and are cloned from original `coffee_platform_sim` by that owner, never from a previous task database. The seed is historical business state, not empty: the operator must capture current counter occupancy, task queue, routing and rack inventory before creating an order. It must not forcibly clear historical records to make a test pass.

The previous 684-file evidence archive, original/captured databases and journals stay immutable. Canonical coffee-platform source/schema and aio/AtomW-VLA repositories remain read-only. No installation occurs without proposed commands. No deployment or physical device access is in scope.
