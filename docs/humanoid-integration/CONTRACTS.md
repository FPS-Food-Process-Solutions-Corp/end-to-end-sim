# Real client contract and provenance

This integration composes the recovered platform-client without changing its source. The client worktree is `C:/Users/andyl/.codex/worktrees/dfcb/platform-client`, reviewed on `codex/durable-completion-recovery` at documentation HEAD `e6766e8319c9a6a832e8f058135a9d52b869a7c2`. Production commit `948fd23c1204f94983cc2e35865e3796f81b8a9c` is an ancestor; `hr_client/client.py` is unchanged from that commit and has SHA256 `65bc9effd3c11241517aad58290d109a67f6c792c165c286013267772a91d777`.

## Public composition

`HumanoidRobotClient(settings, hardware, claim, locations, ..., pick_executor=..., pending_store=..., completion_callback=..., readback=...)` accepts the injected executor (`hr_client/client.py:443`). The original CLI does not expose this injection (`hr_client/__main__.py:116`), so a new launcher is required. It must import the actual pinned client, rather than create a lookalike client or replace its reporting loop.

The external executor route runs before the default humanoid/box-delivery path (`hr_client/client.py:1490`). An inert hardware placeholder is explicitly supported in this path, including session completion (`:919`). `RobotClaim` is local bookkeeping; it does not supply the executor's device-wide motion exclusion. No real hardware wrapper needs to be constructed.

`PickExecutor.run(TaskContext, progress_cb)` is async. `TaskContext` carries session ID, task ID, item identity, retry count, rack area, counter area, resolved slot/counter locations and order ID (`hr_client/models.py:107`). `ProgressCallback` is `Callable[[PickSubtask, int], Awaitable[None]]` (`hr_client/task_executor.py:33`). Await callbacks and use the pick stage enum values through `PLACED_IN_BOX`; the delivery stages describe a different workflow.

The client wraps progress, clamps it and sends it over its own transport (`hr_client/client.py:1517`). The bridge must not emit Socket.IO progress or completion directly.

The integration launcher constructs the unchanged client and retains its registered event handlers. Its composition wrapper around the public `client.sio.connect` method forces `transports=["websocket"]` for the controlled proxy runs. The proxy URL is assigned to the public server settings; `completion_readback_url` points separately at the API so the real client's default readback can reconcile a missing acknowledgment. This is a launcher adaptation, not a new client transport implementation. The launcher accepts explicit local HTTP endpoints with ports and the `humanoid_robot` device identity.

## Outcomes and physical uncertainty

| Executor result | Client behavior | Bridge requirement |
| --- | --- | --- |
| `completed(..., execution_id=..., terminal_evidence=...)` | Queues durable completion before network report. | Exact saved physical proof of assigned-counter placement and task identity. |
| Completed with `ready_for_next=False` | Reports completion but remains PAUSED. | Use only when completion is proven but next motion is not permitted. |
| `failed(...)` | Reports an ordinary platform task failure. | Positively known terminal failure; never a substitute for unknown physical state. |
| `unresolved(...)` | PAUSED hold, no terminal report, no next-task request. | Ambiguous effect, collision, unresolved cancellation, identity mismatch or failed proof reconciliation. |
| Raised exception/cancellation | Holds the external task; cancellation is re-raised. | Preserve durable physical ownership and drain/stop the worker. |

These branches are in `hr_client/client.py:1528`. The current failed-result factory does not carry execution identity/evidence; preserve those details in the integration's own physical journal rather than inventing a client field.

At this baseline, a failed outcome with `ready_for_next=False` enters an execution hold with no public clear operation. A verified safe failure must therefore establish physical readiness and use readiness true if later tasks should proceed. The platform allocates unassigned work before failed work, creates tasks with `retryCount=0` and `maxRetries=1`, and retries an eligible failed task once. Exhausted failed tasks can end the pick session, but the unchanged order-preparation logic refuses READY while any task remains FAILED. This is a platform partial-settlement limitation, not evidence that a failed pastry was completed.

The reviewed baseline has no durable failure-report queue. `_fail_task` defers its immediate next-task request when a report is unacknowledged, but reconnect scheduling has no completion-like failure journal/readback reconciliation. A retry after the platform committed FAILED can return `PICK_TASK_NOT_IN_PROGRESS` and stop retries early; transport failures can exhaust the retry budget. The client owner is characterizing and correcting this boundary in a separate worktree. Physical failure proof prevents duplicate motion but does not by itself prove report acceptance.

`client.stop()` stops heartbeat/disconnects Socket.IO (`hr_client/client.py:1265`). It does not cancel or stop an injected physical worker. The integration launcher must coordinate worker shutdown before releasing the device or ending the process normally.

## Restart boundary

Client completion identity is session, task, order and execution ID (`hr_client/pending_completion.py:23`). A known completed result enters the durable queue before network emission (`hr_client/client.py:1791`). The public `queue_recovered_completion(identity, terminal_evidence)` method accepts a recovered exact result (`:1833`). Pending completion/readback/reconnect remain client responsibilities.

Subscription returns active session/order/progress but does not contain a current task identity (`docs/PLATFORM_API.md:32`). The task request contract returns an already IN_PROGRESS task before allocating another one; FAILED tasks are retried only after unassigned work, with an increased retry count (`docs/PLATFORM_API.md:129`). Thus the executor must recognize an assignment returned after restart and reconcile its physical journal. A changed retry count is not proof that another physical pick is safe.

There is a gap between physical placement and return from the executor, before the client pending queue exists. The integration's assignment manifest, action ledger and verified terminal proof cover this gap. It may seed the public client recovery API with that exact proof; it may not fabricate a pending completion from a controller stage label alone.

## Reviewed recovery context

The original project documents were read in place at `D:/Work/FPS/Robotics/end-to-end-sim/docs/`; they may be uncommitted and are not copied over the shared originals.

| Document | Reviewed SHA256 |
| --- | --- |
| `combined-recovery-validation-results.md` | `e81d0cc8ec40a3e70ee39b5ae8474052148dd85de935cfdabcd2d55bdbfd2a1b` |
| `master-verification-report.md` | `a9b8f087ea3fdbfbe67a6a4facc234c1867311017c7f9794a726e4fef8ecb854` |
| `non-platform-recovery-follow-up.md` | `9257bfa6bac49d46524011381bf93f34beea0f3a498603a95149f75a7d61227b` |

The prior evidence establishes 112 client checks, 236 Nova checks, 15 fixture checks and 13 combined software scenarios. It is prerequisite evidence, not acceptance of this new humanoid composition. Known platform limits include non-idempotent completion replay, cancellation accounting and mixed-success settlement. New tests must record observed constraints without changing platform business logic or forcing an order into READY.

Runtime provenance must record the actual loaded modules and their hashes again. Use the existing Ubuntu-22.04 interpreter `/home/user/.venvs/end-to-end-sim-ros/bin/python`, with explicit source paths. The bundled Windows interpreter remains sufficient for standalone/pure physical tests, but it lacks `socketio`; no dependency installation is part of this work.
